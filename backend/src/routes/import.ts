import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { parseCSV } from '../services/importService';

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage() });

const VALID_FORMATS = ['alipay', 'wechat'];

const checkFamilyAccess = async (familyId: string, userId: string) => {
  const membership = await prisma.familyMember.findUnique({
    where: { familyId_userId: { familyId, userId } },
  });
  return membership;
};

const itemSchema = z.object({
  date: z.string().min(1),
  description: z.string(),
  amount: z.number().positive(),
  type: z.enum(['INCOME', 'EXPENSE']),
  category: z.string().optional(),
});

// POST /csv — 上传 CSV 返回预览
router.post('/csv', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const format = req.body.format as string;

    if (!format || !VALID_FORMATS.includes(format)) {
      return res.status(400).json({ error: 'format 必须为 alipay 或 wechat' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const items = await parseCSV(req.file.buffer, format);
    res.json(items);
  } catch (error) {
    console.error('解析 CSV 错误:', error);
    res.status(500).json({ error: 'CSV 解析失败' });
  }
});

// POST /confirm — 确认导入，批量创建 Income/Expense
router.post('/confirm', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;

    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const { items } = req.body as { items: unknown[] };
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items 不能为空' });
    }

    let successCount = 0;
    const failedRows: Array<{ row: number; errors: string[] }> = [];
    for (let i = 0; i < items.length; i++) {
      const parsed = itemSchema.safeParse(items[i]);
      if (!parsed.success) {
        failedRows.push({
          row: i + 1,
          errors: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
        continue;
      }
      const item = parsed.data;
      if (item.type === 'INCOME') {
        await prisma.income.create({
          data: {
            familyId,
            createdBy: req.userId!,
            category: item.category || '其他收入',
            amount: item.amount,
            description: item.description || undefined,
            date: new Date(item.date),
          },
        });
      } else {
        await prisma.expense.create({
          data: {
            familyId,
            createdBy: req.userId!,
            category: item.category || '其他支出',
            amount: item.amount,
            description: item.description || undefined,
            date: new Date(item.date),
          },
        });
      }
      successCount++;
    }

    res.json({ successCount, failedRows });
  } catch (error) {
    console.error('确认导入错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
