import { redisClient } from '../config/redis';
import { prisma } from '../app';

export const DEFAULT_AI_DAILY_QUOTA = 50;

/**
 * 获取每日 AI 调用配额上限（从环境变量 AI_DAILY_QUOTA 读取，默认 50）。
 */
function getDailyQuota(): number {
  const raw = process.env.AI_DAILY_QUOTA;
  if (!raw) return DEFAULT_AI_DAILY_QUOTA;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_AI_DAILY_QUOTA;
  return parsed;
}

/**
 * 获取当前日期字符串（YYYY-MM-DD，本地时区）。
 */
function getDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 计算到当日 23:59:59 的剩余秒数（用于 Redis TTL）。
 */
function getSecondsUntilEndOfDay(): number {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const diffMs = endOfDay.getTime() - now.getTime();
  // 至少 1 秒，避免 0 TTL
  return Math.max(1, Math.floor(diffMs / 1000));
}

function quotaKey(userId: string): string {
  return `ai:quota:${userId}:${getDateString()}`;
}

/**
 * V3.4.3: 获取用户当日配额上限（优先用户级 aiQuotaOverride，其次全局 AI_DAILY_QUOTA）。
 * 用户 override > 0 时生效；DB 查询失败时降级用全局配额，不阻塞请求。
 */
async function getUserQuotaLimit(userId: string): Promise<number> {
  const globalQuota = getDailyQuota();
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiQuotaOverride: true },
    });
    if (user?.aiQuotaOverride && user.aiQuotaOverride > 0) {
      return user.aiQuotaOverride;
    }
    return globalQuota;
  } catch (error) {
    console.warn(
      '读取用户 AI 配额覆盖失败，降级使用全局配额:',
      error instanceof Error ? error.message : error
    );
    return globalQuota;
  }
}

/**
 * 检查用户是否还有 AI 调用配额。
 * Redis 不可用时降级允许调用（记录 warning）。
 */
export async function checkAIQuota(
  userId: string
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const limit = await getUserQuotaLimit(userId);
  try {
    const countStr = await redisClient.get(quotaKey(userId));
    const used = countStr ? parseInt(countStr, 10) : 0;
    const remaining = Math.max(0, limit - used);
    return {
      allowed: used < limit,
      remaining,
      limit,
    };
  } catch (error) {
    console.warn(
      'AI 配额检查失败，Redis 不可用，降级放行:',
      error instanceof Error ? error.message : error
    );
    return {
      allowed: true,
      remaining: limit,
      limit,
    };
  }
}

/**
 * 记录一次 AI 调用（递增当日计数）。
 * Redis 不可用时降级跳过（记录 warning）。
 */
export async function recordAIUsage(userId: string): Promise<void> {
  const key = quotaKey(userId);
  try {
    const count = await redisClient.incr(key);
    if (count === 1) {
      // 首次记录：设置 TTL 到当日 23:59:59
      await redisClient.expire(key, getSecondsUntilEndOfDay());
    }
  } catch (error) {
    console.warn(
      '记录 AI 调用失败，Redis 不可用，降级处理:',
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * 获取用户当日配额使用状态。
 * Redis 不可用时降级返回 used=0（记录 warning）。
 */
export async function getAIQuotaStatus(
  userId: string
): Promise<{ used: number; limit: number; remaining: number }> {
  const limit = await getUserQuotaLimit(userId);
  try {
    const countStr = await redisClient.get(quotaKey(userId));
    const used = countStr ? parseInt(countStr, 10) : 0;
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
    };
  } catch (error) {
    console.warn(
      '获取 AI 配额状态失败，Redis 不可用，降级处理:',
      error instanceof Error ? error.message : error
    );
    return {
      used: 0,
      limit,
      remaining: limit,
    };
  }
}
