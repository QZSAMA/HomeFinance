import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import reportRoutes from './reports';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
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
    },
  },
}));

jest.mock('../middleware/cache', () => ({
  cacheMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/reports', reportRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Report Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.asset.findMany.mockResolvedValue([]);
    mockedPrisma.liability.findMany.mockResolvedValue([]);
    mockedPrisma.income.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
  });

  describe('GET /api/families/:familyId/reports/balance-sheet', () => {
    test('returns balance sheet with assets and liabilities', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', type: '现金', value: 10000, description: 'Cash', createdAt: new Date() },
        { id: 'a2', type: '股票', value: 50000, description: 'Stocks', createdAt: new Date() },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([
        { id: 'l1', type: '信用卡', amount: 3000, description: 'CC', createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/balance-sheet')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalAssets).toBe(60000);
      expect(res.body.totalLiabilities).toBe(3000);
      expect(res.body.netWorth).toBe(57000);
      expect(Object.keys(res.body.assets).length).toBe(2);
      expect(res.body.assetList).toHaveLength(2);
    });
  });

  describe('GET /api/families/:familyId/reports/income-statement', () => {
    test('returns income statement for current month', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 10000, description: 'Salary', date: new Date(), createdAt: new Date() },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 2000, description: 'Food', date: new Date(), createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/income-statement')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalIncome).toBe(10000);
      expect(res.body.totalExpense).toBe(2000);
      expect(res.body.netIncome).toBe(8000);
      expect(Object.keys(res.body.incomeByCategory).length).toBe(1);
      expect(Object.keys(res.body.expenseByCategory).length).toBe(1);
      expect(res.body.incomes).toHaveLength(1);
    });
  });

  describe('GET /api/families/:familyId/reports/cash-flow', () => {
    test('returns cash flow data', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 5000, date: today, createdAt: today },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 1000, date: today, createdAt: today },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/cash-flow')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.operating.income).toBe(5000);
      expect(res.body.operating.expense).toBe(1000);
      expect(res.body.operating.net).toBe(4000);
      expect(res.body.netCashFlow).toBe(4000);
    });
  });

  describe('GET /api/families/:familyId/reports/summary', () => {
    test('returns financial summary', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', type: '现金', value: 10000, createdAt: new Date() },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 8000, date: new Date(), createdAt: new Date() },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 3000, date: new Date(), createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/summary')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.balanceSheet.totalAssets).toBe(10000);
      expect(res.body.balanceSheet.totalLiabilities).toBe(0);
      expect(res.body.incomeStatement.thisMonthIncome).toBe(8000);
      expect(res.body.incomeStatement.thisMonthExpense).toBe(3000);
    });
  });
});
