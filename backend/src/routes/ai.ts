import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimit';
import { chatWithActions, analyzeFinance, parseReceiptOCR, ocrToActions, AIError } from '../services/aiService';
import { executeActions, type AIAction } from '../services/aiActions';
import { toNumber } from '../utils/decimal';
import { isAIConfigured, isVisionConfigured } from '../config/ai';
import { storeOcrImage } from '../services/fileStorageService';

const router = Router({ mergeParams: true });

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

const chatSchema = z.object({
  content: z.string().min(1, '内容不能为空'),
});

const ocrSchema = z.object({
  image: z.string().min(1, '图片数据不能为空'),
});

router.get('/status', authMiddleware, (_req, res) => {
  res.json({
    configured: isAIConfigured(),
    message: isAIConfigured()
      ? 'AI 服务已配置'
      : 'AI 服务未配置，将使用本地规则提供基础回复',
  });
});

router.post('/chat', authMiddleware, rateLimitMiddleware(20, 60), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const { content } = chatSchema.parse(req.body);

    // 获取家庭财务上下文，帮助 AI 理解用户指令
    const [recentIncomes, recentExpenses, assets, liabilities, recentChats] = await Promise.all([
      prisma.income.findMany({ where: { familyId }, orderBy: { date: 'desc' }, take: 5 }),
      prisma.expense.findMany({ where: { familyId }, orderBy: { date: 'desc' }, take: 5 }),
      prisma.asset.findMany({ where: { familyId }, orderBy: { value: 'desc' }, take: 10 }),
      prisma.liability.findMany({ where: { familyId }, orderBy: { amount: 'desc' }, take: 10 }),
      prisma.aiConversation.findMany({
        where: { familyId, type: 'chat' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    // 历史对话按时间升序（旧→新），映射为 {role, content} 数组
    const historyMessages = recentChats
      .reverse()
      .flatMap(h => [
        { role: 'user' as const, content: h.content },
        { role: 'assistant' as const, content: h.response },
      ]);

    // 调用 AI 解析意图
    const parsed = await chatWithActions(content, {
      recentIncomes: recentIncomes.map(i => ({ category: i.category, amount: toNumber(i.amount), date: i.date })),
      recentExpenses: recentExpenses.map(e => ({ category: e.category, amount: toNumber(e.amount), date: e.date })),
      assets: assets.map(a => ({ name: a.name, type: a.type, value: toNumber(a.value) })),
      liabilities: liabilities.map(l => ({ name: l.name, type: l.type, amount: toNumber(l.amount) })),
    }, historyMessages);

    // 执行 AI 返回的动作
    let actionResults: any[] = [];
    if (parsed.actions.length > 0) {
      actionResults = await executeActions(familyId, req.userId!, parsed.actions);
    }

    // 落库对话记录
    await prisma.aiConversation.create({
      data: {
        familyId,
        userId: req.userId!,
        content,
        response: parsed.reply,
        type: 'chat',
      }
    });

    res.json({
      response: parsed.reply,
      actions: actionResults,
      aiConfigured: isAIConfigured(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error instanceof AIError) {
      console.error('AI 对话错误:', error.message);
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('AI 对话未知错误:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

router.post('/analyze', authMiddleware, rateLimitMiddleware(10, 60), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const [assets, liabilities, incomes, expenses] = await Promise.all([
      prisma.asset.findMany({ where: { familyId } }),
      prisma.liability.findMany({ where: { familyId } }),
      prisma.income.findMany({
        where: { familyId, date: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }
      }),
      prisma.expense.findMany({
        where: { familyId, date: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }
      }),
    ]);

    const totalAssets = assets.reduce((s, a) => s + toNumber(a.value), 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + toNumber(l.amount), 0);
    const monthlyIncome = incomes.reduce((s, i) => s + toNumber(i.amount), 0);
    const monthlyExpense = expenses.reduce((s, e) => s + toNumber(e.amount), 0);

    const allocationMap: Record<string, number> = {};
    assets.forEach((asset) => {
      allocationMap[asset.type] = (allocationMap[asset.type] || 0) + toNumber(asset.value);
    });
    const totalAssetValue = Object.values(allocationMap).reduce((a, b) => a + b, 0);
    const investmentAllocation = Object.entries(allocationMap).map(([category, value]) => ({
      category,
      value,
      percentage: totalAssetValue > 0 ? Number(((value / totalAssetValue) * 100).toFixed(2)) : 0,
    }));

    const report = await analyzeFinance({
      totalAssets,
      totalLiabilities,
      monthlyIncome,
      monthlyExpense,
      investmentAllocation,
    });

    await prisma.aiConversation.create({
      data: {
        familyId,
        userId: req.userId!,
        content: '生成财务分析报告',
        response: report,
        type: 'analysis',
      }
    });

    res.json({ report, aiConfigured: isAIConfigured() });
  } catch (error) {
    if (error instanceof AIError) {
      console.error('AI 分析错误:', error.message);
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('AI 分析未知错误:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

router.post('/ocr', authMiddleware, rateLimitMiddleware(20, 60), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const userId = req.userId!;
    const membership = await checkFamilyAccess(familyId, userId);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const { image } = ocrSchema.parse(req.body);

    // 1. 持久化原图到 MinIO（失败不阻塞 OCR）
    const stored = await storeOcrImage(userId, familyId, image);

    // 2. 并行 OCR + 合并（Tesseract 本地 + 视觉多模态 LLM）
    const data = await parseReceiptOCR(image);

    // 3. 转换为提议动作（不执行，由前端用户确认后调用 /execute-actions）
    const proposedActions = ocrToActions(data);

    // 4. 落库对话记录（关联 fileId）
    await prisma.aiConversation.create({
      data: {
        familyId,
        userId,
        content: 'OCR 识别',
        response: JSON.stringify({ data, proposedActions }),
        type: 'ocr',
        fileId: stored?.fileId ?? null,
      }
    });

    res.json({
      data,
      aiConfigured: isAIConfigured(),
      visionConfigured: isVisionConfigured(),
      fileId: stored?.fileId ?? null,
      proposedActions,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error instanceof AIError) {
      console.error('OCR 识别错误:', error.message);
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('OCR 识别未知错误:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

const executeActionsSchema = z.object({
  actions: z.array(z.object({
    type: z.string(),
    data: z.record(z.any()),
  })).min(1, '动作不能为空'),
});

router.post('/execute-actions', authMiddleware, rateLimitMiddleware(20, 60), async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const userId = req.userId!;
    const membership = await checkFamilyAccess(familyId, userId);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const { actions } = executeActionsSchema.parse(req.body);

    const actionResults = await executeActions(familyId, userId, actions as AIAction[]);

    // 落库对话记录（便于历史追溯）
    const summary = actionResults.map(r => r.message).join('; ');
    await prisma.aiConversation.create({
      data: {
        familyId,
        userId,
        content: `[确认记账] ${actions.map(a => a.type).join(', ')}`,
        response: summary,
        type: 'chat',
      }
    });

    res.json({
      actions: actionResults,
      aiConfigured: isAIConfigured(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    if (error instanceof AIError) {
      console.error('执行动作错误:', error.message);
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('执行动作未知错误:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

router.get('/history', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const history = await prisma.aiConversation.findMany({
      where: { familyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json(history);
  } catch (error) {
    console.error('获取对话历史错误:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

export default router;
