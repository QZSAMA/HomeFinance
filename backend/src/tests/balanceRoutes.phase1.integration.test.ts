import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import assetRoutes from '../routes/assets';
import { coordinateFinancialMutation } from '../services/financialMutationCoordinator';
import { FinancialMutationStore } from '../services/ledgerTypes';
import { createPrismaFinancialMutationStore } from '../services/prismaFinancialMutationStore';

const prisma = new PrismaClient();
const runId = randomUUID();
const adminUserId = `p1-asset-admin-${runId}`;
const viewerUserId = `p1-asset-viewer-${runId}`;
const outsiderUserId = `p1-asset-outsider-${runId}`;
const familyId = `p1-asset-family-${runId}`;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/assets', assetRoutes);

const tokenFor = (userId: string) => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Asset integration' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const assetPayload = (value: number) => ({
  name: '应急现金',
  type: 'CASH',
  category: '流动资产',
  value,
  costBasis: value - 500,
  currency: 'CNY',
  purchaseDate: '2026-08-31T00:00:00.000Z',
  description: 'Asset route integration',
});

const countsFor = async () => Promise.all([
  prisma.asset.count({ where: { familyId } }),
  prisma.idempotencyRecord.count({ where: { familyId, operation: 'CREATE_ASSET' } }),
  prisma.auditEvent.count({ where: { familyId, entity: 'Asset' } }),
  prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { cacheVersion: true } }),
]);

describe('Phase 1 real PostgreSQL Asset route adoption', () => {
  let connected = false;

  beforeAll(async () => {
    await prisma.$connect();
    connected = true;
    await prisma.user.createMany({
      data: [
        { id: adminUserId, email: `${adminUserId}@example.test`, passwordHash: 'test', name: 'Asset admin' },
        { id: viewerUserId, email: `${viewerUserId}@example.test`, passwordHash: 'test', name: 'Asset viewer' },
        { id: outsiderUserId, email: `${outsiderUserId}@example.test`, passwordHash: 'test', name: 'Asset outsider' },
      ],
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Asset integration family',
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

  test('coalesces concurrent Asset creates and replays without another fact or revision', async () => {
    const before = await countsFor();
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(app)
      .post(`/api/families/${familyId}/assets`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'asset-concurrent-create')
      .send(assetPayload(12500))));

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(responses.filter((response) => response.body.deduplicated === false)).toHaveLength(1);
    expect(responses.filter((response) => response.body.deduplicated === true)).toHaveLength(7);
    expect(new Set(responses.map((response) => response.body.operationId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);

    const replay = await request(app)
      .post(`/api/families/${familyId}/assets`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'asset-concurrent-create')
      .send(assetPayload(12500));

    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.deduplicated).toBe(true);
    const after = await countsFor();
    expect(after[0]).toBe(before[0] + 1);
    expect(after[1]).toBe(before[1] + 1);
    expect(after[2]).toBe(before[2] + 1);
    expect(after[3].cacheVersion).toBe(before[3].cacheVersion + 1);
  });

  test('increments Asset version and rejects stale update/delete without side effects', async () => {
    const create = await request(app)
      .post(`/api/families/${familyId}/assets`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'asset-version-create')
      .send(assetPayload(1000));
    expect(create.status).toBe(201);

    const updated = await request(app)
      .put(`/api/families/${familyId}/assets/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'asset-version-update')
      .set('If-Match', 'W/"1"')
      .send(assetPayload(1200));
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: create.body.id, version: 2, deduplicated: false });

    const afterUpdate = await countsFor();
    const staleUpdate = await request(app)
      .put(`/api/families/${familyId}/assets/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'asset-stale-update')
      .set('If-Match', '1')
      .send(assetPayload(1300));
    expect(staleUpdate.status).toBe(409);
    expect(staleUpdate.body).toMatchObject({ code: 'VERSION_CONFLICT', retryable: false });

    const staleDelete = await request(app)
      .delete(`/api/families/${familyId}/assets/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'asset-stale-delete')
      .set('If-Match', '1');
    expect(staleDelete.status).toBe(409);
    expect(staleDelete.body).toMatchObject({ code: 'VERSION_CONFLICT', retryable: false });
    expect(await countsFor()).toEqual(afterUpdate);
    await expect(prisma.asset.findUniqueOrThrow({ where: { id: create.body.id } })).resolves
      .toMatchObject({ version: 2, value: expect.anything() });

    const deleted = await request(app)
      .delete(`/api/families/${familyId}/assets/${create.body.id}`)
      .set('Authorization', `Bearer ${tokenFor(adminUserId)}`)
      .set('Idempotency-Key', 'asset-version-delete')
      .set('If-Match', '2');
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ version: 2, deduplicated: false });
    await expect(prisma.asset.findUnique({ where: { id: create.body.id } })).resolves.toBeNull();
  });

  test('rejects viewer and non-member writes before any asset mutation state changes', async () => {
    const before = await countsFor();
    const viewer = await request(app)
      .post(`/api/families/${familyId}/assets`)
      .set('Authorization', `Bearer ${tokenFor(viewerUserId)}`)
      .set('Idempotency-Key', 'asset-viewer-write')
      .send(assetPayload(700));
    const outsider = await request(app)
      .post(`/api/families/${familyId}/assets`)
      .set('Authorization', `Bearer ${tokenFor(outsiderUserId)}`)
      .set('Idempotency-Key', 'asset-outsider-write')
      .send(assetPayload(800));

    expect(viewer.status).toBe(403);
    expect(outsider.status).toBe(403);
    expect(await countsFor()).toEqual(before);
  });

  test('rolls back an Asset and coordinator records when the executor result is invalid', async () => {
    const store: FinancialMutationStore = createPrismaFinancialMutationStore(prisma);
    const before = await countsFor();

    await expect(coordinateFinancialMutation(
      {
        familyId,
        actorId: adminUserId,
        source: 'MANUAL',
        idempotencyKey: 'asset-invalid-result-rollback',
        operation: 'CREATE_ASSET',
        requestPayload: { name: 'rollback', value: 1 },
        httpStatus: 201,
        audit: { action: 'CREATE', entity: 'Asset' },
      },
      store,
      async (transaction) => {
        const asset = await transaction.asset!.create({
          data: {
            familyId,
            name: 'Should roll back',
            type: 'CASH',
            value: 1,
            currency: 'CNY',
          },
        });
        return { resourceId: ' ', record: asset };
      },
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400, retryable: false });

    expect(await countsFor()).toEqual(before);
    await expect(prisma.asset.findFirst({ where: { familyId, name: 'Should roll back' } })).resolves.toBeNull();
  });
});
