import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

const recurringStore = { name: 'recurring-store' };
const executeRecurring = jest.fn();

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    recurringTransaction: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    income: { create: jest.fn() },
    expense: { create: jest.fn() },
  },
}));

jest.mock('../services/recurringService', () => ({
  executeRecurring: (...args: unknown[]) => executeRecurring(...args),
}));

jest.mock('../services/prismaRecurringExecutionStore', () => ({
  createPrismaRecurringExecutionStore: jest.fn(() => recurringStore),
}));

import { prisma } from '../db/prisma';
import { DomainError } from '../services/ledgerErrors';
import recurringRoutes from './recurring';

const mockedPrisma = prisma as any;
const app = express();
app.use(express.json());
app.use('/api/families/:familyId/recurring', recurringRoutes);

const token = jwt.sign(
  { userId: 'user-1', email: 'user-1@example.test', name: 'User One' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

describe('Recurring Phase 1 HTTP adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'family-1',
      userId: 'user-1',
      role: 'member',
    });
  });

  test('routes execution through the recurring application service without direct ledger writes', async () => {
    executeRecurring.mockResolvedValue({
      executionId: 'execution-1',
      operationId: 'operation-1',
      resourceId: 'execution-1',
      record: { id: 'execution-1', status: 'COMMITTED' },
      version: 2,
      deduplicated: false,
      entryId: 'income-1',
      entryRecord: { id: 'income-1', amount: 100, category: 'SALARY' },
      nextDate: new Date('2026-10-01T00:00:00.000Z'),
      isActive: true,
    });

    const response = await request(app)
      .post('/api/families/family-1/recurring/recurring-1/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'execute-recurring-1')
      .send({ scheduledFor: '2026-09-01T00:00:00.000Z' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      executionId: 'execution-1',
      operationId: 'operation-1',
      resourceId: 'income-1',
      entryId: 'income-1',
      deduplicated: false,
      isActive: true,
    });
    expect(executeRecurring).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorId: 'user-1',
      recurringId: 'recurring-1',
      idempotencyKey: 'execute-recurring-1',
      scheduledFor: new Date('2026-09-01T00:00:00.000Z'),
      now: expect.any(Date),
    }, recurringStore);
    expect(mockedPrisma.recurringTransaction.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.income.create).not.toHaveBeenCalled();
    expect(mockedPrisma.expense.create).not.toHaveBeenCalled();
    expect(mockedPrisma.recurringTransaction.update).not.toHaveBeenCalled();
  });

  test('exposes replay and stable recurring domain errors', async () => {
    executeRecurring.mockResolvedValueOnce({
      executionId: 'execution-1',
      operationId: 'operation-1',
      resourceId: 'execution-1',
      record: { id: 'execution-1', status: 'COMMITTED' },
      version: 2,
      deduplicated: true,
      entryId: 'expense-1',
      entryRecord: { id: 'expense-1', amount: 20, category: 'FOOD' },
      nextDate: new Date('2026-10-01T00:00:00.000Z'),
      isActive: true,
    });

    const replay = await request(app)
      .post('/api/families/family-1/recurring/recurring-1/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'execute-recurring-replay');

    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.deduplicated).toBe(true);

    executeRecurring.mockRejectedValueOnce(new DomainError(
      'RULE_INACTIVE',
      'The recurring rule is inactive.',
      409,
    ));

    const inactive = await request(app)
      .post('/api/families/family-1/recurring/recurring-1/execute')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'execute-recurring-inactive');

    expect(inactive.status).toBe(409);
    expect(inactive.body).toMatchObject({
      code: 'RULE_INACTIVE',
      retryable: false,
    });
  });

  test('soft-deletes a recurring rule so execution history remains referentially valid', async () => {
    mockedPrisma.recurringTransaction.findFirst.mockResolvedValue({
      id: 'recurring-1',
      familyId: 'family-1',
      isActive: true,
    });
    mockedPrisma.recurringTransaction.updateMany.mockResolvedValue({ count: 1 });

    const response = await request(app)
      .delete('/api/families/family-1/recurring/recurring-1')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(mockedPrisma.recurringTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'recurring-1', familyId: 'family-1' },
      data: {
        isActive: false,
        deletedAt: expect.any(Date),
        version: { increment: 1 },
      },
    });
    expect(mockedPrisma.recurringTransaction.delete).not.toHaveBeenCalled();
  });

  test('does not return tombstoned recurring rules in the active rule list', async () => {
    mockedPrisma.recurringTransaction.findMany.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/families/family-1/recurring')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(mockedPrisma.recurringTransaction.findMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });
});
