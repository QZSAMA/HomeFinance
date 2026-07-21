import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router({ mergeParams: true });

const goalSchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  type: z.enum(['SAVING', 'DEBT_PAYOFF', 'INVESTMENT']),
  targetAmount: z.number().positive('目标金额必须大于 0'),
  deadline: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)))
    .optional(),
});

const goalUpdateSchema = goalSchema.partial();

const checkFamilyAccess = async (familyId: string, userId: string) => {
  const membership = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId } },
  });
  return membership;
};

// GET /progress — must be defined before /:id routes
router.get('/progress', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const goals = await prisma.goal.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    });

    const [assets, liabilities] = await Promise.all([
      prisma.asset.findMany({ where: { familyId }, select: { value: true } }),
      prisma.liability.findMany({ where: { familyId }, select: { amount: true } }),
    ]);

    const totalAssets = (assets as any[]).reduce((s, r) => s + Number(r.value), 0);
    const totalLiabilities = (liabilities as any[]).reduce((s, r) => s + Number(r.amount), 0);
    const netWorth = totalAssets - totalLiabilities;

    const progress = goals.map((goal) => {
      const target = Number(goal.targetAmount);
      let currentAmount = 0;
      if (goal.type === 'SAVING') {
        currentAmount = Math.max(0, netWorth);
      } else if (goal.type === 'DEBT_PAYOFF') {
        currentAmount = Math.max(0, target - totalLiabilities);
      } else if (goal.type === 'INVESTMENT') {
        currentAmount = Math.max(0, totalAssets);
      }
      currentAmount = Math.min(currentAmount, target);
      const percentage = target > 0 ? Math.round((currentAmount / target) * 100) : 0;
      return { goal, currentAmount, percentage };
    });

    res.json(progress);
  } catch (error) {
    console.error('获取目标进度错误:', error);
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

    const goals = await prisma.goal.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(goals);
  } catch (error) {
    console.error('获取目标列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = goalSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const goal = await prisma.goal.create({
      data: {
        familyId,
        title: data.title,
        type: data.type,
        targetAmount: data.targetAmount,
        deadline: data.deadline ? new Date(data.deadline) : null,
        createdBy: req.userId!,
      },
    });

    res.status(201).json(goal);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('创建目标错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = goalUpdateSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership || membership.role === 'viewer') {
      return res.status(403).json({ error: '无权修改该数据' });
    }

    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal || goal.familyId !== familyId) {
      return res.status(404).json({ error: '目标不存在' });
    }

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.targetAmount !== undefined) updateData.targetAmount = data.targetAmount;
    if (data.deadline !== undefined) updateData.deadline = data.deadline ? new Date(data.deadline) : null;

    const updated = await prisma.goal.update({ where: { id }, data: updateData });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('更新目标错误:', error);
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

    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal || goal.familyId !== familyId) {
      return res.status(404).json({ error: '目标不存在' });
    }

    await prisma.goal.delete({ where: { id } });
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除目标错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
