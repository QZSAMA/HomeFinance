import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFamilyAccess, requireFamilyWriteAccess } from '../middleware/familyAccess';
import {
  createIncome,
  deleteIncome,
  updateIncome,
} from '../services/ledgerApplicationService';
import { createPrismaFinancialMutationStore } from '../services/prismaFinancialMutationStore';
import { parsePagination, paginateResponse } from '../utils/pagination';
import {
  markIdempotencyReplay,
  mutationDeleteResponse,
  mutationResource,
  readExpectedVersion,
  readIdempotencyKey,
  sendLedgerMutationError,
} from './ledgerRouteSupport';

const router = Router({ mergeParams: true });

const incomeSchema = z.object({
  amount: z.number().positive('金额必须大于0'),
  category: z.string().min(1, '类别不能为空'),
  description: z.string().optional(),
  date: z.string().refine((value) => !isNaN(Date.parse(value)), {
    message: '日期格式不正确',
  }),
  source: z.string().optional(),
  currency: z.string().optional(),
});

const financialMutationStore = createPrismaFinancialMutationStore(prisma);

router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const pagination = parsePagination(req);
    if (pagination) {
      const [incomes, total] = await Promise.all([
        prisma.income.findMany({
          where: { familyId },
          orderBy: { date: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.income.count({ where: { familyId } }),
      ]);
      return res.json(paginateResponse(incomes, total, pagination));
    }

    const incomes = await prisma.income.findMany({
      where: { familyId },
      orderBy: { date: 'desc' },
    });
    return res.json(incomes);
  } catch (error) {
    console.error('获取收入列表错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/check-duplicate', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const { amount, date, description } = req.body;
    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const duplicates = await prisma.income.findMany({
      where: {
        familyId,
        amount,
        date: { gte: startOfDay, lte: endOfDay },
        description: description ? { contains: description } : undefined,
      },
    });

    return res.json({ hasDuplicate: duplicates.length > 0, duplicates });
  } catch (error) {
    console.error('检测重复收入错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = incomeSchema.parse(req.body);
    const result = await createIncome({
      familyId,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      effectiveDate: new Date(data.date),
      payload: {
        amount: data.amount,
        category: data.category,
        description: data.description,
        source: data.source,
        currency: data.currency,
      },
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.status(201).json(mutationResource(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '收入');
  }
});

router.put('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = incomeSchema.parse(req.body);
    const result = await updateIncome({
      familyId,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      incomeId: req.params.id as string,
      expectedVersion: readExpectedVersion(req),
      effectiveDate: new Date(data.date),
      payload: {
        amount: data.amount,
        category: data.category,
        description: data.description,
        source: data.source,
        currency: data.currency,
      },
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.json(mutationResource(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '收入');
  }
});

router.delete('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const result = await deleteIncome({
      familyId: req.params.familyId as string,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      incomeId: req.params.id as string,
      expectedVersion: readExpectedVersion(req),
      effectiveDate: new Date(),
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.json(mutationDeleteResponse(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '收入');
  }
});

export default router;
