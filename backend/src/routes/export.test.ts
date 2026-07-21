import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import exportRoutes from './export';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    income: {
      findMany: jest.fn(),
    },
    expense: {
      findMany: jest.fn(),
    },
    asset: {
      findMany: jest.fn(),
    },
    liability: {
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
app.use('/api/families/:familyId/export', exportRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Export Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.income.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.asset.findMany.mockResolvedValue([]);
    mockedPrisma.liability.findMany.mockResolvedValue([]);
  });

  describe('GET /api/families/:familyId/export/incomes', () => {
    test('returns an Excel file with correct Content-Type', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        {
          id: 'i1',
          familyId: 'fam_1',
          category: '工资',
          amount: 5000,
          description: 'July salary',
          date: new Date('2026-07-01'),
          source: 'company',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/export/incomes')
        .responseType('blob')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain(EXCEL_MIME);
      // Excel files are ZIP archives starting with PK signature (0x50 0x4B)
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toBe(0x50); // 'P'
      expect(res.body[1]).toBe(0x4b); // 'K'
    });

    test('returns 403 when user has no family access', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/export/incomes')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });

    test('passes date range filter to prisma query', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/export/incomes')
        .query({ startDate: '2026-07-01', endDate: '2026-07-31' })
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            familyId: 'fam_1',
            date: expect.objectContaining({
              gte: new Date('2026-07-01'),
              lte: new Date('2026-07-31'),
            }),
          }),
        })
      );
    });
  });

  describe('GET /api/families/:familyId/export/expenses', () => {
    test('returns an Excel file with correct Content-Type', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        {
          id: 'e1',
          familyId: 'fam_1',
          category: '餐饮',
          amount: 100,
          description: 'Lunch',
          date: new Date('2026-07-10'),
          paymentMethod: 'card',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/export/expenses')
        .responseType('blob')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain(EXCEL_MIME);
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toBe(0x50); // 'P'
      expect(res.body[1]).toBe(0x4b); // 'K'
    });

    test('returns 403 when user has no family access', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/export/expenses')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/families/:familyId/export/balance-sheet', () => {
    test('returns an Excel file with correct Content-Type', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          familyId: 'fam_1',
          name: 'Cash',
          type: '现金',
          category: 'CASH',
          value: 10000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([
        {
          id: 'l1',
          familyId: 'fam_1',
          name: 'Credit Card',
          type: '信用卡',
          amount: 3000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/export/balance-sheet')
        .responseType('blob')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain(EXCEL_MIME);
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toBe(0x50); // 'P'
      expect(res.body[1]).toBe(0x4b); // 'K'
    });

    test('returns 403 when user has no family access', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/export/balance-sheet')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });
});
