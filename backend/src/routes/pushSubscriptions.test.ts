import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import pushSubscriptionRoutes from './pushSubscriptions';

jest.mock('../app', () => ({
  prisma: {
    pushSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/push-subscriptions', pushSubscriptionRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

const SUBSCRIPTION_BODY = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  p256dh: 'p256dh-key',
  auth: 'auth-key',
  userAgent: 'Mozilla/5.0',
};

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    userId: 'user_1',
    familyId: null,
    endpoint: SUBSCRIPTION_BODY.endpoint,
    p256dh: SUBSCRIPTION_BODY.p256dh,
    auth: SUBSCRIPTION_BODY.auth,
    userAgent: SUBSCRIPTION_BODY.userAgent,
    createdAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  };
}

describe('Push Subscription Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.pushSubscription.upsert.mockImplementation(({ create }: any) =>
      Promise.resolve(makeSubscription(create))
    );
    mockedPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
  });

  describe('POST /api/push-subscriptions', () => {
    test('订阅成功返回 201 和 subscription', async () => {
      const res = await request(app)
        .post('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send(SUBSCRIPTION_BODY);

      expect(res.status).toBe(201);
      expect(res.body.subscription.endpoint).toBe(SUBSCRIPTION_BODY.endpoint);
      expect(res.body.subscription.userId).toBe('user_1');
      expect(mockedPrisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: SUBSCRIPTION_BODY.endpoint },
        create: expect.objectContaining({
          userId: 'user_1',
          endpoint: SUBSCRIPTION_BODY.endpoint,
          p256dh: 'p256dh-key',
          auth: 'auth-key',
          userAgent: 'Mozilla/5.0',
        }),
        update: expect.objectContaining({
          p256dh: 'p256dh-key',
          auth: 'auth-key',
          userAgent: 'Mozilla/5.0',
        }),
      });
    });

    test('支持可选 familyId', async () => {
      const res = await request(app)
        .post('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ ...SUBSCRIPTION_BODY, familyId: 'fam_1' });

      expect(res.status).toBe(201);
      expect(mockedPrisma.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ familyId: 'fam_1' }),
        })
      );
    });

    test('缺 endpoint 返回 400', async () => {
      const res = await request(app)
        .post('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ p256dh: 'p256dh-key', auth: 'auth-key' });

      expect(res.status).toBe(400);
      expect(mockedPrisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    test('缺 p256dh 返回 400', async () => {
      const res = await request(app)
        .post('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ endpoint: SUBSCRIPTION_BODY.endpoint, auth: 'auth-key' });

      expect(res.status).toBe(400);
      expect(mockedPrisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    test('缺 auth 返回 400', async () => {
      const res = await request(app)
        .post('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ endpoint: SUBSCRIPTION_BODY.endpoint, p256dh: 'p256dh-key' });

      expect(res.status).toBe(400);
      expect(mockedPrisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    test('重复订阅（endpoint 已存在）幂等更新而非报错', async () => {
      const res = await request(app)
        .post('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ ...SUBSCRIPTION_BODY, p256dh: 'new-p256dh-key' });

      expect(res.status).toBe(201);
      // upsert 保证幂等：同一 endpoint 复用记录并更新密钥
      expect(mockedPrisma.pushSubscription.upsert).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: SUBSCRIPTION_BODY.endpoint },
          update: expect.objectContaining({ p256dh: 'new-p256dh-key' }),
        })
      );
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .post('/api/push-subscriptions')
        .send(SUBSCRIPTION_BODY);

      expect(res.status).toBe(401);
      expect(mockedPrisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/push-subscriptions', () => {
    test('存在订阅时删除并返回 deleted: true', async () => {
      mockedPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });

      const res = await request(app)
        .delete('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ endpoint: SUBSCRIPTION_BODY.endpoint });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
      expect(mockedPrisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: SUBSCRIPTION_BODY.endpoint },
      });
    });

    test('订阅不存在时幂等返回 deleted: false', async () => {
      mockedPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });

      const res = await request(app)
        .delete('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/not-exist' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: false });
    });

    test('缺 endpoint 返回 400', async () => {
      const res = await request(app)
        .delete('/api/push-subscriptions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({});

      expect(res.status).toBe(400);
      expect(mockedPrisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .delete('/api/push-subscriptions')
        .send({ endpoint: SUBSCRIPTION_BODY.endpoint });

      expect(res.status).toBe(401);
    });
  });
});
