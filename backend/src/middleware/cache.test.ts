import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { cacheMiddleware } from './cache';

jest.mock('../config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    setEx: jest.fn(),
    isOpen: true,
  },
}));

import { redisClient } from '../config/redis';

const mockedRedis = redisClient as any;

describe('cacheMiddleware', () => {
  let app: express.Express;
  let cacheState: { version: number } | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheState = { version: 3 };
    app = express();
    app.use('/api/families/:familyId/reports', (req: Request, _res: Response, next: NextFunction) => {
      (req as any).familyCacheState = cacheState;
      next();
    });
    app.use('/api/families/:familyId/reports', cacheMiddleware(60), (_req: Request, res: Response) => {
      res.json({ data: 'report_data', computed: true });
    });
  });

  test('returns cached data when cache hit', async () => {
    mockedRedis.get.mockResolvedValueOnce(JSON.stringify({ data: 'cached_data', computed: false }));

    const res = await request(app).get('/api/families/fam_1/reports/summary');

    expect(res.status).toBe(200);
    expect(res.body.data).toBe('cached_data');
    expect(mockedRedis.get).toHaveBeenCalledWith(
      'cache:family:v2:fam_1:v3:/api/families/fam_1/reports/summary'
    );
    expect(mockedRedis.setEx).not.toHaveBeenCalled();
  });

  test('computes and caches data when cache miss', async () => {
    mockedRedis.get.mockResolvedValue(null);
    mockedRedis.setEx.mockResolvedValue('OK');

    const res = await request(app).get('/api/families/fam_1/reports/summary');

    expect(res.status).toBe(200);
    expect(res.body.data).toBe('report_data');
    expect(mockedRedis.setEx).toHaveBeenCalledWith(
      'cache:family:v2:fam_1:v3:/api/families/fam_1/reports/summary',
      60,
      JSON.stringify({ data: 'report_data', computed: true })
    );
  });

  test('skips cache for non-GET requests', async () => {
    app.use('/api/families/:familyId/data', cacheMiddleware(60), (_req: Request, res: Response) => {
      res.json({ created: true });
    });

    const res = await request(app).post('/api/families/fam_1/data').send({});

    expect(res.status).toBe(200);
    expect(mockedRedis.get).not.toHaveBeenCalled();
    expect(mockedRedis.setEx).not.toHaveBeenCalled();
  });

  test('does not cache an error response as a successful cache hit', async () => {
    const cacheStore = new Map<string, string>();
    let attempts = 0;
    mockedRedis.get.mockImplementation(async (key: string) => cacheStore.get(key) ?? null);
    mockedRedis.setEx.mockImplementation(async (key: string, _ttl: number, value: string) => {
      cacheStore.set(key, value);
      return 'OK';
    });

    const failingApp = express();
    failingApp.use(
      '/api/families/:familyId/reports',
      (req: Request, _res: Response, next: NextFunction) => {
        (req as any).familyCacheState = { version: 3 };
        next();
      },
    );
    failingApp.use(
      '/api/families/:familyId/reports',
      cacheMiddleware(60),
      (_req: Request, res: Response) => {
        attempts += 1;
        if (attempts === 1) {
          return res.status(500).json({ error: 'temporary database failure' });
        }
        return res.json({ data: 'fresh_report' });
      },
    );

    const failed = await request(failingApp).get('/api/families/fam_1/reports/summary');
    const recovered = await request(failingApp).get('/api/families/fam_1/reports/summary');

    expect(failed.status).toBe(500);
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual({ data: 'fresh_report' });
    expect(recovered.headers['x-cache']).toBe('MISS');
    expect(attempts).toBe(2);
  });

  test('uses the durable family revision instead of a stale Redis revision after a process restart', async () => {
    cacheState = { version: 7 };
    const staleKey = 'cache:family:fam_1:v0:/api/families/fam_1/reports/summary';
    const freshKey = 'cache:family:v2:fam_1:v7:/api/families/fam_1/reports/summary';
    const cacheStore = new Map<string, string>([
      ['cache:family:fam_1:version', '0'],
      [staleKey, JSON.stringify({ data: 'stale_report', computed: false })],
    ]);
    mockedRedis.get.mockImplementation(async (key: string) => cacheStore.get(key) ?? null);
    mockedRedis.setEx.mockResolvedValue('OK');

    const res = await request(app).get('/api/families/fam_1/reports/summary');

    expect(res.body).toEqual({ data: 'report_data', computed: true });
    expect(res.headers['x-cache']).toBe('MISS');
    expect(mockedRedis.get).toHaveBeenCalledWith(freshKey);
    expect(mockedRedis.get).not.toHaveBeenCalledWith(staleKey);
  });

  test('fails safe when the authorized request has no durable family revision', async () => {
    cacheState = undefined;
    mockedRedis.get.mockResolvedValue(JSON.stringify({ data: 'stale_report', computed: false }));

    const res = await request(app).get('/api/families/fam_1/reports/summary');

    expect(res.body).toEqual({ data: 'report_data', computed: true });
    expect(res.headers['x-cache']).toBeUndefined();
    expect(mockedRedis.get).not.toHaveBeenCalled();
    expect(mockedRedis.setEx).not.toHaveBeenCalled();
  });
});
