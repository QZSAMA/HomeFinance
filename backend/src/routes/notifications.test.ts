/**
 * V4.4 通知查询路由（notifications）单元测试
 * 挂载路径：/api/families/:familyId/notifications
 */
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import notificationRoutes from './notifications';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    notificationDelivery: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    anomalyAlert: {
      update: jest.fn(),
    },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/notifications', notificationRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Notification Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.notificationDelivery.findMany.mockResolvedValue([]);
    mockedPrisma.notificationDelivery.count.mockResolvedValue(0);
    mockedPrisma.notificationDelivery.findUnique.mockResolvedValue(null);
    mockedPrisma.anomalyAlert.update.mockResolvedValue({});
  });

  describe('GET /api/families/:familyId/notifications', () => {
    test('返回当前用户的投递列表和未读数', async () => {
      const notifications = [
        {
          id: 'nd_1',
          alertId: 'alert_1',
          userId: 'user_1',
          familyId: 'fam_1',
          channel: 'IN_APP',
          status: 'SENT',
          alertSnapshot: { title: '大额支出提醒' },
          createdAt: new Date(),
          alert: { isRead: false },
        },
      ];
      mockedPrisma.notificationDelivery.findMany.mockResolvedValue(notifications);
      mockedPrisma.notificationDelivery.count.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/families/fam_1/notifications')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.notifications).toHaveLength(1);
      expect(res.body.notifications[0].id).toBe('nd_1');
      expect(res.body.unreadCount).toBe(2);
      expect(mockedPrisma.notificationDelivery.findMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1', userId: 'user_1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { alert: { select: { isRead: true } } },
      });
      expect(mockedPrisma.notificationDelivery.count).toHaveBeenCalledWith({
        where: {
          familyId: 'fam_1',
          userId: 'user_1',
          channel: 'IN_APP',
          status: 'SENT',
          alert: { isRead: false },
        },
      });
    });

    test('status/channel 筛选传递到查询条件', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/notifications?status=FAILED&channel=EMAIL&limit=10')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.notificationDelivery.findMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1', userId: 'user_1', status: 'FAILED', channel: 'EMAIL' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { alert: { select: { isRead: true } } },
      });
    });

    test('未传 limit 时默认 50', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/notifications')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.notificationDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 })
      );
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/notifications')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(mockedPrisma.notificationDelivery.findMany).not.toHaveBeenCalled();
    });

    test('未认证返回 401', async () => {
      const res = await request(app).get('/api/families/fam_1/notifications');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/families/:familyId/notifications/unread-count', () => {
    test('返回未读数', async () => {
      mockedPrisma.notificationDelivery.count.mockResolvedValue(3);

      const res = await request(app)
        .get('/api/families/fam_1/notifications/unread-count')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unreadCount: 3 });
      expect(mockedPrisma.notificationDelivery.count).toHaveBeenCalledWith({
        where: {
          familyId: 'fam_1',
          userId: 'user_1',
          channel: 'IN_APP',
          status: 'SENT',
          alert: { isRead: false },
        },
      });
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/notifications/unread-count')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });

    test('未认证返回 401', async () => {
      const res = await request(app).get('/api/families/fam_1/notifications/unread-count');

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/families/:familyId/notifications/:id/read', () => {
    test('标记通知对应告警已读', async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: 'nd_1',
        alertId: 'alert_1',
        userId: 'user_1',
        familyId: 'fam_1',
      });

      const res = await request(app)
        .put('/api/families/fam_1/notifications/nd_1/read')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockedPrisma.anomalyAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert_1' },
        data: { isRead: true },
      });
    });

    test('投递记录不存在返回 404', async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/notifications/nd_1/read')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
      expect(mockedPrisma.anomalyAlert.update).not.toHaveBeenCalled();
    });

    test('投递记录属于其他家庭返回 404', async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: 'nd_1',
        alertId: 'alert_1',
        userId: 'user_1',
        familyId: 'fam_2',
      });

      const res = await request(app)
        .put('/api/families/fam_1/notifications/nd_1/read')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
      expect(mockedPrisma.anomalyAlert.update).not.toHaveBeenCalled();
    });

    test('投递记录属于其他用户返回 404', async () => {
      mockedPrisma.notificationDelivery.findUnique.mockResolvedValue({
        id: 'nd_1',
        alertId: 'alert_1',
        userId: 'user_2',
        familyId: 'fam_1',
      });

      const res = await request(app)
        .put('/api/families/fam_1/notifications/nd_1/read')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
      expect(mockedPrisma.anomalyAlert.update).not.toHaveBeenCalled();
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .put('/api/families/fam_1/notifications/nd_1/read');

      expect(res.status).toBe(401);
    });
  });
});
