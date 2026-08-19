import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import anomalyRoutes from './anomalies';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    anomalyAlert: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock('../services/anomalyService', () => ({
  detectAndSaveAnomalies: jest.fn(),
}));

import { prisma } from '../app';
import { detectAndSaveAnomalies } from '../services/anomalyService';

const mockedPrisma = prisma as any;
const mockedDetect = detectAndSaveAnomalies as jest.MockedFunction<
  typeof detectAndSaveAnomalies
>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/anomalies', anomalyRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Anomaly Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
    mockedPrisma.anomalyAlert.findUnique.mockResolvedValue(null);
    mockedPrisma.anomalyAlert.update.mockResolvedValue({});
    mockedPrisma.anomalyAlert.updateMany.mockResolvedValue({ count: 0 });
    mockedPrisma.anomalyAlert.count.mockResolvedValue(0);
    mockedDetect.mockResolvedValue({ detected: 0, saved: 0 });
  });

  describe('GET /api/families/:familyId/anomalies', () => {
    test('返回告警列表和未读数', async () => {
      const alerts = [
        {
          id: 'a1',
          familyId: 'fam_1',
          type: 'LARGE_EXPENSE',
          severity: 'HIGH',
          title: '大额支出提醒',
          description: '单笔支出 1000 元，超过近90天均值 100 元的 3 倍',
          amount: 1000,
          isRead: false,
          createdAt: new Date(),
        },
      ];
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue(alerts);
      mockedPrisma.anomalyAlert.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/families/fam_1/anomalies')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.alerts).toHaveLength(1);
      expect(res.body.alerts[0].id).toBe('a1');
      expect(res.body.unreadCount).toBe(2);
      expect(mockedPrisma.anomalyAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ familyId: 'fam_1' }),
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      );
    });

    test('支持 isRead=false 筛选和 limit 参数', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/anomalies?isRead=false&limit=10')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.anomalyAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ familyId: 'fam_1', isRead: false }),
          take: 10,
        })
      );
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/anomalies')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });

    test('未认证返回 401', async () => {
      const res = await request(app).get('/api/families/fam_1/anomalies');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/families/:familyId/anomalies/detect', () => {
    test('手动触发检测并返回结果', async () => {
      mockedDetect.mockResolvedValue({ detected: 3, saved: 2 });

      const res = await request(app)
        .get('/api/families/fam_1/anomalies/detect')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ detected: 3, saved: 2 });
      expect(mockedDetect).toHaveBeenCalledWith('fam_1');
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/anomalies/detect')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(mockedDetect).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/families/:familyId/anomalies/:id/read', () => {
    test('标记单条告警已读', async () => {
      mockedPrisma.anomalyAlert.findUnique.mockResolvedValue({
        id: 'a1',
        familyId: 'fam_1',
        isRead: false,
      });
      mockedPrisma.anomalyAlert.update.mockResolvedValue({
        id: 'a1',
        familyId: 'fam_1',
        isRead: true,
      });

      const res = await request(app)
        .put('/api/families/fam_1/anomalies/a1/read')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.isRead).toBe(true);
      expect(mockedPrisma.anomalyAlert.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { isRead: true },
      });
    });

    test('告警不存在返回 404', async () => {
      mockedPrisma.anomalyAlert.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/anomalies/a1/read')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
      expect(mockedPrisma.anomalyAlert.update).not.toHaveBeenCalled();
    });

    test('告警属于其他家庭返回 404', async () => {
      mockedPrisma.anomalyAlert.findUnique.mockResolvedValue({
        id: 'a1',
        familyId: 'fam_2',
        isRead: false,
      });

      const res = await request(app)
        .put('/api/families/fam_1/anomalies/a1/read')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
      expect(mockedPrisma.anomalyAlert.update).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/families/:familyId/anomalies/read-all', () => {
    test('全部标记已读并返回更新数', async () => {
      mockedPrisma.anomalyAlert.updateMany.mockResolvedValue({ count: 3 });

      const res = await request(app)
        .put('/api/families/fam_1/anomalies/read-all')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: 3 });
      expect(mockedPrisma.anomalyAlert.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1', isRead: false },
        data: { isRead: true },
      });
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/anomalies/read-all')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(mockedPrisma.anomalyAlert.updateMany).not.toHaveBeenCalled();
    });
  });
});
