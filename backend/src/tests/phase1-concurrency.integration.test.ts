import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createIncome } from '../services/ledgerApplicationService';
import { coordinateFinancialMutation } from '../services/financialMutationCoordinator';
import { FinancialMutationStore, CreateIncomeCommand } from '../services/ledgerTypes';
import { createPrismaFinancialMutationStore } from '../services/prismaFinancialMutationStore';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `p1-concurrency-user-${runId}`;
const familyId = `p1-concurrency-family-${runId}`;

const store: FinancialMutationStore = createPrismaFinancialMutationStore(prisma);

const command = (key: string, amount = 100): CreateIncomeCommand => ({
  familyId,
  actorId: userId,
  source: 'MANUAL',
  idempotencyKey: key,
  effectiveDate: new Date('2026-08-28T00:00:00.000Z'),
  payload: { amount, category: 'SALARY' },
});

describe('Phase 1 real PostgreSQL coordinator concurrency', () => {
  let connected = false;
  beforeAll(async () => {
    await prisma.$connect();
    connected = true;
    await prisma.user.create({
      data: { id: userId, email: `${runId}@example.test`, passwordHash: 'test', name: 'Concurrency' },
    });
    await prisma.family.create({
      data: { id: familyId, name: 'Concurrency family', members: { create: { userId, role: 'admin' } } },
    });
  });

  afterAll(async () => {
    if (!connected) return;
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('coalesces twenty identical createIncome requests into one committed mutation', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => createIncome(command('same-key'), store)));

    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    expect(results.filter((result) => result.deduplicated)).toHaveLength(19);
    expect(new Set(results.map((result) => result.operationId)).size).toBe(1);
    expect(new Set(results.map((result) => result.resourceId)).size).toBe(1);
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);
  });

  test('advances the durable family revision once for a database-arbitrated mutation', async () => {
    const before = await prisma.family.findUniqueOrThrow({
      where: { id: familyId },
      select: { cacheVersion: true },
    });

    await Promise.all(Array.from({ length: 20 }, () => createIncome(command('revision-once'), store)));

    const after = await prisma.family.findUniqueOrThrow({
      where: { id: familyId },
      select: { cacheVersion: true },
    });
    expect(after.cacheVersion).toBe(before.cacheVersion + 1);
  });

  test('replays a completed mutation without creating facts or advancing the family revision', async () => {
    const first = await createIncome(command('revision-replay'), store);
    const afterCommit = await prisma.family.findUniqueOrThrow({
      where: { id: familyId },
      select: { cacheVersion: true },
    });
    const countsAfterCommit = await Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.idempotencyRecord.count({ where: { familyId } }),
      prisma.auditEvent.count({ where: { familyId } }),
    ]);

    const replay = await createIncome(command('revision-replay'), store);

    expect(replay).toMatchObject({
      operationId: first.operationId,
      resourceId: first.resourceId,
      version: first.version,
      deduplicated: true,
    });
    await expect(prisma.family.findUniqueOrThrow({
      where: { id: familyId },
      select: { cacheVersion: true },
    })).resolves.toEqual(afterCommit);
    await expect(Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.idempotencyRecord.count({ where: { familyId } }),
      prisma.auditEvent.count({ where: { familyId } }),
    ])).resolves.toEqual(countsAfterCommit);
  });

  test('rejects a conflicting key reuse without adding facts or advancing the family revision', async () => {
    await expect(createIncome(command('different-key', 200), store)).resolves.toMatchObject({ deduplicated: false });
    const afterCommit = await prisma.family.findUniqueOrThrow({
      where: { id: familyId },
      select: { cacheVersion: true },
    });
    const factCounts = await Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.idempotencyRecord.count({ where: { familyId } }),
      prisma.auditEvent.count({ where: { familyId } }),
    ]);

    await expect(createIncome(command('different-key', 201), store)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED', status: 409, retryable: false,
    });
    await expect(prisma.family.findUniqueOrThrow({
      where: { id: familyId },
      select: { cacheVersion: true },
    })).resolves.toEqual(afterCommit);
    await expect(Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.idempotencyRecord.count({ where: { familyId } }),
      prisma.auditEvent.count({ where: { familyId } }),
    ])).resolves.toEqual(factCounts);
  });

  test('replays a committed response after simulated response loss', async () => {
    const beforeIncomeCount = await prisma.income.count({ where: { familyId } });
    const first = await createIncome(command('response-loss'), store);
    const replay = await createIncome(command('response-loss'), store);
    expect(JSON.parse(JSON.stringify(replay))).toEqual({
      ...JSON.parse(JSON.stringify(first)),
      deduplicated: true,
    });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(beforeIncomeCount + 1);
  });

  test('rolls back the income, idempotency record, and audit event when an executor returns an invalid result', async () => {
    const before = await Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.idempotencyRecord.count({ where: { familyId } }),
      prisma.auditEvent.count({ where: { familyId } }),
    ]);

    await expect(coordinateFinancialMutation(
      {
        familyId,
        actorId: userId,
        source: 'MANUAL',
        idempotencyKey: 'rollback-invalid-result',
        operation: 'CREATE_INCOME',
        requestPayload: { amount: 400, category: 'ROLLBACK' },
        httpStatus: 201,
        audit: { action: 'CREATE', entity: 'Income' },
      },
      store,
      async (transaction) => {
        const income = await transaction.income.create({
          data: {
            familyId,
            createdBy: userId,
            category: 'ROLLBACK',
            amount: 400,
            date: new Date('2026-08-28T00:00:00.000Z'),
            currency: 'CNY',
            originType: 'MANUAL',
          },
        });
        return { resourceId: ' ', record: income };
      },
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400, retryable: false });

    await expect(Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.idempotencyRecord.count({ where: { familyId } }),
      prisma.auditEvent.count({ where: { familyId } }),
    ])).resolves.toEqual(before);
  });

  test('allows one stale-version writer and rejects the competing writer', async () => {
    const income = await prisma.income.create({
      data: { familyId, createdBy: userId, category: 'VERSIONED', amount: 1, date: new Date() },
    });
    const [first, second] = await Promise.all([
      prisma.income.updateMany({ where: { id: income.id, familyId, version: 1 }, data: { version: { increment: 1 } } }),
      prisma.income.updateMany({ where: { id: income.id, familyId, version: 1 }, data: { version: { increment: 1 } } }),
    ]);
    expect([first.count, second.count].sort()).toEqual([0, 1]);
  });
});
