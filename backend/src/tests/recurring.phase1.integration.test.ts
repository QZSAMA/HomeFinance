import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import recurringRoutes from '../routes/recurring';
import {
  executeRecurring,
  ExecuteRecurringCommand,
  RecurringExecutionResult,
} from '../services/recurringService';
import { createPrismaRecurringExecutionStore } from '../services/prismaRecurringExecutionStore';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `p1-recurring-user-${runId}`;
const familyId = `p1-recurring-family-${runId}`;
const store = createPrismaRecurringExecutionStore(prisma);
const app = express();
app.use(express.json());
app.use('/api/families/:familyId/recurring', recurringRoutes);

const command = (recurringId: string, key: string, scheduledFor: Date): ExecuteRecurringCommand => ({
  familyId,
  actorId: userId,
  recurringId,
  idempotencyKey: key,
  scheduledFor,
  now: new Date('2026-09-01T12:00:00.000Z'),
});

const token = () => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Recurring Integration' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

describe('Phase 1 real PostgreSQL recurring exactly-once contracts', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${runId}@example.test`,
        passwordHash: 'integration-only',
        name: 'Recurring Integration',
      },
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Recurring Integration Family',
        members: { create: { userId, role: 'admin' } },
      },
    });
  });

  afterAll(async () => {
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('collapses twenty different-key requests for one occurrence into one ledger fact', async () => {
    const rule = await prisma.recurringTransaction.create({
      data: {
        familyId,
        createdBy: userId,
        type: 'INCOME',
        category: 'SALARY',
        amount: 100,
        frequency: 'MONTHLY',
        interval: 1,
        nextDate: new Date('2026-08-01T00:00:00.000Z'),
      },
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => executeRecurring(
        command(rule.id, `concurrent-${index}`, rule.nextDate),
        store,
      )),
    );

    expect(results).toHaveLength(20);
    expect(new Set(results.map((result) => result.resourceId)).size).toBe(1);
    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    expect(results.filter((result) => result.deduplicated)).toHaveLength(19);
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.recurringExecution.count({ where: { recurringTransactionId: rule.id } })).resolves.toBe(1);
    const execution = await prisma.recurringExecution.findFirstOrThrow({
      where: { recurringTransactionId: rule.id },
    });
    const executionAudit = await prisma.auditEvent.findFirstOrThrow({
      where: { familyId, entity: 'RecurringExecution', action: 'EXECUTE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(executionAudit.entityId).toBe(execution.id);
    expect(results[0] as RecurringExecutionResult & { entryId?: string }).toMatchObject({
      executionId: execution.id,
      entryId: execution.entryId,
    });
    await expect(prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rule.id } })).resolves.toMatchObject({
      nextDate: new Date('2026-09-01T00:00:00.000Z'),
      version: 2,
    });
  });

  test.each([
    ['inactive', { isActive: false }, 'RULE_INACTIVE'],
    ['future', { nextDate: new Date('2026-09-02T00:00:00.000Z') }, 'RECURRING_NOT_DUE'],
    ['after endDate', { endDate: new Date('2026-07-31T23:59:59.999Z') }, 'RECURRING_NOT_DUE'],
  ])('does not write an %s rule', async (_label, override, code) => {
    const rule = await prisma.recurringTransaction.create({
      data: {
        familyId,
        createdBy: userId,
        type: 'EXPENSE',
        category: 'FOOD',
        amount: 20,
        frequency: 'MONTHLY',
        interval: 1,
        nextDate: new Date('2026-08-01T00:00:00.000Z'),
        ...override,
      },
    });
    const before = await Promise.all([
      prisma.expense.count({ where: { familyId } }),
      prisma.recurringExecution.count({ where: { recurringTransactionId: rule.id } }),
    ]);

    await expect(executeRecurring(command(rule.id, `boundary-${rule.id}`, rule.nextDate), store)).rejects.toMatchObject({
      code,
      status: 409,
    });

    await expect(Promise.all([
      prisma.expense.count({ where: { familyId } }),
      prisma.recurringExecution.count({ where: { recurringTransactionId: rule.id } }),
    ])).resolves.toEqual(before);
    await expect(prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rule.id } })).resolves.toMatchObject({
      nextDate: 'nextDate' in override
        ? override.nextDate
        : new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  test('rolls back execution and ledger facts when rule advancement fails', async () => {
    const rule = await prisma.recurringTransaction.create({
      data: {
        familyId,
        createdBy: userId,
        type: 'INCOME',
        category: 'ROLLBACK',
        amount: 30,
        frequency: 'MONTHLY',
        interval: 1,
        nextDate: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
    const before = await Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.recurringExecution.count({ where: { recurringTransactionId: rule.id } }),
    ]);
    const failingStore = {
      ...store,
      $transaction: (work: (transaction: any) => Promise<unknown>) => store.$transaction(async (transaction: any) => work({
        ...transaction,
        recurringTransaction: {
          ...transaction.recurringTransaction,
          updateMany: async () => { throw new Error('forced recurring update failure'); },
        },
      })),
    };

    await expect(executeRecurring(command(rule.id, 'rollback-recurring', rule.nextDate), failingStore as any)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    });
    await expect(Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.recurringExecution.count({ where: { recurringTransactionId: rule.id } }),
    ])).resolves.toEqual(before);
  });

  test('tombstones a rule through HTTP while preserving its committed execution history', async () => {
    const rule = await prisma.recurringTransaction.create({
      data: {
        familyId,
        createdBy: userId,
        type: 'EXPENSE',
        category: 'RENT',
        amount: 50,
        frequency: 'MONTHLY',
        interval: 1,
        nextDate: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
    await executeRecurring(command(rule.id, 'soft-delete-history', rule.nextDate), store);
    const executionCount = await prisma.recurringExecution.count({
      where: { recurringTransactionId: rule.id },
    });

    const deleted = await request(app)
      .delete(`/api/families/${familyId}/recurring/${rule.id}`)
      .set('Authorization', `Bearer ${token()}`);

    expect(deleted.status).toBe(200);
    await expect(prisma.recurringTransaction.findUniqueOrThrow({ where: { id: rule.id } })).resolves.toMatchObject({
      isActive: false,
      deletedAt: expect.any(Date),
      version: 3,
    });
    await expect(prisma.recurringExecution.count({
      where: { recurringTransactionId: rule.id },
    })).resolves.toBe(executionCount);

    const listed = await request(app)
      .get(`/api/families/${familyId}/recurring`)
      .set('Authorization', `Bearer ${token()}`);
    expect(listed.status).toBe(200);
    expect(listed.body).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: rule.id }),
    ]));
  });
});
