import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  getQuote,
  refreshAllAssetPrices,
  refreshAssetPrice,
} from '../services/marketDataService';

const router = Router({ mergeParams: true });

const checkFamilyAccess = async (familyId: string, userId: string) => {
  const membership = await prisma.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId,
        userId,
      },
    },
  });
  return membership;
};

// GET /quote?symbol=sh600519 - 获取单个证券行情
router.get('/quote', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const symbol = req.query.symbol as string;
    if (!symbol || !symbol.trim()) {
      return res.status(400).json({ error: 'symbol 参数不能为空' });
    }

    const quote = await getQuote(symbol.trim());
    return res.json(quote);
  } catch (error) {
    console.error('获取行情错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /refresh - 刷新家庭所有资产行情
router.post('/refresh', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const result = await refreshAllAssetPrices(familyId);
    return res.json(result);
  } catch (error) {
    console.error('刷新家庭资产行情错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /refresh/:assetId - 刷新单个资产行情
router.post('/refresh/:assetId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const assetId = req.params.assetId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const result = await refreshAssetPrice(assetId);

    if (result.success) {
      return res.status(200).json(result);
    }

    // 失败：根据 error 区分状态码
    if (result.error === '资产不存在') {
      return res.status(404).json({ error: result.error });
    }
    if (result.error === '该资产未设置证券代码') {
      return res.status(400).json({ error: result.error });
    }
    // 其他失败（行情 API 不可用等）视为服务器错误
    return res.status(500).json({ error: result.error });
  } catch (error) {
    console.error('刷新单个资产行情错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
