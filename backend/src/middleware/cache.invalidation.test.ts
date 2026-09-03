import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    family: {
      findUnique: jest.fn(),
    },
    asset: {
      findMany: jest.fn(),
    },
    liability: {
      findMany: jest.fn(),
    },
    income: {
      findMany: jest.fn(),
    },
    expense: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('../config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    isReady: true,
  },
}));

jest.mock('../services/ledgerApplicationService', () => ({
  createExpense: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { redisClient } from '../config/redis';
import * as ledgerApplicationService from '../services/ledgerApplicationService';
import expenseRoutes from '../routes/expenses';
import reportRoutes from '../routes/reports';

const mockedPrisma = prisma as any;
const mockedRedis = redisClient as any;
const mockedLedger = ledgerApplicationService as unknown as { createExpense: jest.Mock };

function createToken(userId: string) {
  return jwt.sign(
    { userId, email: `${userId}@example.com`, name: userId },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' },
  );
}

describe('report cache invalidation', () => {
  test('recomputes a warmed family summary immediately after a member creates an expense', async () => {
    const familyId = 'family-cache-consistency';
    const memberId = 'member-cache-consistency';
    const summaryUrl = `/api/families/${familyId}/reports/summary`;
    const token = createToken(memberId);
    const cacheStore = new Map<string, string>();
    let cacheVersion = 0;
    const expenses: Array<{
      id: string;
      familyId: string;
      createdBy: string;
      category: string;
      amount: number;
      description: string | null;
      paymentMethod: string | null;
      date: Date;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    mockedRedis.isReady = true;
    mockedRedis.get.mockImplementation(async (key: string) => cacheStore.get(key) ?? null);
    mockedRedis.setEx.mockImplementation(async (key: string, _ttl: number, value: string) => {
      cacheStore.set(key, value);
      return 'OK';
    });
    mockedRedis.del.mockImplementation(async (...keys: string[]) => {
      let deleted = 0;
      keys.forEach((key) => {
        if (cacheStore.delete(key)) deleted += 1;
      });
      return deleted;
    });
    mockedRedis.incr.mockImplementation(async (key: string) => {
      const nextValue = Number(cacheStore.get(key) ?? '0') + 1;
      cacheStore.set(key, String(nextValue));
      return nextValue;
    });

    mockedPrisma.familyMember.findUnique.mockImplementation(async () => ({
      id: 'membership-cache-consistency',
      familyId,
      userId: memberId,
      role: 'member',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      family: { cacheVersion },
    }));
    mockedPrisma.family.findUnique.mockResolvedValue({ timezone: 'Asia/Shanghai', baseCurrency: 'CNY' });
    mockedPrisma.asset.findMany.mockResolvedValue([]);
    mockedPrisma.liability.findMany.mockResolvedValue([]);
    mockedPrisma.income.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockImplementation(async ({ where }: any) => {
      const lowerBound = where.date?.gte?.getTime() ?? Number.NEGATIVE_INFINITY;
      const upperBound = where.date?.lt?.getTime() ?? Number.POSITIVE_INFINITY;

      return expenses.filter((expense) => (
        expense.familyId === where.familyId
        && expense.date.getTime() >= lowerBound
        && expense.date.getTime() < upperBound
      ));
    });
    mockedLedger.createExpense.mockImplementation(async (command: any) => {
      const now = new Date();
      const expense = {
        id: `expense-${expenses.length + 1}`,
        familyId: command.familyId,
        createdBy: command.actorId,
        category: command.payload.category,
        amount: command.payload.amount,
        description: command.payload.description ?? null,
        paymentMethod: command.payload.paymentMethod ?? null,
        date: command.effectiveDate,
        createdAt: now,
        updatedAt: now,
      };
      expenses.push(expense);
      cacheVersion += 1;
      return {
        operationId: `operation-${expense.id}`,
        resourceId: expense.id,
        record: { ...expense, version: 1 },
        version: 1,
        deduplicated: false,
      };
    });

    const app = express();
    app.use(express.json());
    app.use('/api/families/:familyId/reports', reportRoutes);
    app.use('/api/families/:familyId/expenses', expenseRoutes);

    const warmedResponse = await request(app)
      .get(summaryUrl)
      .set('Authorization', `Bearer ${token}`);

    expect(warmedResponse.status).toBe(200);
    expect(warmedResponse.headers['x-cache']).toBe('MISS');
    expect(warmedResponse.body.incomeStatement.thisMonthExpense).toBe(0);

    const cachedResponse = await request(app)
      .get(summaryUrl)
      .set('Authorization', `Bearer ${token}`);

    expect(cachedResponse.status).toBe(200);
    expect(cachedResponse.headers['x-cache']).toBe('HIT');

    const createResponse = await request(app)
      .post(`/api/families/${familyId}/expenses`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 125,
        category: 'FOOD',
        description: 'cache invalidation fixture',
        date: new Date().toISOString(),
        paymentMethod: 'CARD',
      });

    expect(createResponse.status).toBe(201);
    expect(expenses).toHaveLength(1);
    expect(mockedLedger.createExpense).toHaveBeenCalledTimes(1);

    const refreshedResponse = await request(app)
      .get(summaryUrl)
      .set('Authorization', `Bearer ${token}`);

    expect({
      cacheStatus: refreshedResponse.headers['x-cache'],
      thisMonthExpense: refreshedResponse.body.incomeStatement.thisMonthExpense,
    }).toEqual({
      cacheStatus: 'MISS',
      thisMonthExpense: 125,
    });

    const recachedResponse = await request(app)
      .get(summaryUrl)
      .set('Authorization', `Bearer ${token}`);
    expect(recachedResponse.headers['x-cache']).toBe('HIT');

    mockedRedis.isReady = false;
    const createDuringOutage = await request(app)
      .post(`/api/families/${familyId}/expenses`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 75,
        category: 'FOOD',
        description: 'redis recovery fixture',
        date: new Date().toISOString(),
        paymentMethod: 'CARD',
      });
    expect(createDuringOutage.status).toBe(201);

    mockedRedis.isReady = true;
    const afterRecovery = await request(app)
      .get(summaryUrl)
      .set('Authorization', `Bearer ${token}`);

    expect({
      cacheStatus: afterRecovery.headers['x-cache'],
      thisMonthExpense: afterRecovery.body.incomeStatement.thisMonthExpense,
    }).toEqual({
      cacheStatus: 'MISS',
      thisMonthExpense: 200,
    });
  });
});
