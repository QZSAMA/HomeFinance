import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import liabilitiesRoutes from '../routes/liabilities';
import { coordinateFinancialMutation } from '../services/financialMutationCoordinator';
import { FinancialMutationStore } from '../services/ledgerTypes';
import { createPrismaFinancialMutationStore } from '../services/prismaFinancialMutationStore';

const prisma = new PrismaClient();
const runId = randomUUID();
const adminUserId = `p1-liability-admin-${runId}`;
const viewerUserId = `p1-liability-viewer-${runId}`;
const outsiderUserId = `p1-liability-outsider-${runId}`;
const familyId = `p1-liability-family-${runId}`;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/liabilities', liabilitiesRoutes);

const tokenFor = (userId: string) => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Liability integration' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const liabilityPayload = (amount: number) => ({
  name: '住房贷款',
  type: 'MORTGAGE',
  amount,
  interestRate: 3.8,
  startDate: '2024-01-01T00:00:00.000Z',
  endDate: '2044-01-01T00:00:00.000Z',
  currency: 'CNY',
  description: 'Liability route integration',
});

const countsFor = async () => Promise.all([
  prisma.liability.count({ where: { familyId } }),
  prisma.idempotencyRecord.count({ where: { familyId } }),
  prisma.auditEvent.count({ where: { familyId, entity: 'Liability' } }),
  prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { cacheVersion: true } }),
]);

describe('Phase 1 real PostgreSQL Liability route adoption', () => {
  let connected = false;

  beforeAll(async () => {
    await prisma.$connect();
    connected = true;
    await prisma.user.createMany({
      data: [
        { id: adminUserId, email: `${adminUserId}@example.test`, passwordHash: 'test', name: 'Liability admin' },
        { id: viewerUserId, email: `${viewerUserId}@example.test`, passwordHash: 'test', name: 'Liability viewer' },
        { id: outsiderUserId, email: `${outsiderUserId}@example.test`, passwordHash: 'test', name: 'Liability outsider' },
      ],
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Liability integration family',
        members: {
          create: [
            { userId: adminUserId, role: 'admin' },
            { userId: viewerUserId, role: 'viewer' },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    if (!connected) return;
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUserId, viewerUserId, outsiderUserId] } } });
    await prisma.$disconnect();
  });

  test('coalesces concurrent Liability creates and replays without another fact or revision', async () => {
    const before = await countsFor();
    const responses = await Promise.all(Array.from({ length: 20 }, () => request(app)
      .post(`/api/families/${familyId}/liabilities`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-concurrent-create')
      .send(liabilityPayload(350000))));

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(responses.filter((response) => response.body.deduplicated === false)).toHaveLength(1);
    expect(responses.filter((response) => response.body.deduplicated === true)).toHaveLength(19);
    expect(new Set(responses.map((response) => response.body.operationId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);

    const replay = await request(app)
      .post(`/api/families/${familyId}/liabilities`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-concurrent-create')
      .send(liabilityPayload(350000));

    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.deduplicated).toBe(true);
    const after = await countsFor();
    expect(after[0]).toBe(before[0] + 1);
    expect(after[1]).toBe(before[1] + 1);
    expect(after[2]).toBe(before[2] + 1);
    expect(after[3].cacheVersion).toBe(before[3].cacheVersion + 1);
  });

  test('rejects same-key different-payload Liability reuse without side effects', async () => {
    const first = await request(app)
      .post(`/api/families/${familyId}/liabilities`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-key-conflict')
      .send(liabilityPayload(4100));
    expect(first.status).toBe(201);

    const afterCommit = await countsFor();
    const conflict = await request(app)
      .post(`/api/families/${familyId}/liabilities`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-key-conflict')
      .send(liabilityPayload(4200));

    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', retryable: false });
    expect(await countsFor()).toEqual(afterCommit);
  });

  test('increments Liability version and rejects stale update/delete without side effects', async () => {
    const create = await request(app)
      .post(`/api/families/${familyId}/liabilities`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-version-create')
      .send(liabilityPayload(1000));
    expect(create.status).toBe(201);

    const updated = await request(app)
      .put(`/api/families/${familyId}/liabilities/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-version-update')
      .set('If-Match', 'W/"1"')
      .send(liabilityPayload(1200));
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: create.body.id, version: 2, deduplicated: false });

    const afterUpdate = await countsFor();
    const staleUpdate = await request(app)
      .put(`/api/families/${familyId}/liabilities/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-stale-update')
      .set('If-Match', '1')
      .send(liabilityPayload(1300));
    expect(staleUpdate.status).toBe(409);
    expect(staleUpdate.body).toMatchObject({ code: 'VERSION_CONFLICT', retryable: false });

    const staleDelete = await request(app)
      .delete(`/api/families/${familyId}/liabilities/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-stale-delete')
      .set('If-Match', '1');
    expect(staleDelete.status).toBe(409);
    expect(staleDelete.body).toMatchObject({ code: 'VERSION_CONFLICT', retryable: false });
    expect(await countsFor()).toEqual(afterUpdate);
    await expect(prisma.liability.findUniqueOrThrow({ where: { id: create.body.id } })).resolves
      .toMatchObject({ version: 2, amount: expect.anything() });

    const deleted = await request(app)
      .delete(`/api/families/${familyId}/liabilities/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'liability-version-delete')
      .set('If-Match', '2');
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ version: 2, deduplicated: false });
    await expect(prisma.liability.findUnique({ where: { id: create.body.id } })).resolves.toBeNull();
  });

  test('rejects viewer and non-member writes before any Liability state changes', async () => {
    const before = await countsFor();
    const viewer = await request(app)
      .post(`/api/families/${familyId}/liabilities`)
      .set('Authorization', `Bearer ${tokenFor(viewerUserId)}`)
      .set('Idempotency-Key', 'liability-viewer-write')
      .send(liabilityPayload(700));
    const outsider = await request(app)
      .post(`/api/families/${familyId}/liabilities`)
      .set('Authorization', `Bearer ${tokenFor(outsiderUserId)}`)
      .set('Idempotency-Key', 'liability-outsider-write')
      .send(liabilityPayload(800));

    expect(viewer.status).toBe(403);
    expect(outsider.status).toBe(403);
    expect(await countsFor()).toEqual(before);
  });

  test('rolls back a Liability and coordinator records when the executor result is invalid', async () => {
    const store: FinancialMutationStore = createPrismaFinancialMutationStore(prisma);
    const before = await countsFor();

    await expect(coordinateFinancialMutation(
      {
        familyId,
        actorId: adminUserId,
        source: 'MANUAL',
        idempotencyKey: 'liability-invalid-result-rollback',
        operation: 'CREATE_LIABILITY',
        requestPayload: { name: 'rollback', amount: 1 },
        httpStatus: 201,
        audit: { action: 'CREATE', entity: 'Liability' },
      },
      store,
      async (transaction) => {
        const liability = await transaction.liability!.create({
          data: {
            familyId,
            name: 'Should roll back',
            type: 'OTHER',
            amount: 1,
            currency: 'CNY',
          },
        });
        return { resourceId: ' ', record: liability };
      },
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400, retryable: false });

    expect(await countsFor()).toEqual(before);
    await expect(prisma.liability.findFirst({ where: { familyId, name: 'Should roll back' } })).resolves.toBeNull();
  });
});
