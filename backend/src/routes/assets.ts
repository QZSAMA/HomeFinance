import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireFamilyAccess, requireFamilyWriteAccess } from '../middleware/familyAccess';
import {
  createAsset,
  deleteAsset,
  updateAsset,
} from '../services/balanceMutationService';
import { createPrismaFinancialMutationStore } from '../services/prismaFinancialMutationStore';
import { toNumber } from '../utils/decimal';
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

const assetSchema = z.object({
  name: z.string().min(1, '资产名称不能为空'),
  type: z.enum(['CASH', 'STOCK', 'BOND', 'GOLD', 'REAL_ESTATE', 'FUND', 'OTHER']),
  category: z.string().optional(),
  value: z.number().nonnegative('价值不能为负'),
  costBasis: z.number().nonnegative('成本不能为负').optional(),
  currency: z.string().default('CNY'),
  purchaseDate: z.string().optional(),
  description: z.string().optional()
});

const financialMutationStore = createPrismaFinancialMutationStore(prisma);

router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const pagination = parsePagination(req);
    if (pagination) {
      const [assets, total] = await Promise.all([
        prisma.asset.findMany({
          where: { familyId },
          orderBy: { value: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.asset.count({ where: { familyId } }),
      ]);
      return res.json(paginateResponse(assets, total, pagination));
    }

    const assets = await prisma.asset.findMany({
      where: { familyId },
      orderBy: { value: 'desc' }
    });

    res.json(assets);
  } catch (error) {
    console.error('获取资产列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/allocation', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const assets = await prisma.asset.findMany({
      where: { familyId },
      select: {
        type: true,
        value: true
      }
    });

    const totalValue = assets.reduce((sum, a) => sum + toNumber(a.value), 0);

    const allocationMap: Record<string, number> = {
      STOCK: 0,
      BOND: 0,
      GOLD: 0,
      CASH: 0,
      OTHER: 0
    };

    assets.forEach((asset) => {
      const type = asset.type;
      const val = toNumber(asset.value);
      if (type === 'STOCK' || type === 'FUND') {
        allocationMap['STOCK'] += val;
      } else if (type === 'BOND') {
        allocationMap['BOND'] += val;
      } else if (type === 'GOLD') {
        allocationMap['GOLD'] += val;
      } else if (type === 'CASH') {
        allocationMap['CASH'] += val;
      } else {
        allocationMap['OTHER'] += val;
      }
    });

    const allocation = Object.entries(allocationMap).map(([category, value]) => ({
      category,
      value,
      percentage: totalValue > 0 ? Number(((value / totalValue) * 100).toFixed(2)) : 0
    }));

    res.json({
      totalValue,
      allocation
    });
  } catch (error) {
    console.error('获取投资配置错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = assetSchema.parse(req.body);
    const result = await createAsset({
      familyId,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      payload: {
        name: data.name,
        type: data.type,
        category: data.category,
        value: data.value,
        costBasis: data.costBasis,
        currency: data.currency,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        description: data.description,
      },
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.status(201).json(mutationResource(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '创建资产');
  }
});

router.put('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = assetSchema.parse(req.body);
    const result = await updateAsset({
      familyId,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      assetId: id,
      expectedVersion: readExpectedVersion(req),
      payload: {
        name: data.name,
        type: data.type,
        category: data.category,
        value: data.value,
        costBasis: data.costBasis,
        currency: data.currency,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        description: data.description,
      },
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.json(mutationResource(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '更新资产');
  }
});

router.delete('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {
  try {
    const result = await deleteAsset({
      familyId: req.params.familyId as string,
      actorId: req.userId!,
      source: 'MANUAL',
      idempotencyKey: readIdempotencyKey(req),
      assetId: req.params.id as string,
      expectedVersion: readExpectedVersion(req),
    }, financialMutationStore);

    markIdempotencyReplay(result, res);
    return res.json(mutationDeleteResponse(result));
  } catch (error) {
    return sendLedgerMutationError(error, res, '删除资产');
  }
});

export default router;
