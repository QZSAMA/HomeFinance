import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router({ mergeParams: true });

const liabilitySchema = z.object({
  name: z.string().min(1, '负债名称不能为空'),
  type: z.enum(['MORTGAGE', 'CAR_LOAN', 'STUDENT_LOAN', 'CREDIT_CARD', 'PERSONAL_LOAN', 'OTHER']),
  amount: z.number().nonnegative('金额不能为负'),
  interestRate: z.number().nonnegative('利率不能为负').optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  currency: z.string().default('CNY'),
  description: z.string().optional()
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

    const liabilities = await prisma.liability.findMany({
      where: { familyId },
      orderBy: { amount: 'desc' }
    });

    res.json(liabilities);
  } catch (error) {
    console.error('获取负债列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = liabilitySchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const liability = await prisma.liability.create({
      data: {
        name: data.name,
        type: data.type,
        amount: data.amount,
        interestRate: data.interestRate,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        currency: data.currency,
        description: data.description,
        familyId
      }
    });

    res.status(201).json(liability);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('创建负债错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = liabilitySchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership || membership.role === 'viewer') {
      return res.status(403).json({ error: '无权修改该数据' });
    }

    const liability = await prisma.liability.findUnique({
      where: { id }
    });

    if (!liability || liability.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const updated = await prisma.liability.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        amount: data.amount,
        interestRate: data.interestRate,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        currency: data.currency,
        description: data.description
      }
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('更新负债错误:', error);
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

    const liability = await prisma.liability.findUnique({
      where: { id }
    });

    if (!liability || liability.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    await prisma.liability.delete({ where: { id } });

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除负债错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
