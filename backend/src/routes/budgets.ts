import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { parsePagination, paginateResponse } from '../utils/pagination';

const router = Router({ mergeParams: true });

const budgetSchema = z.object({
  category: z.string().min(1, '类别不能为空'),
  amount: z.number().positive('金额必须大于0'),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).default('MONTHLY'),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: '开始日期格式不正确',
  }),
  endDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)))
    .optional(),
});

const checkFamilyAccess = async (familyId: string, userId: string) => {
  const membership = await prisma.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId,
        userId,
      },
    },
  });
  return membership;
};

// GET /progress — must be defined before /:id routes to avoid route shadowing
router.get('/progress', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const budgets = await prisma.budget.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const progress = await Promise.all(
      budgets.map(async (budget) => {
        const startDate = budget.startDate;
        const endDate = budget.endDate || now;
        const effectiveStart = startDate > now ? startDate : startDate;
        const effectiveEnd = endDate < now ? endDate : now;

        const expenses = await prisma.expense.findMany({
          where: {
            familyId,
            category: budget.category,
            date: {
              gte: effectiveStart,
              lte: effectiveEnd,
            },
          },
          select: { amount: true },
        });

        const spent = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
        const budgetAmount = Number(budget.amount);
        const remaining = budgetAmount - spent;
        const percentage = budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0;

        return {
          budget,
          spent,
          remaining,
          percentage,
        };
      })
    );

    res.json(progress);
  } catch (error) {
    console.error('获取预算进度错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const pagination = parsePagination(req);
    if (pagination) {
      const [budgets, total] = await Promise.all([
        prisma.budget.findMany({
          where: { familyId },
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.budget.count({ where: { familyId } }),
      ]);
      return res.json(paginateResponse(budgets, total, pagination));
    }

    const budgets = await prisma.budget.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(budgets);
  } catch (error) {
    console.error('获取预算列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = budgetSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const budget = await prisma.budget.create({
      data: {
        familyId,
        category: data.category,
        amount: data.amount,
        period: data.period,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        createdBy: req.userId!,
      },
    });

    res.status(201).json(budget);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('创建预算错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = budgetSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership || membership.role === 'viewer') {
      return res.status(403).json({ error: '无权修改该数据' });
    }

    const budget = await prisma.budget.findUnique({ where: { id } });
    if (!budget || budget.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const updated = await prisma.budget.update({
      where: { id },
      data: {
        category: data.category,
        amount: data.amount,
        period: data.period,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
      },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('更新预算错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership || membership.role === 'viewer') {
      return res.status(403).json({ error: '无权删除该数据' });
    }

    const budget = await prisma.budget.findUnique({ where: { id } });
    if (!budget || budget.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    await prisma.budget.delete({ where: { id } });
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除预算错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
