// V4.4 通知查询路由
// 挂载到 /api/families/:familyId/notifications：
// - GET /              当前用户在该家庭的投递列表（含未读数）
// - GET /unread-count  未读数（供前端轮询）
// - PUT /:id/read      标记通知对应告警已读（家庭级，复用 AnomalyAlert.isRead）

import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';

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

// GET / - 当前用户在该家庭的投递列表
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const statusQuery = req.query.status as string | undefined;
    const channelQuery = req.query.channel as string | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const where: {
      familyId: string;
      userId: string;
      status?: string;
      channel?: string;
    } = { familyId, userId: req.userId! };
    if (statusQuery) {
      where.status = statusQuery;
    }
    if (channelQuery) {
      where.channel = channelQuery;
    }

    // 未读数：站内已送达且对应告警未读（AnomalyAlert.isRead 为家庭级已读）
    const unreadWhere = {
      familyId,
      userId: req.userId!,
      channel: 'IN_APP',
      status: 'SENT',
      alert: { isRead: false },
    };

    const [notifications, unreadCount] = await Promise.all([
      prisma.notificationDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { alert: { select: { isRead: true } } },
      }),
      prisma.notificationDelivery.count({ where: unreadWhere }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('获取通知列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /unread-count - 未读数（供前端轮询，须在带 :id 参数的路由之前定义）
router.get('/unread-count', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const unreadCount = await prisma.notificationDelivery.count({
      where: {
        familyId,
        userId: req.userId!,
        channel: 'IN_APP',
        status: 'SENT',
        alert: { isRead: false },
      },
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error('获取通知未读数错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /:id/read - 标记单条通知对应告警已读（家庭级已读）
router.put('/:id/read', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const delivery = await prisma.notificationDelivery.findUnique({ where: { id } });
    if (!delivery || delivery.familyId !== familyId || delivery.userId !== req.userId!) {
      return res.status(404).json({ error: '通知不存在' });
    }

    await prisma.anomalyAlert.update({
      where: { id: delivery.alertId },
      data: { isRead: true },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('标记通知已读错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
