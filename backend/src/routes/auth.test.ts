import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import authRoutes from './auth';

// Mock the app module where prisma is exported
jest.mock('../app', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock Redis 客户端（登录锁定功能依赖），使用内存存储模拟
jest.mock('../config/redis', () => {
  const store = new Map<string, string>();
  const redisClient = {
    isOpen: true,
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    incr: jest.fn((key: string) => {
      const next = (parseInt(store.get(key) ?? '0', 10)) + 1;
      store.set(key, String(next));
      return Promise.resolve(next);
    }),
    expire: jest.fn(() => Promise.resolve(1)),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve(1);
    }),
    __store: store,
  };
  return { redisClient };
});

import { prisma } from '../app';
import { redisClient } from '../config/redis';

const mockedPrisma = prisma as any;
const mockedRedis = redisClient as any;
const redisStore = mockedRedis.__store as Map<string, string>;

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
  });

  describe('POST /api/auth/register', () => {
    test('registers a new user successfully', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null);
      mockedPrisma.user.create.mockResolvedValue({
        id: 'user_1',
        email: 'new@example.com',
        name: 'New User',
        createdAt: new Date(),
      } as any);

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'new@example.com', password: 'password123', name: 'New User' });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('new@example.com');
    });

    test('rejects registration with existing email', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'existing@example.com',
        name: 'Existing',
      } as any);

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'existing@example.com', password: 'password123', name: 'Existing' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('该邮箱已被注册');
    });

    test('rejects invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: 'password123', name: 'User' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('rejects short password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: '123', name: 'User' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('rejects registration with numeric-only password (no letters)', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'numeric@example.com', password: '12345678', name: 'User' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('rejects registration with letters-only password (no digits)', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'letters@example.com', password: 'abcdefgh', name: 'User' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /api/auth/login', () => {
    test('logs in with valid credentials', async () => {
      const bcrypt = require('bcryptjs');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed_password',
      } as any);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.token).toBeDefined();
    });

    test('rejects login with wrong password', async () => {
      const bcrypt = require('bcryptjs');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'hashed_password',
      } as any);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('邮箱或密码错误');
    });

    test('rejects login for non-existent user', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'unknown@example.com', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('邮箱或密码错误');
    });

    test('locks account after 5 failed login attempts (6th returns 423)', async () => {
      const bcrypt = require('bcryptjs');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_lock',
        email: 'lock@example.com',
        name: 'Lock User',
        passwordHash: 'hashed_password',
      } as any);

      const payload = { email: 'lock@example.com', password: 'wrongpassword123' };

      // 前5次失败
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/api/auth/login').send(payload);
        expect(res.status).toBe(401);
      }

      // 第6次被锁定
      const res = await request(app).post('/api/auth/login').send(payload);
      expect(res.status).toBe(423);
      expect(res.body.error).toBe('账号已被锁定，请15分钟后再试');
    });
  });

  describe('GET /api/auth/me', () => {
    test('returns current user with valid token', async () => {
      const token = jwt.sign(
        { userId: 'user_1', email: 'test@example.com', name: 'Test User' },
        process.env.JWT_SECRET as string,
        { expiresIn: '1h' }
      );

      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test User',
        createdAt: new Date(),
      } as any);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('test@example.com');
    });

    test('rejects request without token', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('未授权访问');
    });
  });

  describe('POST /api/auth/change-password', () => {
    const bcrypt = require('bcryptjs');

    const signToken = (userId = 'user_1') =>
      jwt.sign(
        { userId, email: 'test@example.com', name: 'Test User' },
        process.env.JWT_SECRET as string,
        { expiresIn: '1h' }
      );

    test('changes password successfully', async () => {
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'old_hash',
      } as any);
      mockedPrisma.user.update.mockResolvedValue({} as any);

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${signToken()}`)
        .send({ currentPassword: 'OldPass123', newPassword: 'NewPass456' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('密码修改成功');
      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: { passwordHash: expect.any(String) },
      });
    });

    test('rejects change with wrong current password', async () => {
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'old_hash',
      } as any);

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${signToken()}`)
        .send({ currentPassword: 'WrongOld123', newPassword: 'NewPass456' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('当前密码错误');
    });

    test('rejects change with weak new password', async () => {
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'user_1',
        email: 'test@example.com',
        name: 'Test User',
        passwordHash: 'old_hash',
      } as any);

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${signToken()}`)
        .send({ currentPassword: 'OldPass123', newPassword: '12345678' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });
});
