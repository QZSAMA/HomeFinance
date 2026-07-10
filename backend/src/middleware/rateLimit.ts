import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';

export interface RateLimitRequest extends Request {
  userId?: string;
}

export const rateLimitMiddleware = (maxRequests: number, windowSeconds: number) => {
  return async (req: RateLimitRequest, res: Response, next: NextFunction) => {
    const identifier =
      req.userId ||
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      'unknown';

    const key = `ratelimit:${identifier}:${req.route?.path || req.path}`;

    try {
      const multi = redisClient.multi();
      multi.incr(key);
      multi.expire(key, windowSeconds);
      const results = await multi.exec();

      const count = results?.[0] as number;

      if (count > maxRequests) {
        return res.status(429).json({
          error: `请求过于频繁，请 ${windowSeconds} 秒后再试`,
        });
      }

      next();
    } catch (error) {
      console.error('Rate limit middleware error:', error);
      next();
    }
  };
};
