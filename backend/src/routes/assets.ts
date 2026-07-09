import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { toNumber } from '../utils/decimal';

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

router.get('/allocation', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

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

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = assetSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const asset = await prisma.asset.create({
      data: {
        name: data.name,
        type: data.type,
        category: data.category,
        value: data.value,
        costBasis: data.costBasis,
        currency: data.currency,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        description: data.description,
        familyId
      }
    });

    res.status(201).json(asset);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('创建资产错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = assetSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership || membership.role === 'viewer') {
      return res.status(403).json({ error: '无权修改该数据' });
    }

    const asset = await prisma.asset.findUnique({
      where: { id }
    });

    if (!asset || asset.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        category: data.category,
        value: data.value,
        costBasis: data.costBasis,
        currency: data.currency,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        description: data.description
      }
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('更新资产错误:', error);
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

    const asset = await prisma.asset.findUnique({
      where: { id }
    });

    if (!asset || asset.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    await prisma.asset.delete({ where: { id } });

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除资产错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
