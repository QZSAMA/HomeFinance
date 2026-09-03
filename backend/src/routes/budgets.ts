import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFamilyAccess, requireFamilyWriteAccess } from '../middleware/familyAccess';
import { parsePagination, paginateResponse } from '../utils/pagination';
import { PeriodKind, resolvePeriodWindow } from '../services/periodWindowService';
import { summarizeByCurrency } from '../services/currencySummaryService';
import { DomainError } from '../services/ledgerErrors';

const router = Router({ mergeParams: true });

const budgetSchema = z.object({
  category: z.string().min(1, '类别不能为空'),
  amount: z.number().positive('金额必须大于0'),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, '币种必须是三位字母').transform((value) => value.toUpperCase()).optional(),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).default('MONTHLY'),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: '开始日期格式不正确',
  }),
  endDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)))
    .optional(),
});

type FamilySettings = { timezone: string; baseCurrency: string };

const loadFamilySettings = async (familyId: string): Promise<FamilySettings> => {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { timezone: true, baseCurrency: true },
  });
  if (!family) throw new DomainError('RESOURCE_NOT_FOUND', '家庭不存在', 404);
  return family;
};

const toLocalDate = (instant: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

const resolveBudgetWindow = (
  budget: { period: string; startDate: Date; endDate: Date | null },
  settings: FamilySettings,
  referenceInstant: Date,
) => {
  const kind = budget.period as PeriodKind;
  const calendarWindow = resolvePeriodWindow({
    timezone: settings.timezone,
    kind,
    referenceInstant,
  });
  const startLocal = [calendarWindow.startLocal, toLocalDate(budget.startDate, settings.timezone)]
    .sort()
    .at(-1)!;
  const endCandidates = [calendarWindow.endLocalExclusive];
  if (budget.endDate) endCandidates.push(toLocalDate(budget.endDate, settings.timezone));
  const endLocalExclusive = endCandidates.sort()[0];
  if (startLocal >= endLocalExclusive) {
    return {
      ...calendarWindow,
      startLocal,
      endLocalExclusive: startLocal,
      startUtc: calendarWindow.endUtc,
      endUtc: calendarWindow.endUtc,
    };
  }
  return resolvePeriodWindow({
    timezone: settings.timezone,
    kind: 'CUSTOM',
    localStart: startLocal,
    localEndExclusive: endLocalExclusive,
  });
};

const routeError = (error: unknown, res: any, label: string) => {
  if (error instanceof DomainError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(label, error);
  return res.status(500).json({ error: '服务器内部错误' });
};

// GET /progress — must be defined before /:id routes to avoid route shadowing
router.get('/progress', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const settings = await loadFamilySettings(familyId);

    const budgets = await prisma.budget.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const progress = await Promise.all(
      budgets.map(async (budget) => {
        const window = resolveBudgetWindow(budget, settings, now);
        const grouped = await prisma.expense.groupBy({
          by: ['currency'],
          where: {
            familyId,
            category: budget.category,
            date: {
              gte: window.startUtc,
              lt: window.endUtc,
            },
          },
          _sum: { amount: true },
        });
        const spentSummary = summarizeByCurrency(
          grouped.map((row) => ({ amount: row._sum.amount ?? 0, currency: row.currency })),
          settings.baseCurrency,
        );
        const spent = spentSummary.totalInBaseCurrency;
        const budgetAmount = Number(budget.amount);
        const remaining = spent === null ? null : budgetAmount - spent;
        const percentage = spent === null || budgetAmount <= 0 ? null : Math.round((spent / budgetAmount) * 100);

        return {
          budget,
          spent,
          remaining,
          percentage,
          totalsByCurrency: spentSummary.totalsByCurrency,
          conversionStatus: spentSummary.conversionStatus,
          window,
          timezone: settings.timezone,
          baseCurrency: settings.baseCurrency,
        };
      })
    );

    res.json(progress);
  } catch (error) {
    return routeError(error, res, '获取预算进度错误:');
  }
});

router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
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

router.post('/', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = budgetSchema.parse(req.body);
    const family = await loadFamilySettings(familyId);

    const budget = await prisma.budget.create({
      data: {
        familyId,
        category: data.category,
        amount: data.amount,
        currency: data.currency ?? family.baseCurrency,
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

router.put('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = budgetSchema.parse(req.body);

    const budget = await prisma.budget.findUnique({ where: { id } });
    if (!budget || budget.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const family = await loadFamilySettings(familyId);
    const updated = await prisma.budget.update({
      where: { id },
      data: {
        category: data.category,
        amount: data.amount,
        currency: data.currency ?? budget.currency ?? family.baseCurrency,
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

router.delete('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

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
