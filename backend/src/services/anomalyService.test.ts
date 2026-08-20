jest.mock('../app', () => ({
  prisma: {
    expense: {
      findMany: jest.fn(),
    },
    family: {
      findMany: jest.fn(),
    },
    anomalyAlert: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

// V4.4：告警保存后异步触发通知分发（mock 掉避免依赖真实分发逻辑）
jest.mock('./notificationDispatcher', () => ({
  dispatchAlert: jest.fn().mockResolvedValue({ alertId: '', deliveries: [] }),
}));

import { prisma } from '../app';
import {
  detectAnomalies,
  detectAndSaveAnomalies,
  detectAnomaliesForAll,
} from './anomalyService';
import { dispatchAlert } from './notificationDispatcher';

const mockedPrisma = prisma as any;
const mockedDispatchAlert = dispatchAlert as jest.MockedFunction<
  typeof dispatchAlert
>;

// 固定系统时间：2026-08-15 12:00（本地时间，本月已过半）
const NOW = new Date(2026, 7, 15, 12, 0, 0);

function daysAgo(days: number, hour = 10): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function makeExpense(overrides: { id: string } & Record<string, unknown>) {
  return {
    familyId: 'fam_1',
    createdBy: 'user_1',
    category: '餐饮',
    amount: 100,
    description: '日常支出',
    paymentMethod: null,
    date: daysAgo(1),
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  };
}

describe('anomalyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('detectAnomalies — LARGE_EXPENSE', () => {
    test('单笔支出超过均值 3 倍且大于 500 → 检测到 HIGH', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 200, description: '早餐', date: daysAgo(35) }),
        makeExpense({ id: 'e2', amount: 150, description: '午餐', date: daysAgo(30) }),
        makeExpense({ id: 'e3', amount: 150, description: '晚餐', date: daysAgo(25) }),
        makeExpense({ id: 'e4', amount: 1200, description: '大家电', date: daysAgo(1) }),
      ]);

      const anomalies = await detectAnomalies('fam_1');

      const large = anomalies.find((a) => a.type === 'LARGE_EXPENSE');
      expect(large).toBeDefined();
      expect(large!.severity).toBe('HIGH');
      expect(large!.amount).toBe(1200);
      expect(large!.expenseId).toBe('e4');
      expect(large!.description).toBe('单笔支出 1200 元，超过近90天均值 166.67 元的 3 倍');
      expect(mockedPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ familyId: 'fam_1' }),
        })
      );
    });

    test('支出超过 500 但未超均值 3 倍 → 不检测', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 700, description: '采购一', date: daysAgo(30) }),
        makeExpense({ id: 'e2', amount: 700, description: '采购二', date: daysAgo(20) }),
        makeExpense({ id: 'e3', amount: 700, description: '采购三', date: daysAgo(10) }),
        makeExpense({ id: 'e4', amount: 2000, description: '大采购', date: daysAgo(1) }),
      ]);

      const anomalies = await detectAnomalies('fam_1');

      expect(anomalies.filter((a) => a.type === 'LARGE_EXPENSE')).toHaveLength(0);
    });

    test('支出超均值 3 倍但小于 500 → 不检测', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 100, description: '早餐', date: daysAgo(30) }),
        makeExpense({ id: 'e2', amount: 100, description: '午餐', date: daysAgo(20) }),
        makeExpense({ id: 'e3', amount: 100, description: '晚餐', date: daysAgo(10) }),
        makeExpense({ id: 'e4', amount: 400, description: '四百元支出', date: daysAgo(1) }),
      ]);

      const anomalies = await detectAnomalies('fam_1');

      expect(anomalies.filter((a) => a.type === 'LARGE_EXPENSE')).toHaveLength(0);
    });
  });

  describe('detectAnomalies — FREQUENCY_SPIKE', () => {
    test('某品类当日 5 次且日均 0.5 次 → 检测到 MEDIUM', async () => {
      // 当日 5 笔（8 月 15 日）
      const today = [
        makeExpense({ id: 't1', amount: 30, description: '早餐', date: daysAgo(0, 8) }),
        makeExpense({ id: 't2', amount: 30, description: '午餐', date: daysAgo(0, 9) }),
        makeExpense({ id: 't3', amount: 30, description: '加餐', date: daysAgo(0, 10) }),
        makeExpense({ id: 't4', amount: 30, description: '饮料', date: daysAgo(0, 11) }),
        makeExpense({ id: 't5', amount: 30, description: '晚餐', date: daysAgo(0, 11) }),
      ];
      // 历史 40 笔（5 月 20 日 ~ 6 月 28 日，每日 1 笔），总计 45 笔，日均 0.5 次
      const history = Array.from({ length: 40 }, (_, i) =>
        makeExpense({
          id: `h${i}`,
          amount: 30,
          description: `历史支出${i}`,
          date: new Date(2026, 4, 20 + i, 10, 0, 0),
        })
      );

      mockedPrisma.expense.findMany.mockResolvedValue([...today, ...history]);

      const anomalies = await detectAnomalies('fam_1');

      const spike = anomalies.find((a) => a.type === 'FREQUENCY_SPIKE');
      expect(spike).toBeDefined();
      expect(spike!.severity).toBe('MEDIUM');
      expect(spike!.category).toBe('餐饮');
      expect(spike!.description).toBe('餐饮 今日已支出 5 次，日均仅 0.5 次');
    });

    test('当日 5 次但日均也有 2 次（未达 5 倍）→ 不检测', async () => {
      const today = [
        makeExpense({ id: 't1', amount: 30, description: '早餐', date: daysAgo(0, 8) }),
        makeExpense({ id: 't2', amount: 30, description: '午餐', date: daysAgo(0, 9) }),
        makeExpense({ id: 't3', amount: 30, description: '加餐', date: daysAgo(0, 10) }),
        makeExpense({ id: 't4', amount: 30, description: '饮料', date: daysAgo(0, 11) }),
        makeExpense({ id: 't5', amount: 30, description: '晚餐', date: daysAgo(0, 11) }),
      ];
      // 历史 175 笔（5 月 18 日 ~ 7 月 15 日，每日 3 笔），总计 180 笔，日均 2 次
      const history = Array.from({ length: 175 }, (_, i) =>
        makeExpense({
          id: `h${i}`,
          amount: 30,
          description: `历史支出${i}`,
          date: new Date(2026, 4, 18 + Math.floor(i / 3), 10, 0, 0),
        })
      );

      mockedPrisma.expense.findMany.mockResolvedValue([...today, ...history]);

      const anomalies = await detectAnomalies('fam_1');

      expect(anomalies.filter((a) => a.type === 'FREQUENCY_SPIKE')).toHaveLength(0);
    });
  });

  describe('detectAnomalies — CATEGORY_SURGE', () => {
    test('本月已过半，本月 3000 上月 800 → 检测到 MEDIUM', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 800, description: '上月聚会', date: daysAgo(26) }), // 7 月 20 日
        makeExpense({ id: 'e2', amount: 1000, description: '本月聚餐一', date: daysAgo(10) }),
        makeExpense({ id: 'e3', amount: 1000, description: '本月聚餐二', date: daysAgo(5) }),
        makeExpense({ id: 'e4', amount: 1000, description: '本月聚餐三', date: daysAgo(1) }),
      ]);

      const anomalies = await detectAnomalies('fam_1');

      const surge = anomalies.find((a) => a.type === 'CATEGORY_SURGE');
      expect(surge).toBeDefined();
      expect(surge!.severity).toBe('MEDIUM');
      expect(surge!.category).toBe('餐饮');
      expect(surge!.amount).toBe(3000);
      expect(surge!.description).toBe('餐饮 本月已支出 3000 元，上月全月仅 800 元');
    });

    test('本月支出未超上月 3 倍 → 不检测', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 750, description: '上月聚会一', date: daysAgo(26) }),
        makeExpense({ id: 'e2', amount: 750, description: '上月聚会二', date: daysAgo(25) }),
        makeExpense({ id: 'e3', amount: 1000, description: '本月聚餐一', date: daysAgo(10) }),
        makeExpense({ id: 'e4', amount: 1000, description: '本月聚餐二', date: daysAgo(5) }),
        makeExpense({ id: 'e5', amount: 1000, description: '本月聚餐三', date: daysAgo(1) }),
      ]);

      const anomalies = await detectAnomalies('fam_1');

      expect(anomalies.filter((a) => a.type === 'CATEGORY_SURGE')).toHaveLength(0);
    });
  });

  describe('detectAnomalies — DUPLICATE', () => {
    test('7 天内 3 笔同金额同描述 → 检测到一条 MEDIUM', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 99.9, description: '星巴克咖啡', date: daysAgo(4) }),
        makeExpense({ id: 'e2', amount: 99.9, description: '星巴克咖啡', date: daysAgo(3) }),
        makeExpense({ id: 'e3', amount: 99.9, description: '星巴克咖啡', date: daysAgo(2) }),
      ]);

      const anomalies = await detectAnomalies('fam_1');

      const duplicates = anomalies.filter((a) => a.type === 'DUPLICATE');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].severity).toBe('MEDIUM');
      expect(duplicates[0].amount).toBe(99.9);
      expect(duplicates[0].description).toBe('发现 3 笔相同支出：星巴克咖啡，各 99.9 元');
    });

    test('不同金额 → 不检测', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 99.9, description: '星巴克咖啡', date: daysAgo(4) }),
        makeExpense({ id: 'e2', amount: 89.9, description: '星巴克咖啡', date: daysAgo(3) }),
        makeExpense({ id: 'e3', amount: 109.9, description: '星巴克咖啡', date: daysAgo(2) }),
      ]);

      const anomalies = await detectAnomalies('fam_1');

      expect(anomalies.filter((a) => a.type === 'DUPLICATE')).toHaveLength(0);
    });
  });

  describe('detectAndSaveAnomalies', () => {
    test('24 小时内同 expenseId+type 去重，不重复保存', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 200, description: '早餐', date: daysAgo(35) }),
        makeExpense({ id: 'e2', amount: 150, description: '午餐', date: daysAgo(30) }),
        makeExpense({ id: 'e3', amount: 150, description: '晚餐', date: daysAgo(25) }),
        makeExpense({ id: 'e4', amount: 1200, description: '大家电', date: daysAgo(1) }),
      ]);
      // 近 24 小时内已存在同 expenseId+type 的告警
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([
        {
          type: 'LARGE_EXPENSE',
          expenseId: 'e4',
          title: '大额支出提醒',
          amount: 1200,
        },
      ]);
      mockedPrisma.anomalyAlert.create.mockResolvedValue({});

      const result = await detectAndSaveAnomalies('fam_1');

      expect(result.detected).toBe(1);
      expect(result.saved).toBe(0);
      expect(mockedPrisma.anomalyAlert.create).not.toHaveBeenCalled();
    });

    test('无已存在告警时保存新记录', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 200, description: '早餐', date: daysAgo(35) }),
        makeExpense({ id: 'e2', amount: 150, description: '午餐', date: daysAgo(30) }),
        makeExpense({ id: 'e3', amount: 150, description: '晚餐', date: daysAgo(25) }),
        makeExpense({ id: 'e4', amount: 1200, description: '大家电', date: daysAgo(1) }),
      ]);
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
      mockedPrisma.anomalyAlert.create.mockResolvedValue({});

      const result = await detectAndSaveAnomalies('fam_1');

      expect(result.detected).toBe(1);
      expect(result.saved).toBe(1);
      expect(mockedPrisma.anomalyAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          familyId: 'fam_1',
          type: 'LARGE_EXPENSE',
          severity: 'HIGH',
          title: '大额支出提醒',
          amount: 1200,
          expenseId: 'e4',
          category: '餐饮',
        }),
        include: { family: true },
      });
    });

    test('保存告警后异步触发通知分发（携带 family）', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 200, description: '早餐', date: daysAgo(35) }),
        makeExpense({ id: 'e2', amount: 150, description: '午餐', date: daysAgo(30) }),
        makeExpense({ id: 'e3', amount: 150, description: '晚餐', date: daysAgo(25) }),
        makeExpense({ id: 'e4', amount: 1200, description: '大家电', date: daysAgo(1) }),
      ]);
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
      const createdAlert = {
        id: 'alert_new',
        familyId: 'fam_1',
        type: 'LARGE_EXPENSE',
        severity: 'HIGH',
        title: '大额支出提醒',
        description: '单笔支出 1200 元，超过近90天均值 166.67 元的 3 倍',
        amount: 1200,
        expenseId: 'e4',
        category: '餐饮',
        isRead: false,
        createdAt: NOW,
        family: { id: 'fam_1', name: '我的家' },
      };
      mockedPrisma.anomalyAlert.create.mockResolvedValue(createdAlert);

      await detectAndSaveAnomalies('fam_1');

      expect(mockedDispatchAlert).toHaveBeenCalledTimes(1);
      expect(mockedDispatchAlert).toHaveBeenCalledWith(createdAlert);
    });

    test('通知分发失败不影响告警保存结果', async () => {
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 200, description: '早餐', date: daysAgo(35) }),
        makeExpense({ id: 'e2', amount: 150, description: '午餐', date: daysAgo(30) }),
        makeExpense({ id: 'e3', amount: 150, description: '晚餐', date: daysAgo(25) }),
        makeExpense({ id: 'e4', amount: 1200, description: '大家电', date: daysAgo(1) }),
      ]);
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
      mockedPrisma.anomalyAlert.create.mockResolvedValue({});
      mockedDispatchAlert.mockRejectedValue(new Error('通知分发失败'));

      const result = await detectAndSaveAnomalies('fam_1');

      expect(result).toEqual({ detected: 1, saved: 1 });
    });
  });

  describe('detectAnomaliesForAll', () => {
    test('汇总所有家庭的检测结果', async () => {
      mockedPrisma.family.findMany.mockResolvedValue([
        { id: 'fam_1' },
        { id: 'fam_2' },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        makeExpense({ id: 'e1', amount: 200, description: '早餐', date: daysAgo(35) }),
        makeExpense({ id: 'e2', amount: 150, description: '午餐', date: daysAgo(30) }),
        makeExpense({ id: 'e3', amount: 150, description: '晚餐', date: daysAgo(25) }),
        makeExpense({ id: 'e4', amount: 1200, description: '大家电', date: daysAgo(1) }),
      ]);
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
      mockedPrisma.anomalyAlert.create.mockResolvedValue({});

      const result = await detectAnomaliesForAll();

      expect(result.total).toBe(2);
      expect(result.found).toBe(2);
      expect(mockedPrisma.anomalyAlert.create).toHaveBeenCalledTimes(2);
    });

    test('单个家庭失败不中断，继续处理其余家庭', async () => {
      mockedPrisma.family.findMany.mockResolvedValue([
        { id: 'fam_1' },
        { id: 'fam_2' },
      ]);
      mockedPrisma.expense.findMany
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValue([
          makeExpense({ id: 'e1', amount: 200, description: '早餐', date: daysAgo(35) }),
          makeExpense({ id: 'e2', amount: 150, description: '午餐', date: daysAgo(30) }),
          makeExpense({ id: 'e3', amount: 150, description: '晚餐', date: daysAgo(25) }),
          makeExpense({ id: 'e4', amount: 1200, description: '大家电', date: daysAgo(1) }),
        ]);
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
      mockedPrisma.anomalyAlert.create.mockResolvedValue({});

      const result = await detectAnomaliesForAll();

      expect(result.total).toBe(2);
      expect(result.found).toBe(1);
    });
  });
});
