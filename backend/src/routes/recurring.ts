import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { calculateNextDate } from '../services/recurringService';
import { parsePagination, paginateResponse } from '../utils/pagination';

const router = Router({ mergeParams: true });

const recurringSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  category: z.string().min(1, '类别不能为空'),
  amount: z.number().positive('金额必须大于0'),
  description: z.string().optional(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  interval: z.number().int().min(1).default(1),
  nextDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: '下次执行日期格式不正确',
  }),
  endDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)))
    .optional(),
});

const recurringUpdateSchema = recurringSchema.partial();

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

// GET /due — must be defined before /:id routes
router.get('/due', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const due = await prisma.recurringTransaction.findMany({
      where: {
        familyId,
        isActive: true,
        nextDate: { lte: new Date() },
      },
      orderBy: { nextDate: 'asc' },
    });

    res.json(due);
  } catch (error) {
    console.error('获取到期规则错误:', error);
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
      const [list, total] = await Promise.all([
        prisma.recurringTransaction.findMany({
          where: { familyId },
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.recurringTransaction.count({ where: { familyId } }),
      ]);
      return res.json(paginateResponse(list, total, pagination));
    }

    const list = await prisma.recurringTransaction.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(list);
  } catch (error) {
    console.error('获取定期规则错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = recurringSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const recurring = await prisma.recurringTransaction.create({
      data: {
        familyId,
        type: data.type,
        category: data.category,
        amount: data.amount,
        description: data.description || null,
        frequency: data.frequency,
        interval: data.interval,
        nextDate: new Date(data.nextDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        isActive: true,
        createdBy: req.userId!,
      },
    });

    res.status(201).json(recurring);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('创建定期规则错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/:id/execute', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const rule = await prisma.recurringTransaction.findUnique({ where: { id } });
    if (!rule || rule.familyId !== familyId) {
      return res.status(404).json({ error: '规则不存在' });
    }

    const now = new Date();
    const amount = Number(rule.amount);

    // 按类型创建 Income 或 Expense 记录
    if (rule.type === 'INCOME') {
      await prisma.income.create({
        data: {
          familyId,
          createdBy: req.userId!,
          category: rule.category,
          amount,
          description: rule.description || undefined,
          date: rule.nextDate,
          source: '定期记账',
        },
      });
    } else {
      await prisma.expense.create({
        data: {
          familyId,
          createdBy: req.userId!,
          category: rule.category,
          amount,
          description: rule.description || undefined,
          date: rule.nextDate,
          paymentMethod: undefined,
        },
      });
    }

    // 计算下次执行日期
    const nextNextDate = calculateNextDate(rule.nextDate, rule.frequency, rule.interval);
    const shouldDeactivate = rule.endDate ? nextNextDate > rule.endDate : false;

    await prisma.recurringTransaction.update({
      where: { id },
      data: {
        lastExecutedAt: now,
        nextDate: nextNextDate,
        isActive: !shouldDeactivate,
      },
    });

    const typeLabel = rule.type === 'INCOME' ? '收入' : '支出';
    res.json({
      message: `执行成功，已生成${typeLabel}记录 ¥${amount.toFixed(2)}`,
      nextDate: nextNextDate,
      isActive: !shouldDeactivate,
    });
  } catch (error) {
    console.error('执行定期规则错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = recurringUpdateSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership || membership.role === 'viewer') {
      return res.status(403).json({ error: '无权修改该数据' });
    }

    const rule = await prisma.recurringTransaction.findUnique({ where: { id } });
    if (!rule || rule.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const updateData: any = {};
    if (data.type !== undefined) updateData.type = data.type;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.description !== undefined) updateData.description = data.description || null;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;
    if (data.interval !== undefined) updateData.interval = data.interval;
    if (data.nextDate !== undefined) updateData.nextDate = new Date(data.nextDate);
    if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;

    const updated = await prisma.recurringTransaction.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('更新定期规则错误:', error);
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

    const rule = await prisma.recurringTransaction.findUnique({ where: { id } });
    if (!rule || rule.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    await prisma.recurringTransaction.delete({ where: { id } });
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除定期规则错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
