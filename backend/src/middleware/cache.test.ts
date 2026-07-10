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

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use('/api/families/:familyId/reports', cacheMiddleware(60), (_req: Request, res: Response) => {
      res.json({ data: 'report_data', computed: true });
    });
  });

  test('returns cached data when cache hit', async () => {
    mockedRedis.get.mockResolvedValue(JSON.stringify({ data: 'cached_data', computed: false }));

    const res = await request(app).get('/api/families/fam_1/reports/summary');

    expect(res.status).toBe(200);
    expect(res.body.data).toBe('cached_data');
    expect(mockedRedis.get).toHaveBeenCalledWith('cache:/api/families/fam_1/reports/summary');
    expect(mockedRedis.setEx).not.toHaveBeenCalled();
  });

  test('computes and caches data when cache miss', async () => {
    mockedRedis.get.mockResolvedValue(null);
    mockedRedis.setEx.mockResolvedValue('OK');

    const res = await request(app).get('/api/families/fam_1/reports/summary');

    expect(res.status).toBe(200);
    expect(res.body.data).toBe('report_data');
    expect(mockedRedis.setEx).toHaveBeenCalledWith(
      'cache:/api/families/fam_1/reports/summary',
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
});
