import { Router } from 'express';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';
import { requireFamilyAccess } from '../middleware/familyAccess';
import { DomainError } from '../services/ledgerErrors';
import { PeriodWindow, resolvePeriodWindow } from '../services/periodWindowService';
import {
  CurrencySummary,
  reconcilePerCurrency,
  summarizeByCurrency,
} from '../services/currencySummaryService';
import {
  reconcileBalanceSheet,
  reconcileCashFlow,
  reconcileIncome,
} from '../utils/reconciliation';
import { calculateNetCashFlow, classifyCashFlowCategory } from '../utils/reportFormulas';
import { toNumber } from '../utils/decimal';

const router = Router({ mergeParams: true });

type FamilySettings = { timezone: string; baseCurrency: string };

const loadFamilySettings = async (familyId: string): Promise<FamilySettings> => {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { timezone: true, baseCurrency: true },
  });
  if (!family) throw new DomainError('RESOURCE_NOT_FOUND', '家庭不存在', 404);
  return family;
};

const resolveReportWindow = (
  settings: FamilySettings,
  startDate: unknown,
  endDate: unknown,
): PeriodWindow => {
  const readQueryDate = (value: unknown): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length === 0) {
      throw new DomainError('INVALID_PERIOD_WINDOW', '期间日期格式无效', 400);
    }
    return value;
  };
  const start = readQueryDate(startDate);
  const end = readQueryDate(endDate);
  if (start || end) {
    if (!start || !end) throw new DomainError('INVALID_PERIOD_WINDOW', '期间起止日期必须同时提供', 400);
    return resolvePeriodWindow({
      timezone: settings.timezone,
      kind: 'CUSTOM',
      localStart: start,
      localEndExclusive: end,
    });
  }
  return resolvePeriodWindow({
    timezone: settings.timezone,
    kind: 'MONTHLY',
    referenceInstant: new Date(),
  });
};

const currencyRows = (rows: ReadonlyArray<any>, amountKey: string, baseCurrency: string) => rows.map((row) => ({
  amount: row[amountKey],
  currency: row.currency ?? baseCurrency,
}));

const dimensionTotals = (
  rows: ReadonlyArray<any>,
  amountKey: string,
  dimensionKey: string,
  baseCurrency: string,
) => {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const dimension = String(row[dimensionKey]);
    const group = groups.get(dimension) ?? [];
    group.push(row);
    groups.set(dimension, group);
  }
  const totals: Record<string, number | null> = {};
  const totalsByCurrency: Record<string, Record<string, number>> = {};
  for (const [dimension, group] of groups) {
    const summary = summarizeByCurrency(currencyRows(group, amountKey, baseCurrency), baseCurrency);
    totals[dimension] = summary.totalInBaseCurrency;
    totalsByCurrency[dimension] = summary.totalsByCurrency;
  }
  return { totals, totalsByCurrency };
};

const scalarDifference = (income: number | null, expense: number | null): number | null => (
  income === null || expense === null ? null : income - expense
);

const combineConversionStatus = (left: CurrencySummary, right: CurrencySummary): CurrencySummary['conversionStatus'] => {
  if (left.conversionStatus === 'partial' || right.conversionStatus === 'partial') return 'partial';
  if (left.conversionStatus === 'unavailable' || right.conversionStatus === 'unavailable') return 'unavailable';
  return 'exact';
};

const reportError = (error: unknown, res: any, label: string) => {
  if (error instanceof DomainError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(label, error);
  return res.status(500).json({ error: '服务器内部错误' });
};

router.get('/balance-sheet', authMiddleware, requireFamilyAccess, cacheMiddleware(300), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const settings = await loadFamilySettings(familyId);

    const assets = await prisma.asset.findMany({ where: { familyId } });
    const liabilities = await prisma.liability.findMany({ where: { familyId } });

    const assetSummary = summarizeByCurrency(currencyRows(assets, 'value', settings.baseCurrency), settings.baseCurrency);
    const liabilitySummary = summarizeByCurrency(currencyRows(liabilities, 'amount', settings.baseCurrency), settings.baseCurrency);
    const totalAssets = assetSummary.totalInBaseCurrency;
    const totalLiabilities = liabilitySummary.totalInBaseCurrency;
    const netWorth = scalarDifference(totalAssets, totalLiabilities);

    const assetByType = dimensionTotals(assets, 'value', 'type', settings.baseCurrency);
    const liabilityByType = dimensionTotals(liabilities, 'amount', 'type', settings.baseCurrency);

    res.json({
      totalAssets,
      totalLiabilities,
      netWorth,
      assets: assetByType.totals,
      liabilities: liabilityByType.totals,
      assetsByCurrency: assetByType.totalsByCurrency,
      liabilitiesByCurrency: liabilityByType.totalsByCurrency,
      assetList: assets,
      liabilityList: liabilities,
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
      totalsByCurrency: assetSummary.totalsByCurrency,
      liabilityTotalsByCurrency: liabilitySummary.totalsByCurrency,
      conversionStatus: combineConversionStatus(assetSummary, liabilitySummary),
      reconciliationStatus: totalAssets !== null && totalLiabilities !== null && netWorth !== null
        && reconcileBalanceSheet(totalAssets, totalLiabilities, netWorth) ? 'passed' : 'unavailable',
      valuationAsOf: new Date().toISOString(),
      valuationRuleVersion: 'current-snapshot-v1',
    });
  } catch (error) {
    return reportError(error, res, '获取资产负债表错误:');
  }
});

router.get('/income-statement', authMiddleware, requireFamilyAccess, cacheMiddleware(300), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const settings = await loadFamilySettings(familyId);

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const window = resolveReportWindow(settings, startDate, endDate);
    const where = { familyId, date: { gte: window.startUtc, lt: window.endUtc } };

    const incomes = await prisma.income.findMany({
      where,
      orderBy: { date: 'desc' }
    });
    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' }
    });

    const incomeSummary = summarizeByCurrency(currencyRows(incomes, 'amount', settings.baseCurrency), settings.baseCurrency);
    const expenseSummary = summarizeByCurrency(currencyRows(expenses, 'amount', settings.baseCurrency), settings.baseCurrency);
    const totalIncome = incomeSummary.totalInBaseCurrency;
    const totalExpense = expenseSummary.totalInBaseCurrency;
    const netIncome = scalarDifference(totalIncome, totalExpense);

    const incomeByCategory = dimensionTotals(incomes, 'amount', 'category', settings.baseCurrency);
    const expenseByCategory = dimensionTotals(expenses, 'amount', 'category', settings.baseCurrency);

    res.json({
      totalIncome,
      totalExpense,
      netIncome,
      netIncomeByCurrency: reconcilePerCurrency(incomeSummary, expenseSummary),
      incomeByCategory: incomeByCategory.totals,
      expenseByCategory: expenseByCategory.totals,
      incomeByCategoryByCurrency: incomeByCategory.totalsByCurrency,
      expenseByCategoryByCurrency: expenseByCategory.totalsByCurrency,
      incomes,
      expenses,
      startDate: startDate || null,
      endDate: endDate || null,
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
      window,
      totalsByCurrency: incomeSummary.totalsByCurrency,
      expenseTotalsByCurrency: expenseSummary.totalsByCurrency,
      conversionStatus: combineConversionStatus(incomeSummary, expenseSummary),
      reconciliationStatus: totalIncome !== null && totalExpense !== null && netIncome !== null
        && reconcileIncome(totalIncome, totalExpense, netIncome) ? 'passed' : 'unavailable',
    });
  } catch (error) {
    return reportError(error, res, '获取利润表错误:');
  }
});

router.get('/cash-flow', authMiddleware, requireFamilyAccess, cacheMiddleware(300), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const settings = await loadFamilySettings(familyId);

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const window = resolveReportWindow(settings, startDate, endDate);
    const where = { familyId, date: { gte: window.startUtc, lt: window.endUtc } };

    const incomes = await prisma.income.findMany({ where });
    const expenses = await prisma.expense.findMany({ where });

    const operatingIncome = incomes.filter(
      (income) => classifyCashFlowCategory(income.category, 'income') === 'operating',
    );
    const investmentIncome = incomes.filter(
      (income) => classifyCashFlowCategory(income.category, 'income') === 'investing',
    );
    const otherIncome = incomes.filter(
      (income) => classifyCashFlowCategory(income.category, 'income') === 'other',
    );

    const livingExpense = expenses.filter(
      (expense) => classifyCashFlowCategory(expense.category, 'expense') === 'operating',
    );
    const investmentExpense = expenses.filter(
      (expense) => classifyCashFlowCategory(expense.category, 'expense') === 'investing',
    );
    const otherExpense = expenses.filter(
      (expense) => classifyCashFlowCategory(expense.category, 'expense') === 'other',
    );

    const operatingIncomeSummary = summarizeByCurrency(currencyRows(operatingIncome, 'amount', settings.baseCurrency), settings.baseCurrency);
    const investmentIncomeSummary = summarizeByCurrency(currencyRows(investmentIncome, 'amount', settings.baseCurrency), settings.baseCurrency);
    const otherIncomeSummary = summarizeByCurrency(currencyRows(otherIncome, 'amount', settings.baseCurrency), settings.baseCurrency);
    const livingExpenseSummary = summarizeByCurrency(currencyRows(livingExpense, 'amount', settings.baseCurrency), settings.baseCurrency);
    const investmentExpenseSummary = summarizeByCurrency(currencyRows(investmentExpense, 'amount', settings.baseCurrency), settings.baseCurrency);
    const otherExpenseSummary = summarizeByCurrency(currencyRows(otherExpense, 'amount', settings.baseCurrency), settings.baseCurrency);

    const totalOperatingIncome = operatingIncomeSummary.totalInBaseCurrency;
    const totalInvestmentIncome = investmentIncomeSummary.totalInBaseCurrency;
    const totalOtherIncome = otherIncomeSummary.totalInBaseCurrency;
    const totalLivingExpense = livingExpenseSummary.totalInBaseCurrency;
    const totalInvestmentExpense = investmentExpenseSummary.totalInBaseCurrency;
    const totalOtherExpense = otherExpenseSummary.totalInBaseCurrency;

    const operatingCashFlow = scalarDifference(totalOperatingIncome, totalLivingExpense);
    const investingCashFlow = scalarDifference(totalInvestmentIncome, totalInvestmentExpense);
    const financingCashFlow = 0;
    const otherCashFlow = scalarDifference(totalOtherIncome, totalOtherExpense);
    const netCashFlow = operatingCashFlow === null || investingCashFlow === null || otherCashFlow === null
      ? null
      : calculateNetCashFlow({
        operating: operatingCashFlow,
        investing: investingCashFlow,
      financing: financingCashFlow,
        other: otherCashFlow,
      });

    const allIncomeSummary = summarizeByCurrency(currencyRows(incomes, 'amount', settings.baseCurrency), settings.baseCurrency);
    const allExpenseSummary = summarizeByCurrency(currencyRows(expenses, 'amount', settings.baseCurrency), settings.baseCurrency);
    const conversionStatus = combineConversionStatus(allIncomeSummary, allExpenseSummary);

    res.json({
      operating: {
        income: totalOperatingIncome,
        expense: totalLivingExpense,
        net: operatingCashFlow
      },
      investing: {
        income: totalInvestmentIncome,
        expense: totalInvestmentExpense,
        net: investingCashFlow
      },
      financing: {
        income: 0,
        expense: 0,
        net: financingCashFlow
      },
      other: {
        income: totalOtherIncome,
        expense: totalOtherExpense,
        net: otherCashFlow
      },
      netCashFlow,
      startDate: startDate || null,
      endDate: endDate || null,
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
      window,
      totalsByCurrency: allIncomeSummary.totalsByCurrency,
      expenseTotalsByCurrency: allExpenseSummary.totalsByCurrency,
      conversionStatus,
      reconciliationStatus: netCashFlow !== null && reconcileCashFlow([
        { net: operatingCashFlow! },
        { net: investingCashFlow! },
        { net: financingCashFlow },
        { net: otherCashFlow! },
      ], netCashFlow) ? 'passed' : 'unavailable',
    });
  } catch (error) {
    return reportError(error, res, '获取现金流量表错误:');
  }
});

router.get('/summary', authMiddleware, requireFamilyAccess, cacheMiddleware(300), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const settings = await loadFamilySettings(familyId);

    const now = new Date();
    const thisMonthWindow = resolvePeriodWindow({
      timezone: settings.timezone,
      kind: 'MONTHLY',
      referenceInstant: now,
    });
    const lastMonthWindow = resolvePeriodWindow({
      timezone: settings.timezone,
      kind: 'MONTHLY',
      referenceInstant: new Date(thisMonthWindow.startUtc.getTime() - 1),
    });

    const [assets, liabilities, thisMonthIncomes, lastMonthIncomes, thisMonthExpenses, lastMonthExpenses] = await Promise.all([
      prisma.asset.findMany({ where: { familyId } }),
      prisma.liability.findMany({ where: { familyId } }),
      prisma.income.findMany({ where: { familyId, date: { gte: thisMonthWindow.startUtc, lt: thisMonthWindow.endUtc } } }),
      prisma.income.findMany({ where: { familyId, date: { gte: lastMonthWindow.startUtc, lt: lastMonthWindow.endUtc } } }),
      prisma.expense.findMany({ where: { familyId, date: { gte: thisMonthWindow.startUtc, lt: thisMonthWindow.endUtc } } }),
      prisma.expense.findMany({ where: { familyId, date: { gte: lastMonthWindow.startUtc, lt: lastMonthWindow.endUtc } } })
    ]);

    const assetSummary = summarizeByCurrency(currencyRows(assets, 'value', settings.baseCurrency), settings.baseCurrency);
    const liabilitySummary = summarizeByCurrency(currencyRows(liabilities, 'amount', settings.baseCurrency), settings.baseCurrency);
    const thisIncomeSummary = summarizeByCurrency(currencyRows(thisMonthIncomes, 'amount', settings.baseCurrency), settings.baseCurrency);
    const lastIncomeSummary = summarizeByCurrency(currencyRows(lastMonthIncomes, 'amount', settings.baseCurrency), settings.baseCurrency);
    const thisExpenseSummary = summarizeByCurrency(currencyRows(thisMonthExpenses, 'amount', settings.baseCurrency), settings.baseCurrency);
    const lastExpenseSummary = summarizeByCurrency(currencyRows(lastMonthExpenses, 'amount', settings.baseCurrency), settings.baseCurrency);

    const totalAssets = assetSummary.totalInBaseCurrency;
    const totalLiabilities = liabilitySummary.totalInBaseCurrency;
    const netWorth = scalarDifference(totalAssets, totalLiabilities);

    const thisMonthIncome = thisIncomeSummary.totalInBaseCurrency;
    const lastMonthIncome = lastIncomeSummary.totalInBaseCurrency;
    const thisMonthExpense = thisExpenseSummary.totalInBaseCurrency;
    const lastMonthExpense = lastExpenseSummary.totalInBaseCurrency;

    const incomeChange = lastMonthIncome !== null && thisMonthIncome !== null && lastMonthIncome > 0
      ? ((thisMonthIncome - lastMonthIncome) / lastMonthIncome) * 100 
      : lastMonthIncome === null || thisMonthIncome === null ? null : 0;
    const expenseChange = lastMonthExpense !== null && thisMonthExpense !== null && lastMonthExpense > 0
      ? ((thisMonthExpense - lastMonthExpense) / lastMonthExpense) * 100 
      : lastMonthExpense === null || thisMonthExpense === null ? null : 0;

    const allocationMap: Record<string, number> = {
      STOCK: 0,
      BOND: 0,
      GOLD: 0,
      CASH: 0,
      OTHER: 0
    };

    assets.forEach((asset) => {
      const type = asset.type;
      const val = toNumber(asset.value);
      if (type === 'STOCK' || type === 'FUND') {
        allocationMap['STOCK'] += val;
      } else if (type === 'BOND') {
        allocationMap['BOND'] += val;
      } else if (type === 'GOLD') {
        allocationMap['GOLD'] += val;
      } else if (type === 'CASH') {
        allocationMap['CASH'] += val;
      } else {
        allocationMap['OTHER'] += val;
      }
    });

    const investmentAllocation = Object.entries(allocationMap).map(([category, value]) => ({
      category,
      value,
      percentage: totalAssets !== null && totalAssets > 0 ? Number(((value / totalAssets) * 100).toFixed(2)) : totalAssets === null ? null : 0
    }));

    res.json({
      balanceSheet: {
        totalAssets,
        totalLiabilities,
        netWorth
      },
      incomeStatement: {
        thisMonthIncome,
        lastMonthIncome,
        thisMonthExpense,
        lastMonthExpense,
        incomeChange,
        expenseChange,
        netIncome: scalarDifference(thisMonthIncome, thisMonthExpense)
      },
      investmentAllocation,
      recentTransactions: {
        incomes: thisMonthIncomes.slice(0, 5),
        expenses: thisMonthExpenses.slice(0, 5)
      },
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
      window: thisMonthWindow,
      previousWindow: lastMonthWindow,
      totalsByCurrency: assetSummary.totalsByCurrency,
      liabilityTotalsByCurrency: liabilitySummary.totalsByCurrency,
      conversionStatus: combineConversionStatus(assetSummary, liabilitySummary),
      reconciliationStatus: totalAssets !== null && totalLiabilities !== null && netWorth !== null
        && reconcileBalanceSheet(totalAssets, totalLiabilities, netWorth) ? 'passed' : 'unavailable',
    });
  } catch (error) {
    return reportError(error, res, '获取财务概览错误:');
  }
});

export default router;
