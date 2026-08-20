import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  ALERT_TYPES,
  SEVERITIES,
  getOrCreatePreferences,
  updatePreferences,
} from '../services/notificationPreferenceService';

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

// GET / - 获取当前用户在该家庭的全部通知偏好（惰性创建默认记录）
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const preferences = await getOrCreatePreferences(req.userId!, familyId);
    res.json({ preferences });
  } catch (error) {
    console.error('获取通知偏好错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT / - 批量更新通知偏好
router.put('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const { preferences } = req.body || {};
    if (!Array.isArray(preferences)) {
      return res.status(400).json({ error: '请求体必须包含 preferences 数组' });
    }

    // 校验每项的 alertType / minSeverity 合法性
    for (const item of preferences) {
      const alertType = item?.alertType;
      if (
        typeof alertType !== 'string' ||
        !(ALERT_TYPES as readonly string[]).includes(alertType)
      ) {
        return res.status(400).json({ error: `非法的告警类型: ${alertType}` });
      }
      const minSeverity = item?.minSeverity;
      if (
        typeof minSeverity !== 'string' ||
        !(SEVERITIES as readonly string[]).includes(minSeverity)
      ) {
        return res.status(400).json({ error: `非法的严重度: ${minSeverity}` });
      }
    }

    const updated = await updatePreferences(req.userId!, familyId, preferences);
    res.json({ preferences: updated });
  } catch (error) {
    console.error('更新通知偏好错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
