import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { FamilyAccessRequest, requireFamilyWriteAccess } from '../middleware/familyAccess';
import {
  confirmImportBatch,
  ImportBatchValidationError,
  parseCSV,
  persistImportPreview,
} from '../services/importService';
import {
  markIdempotencyReplay,
  readIdempotencyKey,
  sendLedgerMutationError,
} from './ledgerRouteSupport';
import {
  assertImportRowsWithinLimit,
  IMPORT_LIMITS,
  ImportLimitError,
} from '../services/importLimits';

const router = Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_LIMITS.maxBytes },
});

const uploadCsv = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'IMPORT_LIMIT_EXCEEDED', limit: 'bytes' });
    }
    return next(error);
  });
};

const VALID_FORMATS = ['alipay', 'wechat'];

const confirmBatchSchema = z.object({
  batchId: z.string().min(1),
  expectedPreviewHash: z.string().regex(/^[0-9a-f]{64}$/),
  categoryPatch: z.record(z.string(), z.string()).optional(),
}).strict();

// POST /csv — 上传 CSV 返回预览
router.post('/csv', authMiddleware, requireFamilyWriteAccess, uploadCsv, async (req: FamilyAccessRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const format = req.body.format as string;

    if (!format || !VALID_FORMATS.includes(format)) {
      return res.status(400).json({ error: 'format 必须为 alipay 或 wechat' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const items = await parseCSV(req.file.buffer, format);
    assertImportRowsWithinLimit(items);
    const preview = await persistImportPreview({
      familyId,
      actorUserId: req.familyMembership!.userId,
      format,
      buffer: req.file.buffer,
      items,
    });
    res.set({
      'X-Import-Batch-Id': preview.batchId,
      'X-Import-Preview-Hash': preview.previewHash,
    });
    res.json(items);
  } catch (error) {
    if (error instanceof ImportLimitError) {
      return res.status(413).json({ error: error.code, limit: error.limit });
    }
    console.error('解析 CSV 错误:', error);
    res.status(500).json({ error: 'CSV 解析失败' });
  }
});

// POST /confirm — 确认导入，批量创建 Income/Expense
router.post('/confirm', authMiddleware, requireFamilyWriteAccess, async (req: FamilyAccessRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const data = confirmBatchSchema.parse(req.body);
    const result = await confirmImportBatch({
      familyId,
      actorUserId: req.familyMembership!.userId,
      batchId: data.batchId,
      expectedPreviewHash: data.expectedPreviewHash,
      idempotencyKey: readIdempotencyKey(req),
      categoryPatch: data.categoryPatch,
    });
    markIdempotencyReplay(result, res);
    return res.json({
      ...(result.record ?? { id: result.resourceId }),
      operationId: result.operationId,
      deduplicated: result.deduplicated,
    });
  } catch (error) {
    if (error instanceof ImportBatchValidationError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        failedRows: error.failedRows,
      });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: error.errors[0].message,
        code: 'VALIDATION_FAILED',
        retryable: false,
      });
    }
    return sendLedgerMutationError(error, res, '确认导入');
  }
});

export default router;
