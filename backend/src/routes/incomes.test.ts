import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import incomeRoutes from './incomes';

jest.mock('../app', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    income: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/incomes', incomeRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Income Routes - V3.3.3 投资收益结构化', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
  });

  describe('POST /api/families/:familyId/incomes', () => {
    test('创建 Income 支持 incomeType 和 assetId 字段', async () => {
      const created = {
        id: 'i1',
        familyId: 'fam_1',
        category: '股息',
        amount: 500,
        description: '茅台分红',
        date: new Date('2026-08-19'),
        incomeType: 'DIVIDEND',
        assetId: 'a1',
        createdBy: 'user_1',
      };
      mockedPrisma.income.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/families/fam_1/incomes')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          amount: 500,
          category: '股息',
          description: '茅台分红',
          date: '2026-08-19',
          incomeType: 'DIVIDEND',
          assetId: 'a1',
        });

      expect(res.status).toBe(201);
      expect(res.body.incomeType).toBe('DIVIDEND');
      expect(res.body.assetId).toBe('a1');
      expect(mockedPrisma.income.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 500,
          category: '股息',
          description: '茅台分红',
          incomeType: 'DIVIDEND',
          assetId: 'a1',
          familyId: 'fam_1',
          createdBy: 'user_1',
        }),
      });
    });

    test('incomeType 为非法枚举值返回 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/incomes')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          amount: 100,
          category: 'test',
          date: '2026-08-19',
          incomeType: 'INVALID',
        });

      expect(res.status).toBe(400);
      expect(mockedPrisma.income.create).not.toHaveBeenCalled();
    });

    test('不带 incomeType/assetId 也能创建（向后兼容）', async () => {
      mockedPrisma.income.create.mockResolvedValue({
        id: 'i2',
        familyId: 'fam_1',
        category: '工资',
        amount: 5000,
        date: new Date('2026-08-19'),
        incomeType: null,
        assetId: null,
      });

      const res = await request(app)
        .post('/api/families/fam_1/incomes')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          amount: 5000,
          category: '工资',
          date: '2026-08-19',
        });

      expect(res.status).toBe(201);
      expect(mockedPrisma.income.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 5000,
          category: '工资',
          familyId: 'fam_1',
        }),
      });
      // data 不应包含 incomeType / assetId（未提供时）
      const callArgs = mockedPrisma.income.create.mock.calls[0][0].data;
      expect(callArgs.incomeType).toBeUndefined();
      expect(callArgs.assetId).toBeUndefined();
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/incomes')
        .send({ amount: 100, category: 'x', date: '2026-08-19' });

      expect(res.status).toBe(401);
    });

    test('非家庭成员返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/incomes')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ amount: 100, category: 'x', date: '2026-08-19' });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/families/:familyId/incomes/:id', () => {
    test('更新 Income 支持 incomeType 和 assetId 字段', async () => {
      mockedPrisma.income.findUnique.mockResolvedValue({
        id: 'i1',
        familyId: 'fam_1',
        category: '股息',
        amount: 500,
      });
      mockedPrisma.income.update.mockResolvedValue({
        id: 'i1',
        familyId: 'fam_1',
        category: '股息',
        amount: 500,
        description: '茅台分红',
        date: new Date('2026-08-19'),
        incomeType: 'DIVIDEND',
        assetId: 'a1',
      });

      const res = await request(app)
        .put('/api/families/fam_1/incomes/i1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          amount: 500,
          category: '股息',
          description: '茅台分红',
          date: '2026-08-19',
          incomeType: 'DIVIDEND',
          assetId: 'a1',
        });

      expect(res.status).toBe(200);
      expect(res.body.incomeType).toBe('DIVIDEND');
      expect(res.body.assetId).toBe('a1');
      expect(mockedPrisma.income.update).toHaveBeenCalledWith({
        where: { id: 'i1' },
        data: expect.objectContaining({
          incomeType: 'DIVIDEND',
          assetId: 'a1',
        }),
      });
    });

    test('记录不存在返回 404', async () => {
      mockedPrisma.income.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/incomes/i99')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ amount: 100, category: 'x', date: '2026-08-19' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/families/:familyId/incomes', () => {
    test('列表返回 incomeType 和 assetId 字段', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        {
          id: 'i1',
          familyId: 'fam_1',
          category: '股息',
          amount: 500,
          date: new Date('2026-08-19'),
          incomeType: 'DIVIDEND',
          assetId: 'a1',
        },
        {
          id: 'i2',
          familyId: 'fam_1',
          category: '工资',
          amount: 5000,
          date: new Date('2026-08-19'),
          incomeType: 'SALARY',
          assetId: null,
        },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/incomes')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].incomeType).toBe('DIVIDEND');
      expect(res.body[0].assetId).toBe('a1');
      expect(res.body[1].incomeType).toBe('SALARY');
      expect(res.body[1].assetId).toBeNull();
    });

    test('支持 incomeType=DIVIDEND 查询参数筛选', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        {
          id: 'i1',
          familyId: 'fam_1',
          category: '股息',
          amount: 500,
          incomeType: 'DIVIDEND',
          assetId: 'a1',
        },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/incomes?incomeType=DIVIDEND')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].incomeType).toBe('DIVIDEND');
      // 验证 where 子句包含 incomeType 筛选
      expect(mockedPrisma.income.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          familyId: 'fam_1',
          incomeType: 'DIVIDEND',
        }),
        orderBy: { date: 'desc' },
      });
    });

    test('不带 incomeType 参数时不筛选（向后兼容）', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/incomes')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      const callArgs = mockedPrisma.income.findMany.mock.calls[0][0];
      expect(callArgs.where.incomeType).toBeUndefined();
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/incomes');

      expect(res.status).toBe(401);
    });
  });
});
