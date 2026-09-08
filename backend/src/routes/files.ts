import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  createFamilyWriteAccess,
  requireFamilyAccess,
  requireFamilyWriteAccess,
} from '../middleware/familyAccess';
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

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];

const sendStorageUnavailable = (res: any) => res.status(503).json({
  error: '对象存储暂时不可用，请稍后重试',
  code: 'STORAGE_UNAVAILABLE',
});
const requireFileWriteAccess = createFamilyWriteAccess('无权删除文件');

router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;

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

router.post('/upload', authMiddleware, requireFamilyWriteAccess, upload.array('files', 10), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;

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
        return sendStorageUnavailable(res);
      }

      let dbFile;
      try {
        dbFile = await prisma.file.create({
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
      } catch (error) {
        try {
          await deleteFile(filename);
        } catch (compensationError) {
          console.error('Error compensating uploaded MinIO object:', compensationError);
        }
        throw error;
      }

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

router.delete('/:id', authMiddleware, requireFileWriteAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const id = req.params.id as string;

    const file = await prisma.file.findFirst({ where: { id, familyId } });
    if (!file) {
      return res.status(404).json({ error: '文件不存在' });
    }

    try {
      await deleteFile(file.path);
    } catch (e) {
      console.error('Error deleting file from MinIO:', e);
      return sendStorageUnavailable(res);
    }

    await prisma.file.delete({ where: { id } });

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除文件错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/check-duplicates', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;

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
