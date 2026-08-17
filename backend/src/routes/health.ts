import { Router, Request, Response } from 'express';
import { prisma } from '../app';
import { redisClient } from '../config/redis';
import { ensureBucket } from '../config/minio';

const router = Router();

// 每个依赖服务检查的最大等待时间，避免长时间挂起
const CHECK_TIMEOUT_MS = 3000;

// 为 Promise 增加超时保护：超时则 reject，使调用方标记为 down
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`health check timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// 执行单个服务检查：成功返回 'up'，失败或超时返回 'down'，不抛错以避免中断其他检查
async function checkService(fn: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS);
    return 'up';
  } catch {
    return 'down';
  }
}

router.get('/', async (_req: Request, res: Response) => {
  // 并发检查三个依赖服务，任一失败不影响其他检查
  const [database, redis, minio] = await Promise.all([
    checkService(() => prisma.$queryRaw`SELECT 1`),
    checkService(() => redisClient.ping()),
    checkService(() => ensureBucket()),
  ]);

  const services = { database, redis, minio };
  const allUp = database === 'up' && redis === 'up' && minio === 'up';
  const status = allUp ? 'ok' : 'degraded';

  res.status(allUp ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    services,
  });
});

export default router;
