jest.mock('../app', () => ({
  prisma: {
    asset: {
      findMany: jest.fn(),
    },
    liability: {
      findMany: jest.fn(),
    },
    family: {
      findMany: jest.fn(),
    },
    netWorthHistory: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from '../app';
import {
  takeSnapshot,
  getHistory,
  getLatestSnapshot,
  syncAllFamiliesNetWorth,
} from './netWorthService';

const mockedPrisma = prisma as any;

describe('netWorthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('takeSnapshot', () => {
    test('正确汇总资产和负债（无 symbol 回退 value）', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', type: 'CASH', value: 5000, symbol: null, quantity: null, marketPrice: null },
        { id: 'a2', type: 'STOCK', value: 1000, symbol: null, quantity: null, marketPrice: null },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([
        { id: 'l1', type: 'CREDIT_CARD', amount: 2000 },
      ]);
      mockedPrisma.netWorthHistory.upsert.mockResolvedValue({});

      const snapshot = await takeSnapshot('fam_1');

      expect(snapshot.familyId).toBe('fam_1');
      expect(snapshot.totalAssets).toBe(6000); // 5000 + 1000
      expect(snapshot.totalLiabilities).toBe(2000);
      expect(snapshot.netWorth).toBe(4000); // 6000 - 2000
      expect(snapshot.assetBreakdown.CASH).toBe(5000);
      expect(snapshot.assetBreakdown.STOCK).toBe(1000);
      expect(mockedPrisma.netWorthHistory.upsert).toHaveBeenCalledTimes(1);
      const upsertArgs = mockedPrisma.netWorthHistory.upsert.mock.calls[0][0];
      expect(upsertArgs.where.familyId_date.familyId).toBe('fam_1');
      expect(upsertArgs.where.familyId_date.date).toBeInstanceOf(Date);
      expect(upsertArgs.create.totalAssets).toBe(6000);
      expect(upsertArgs.create.totalLiabilities).toBe(2000);
      expect(upsertArgs.create.netWorth).toBe(4000);
      expect(upsertArgs.create.assetBreakdown).toEqual({ CASH: 5000, STOCK: 1000 });
    });

    test('有 marketPrice 的资产用市价计算', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'STOCK',
          value: 1000, // 旧 value，应被忽略
          symbol: 'sh600519',
          quantity: 100,
          marketPrice: 50,
        },
        { id: 'a2', type: 'CASH', value: 5000, symbol: null, quantity: null, marketPrice: null },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      mockedPrisma.netWorthHistory.upsert.mockResolvedValue({});

      const snapshot = await takeSnapshot('fam_1');

      // STOCK: marketPrice(50) * quantity(100) = 5000
      // CASH: value 5000
      expect(snapshot.totalAssets).toBe(10000);
      expect(snapshot.assetBreakdown.STOCK).toBe(5000);
      expect(snapshot.assetBreakdown.CASH).toBe(5000);
    });

    test('marketPrice 为 null 时回退用 value', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'STOCK',
          value: 3000,
          symbol: 'sh600519',
          quantity: 100,
          marketPrice: null,
        },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      mockedPrisma.netWorthHistory.upsert.mockResolvedValue({});

      const snapshot = await takeSnapshot('fam_1');

      expect(snapshot.totalAssets).toBe(3000);
      expect(snapshot.assetBreakdown.STOCK).toBe(3000);
    });

    test('upsert 不重复创建（同日再次触发走 update 分支）', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      const existing = {
        id: 'nwh_1',
        familyId: 'fam_1',
        date: new Date(),
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
        assetBreakdown: {},
      };
      mockedPrisma.netWorthHistory.upsert.mockResolvedValue(existing);

      await takeSnapshot('fam_1');
      await takeSnapshot('fam_1');

      // 两次 takeSnapshot 都应调用 upsert，每次 1 次
      expect(mockedPrisma.netWorthHistory.upsert).toHaveBeenCalledTimes(2);
      // 第二次调用也应包含 update 分支
      const secondCallArgs = mockedPrisma.netWorthHistory.upsert.mock.calls[1][0];
      expect(secondCallArgs.update).toBeDefined();
      expect(secondCallArgs.update.totalAssets).toBe(0);
      expect(secondCallArgs.update.netWorth).toBe(0);
    });
  });

  describe('getHistory', () => {
    test('返回时间序列数据（按日期升序）', async () => {
      const startDate = new Date('2026-07-01');
      const endDate = new Date('2026-07-23');
      const records = [
        {
          id: 'n1',
          familyId: 'fam_1',
          date: new Date('2026-07-01'),
          totalAssets: 10000,
          totalLiabilities: 2000,
          netWorth: 8000,
          assetBreakdown: { CASH: 10000 },
        },
        {
          id: 'n2',
          familyId: 'fam_1',
          date: new Date('2026-07-02'),
          totalAssets: 11000,
          totalLiabilities: 2000,
          netWorth: 9000,
          assetBreakdown: { CASH: 11000 },
        },
      ];
      mockedPrisma.netWorthHistory.findMany.mockResolvedValue(records);

      const history = await getHistory('fam_1', startDate, endDate);

      expect(history).toHaveLength(2);
      expect(history[0].date).toEqual(new Date('2026-07-01'));
      expect(history[1].date).toEqual(new Date('2026-07-02'));
      expect(history[0].totalAssets).toBe(10000);
      expect(history[1].netWorth).toBe(9000);
      expect(mockedPrisma.netWorthHistory.findMany).toHaveBeenCalledWith({
        where: {
          familyId: 'fam_1',
          date: { gte: startDate, lte: endDate },
        },
        orderBy: { date: 'asc' },
      });
    });
  });

  describe('getLatestSnapshot', () => {
    test('返回最近一条快照', async () => {
      const latest = {
        id: 'n1',
        familyId: 'fam_1',
        date: new Date('2026-08-19'),
        totalAssets: 50000,
        totalLiabilities: 10000,
        netWorth: 40000,
        assetBreakdown: { STOCK: 50000 },
      };
      mockedPrisma.netWorthHistory.findFirst.mockResolvedValue(latest);

      const result = await getLatestSnapshot('fam_1');

      expect(result).not.toBeNull();
      expect(result!.totalAssets).toBe(50000);
      expect(result!.netWorth).toBe(40000);
      expect(result!.assetBreakdown.STOCK).toBe(50000);
      expect(mockedPrisma.netWorthHistory.findFirst).toHaveBeenCalledWith({
        where: { familyId: 'fam_1' },
        orderBy: { date: 'desc' },
      });
    });

    test('无历史数据时返回 null', async () => {
      mockedPrisma.netWorthHistory.findFirst.mockResolvedValue(null);

      const result = await getLatestSnapshot('fam_1');

      expect(result).toBeNull();
    });
  });

  describe('syncAllFamiliesNetWorth', () => {
    test('汇总所有家庭的快照成功/失败统计', async () => {
      mockedPrisma.family.findMany.mockResolvedValue([
        { id: 'fam_1', name: 'Family 1' },
        { id: 'fam_2', name: 'Family 2' },
        { id: 'fam_3', name: 'Family 3' },
      ]);
      mockedPrisma.asset.findMany.mockResolvedValue([]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      mockedPrisma.netWorthHistory.upsert.mockResolvedValue({});

      // 让 fam_2 的 upsert 失败
      mockedPrisma.netWorthHistory.upsert
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DB down'))
        .mockResolvedValueOnce({});

      const result = await syncAllFamiliesNetWorth();

      expect(result.total).toBe(3);
      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
    });
  });
});
