import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { syncImportSource } from '../services/syncService';

const router = Router({ mergeParams: true });

const createSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  type: z.enum(['alipay', 'wechat', 'cmb', 'icbc', 'boc'], {
    errorMap: () => ({ message: '不支持的 type' }),
  }),
  config: z.record(z.any()).default({}),
  isActive: z.boolean().default(true),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['alipay', 'wechat', 'cmb', 'icbc', 'boc']).optional(),
  config: z.record(z.any()).optional(),
  isActive: z.boolean().optional(),
});

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

// GET / — 列出家庭的所有 ImportSource
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const sources = await prisma.importSource.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(sources);
  } catch (error) {
    console.error('获取 ImportSource 列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST / — 创建 ImportSource
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = createSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const created = await prisma.importSource.create({
      data: {
        familyId,
        name: data.name,
        type: data.type,
        config: data.config,
        isActive: data.isActive,
        createdBy: req.userId!,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('创建 ImportSource 错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// PUT /:id — 更新 ImportSource
router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;
    const data = updateSchema.parse(req.body);

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const existing = await prisma.importSource.findUnique({ where: { id } });
    if (!existing || existing.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.config !== undefined) updateData.config = data.config;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const updated = await prisma.importSource.update({
      where: { id },
      data: updateData,
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('更新 ImportSource 错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// DELETE /:id — 删除 ImportSource
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const existing = await prisma.importSource.findUnique({ where: { id } });
    if (!existing || existing.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    await prisma.importSource.delete({ where: { id } });
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除 ImportSource 错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /:id/sync — 手动触发同步
router.post('/:id/sync', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const existing = await prisma.importSource.findUnique({ where: { id } });
    if (!existing || existing.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    const result = await syncImportSource(id);
    res.json(result);
  } catch (error) {
    console.error('同步 ImportSource 错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /:id/status — 获取同步状态
router.get('/:id/status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const existing = await prisma.importSource.findUnique({
      where: { id },
      select: {
        id: true,
        familyId: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncError: true,
        isActive: true,
      },
    });
    if (!existing || existing.familyId !== familyId) {
      return res.status(404).json({ error: '记录不存在' });
    }

    res.json(existing);
  } catch (error) {
    console.error('获取 ImportSource 状态错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
