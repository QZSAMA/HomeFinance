// Mock config/ai 以控制 isVisionConfigured 和 AI_VISION_CONFIG（extractViaVision 依赖）
jest.mock('../config/ai', () => ({
  AI_CONFIG: { baseURL: 'https://test.api.com', apiKey: 'test-key', model: 'test-model', maxTokens: 100, temperature: 0.5 },
  isAIConfigured: jest.fn().mockReturnValue(true),
  AI_VISION_CONFIG: {
    baseURL: 'https://vision.api.com',
    apiKey: 'vision-key',
    model: 'vision-model',
    maxTokens: 4096,
    temperature: 0.3,
  },
  isVisionConfigured: jest.fn().mockReturnValue(true),
}));

import { mergeOcrResults, extractViaVision, type ParsedOCR } from './ocrService';
import { isVisionConfigured, AI_VISION_CONFIG } from '../config/ai';

const mockedIsVisionConfigured = isVisionConfigured as jest.MockedFunction<typeof isVisionConfigured>;

describe('ocrService', () => {
  describe('mergeOcrResults', () => {
    test('两者都 null → source=tesseract，raw 含失败提示', () => {
      const result = mergeOcrResults(null, null);
      expect(result.source).toBe('tesseract');
      expect(result.raw).toContain('OCR 识别失败');
      expect(result.amount).toBeUndefined();
      expect(result.date).toBeUndefined();
    });

    test('只有 tesseract（含字段）→ source=tesseract，字段透传', () => {
      const tesseract: ParsedOCR = { amount: 35, date: '2026-07-10', category: '餐饮', description: '小炒肉饭' };
      const result = mergeOcrResults(tesseract, null);
      expect(result.source).toBe('tesseract');
      expect(result.amount).toBe(35);
      expect(result.date).toBe('2026-07-10');
      expect(result.category).toBe('餐饮');
      expect(result.description).toBe('小炒肉饭');
    });

    test('只有 vision（含字段）→ source=vision，字段透传', () => {
      const vision: ParsedOCR = { amount: 35.5, date: '2026-07-10', category: '餐饮', description: '视觉识别' };
      const result = mergeOcrResults(null, vision);
      expect(result.source).toBe('vision');
      expect(result.amount).toBe(35.5);
      expect(result.description).toBe('视觉识别');
    });

    test('两者都有完整字段 → source=merged，vision 字段优先', () => {
      const tesseract: ParsedOCR = { amount: 35, date: '2026-07-10', category: '其他', description: 'Tesseract 描述' };
      const vision: ParsedOCR = { amount: 35.5, date: '2026-07-11', category: '餐饮', description: '视觉描述' };
      const result = mergeOcrResults(tesseract, vision);
      expect(result.source).toBe('merged');
      // vision 优先
      expect(result.amount).toBe(35.5);
      expect(result.date).toBe('2026-07-11');
      expect(result.category).toBe('餐饮');
      expect(result.description).toBe('视觉描述');
    });

    test('两者都有但 tesseract 字段全 undefined → source=vision', () => {
      const tesseract: ParsedOCR = { raw: 'some raw text' };
      const vision: ParsedOCR = { amount: 50, category: '交通' };
      const result = mergeOcrResults(tesseract, vision);
      expect(result.source).toBe('vision');
      expect(result.amount).toBe(50);
    });

    test('两者都有但 vision 字段全 undefined → source=tesseract', () => {
      const tesseract: ParsedOCR = { amount: 50, category: '交通' };
      const vision: ParsedOCR = { raw: 'vision raw' };
      const result = mergeOcrResults(tesseract, vision);
      expect(result.source).toBe('tesseract');
      expect(result.amount).toBe(50);
    });

    test('两者都有 → rawText 从 tesseract 保留', () => {
      const tesseract: ParsedOCR = { amount: 35, rawText: '原始 OCR 文字内容' };
      const vision: ParsedOCR = { amount: 35 };
      const result = mergeOcrResults(tesseract, vision);
      expect(result.rawText).toBe('原始 OCR 文字内容');
    });
  });

  describe('extractViaVision', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation();
      mockedIsVisionConfigured.mockReturnValue(true);
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    test('isVisionConfigured=false → 抛出"视觉模型未配置"', async () => {
      mockedIsVisionConfigured.mockReturnValue(false);

      await expect(extractViaVision('base64image')).rejects.toThrow('视觉模型未配置');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test('fetch ok + 合法 JSON → 返回结构化 ParsedOCR', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  amount: 35.5,
                  date: '2026-07-10',
                  category: '餐饮',
                  description: '小炒肉饭',
                }),
              },
            },
          ],
        }),
      } as any);

      const result = await extractViaVision('base64image');

      expect(result.amount).toBe(35.5);
      expect(result.date).toBe('2026-07-10');
      expect(result.category).toBe('餐饮');
      expect(result.description).toBe('小炒肉饭');
    });

    test('fetch ok + JSON 包裹在 markdown 代码块 → 剥离后解析成功', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '```json\n{"amount": 50, "date": "2026-07-11", "category": "交通", "description": "打车"}\n```',
              },
            },
          ],
        }),
      } as any);

      const result = await extractViaVision('base64image');

      expect(result.amount).toBe(50);
      expect(result.category).toBe('交通');
      expect(result.description).toBe('打车');
    });

    test('fetch ok + 含 error 字段 → 返回 { raw: content }', async () => {
      const errorContent = '{"error": "无法识别"}';
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: errorContent } }],
        }),
      } as any);

      const result = await extractViaVision('base64image');

      expect(result.amount).toBeUndefined();
      expect(result.raw).toBe(errorContent);
    });

    test('fetch ok + 非 JSON 文本 → 返回 { raw: content }', async () => {
      const nonJsonContent = '这是一张餐饮小票，金额约 35 元。';
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: nonJsonContent } }],
        }),
      } as any);

      const result = await extractViaVision('base64image');

      expect(result.amount).toBeUndefined();
      expect(result.raw).toBe(nonJsonContent);
    });

    test('fetch not ok (401) → 抛出含状态码的错误', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as any);

      await expect(extractViaVision('base64image')).rejects.toThrow('视觉模型调用失败 (401)');
    });

    test('请求体使用 image_url 多模态格式（content 数组含 image_url）', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: '{"amount": 35}' } }],
        }),
      } as any);

      const dataUrl = 'data:image/jpeg;base64,abc123';
      await extractViaVision(dataUrl);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${AI_VISION_CONFIG.baseURL}/chat/completions`);
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      // 第二条 message 的 content 应为数组，含 text 和 image_url
      const userMessage = body.messages[1];
      expect(Array.isArray(userMessage.content)).toBe(true);
      const imageUrlPart = userMessage.content.find((c: any) => c.type === 'image_url');
      expect(imageUrlPart).toBeDefined();
      expect(imageUrlPart.image_url.url).toBe(dataUrl);
      const textPart = userMessage.content.find((c: any) => c.type === 'text');
      expect(textPart).toBeDefined();
      // 验证使用视觉模型配置
      expect(body.model).toBe(AI_VISION_CONFIG.model);
      expect(body.max_tokens).toBe(AI_VISION_CONFIG.maxTokens);
    });
  });
});
