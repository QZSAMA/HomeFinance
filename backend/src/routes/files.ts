import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { uploadFileBuffer, getFileUrl, deleteFile } from '../config/minio';
import { computePHash, isSimilarImage } from '../utils/phash';
import { toNumber } from '../utils/decimal';
import { parsePagination, paginateResponse } from '../utils/pagination';

const router = Router({ mergeParams: true });

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
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

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const pagination = parsePagination(req);

    const attachUrls = async (files: any[]) => Promise.all(
      files.map(async (file) => {
        let url = '';
        try {
          url = await getFileUrl(file.path);
        } catch (e) {
          console.error('Error getting file URL:', e);
        }
        return { ...file, url };
      })
    );

    if (pagination) {
      const [files, total] = await Promise.all([
        prisma.file.findMany({
          where: { familyId },
          orderBy: { uploadedAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.file.count({ where: { familyId } }),
      ]);
      const filesWithUrls = await attachUrls(files);
      return res.json(paginateResponse(filesWithUrls, total, pagination));
    }

    const files = await prisma.file.findMany({
      where: { familyId },
      orderBy: { uploadedAt: 'desc' }
    });

    const filesWithUrls = await attachUrls(files);

    res.json(filesWithUrls);
  } catch (error) {
    console.error('获取文件列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/upload', authMiddleware, upload.array('files', 10), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    const files = req.files as Express.Multer.File[];
    const uploadedFiles = [];
    const duplicates: Array<{ filename: string; duplicateOf: string }> = [];

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const filename = `${familyId}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;

      let phash: string | null = null;
      if (IMAGE_MIME_TYPES.includes(file.mimetype)) {
        try {
          phash = await computePHash(file.buffer);

          const existingFiles = await prisma.file.findMany({
            where: {
              familyId,
              phash: { not: null }
            },
            select: { id: true, name: true, phash: true }
          });

          for (const existing of existingFiles) {
            if (existing.phash && phash && isSimilarImage(phash, existing.phash)) {
              duplicates.push({
                filename: file.originalname,
                duplicateOf: existing.name
              });
              break;
            }
          }
        } catch (e) {
          console.error('Error computing pHash:', e);
        }
      }

      try {
        await uploadFileBuffer(filename, file.buffer, file.size, {
          'Content-Type': file.mimetype,
        });
      } catch (e) {
        console.error('Error uploading file to MinIO:', e);
        continue;
      }

      const dbFile = await prisma.file.create({
        data: {
          name: file.originalname,
          path: filename,
          type: file.mimetype,
          size: file.size,
          mimeType: file.mimetype,
          phash,
          familyId,
          userId: req.userId!
        }
      });

      uploadedFiles.push(dbFile);
    }

    res.status(201).json({
      files: uploadedFiles,
      duplicates,
      message: `成功上传 ${uploadedFiles.length} 个文件` +
        (duplicates.length > 0 ? `，其中 ${duplicates.length} 个可能是重复图片` : '')
    });
  } catch (error) {
    console.error('上传文件错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership || membership.role === 'viewer') {
      return res.status(403).json({ error: '无权删除文件' });
    }

    const file = await prisma.file.findUnique({ where: { id } });
    if (!file || file.familyId !== familyId) {
      return res.status(404).json({ error: '文件不存在' });
    }

    try {
      await deleteFile(file.path);
    } catch (e) {
      console.error('Error deleting file from MinIO:', e);
    }

    await prisma.file.delete({ where: { id } });

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除文件错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/check-duplicates', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const files = await prisma.file.findMany({
      where: {
        familyId,
        phash: { not: null }
      },
      select: { id: true, name: true, phash: true }
    });

    const duplicates: Array<{ file1: string; file2: string; similarity: number }> = [];
    const checked = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const f1 = files[i];
        const f2 = files[j];
        const key = `${f1.id}-${f2.id}`;

        if (checked.has(key) || !f1.phash || !f2.phash) continue;
        checked.add(key);

        if (isSimilarImage(f1.phash, f2.phash)) {
          duplicates.push({
            file1: f1.name,
            file2: f2.name,
            similarity: Math.round((1 - 5 / 64) * 100)
          });
        }
      }
    }

    res.json({ duplicates });
  } catch (error) {
    console.error('检测重复文件错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
