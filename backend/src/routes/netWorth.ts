import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  takeSnapshot,
  getHistory,
  getLatestSnapshot,
} from '../services/netWorthService';

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

/**
 * GET /history?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * 获取家庭净值历史快照，默认返回最近 30 天。
 */
router.get('/history', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : new Date();
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const history = await getHistory(familyId, startDate, endDate);
    res.json(history);
  } catch (error) {
    console.error('获取净值历史错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * GET /latest
 * 获取家庭最近一条净值快照。
 */
router.get('/latest', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const snapshot = await getLatestSnapshot(familyId);
    if (!snapshot) {
      return res.status(404).json({ error: '暂无净值快照' });
    }
    res.json(snapshot);
  } catch (error) {
    console.error('获取最新净值快照错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * POST /snapshot
 * 手动触发当前家庭的净值快照生成。
 */
router.post('/snapshot', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const snapshot = await takeSnapshot(familyId);
    res.status(201).json(snapshot);
  } catch (error) {
    console.error('生成净值快照错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
