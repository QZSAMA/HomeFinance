import request from 'supertest';
import express, { Request, Response } from 'express';
import { requestIdMiddleware } from './requestId';
import { getRequestId, _clearRequestId } from '../utils/logger';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('requestIdMiddleware', () => {
  let app: express.Express;

  beforeEach(() => {
    _clearRequestId();
    app = express();
    app.use(requestIdMiddleware);
    app.get('/test', (_req: Request, res: Response) => {
      res.json({ requestId: getRequestId() });
    });
  });

  afterEach(() => {
    _clearRequestId();
  });

  test('响应头包含 X-Request-Id', async () => {
    const res = await request(app).get('/test');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  test('不带 X-Request-Id 请求头时生成新的 UUID', async () => {
    const res = await request(app).get('/test');
    const reqId = res.headers['x-request-id'];

    expect(typeof reqId).toBe('string');
    expect(reqId).toMatch(UUID_V4_REGEX);
  });

  test('请求头带 X-Request-Id 时沿用它', async () => {
    const customId = 'custom-request-id-abc-123';
    const res = await request(app).get('/test').set('X-Request-Id', customId);

    expect(res.headers['x-request-id']).toBe(customId);
  });

  test('不同请求的 requestId 不同', async () => {
    const res1 = await request(app).get('/test');
    const res2 = await request(app).get('/test');

    const id1 = res1.headers['x-request-id'];
    const id2 = res2.headers['x-request-id'];

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  test('请求处理过程中 getRequestId 可访问当前请求的 id', async () => {
    const customId = 'trace-id-xyz';
    const res = await request(app).get('/test').set('X-Request-Id', customId);

    expect(res.body.requestId).toBe(customId);
  });

  test('未带请求头时，处理过程中 getRequestId 返回生成的 UUID', async () => {
    const res = await request(app).get('/test');

    const headerId = res.headers['x-request-id'];
    expect(res.body.requestId).toBe(headerId);
    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });
});
