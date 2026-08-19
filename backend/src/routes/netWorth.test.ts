import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import netWorthRoutes from './netWorth';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../services/netWorthService', () => ({
  takeSnapshot: jest.fn(),
  getHistory: jest.fn(),
  getLatestSnapshot: jest.fn(),
}));

import { prisma } from '../app';
import {
  takeSnapshot,
  getHistory,
  getLatestSnapshot,
} from '../services/netWorthService';

const mockedPrisma = prisma as any;
const mockedTakeSnapshot = takeSnapshot as jest.MockedFunction<typeof takeSnapshot>;
const mockedGetHistory = getHistory as jest.MockedFunction<typeof getHistory>;
const mockedGetLatest = getLatestSnapshot as jest.MockedFunction<typeof getLatestSnapshot>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/net-worth', netWorthRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('NetWorth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
  });

  describe('GET /api/families/:familyId/net-worth/history', () => {
    test('返回历史数据', async () => {
      mockedGetHistory.mockResolvedValue([
        {
          familyId: 'fam_1',
          date: new Date('2026-07-01'),
          totalAssets: 10000,
          totalLiabilities: 2000,
          netWorth: 8000,
          assetBreakdown: { CASH: 10000 },
        },
        {
          familyId: 'fam_1',
          date: new Date('2026-07-02'),
          totalAssets: 11000,
          totalLiabilities: 2000,
          netWorth: 9000,
          assetBreakdown: { CASH: 11000 },
        },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/net-worth/history')
        .query({ startDate: '2026-07-01', endDate: '2026-07-23' })
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].totalAssets).toBe(10000);
      expect(res.body[1].netWorth).toBe(9000);
      expect(mockedGetHistory).toHaveBeenCalledWith(
        'fam_1',
        new Date('2026-07-01'),
        new Date('2026-07-23')
      );
    });

    test('未提供日期时默认返回最近 30 天', async () => {
      mockedGetHistory.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/net-worth/history')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      const [familyId, startDate, endDate] = mockedGetHistory.mock.calls[0];
      expect(familyId).toBe('fam_1');
      // 默认 endDate 应为今天
      const now = new Date();
      expect(endDate.getFullYear()).toBe(now.getFullYear());
      expect(endDate.getMonth()).toBe(now.getMonth());
      expect(endDate.getDate()).toBe(now.getDate());
      // 默认 startDate 应为 30 天前（±1 天容差）
      const diff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(diff).toBeGreaterThanOrEqual(29);
      expect(diff).toBeLessThanOrEqual(30);
    });
  });

  describe('GET /api/families/:familyId/net-worth/latest', () => {
    test('返回最新快照', async () => {
      mockedGetLatest.mockResolvedValue({
        familyId: 'fam_1',
        date: new Date('2026-08-19'),
        totalAssets: 50000,
        totalLiabilities: 10000,
        netWorth: 40000,
        assetBreakdown: { STOCK: 50000 },
      });

      const res = await request(app)
        .get('/api/families/fam_1/net-worth/latest')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalAssets).toBe(50000);
      expect(res.body.netWorth).toBe(40000);
      expect(mockedGetLatest).toHaveBeenCalledWith('fam_1');
    });

    test('无快照时返回 404', async () => {
      mockedGetLatest.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/net-worth/latest')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/families/:familyId/net-worth/snapshot', () => {
    test('创建快照', async () => {
      mockedTakeSnapshot.mockResolvedValue({
        familyId: 'fam_1',
        date: new Date('2026-08-19'),
        totalAssets: 50000,
        totalLiabilities: 10000,
        netWorth: 40000,
        assetBreakdown: { STOCK: 50000 },
      });

      const res = await request(app)
        .post('/api/families/fam_1/net-worth/snapshot')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(201);
      expect(res.body.totalAssets).toBe(50000);
      expect(res.body.netWorth).toBe(40000);
      expect(mockedTakeSnapshot).toHaveBeenCalledWith('fam_1');
    });
  });

  describe('auth & access control', () => {
    test('未认证返回 401', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/net-worth/history');

      expect(res.status).toBe(401);
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/net-worth/history')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });
});
