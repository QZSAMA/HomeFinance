import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFamilyAccess, requireFamilyWriteAccess } from '../middleware/familyAccess';
import { parsePagination, paginateResponse } from '../utils/pagination';
import { summarizeByCurrency } from '../services/currencySummaryService';
import { createGoalContribution } from '../services/goalContributionService';
import { DomainError } from '../services/ledgerErrors';
import { readIdempotencyKey, markIdempotencyReplay } from './ledgerRouteSupport';

const router = Router({ mergeParams: true });

const goalSchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  type: z.enum(['SAVING', 'DEBT_PAYOFF', 'INVESTMENT']),
  targetAmount: z.number().positive('目标金额必须大于 0'),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, '币种必须是三位字母').transform((value) => value.toUpperCase()).optional(),
  deadline: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)))
    .optional(),
});

const goalUpdateSchema = goalSchema.partial();

const contributionSchema = z.object({
  sourceType: z.enum(['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY', 'MANUAL']),
  sourceId: z.string().min(1).optional(),
  amount: z.number().positive('贡献金额必须大于 0'),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, '币种必须是三位字母').transform((value) => value.toUpperCase()).optional(),
  contributionDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), '贡献日期格式不正确').optional(),
  allocationKey: z.string().trim().min(1, '分配键不能为空'),
});

const sendError = (error: unknown, res: any, label: string) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message, code: 'VALIDATION_FAILED' });
  if (error instanceof DomainError) return res.status(error.status).json({ error: error.message, code: error.code, retryable: error.retryable });
  console.error(label, error);
  return res.status(500).json({ error: '服务器内部错误', code: 'INTERNAL_ERROR' });
};

const loadFamilyBaseCurrency = async (familyId: string): Promise<string> => {
  const family = await prisma.family.findUnique({ where: { id: familyId }, select: { baseCurrency: true } });
  if (!family) throw new DomainError('RESOURCE_NOT_FOUND', '家庭不存在', 404);
  return family.baseCurrency;
};

// GET /progress — must be defined before /:id routes
router.get('/progress', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const goals = await prisma.goal.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    });

    const contributions = await prisma.goalContribution.findMany({
      where: { familyId },
      orderBy: { contributionDate: 'asc' },
    });
    const contributionsByGoal = new Map<string, any[]>();
    for (const contribution of contributions) {
      const rows = contributionsByGoal.get(contribution.goalId) ?? [];
      rows.push(contribution);
      contributionsByGoal.set(contribution.goalId, rows);
    }

    const progress = goals.map((goal) => {
      const target = Number(goal.targetAmount);
      const rows = contributionsByGoal.get(goal.id) ?? [];
      const summary = summarizeByCurrency(
        rows.map((row) => ({ amount: row.amount, currency: row.currency })),
        goal.currency ?? 'CNY',
      );
      const currentAmount = rows.length === 0 || summary.totalInBaseCurrency === null
        ? null
        : Math.min(summary.totalInBaseCurrency, target);
      const percentage = currentAmount === null || target <= 0 ? null : Math.round((currentAmount / target) * 100);
      return {
        goal,
        currentAmount,
        percentage,
        totalsByCurrency: summary.totalsByCurrency,
        conversionStatus: summary.conversionStatus,
        progressStatus: currentAmount === null ? 'unavailable' : 'exact',
      };
    });

    res.json(progress);
  } catch (error) {
    return sendError(error, res, '获取目标进度错误:');
  }
});

router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const pagination = parsePagination(req);
    if (pagination) {
      const [goals, total] = await Promise.all([
        prisma.goal.findMany({
          where: { familyId },
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.goal.count({ where: { familyId } }),
      ]);
      return res.json(paginateResponse(goals, total, pagination));
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

router.post('/', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = goalSchema.parse(req.body);
    const baseCurrency = await loadFamilyBaseCurrency(familyId);

    const goal = await prisma.goal.create({
      data: {
        familyId,
        title: data.title,
        type: data.type,
        targetAmount: data.targetAmount,
        currency: data.currency ?? baseCurrency,
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

router.post('/:goalId/contributions', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const data = contributionSchema.parse(req.body);
    const baseCurrency = await loadFamilyBaseCurrency(req.params.familyId as string);
    const result = await createGoalContribution({
      familyId: req.params.familyId as string,
      actorUserId: req.userId!,
      goalId: req.params.goalId as string,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      amount: data.amount,
      currency: data.currency ?? baseCurrency,
      contributionDate: data.contributionDate ? new Date(data.contributionDate) : new Date(),
      allocationKey: data.allocationKey,
      idempotencyKey: readIdempotencyKey(req),
    });
    markIdempotencyReplay(result as any, res);
    return res.status(result.deduplicated ? 200 : 201).json(result);
  } catch (error) {
    return sendError(error, res, '创建目标贡献错误:');
  }
});

router.put('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = goalUpdateSchema.parse(req.body);

    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal || goal.familyId !== familyId) {
      return res.status(404).json({ error: '目标不存在' });
    }

    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.targetAmount !== undefined) updateData.targetAmount = data.targetAmount;
    if (data.currency !== undefined) updateData.currency = data.currency;
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

router.delete('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

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
