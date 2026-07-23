import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import importRoutes from './import';

jest.mock('../app', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    income: { create: jest.fn() },
    expense: { create: jest.fn() },
  },
}));

jest.mock('../services/importService', () => ({
  parseCSV: jest.fn(),
}));

import { prisma } from '../app';
import { parseCSV } from '../services/importService';

const mockedPrisma = prisma as any;
const mockedParseCSV = parseCSV as jest.MockedFunction<typeof parseCSV>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/import', importRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

const ALIPAY_CSV = '交易号,交易时间,交易分类,金额,交易状态\n1,2026-07-01 10:00:00,餐饮,35,交易成功';
const WECHAT_CSV = '交易时间,交易类型,交易对方,金额\n2026-07-01 10:00:00,微信红包,张三,200';

describe('Import Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
  });

  describe('POST /api/families/:familyId/import/csv', () => {
    test('parses alipay CSV and returns preview', async () => {
      mockedParseCSV.mockResolvedValue([
        { date: '2026-07-01', description: '餐饮消费', amount: 35, type: 'EXPENSE', category: '餐饮' },
      ]);

      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'alipay')
        .attach('file', Buffer.from(ALIPAY_CSV), 'alipay.csv');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].amount).toBe(35);
      expect(mockedParseCSV).toHaveBeenCalledWith(expect.any(Buffer), 'alipay');
    });

    test('parses wechat CSV and returns preview', async () => {
      mockedParseCSV.mockResolvedValue([
        { date: '2026-07-01', description: '微信红包', amount: 200, type: 'INCOME' },
      ]);

      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'wechat')
        .attach('file', Buffer.from(WECHAT_CSV), 'wechat.csv');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].amount).toBe(200);
      expect(mockedParseCSV).toHaveBeenCalledWith(expect.any(Buffer), 'wechat');
    });

    test('rejects missing file with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'alipay');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockedParseCSV).not.toHaveBeenCalled();
    });

    test('rejects invalid format with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'other')
        .attach('file', Buffer.from(ALIPAY_CSV), 'alipay.csv');

      expect(res.status).toBe(400);
      expect(mockedParseCSV).not.toHaveBeenCalled();
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .field('format', 'alipay')
        .attach('file', Buffer.from(ALIPAY_CSV), 'alipay.csv');

      expect(res.status).toBe(401);
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'alipay')
        .attach('file', Buffer.from(ALIPAY_CSV), 'alipay.csv');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/families/:familyId/import/confirm', () => {
    test('creates income/expense records and returns success count', async () => {
      mockedPrisma.income.create.mockResolvedValue({});
      mockedPrisma.expense.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          items: [
            { date: '2026-07-01', description: '工资', amount: 15000, type: 'INCOME', category: '工资' },
            { date: '2026-07-02', description: '餐饮', amount: 35, type: 'EXPENSE', category: '餐饮' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.successCount).toBe(2);
      expect(res.body.failedRows).toEqual([]);
      expect(mockedPrisma.income.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.expense.create).toHaveBeenCalledTimes(1);
    });

    test('returns failedRows for invalid items', async () => {
      mockedPrisma.expense.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          items: [
            { date: '2026-07-01', description: '餐饮', amount: 35, type: 'EXPENSE', category: '餐饮' },
            { date: '2026-07-02', description: '缺金额', type: 'EXPENSE' },
            { date: '2026-07-03', description: '类型错误', amount: 10, type: 'UNKNOWN' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.successCount).toBe(1);
      expect(res.body.failedRows).toHaveLength(2);
      expect(res.body.failedRows[0].row).toBe(2);
      expect(res.body.failedRows[0].errors).toBeDefined();
      expect(res.body.failedRows[1].row).toBe(3);
      expect(mockedPrisma.expense.create).toHaveBeenCalledTimes(1);
    });

    test('returns empty failedRows when all valid', async () => {
      mockedPrisma.income.create.mockResolvedValue({});
      mockedPrisma.expense.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          items: [
            { date: '2026-07-01', description: '工资', amount: 5000, type: 'INCOME' },
            { date: '2026-07-02', description: '交通', amount: 20, type: 'EXPENSE' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.successCount).toBe(2);
      expect(res.body.failedRows).toEqual([]);
    });

    test('rejects empty items with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ items: [] });

      expect(res.status).toBe(400);
      expect(mockedPrisma.income.create).not.toHaveBeenCalled();
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .send({ items: [{ date: '2026-07-01', description: 'x', amount: 1, type: 'EXPENSE' }] });

      expect(res.status).toBe(401);
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ items: [{ date: '2026-07-01', description: 'x', amount: 1, type: 'EXPENSE' }] });

      expect(res.status).toBe(403);
    });
  });
});
