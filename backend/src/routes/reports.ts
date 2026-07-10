import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { cacheMiddleware } from '../middleware/cache';
import { toNumber } from '../utils/decimal';

const router = Router({ mergeParams: true });

const checkFamilyAccess = async (familyId: string, userId: string) => {
  const membership = await prisma.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId,
        userId
      }
    }
  });
  return membership;
};

router.get('/balance-sheet', authMiddleware, cacheMiddleware(300), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const assets = await prisma.asset.findMany({ where: { familyId } });
    const liabilities = await prisma.liability.findMany({ where: { familyId } });

    const totalAssets = assets.reduce((sum, a) => sum + toNumber(a.value), 0);
    const totalLiabilities = liabilities.reduce((sum, l) => sum + toNumber(l.amount), 0);
    const netWorth = totalAssets - totalLiabilities;

    const assetByType = assets.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + toNumber(a.value);
      return acc;
    }, {} as Record<string, number>);

    const liabilityByType = liabilities.reduce((acc, l) => {
      acc[l.type] = (acc[l.type] || 0) + toNumber(l.amount);
      return acc;
    }, {} as Record<string, number>);

    res.json({
      totalAssets,
      totalLiabilities,
      netWorth,
      assets: assetByType,
      liabilities: liabilityByType,
      assetList: assets,
      liabilityList: liabilities
    });
  } catch (error) {
    console.error('获取资产负债表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/income-statement', authMiddleware, cacheMiddleware(300), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = { familyId };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const incomes = await prisma.income.findMany({
      where,
      orderBy: { date: 'desc' }
    });
    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' }
    });

    const totalIncome = incomes.reduce((sum, i) => sum + toNumber(i.amount), 0);
    const totalExpense = expenses.reduce((sum, e) => sum + toNumber(e.amount), 0);
    const netIncome = totalIncome - totalExpense;

    const incomeByCategory = incomes.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + toNumber(i.amount);
      return acc;
    }, {} as Record<string, number>);

    const expenseByCategory = expenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + toNumber(e.amount);
      return acc;
    }, {} as Record<string, number>);

    res.json({
      totalIncome,
      totalExpense,
      netIncome,
      incomeByCategory,
      expenseByCategory,
      incomes,
      expenses,
      startDate: startDate || null,
      endDate: endDate || null
    });
  } catch (error) {
    console.error('获取利润表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/cash-flow', authMiddleware, cacheMiddleware(300), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const where: any = { familyId };
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const incomes = await prisma.income.findMany({ where });
    const expenses = await prisma.expense.findMany({ where });

    const operatingIncome = incomes.filter((i) => 
      ['工资', '薪资', '兼职', '经营'].some((k) => i.category.includes(k)) || 
      i.category === 'SALARY' || i.category === 'BUSINESS'
    );
    const investmentIncome = incomes.filter((i) => 
      ['投资', '利息', '股息', '理财'].some((k) => i.category.includes(k)) ||
      i.category === 'INVESTMENT' || i.category === 'INTEREST'
    );
    const otherIncome = incomes.filter((i) => 
      !operatingIncome.includes(i) && !investmentIncome.includes(i)
    );

    const livingExpense = expenses.filter((e) => 
      ['餐饮', '交通', '购物', '娱乐', '医疗', '教育', '日用'].some((k) => e.category.includes(k)) ||
      e.category === 'FOOD' || e.category === 'TRANSPORT' || e.category === 'SHOPPING' ||
      e.category === 'ENTERTAINMENT' || e.category === 'HEALTHCARE' || e.category === 'EDUCATION'
    );
    const investmentExpense = expenses.filter((e) => 
      ['投资', '理财'].some((k) => e.category.includes(k))
    );
    const otherExpense = expenses.filter((e) => 
      !livingExpense.includes(e) && !investmentExpense.includes(e)
    );

    const totalOperatingIncome = operatingIncome.reduce((s, i) => s + toNumber(i.amount), 0);
    const totalInvestmentIncome = investmentIncome.reduce((s, i) => s + toNumber(i.amount), 0);
    const totalOtherIncome = otherIncome.reduce((s, i) => s + toNumber(i.amount), 0);

    const totalLivingExpense = livingExpense.reduce((s, e) => s + toNumber(e.amount), 0);
    const totalInvestmentExpense = investmentExpense.reduce((s, e) => s + toNumber(e.amount), 0);
    const totalOtherExpense = otherExpense.reduce((s, e) => s + toNumber(e.amount), 0);

    const operatingCashFlow = totalOperatingIncome - totalLivingExpense;
    const investingCashFlow = totalInvestmentIncome - totalInvestmentExpense;
    const financingCashFlow = 0;
    const netCashFlow = operatingCashFlow + investingCashFlow + financingCashFlow;

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
        expense: totalOtherExpense
      },
      netCashFlow,
      startDate: startDate || null,
      endDate: endDate || null
    });
  } catch (error) {
    console.error('获取现金流量表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/summary', authMiddleware, cacheMiddleware(300), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [assets, liabilities, thisMonthIncomes, lastMonthIncomes, thisMonthExpenses, lastMonthExpenses] = await Promise.all([
      prisma.asset.findMany({ where: { familyId } }),
      prisma.liability.findMany({ where: { familyId } }),
      prisma.income.findMany({ where: { familyId, date: { gte: thisMonthStart, lt: nextMonthStart } } }),
      prisma.income.findMany({ where: { familyId, date: { gte: lastMonthStart, lt: thisMonthStart } } }),
      prisma.expense.findMany({ where: { familyId, date: { gte: thisMonthStart, lt: nextMonthStart } } }),
      prisma.expense.findMany({ where: { familyId, date: { gte: lastMonthStart, lt: thisMonthStart } } })
    ]);

    const totalAssets = assets.reduce((s, a) => s + toNumber(a.value), 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + toNumber(l.amount), 0);
    const netWorth = totalAssets - totalLiabilities;

    const thisMonthIncome = thisMonthIncomes.reduce((s, i) => s + toNumber(i.amount), 0);
    const lastMonthIncome = lastMonthIncomes.reduce((s, i) => s + toNumber(i.amount), 0);
    const thisMonthExpense = thisMonthExpenses.reduce((s, e) => s + toNumber(e.amount), 0);
    const lastMonthExpense = lastMonthExpenses.reduce((s, e) => s + toNumber(e.amount), 0);

    const incomeChange = lastMonthIncome > 0 
      ? ((thisMonthIncome - lastMonthIncome) / lastMonthIncome) * 100 
      : 0;
    const expenseChange = lastMonthExpense > 0 
      ? ((thisMonthExpense - lastMonthExpense) / lastMonthExpense) * 100 
      : 0;

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
      percentage: totalAssets > 0 ? Number(((value / totalAssets) * 100).toFixed(2)) : 0
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
        netIncome: thisMonthIncome - thisMonthExpense
      },
      investmentAllocation,
      recentTransactions: {
        incomes: thisMonthIncomes.slice(0, 5),
        expenses: thisMonthExpenses.slice(0, 5)
      }
    });
  } catch (error) {
    console.error('获取财务概览错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
