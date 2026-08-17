jest.mock('../app', () => ({
  prisma: {
    exchangeRate: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { prisma } from '../app';
import {
  getRate,
  convertToCNY,
  convertAmount,
  getSupportedCurrencies,
  setManualRate,
} from './exchangeRateService';

const mockedPrisma = prisma as any;

describe('exchangeRateService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('getRate', () => {
    test('同币种直接返回 1，不查数据库不调 API', async () => {
      const rate = await getRate('CNY', 'CNY');
      expect(rate).toBe(1);
      expect(mockedPrisma.exchangeRate.findUnique).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test('缓存命中（当日 ExchangeRate 记录）→ 返回缓存汇率，不调 API', async () => {
      mockedPrisma.exchangeRate.findUnique.mockResolvedValue({
        id: 'rate_1',
        from: 'USD',
        to: 'CNY',
        rate: 7.18,
        date: new Date('2024-01-15'),
        source: 'exchangerate-api',
      });

      const rate = await getRate('USD', 'CNY', new Date('2024-01-15T10:00:00Z'));

      expect(rate).toBe(7.18);
      expect(mockedPrisma.exchangeRate.findUnique).toHaveBeenCalledWith({
        where: {
          from_to_date: {
            from: 'USD',
            to: 'CNY',
            date: expect.any(Date),
          },
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test('缓存未命中 → 调用外部 API 并写入缓存', async () => {
      mockedPrisma.exchangeRate.findUnique.mockResolvedValue(null);
      mockedPrisma.exchangeRate.create.mockResolvedValue({});
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { CNY: 7.25 } }),
      } as any);

      const rate = await getRate('USD', 'CNY', new Date('2024-01-15T10:00:00Z'));

      expect(rate).toBe(7.25);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.exchangerate-api.com/v4/latest/USD');
      expect(mockedPrisma.exchangeRate.create).toHaveBeenCalledWith({
        data: {
          from: 'USD',
          to: 'CNY',
          rate: 7.25,
          date: expect.any(Date),
          source: 'exchangerate-api',
        },
      });
    });

    test('API 失败时降级查历史缓存', async () => {
      mockedPrisma.exchangeRate.findUnique.mockResolvedValue(null);
      mockedPrisma.exchangeRate.findFirst.mockResolvedValue({
        id: 'rate_old',
        from: 'USD',
        to: 'CNY',
        rate: 7.1,
        date: new Date('2024-01-10'),
        source: 'exchangerate-api',
      });
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Service Unavailable',
      } as any);

      const rate = await getRate('USD', 'CNY', new Date('2024-01-15T10:00:00Z'));

      expect(rate).toBe(7.1);
      expect(mockedPrisma.exchangeRate.findFirst).toHaveBeenCalledWith({
        where: {
          from: 'USD',
          to: 'CNY',
          date: expect.any(Object),
        },
        orderBy: { date: 'desc' },
      });
    });

    test('API 抛出网络异常时也降级查历史缓存', async () => {
      mockedPrisma.exchangeRate.findUnique.mockResolvedValue(null);
      mockedPrisma.exchangeRate.findFirst.mockResolvedValue({
        id: 'rate_old',
        from: 'USD',
        to: 'CNY',
        rate: 7.05,
        date: new Date('2024-01-08'),
        source: 'manual',
      });
      fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

      const rate = await getRate('USD', 'CNY', new Date('2024-01-15T10:00:00Z'));

      expect(rate).toBe(7.05);
      expect(mockedPrisma.exchangeRate.findFirst).toHaveBeenCalled();
    });

    test('完全无数据时抛错', async () => {
      mockedPrisma.exchangeRate.findUnique.mockResolvedValue(null);
      mockedPrisma.exchangeRate.findFirst.mockResolvedValue(null);
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Service Unavailable',
      } as any);

      await expect(
        getRate('USD', 'CNY', new Date('2024-01-15T10:00:00Z'))
      ).rejects.toThrow(/无法获取汇率/);
    });
  });

  describe('convertToCNY', () => {
    test('同币种（CNY）直接返回原值', async () => {
      const result = await convertToCNY(100, 'CNY');
      expect(result).toBe(100);
      expect(mockedPrisma.exchangeRate.findUnique).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test('跨币种正确换算（USD → CNY）', async () => {
      mockedPrisma.exchangeRate.findUnique.mockResolvedValue({
        id: 'rate_1',
        from: 'USD',
        to: 'CNY',
        rate: 7.2,
        date: new Date('2024-01-15'),
        source: 'exchangerate-api',
      });

      const result = await convertToCNY(100, 'USD', new Date('2024-01-15T10:00:00Z'));

      expect(result).toBe(720);
    });
  });

  describe('convertAmount', () => {
    test('同币种直接返回原值', async () => {
      const result = await convertAmount(50, 'USD', 'USD');
      expect(result).toBe(50);
    });

    test('跨币种换算（USD → CNY）', async () => {
      mockedPrisma.exchangeRate.findUnique.mockResolvedValue({
        id: 'rate_1',
        from: 'USD',
        to: 'CNY',
        rate: 7.2,
        date: new Date('2024-01-15'),
        source: 'exchangerate-api',
      });

      const result = await convertAmount(50, 'USD', 'CNY', new Date('2024-01-15T10:00:00Z'));

      expect(result).toBe(360);
    });
  });

  describe('getSupportedCurrencies', () => {
    test('返回预期的货币列表', () => {
      const list = getSupportedCurrencies();
      expect(list).toEqual([
        'CNY', 'USD', 'EUR', 'JPY', 'GBP', 'HKD', 'SGD', 'AUD', 'CAD', 'KRW',
      ]);
    });
  });

  describe('setManualRate', () => {
    test('手动录入汇率写入数据库', async () => {
      mockedPrisma.exchangeRate.upsert.mockResolvedValue({});

      await setManualRate('USD', 'CNY', 7.3);

      expect(mockedPrisma.exchangeRate.upsert).toHaveBeenCalledWith({
        where: {
          from_to_date: {
            from: 'USD',
            to: 'CNY',
            date: expect.any(Date),
          },
        },
        update: {
          rate: 7.3,
          source: 'manual',
        },
        create: {
          from: 'USD',
          to: 'CNY',
          rate: 7.3,
          date: expect.any(Date),
          source: 'manual',
        },
      });
    });
  });
});
