import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFamilyAccess, requireFamilyWriteAccess } from '../middleware/familyAccess';
import {
  createLiability,
  deleteLiability,
  updateLiability,
} from '../services/balanceMutationService';
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

const financialMutationStore = createPrismaFinancialMutationStore(prisma);

router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;

    const pagination = parsePagination(req);
    if (pagination) {
      const [liabilities, total] = await Promise.all([
        prisma.liability.findMany({
          where: { familyId },
          orderBy: { amount: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.liability.count({ where: { familyId } }),
      ]);
      return res.json(paginateResponse(liabilities, total, pagination));
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

router.post('/', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = liabilitySchema.parse(req.body);
    const result = await createLiability({
      familyId,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      payload: {
        name: data.name,
        type: data.type,
        amount: data.amount,
        interestRate: data.interestRate,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        currency: data.currency,
        description: data.description,
      },
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.status(201).json(mutationResource(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '创建负债');
  }
});

router.put('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = liabilitySchema.parse(req.body);
    const result = await updateLiability({
      familyId,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      liabilityId: id,
      expectedVersion: readExpectedVersion(req),
      payload: {
        name: data.name,
        type: data.type,
        amount: data.amount,
        interestRate: data.interestRate,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        currency: data.currency,
        description: data.description,
      },
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.json(mutationResource(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '更新负债');
  }
});

router.delete('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const result = await deleteLiability({
      familyId: req.params.familyId as string,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      liabilityId: req.params.id as string,
      expectedVersion: readExpectedVersion(req),
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.json(mutationDeleteResponse(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '删除负债');
  }
});

export default router;
