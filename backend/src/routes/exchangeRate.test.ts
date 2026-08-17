import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import exchangeRateRoutes from './exchangeRate';

jest.mock('../services/exchangeRateService', () => ({
  getRate: jest.fn(),
  getSupportedCurrencies: jest.fn(),
  setManualRate: jest.fn(),
}));

import { getRate, getSupportedCurrencies, setManualRate } from '../services/exchangeRateService';

const mockedGetRate = getRate as jest.MockedFunction<typeof getRate>;
const mockedGetSupportedCurrencies = getSupportedCurrencies as jest.MockedFunction<typeof getSupportedCurrencies>;
const mockedSetManualRate = setManualRate as jest.MockedFunction<typeof setManualRate>;

const app = express();
app.use(express.json());
app.use('/api/exchange-rates', exchangeRateRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('ExchangeRate Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/exchange-rates', () => {
    test('返回支持的货币列表', async () => {
      mockedGetSupportedCurrencies.mockReturnValue([
        'CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD', 'SGD', 'AUD', 'CAD', 'KRW',
      ]);

      const res = await request(app).get('/api/exchange-rates');

      expect(res.status).toBe(200);
      expect(res.body.currencies).toEqual([
        'CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD', 'SGD', 'AUD', 'CAD', 'KRW',
      ]);
      expect(mockedGetSupportedCurrencies).toHaveBeenCalled();
    });
  });

  describe('GET /api/exchange-rates/rate', () => {
    test('返回指定币种对的汇率', async () => {
      mockedGetRate.mockResolvedValue(7.2);

      const res = await request(app)
        .get('/api/exchange-rates/rate')
        .query({ from: 'USD', to: 'CNY' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ from: 'USD', to: 'CNY', rate: 7.2 });
      expect(mockedGetRate).toHaveBeenCalledWith('USD', 'CNY', undefined);
    });

    test('缺少 from 参数返回 400', async () => {
      const res = await request(app)
        .get('/api/exchange-rates/rate')
        .query({ to: 'CNY' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockedGetRate).not.toHaveBeenCalled();
    });

    test('缺少 to 参数返回 400', async () => {
      const res = await request(app)
        .get('/api/exchange-rates/rate')
        .query({ from: 'USD' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockedGetRate).not.toHaveBeenCalled();
    });

    test('服务抛错时返回 500', async () => {
      mockedGetRate.mockRejectedValue(new Error('无法获取汇率 USD → XYZ'));

      const res = await request(app)
        .get('/api/exchange-rates/rate')
        .query({ from: 'USD', to: 'XYZ' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /api/exchange-rates/manual', () => {
    test('成功录入汇率', async () => {
      mockedSetManualRate.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/exchange-rates/manual')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ from: 'USD', to: 'CNY', rate: 7.3 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });
      expect(mockedSetManualRate).toHaveBeenCalledWith('USD', 'CNY', 7.3);
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .post('/api/exchange-rates/manual')
        .send({ from: 'USD', to: 'CNY', rate: 7.3 });

      expect(res.status).toBe(401);
      expect(mockedSetManualRate).not.toHaveBeenCalled();
    });

    test('缺少必要字段返回 400', async () => {
      const res = await request(app)
        .post('/api/exchange-rates/manual')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ from: 'USD', to: 'CNY' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockedSetManualRate).not.toHaveBeenCalled();
    });

    test('rate 非数字返回 400', async () => {
      const res = await request(app)
        .post('/api/exchange-rates/manual')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ from: 'USD', to: 'CNY', rate: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockedSetManualRate).not.toHaveBeenCalled();
    });

    test('服务抛错时返回 500', async () => {
      mockedSetManualRate.mockRejectedValue(new Error('数据库写入失败'));

      const res = await request(app)
        .post('/api/exchange-rates/manual')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ from: 'USD', to: 'CNY', rate: 7.3 });

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });
});
