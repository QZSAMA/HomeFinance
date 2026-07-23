import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import aiRoutes from './ai';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    aiConversation: {
      findMany: jest.fn(),
      create: jest.fn(),
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

import { prisma } from '../app';
import { chatWithActions, analyzeFinance, parseReceiptOCR } from '../services/aiService';
import { executeActions } from '../services/aiActions';
import { storeOcrImage } from '../services/fileStorageService';

const mockedPrisma = prisma as any;
const mockedChatWithActions = chatWithActions as jest.MockedFunction<typeof chatWithActions>;
const mockedAnalyzeFinance = analyzeFinance as jest.MockedFunction<typeof analyzeFinance>;
const mockedParseReceiptOCR = parseReceiptOCR as jest.MockedFunction<typeof parseReceiptOCR>;
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
    mockedExecuteActions.mockResolvedValue([]);
    // OCR 存储默认返回 null（不阻塞 OCR 主流程）
    mockedStoreOcrImage.mockResolvedValue(null);
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

    test('executes actions and returns results', async () => {
      mockedChatWithActions.mockResolvedValue({
        reply: '已记录支出',
        actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
      });
      mockedExecuteActions.mockResolvedValue([
        { type: 'create_expense', status: 'success', message: '已创建支出：餐饮 ¥50.00' },
      ]);
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '午饭花了50块' });

      expect(res.status).toBe(200);
      expect(res.body.response).toBe('已记录支出');
      expect(res.body.actions).toHaveLength(1);
      expect(res.body.actions[0].status).toBe('success');
      expect(mockedExecuteActions).toHaveBeenCalled();
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
