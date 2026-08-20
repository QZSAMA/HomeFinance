import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// POST / - 保存 Web Push 订阅（用户级，endpoint 已存在则更新，幂等）
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { endpoint, p256dh, auth: subscriptionAuth, userAgent, familyId } =
      req.body || {};

    if (!endpoint || !p256dh || !subscriptionAuth) {
      return res.status(400).json({ error: 'endpoint、p256dh、auth 为必填项' });
    }

    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: req.userId!,
        endpoint,
        p256dh,
        auth: subscriptionAuth,
        userAgent: userAgent ?? null,
        familyId: familyId ?? null,
      },
      update: {
        userId: req.userId!,
        p256dh,
        auth: subscriptionAuth,
        userAgent: userAgent ?? null,
        familyId: familyId ?? null,
      },
    });

    res.status(201).json({ subscription });
  } catch (error) {
    console.error('保存推送订阅错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// DELETE / - 取消订阅（按 endpoint 删除，不存在也返回成功，幂等）
router.delete('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { endpoint } = req.body || {};

    if (!endpoint) {
      return res.status(400).json({ error: 'endpoint 为必填项' });
    }

    const result = await prisma.pushSubscription.deleteMany({
      where: { endpoint },
    });

    res.json({ deleted: result.count > 0 });
  } catch (error) {
    console.error('删除推送订阅错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
