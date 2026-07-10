import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { rateLimitMiddleware } from './rateLimit';

jest.mock('../config/redis', () => ({
  redisClient: {
    multi: jest.fn(),
    isOpen: true,
  },
}));

import { redisClient } from '../config/redis';

const mockedRedis = redisClient as any;

describe('rateLimitMiddleware', () => {
  let app: express.Express;
  let multiChain: any;

  beforeEach(() => {
    jest.clearAllMocks();
    multiChain = {
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };
    mockedRedis.multi.mockReturnValue(multiChain);

    app = express();
    app.use(express.json());
    app.use('/api/ai', rateLimitMiddleware(20, 60), (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
  });

  test('allows request when under limit', async () => {
    multiChain.exec.mockResolvedValue([1, 1]);

    const res = await request(app)
      .get('/api/ai/chat')
      .set('x-forwarded-for', '1.2.3.4');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('rejects request when over limit', async () => {
    multiChain.exec.mockResolvedValue([21, 1]);

    const res = await request(app)
      .get('/api/ai/chat')
      .set('x-forwarded-for', '1.2.3.4');

    expect(res.status).toBe(429);
    expect(res.body.error).toContain('请求过于频繁');
  });

  test('uses different keys for different IPs', async () => {
    multiChain.exec.mockResolvedValue([1, 1]);

    const res1 = await request(app).get('/api/ai/chat').set('x-forwarded-for', '1.2.3.4');
    const res2 = await request(app).get('/api/ai/chat').set('x-forwarded-for', '5.6.7.8');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(multiChain.incr).toHaveBeenCalledWith(expect.stringContaining('1.2.3.4'));
    expect(multiChain.incr).toHaveBeenCalledWith(expect.stringContaining('5.6.7.8'));
  });
});
