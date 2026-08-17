import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import importSourceRoutes from './importSources';

jest.mock('../app', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    importSource: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('../services/syncService', () => ({
  syncImportSource: jest.fn(),
}));

import { prisma } from '../app';
import { syncImportSource } from '../services/syncService';

const mockedPrisma = prisma as any;
const mockedSyncImportSource = syncImportSource as jest.MockedFunction<
  typeof syncImportSource
>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/import-sources', importSourceRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('ImportSource Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.importSource.findMany.mockResolvedValue([]);
    mockedPrisma.importSource.findUnique.mockResolvedValue(null);
    mockedPrisma.importSource.create.mockResolvedValue({});
    mockedPrisma.importSource.update.mockResolvedValue({});
    mockedPrisma.importSource.delete.mockResolvedValue({});
  });

  describe('GET /api/families/:familyId/import-sources', () => {
    test('列出家庭的所有 ImportSource', async () => {
      const sources = [
        {
          id: 'src_1',
          familyId: 'fam_1',
          name: '支付宝主账号',
          type: 'alipay',
          config: { watchDirectory: '/dir1' },
          isActive: true,
          createdBy: 'user_1',
        },
      ];
      mockedPrisma.importSource.findMany.mockResolvedValue(sources);

      const res = await request(app)
        .get('/api/families/fam_1/import-sources')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('src_1');
      expect(mockedPrisma.importSource.findMany).toHaveBeenCalledWith({
        where: { familyId: 'fam_1' },
        orderBy: expect.any(Object),
      });
    });

    test('未认证返回 401', async () => {
      const res = await request(app).get('/api/families/fam_1/import-sources');

      expect(res.status).toBe(401);
      expect(mockedPrisma.importSource.findMany).not.toHaveBeenCalled();
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/import-sources')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/families/:familyId/import-sources', () => {
    test('创建 ImportSource', async () => {
      const created = {
        id: 'src_1',
        familyId: 'fam_1',
        name: '支付宝主账号',
        type: 'alipay',
        config: { watchDirectory: '/dir1', fileNamePattern: '*.csv' },
        isActive: true,
        createdBy: 'user_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockedPrisma.importSource.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/families/fam_1/import-sources')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          name: '支付宝主账号',
          type: 'alipay',
          config: { watchDirectory: '/dir1', fileNamePattern: '*.csv' },
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('src_1');
      expect(mockedPrisma.importSource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          familyId: 'fam_1',
          name: '支付宝主账号',
          type: 'alipay',
          config: { watchDirectory: '/dir1', fileNamePattern: '*.csv' },
          isActive: true,
          createdBy: 'user_1',
        }),
      });
    });

    test('无效 type 返回 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import-sources')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          name: 'x',
          type: 'unknown_bank',
          config: {},
        });

      expect(res.status).toBe(400);
      expect(mockedPrisma.importSource.create).not.toHaveBeenCalled();
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import-sources')
        .send({ name: 'x', type: 'alipay', config: {} });

      expect(res.status).toBe(401);
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/import-sources')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ name: 'x', type: 'alipay', config: {} });

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/families/:familyId/import-sources/:id', () => {
    test('更新 ImportSource', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue({
        id: 'src_1',
        familyId: 'fam_1',
        name: 'old',
        type: 'alipay',
        config: {},
        isActive: true,
        createdBy: 'user_1',
      });
      const updated = {
        id: 'src_1',
        familyId: 'fam_1',
        name: '支付宝副账号',
        type: 'alipay',
        config: { watchDirectory: '/dir2' },
        isActive: false,
      };
      mockedPrisma.importSource.update.mockResolvedValue(updated);

      const res = await request(app)
        .put('/api/families/fam_1/import-sources/src_1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          name: '支付宝副账号',
          config: { watchDirectory: '/dir2' },
          isActive: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('支付宝副账号');
      expect(mockedPrisma.importSource.update).toHaveBeenCalledWith({
        where: { id: 'src_1' },
        data: expect.objectContaining({
          name: '支付宝副账号',
          config: { watchDirectory: '/dir2' },
          isActive: false,
        }),
      });
    });

    test('记录不存在返回 404', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/import-sources/src_x')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ name: 'x' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/families/:familyId/import-sources/:id', () => {
    test('删除 ImportSource', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue({
        id: 'src_1',
        familyId: 'fam_1',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/import-sources/src_1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.importSource.delete).toHaveBeenCalledWith({
        where: { id: 'src_1' },
      });
    });

    test('未认证返回 401', async () => {
      const res = await request(app).delete(
        '/api/families/fam_1/import-sources/src_1'
      );

      expect(res.status).toBe(401);
    });

    test('无家庭权限返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/families/fam_1/import-sources/src_1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/families/:familyId/import-sources/:id/sync', () => {
    test('触发同步并返回结果', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue({
        id: 'src_1',
        familyId: 'fam_1',
      });
      mockedSyncImportSource.mockResolvedValue({
        success: true,
        imported: 5,
      });

      const res = await request(app)
        .post('/api/families/fam_1/import-sources/src_1/sync')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, imported: 5 });
      expect(mockedSyncImportSource).toHaveBeenCalledWith('src_1');
    });

    test('ImportSource 不存在返回 404', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/import-sources/src_x/sync')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
      expect(mockedSyncImportSource).not.toHaveBeenCalled();
    });

    test('未认证返回 401', async () => {
      const res = await request(app).post(
        '/api/families/fam_1/import-sources/src_1/sync'
      );

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/families/:familyId/import-sources/:id/status', () => {
    test('获取同步状态', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue({
        id: 'src_1',
        familyId: 'fam_1',
        lastSyncAt: '2026-08-01T02:00:00.000Z',
        lastSyncStatus: 'success',
        lastSyncError: null,
        isActive: true,
      });

      const res = await request(app)
        .get('/api/families/fam_1/import-sources/src_1/status')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.lastSyncStatus).toBe('success');
      expect(res.body.isActive).toBe(true);
    });

    test('记录不存在返回 404', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/import-sources/src_x/status')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
    });
  });
});
