import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFamilyAccess, requireFamilyWriteAccess } from '../middleware/familyAccess';
import { executeRecurring } from '../services/recurringService';
import { createPrismaRecurringExecutionStore } from '../services/prismaRecurringExecutionStore';
import { parsePagination, paginateResponse } from '../utils/pagination';
import {
  markIdempotencyReplay,
  readIdempotencyKey,
  sendLedgerMutationError,
} from './ledgerRouteSupport';

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
const recurringExecuteSchema = z.object({
  scheduledFor: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: '执行日期格式不正确',
  }).optional(),
});
const recurringExecutionStore = createPrismaRecurringExecutionStore(prisma);

// GET /due — must be defined before /:id routes
router.get('/due', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const due = await prisma.recurringTransaction.findMany({
      where: {
        familyId,
        deletedAt: null,
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

router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const pagination = parsePagination(req);
    if (pagination) {
      const [list, total] = await Promise.all([
        prisma.recurringTransaction.findMany({
          where: { familyId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.recurringTransaction.count({ where: { familyId, deletedAt: null } }),
      ]);
      return res.json(paginateResponse(list, total, pagination));
    }

    const list = await prisma.recurringTransaction.findMany({
      where: { familyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    res.json(list);
  } catch (error) {
    console.error('获取定期规则错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = recurringSchema.parse(req.body);

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

router.post('/:id/execute', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = recurringExecuteSchema.parse(req.body ?? {});
    const result = await executeRecurring({
      familyId,
      actorId: req.userId!,
      recurringId: req.params.id as string,
      idempotencyKey: readIdempotencyKey(req),
      ...(data.scheduledFor ? { scheduledFor: new Date(data.scheduledFor) } : {}),
      now: new Date(),
    }, recurringExecutionStore);
    markIdempotencyReplay(result, res);
    const amount = Number(result.entryRecord?.amount);
    return res.json({
      message: Number.isFinite(amount)
        ? `执行成功，已生成账目记录 ¥${amount.toFixed(2)}`
        : '执行成功，已生成账目记录',
      executionId: result.executionId,
      operationId: result.operationId,
      resourceId: result.entryId,
      entryId: result.entryId,
      deduplicated: result.deduplicated,
      nextDate: result.nextDate,
      isActive: result.isActive,
    });
  } catch (error) {
    return sendLedgerMutationError(error, res, '定期规则');
  }
});

router.put('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = recurringUpdateSchema.parse(req.body);

    const rule = await prisma.recurringTransaction.findFirst({
      where: { id, familyId, deletedAt: null },
    });
    if (!rule) {
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

router.delete('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

    const rule = await prisma.recurringTransaction.findFirst({
      where: { id, familyId, deletedAt: null },
    });
    if (!rule) {
      return res.status(404).json({ error: '记录不存在' });
    }

    await prisma.recurringTransaction.updateMany({
      where: { id, familyId },
      data: { isActive: false, deletedAt: new Date(), version: { increment: 1 } },
    });
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除定期规则错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
