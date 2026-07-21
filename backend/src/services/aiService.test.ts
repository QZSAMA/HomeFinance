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
    test('returns parsed receipt data on success', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  amount: 125.5,
                  date: '2026-07-10',
                  category: '餐饮',
                  description: '午餐',
                }),
              },
            },
          ],
        }),
      } as any);

      const result = await parseReceiptOCR('base64imagestring');

      expect(result.amount).toBe(125.5);
      expect(result.category).toBe('餐饮');
      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.messages[1].content).toContain('base64imagestring');
    });

    test('returns raw content when JSON parse fails', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'I cannot read this image clearly.',
              },
            },
          ],
        }),
      } as any);

      const result = await parseReceiptOCR('badimage');

      expect(result).toEqual({ raw: 'I cannot read this image clearly.' });
    });
  });
});
