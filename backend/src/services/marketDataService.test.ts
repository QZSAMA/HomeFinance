jest.mock('../app', () => ({
  prisma: {
    marketData: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    asset: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from '../app';
import {
  getQuote,
  fetchQuoteFromSina,
  getQuotes,
  refreshAssetPrice,
  refreshAllAssetPrices,
} from './marketDataService';

const mockedPrisma = prisma as any;

// 新浪 A 股行情格式示例（字段顺序：name, open, yesterdayClose, current, high, low, ...）
const SINA_A_SHARE_RESPONSE =
  'var hq_str_sh600519="贵州茅台,1800.00,1795.00,1810.50,1820.00,1790.00,1810.50,1810.50,1234567,12345678,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-07-23,15:00:00,00";';

const cachedQuote = {
  id: 'md_1',
  symbol: 'sh600519',
  name: '贵州茅台',
  price: 1810.5,
  change: 15.5,
  changePercent: 0.8635,
  source: 'sina',
  date: new Date('2026-08-19T10:00:00Z'),
};

describe('marketDataService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('fetchQuoteFromSina', () => {
    test('正确解析 A 股格式行情数据', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => SINA_A_SHARE_RESPONSE,
      } as any);

      const quote = await fetchQuoteFromSina('sh600519');

      expect(quote.symbol).toBe('sh600519');
      expect(quote.name).toBe('贵州茅台');
      expect(quote.price).toBe(1810.5);
      expect(quote.change).toBe(15.5); // 1810.50 - 1795.00
      expect(quote.changePercent).toBeCloseTo(0.8635, 3); // 15.50 / 1795.00 * 100
      // 校验请求 URL 和 Referer 头
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://hq.sinajs.cn/list=sh600519');
      expect(options.headers.Referer).toBe('https://finance.sina.com.cn');
    });

    test('API 返回非 ok 时抛错', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Service Unavailable',
      } as any);

      await expect(fetchQuoteFromSina('sh600519')).rejects.toThrow(/行情/);
    });

    test('返回内容无法解析时抛错', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => 'var hq_str_sh600519="";',
      } as any);

      await expect(fetchQuoteFromSina('sh600519')).rejects.toThrow(/行情/);
    });
  });

  describe('getQuote', () => {
    test('缓存命中（当日 MarketData 记录）→ 返回缓存行情，不调 API', async () => {
      mockedPrisma.marketData.findFirst.mockImplementation((args: any) => {
        const dateFilter = args.where.date;
        if (dateFilter && dateFilter.gte) {
          return Promise.resolve(cachedQuote);
        }
        return Promise.resolve(null);
      });

      const quote = await getQuote('sh600519');

      expect(quote.symbol).toBe('sh600519');
      expect(quote.price).toBe(1810.5);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockedPrisma.marketData.create).not.toHaveBeenCalled();
    });

    test('缓存未命中 → 调用新浪 API 并写入缓存', async () => {
      mockedPrisma.marketData.findFirst.mockResolvedValue(null);
      mockedPrisma.marketData.create.mockResolvedValue({});
      fetchSpy.mockResolvedValue({
        ok: true,
        text: async () => SINA_A_SHARE_RESPONSE,
      } as any);

      const quote = await getQuote('sh600519');

      expect(quote.symbol).toBe('sh600519');
      expect(quote.price).toBe(1810.5);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.marketData.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          symbol: 'sh600519',
          name: '贵州茅台',
          price: 1810.5,
          source: 'sina',
        }),
      });
    });

    test('API 失败时降级查历史缓存', async () => {
      // 第一次 findFirst（当日缓存）返回 null；第二次（历史缓存）返回记录
      mockedPrisma.marketData.findFirst.mockImplementation((args: any) => {
        const dateFilter = args.where.date;
        if (dateFilter && dateFilter.gte) {
          return Promise.resolve(null); // 当日缓存未命中
        }
        if (dateFilter && dateFilter.lt) {
          return Promise.resolve({
            ...cachedQuote,
            date: new Date('2026-08-18T10:00:00Z'),
            price: 1800.0,
          }); // 历史缓存
        }
        return Promise.resolve(null);
      });
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Service Unavailable',
      } as any);

      const quote = await getQuote('sh600519');

      expect(quote.price).toBe(1800.0);
      // 应当查询了历史缓存（date < 今日）
      expect(mockedPrisma.marketData.findFirst).toHaveBeenCalledTimes(2);
    });

    test('API 抛出网络异常时也降级查历史缓存', async () => {
      mockedPrisma.marketData.findFirst.mockImplementation((args: any) => {
        const dateFilter = args.where.date;
        if (dateFilter && dateFilter.gte) {
          return Promise.resolve(null);
        }
        if (dateFilter && dateFilter.lt) {
          return Promise.resolve({ ...cachedQuote, price: 1795.0 });
        }
        return Promise.resolve(null);
      });
      fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

      const quote = await getQuote('sh600519');

      expect(quote.price).toBe(1795.0);
    });

    test('完全无数据时抛错', async () => {
      mockedPrisma.marketData.findFirst.mockResolvedValue(null);
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Service Unavailable',
      } as any);

      await expect(getQuote('sh600519')).rejects.toThrow(/无法获取行情数据.*sh600519/);
    });
  });

  describe('getQuotes', () => {
    test('批量获取行情（部分失败不影响整体）', async () => {
      // sh600519 缓存命中；invalid_symbol 全部失败
      mockedPrisma.marketData.findFirst.mockImplementation((args: any) => {
        const sym = args.where.symbol;
        if (sym === 'sh600519' && args.where.date.gte) {
          return Promise.resolve(cachedQuote);
        }
        return Promise.resolve(null);
      });
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'error',
      } as any);

      const quotes = await getQuotes(['sh600519', 'invalid_symbol']);

      expect(quotes).toHaveLength(1);
      expect(quotes[0].symbol).toBe('sh600519');
    });
  });

  describe('refreshAssetPrice', () => {
    test('资产未设置 symbol 时返回失败', async () => {
      mockedPrisma.asset.findUnique.mockResolvedValue({
        id: 'a1',
        name: '现金资产',
        symbol: null,
      });

      const result = await refreshAssetPrice('a1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('该资产未设置证券代码');
      expect(mockedPrisma.asset.update).not.toHaveBeenCalled();
    });

    test('资产不存在时返回失败', async () => {
      mockedPrisma.asset.findUnique.mockResolvedValue(null);

      const result = await refreshAssetPrice('a1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('资产不存在');
    });

    test('有 symbol 时成功更新 Asset 的 marketPrice 和 marketPriceDate', async () => {
      mockedPrisma.asset.findUnique.mockResolvedValue({
        id: 'a1',
        name: '茅台',
        symbol: 'sh600519',
      });
      mockedPrisma.marketData.findFirst.mockResolvedValue(cachedQuote);
      mockedPrisma.asset.update.mockResolvedValue({});

      const result = await refreshAssetPrice('a1');

      expect(result.success).toBe(true);
      expect(result.price).toBe(1810.5);
      expect(mockedPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: {
          marketPrice: 1810.5,
          marketPriceDate: expect.any(Date),
        },
      });
    });

    test('行情获取失败时返回失败', async () => {
      mockedPrisma.asset.findUnique.mockResolvedValue({
        id: 'a1',
        name: '茅台',
        symbol: 'sh600519',
      });
      mockedPrisma.marketData.findFirst.mockResolvedValue(null);
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'error',
      } as any);

      const result = await refreshAssetPrice('a1');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('refreshAllAssetPrices', () => {
    test('汇总更新结果（含成功和失败）', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', name: '茅台', symbol: 'sh600519' },
        { id: 'a2', name: '无效', symbol: 'invalid_symbol' },
      ]);
      // a1 缓存命中；a2 全部失败
      mockedPrisma.asset.findUnique.mockImplementation((args: any) => {
        if (args.where.id === 'a1') {
          return Promise.resolve({ id: 'a1', name: '茅台', symbol: 'sh600519' });
        }
        return Promise.resolve({ id: 'a2', name: '无效', symbol: 'invalid_symbol' });
      });
      mockedPrisma.marketData.findFirst.mockImplementation((args: any) => {
        if (args.where.symbol === 'sh600519' && args.where.date.gte) {
          return Promise.resolve(cachedQuote);
        }
        return Promise.resolve(null);
      });
      mockedPrisma.asset.update.mockResolvedValue({});
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'error',
      } as any);

      const result = await refreshAllAssetPrices('fam_1');

      expect(result.updated).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.details).toHaveLength(2);
      const successDetail = result.details.find((d: any) => d.assetId === 'a1')!;
      const failedDetail = result.details.find((d: any) => d.assetId === 'a2')!;
      expect(successDetail.success).toBe(true);
      expect(successDetail.price).toBe(1810.5);
      expect(failedDetail.success).toBe(false);
      expect(failedDetail.error).toBeDefined();
    });

    test('家庭无证券资产时返回空结果', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([]);

      const result = await refreshAllAssetPrices('fam_1');

      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.details).toHaveLength(0);
    });
  });
});
