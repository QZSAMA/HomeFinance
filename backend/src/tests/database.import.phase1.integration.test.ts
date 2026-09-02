import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `import-schema-user-${runId}`;
const familyId = `import-schema-family-${runId}`;

describe('Phase 1 PostgreSQL import batch contracts', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: `import-schema-${runId}@example.test`,
        passwordHash: 'integration-only',
        name: 'Import Schema Integration',
      },
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Import Schema Integration Family',
        members: {
          create: {
            userId,
            role: 'admin',
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.family.delete({ where: { id: familyId } });
    await expect(prisma.importRow.count({ where: { batch: { familyId } } })).resolves.toBe(0);
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('persists a server-owned batch and traceable row state', async () => {
    const batch = await prisma.importBatch.create({
      data: {
        id: `import-batch-${runId}`,
        familyId,
        actorUserId: userId,
        format: 'alipay',
        fileHash: 'a'.repeat(64),
        parserVersion: 'csv-v1',
        previewHash: 'b'.repeat(64),
        rowCount: 2,
        rows: {
          create: [
            {
              id: `import-row-1-${runId}`,
              rowNumber: 1,
              canonicalPayload: { date: '2026-09-01', amount: 10, type: 'INCOME' },
            },
            {
              id: `import-row-2-${runId}`,
              rowNumber: 2,
              canonicalPayload: { date: 'invalid', amount: -1, type: 'EXPENSE' },
              validationErrors: [{ path: 'amount', message: 'must be positive' }],
              status: 'INVALID',
            },
          ],
        },
      },
      include: { rows: true },
    });

    expect(batch).toMatchObject({
      familyId,
      actorUserId: userId,
      status: 'PREVIEWED',
      rowCount: 2,
      rows: expect.arrayContaining([
        expect.objectContaining({ rowNumber: 1, status: 'VALID' }),
        expect.objectContaining({ rowNumber: 2, status: 'INVALID' }),
      ]),
    });
  });

  test('arbitrates duplicate row numbers within one batch', async () => {
    const batch = await prisma.importBatch.create({
      data: {
        id: `import-unique-batch-${runId}`,
        familyId,
        actorUserId: userId,
        format: 'wechat',
        fileHash: 'c'.repeat(64),
        parserVersion: 'csv-v1',
        previewHash: 'd'.repeat(64),
      },
    });

    await prisma.importRow.create({
      data: {
        id: `import-unique-row-1-${runId}`,
        batchId: batch.id,
        rowNumber: 1,
        canonicalPayload: { amount: 1 },
      },
    });

    await expect(prisma.importRow.create({
      data: {
        id: `import-unique-row-2-${runId}`,
        batchId: batch.id,
        rowNumber: 1,
        canonicalPayload: { amount: 2 },
      },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('enforces hash and row number checks at the database boundary', async () => {
    await expect(prisma.importBatch.create({
      data: {
        id: `import-invalid-hash-${runId}`,
        familyId,
        actorUserId: userId,
        format: 'alipay',
        fileHash: 'z'.repeat(64),
        parserVersion: 'csv-v1',
        previewHash: 'e'.repeat(64),
      },
    })).rejects.toThrow(/ImportBatch_fileHash_format_check/);

    const batch = await prisma.importBatch.create({
      data: {
        id: `import-row-check-batch-${runId}`,
        familyId,
        actorUserId: userId,
        format: 'alipay',
        fileHash: 'f'.repeat(64),
        parserVersion: 'csv-v1',
        previewHash: '0'.repeat(64),
      },
    });

    await expect(prisma.importRow.create({
      data: {
        id: `import-invalid-row-${runId}`,
        batchId: batch.id,
        rowNumber: 0,
        canonicalPayload: { amount: 1 },
      },
    })).rejects.toThrow(/ImportRow_rowNumber_check/);
  });
});
