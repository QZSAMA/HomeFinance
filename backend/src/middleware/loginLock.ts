import { redisClient } from '../config/redis';

const MAX_FAILURES = 5;
const LOCK_DURATION_SECONDS = 15 * 60; // 15 分钟

export interface LoginLockStatus {
  locked: boolean;
  remainingAttempts?: number;
}

function lockKey(email: string): string {
  return `login:lock:${email}`;
}

export async function checkLoginLock(email: string): Promise<LoginLockStatus> {
  const key = lockKey(email);
  try {
    const countStr = await redisClient.get(key);
    const count = countStr ? parseInt(countStr, 10) : 0;

    if (count >= MAX_FAILURES) {
      return { locked: true };
    }

    return { locked: false, remainingAttempts: MAX_FAILURES - count };
  } catch (error) {
    // Redis 不可用时降级：不锁定，放行登录
    console.warn(
      '登录锁定检查失败，Redis 不可用，降级放行:',
      error instanceof Error ? error.message : error
    );
    return { locked: false };
  }
}

export async function recordLoginFailure(email: string): Promise<void> {
  const key = lockKey(email);
  try {
    const count = await redisClient.incr(key);

    if (count === 1) {
      // 首次失败：开启15分钟计数窗口
      await redisClient.expire(key, LOCK_DURATION_SECONDS);
    }

    if (count === MAX_FAILURES) {
      // 达到锁定阈值：从第5次失败起重新计时15分钟
      await redisClient.expire(key, LOCK_DURATION_SECONDS);
    }
  } catch (error) {
    // Redis 不可用时降级：跳过记录，不锁定
    console.warn(
      '记录登录失败失败，Redis 不可用，降级处理:',
      error instanceof Error ? error.message : error
    );
  }
}

export async function clearLoginFailures(email: string): Promise<void> {
  const key = lockKey(email);
  try {
    await redisClient.del(key);
  } catch (error) {
    // Redis 不可用时降级：跳过清除
    console.warn(
      '清除登录失败记录失败，Redis 不可用，降级处理:',
      error instanceof Error ? error.message : error
    );
  }
}
