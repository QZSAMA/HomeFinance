import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import importRoutes from '../routes/import';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `p1-import-confirm-user-${runId}`;
const familyId = `p1-import-confirm-family-${runId}`;
const foreignUserId = `p1-import-foreign-user-${runId}`;
const foreignFamilyId = `p1-import-foreign-family-${runId}`;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/import', importRoutes);

const token = jwt.sign(
  { userId, email: `${runId}@example.test`, name: 'Import confirm' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const batchId = (name: string) => `p1-import-${name}-${runId}`;
const previewHash = (value: string) => value.repeat(64);

describe('Phase 1 real PostgreSQL import confirm', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { id: userId, email: `${runId}@example.test`, passwordHash: 'test', name: 'Import confirm' },
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Import confirm family',
        members: { create: { userId, role: 'member' } },
      },
    });
    await prisma.user.create({
      data: {
        id: foreignUserId,
        email: `foreign-${runId}@example.test`,
        passwordHash: 'test',
        name: 'Foreign import owner',
      },
    });
    await prisma.family.create({
      data: {
        id: foreignFamilyId,
        name: 'Foreign import family',
        members: { create: { userId: foreignUserId, role: 'member' } },
      },
    });
  });

  afterEach(async () => {
    await prisma.income.deleteMany({ where: { familyId } });
    await prisma.expense.deleteMany({ where: { familyId } });
    await prisma.auditEvent.deleteMany({ where: { familyId } });
    await prisma.idempotencyRecord.deleteMany({ where: { familyId } });
    await prisma.importBatch.deleteMany({ where: { familyId } });
  });

  afterAll(async () => {
    await prisma.family.delete({ where: { id: familyId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.family.delete({ where: { id: foreignFamilyId } });
    await prisma.user.delete({ where: { id: foreignUserId } });
    await prisma.$disconnect();
  });

  test('rejects an invalid server row without writing any ledger record', async () => {
    const hash = previewHash('a');
    const batch = await prisma.importBatch.create({
      data: {
        id: batchId('invalid'),
        familyId,
        actorUserId: userId,
        format: 'alipay',
        fileHash: previewHash('b'),
        parserVersion: 'csv-v1',
        previewHash: hash,
        rowCount: 2,
        rows: {
          create: [
            {
              rowNumber: 1,
              canonicalPayload: {
                date: '2026-09-01',
                description: 'valid row',
                amount: 100,
                type: 'INCOME',
              },
            },
            {
              rowNumber: 2,
              canonicalPayload: {
                date: '2026-09-02',
                description: 'invalid row',
                amount: -5,
                type: 'EXPENSE',
              },
              status: 'INVALID',
              validationErrors: [{ path: 'amount', message: 'must be positive' }],
            },
          ],
        },
      },
    });

    const response = await request(app)
      .post(`/api/families/${familyId}/import/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'import-invalid-batch')
      .send({ batchId: batch.id, expectedPreviewHash: hash });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      failedRows: [{ row: 2, errors: [{ path: 'amount', message: 'must be positive' }] }],
    });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.expense.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))
      .resolves.toMatchObject({ status: 'PREVIEWED' });
  });

  test('confirms canonical server rows and ignores client-owned financial fields', async () => {
    const hash = previewHash('c');
    const batch = await prisma.importBatch.create({
      data: {
        id: batchId('valid'),
        familyId,
        actorUserId: userId,
        format: 'wechat',
        fileHash: previewHash('d'),
        parserVersion: 'csv-v1',
        previewHash: hash,
        rowCount: 2,
        rows: {
          create: [
            {
              rowNumber: 1,
              canonicalPayload: {
                date: '2026-09-03',
                description: 'server income',
                amount: 100,
                type: 'INCOME',
                category: 'salary',
              },
            },
            {
              rowNumber: 2,
              canonicalPayload: {
                date: '2026-09-04',
                description: 'server expense',
                amount: 20,
                type: 'EXPENSE',
                category: 'food',
              },
            },
          ],
        },
      },
    });

    const response = await request(app)
      .post(`/api/families/${familyId}/import/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'import-valid-batch')
      .send({
        batchId: batch.id,
        expectedPreviewHash: hash,
        categoryPatch: { '2': 'edited-food' },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      batchId: batch.id,
      successCount: 2,
      failedRows: [],
      deduplicated: false,
      operationId: expect.any(String),
    });
    const income = await prisma.income.findFirst({ where: { familyId } });
    expect(income).toMatchObject({ description: 'server income', category: 'salary' });
    expect(Number(income!.amount)).toBe(100);
    const expense = await prisma.expense.findFirst({ where: { familyId } });
    expect(expense).toMatchObject({ description: 'server expense', category: 'edited-food' });
    expect(Number(expense!.amount)).toBe(20);
    await expect(prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))
      .resolves.toMatchObject({ status: 'COMMITTED' });

    const replay = await request(app)
      .post(`/api/families/${familyId}/import/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'import-valid-batch')
      .send({
        batchId: batch.id,
        expectedPreviewHash: hash,
        categoryPatch: { '2': 'edited-food' },
      });

    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toMatchObject({
      batchId: batch.id,
      successCount: 2,
      operationId: response.body.operationId,
      deduplicated: true,
    });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.expense.count({ where: { familyId } })).resolves.toBe(1);

    const duplicate = await request(app)
      .post(`/api/families/${familyId}/import/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'import-valid-batch-second-key')
      .send({ batchId: batch.id, expectedPreviewHash: hash });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({
      code: 'IMPORT_BATCH_NOT_CONFIRMABLE',
      retryable: false,
    });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.expense.count({ where: { familyId } })).resolves.toBe(1);
  });

  test('rejects a tampered preview hash without a ledger write', async () => {
    const hash = previewHash('e');
    const batch = await prisma.importBatch.create({
      data: {
        id: batchId('tamper'),
        familyId,
        actorUserId: userId,
        format: 'alipay',
        fileHash: previewHash('f'),
        parserVersion: 'csv-v1',
        previewHash: hash,
        rowCount: 1,
        rows: {
          create: {
            rowNumber: 1,
            canonicalPayload: {
              date: '2026-09-05', description: 'tamper', amount: 1, type: 'INCOME',
            },
          },
        },
      },
    });

    const response = await request(app)
      .post(`/api/families/${familyId}/import/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'import-tampered-hash')
      .send({ batchId: batch.id, expectedPreviewHash: previewHash('0') });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.expense.count({ where: { familyId } })).resolves.toBe(0);
  });

  test('rejects an expired batch and a batch from another family', async () => {
    const expiredHash = previewHash('1');
    const expiredBatch = await prisma.importBatch.create({
      data: {
        id: batchId('expired'),
        familyId,
        actorUserId: userId,
        format: 'alipay',
        fileHash: previewHash('2'),
        parserVersion: 'csv-v1',
        previewHash: expiredHash,
        rowCount: 1,
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        rows: {
          create: {
            rowNumber: 1,
            canonicalPayload: {
              date: '2026-09-06', description: 'expired', amount: 1, type: 'INCOME',
            },
          },
        },
      },
    });

    const expiredResponse = await request(app)
      .post(`/api/families/${familyId}/import/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'import-expired')
      .send({ batchId: expiredBatch.id, expectedPreviewHash: expiredHash });

    expect(expiredResponse.status).toBe(409);
    expect(expiredResponse.body).toMatchObject({ code: 'IMPORT_BATCH_NOT_CONFIRMABLE' });

    const foreignHash = previewHash('3');
    const foreignBatch = await prisma.importBatch.create({
      data: {
        id: batchId('foreign'),
        familyId: foreignFamilyId,
        actorUserId: foreignUserId,
        format: 'alipay',
        fileHash: previewHash('4'),
        parserVersion: 'csv-v1',
        previewHash: foreignHash,
        rowCount: 1,
        rows: {
          create: {
            rowNumber: 1,
            canonicalPayload: {
              date: '2026-09-07', description: 'foreign', amount: 1, type: 'INCOME',
            },
          },
        },
      },
    });

    const foreignResponse = await request(app)
      .post(`/api/families/${familyId}/import/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'import-foreign')
      .send({ batchId: foreignBatch.id, expectedPreviewHash: foreignHash });

    expect(foreignResponse.status).toBe(404);
    expect(foreignResponse.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.expense.count({ where: { familyId } })).resolves.toBe(0);
  });

  test('allows only one of two concurrent confirmations to submit a batch', async () => {
    const hash = previewHash('5');
    const batch = await prisma.importBatch.create({
      data: {
        id: batchId('concurrent'),
        familyId,
        actorUserId: userId,
        format: 'alipay',
        fileHash: previewHash('6'),
        parserVersion: 'csv-v1',
        previewHash: hash,
        rowCount: 2,
        rows: {
          create: [
            {
              rowNumber: 1,
              canonicalPayload: {
                date: '2026-09-08', description: 'concurrent income', amount: 30, type: 'INCOME',
              },
            },
            {
              rowNumber: 2,
              canonicalPayload: {
                date: '2026-09-09', description: 'concurrent expense', amount: 10, type: 'EXPENSE',
              },
            },
          ],
        },
      },
    });

    const responses = await Promise.all([
      request(app)
        .post(`/api/families/${familyId}/import/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'import-concurrent-a')
        .send({ batchId: batch.id, expectedPreviewHash: hash }),
      request(app)
        .post(`/api/families/${familyId}/import/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'import-concurrent-b')
        .send({ batchId: batch.id, expectedPreviewHash: hash }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
      code: 'IMPORT_BATCH_NOT_CONFIRMABLE',
    });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.expense.count({ where: { familyId } })).resolves.toBe(1);
  });
});
