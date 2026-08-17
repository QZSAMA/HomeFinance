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
import { checkAIQuota, recordAIUsage, getAIQuotaStatus } from '../middleware/aiQuota';
import { logAICall } from '../services/aiCallLogService';

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

// 重复检测：检查 proposedActions 中每条是否与近 7 天已有记录重复（相同金额 + 类型 + 日期）
async function checkDuplicateActions(
  familyId: string,
  actions: AIAction[]
): Promise<boolean[]> {
  if (actions.length === 0) return [];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // 收集所有支出和收入的查询条件
  const expenseConditions: { amount: any; date?: any; category?: string }[] = [];
  const incomeConditions: { amount: any; date?: any; category?: string }[] = [];

  for (const action of actions) {
    const amount = action.data.amount ? toNumber(action.data.amount) : undefined;
    if (amount === undefined) continue;

    const condition: { amount: any; date?: any; category?: string } = { amount };
    if (action.data.date) {
      const dayStart = new Date(action.data.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      condition.date = { gte: dayStart, lt: dayEnd };
    }
    if (action.data.category) {
      condition.category = action.data.category;
    }

    if (action.type === 'create_expense') {
      expenseConditions.push(condition);
    } else if (action.type === 'create_income') {
      incomeConditions.push(condition);
    }
  }

  // 批量查询近 7 天的记录
  const [recentExpenses, recentIncomes] = await Promise.all([
    expenseConditions.length > 0
      ? prisma.expense.findMany({
          where: {
            familyId,
            createdAt: { gte: sevenDaysAgo },
            OR: expenseConditions as any,
          },
          select: { amount: true, date: true, category: true },
        })
      : [],
    incomeConditions.length > 0
      ? prisma.income.findMany({
          where: {
            familyId,
            createdAt: { gte: sevenDaysAgo },
            OR: incomeConditions as any,
          },
          select: { amount: true, date: true, category: true },
        })
      : [],
  ]);

  // 逐条比对
  return actions.map((action) => {
    const amount = action.data.amount ? toNumber(action.data.amount) : undefined;
    if (amount === undefined) return false;

    const records = action.type === 'create_expense' ? recentExpenses : recentIncomes;
    return records.some((r) => {
      const rAmount = toNumber(r.amount);
      if (rAmount !== amount) return false;
      // 如果 action 有日期，检查日期是否匹配
      if (action.data.date) {
        const rDate = new Date(r.date);
        const aDate = new Date(action.data.date);
        return rDate.toDateString() === aDate.toDateString();
      }
      // 没有日期则只按金额+类别匹配
      return true;
    });
  });
}

const chatSchema = z.object({
  content: z.string().optional(),
  images: z.array(z.string().min(1)).optional(),
}).refine(
  (data) => (data.content && data.content.trim().length > 0) || (data.images && data.images.length > 0),
  { message: '内容和图片至少需要一个非空' },
).refine(
  (data) => !data.images || data.images.length <= 10,
  { message: '图片数量不能超过 10 张' },
);

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
  const startTime = Date.now();
  const familyId = req.params.familyId as string;
  const userId = req.userId!;

  try {
    const membership = await checkFamilyAccess(familyId, userId);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    // V3.1.6: AI 配额检查
    const quotaCheck = await checkAIQuota(userId);
    if (!quotaCheck.allowed) {
      const quotaStatus = await getAIQuotaStatus(userId);
      return res.status(429).json({
        error: `今日 AI 调用次数已达上限（${quotaStatus.limit}次/天）`,
        quota: quotaStatus,
      });
    }

    const { content, images } = chatSchema.parse(req.body);
    const hasImages = !!(images && images.length > 0);
    const hasText = !!(content && content.trim().length > 0);

    // ===== 场景 A: 仅文本（原 chat 逻辑，保持完全向后兼容）=====
    if (hasText && !hasImages) {
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

      const historyMessages = recentChats
        .reverse()
        .flatMap(h => [
          { role: 'user' as const, content: h.content },
          { role: 'assistant' as const, content: h.response },
        ]);

      const parsed = await chatWithActions(content!, {
        recentIncomes: recentIncomes.map(i => ({ category: i.category, amount: toNumber(i.amount), date: i.date })),
        recentExpenses: recentExpenses.map(e => ({ category: e.category, amount: toNumber(e.amount), date: e.date })),
        assets: assets.map(a => ({ name: a.name, type: a.type, value: toNumber(a.value) })),
        liabilities: liabilities.map(l => ({ name: l.name, type: l.type, amount: toNumber(l.amount) })),
      }, historyMessages);

      let actionResults: any[] = [];
      if (parsed.actions.length > 0) {
        actionResults = await executeActions(familyId, userId, parsed.actions);
      }

      await prisma.aiConversation.create({
        data: {
          familyId,
          userId,
          content,
          response: parsed.reply,
          type: 'chat',
        }
      });

      // V3.1.6: 记录 AI 调用配额和日志
      await recordAIUsage(userId);
      await logAICall({
        userId,
        familyId,
        type: 'chat',
        latency: Date.now() - startTime,
        success: true,
      });
      const quota = await getAIQuotaStatus(userId);

      return res.json({
        response: parsed.reply,
        actions: actionResults,
        aiConfigured: isAIConfigured(),
        quota,
      });
    }

    // ===== 场景 B/C: 含图片（OCR 流程，统一端点模式）=====
    // 并行：每张图 OCR + 持久化（单图失败不阻塞其他）
    const fileIds: string[] = [];
    const allProposedActions: AIAction[] = [];
    const ocrSummaries: string[] = [];

    const ocrResults = await Promise.allSettled(
      (images || []).map(async (imgBase64, idx) => {
        // 1. 持久化原图（失败不阻塞）
        const stored = await storeOcrImage(userId, familyId, imgBase64).catch(() => null);
        if (stored?.fileId) fileIds.push(stored.fileId);

        // 2. OCR + 多模态识别
        const data = await parseReceiptOCR(imgBase64);
        const actions = ocrToActions(data);

        // 多图时加标签（Anthropic 建议 "Image 1:", "Image 2:"）
        const label = `[图片 ${idx + 1}]`;
        const summary = `${label} 金额=${data.amount ?? '-'}, 类别=${data.category ?? '-'}, 描述=${data.description ?? '-'}`;
        ocrSummaries.push(summary);

        return { actions, data };
      })
    );

    // 收集成功的 actions
    let successCount = 0;
    let failedCount = 0;
    ocrResults.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        allProposedActions.push(...r.value.actions);
        successCount++;
      } else {
        failedCount++;
        console.warn(`图片 ${idx + 1} OCR 失败:`, r.reason);
      }
    });

    // 所有图都失败 → 报错
    if (successCount === 0 && failedCount > 0) {
      throw new AIError('所有图片识别失败，请稍后重试或换张图片', 500);
    }

    // 场景 B: 仅图片（无文本）→ 直接走 OCR 提议流程
    if (!hasText) {
      const duplicateFlags = await checkDuplicateActions(familyId, allProposedActions);

      await prisma.aiConversation.create({
        data: {
          familyId,
          userId,
          content: `[上传图片 ${images!.length} 张]`,
          response: JSON.stringify({ proposedActions: allProposedActions, duplicateFlags }),
          type: 'ocr',
        }
      });

      // V3.1.6: 记录 AI 调用配额和日志
      await recordAIUsage(userId);
      await logAICall({
        userId,
        familyId,
        type: 'chat',
        latency: Date.now() - startTime,
        success: true,
      });
      const quota = await getAIQuotaStatus(userId);

      return res.json({
        response: `识别到 ${allProposedActions.length} 笔交易（成功 ${successCount} 张，失败 ${failedCount} 张）`,
        actions: [],
        proposedActions: allProposedActions,
        duplicateFlags,
        fileIds,
        aiConfigured: isAIConfigured(),
        quota,
      });
    }

    // 场景 C: 图片 + 文本 → OCR 后用文本作为上下文调整 proposedActions
    const ocrContext = ocrSummaries.join('\n');
    const augmentedContent = `${content}\n\n[OCR 识别结果参考，可据此调整或过滤]\n${ocrContext}`;

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

    const historyMessages = recentChats
      .reverse()
      .flatMap(h => [
        { role: 'user' as const, content: h.content },
        { role: 'assistant' as const, content: h.response },
      ]);

    const parsed = await chatWithActions(augmentedContent, {
      recentIncomes: recentIncomes.map(i => ({ category: i.category, amount: toNumber(i.amount), date: i.date })),
      recentExpenses: recentExpenses.map(e => ({ category: e.category, amount: toNumber(e.amount), date: e.date })),
      assets: assets.map(a => ({ name: a.name, type: a.type, value: toNumber(a.value) })),
      liabilities: liabilities.map(l => ({ name: l.name, type: l.type, amount: toNumber(l.amount) })),
    }, historyMessages);

    // 若 AI 调整后未返回 actions，回退用 OCR 原始 proposedActions
    const finalActions = parsed.actions.length > 0 ? parsed.actions : allProposedActions;
    const duplicateFlags = await checkDuplicateActions(familyId, finalActions);

    let actionResults: any[] = [];
    // 图片场景默认不自动执行（proposedActions 需用户确认），除非 AI 明确返回且用户文本含"记账/确认"等指令
    // 这里保持提议模式：返回 proposedActions 让前端确认

    await prisma.aiConversation.create({
      data: {
        familyId,
        userId,
        content: `${content} [附图 ${images!.length} 张]`,
        response: JSON.stringify({ reply: parsed.reply, proposedActions: finalActions, duplicateFlags }),
        type: 'ocr',
      }
    });

    // V3.1.6: 记录 AI 调用配额和日志
    await recordAIUsage(userId);
    await logAICall({
      userId,
      familyId,
      type: 'chat',
      latency: Date.now() - startTime,
      success: true,
    });
    const quota = await getAIQuotaStatus(userId);

    return res.json({
      response: parsed.reply,
      actions: actionResults,
      proposedActions: finalActions,
      duplicateFlags,
      fileIds,
      aiConfigured: isAIConfigured(),
      quota,
    });
  } catch (error) {
    // V3.1.6: 记录失败的 AI 调用日志（不记录 usage）
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logAICall({
      userId,
      familyId,
      type: 'chat',
      latency: Date.now() - startTime,
      success: false,
      error: errorMessage,
    });

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
  const startTime = Date.now();
  const familyId = req.params.familyId as string;
  const userId = req.userId!;

  try {
    const membership = await checkFamilyAccess(familyId, userId);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    // V3.1.6: AI 配额检查
    const quotaCheck = await checkAIQuota(userId);
    if (!quotaCheck.allowed) {
      const quotaStatus = await getAIQuotaStatus(userId);
      return res.status(429).json({
        error: `今日 AI 调用次数已达上限（${quotaStatus.limit}次/天）`,
        quota: quotaStatus,
      });
    }

    const { image } = ocrSchema.parse(req.body);

    // 1. 持久化原图到 MinIO（失败不阻塞 OCR）
    const stored = await storeOcrImage(userId, familyId, image);

    // 2. 并行 OCR + 合并（Tesseract 本地 + 视觉多模态 LLM）
    const data = await parseReceiptOCR(image);

    // 3. 转换为提议动作（不执行，由前端用户确认后调用 /execute-actions）
    const proposedActions = ocrToActions(data);

    // 3.5 重复检测：检查每条 action 是否与近 7 天已有记录重复（相同金额 + 类型 + 日期）
    const duplicateFlags = await checkDuplicateActions(familyId, proposedActions);

    // 4. 落库对话记录（关联 fileId）
    await prisma.aiConversation.create({
      data: {
        familyId,
        userId,
        content: 'OCR 识别',
        response: JSON.stringify({ data, proposedActions, duplicateFlags }),
        type: 'ocr',
        fileId: stored?.fileId ?? null,
      }
    });

    // V3.1.6: 记录 AI 调用配额和日志
    await recordAIUsage(userId);
    await logAICall({
      userId,
      familyId,
      type: 'ocr',
      latency: Date.now() - startTime,
      success: true,
    });
    const quota = await getAIQuotaStatus(userId);

    res.json({
      data,
      aiConfigured: isAIConfigured(),
      visionConfigured: isVisionConfigured(),
      fileId: stored?.fileId ?? null,
      proposedActions,
      duplicateFlags,
      quota,
    });
  } catch (error) {
    // V3.1.6: 记录失败的 AI 调用日志（不记录 usage）
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logAICall({
      userId,
      familyId,
      type: 'ocr',
      latency: Date.now() - startTime,
      success: false,
      error: errorMessage,
    });

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
