import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import marketDataRoutes from './marketData';

jest.mock('../app', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
  },
}));

jest.mock('../services/marketDataService', () => ({
  getQuote: jest.fn(),
  refreshAllAssetPrices: jest.fn(),
  refreshAssetPrice: jest.fn(),
}));

import { prisma } from '../app';
import {
  getQuote,
  refreshAllAssetPrices,
  refreshAssetPrice,
} from '../services/marketDataService';

const mockedPrisma = prisma as any;
const mockedGetQuote = getQuote as jest.MockedFunction<typeof getQuote>;
const mockedRefreshAll = refreshAllAssetPrices as jest.MockedFunction<typeof refreshAllAssetPrices>;
const mockedRefreshOne = refreshAssetPrice as jest.MockedFunction<typeof refreshAssetPrice>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/market-data', marketDataRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('MarketData Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
  });

  describe('GET /quote', () => {
    test('返回行情数据', async () => {
      mockedGetQuote.mockResolvedValue({
        symbol: 'sh600519',
        name: '贵州茅台',
        price: 1810.5,
        change: 15.5,
        changePercent: 0.8635,
      });

      const res = await request(app)
        .get('/api/families/fam_1/market-data/quote')
        .query({ symbol: 'sh600519' })
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.symbol).toBe('sh600519');
      expect(res.body.name).toBe('贵州茅台');
      expect(res.body.price).toBe(1810.5);
      expect(mockedGetQuote).toHaveBeenCalledWith('sh600519');
    });

    test('缺少 symbol 参数返回 400', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/market-data/quote')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockedGetQuote).not.toHaveBeenCalled();
    });

    test('服务抛错时返回 500', async () => {
      mockedGetQuote.mockRejectedValue(new Error('无法获取行情数据: sh600519'));

      const res = await request(app)
        .get('/api/families/fam_1/market-data/quote')
        .query({ symbol: 'sh600519' })
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/market-data/quote')
        .query({ symbol: 'sh600519' });

      expect(res.status).toBe(401);
      expect(mockedGetQuote).not.toHaveBeenCalled();
    });

    test('非家庭成员返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/market-data/quote')
        .query({ symbol: 'sh600519' })
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(mockedGetQuote).not.toHaveBeenCalled();
    });
  });

  describe('POST /refresh', () => {
    test('刷新家庭所有资产行情', async () => {
      mockedRefreshAll.mockResolvedValue({
        updated: 2,
        failed: 1,
        details: [
          { assetId: 'a1', name: '茅台', success: true, price: 1810.5 },
          { assetId: 'a2', name: '平安', success: true, price: 12.34 },
          { assetId: 'a3', name: '无效', success: false, error: 'API 失败' },
        ],
      });

      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(2);
      expect(res.body.failed).toBe(1);
      expect(res.body.details).toHaveLength(3);
      expect(mockedRefreshAll).toHaveBeenCalledWith('fam_1');
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh');

      expect(res.status).toBe(401);
      expect(mockedRefreshAll).not.toHaveBeenCalled();
    });

    test('非家庭成员返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(mockedRefreshAll).not.toHaveBeenCalled();
    });

    test('服务抛错时返回 500', async () => {
      mockedRefreshAll.mockRejectedValue(new Error('数据库错误'));

      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /refresh/:assetId', () => {
    test('刷新单个资产行情成功返回 200', async () => {
      mockedRefreshOne.mockResolvedValue({
        success: true,
        price: 1810.5,
      });

      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh/a1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.price).toBe(1810.5);
      expect(mockedRefreshOne).toHaveBeenCalledWith('a1');
    });

    test('资产不存在返回 404', async () => {
      mockedRefreshOne.mockResolvedValue({
        success: false,
        error: '资产不存在',
      });

      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh/a1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('资产不存在');
    });

    test('资产未设置证券代码返回 400', async () => {
      mockedRefreshOne.mockResolvedValue({
        success: false,
        error: '该资产未设置证券代码',
      });

      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh/a1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('该资产未设置证券代码');
    });

    test('行情获取失败返回 500', async () => {
      mockedRefreshOne.mockResolvedValue({
        success: false,
        error: '无法获取行情数据: sh600519',
      });

      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh/a1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('无法获取行情数据: sh600519');
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/market-data/refresh/a1');

      expect(res.status).toBe(401);
      expect(mockedRefreshOne).not.toHaveBeenCalled();
    });
  });
});
