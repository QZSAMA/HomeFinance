import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFamilyAccess, requireFamilyWriteAccess } from '../middleware/familyAccess';
import {
  createExpense,
  deleteExpense,
  updateExpense,
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

const expenseSchema = z.object({
  amount: z.number().positive('金额必须大于0'),
  category: z.string().min(1, '类别不能为空'),
  description: z.string().optional(),
  date: z.string().refine((value) => !isNaN(Date.parse(value)), {
    message: '日期格式不正确',
  }),
  paymentMethod: z.string().optional(),
  currency: z.string().optional(),
});

const financialMutationStore = createPrismaFinancialMutationStore(prisma);

router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
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
      orderBy: { date: 'desc' },
    });
    return res.json(expenses);
  } catch (error) {
    console.error('获取支出列表错误:', error);
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

    const duplicates = await prisma.expense.findMany({
      where: {
        familyId,
        amount,
        date: { gte: startOfDay, lte: endOfDay },
        description: description ? { contains: description } : undefined,
      },
    });

    return res.json({ hasDuplicate: duplicates.length > 0, duplicates });
  } catch (error) {
    console.error('检测重复支出错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = expenseSchema.parse(req.body);
    const result = await createExpense({
      familyId,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      effectiveDate: new Date(data.date),
      payload: {
        amount: data.amount,
        category: data.category,
        description: data.description,
        paymentMethod: data.paymentMethod,
        currency: data.currency,
      },
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.status(201).json(mutationResource(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '支出');
  }
});

router.put('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = expenseSchema.parse(req.body);
    const result = await updateExpense({
      familyId,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      expenseId: req.params.id as string,
      expectedVersion: readExpectedVersion(req),
      effectiveDate: new Date(data.date),
      payload: {
        amount: data.amount,
        category: data.category,
        description: data.description,
        paymentMethod: data.paymentMethod,
        currency: data.currency,
      },
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.json(mutationResource(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '支出');
  }
});

router.delete('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const result = await deleteExpense({
      familyId: req.params.familyId as string,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      expenseId: req.params.id as string,
      expectedVersion: readExpectedVersion(req),
      effectiveDate: new Date(),
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.json(mutationDeleteResponse(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '支出');
  }
});

export default router;
