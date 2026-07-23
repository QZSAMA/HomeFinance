import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { parsePagination, paginateResponse } from '../utils/pagination';

const router = Router({ mergeParams: true });

const expenseSchema = z.object({
  amount: z.number().positive('金额必须大于0'),
  category: z.string().min(1, '类别不能为空'),
  description: z.string().optional(),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: '日期格式不正确'
  }),
  paymentMethod: z.string().optional()
});

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

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const pagination = parsePagination(req);
    if (pagination) {
      const [expenses, total] = await Promise.all([
        prisma.expense.findMany({
          where: { familyId },
          orderBy: { date: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.expense.count({ where: { familyId } }),
      ]);
      return res.json(paginateResponse(expenses, total, pagination));
    }

    const expenses = await prisma.expense.findMany({
      where: { familyId },
      orderBy: { date: 'desc' }
    });

    res.json(expenses);
  } catch (error) {
    console.error('获取支出列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/check-duplicate', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const { amount, date, description } = req.body;

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const duplicates = await prisma.expense.findMany({
      where: {
        familyId,
        amount,
        date: {
          gte: startOfDay,
          lte: endOfDay
        },
        description: description ? { contains: description } : undefined
      }
    });

    res.json({
      hasDuplicate: duplicates.length > 0,
      duplicates
    });
  } catch (error) {
    console.error('检测重复支出错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = expenseSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const expense = await prisma.expense.create({
      data: {
        amount: data.amount,
        category: data.category,
        description: data.description,
        date: new Date(data.date),
        paymentMethod: data.paymentMethod,
        familyId,
        createdBy: req.userId!
      }
    });

    res.status(201).json(expense);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('创建支出错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = expenseSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership || membership.role === 'viewer') {
      return res.status(403).json({ error: '无权修改该数据' });
    }

    const expense = await prisma.expense.findUnique({
      where: { id }
    });

    if (!expense || expense.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: {
        amount: data.amount,
        category: data.category,
        description: data.description,
        date: new Date(data.date),
        paymentMethod: data.paymentMethod
      }
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('更新支出错误:', error);
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

    const expense = await prisma.expense.findUnique({
      where: { id }
    });

    if (!expense || expense.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    await prisma.expense.delete({ where: { id } });

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除支出错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
