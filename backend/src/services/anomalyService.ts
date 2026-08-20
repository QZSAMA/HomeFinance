import { prisma } from '../app';
import { createModuleLogger } from '../utils/logger';
import { dispatchAlert } from './notificationDispatcher';

const logger = createModuleLogger('anomalyService');

export interface Anomaly {
  type: 'LARGE_EXPENSE' | 'FREQUENCY_SPIKE' | 'CATEGORY_SURGE' | 'DUPLICATE';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  amount?: number;
  expenseId?: string;
  category?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 90;
const RECENT_DAYS = 7;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 检测指定家庭的支出异常（近 90 天数据）：
 * - LARGE_EXPENSE：近 7 天内单笔支出超过近 90 天均值 3 倍且大于 500 元
 * - FREQUENCY_SPIKE：某品类当日支出次数 >= 5 且超过 90 天日均次数的 5 倍
 * - CATEGORY_SURGE：本月（已过半）某品类支出总额超过上月 3 倍且大于 1000 元
 * - DUPLICATE：近 7 天内同金额且描述相同的支出 >= 2 笔
 */
export async function detectAnomalies(familyId: string): Promise<Anomaly[]> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const sevenDaysAgo = new Date(now.getTime() - RECENT_DAYS * DAY_MS);

  const expenses = await prisma.expense.findMany({
    where: { familyId, date: { gte: ninetyDaysAgo } },
    orderBy: { date: 'asc' },
  });

  const anomalies: Anomaly[] = [];

  // 规则 1：LARGE_EXPENSE（大额支出）
  for (const expense of expenses) {
    if (expense.date < sevenDaysAgo) {
      continue;
    }
    const amount = Number(expense.amount);
    const others = expenses.filter((e) => e.id !== expense.id);
    if (others.length === 0) {
      continue;
    }
    const avg =
      others.reduce((sum, e) => sum + Number(e.amount), 0) / others.length;
    if (amount > avg * 3 && amount > 500) {
      anomalies.push({
        type: 'LARGE_EXPENSE',
        severity: 'HIGH',
        title: '大额支出提醒',
        description: `单笔支出 ${amount} 元，超过近90天均值 ${roundTo2(avg)} 元的 3 倍`,
        amount,
        expenseId: expense.id,
        category: expense.category,
      });
    }
  }

  // 规则 2：FREQUENCY_SPIKE（频率异常）
  const todayCountByCategory = new Map<string, number>();
  const totalCountByCategory = new Map<string, number>();
  for (const expense of expenses) {
    const total = (totalCountByCategory.get(expense.category) || 0) + 1;
    totalCountByCategory.set(expense.category, total);
    if (isSameDay(expense.date, now)) {
      todayCountByCategory.set(
        expense.category,
        (todayCountByCategory.get(expense.category) || 0) + 1
      );
    }
  }
  for (const [category, count] of todayCountByCategory) {
    const dailyAvg = (totalCountByCategory.get(category) || 0) / LOOKBACK_DAYS;
    if (count >= 5 && count > dailyAvg * 5) {
      anomalies.push({
        type: 'FREQUENCY_SPIKE',
        severity: 'MEDIUM',
        title: `${category} 支出频率异常`,
        description: `${category} 今日已支出 ${count} 次，日均仅 ${roundTo2(dailyAvg)} 次`,
        category,
      });
    }
  }

  // 规则 3：CATEGORY_SURGE（品类突变，仅本月已过半时检测，避免月初误报）
  if (now.getDate() >= 15) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonthSums = new Map<string, number>();
    const lastMonthSums = new Map<string, number>();
    for (const expense of expenses) {
      const amount = Number(expense.amount);
      if (expense.date >= monthStart) {
        thisMonthSums.set(
          expense.category,
          (thisMonthSums.get(expense.category) || 0) + amount
        );
      } else if (expense.date >= lastMonthStart) {
        lastMonthSums.set(
          expense.category,
          (lastMonthSums.get(expense.category) || 0) + amount
        );
      }
    }
    for (const [category, thisMonth] of thisMonthSums) {
      const lastMonth = lastMonthSums.get(category) || 0;
      if (thisMonth > lastMonth * 3 && thisMonth > 1000) {
        anomalies.push({
          type: 'CATEGORY_SURGE',
          severity: 'MEDIUM',
          title: `${category} 支出突增`,
          description: `${category} 本月已支出 ${roundTo2(thisMonth)} 元，上月全月仅 ${roundTo2(lastMonth)} 元`,
          amount: thisMonth,
          category,
        });
      }
    }
  }

  // 规则 4：DUPLICATE（重复扣款）
  const recentExpenses = expenses.filter(
    (e) => e.date >= sevenDaysAgo && e.description
  );
  const groups = new Map<string, typeof recentExpenses>();
  for (const expense of recentExpenses) {
    const key = `${Number(expense.amount)}|${expense.description}`;
    const group = groups.get(key);
    if (group) {
      group.push(expense);
    } else {
      groups.set(key, [expense]);
    }
  }
  for (const group of groups.values()) {
    if (group.length >= 2) {
      const amount = Number(group[0].amount);
      anomalies.push({
        type: 'DUPLICATE',
        severity: 'MEDIUM',
        title: `疑似重复扣款：${group[0].description}`,
        description: `发现 ${group.length} 笔相同支出：${group[0].description}，各 ${amount} 元`,
        amount,
        category: group[0].category,
      });
    }
  }

  return anomalies;
}

function alertKey(
  type: string,
  expenseId: string | null | undefined,
  title: string,
  amount: number | null | undefined
): string {
  return expenseId
    ? `${type}:${expenseId}`
    : `${type}:${title}:${amount ?? 0}`;
}

/**
 * 检测并保存异常告警，近 24 小时内已存在的同类告警（同 expenseId+type，
 * DUPLICATE 等无 expenseId 的用 title+amount）会被去重。
 */
export async function detectAndSaveAnomalies(
  familyId: string
): Promise<{ detected: number; saved: number }> {
  const anomalies = await detectAnomalies(familyId);

  const since = new Date(Date.now() - DAY_MS);
  const existing = await prisma.anomalyAlert.findMany({
    where: { familyId, createdAt: { gte: since } },
    select: { type: true, expenseId: true, title: true, amount: true },
  });

  const existingKeys = new Set(
    existing.map((alert) =>
      alertKey(
        alert.type,
        alert.expenseId,
        alert.title,
        alert.amount == null ? 0 : Number(alert.amount)
      )
    )
  );

  let saved = 0;
  for (const anomaly of anomalies) {
    const key = alertKey(
      anomaly.type,
      anomaly.expenseId,
      anomaly.title,
      anomaly.amount
    );
    if (existingKeys.has(key)) {
      continue;
    }

    const created = await prisma.anomalyAlert.create({
      data: {
        familyId,
        type: anomaly.type,
        severity: anomaly.severity,
        title: anomaly.title,
        description: anomaly.description,
        amount: anomaly.amount ?? null,
        expenseId: anomaly.expenseId ?? null,
        category: anomaly.category ?? null,
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

  return { detected: anomalies.length, saved };
}

/**
 * 对所有家庭执行异常检测并保存告警，单个家庭失败不中断。
 */
export async function detectAnomaliesForAll(): Promise<{
  total: number;
  found: number;
}> {
  const families = await prisma.family.findMany({ select: { id: true } });

  let found = 0;
  for (const family of families) {
    try {
      const result = await detectAndSaveAnomalies(family.id);
      found += result.saved;
    } catch (err) {
      logger.error('家庭异常检测失败', {
        familyId: family.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { total: families.length, found };
}
