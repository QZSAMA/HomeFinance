import { chatCompletion, analyzeFinance, parseReceiptOCR } from './aiService';

jest.mock('../config/ai', () => ({
  AI_CONFIG: {
    baseURL: 'https://test.api.com',
    apiKey: 'test-key',
    model: 'test-model',
    maxTokens: 100,
    temperature: 0.5,
  },
  isAIConfigured: jest.fn().mockReturnValue(true),
}));

jest.mock('./aiActions', () => ({
  parseLocalActions: jest.fn().mockReturnValue({ reply: '', actions: [] }),
}));

// Mock 本地 OCR 服务 —— parseReceiptOCR 现在先调用本地 Tesseract.js 提取文字
jest.mock('./ocrService', () => ({
  extractTextFromImage: jest.fn(),
}));

jest.mock('../app', () => ({
  prisma: {},
}));

describe('aiService', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
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
    const { extractTextFromImage } = require('./ocrService');

    beforeEach(() => {
      extractTextFromImage.mockReset();
    });

    test('本地 OCR 提取文字 + AI 解析为结构化 JSON', async () => {
      // Mock 本地 OCR 返回票据文字
      extractTextFromImage.mockResolvedValue('小炒肉饭 35.00\n日期 2026-07-10');

      // Mock AI 解析返回结构化 JSON
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

      const result = await parseReceiptOCR('base64imagestring');

      expect(result.amount).toBe(35);
      expect(result.category).toBe('餐饮');
      expect(result.description).toBe('小炒肉饭');
      // 验证调用了本地 OCR
      expect(extractTextFromImage).toHaveBeenCalledWith('base64imagestring');
      // 验证 AI 收到的是 OCR 文字（文本，不是 image_url 数组）
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(typeof body.messages[1].content).toBe('string');
      expect(body.messages[1].content).toContain('小炒肉饭');
      expect(body.messages[1].content).toContain('35.00');
    });

    test('OCR 未识别到文字时返回提示', async () => {
      extractTextFromImage.mockResolvedValue('');

      const result = await parseReceiptOCR('blankimage');

      expect(result.amount).toBeUndefined();
      expect(result.raw).toContain('未识别到文字内容');
      // 不应调用 AI
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test('AI 返回非 JSON 时降级返回原始 OCR 文字', async () => {
      extractTextFromImage.mockResolvedValue('支付宝 50元 超市');
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

      const result = await parseReceiptOCR('someimage');

      expect(result.raw).toContain('这是一笔超市购物');
      expect(result.raw).toContain('支付宝 50元 超市');
    });

    test('本地 OCR 抛错时抛出 AIError', async () => {
      extractTextFromImage.mockRejectedValue(new Error('tesseract worker crash'));

      await expect(parseReceiptOCR('badimage')).rejects.toThrow('本地 OCR 文字提取失败');
    });
  });
});
