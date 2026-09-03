import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { DomainError } from '../services/ledgerErrors';
import { resolvePeriodWindow } from '../services/periodWindowService';
import { summarizeByCurrency, CurrencySummary } from '../services/currencySummaryService';
import { reconcileBalanceSheet, reconcileIncome } from '../utils/reconciliation';

const router = Router();
const VALUATION_RULE_VERSION = 'current-snapshot-v1';

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份必须使用 YYYY-MM 格式');

const nextMonth = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonthNumber = monthNumber === 12 ? 1 : monthNumber + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonthNumber).padStart(2, '0')}`;
};

const currencyRows = (rows: ReadonlyArray<any>, amountKey: 'value' | 'amount', baseCurrency: string) => rows.map((row) => ({
  amount: row[amountKey],
  currency: row.currency ?? baseCurrency,
}));

const scalarDifference = (left: number | null, right: number | null): number | null => (
  left === null || right === null ? null : left - right
);

const combineConversionStatus = (...summaries: CurrencySummary[]): CurrencySummary['conversionStatus'] => {
  if (summaries.some((summary) => summary.conversionStatus === 'partial')) return 'partial';
  if (summaries.some((summary) => summary.conversionStatus === 'unavailable')) return 'unavailable';
  return 'exact';
};

// GET /summary — 返回用户所有家庭的对比数据
router.get('/summary', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const parsedMonth = monthSchema.safeParse(req.query.month);
    if (!parsedMonth.success) {
      throw new DomainError('INVALID_PERIOD_WINDOW', parsedMonth.error.errors[0]?.message ?? '月份格式无效', 400);
    }
    const month = parsedMonth.data;
    const valuationAsOf = new Date().toISOString();
    const userId = req.userId!;
    const memberships = await prisma.familyMember.findMany({
      where: { userId },
      include: {
        family: {
          select: { id: true, name: true, timezone: true, baseCurrency: true },
        },
      },
    });

    if (memberships.length === 0) {
      return res.json([]);
    }

    const monthStart = `${month}-01`;
    const monthEndExclusive = `${nextMonth(month)}-01`;

    const results = await Promise.all(
      memberships.map(async (m) => {
        const familyId = m.familyId;
        const familyName = m.family.name;
        const timezone = m.family.timezone ?? 'Asia/Shanghai';
        const baseCurrency = m.family.baseCurrency ?? 'CNY';
        const window = resolvePeriodWindow({
          timezone,
          kind: 'CUSTOM',
          localStart: monthStart,
          localEndExclusive: monthEndExclusive,
        });
        const dateWhere = { familyId, date: { gte: window.startUtc, lt: window.endUtc } };

        const [assets, liabilities, incomes, expenses] = await Promise.all([
          prisma.asset.findMany({ where: { familyId }, select: { value: true, currency: true } }),
          prisma.liability.findMany({ where: { familyId }, select: { amount: true, currency: true } }),
          prisma.income.findMany({ where: dateWhere, select: { amount: true, currency: true } }),
          prisma.expense.findMany({ where: dateWhere, select: { amount: true, currency: true } }),
        ]);

        const assetSummary = summarizeByCurrency(currencyRows(assets, 'value', baseCurrency), baseCurrency);
        const liabilitySummary = summarizeByCurrency(currencyRows(liabilities, 'amount', baseCurrency), baseCurrency);
        const incomeSummary = summarizeByCurrency(currencyRows(incomes, 'amount', baseCurrency), baseCurrency);
        const expenseSummary = summarizeByCurrency(currencyRows(expenses, 'amount', baseCurrency), baseCurrency);

        const conversionStatus = combineConversionStatus(assetSummary, liabilitySummary, incomeSummary, expenseSummary);
        const totalAssets = assetSummary.totalInBaseCurrency;
        const totalLiabilities = liabilitySummary.totalInBaseCurrency;
        const netWorth = scalarDifference(totalAssets, totalLiabilities);
        const thisMonthIncome = incomeSummary.totalInBaseCurrency;
        const thisMonthExpense = expenseSummary.totalInBaseCurrency;
        const reconciliationStatus = conversionStatus === 'exact'
          && totalAssets !== null
          && totalLiabilities !== null
          && netWorth !== null
          && thisMonthIncome !== null
          && thisMonthExpense !== null
          && reconcileBalanceSheet(totalAssets, totalLiabilities, netWorth)
          && reconcileIncome(thisMonthIncome, thisMonthExpense, thisMonthIncome - thisMonthExpense)
          ? 'passed'
          : 'unavailable';

        return {
          familyId,
          familyName,
          totalAssets,
          totalLiabilities,
          netWorth,
          thisMonthIncome,
          thisMonthExpense,
          totalAssetsByCurrency: assetSummary.totalsByCurrency,
          totalLiabilitiesByCurrency: liabilitySummary.totalsByCurrency,
          thisMonthIncomeByCurrency: incomeSummary.totalsByCurrency,
          thisMonthExpenseByCurrency: expenseSummary.totalsByCurrency,
          conversionStatus,
          reconciliationStatus,
          valuationAsOf,
          valuationRuleVersion: VALUATION_RULE_VERSION,
          window,
          timezone,
          baseCurrency,
        };
      })
    );

    res.json(results);
  } catch (error) {
    if (error instanceof DomainError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error('获取家庭对比数据错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;

