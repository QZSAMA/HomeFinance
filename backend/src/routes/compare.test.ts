import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import compareRoutes from './compare';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findMany: jest.fn(),
    },
    asset: { findMany: jest.fn() },
    liability: { findMany: jest.fn() },
    income: { findMany: jest.fn() },
    expense: { findMany: jest.fn() },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/compare', compareRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Compare Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/compare/summary', () => {
    test('returns comparison data for all families of the user', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([
        { familyId: 'fam_1', family: { id: 'fam_1', name: '张家' } },
        { familyId: 'fam_2', family: { id: 'fam_2', name: '李家' } },
      ]);
      // fam_1: assets 100k, liabilities 30k, this month income 15k, expense 8k
      mockedPrisma.asset.findMany
        .mockResolvedValueOnce([{ value: 100000 }])
        .mockResolvedValueOnce([{ value: 50000 }]);
      mockedPrisma.liability.findMany
        .mockResolvedValueOnce([{ amount: 30000 }])
        .mockResolvedValueOnce([{ amount: 10000 }]);
      mockedPrisma.income.findMany
        .mockResolvedValueOnce([{ amount: 15000 }])
        .mockResolvedValueOnce([{ amount: 8000 }]);
      mockedPrisma.expense.findMany
        .mockResolvedValueOnce([{ amount: 8000 }])
        .mockResolvedValueOnce([{ amount: 5000 }]);

      const res = await request(app)
        .get('/api/compare/summary')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toEqual({
        familyId: 'fam_1',
        familyName: '张家',
        totalAssets: 100000,
        totalLiabilities: 30000,
        netWorth: 70000,
        thisMonthIncome: 15000,
        thisMonthExpense: 8000,
      });
      expect(res.body[1]).toEqual({
        familyId: 'fam_2',
        familyName: '李家',
        totalAssets: 50000,
        totalLiabilities: 10000,
        netWorth: 40000,
        thisMonthIncome: 8000,
        thisMonthExpense: 5000,
      });
    });

    test('returns empty array when user has no families', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/compare/summary')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(mockedPrisma.asset.findMany).not.toHaveBeenCalled();
    });

    test('returns 401 without token', async () => {
      const res = await request(app).get('/api/compare/summary');
      expect(res.status).toBe(401);
    });

    test('handles family with no transactions (zeros)', async () => {
      mockedPrisma.familyMember.findMany.mockResolvedValue([
        { familyId: 'fam_1', family: { id: 'fam_1', name: '空家庭' } },
      ]);
      mockedPrisma.asset.findMany.mockResolvedValue([]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      mockedPrisma.income.findMany.mockResolvedValue([]);
      mockedPrisma.expense.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/compare/summary')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body[0]).toEqual({
        familyId: 'fam_1',
        familyName: '空家庭',
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        thisMonthIncome: 0,
        thisMonthExpense: 0,
      });
    });
  });
});
