import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

const sumAmount = (records: Array<{ value?: any; amount?: any }>, field: 'value' | 'amount' = 'amount'): number =>
  records.reduce((sum, r) => sum + Number(r[field] ?? 0), 0);

// GET /summary — 返回用户所有家庭的对比数据
router.get('/summary', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const memberships = await prisma.familyMember.findMany({
      where: { userId },
      include: { family: true },
    });

    if (memberships.length === 0) {
      return res.json([]);
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const results = await Promise.all(
      memberships.map(async (m) => {
        const familyId = m.familyId;
        const familyName = m.family.name;

        const [assets, liabilities, incomes, expenses] = await Promise.all([
          prisma.asset.findMany({ where: { familyId }, select: { value: true } }),
          prisma.liability.findMany({ where: { familyId }, select: { amount: true } }),
          prisma.income.findMany({
            where: { familyId, date: { gte: monthStart } },
            select: { amount: true },
          }),
          prisma.expense.findMany({
            where: { familyId, date: { gte: monthStart } },
            select: { amount: true },
          }),
        ]);

        const totalAssets = sumAmount(assets as any[], 'value');
        const totalLiabilities = sumAmount(liabilities as any[]);
        const thisMonthIncome = sumAmount(incomes as any[]);
        const thisMonthExpense = sumAmount(expenses as any[]);

        return {
          familyId,
          familyName,
          totalAssets,
          totalLiabilities,
          netWorth: totalAssets - totalLiabilities,
          thisMonthIncome,
          thisMonthExpense,
        };
      })
    );

    res.json(results);
  } catch (error) {
    console.error('获取家庭对比数据错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
