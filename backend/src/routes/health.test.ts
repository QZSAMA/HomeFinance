import request from 'supertest';
import express from 'express';
import healthRoutes from './health';

// Mock prisma（通过 app 模块导出），健康检查使用 $queryRaw 执行 SELECT 1
jest.mock('../app', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

// Mock Redis 客户端，健康检查调用 ping()
jest.mock('../config/redis', () => ({
  redisClient: {
    ping: jest.fn(),
  },
}));

// Mock MinIO，健康检查调用 ensureBucket()
jest.mock('../config/minio', () => ({
  ensureBucket: jest.fn(),
}));

import { prisma } from '../app';
import { redisClient } from '../config/redis';
import { ensureBucket } from '../config/minio';

const mockedPrisma = prisma as any;
const mockedRedis = redisClient as any;
const mockedEnsureBucket = ensureBucket as jest.MockedFunction<typeof ensureBucket>;

const app = express();
app.use(express.json());
app.use('/api/health', healthRoutes);

describe('Health Check Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认：所有服务正常
    mockedPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockedRedis.ping.mockResolvedValue('PONG');
    mockedEnsureBucket.mockResolvedValue(undefined);
  });

  describe('GET /api/health', () => {
    test('returns 200 ok when all services are up', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.services).toEqual({
        database: 'up',
        redis: 'up',
        minio: 'up',
      });
    });

    test('returns 503 degraded when redis is down', async () => {
      mockedRedis.ping.mockRejectedValue(new Error('redis connection refused'));

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.services.redis).toBe('down');
      // 其他服务仍正常检查
      expect(res.body.services.database).toBe('up');
      expect(res.body.services.minio).toBe('up');
    });

    test('returns 503 degraded when database is down', async () => {
      mockedPrisma.$queryRaw.mockRejectedValue(new Error('db connection refused'));

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.services.database).toBe('down');
      expect(res.body.services.redis).toBe('up');
      expect(res.body.services.minio).toBe('up');
    });

    test('returns 503 degraded when minio is down', async () => {
      mockedEnsureBucket.mockRejectedValue(new Error('minio connection refused'));

      const res = await request(app).get('/api/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.services.minio).toBe('down');
      expect(res.body.services.database).toBe('up');
      expect(res.body.services.redis).toBe('up');
    });

    test('response includes timestamp field', async () => {
      const res = await request(app).get('/api/health');

      expect(res.body.timestamp).toBeDefined();
      expect(typeof res.body.timestamp).toBe('string');
      // 应为合法的 ISO 时间字符串
      expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    });
  });
});
