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
      income: model(),
    },
  };
});

jest.mock('../services/ledgerApplicationService', () => ({
  createIncome: jest.fn(),
  updateIncome: jest.fn(),
  deleteIncome: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { DomainError } from '../services/ledgerErrors';
import * as ledgerApplicationService from '../services/ledgerApplicationService';
import incomesRoutes from './incomes';

const mockedPrisma = prisma as unknown as {
  familyMember: { findUnique: jest.Mock };
  income: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

const mockedLedger = ledgerApplicationService as unknown as {
  createIncome: jest.Mock;
  updateIncome: jest.Mock;
  deleteIncome: jest.Mock;
};

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/incomes', incomesRoutes);

const tokenFor = (userId = 'member-1') => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Member' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const incomeBody = {
  amount: 1250.5,
  category: '工资',
  description: '八月工资',
  date: '2026-08-28T00:00:00.000Z',
  source: '雇主转账',
  currency: 'CNY',
};

const incomePayload = {
  amount: incomeBody.amount,
  category: incomeBody.category,
  description: incomeBody.description,
  source: incomeBody.source,
  currency: incomeBody.currency,
};

describe('Phase 1 income route adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'family-1',
      userId: 'member-1',
      role: 'member',
    });
    mockedLedger.createIncome.mockResolvedValue({
      operationId: 'operation-income-create',
      resourceId: 'income-1',
      record: { id: 'income-1', ...incomeBody, version: 1 },
      version: 1,
      deduplicated: false,
    });
    mockedLedger.updateIncome.mockResolvedValue({
      operationId: 'operation-income-update',
      resourceId: 'income-1',
      record: { id: 'income-1', ...incomeBody, version: 8 },
      version: 8,
      deduplicated: false,
    });
    mockedLedger.deleteIncome.mockResolvedValue({
      operationId: 'operation-income-delete',
      resourceId: 'income-1',
      version: 8,
      deduplicated: false,
    });
  });

  test('creates an income through Ledger and preserves the compatible enriched response', async () => {
    const response = await request(app)
      .post('/api/families/family-1/incomes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'income-create-1')
      .send(incomeBody);

    expect(response.status).toBe(201);
    expect(mockedLedger.createIncome).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorId: 'member-1',
      source: 'MANUAL',
      idempotencyKey: 'income-create-1',
      effectiveDate: new Date(incomeBody.date),
      payload: incomePayload,
    }, expect.any(Object));
    expect(mockedPrisma.income.create).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      id: 'income-1',
      version: 1,
      operationId: 'operation-income-create',
      deduplicated: false,
    });
  });

  test('marks a replayed income mutation with the Idempotency-Replayed header', async () => {
    mockedLedger.createIncome.mockResolvedValue({
      operationId: 'operation-income-create',
      resourceId: 'income-1',
      record: { id: 'income-1', ...incomeBody, version: 1 },
      version: 1,
      deduplicated: true,
    });

    const response = await request(app)
      .post('/api/families/family-1/incomes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'income-replay-1')
      .send(incomeBody);

    expect(response.status).toBe(201);
    expect(response.headers['idempotency-replayed']).toBe('true');
    expect(response.body.deduplicated).toBe(true);
  });

  test('returns the stable validation contract for a malformed income before Ledger', async () => {
    const response = await request(app)
      .post('/api/families/family-1/incomes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'income-invalid-1')
      .send({ ...incomeBody, amount: 0 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      retryable: false,
    });
    expect(mockedLedger.createIncome).not.toHaveBeenCalled();
    expect(mockedPrisma.income.create).not.toHaveBeenCalled();
  });

  test('updates an income through Ledger using If-Match as the expected version', async () => {
    const response = await request(app)
      .put('/api/families/family-1/incomes/income-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'income-update-1')
      .set('If-Match', '7')
      .send(incomeBody);

    expect(response.status).toBe(200);
    expect(mockedLedger.updateIncome).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorId: 'member-1',
      source: 'MANUAL',
      idempotencyKey: 'income-update-1',
      incomeId: 'income-1',
      expectedVersion: 7,
      effectiveDate: new Date(incomeBody.date),
      payload: incomePayload,
    }, expect.any(Object));
    expect(mockedPrisma.income.update).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      id: 'income-1',
      version: 8,
      operationId: 'operation-income-update',
      deduplicated: false,
    });
  });

  test('deletes an income through Ledger using If-Match as the expected version', async () => {
    const response = await request(app)
      .delete('/api/families/family-1/incomes/income-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'income-delete-1')
      .set('If-Match', '8');

    expect(response.status).toBe(200);
    expect(mockedLedger.deleteIncome).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorId: 'member-1',
      source: 'MANUAL',
      idempotencyKey: 'income-delete-1',
      incomeId: 'income-1',
      expectedVersion: 8,
      effectiveDate: expect.any(Date),
    }, expect.any(Object));
    expect(mockedPrisma.income.delete).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      message: '删除成功',
      operationId: 'operation-income-delete',
      version: 8,
      deduplicated: false,
    });
  });

  test.each([
    ['non-member', null],
    ['viewer', { familyId: 'family-1', userId: 'member-1', role: 'viewer' }],
  ])('rejects a %s before Ledger or a direct income write', async (_label, membership) => {
    mockedPrisma.familyMember.findUnique.mockResolvedValue(membership);

    const response = await request(app)
      .post('/api/families/family-1/incomes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'income-forbidden-1')
      .send(incomeBody);

    expect(response.status).toBe(403);
    expect(mockedLedger.createIncome).not.toHaveBeenCalled();
    expect(mockedPrisma.income.create).not.toHaveBeenCalled();
  });

  test('returns the stable stale-version error without a direct income update', async () => {
    mockedLedger.updateIncome.mockRejectedValue(new DomainError(
      'VERSION_CONFLICT',
      'The income was changed by another request.',
      409,
    ));

    const response = await request(app)
      .put('/api/families/family-1/incomes/income-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'income-stale-1')
      .set('If-Match', '7')
      .send(incomeBody);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'The income was changed by another request.',
      code: 'VERSION_CONFLICT',
      retryable: false,
    });
    expect(mockedPrisma.income.update).not.toHaveBeenCalled();
  });
});
