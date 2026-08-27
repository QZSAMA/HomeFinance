import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';
import { familyReportCacheKey } from './familyCache';
import { FamilyAccessRequest } from './familyAccess';

export const cacheMiddleware = (ttlSeconds: number = 300) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next();
    }

    if (typeof redisClient.isReady === 'boolean' && !redisClient.isReady) {
      return next();
    }

    try {
      const familyId = req.params.familyId as string | undefined;
      const familyCacheState = (req as FamilyAccessRequest).familyCacheState;
      if (familyId && (
        !familyCacheState
        || !Number.isSafeInteger(familyCacheState.version)
        || familyCacheState.version < 0
      )) {
        return next();
      }
      const cacheKey = familyId
        ? familyReportCacheKey(familyId, String(familyCacheState!.version), req.originalUrl)
        : `cache:${req.originalUrl}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }

      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redisClient.setEx(cacheKey, ttlSeconds, JSON.stringify(body)).catch((err) => {
            console.error('Redis cache set error:', err);
          });
        }
        res.setHeader('X-Cache', 'MISS');
        return originalJson(body);
      };

      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      next();
    }
  };
};
