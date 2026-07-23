import { chatCompletion, analyzeFinance, parseReceiptOCR, ocrToActions } from './aiService';

jest.mock('../config/ai', () => ({
  AI_CONFIG: {
    baseURL: 'https://test.api.com',
    apiKey: 'test-key',
    model: 'test-model',
    maxTokens: 100,
    temperature: 0.5,
  },
  isAIConfigured: jest.fn().mockReturnValue(true),
  AI_VISION_CONFIG: {
    baseURL: 'https://vision.api.com',
    apiKey: 'vision-key',
    model: 'vision-model',
    maxTokens: 4096,
    temperature: 0.3,
  },
  isVisionConfigured: jest.fn().mockReturnValue(false),
}));

jest.mock('./aiActions', () => ({
  parseLocalActions: jest.fn().mockReturnValue({ reply: '', actions: [] }),
}));

// Mock OCR 服务：extractTextFromImage（Tesseract）+ extractViaVision（视觉 LLM）+ mergeOcrResults（合并）
// mergeOcrResults 也 mock，parseReceiptOCR 测试只验证编排逻辑，合并逻辑在 ocrService.test.ts 独立测试
// cleanOcrText 提供简单透传实现，避免 runTesseractPath 调用时 TypeError
jest.mock('./ocrService', () => ({
  extractTextFromImage: jest.fn(),
  extractViaVision: jest.fn(),
  mergeOcrResults: jest.fn(),
  cleanOcrText: jest.fn((text: string) => text),
}));

jest.mock('../app', () => ({
  prisma: {},
}));

import { isVisionConfigured } from '../config/ai';
import { extractTextFromImage, extractViaVision, mergeOcrResults } from './ocrService';

const mockedIsVisionConfigured = isVisionConfigured as jest.MockedFunction<typeof isVisionConfigured>;
const mockedExtractTextFromImage = extractTextFromImage as jest.MockedFunction<typeof extractTextFromImage>;
const mockedExtractViaVision = extractViaVision as jest.MockedFunction<typeof extractViaVision>;
const mockedMergeOcrResults = mergeOcrResults as jest.MockedFunction<typeof mergeOcrResults>;

describe('aiService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation();
    // 每个测试前重置 vision 配置为 false（Tesseract-only）
    mockedIsVisionConfigured.mockReturnValue(false);
    // mergeOcrResults 默认返回一个合理的 MergedOCR，单个测试可覆盖
    mockedMergeOcrResults.mockImplementation(((t: any, v: any) => ({
      amount: v?.amount ?? t?.amount,
      date: v?.date ?? t?.date,
      category: v?.category ?? t?.category,
      description: v?.description ?? t?.description,
      raw: v?.raw || t?.raw,
      rawText: t?.rawText,
      source: v && t ? 'merged' : v ? 'vision' : 'tesseract',
    })) as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('chatCompletion', () => {
    test('returns assistant message content on success', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Hello, I am your AI assistant.',
              },
            },
          ],
        }),
      } as any);

      const result = await chatCompletion([
        { role: 'user', content: 'Hi' },
      ]);

      expect(result).toBe('Hello, I am your AI assistant.');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain('/chat/completions');
      expect(init.method).toBe('POST');
    });

    test('throws AIError when API returns non-ok status', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      } as any);

      await expect(
        chatCompletion([{ role: 'user', content: 'Hi' }])
      ).rejects.toThrow('AI 服务调用失败');
    });

    test('throws AIError when fetch fails with network error', async () => {
      fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        chatCompletion([{ role: 'user', content: 'Hi' }])
      ).rejects.toThrow('AI 服务连接失败');
    });
  });

  describe('analyzeFinance', () => {
    test('returns analysis string with family data in prompt', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '您的财务状况良好，建议增加储蓄。',
              },
            },
          ],
        }),
      } as any);

      const familyData = {
        totalAssets: 100000,
        totalLiabilities: 20000,
        monthlyIncome: 15000,
        monthlyExpense: 8000,
      };

      const result = await analyzeFinance(familyData);

      expect(result).toContain('财务状况良好');
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].content).toContain('100000');
    });
  });

  describe('parseReceiptOCR', () => {
    beforeEach(() => {
      mockedExtractTextFromImage.mockReset();
      mockedExtractViaVision.mockReset();
      mockedMergeOcrResults.mockClear();
    });

    test('Tesseract 成功 + 视觉未配置 → 只走 Tesseract 路径，mergeOcrResults 收到 (tesseractResult, null)', async () => {
      mockedExtractTextFromImage.mockResolvedValue('小炒肉饭 35.00\n日期 2026-07-10');
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  amount: 35,
                  date: '2026-07-10',
                  category: '餐饮',
                  description: '小炒肉饭',
                }),
              },
            },
          ],
        }),
      } as any);

      await parseReceiptOCR('base64imagestring');

      // 视觉未配置 → extractViaVision 不应被调用
      expect(mockedExtractViaVision).not.toHaveBeenCalled();
      // mergeOcrResults 第一个参数是 Tesseract 结果（含 amount），第二个是 null
      expect(mockedMergeOcrResults).toHaveBeenCalledTimes(1);
      const [tesseractArg, visionArg] = mockedMergeOcrResults.mock.calls[0];
      expect(tesseractArg!.amount).toBe(35);
      expect(tesseractArg!.category).toBe('餐饮');
      expect(tesseractArg!.description).toBe('小炒肉饭');
      expect(visionArg).toBeNull();
      // 验证 AI 收到的是 OCR 文字（文本，不是 image_url 数组）
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(typeof body.messages[1].content).toBe('string');
      expect(body.messages[1].content).toContain('小炒肉饭');
      expect(body.messages[1].content).toContain('35.00');
    });

    test('Tesseract 成功 + 视觉成功 → 两路径并行，mergeOcrResults 收到 (tesseract, vision)', async () => {
      mockedIsVisionConfigured.mockReturnValue(true);
      mockedExtractTextFromImage.mockResolvedValue('小炒肉饭 35.00');
      mockedExtractViaVision.mockResolvedValue({
        amount: 35.5,
        date: '2026-07-10',
        category: '餐饮',
        description: '小炒肉饭（视觉识别）',
      });
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ amount: 35, date: '2026-07-10', category: '餐饮', description: '小炒肉饭' }),
              },
            },
          ],
        }),
      } as any);

      await parseReceiptOCR('base64image');

      expect(mockedExtractTextFromImage).toHaveBeenCalledWith('base64image');
      expect(mockedExtractViaVision).toHaveBeenCalledWith('base64image');
      expect(mockedMergeOcrResults).toHaveBeenCalledTimes(1);
      const [tesseractArg, visionArg] = mockedMergeOcrResults.mock.calls[0];
      expect(tesseractArg!.amount).toBe(35);
      expect(visionArg!.amount).toBe(35.5);
      expect(visionArg!.description).toBe('小炒肉饭（视觉识别）');
    });

    test('Tesseract 失败 + 视觉未配置 → mergeOcrResults 收到 (null, null)', async () => {
      mockedExtractTextFromImage.mockRejectedValue(new Error('tesseract worker crash'));

      await parseReceiptOCR('badimage');

      // Tesseract 抛错被 Promise.allSettled 吞掉 → tesseract=null
      // 视觉未配置 → vision=null
      expect(mockedMergeOcrResults).toHaveBeenCalledWith(null, null);
      // 不应抛出（旧架构会抛 AIError，新架构不会）
      expect(mockedMergeOcrResults).toHaveBeenCalledTimes(1);
    });

    test('Tesseract 返回空文字 → runTesseractPath 返回 raw 提示，不调用 AI', async () => {
      mockedExtractTextFromImage.mockResolvedValue('');

      await parseReceiptOCR('blankimage');

      // OCR 返回空 → runTesseractPath 直接返回 raw 提示，不调 AI
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockedMergeOcrResults).toHaveBeenCalledTimes(1);
      const [tesseractArg, visionArg] = mockedMergeOcrResults.mock.calls[0];
      expect(tesseractArg!.amount).toBeUndefined();
      expect(tesseractArg!.raw).toContain('未识别到文字内容');
      expect(visionArg).toBeNull();
    });

    test('AI 返回非 JSON → runTesseractPath 降级返回 raw（含 AI 回复 + OCR 原文）', async () => {
      mockedExtractTextFromImage.mockResolvedValue('支付宝 50元 超市');
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '这是一笔超市购物，金额50元。',
              },
            },
          ],
        }),
      } as any);

      await parseReceiptOCR('someimage');

      expect(mockedMergeOcrResults).toHaveBeenCalledTimes(1);
      const [tesseractArg] = mockedMergeOcrResults.mock.calls[0];
      expect(tesseractArg!.raw).toContain('这是一笔超市购物');
      expect(tesseractArg!.raw).toContain('支付宝 50元 超市');
    });

    test('AI 返回 {error:"无法识别"} → runTesseractPath 应返回 raw 含原始 OCR 文字（而非所有字段 undefined）', async () => {
      // 场景：OCR 文字太乱（如微信账单截图），AI 无法提取结构化信息
      const messyOcrText = '11:10 5G 搜索 交易记录\n全部支出 转账 退款 订单\n7月\n支出 404.195 收入 0.00\n滴滴快车 -14.50 交通\n丽华园 -4.00 餐饮';
      mockedExtractTextFromImage.mockResolvedValue(messyOcrText);
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ error: '无法识别' }),
              },
            },
          ],
        }),
      } as any);

      await parseReceiptOCR('messyimage');

      expect(mockedMergeOcrResults).toHaveBeenCalledTimes(1);
      const [tesseractArg] = mockedMergeOcrResults.mock.calls[0];
      // 关键：AI 无法识别时，raw 必须包含原始 OCR 文字，不能所有字段都是 undefined
      expect(tesseractArg!.raw).toBeDefined();
      expect(tesseractArg!.raw).toContain(messyOcrText);
      expect(tesseractArg!.rawText).toBe(messyOcrText);
      // amount 等结构化字段应该为 undefined（AI 没识别出来）
      expect(tesseractArg!.amount).toBeUndefined();
    });

    test('视觉路径失败但已配置 → 记录 warn 日志，mergeOcrResults 收到 (tesseract, null)', async () => {
      mockedIsVisionConfigured.mockReturnValue(true);
      mockedExtractTextFromImage.mockResolvedValue('小炒肉饭 35.00');
      mockedExtractViaVision.mockRejectedValue(new Error('vision API 401'));
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ amount: 35, category: '餐饮' }),
              },
            },
          ],
        }),
      } as any);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await parseReceiptOCR('base64image');

      // 视觉失败但已配置 → 应记录 warn
      expect(warnSpy).toHaveBeenCalledWith(
        '视觉 OCR 路径失败:',
        expect.any(Error)
      );
      // mergeOcrResults 收到 (tesseract, null)
      expect(mockedMergeOcrResults).toHaveBeenCalledTimes(1);
      const [tesseractArg, visionArg] = mockedMergeOcrResults.mock.calls[0];
      expect(tesseractArg!.amount).toBe(35);
      expect(visionArg).toBeNull();

      warnSpy.mockRestore();
    });

    test('AI 返回含 type=income → runTesseractPath 解析出 type 字段传给 mergeOcrResults', async () => {
      mockedExtractTextFromImage.mockResolvedValue('收到转账 +15000 工资');
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  type: 'income',
                  amount: 15000,
                  date: '2026-07-23',
                  category: '工资',
                  description: '工资',
                }),
              },
            },
          ],
        }),
      } as any);

      await parseReceiptOCR('base64image');

      expect(mockedMergeOcrResults).toHaveBeenCalledTimes(1);
      const [tesseractArg] = mockedMergeOcrResults.mock.calls[0];
      expect(tesseractArg!.type).toBe('income');
      expect(tesseractArg!.amount).toBe(15000);
      expect(tesseractArg!.category).toBe('工资');
    });
  });

  describe('ocrToActions', () => {
    test('无 amount → 返回空数组', () => {
      const result = ocrToActions({ source: 'tesseract' });
      expect(result).toEqual([]);
    });

    test('amount <= 0 → 返回空数组', () => {
      const result = ocrToActions({ amount: 0, source: 'tesseract' });
      expect(result).toEqual([]);
    });

    test('type=income + 合法类别 → create_income action', () => {
      const result = ocrToActions({
        amount: 15000,
        type: 'income',
        category: '工资',
        description: '七月工资',
        date: '2026-07-23',
        source: 'tesseract',
      });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('create_income');
      expect(result[0].data.amount).toBe(15000);
      expect(result[0].data.category).toBe('工资');
      expect(result[0].data.description).toBe('七月工资');
      expect(result[0].data.date).toBe('2026-07-23');
    });

    test('type=expense + 合法类别 → create_expense action', () => {
      const result = ocrToActions({
        amount: 35,
        type: 'expense',
        category: '餐饮',
        description: '麦当劳',
        source: 'vision',
      });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('create_expense');
      expect(result[0].data.amount).toBe(35);
      expect(result[0].data.category).toBe('餐饮');
    });

    test('无 type（默认）→ create_expense action', () => {
      const result = ocrToActions({
        amount: 50,
        category: '交通',
        source: 'merged',
      });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('create_expense');
    });

    test('支出类别不在白名单 → 归"其他支出"', () => {
      const result = ocrToActions({
        amount: 100,
        type: 'expense',
        category: '未知类别',
        source: 'tesseract',
      });
      expect(result[0].data.category).toBe('其他支出');
    });

    test('收入类别不在白名单 → 归"其他收入"', () => {
      const result = ocrToActions({
        amount: 200,
        type: 'income',
        category: '奇怪收入',
        source: 'tesseract',
      });
      expect(result[0].data.category).toBe('其他收入');
    });

    test('无 date → action.data 不含 date 字段', () => {
      const result = ocrToActions({
        amount: 35,
        type: 'expense',
        category: '餐饮',
        source: 'tesseract',
      });
      expect(result[0].data.date).toBeUndefined();
    });
  });
});
