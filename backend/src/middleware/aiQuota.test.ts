import { checkAIQuota, recordAIUsage, getAIQuotaStatus, DEFAULT_AI_DAILY_QUOTA } from './aiQuota';

// 使用内存存储模拟 Redis（参考 loginLock.test.ts 的模式）
jest.mock('../config/redis', () => {
  const store = new Map<string, string>();
  const redisClient = {
    isOpen: true,
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    incr: jest.fn((key: string) => {
      const next = parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(next));
      return Promise.resolve(next);
    }),
    expire: jest.fn(() => Promise.resolve(1)),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(() => {
        // 默认实现不会被实际用到，aiQuota 用 incr+expire 单独调用
        return Promise.resolve([1, 1]);
      }),
    })),
    __store: store,
  };
  return { redisClient };
});

import { redisClient } from '../config/redis';

const mockedRedis = redisClient as any;
const store = mockedRedis.__store as Map<string, string>;

describe('AI Quota Middleware', () => {
  const userId = 'user_1';

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    mockedRedis.isOpen = true;
    // 重置环境变量
    delete process.env.AI_DAILY_QUOTA;
  });

  describe('DEFAULT_AI_DAILY_QUOTA', () => {
    test('默认值为 50', () => {
      expect(DEFAULT_AI_DAILY_QUOTA).toBe(50);
    });
  });

  describe('checkAIQuota', () => {
    test('首次调用 allowed: true, remaining 等于配额', async () => {
      const result = await checkAIQuota(userId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
      expect(result.limit).toBe(50);
    });

    test('调用 recordAIUsage 后 remaining 递减', async () => {
      // 首次检查
      const first = await checkAIQuota(userId);
      expect(first.remaining).toBe(50);

      // 记录一次使用
      await recordAIUsage(userId);

      // 再次检查应递减
      const second = await checkAIQuota(userId);
      expect(second.remaining).toBe(49);
    });

    test('达到上限后 allowed: false', async () => {
      // 模拟已使用 50 次
      for (let i = 0; i < 50; i++) {
        await recordAIUsage(userId);
      }

      const result = await checkAIQuota(userId);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.limit).toBe(50);
    });

    test('Redis 不可用时降级允许调用', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRedis.get.mockRejectedValueOnce(new Error('Redis connection error'));

      const result = await checkAIQuota(userId);
      // 降级：允许调用
      expect(result.allowed).toBe(true);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    test('不同用户的配额独立', async () => {
      // user_1 使用 10 次
      for (let i = 0; i < 10; i++) {
        await recordAIUsage('user_1');
      }

      // user_2 使用 5 次
      for (let i = 0; i < 5; i++) {
        await recordAIUsage('user_2');
      }

      const r1 = await checkAIQuota('user_1');
      const r2 = await checkAIQuota('user_2');

      expect(r1.remaining).toBe(40);
      expect(r2.remaining).toBe(45);
    });

    test('从环境变量 AI_DAILY_QUOTA 读取配额', async () => {
      process.env.AI_DAILY_QUOTA = '10';

      const result = await checkAIQuota(userId);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(10);
      // DEFAULT_AI_DAILY_QUOTA 常量始终为 50（默认值）
      expect(DEFAULT_AI_DAILY_QUOTA).toBe(50);

      delete process.env.AI_DAILY_QUOTA;
    });
  });

  describe('recordAIUsage', () => {
    test('递增 Redis 计数', async () => {
      await recordAIUsage(userId);
      await recordAIUsage(userId);
      await recordAIUsage(userId);

      const today = new Date().toISOString().split('T')[0];
      const key = `ai:quota:${userId}:${today}`;
      expect(store.get(key)).toBe('3');
    });

    test('首次记录时设置 TTL 到当日 23:59:59', async () => {
      await recordAIUsage(userId);

      const today = new Date().toISOString().split('T')[0];
      const key = `ai:quota:${userId}:${today}`;
      expect(mockedRedis.expire).toHaveBeenCalled();
      // TTL 应是正数（到当日 23:59:59 的剩余秒数）
      const ttlCalls = mockedRedis.expire.mock.calls;
      const lastTtl = ttlCalls[ttlCalls.length - 1][1];
      expect(lastTtl).toBeGreaterThan(0);
      // 不能超过 24 小时（86400 秒）
      expect(lastTtl).toBeLessThanOrEqual(86400);
    });

    test('Redis 不可用时不抛出异常并记录警告', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRedis.incr.mockRejectedValueOnce(new Error('Redis connection error'));

      await expect(recordAIUsage(userId)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('getAIQuotaStatus', () => {
    test('返回 used、limit、remaining', async () => {
      await recordAIUsage(userId);
      await recordAIUsage(userId);

      const status = await getAIQuotaStatus(userId);
      expect(status.used).toBe(2);
      expect(status.limit).toBe(50);
      expect(status.remaining).toBe(48);
    });

    test('未使用时返回 used=0', async () => {
      const status = await getAIQuotaStatus(userId);
      expect(status.used).toBe(0);
      expect(status.remaining).toBe(50);
    });

    test('Redis 不可用时降级返回 used=0', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRedis.get.mockRejectedValueOnce(new Error('Redis connection error'));

      const status = await getAIQuotaStatus(userId);
      expect(status.used).toBe(0);
      expect(status.limit).toBe(50);
      expect(status.remaining).toBe(50);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});
