import request from 'supertest';
import { createApp } from './app';

describe('Phase 1 ledger CORS contract', () => {
  test('exposes Idempotency-Replayed to browser clients', async () => {
    const response = await request(createApp())
      .get('/api/health')
      .set('Origin', 'http://localhost:3000');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-expose-headers'])
      .toContain('Idempotency-Replayed');
  });
});
