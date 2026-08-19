import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { detectAndSaveAnomalies } from '../services/anomalyService';

const router = Router({ mergeParams: true });

const checkFamilyAccess = async (familyId: string, userId: string) => {
  return prisma.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId,
        userId,
      },
    },
  });
};

// GET /detect — must be defined before /:id routes to avoid route shadowing
router.get('/detect', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const result = await detectAndSaveAnomalies(familyId);
    res.json(result);
  } catch (error) {
    console.error('触发异常检测错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET / — 获取家庭告警列表
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const isReadQuery = req.query.isRead as string | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const where: { familyId: string; isRead?: boolean } = { familyId };
    if (isReadQuery === 'true') {
      where.isRead = true;
    } else if (isReadQuery === 'false') {
      where.isRead = false;
    }

    const [alerts, unreadCount] = await Promise.all([
      prisma.anomalyAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.anomalyAlert.count({
        where: { familyId, isRead: false },
      }),
    ]);

    res.json({ alerts, unreadCount });
  } catch (error) {
    console.error('获取告警列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /read-all — must be defined before /:id routes to avoid route shadowing
router.put('/read-all', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const result = await prisma.anomalyAlert.updateMany({
      where: { familyId, isRead: false },
      data: { isRead: true },
    });

    res.json({ updated: result.count });
  } catch (error) {
    console.error('标记全部告警已读错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /:id/read — 标记单条告警已读
router.put('/:id/read', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const alert = await prisma.anomalyAlert.findUnique({ where: { id } });
    if (!alert || alert.familyId !== familyId) {
      return res.status(404).json({ error: '告警不存在' });
    }

    const updated = await prisma.anomalyAlert.update({
      where: { id },
      data: { isRead: true },
    });

    res.json(updated);
  } catch (error) {
    console.error('标记告警已读错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
