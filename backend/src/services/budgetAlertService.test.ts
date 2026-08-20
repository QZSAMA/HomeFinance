jest.mock('../app', () => ({
  prisma: {
    budget: {
      findMany: jest.fn(),
    },
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
  checkBudgetAlerts,
  checkAndSaveBudgetAlerts,
  checkBudgetAlertsForAll,
} from './budgetAlertService';
import { dispatchAlert } from './notificationDispatcher';

const mockedPrisma = prisma as any;
const mockedDispatchAlert = dispatchAlert as jest.MockedFunction<
  typeof dispatchAlert
>;

// 固定系统时间：2026-08-15 12:00（本地时间）
const NOW = new Date(2026, 7, 15, 12, 0, 0);

function makeBudget(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    familyId: 'fam_1',
    category: '餐饮',
    amount: 1000,
    period: 'MONTHLY',
    startDate: new Date(2026, 0, 1),
    endDate: null,
    createdBy: 'user_1',
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  };
}

describe('budgetAlertService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockedPrisma.budget.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.family.findMany.mockResolvedValue([]);
    mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
    mockedPrisma.anomalyAlert.create.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkBudgetAlerts', () => {
    test('spent >= amount → 产生 HIGH 告警', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { amount: 800 },
        { amount: 400 },
      ]);

      const alerts = await checkBudgetAlerts('fam_1');

      expect(alerts).toHaveLength(1);
      expect(alerts[0].budgetId).toBe('b1');
      expect(alerts[0].category).toBe('餐饮');
      expect(alerts[0].severity).toBe('HIGH');
      expect(alerts[0].amount).toBe(1000);
      expect(alerts[0].spent).toBe(1200);
      expect(alerts[0].percentage).toBe(120);
      expect(alerts[0].message).toBe(
        '预算已超支：餐饮 已支出 1200 元，超出预算 1000 元'
      );
    });

    test('spent 达 80%-100% → 产生 MEDIUM 告警', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([{ amount: 850 }]);

      const alerts = await checkBudgetAlerts('fam_1');

      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('MEDIUM');
      expect(alerts[0].spent).toBe(850);
      expect(alerts[0].percentage).toBe(85);
      expect(alerts[0].message).toBe(
        '预算接近上限：餐饮 已支出 850 元，达到预算 1000 元的 85%'
      );
    });

    test('spent < 80% → 不产生告警', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([{ amount: 799 }]);

      const alerts = await checkBudgetAlerts('fam_1');

      expect(alerts).toHaveLength(0);
    });

    test('amount 为 0 → 跳过（防除零）', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 0 })]);

      const alerts = await checkBudgetAlerts('fam_1');

      expect(alerts).toHaveLength(0);
      expect(mockedPrisma.expense.findMany).not.toHaveBeenCalled();
    });

    test('MONTHLY 周期按本月（1 日到月末）计算', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([
        makeBudget({ period: 'MONTHLY' }),
      ]);

      await checkBudgetAlerts('fam_1');

      expect(mockedPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            familyId: 'fam_1',
            category: '餐饮',
            date: {
              gte: new Date(2026, 7, 1),
              lt: new Date(2026, 8, 1),
            },
          }),
        })
      );
    });

    test('endDate 已过的预算不检测', async () => {
      await checkBudgetAlerts('fam_1');

      // 查询条件应包含 startDate <= today 且 endDate 未过期（或为空）
      const call = mockedPrisma.budget.findMany.mock.calls[0][0];
      expect(call.where.familyId).toBe('fam_1');
      expect(call.where.startDate).toEqual({ lte: NOW });
      expect(call.where.OR).toEqual([
        { endDate: null },
        { endDate: { gte: NOW } },
      ]);
    });
  });

  describe('checkAndSaveBudgetAlerts', () => {
    test('同周期同 budgetId+type 去重，不重复创建', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([{ amount: 1200 }]);
      // 当前周期内（8 月）已存在同类告警
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([
        { type: 'BUDGET_EXCEEDED', category: '餐饮', createdAt: new Date(2026, 7, 10) },
      ]);

      const result = await checkAndSaveBudgetAlerts('fam_1');

      expect(result.detected).toBe(1);
      expect(result.saved).toBe(0);
      expect(mockedPrisma.anomalyAlert.create).not.toHaveBeenCalled();
    });

    test('新周期（去重窗口外）会重新告警', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([{ amount: 1200 }]);
      // 上一周期（7 月）的告警不在当前周期去重窗口内
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([
        { type: 'BUDGET_EXCEEDED', category: '餐饮', createdAt: new Date(2026, 6, 20) },
      ]);

      const result = await checkAndSaveBudgetAlerts('fam_1');

      expect(result.detected).toBe(1);
      expect(result.saved).toBe(1);
      expect(mockedPrisma.anomalyAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          familyId: 'fam_1',
          type: 'BUDGET_EXCEEDED',
          severity: 'HIGH',
          title: '预算超支',
          description: '预算已超支：餐饮 已支出 1200 元，超出预算 1000 元',
          amount: 1200,
          category: '餐饮',
        }),
        include: { family: true },
      });
    });

    test('BUDGET_WARNING 类型告警保存为预警', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([{ amount: 850 }]);
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);

      const result = await checkAndSaveBudgetAlerts('fam_1');

      expect(result.detected).toBe(1);
      expect(result.saved).toBe(1);
      expect(mockedPrisma.anomalyAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          familyId: 'fam_1',
          type: 'BUDGET_WARNING',
          severity: 'MEDIUM',
          title: '预算预警',
          description: '预算接近上限：餐饮 已支出 850 元，达到预算 1000 元的 85%',
          amount: 850,
          category: '餐饮',
        }),
        include: { family: true },
      });
    });

    test('保存告警后异步触发通知分发（携带 family）', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([{ amount: 1200 }]);
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
      const createdAlert = {
        id: 'alert_new',
        familyId: 'fam_1',
        type: 'BUDGET_EXCEEDED',
        severity: 'HIGH',
        title: '预算超支',
        description: '预算已超支：餐饮 已支出 1200 元，超出预算 1000 元',
        amount: 1200,
        expenseId: null,
        category: '餐饮',
        isRead: false,
        createdAt: NOW,
        family: { id: 'fam_1', name: '我的家' },
      };
      mockedPrisma.anomalyAlert.create.mockResolvedValue(createdAlert);

      await checkAndSaveBudgetAlerts('fam_1');

      expect(mockedDispatchAlert).toHaveBeenCalledTimes(1);
      expect(mockedDispatchAlert).toHaveBeenCalledWith(createdAlert);
    });

    test('通知分发失败不影响告警保存结果', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([{ amount: 1200 }]);
      mockedPrisma.anomalyAlert.findMany.mockResolvedValue([]);
      mockedPrisma.anomalyAlert.create.mockResolvedValue({});
      mockedDispatchAlert.mockRejectedValue(new Error('通知分发失败'));

      const result = await checkAndSaveBudgetAlerts('fam_1');

      expect(result).toEqual({ detected: 1, saved: 1 });
    });
  });

  describe('checkBudgetAlertsForAll', () => {
    test('汇总所有家庭的告警', async () => {
      mockedPrisma.family.findMany.mockResolvedValue([
        { id: 'fam_1' },
        { id: 'fam_2' },
      ]);
      mockedPrisma.budget.findMany
        .mockResolvedValueOnce([makeBudget({ amount: 1000 })])
        .mockResolvedValueOnce([makeBudget({ id: 'b2', amount: 2000 })]);
      mockedPrisma.expense.findMany
        .mockResolvedValueOnce([{ amount: 1200 }]) // fam_1 超支 → 保存 1 条
        .mockResolvedValueOnce([{ amount: 900 }]); // fam_2 仅 45% → 不告警

      const result = await checkBudgetAlertsForAll();

      expect(result.total).toBe(2);
      expect(result.alerted).toBe(1);
      expect(mockedPrisma.anomalyAlert.create).toHaveBeenCalledTimes(1);
    });

    test('单个家庭失败不中断', async () => {
      mockedPrisma.family.findMany.mockResolvedValue([
        { id: 'fam_1' },
        { id: 'fam_2' },
      ]);
      mockedPrisma.budget.findMany
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValueOnce([makeBudget({ amount: 1000 })]);
      mockedPrisma.expense.findMany.mockResolvedValue([{ amount: 1200 }]);

      const result = await checkBudgetAlertsForAll();

      expect(result.total).toBe(2);
      expect(result.alerted).toBe(1);
    });
  });
});
