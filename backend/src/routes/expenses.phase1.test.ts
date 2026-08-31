import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

jest.mock('../db/prisma', () => {
  const model = () => ({
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  });

  return {
    prisma: {
      familyMember: model(),
      expense: model(),
    },
  };
});

jest.mock('../services/ledgerApplicationService', () => ({
  createExpense: jest.fn(),
  updateExpense: jest.fn(),
  deleteExpense: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { DomainError } from '../services/ledgerErrors';
import * as ledgerApplicationService from '../services/ledgerApplicationService';
import expensesRoutes from './expenses';

const mockedPrisma = prisma as unknown as {
  familyMember: { findUnique: jest.Mock };
  expense: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

const mockedLedger = ledgerApplicationService as unknown as {
  createExpense: jest.Mock;
  updateExpense: jest.Mock;
  deleteExpense: jest.Mock;
};

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/expenses', expensesRoutes);

const tokenFor = (userId = 'member-1') => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Member' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const expenseBody = {
  amount: 88,
  category: '餐饮',
  description: '午餐',
  date: '2026-08-28T04:00:00.000Z',
  paymentMethod: '银行卡',
  currency: 'CNY',
};

const expensePayload = {
  amount: expenseBody.amount,
  category: expenseBody.category,
  description: expenseBody.description,
  paymentMethod: expenseBody.paymentMethod,
  currency: expenseBody.currency,
};

describe('Phase 1 expense route adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'family-1',
      userId: 'member-1',
      role: 'member',
    });
    mockedLedger.createExpense.mockResolvedValue({
      operationId: 'operation-expense-create',
      resourceId: 'expense-1',
      record: { id: 'expense-1', ...expenseBody, version: 1 },
      version: 1,
      deduplicated: false,
    });
    mockedLedger.updateExpense.mockResolvedValue({
      operationId: 'operation-expense-update',
      resourceId: 'expense-1',
      record: { id: 'expense-1', ...expenseBody, version: 8 },
      version: 8,
      deduplicated: false,
    });
    mockedLedger.deleteExpense.mockResolvedValue({
      operationId: 'operation-expense-delete',
      resourceId: 'expense-1',
      version: 8,
      deduplicated: false,
    });
  });

  test('creates an expense through Ledger and preserves the compatible enriched response', async () => {
    const response = await request(app)
      .post('/api/families/family-1/expenses')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'expense-create-1')
      .send(expenseBody);

    expect(response.status).toBe(201);
    expect(mockedLedger.createExpense).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorId: 'member-1',
      source: 'MANUAL',
      idempotencyKey: 'expense-create-1',
      effectiveDate: new Date(expenseBody.date),
      payload: expensePayload,
    }, expect.any(Object));
    expect(mockedPrisma.expense.create).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      id: 'expense-1',
      version: 1,
      operationId: 'operation-expense-create',
      deduplicated: false,
    });
  });

  test('marks a replayed expense mutation with the Idempotency-Replayed header', async () => {
    mockedLedger.createExpense.mockResolvedValue({
      operationId: 'operation-expense-create',
      resourceId: 'expense-1',
      record: { id: 'expense-1', ...expenseBody, version: 1 },
      version: 1,
      deduplicated: true,
    });

    const response = await request(app)
      .post('/api/families/family-1/expenses')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'expense-replay-1')
      .send(expenseBody);

    expect(response.status).toBe(201);
    expect(response.headers['idempotency-replayed']).toBe('true');
    expect(response.body.deduplicated).toBe(true);
  });

  test('returns the stable validation contract for a malformed expense before Ledger', async () => {
    const response = await request(app)
      .post('/api/families/family-1/expenses')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'expense-invalid-1')
      .send({ ...expenseBody, amount: 0 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      retryable: false,
    });
    expect(mockedLedger.createExpense).not.toHaveBeenCalled();
    expect(mockedPrisma.expense.create).not.toHaveBeenCalled();
  });

  test('updates an expense through Ledger using If-Match as the expected version', async () => {
    const response = await request(app)
      .put('/api/families/family-1/expenses/expense-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'expense-update-1')
      .set('If-Match', '7')
      .send(expenseBody);

    expect(response.status).toBe(200);
    expect(mockedLedger.updateExpense).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorId: 'member-1',
      source: 'MANUAL',
      idempotencyKey: 'expense-update-1',
      expenseId: 'expense-1',
      expectedVersion: 7,
      effectiveDate: new Date(expenseBody.date),
      payload: expensePayload,
    }, expect.any(Object));
    expect(mockedPrisma.expense.update).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      id: 'expense-1',
      version: 8,
      operationId: 'operation-expense-update',
      deduplicated: false,
    });
  });

  test('deletes an expense through Ledger using If-Match as the expected version', async () => {
    const response = await request(app)
      .delete('/api/families/family-1/expenses/expense-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'expense-delete-1')
      .set('If-Match', '8');

    expect(response.status).toBe(200);
    expect(mockedLedger.deleteExpense).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorId: 'member-1',
      source: 'MANUAL',
      idempotencyKey: 'expense-delete-1',
      expenseId: 'expense-1',
      expectedVersion: 8,
      effectiveDate: expect.any(Date),
    }, expect.any(Object));
    expect(mockedPrisma.expense.delete).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      message: '删除成功',
      operationId: 'operation-expense-delete',
      version: 8,
      deduplicated: false,
    });
  });

  test.each([
    ['non-member', null],
    ['viewer', { familyId: 'family-1', userId: 'member-1', role: 'viewer' }],
  ])('rejects a %s before Ledger or a direct expense write', async (_label, membership) => {
    mockedPrisma.familyMember.findUnique.mockResolvedValue(membership);

    const response = await request(app)
      .post('/api/families/family-1/expenses')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'expense-forbidden-1')
      .send(expenseBody);

    expect(response.status).toBe(403);
    expect(mockedLedger.createExpense).not.toHaveBeenCalled();
    expect(mockedPrisma.expense.create).not.toHaveBeenCalled();
  });

  test('returns the stable stale-version error without a direct expense update', async () => {
    mockedLedger.updateExpense.mockRejectedValue(new DomainError(
      'VERSION_CONFLICT',
      'The expense was changed by another request.',
      409,
    ));

    const response = await request(app)
      .put('/api/families/family-1/expenses/expense-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'expense-stale-1')
      .set('If-Match', '7')
      .send(expenseBody);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'The expense was changed by another request.',
      code: 'VERSION_CONFLICT',
      retryable: false,
    });
    expect(mockedPrisma.expense.update).not.toHaveBeenCalled();
  });
});
