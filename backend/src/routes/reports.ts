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

    // 资产价值计算：有 symbol && quantity && marketPrice → marketPrice * quantity；否则回退 value
    const computeAssetValue = (asset: {
      value: any;
      symbol: string | null;
      quantity: any;
      marketPrice: any;
    }) => {
      if (asset.symbol && asset.quantity !== null && asset.marketPrice !== null) {
        return toNumber(asset.marketPrice) * toNumber(asset.quantity);
      }
      return toNumber(asset.value);
    };

    const totalAssets = assets.reduce((sum, a) => sum + computeAssetValue(a), 0);
    const totalLiabilities = liabilities.reduce((sum, l) => sum + toNumber(l.amount), 0);
    const netWorth = totalAssets - totalLiabilities;

    const assetByType = assets.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + computeAssetValue(a);
      return acc;
    }, {} as Record<string, number>);

    const liabilityByType = liabilities.reduce((acc, l) => {
      acc[l.type] = (acc[l.type] || 0) + toNumber(l.amount);
      return acc;
    }, {} as Record<string, number>);

    // valuationDate：取所有有 marketPrice 的资产中最新的 marketPriceDate
    const valuationDates = assets
      .map((a) => a.marketPriceDate)
      .filter((d): d is Date => d !== null && d !== undefined) as Date[];
    const valuationDate =
      valuationDates.length > 0
        ? valuationDates.reduce((latest, d) => (d > latest ? d : latest))
        : null;

    res.json({
      totalAssets,
      totalLiabilities,
      netWorth,
      assets: assetByType,
      liabilities: liabilityByType,
      assetList: assets,
      liabilityList: liabilities,
      valuationDate
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
      // 优先用 incomeType 字段
      (i.incomeType && ['INVESTMENT', 'DIVIDEND', 'INTEREST', 'RENT'].includes(i.incomeType)) ||
      // 向下兼容：无 incomeType 的用字符串匹配
      (!i.incomeType && ['投资', '利息', '股息', '理财'].some((k) => i.category.includes(k)))
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

router.get('/investment-income', authMiddleware, cacheMiddleware(300), async (req: AuthRequest, res) => {
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

    // 筛选投资相关收益：优先用 incomeType，向下兼容用 category 字符串匹配
    const investmentIncomes = incomes.filter((i) => 
      (i.incomeType && ['INVESTMENT', 'DIVIDEND', 'INTEREST', 'RENT'].includes(i.incomeType)) ||
      (!i.incomeType && ['投资', '利息', '股息', '理财'].some((k) => i.category.includes(k)))
    );

    const byType: Record<string, number> = {};
    const byAssetMap: Record<string, { assetId: string; total: number }> = {};

    for (const inc of investmentIncomes) {
      const amount = toNumber(inc.amount);
      // 有 incomeType 用 incomeType，向下兼容时归入 INVESTMENT
      const type = inc.incomeType || 'INVESTMENT';
      byType[type] = (byType[type] || 0) + amount;

      if (inc.assetId) {
        if (!byAssetMap[inc.assetId]) {
          byAssetMap[inc.assetId] = { assetId: inc.assetId, total: 0 };
        }
        byAssetMap[inc.assetId].total += amount;
      }
    }

    // 查询关联资产名称
    const assetIds = Object.keys(byAssetMap);
    const assets = assetIds.length > 0
      ? await prisma.asset.findMany({ where: { id: { in: assetIds } } })
      : [];
    const assetNameMap = new Map(assets.map((a) => [a.id, a.name]));

    const byAsset = Object.values(byAssetMap).map(({ assetId, total }) => ({
      assetId,
      name: assetNameMap.get(assetId) || null,
      total,
    }));

    const total = investmentIncomes.reduce((s, i) => s + toNumber(i.amount), 0);

    res.json({
      total,
      byType,
      byAsset,
    });
  } catch (error) {
    console.error('获取投资收益报表错误:', error);
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
