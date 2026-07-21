import { Router } from 'express';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { suggestCategory } from '../services/categoryService';

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

// GET /suggest?type=EXPENSE&description=xxx
router.get('/suggest', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const type = req.query.type as string;
    const description = req.query.description as string;

    if (!description || !description.trim()) {
      return res.status(400).json({ error: '描述不能为空' });
    }
    if (type !== 'INCOME' && type !== 'EXPENSE') {
      return res.status(400).json({ error: 'type 必须为 INCOME 或 EXPENSE' });
    }

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const category = await suggestCategory(description, familyId, type);
    res.json({ category });
  } catch (error) {
    console.error('推荐类别错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
