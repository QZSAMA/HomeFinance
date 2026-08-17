import { checkLoginLock, recordLoginFailure, clearLoginFailures } from './loginLock';

// 使用内存存储模拟 Redis，store 在 factory 内部创建以避免 TDZ 问题
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

import { redisClient } from '../config/redis';

const mockedRedis = redisClient as any;
const store = mockedRedis.__store as Map<string, string>;

describe('loginLock middleware', () => {
  const email = 'test@example.com';
  const key = `login:lock:${email}`;

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    // 恢复默认 isOpen
    mockedRedis.isOpen = true;
  });

  describe('checkLoginLock', () => {
    test('无失败记录时返回未锁定且剩余5次', async () => {
      const result = await checkLoginLock(email);
      expect(result.locked).toBe(false);
      expect(result.remainingAttempts).toBe(5);
      expect(mockedRedis.get).toHaveBeenCalledWith(key);
    });

    test('部分失败后返回剩余尝试次数', async () => {
      store.set(key, '2');
      const result = await checkLoginLock(email);
      expect(result.locked).toBe(false);
      expect(result.remainingAttempts).toBe(3);
    });

    test('失败5次后返回锁定状态', async () => {
      store.set(key, '5');
      const result = await checkLoginLock(email);
      expect(result.locked).toBe(true);
      expect(result.remainingAttempts).toBeUndefined();
    });

    test('失败超过5次仍返回锁定状态', async () => {
      store.set(key, '7');
      const result = await checkLoginLock(email);
      expect(result.locked).toBe(true);
    });

    test('Redis 不可用时降级返回未锁定（不阻断登录）', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRedis.get.mockRejectedValueOnce(new Error('Redis connection error'));

      const result = await checkLoginLock(email);
      expect(result.locked).toBe(false);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('recordLoginFailure', () => {
    test('第1次失败递增计数并设置15分钟TTL', async () => {
      await recordLoginFailure(email);
      expect(mockedRedis.incr).toHaveBeenCalledWith(key);
      expect(store.get(key)).toBe('1');
      expect(mockedRedis.expire).toHaveBeenCalledWith(key, 900);
    });

    test('多次失败递增计数', async () => {
      await recordLoginFailure(email);
      await recordLoginFailure(email);
      await recordLoginFailure(email);
      expect(store.get(key)).toBe('3');
    });

    test('第5次失败（触发锁定）重置TTL为15分钟', async () => {
      store.set(key, '4');
      await recordLoginFailure(email);
      expect(store.get(key)).toBe('5');
      // 第5次失败会重新设置 expire 为 900（锁定窗口从第5次起算）
      expect(mockedRedis.expire).toHaveBeenCalledWith(key, 900);
    });

    test('Redis 不可用时不抛出异常并记录警告', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRedis.incr.mockRejectedValueOnce(new Error('Redis connection error'));

      await expect(recordLoginFailure(email)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('clearLoginFailures', () => {
    test('清除失败计数', async () => {
      store.set(key, '5');
      await clearLoginFailures(email);
      expect(mockedRedis.del).toHaveBeenCalledWith(key);
      expect(store.has(key)).toBe(false);
    });

    test('清除后 checkLoginLock 返回未锁定', async () => {
      store.set(key, '5');
      expect((await checkLoginLock(email)).locked).toBe(true);

      await clearLoginFailures(email);

      const result = await checkLoginLock(email);
      expect(result.locked).toBe(false);
      expect(result.remainingAttempts).toBe(5);
    });

    test('Redis 不可用时不抛出异常并记录警告', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRedis.del.mockRejectedValueOnce(new Error('Redis connection error'));

      await expect(clearLoginFailures(email)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('完整锁定流程', () => {
    test('5次失败后锁定，第6次尝试被 checkLoginLock 拦截', async () => {
      // 模拟5次失败登录
      for (let i = 0; i < 5; i++) {
        await recordLoginFailure(email);
      }

      // 第6次登录前检查锁定状态
      const lockStatus = await checkLoginLock(email);
      expect(lockStatus.locked).toBe(true);
    });
  });
});
