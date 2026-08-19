import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import assetRoutes from './assets';

jest.mock('../app', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    asset: {
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
app.use('/api/families/:familyId/assets', assetRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Asset Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
  });

  describe('POST /api/families/:familyId/assets', () => {
    test('创建资产支持 symbol/quantity/unit 字段', async () => {
      const created = {
        id: 'a1',
        familyId: 'fam_1',
        name: '贵州茅台',
        type: 'STOCK',
        value: 0,
        currency: 'CNY',
        symbol: 'sh600519',
        quantity: 100,
        unit: '股',
        marketPrice: null,
        marketPriceDate: null,
      };
      mockedPrisma.asset.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/families/fam_1/assets')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          name: '贵州茅台',
          type: 'STOCK',
          value: 0,
          symbol: 'sh600519',
          quantity: 100,
          unit: '股',
        });

      expect(res.status).toBe(201);
      expect(res.body.symbol).toBe('sh600519');
      expect(res.body.quantity).toBe(100);
      expect(res.body.unit).toBe('股');
      expect(mockedPrisma.asset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '贵州茅台',
          type: 'STOCK',
          symbol: 'sh600519',
          quantity: 100,
          unit: '股',
          familyId: 'fam_1',
        }),
      });
    });

    test('创建资产不支持 quantity 为负数或零', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/assets')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          name: '无效',
          type: 'STOCK',
          value: 0,
          quantity: -10,
        });

      expect(res.status).toBe(400);
      expect(mockedPrisma.asset.create).not.toHaveBeenCalled();
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/assets')
        .send({ name: 'x', type: 'STOCK', value: 0 });

      expect(res.status).toBe(401);
    });

    test('非家庭成员返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/assets')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ name: 'x', type: 'STOCK', value: 0 });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/families/:familyId/assets/:id', () => {
    test('更新资产的 symbol 字段', async () => {
      mockedPrisma.asset.findUnique.mockResolvedValue({
        id: 'a1',
        familyId: 'fam_1',
        name: '茅台',
        type: 'STOCK',
        value: 0,
      });
      mockedPrisma.asset.update.mockResolvedValue({
        id: 'a1',
        familyId: 'fam_1',
        name: '茅台',
        type: 'STOCK',
        value: 0,
        symbol: 'sh600519',
        quantity: 100,
        unit: '股',
      });

      const res = await request(app)
        .put('/api/families/fam_1/assets/a1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          name: '茅台',
          type: 'STOCK',
          value: 0,
          symbol: 'sh600519',
          quantity: 100,
          unit: '股',
        });

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe('sh600519');
      expect(res.body.quantity).toBe(100);
      expect(mockedPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: expect.objectContaining({
          symbol: 'sh600519',
          quantity: 100,
          unit: '股',
        }),
      });
    });

    test('资产不存在返回 404', async () => {
      mockedPrisma.asset.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/assets/a1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ name: 'x', type: 'STOCK', value: 0 });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/families/:familyId/assets', () => {
    test('列表返回 symbol/marketPrice 字段', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          familyId: 'fam_1',
          name: '贵州茅台',
          type: 'STOCK',
          value: 0,
          symbol: 'sh600519',
          quantity: 100,
          unit: '股',
          marketPrice: 1810.5,
          marketPriceDate: new Date('2026-08-19T10:00:00Z'),
        },
        {
          id: 'a2',
          familyId: 'fam_1',
          name: '现金',
          type: 'CASH',
          value: 5000,
          symbol: null,
          quantity: null,
          unit: null,
          marketPrice: null,
          marketPriceDate: null,
        },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/assets')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].symbol).toBe('sh600519');
      expect(res.body[0].marketPrice).toBe(1810.5);
      expect(res.body[0].quantity).toBe(100);
      expect(res.body[1].symbol).toBeNull();
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/assets');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/families/:familyId/assets/allocation', () => {
    test('优先使用 marketPrice * quantity 计算价值', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        {
          type: 'STOCK',
          value: 1000, // 旧 value 字段，应被忽略
          symbol: 'sh600519',
          quantity: 100,
          marketPrice: 50,
        },
        {
          type: 'CASH',
          value: 5000,
          symbol: null,
          quantity: null,
          marketPrice: null,
        },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/assets/allocation')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      // STOCK: marketPrice(50) * quantity(100) = 5000
      // CASH: value 5000
      // total = 5000 + 5000 = 10000
      expect(res.body.totalValue).toBe(10000);
      const stockAlloc = res.body.allocation.find((a: any) => a.category === 'STOCK');
      expect(stockAlloc.value).toBe(5000);
      const cashAlloc = res.body.allocation.find((a: any) => a.category === 'CASH');
      expect(cashAlloc.value).toBe(5000);
    });

    test('无 symbol/quantity/marketPrice 时回退用 value', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { type: 'STOCK', value: 2000, symbol: null, quantity: null, marketPrice: null },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/assets/allocation')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalValue).toBe(2000);
      const stockAlloc = res.body.allocation.find((a: any) => a.category === 'STOCK');
      expect(stockAlloc.value).toBe(2000);
    });

    test('marketPrice 为 null 时回退用 value', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { type: 'STOCK', value: 3000, symbol: 'sh600519', quantity: 100, marketPrice: null },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/assets/allocation')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalValue).toBe(3000);
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/assets/allocation');

      expect(res.status).toBe(401);
    });
  });
});
