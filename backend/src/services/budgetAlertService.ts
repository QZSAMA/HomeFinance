import { prisma } from '../app';
import { createModuleLogger } from '../utils/logger';
import { dispatchAlert } from './notificationDispatcher';

const logger = createModuleLogger('budgetAlertService');

export interface BudgetAlert {
  budgetId: string;
  category: string;
  amount: number; // 预算金额
  spent: number; // 已支出
  percentage: number; // 进度百分比 0-100+
  severity: 'HIGH' | 'MEDIUM';
  message: string;
}

interface EnrichedBudgetAlert extends BudgetAlert {
  type: 'BUDGET_EXCEEDED' | 'BUDGET_WARNING';
  periodStart: Date;
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 根据预算周期类型计算当前周期范围（start 含 / end 不含）。
 * - MONTHLY：本月 1 日到月末
 * - QUARTERLY：本季度
 * - YEARLY：本年
 */
function getPeriodRange(
  period: string,
  now: Date
): { start: Date; end: Date } {
  const year = now.getFullYear();
  const month = now.getMonth();

  if (period === 'YEARLY') {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year + 1, 0, 1),
    };
  }

  if (period === 'QUARTERLY') {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    return {
      start: new Date(year, quarterStartMonth, 1),
      end: new Date(year, quarterStartMonth + 3, 1),
    };
  }

  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 1),
  };
}

async function collectBudgetAlerts(
  familyId: string
): Promise<EnrichedBudgetAlert[]> {
  const now = new Date();

  // 有效预算：startDate <= today <= endDate（或无 endDate）
  const budgets = await prisma.budget.findMany({
    where: {
      familyId,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
  });

  const alerts: EnrichedBudgetAlert[] = [];

  for (const budget of budgets) {
    const amount = Number(budget.amount);
    if (amount === 0) {
      continue; // 防除零
    }

    const { start, end } = getPeriodRange(budget.period, now);

    const expenses = await prisma.expense.findMany({
      where: {
        familyId,
        category: budget.category,
        date: { gte: start, lt: end },
      },
      select: { amount: true },
    });

    const spent = roundTo2(
      expenses.reduce((sum, e) => sum + Number(e.amount), 0)
    );
    const percentage = Math.round((spent / amount) * 100);

    if (spent >= amount) {
      alerts.push({
        budgetId: budget.id,
        category: budget.category,
        amount,
        spent,
        percentage,
        severity: 'HIGH',
        message: `预算已超支：${budget.category} 已支出 ${spent} 元，超出预算 ${amount} 元`,
        type: 'BUDGET_EXCEEDED',
        periodStart: start,
      });
    } else if (spent >= amount * 0.8) {
      alerts.push({
        budgetId: budget.id,
        category: budget.category,
        amount,
        spent,
        percentage,
        severity: 'MEDIUM',
        message: `预算接近上限：${budget.category} 已支出 ${spent} 元，达到预算 ${amount} 元的 ${percentage}%`,
        type: 'BUDGET_WARNING',
        periodStart: start,
      });
    }
    // spent < amount * 0.8 → 不告警
  }

  return alerts;
}

/**
 * 检测指定家庭的预算告警（只检测不保存）：
 * - HIGH：spent >= amount（超支）
 * - MEDIUM：spent >= amount * 0.8 且 < amount（接近上限）
 */
export async function checkBudgetAlerts(
  familyId: string
): Promise<BudgetAlert[]> {
  const alerts = await collectBudgetAlerts(familyId);
  return alerts.map(({ type: _type, periodStart: _periodStart, ...rest }) => rest);
}

/**
 * 检测并保存预算告警到 AnomalyAlert 表。
 * 去重：同一预算（同 category）+ type 在当前周期内（createdAt >= 周期起始日）
 * 已有记录则不重复创建。
 */
export async function checkAndSaveBudgetAlerts(
  familyId: string
): Promise<{ detected: number; saved: number }> {
  const alerts = await collectBudgetAlerts(familyId);
  if (alerts.length === 0) {
    return { detected: 0, saved: 0 };
  }

  const earliestPeriodStart = alerts.reduce(
    (min, a) => (a.periodStart < min ? a.periodStart : min),
    alerts[0].periodStart
  );

  const existing = await prisma.anomalyAlert.findMany({
    where: {
      familyId,
      type: { in: ['BUDGET_EXCEEDED', 'BUDGET_WARNING'] },
      createdAt: { gte: earliestPeriodStart },
    },
    select: { type: true, category: true, createdAt: true },
  });

  let saved = 0;
  for (const alert of alerts) {
    const duplicated = existing.some(
      (e) =>
        e.type === alert.type &&
        e.category === alert.category &&
        e.createdAt >= alert.periodStart
    );
    if (duplicated) {
      continue;
    }

    const created = await prisma.anomalyAlert.create({
      data: {
        familyId,
        type: alert.type,
        severity: alert.severity,
        title: alert.type === 'BUDGET_EXCEEDED' ? '预算超支' : '预算预警',
        description: alert.message,
        amount: alert.spent,
        category: alert.category,
      },
      include: { family: true },
    });
    saved++;

    // V4.4：异步触发通知分发，分发失败不影响告警保存主流程
    void dispatchAlert(created).catch((err) =>
      logger.error('通知分发失败', {
        alertId: created.id,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  return { detected: alerts.length, saved };
}

/**
 * 对所有家庭执行预算告警检测并保存，单个家庭失败不中断。
 */
export async function checkBudgetAlertsForAll(): Promise<{
  total: number;
  alerted: number;
}> {
  const families = await prisma.family.findMany({ select: { id: true } });

  let alerted = 0;
  for (const family of families) {
    try {
      const result = await checkAndSaveBudgetAlerts(family.id);
      alerted += result.saved;
    } catch (err) {
      logger.error('家庭预算告警检测失败', {
        familyId: family.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { total: families.length, alerted };
}
