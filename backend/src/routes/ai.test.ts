import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import aiRoutes from './ai';

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    aiConversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    aiProposal: {
      create: jest.fn(),
    },
    file: {
      findUnique: jest.fn(),
    },
    asset: {
      findMany: jest.fn(),
    },
    liability: {
      findMany: jest.fn(),
    },
    income: {
      findMany: jest.fn(),
    },
    expense: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../config/redis', () => ({
  redisClient: {
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([1, 1]),
    }),
    isOpen: true,
  },
}));

jest.mock('../config/ai', () => ({
  AI_CONFIG: { baseURL: '', apiKey: '', model: 'test', maxTokens: 100, temperature: 0.5 },
  isAIConfigured: jest.fn().mockReturnValue(true),
  AI_VISION_CONFIG: { baseURL: '', apiKey: '', model: '', maxTokens: 4096, temperature: 0.3 },
  isVisionConfigured: jest.fn().mockReturnValue(false),
}));

jest.mock('../services/aiService', () => ({
  chatWithActions: jest.fn(),
  analyzeFinance: jest.fn(),
  parseReceiptOCR: jest.fn(),
  ocrToActions: jest.fn().mockReturnValue([]),
  AIError: class AIError extends Error {
    statusCode: number;
    constructor(msg: string, code: number = 500) { super(msg); this.statusCode = code; }
  },
}));

jest.mock('../services/aiActions', () => ({
  executeActions: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/fileStorageService', () => ({
  storeOcrImage: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { chatWithActions, analyzeFinance, parseReceiptOCR, ocrToActions } from '../services/aiService';
import { executeActions } from '../services/aiActions';
import { storeOcrImage } from '../services/fileStorageService';

const mockedPrisma = prisma as any;
const mockedChatWithActions = chatWithActions as jest.MockedFunction<typeof chatWithActions>;
const mockedAnalyzeFinance = analyzeFinance as jest.MockedFunction<typeof analyzeFinance>;
const mockedParseReceiptOCR = parseReceiptOCR as jest.MockedFunction<typeof parseReceiptOCR>;
const mockedOcrToActions = ocrToActions as jest.MockedFunction<typeof ocrToActions>;
const mockedExecuteActions = executeActions as jest.MockedFunction<typeof executeActions>;
const mockedStoreOcrImage = storeOcrImage as jest.MockedFunction<typeof storeOcrImage>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/ai', aiRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('AI Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'family_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.asset.findMany.mockResolvedValue([]);
    mockedPrisma.liability.findMany.mockResolvedValue([]);
    mockedPrisma.income.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
    mockedPrisma.aiConversation.findMany.mockResolvedValue([]);
    mockedPrisma.aiConversation.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      familyId: 'family_1',
      userId: 'user_1',
      type: /image|mixed|ocr/.test(where.id) ? 'ocr' : 'chat',
    }));
    mockedPrisma.file.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id,
      familyId: 'family_1',
      userId: 'user_1',
    }));
    mockedExecuteActions.mockResolvedValue([]);
    // OCR 存储默认返回 null（不阻塞 OCR 主流程）
    mockedStoreOcrImage.mockResolvedValue(null);
    // ocrToActions 默认返回空数组（不提议任何动作）
    mockedOcrToActions.mockReturnValue([]);
  });

  describe('POST /api/families/:familyId/ai/chat', () => {
    test('returns AI response and saves conversation', async () => {
      mockedChatWithActions.mockResolvedValue({ reply: 'AI回复内容', actions: [] });
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '你好' });

      expect(res.status).toBe(200);
      expect(res.body.response).toBe('AI回复内容');
      expect(mockedChatWithActions).toHaveBeenCalled();
      expect(mockedPrisma.aiConversation.create).toHaveBeenCalledTimes(1);
    });

    test('returns text actions as proposals without executing them', async () => {
      mockedChatWithActions.mockResolvedValue({
        reply: '已记录支出',
        actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
      });
      mockedPrisma.aiConversation.create.mockResolvedValue({ id: 'conversation_text_1' });
      mockedPrisma.aiProposal.create.mockResolvedValue({
        id: 'proposal_text_1',
        version: 1,
        originalHash: 'a'.repeat(64),
        expiresAt: new Date('2026-09-01T12:15:00.000Z'),
      });

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '午饭花了50块' });

      expect(res.status).toBe(200);
      expect(res.body.response).toBe('已记录支出');
      expect(res.body.actions).toEqual([]);
      expect(res.body.proposedActions).toEqual([
        { type: 'create_expense', data: { amount: 50, category: '餐饮' } },
      ]);
      expect(res.body.duplicateFlags).toEqual([false]);
      expect(res.body).toMatchObject({
        proposalId: 'proposal_text_1',
        proposalVersion: 1,
        proposalHash: 'a'.repeat(64),
        proposalExpiresAt: '2026-09-01T12:15:00.000Z',
      });
      expect(mockedPrisma.aiProposal.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'family_1',
          actorUserId: 'user_1',
          sourceType: 'TEXT',
          sourceConversationId: 'conversation_text_1',
          originalPayload: expect.objectContaining({
            reply: '已记录支出',
            actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
          }),
          originalHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          items: {
            create: [{
              ordinal: 0,
              typedAction: 'create_expense',
              canonicalData: { amount: 50, category: '餐饮' },
            }],
          },
        }),
      }));
      expect(mockedExecuteActions).not.toHaveBeenCalled();
    });

    test('returns a stable validation error when the AI proposes a malformed action', async () => {
      mockedChatWithActions.mockResolvedValue({
        reply: '建议记录支出',
        actions: [{ type: 'create_expense', data: { amount: 0, category: '餐饮' } }],
      });
      mockedPrisma.aiConversation.create.mockResolvedValue({ id: 'conversation_invalid_1' });

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '记录一笔金额为零的支出' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        retryable: false,
      });
      expect(mockedPrisma.aiProposal.create).not.toHaveBeenCalled();
      expect(mockedExecuteActions).not.toHaveBeenCalled();
    });

    test('does not return success when proposal persistence fails', async () => {
      mockedChatWithActions.mockResolvedValue({
        reply: '建议记录支出',
        actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
      });
      mockedPrisma.aiConversation.create.mockResolvedValue({ id: 'conversation_persistence_failure' });
      mockedPrisma.aiProposal.create.mockRejectedValue(new Error('database unavailable'));

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '记录午饭支出' });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        code: 'INTERNAL_ERROR',
        retryable: false,
      });
      expect(res.body.error).not.toContain('database unavailable');
      expect(mockedExecuteActions).not.toHaveBeenCalled();
    });

    test('rejects empty content', async () => {
      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .send({ content: '你好' });

      expect(res.status).toBe(401);
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '你好' });

      expect(res.status).toBe(403);
    });

    test('passes conversation history to chatWithActions', async () => {
      // 模拟 2 条历史对话（按 createdAt 升序）
      const older = new Date('2026-07-01T10:00:00Z');
      const newer = new Date('2026-07-02T10:00:00Z');
      mockedPrisma.aiConversation.findMany.mockResolvedValue([
        { id: 'h2', content: '我工资多少', response: '你的工资是 15000', type: 'chat', createdAt: newer },
        { id: 'h1', content: '工资 15000', response: '已记录工资', type: 'chat', createdAt: older },
      ]);
      mockedChatWithActions.mockResolvedValue({ reply: '你刚才说工资 15000', actions: [] });
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '我刚才说了什么' });

      expect(mockedPrisma.aiConversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ familyId: 'family_1', type: 'chat' }),
        orderBy: { createdAt: 'desc' },
        take: 10,
      }));
      // chatWithActions 第 3 个参数应为 history 数组，长度 4（2 条对话 × 2 message）
      const callArgs = mockedChatWithActions.mock.calls[0] as any[];
      const historyArg = callArgs[2] as any[];
      expect(Array.isArray(historyArg)).toBe(true);
      expect(historyArg).toHaveLength(4);
      // 升序：第一条应是 user role（最早对话）
      expect(historyArg[0]).toEqual({ role: 'user', content: '工资 15000' });
      expect(historyArg[1]).toEqual({ role: 'assistant', content: '已记录工资' });
      expect(historyArg[2]).toEqual({ role: 'user', content: '我工资多少' });
      expect(historyArg[3]).toEqual({ role: 'assistant', content: '你的工资是 15000' });
    });

    test('passes empty history when no prior conversations', async () => {
      mockedPrisma.aiConversation.findMany.mockResolvedValue([]);
      mockedChatWithActions.mockResolvedValue({ reply: '你好', actions: [] });
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '你好' });

      const callArgs = mockedChatWithActions.mock.calls[0] as any[];
      const historyArg = callArgs[2] as any[];
      expect(Array.isArray(historyArg)).toBe(true);
      expect(historyArg).toHaveLength(0);
    });

    // ===== 扩展 /chat 支持图片（统一对话端点，AGI 标准模式）=====

    test('仅有图片无文本 → 走 OCR 流程，返回 proposedActions', async () => {
      // 模拟 OCR 识别出 1 笔交易
      mockedParseReceiptOCR.mockResolvedValue({
        amount: 50,
        date: '2026-07-27',
        category: '餐饮',
        description: '午餐',
        source: 'tesseract',
      });
      mockedOcrToActions.mockReturnValue([
        { type: 'create_expense', data: { amount: 50, category: '餐饮', date: '2026-07-27', description: '午餐' } },
      ]);
      mockedStoreOcrImage.mockResolvedValue({ fileId: 'file_img1', path: 'some/path.jpg' });
      mockedPrisma.aiConversation.create.mockResolvedValue({ id: 'conversation_image_1' });
      mockedPrisma.aiProposal.create.mockResolvedValue({
        id: 'proposal_image_1',
        version: 1,
        originalHash: 'c'.repeat(64),
        expiresAt: new Date('2026-09-01T12:15:00.000Z'),
      });

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ images: ['base64_img1'] });

      expect(res.status).toBe(200);
      expect(res.body.proposedActions).toHaveLength(1);
      expect(res.body.proposedActions[0].type).toBe('create_expense');
      expect(res.body.fileIds).toEqual(['file_img1']);
      expect(res.body.duplicateFlags).toHaveLength(1);
      expect(res.body).toMatchObject({
        proposalId: 'proposal_image_1',
        proposalVersion: 1,
        proposalHash: 'c'.repeat(64),
        proposalExpiresAt: '2026-09-01T12:15:00.000Z',
      });
      expect(mockedPrisma.aiProposal.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'OCR',
          sourceConversationId: 'conversation_image_1',
          sourceFileId: 'file_img1',
        }),
      }));
      // chatWithActions 不应被调用（纯 OCR 场景）
      expect(mockedChatWithActions).not.toHaveBeenCalled();
      // parseReceiptOCR 应被调用 1 次
      expect(mockedParseReceiptOCR).toHaveBeenCalledTimes(1);
      expect(mockedParseReceiptOCR).toHaveBeenCalledWith('base64_img1');
    });

    test('图片+文本一起发送 → OCR 后用文本作为上下文调整 proposedActions', async () => {
      mockedParseReceiptOCR.mockResolvedValue({
        amount: 100,
        date: '2026-07-27',
        category: '餐饮',
        source: 'tesseract',
      });
      mockedOcrToActions.mockReturnValue([
        { type: 'create_expense', data: { amount: 100, category: '餐饮', date: '2026-07-27' } },
      ]);
      // 模拟 AI 根据用户文本调整 actions（如过滤、修改）
      mockedChatWithActions.mockResolvedValue({
        reply: '已根据你的说明记录',
        actions: [{ type: 'create_expense', data: { amount: 100, category: '餐饮', date: '2026-07-27' } }],
      });
      mockedStoreOcrImage.mockResolvedValue({ fileId: 'file_img1', path: 'some/path.jpg' });
      mockedPrisma.aiConversation.create.mockResolvedValue({ id: 'conversation_mixed_1' });
      mockedPrisma.aiProposal.create.mockResolvedValue({
        id: 'proposal_mixed_1',
        version: 1,
        originalHash: 'd'.repeat(64),
        expiresAt: new Date('2026-09-01T12:15:00.000Z'),
      });

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '这是昨天的午餐，金额没错', images: ['base64_img1'] });

      expect(res.status).toBe(200);
      expect(mockedParseReceiptOCR).toHaveBeenCalledTimes(1);
      expect(mockedChatWithActions).toHaveBeenCalledTimes(1);
      expect(res.body).toMatchObject({
        proposalId: 'proposal_mixed_1',
        proposalVersion: 1,
        proposalHash: 'd'.repeat(64),
        proposalExpiresAt: '2026-09-01T12:15:00.000Z',
      });
      expect(mockedPrisma.aiProposal.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          sourceType: 'OCR',
          sourceConversationId: 'conversation_mixed_1',
          sourceFileId: 'file_img1',
        }),
      }));
      // chatWithActions 第 1 个参数应包含用户文本 + OCR 上下文
      const chatArg = mockedChatWithActions.mock.calls[0][0] as string;
      expect(chatArg).toContain('这是昨天的午餐');
    });

    test('多张图片 → 并行 OCR + 合并 proposedActions', async () => {
      mockedParseReceiptOCR
        .mockResolvedValueOnce({ amount: 50, category: '餐饮', source: 'tesseract' })
        .mockResolvedValueOnce({ amount: 200, category: '交通', source: 'tesseract' });
      mockedOcrToActions
        .mockReturnValueOnce([{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }])
        .mockReturnValueOnce([{ type: 'create_expense', data: { amount: 200, category: '交通' } }]);
      mockedStoreOcrImage
        .mockResolvedValueOnce({ fileId: 'file_1', path: 'p1.jpg' })
        .mockResolvedValueOnce({ fileId: 'file_2', path: 'p2.jpg' });
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ images: ['img1', 'img2'] });

      expect(res.status).toBe(200);
      expect(res.body.proposedActions).toHaveLength(2);
      expect(res.body.fileIds).toHaveLength(2);
      expect(res.body.duplicateFlags).toHaveLength(2);
      expect(mockedParseReceiptOCR).toHaveBeenCalledTimes(2);
    });

    test('content 和 images 都为空 → 400', async () => {
      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('图片超过 10 张 → 400', async () => {
      const images = Array(11).fill('base64');
      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ images });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/图片/);
    });

    test('单张图 OCR 失败 → 不阻塞其他图，错误图跳过', async () => {
      mockedParseReceiptOCR
        .mockRejectedValueOnce(new Error('OCR 失败'))
        .mockResolvedValueOnce({ amount: 50, category: '餐饮', source: 'tesseract' });
      mockedOcrToActions.mockReturnValue([
        { type: 'create_expense', data: { amount: 50, category: '餐饮' } },
      ]);
      mockedStoreOcrImage.mockResolvedValue(null);
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ images: ['bad_img', 'good_img'] });

      expect(res.status).toBe(200);
      // 失败图跳过，只返回 1 条 proposedAction
      expect(res.body.proposedActions).toHaveLength(1);
    });

    test('仅图片场景 → aiConversation.create 收到 type=ocr', async () => {
      mockedParseReceiptOCR.mockResolvedValue({ amount: 50, source: 'tesseract' });
      mockedOcrToActions.mockReturnValue([
        { type: 'create_expense', data: { amount: 50 } },
      ]);
      mockedStoreOcrImage.mockResolvedValue(null);
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ images: ['img1'] });

      const createArgs = mockedPrisma.aiConversation.create.mock.calls[0][0];
      expect(createArgs.data.type).toBe('ocr');
    });
  });

  describe('POST /api/families/:familyId/ai/analyze', () => {
    test('returns financial analysis report', async () => {
      mockedAnalyzeFinance.mockResolvedValue('财务分析报告内容');
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/analyze')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.report).toBe('财务分析报告内容');
      expect(mockedAnalyzeFinance).toHaveBeenCalled();
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/families/family_1/ai/analyze')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/families/:familyId/ai/ocr', () => {
    test('returns parsed receipt data with source label', async () => {
      mockedParseReceiptOCR.mockResolvedValue({
        amount: 125.5,
        date: '2026-07-10',
        category: '餐饮',
        description: '午餐',
        source: 'tesseract',
      });
      mockedPrisma.aiConversation.create.mockResolvedValue({});
      mockedStoreOcrImage.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/family_1/ai/ocr')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ image: 'base64string' });

      expect(res.status).toBe(200);
      expect(res.body.data.amount).toBe(125.5);
      expect(res.body.data.source).toBe('tesseract');
      expect(res.body.visionConfigured).toBe(false);
      expect(res.body.fileId).toBeNull();
      expect(mockedParseReceiptOCR).toHaveBeenCalledWith('base64string');
      expect(mockedStoreOcrImage).toHaveBeenCalledWith('user_1', 'family_1', 'base64string');
    });

    test('存储成功 → 响应含 fileId，aiConversation.create 收到 fileId', async () => {
      mockedParseReceiptOCR.mockResolvedValue({
        amount: 35,
        source: 'tesseract',
      });
      mockedStoreOcrImage.mockResolvedValue({ fileId: 'file_123', path: 'user_1/family_1/receipts/2026/07/23/xxx.jpg' });
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/ocr')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ image: 'base64string' });

      expect(res.status).toBe(200);
      expect(res.body.fileId).toBe('file_123');
      // aiConversation.create 应收到 fileId: 'file_123'
      const createArgs = mockedPrisma.aiConversation.create.mock.calls[0][0];
      expect(createArgs.data.fileId).toBe('file_123');
      expect(createArgs.data.type).toBe('ocr');
    });

    test('存储失败不阻塞 OCR → 响应仍含 data，fileId 为 null', async () => {
      mockedParseReceiptOCR.mockResolvedValue({
        amount: 35,
        source: 'tesseract',
      });
      mockedStoreOcrImage.mockResolvedValue(null);
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/ocr')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ image: 'base64string' });

      expect(res.status).toBe(200);
      expect(res.body.data.amount).toBe(35);
      expect(res.body.fileId).toBeNull();
      // aiConversation.create 应收到 fileId: null
      const createArgs = mockedPrisma.aiConversation.create.mock.calls[0][0];
      expect(createArgs.data.fileId).toBeNull();
    });

    test('rejects missing image', async () => {
      const res = await request(app)
        .post('/api/families/family_1/ai/ocr')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({});

      expect(res.status).toBe(400);
    });

    test('识别成功 + amount>0 → 响应含 proposedActions，executeActions 未被调用', async () => {
      mockedParseReceiptOCR.mockResolvedValue({
        amount: 35,
        type: 'expense',
        category: '餐饮',
        description: '麦当劳',
        source: 'tesseract',
      });
      mockedOcrToActions.mockReturnValue([
        { type: 'create_expense', data: { amount: 35, category: '餐饮', description: '麦当劳' } },
      ]);
      mockedPrisma.aiConversation.create.mockResolvedValue({ id: 'conversation_ocr_1' });
      mockedPrisma.aiProposal.create.mockResolvedValue({
        id: 'proposal_ocr_1',
        version: 1,
        originalHash: 'b'.repeat(64),
        expiresAt: new Date('2026-09-01T12:15:00.000Z'),
      });

      const res = await request(app)
        .post('/api/families/family_1/ai/ocr')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ image: 'base64string' });

      expect(res.status).toBe(200);
      expect(res.body.proposedActions).toHaveLength(1);
      expect(res.body.proposedActions[0].type).toBe('create_expense');
      expect(res.body.proposedActions[0].data.amount).toBe(35);
      expect(res.body).toMatchObject({
        proposalId: 'proposal_ocr_1',
        proposalVersion: 1,
        proposalHash: 'b'.repeat(64),
        proposalExpiresAt: '2026-09-01T12:15:00.000Z',
      });
      expect(mockedPrisma.aiProposal.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'family_1',
          actorUserId: 'user_1',
          sourceType: 'OCR',
          sourceConversationId: 'conversation_ocr_1',
          sourceFileId: null,
          originalPayload: expect.objectContaining({
            data: expect.objectContaining({ amount: 35 }),
            actions: [{ type: 'create_expense', data: { amount: 35, category: '餐饮', description: '麦当劳' } }],
          }),
        }),
      }));
      // 关键：/ocr 端点不执行动作，只返回提议
      expect(mockedExecuteActions).not.toHaveBeenCalled();
      // ocrToActions 被调用，收到 parseReceiptOCR 的结果
      expect(mockedOcrToActions).toHaveBeenCalledTimes(1);
      const ocrToActionsArg = mockedOcrToActions.mock.calls[0][0];
      expect(ocrToActionsArg.amount).toBe(35);
    });

    test('识别失败（无 amount）→ proposedActions 为空数组', async () => {
      mockedParseReceiptOCR.mockResolvedValue({
        raw: 'AI 未能从 OCR 文字中识别出结构化信息',
        source: 'tesseract',
      });
      mockedOcrToActions.mockReturnValue([]);
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/ocr')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ image: 'base64string' });

      expect(res.status).toBe(200);
      expect(res.body.proposedActions).toEqual([]);
      expect(res.body.data.raw).toContain('未能');
    });
  });

  describe('POST /api/families/:familyId/ai/execute-actions', () => {
    test('合法 actions → 调用 executeActions，返回 ActionResult[]', async () => {
      const actionResult = { type: 'create_expense' as const, status: 'success' as const, message: '已创建支出：餐饮 ¥35.00', record: { id: 'exp_1' } };
      mockedExecuteActions.mockResolvedValue([actionResult]);
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/execute-actions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ actions: [{ type: 'create_expense', data: { amount: 35, category: '餐饮' } }] });

      expect(res.status).toBe(200);
      expect(res.body.actions).toHaveLength(1);
      expect(res.body.actions[0].status).toBe('success');
      expect(res.body.actions[0].record.id).toBe('exp_1');
      expect(mockedExecuteActions).toHaveBeenCalledTimes(1);
      // 落库对话记录
      expect(mockedPrisma.aiConversation.create).toHaveBeenCalledTimes(1);
      const createArgs = mockedPrisma.aiConversation.create.mock.calls[0][0];
      expect(createArgs.data.content).toContain('[确认记账]');
      expect(createArgs.data.type).toBe('chat');
    });

    test('空 actions 数组 → 400', async () => {
      const res = await request(app)
        .post('/api/families/family_1/ai/execute-actions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ actions: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('未认证 → 401', async () => {
      const res = await request(app)
        .post('/api/families/family_1/ai/execute-actions')
        .send({ actions: [{ type: 'create_expense', data: { amount: 35 } }] });

      expect(res.status).toBe(401);
    });

    test('非家庭成员 → 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/family_1/ai/execute-actions')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ actions: [{ type: 'create_expense', data: { amount: 35 } }] });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/families/:familyId/ai/history', () => {
    test('returns conversation history', async () => {
      mockedPrisma.aiConversation.findMany.mockResolvedValue([
        { id: '1', content: '你好', response: 'AI回复', type: 'chat', createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/family_1/ai/history')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .get('/api/families/family_1/ai/history');

      expect(res.status).toBe(401);
    });
  });
});
