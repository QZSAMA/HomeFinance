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

jest.mock('../services/aiService', () => ({
  chatCompletion: jest.fn(),
  analyzeFinance: jest.fn(),
  parseReceiptOCR: jest.fn(),
}));

import { prisma } from '../app';
import { chatCompletion, analyzeFinance, parseReceiptOCR } from '../services/aiService';

const mockedPrisma = prisma as any;
const mockedChatCompletion = chatCompletion as jest.MockedFunction<typeof chatCompletion>;
const mockedAnalyzeFinance = analyzeFinance as jest.MockedFunction<typeof analyzeFinance>;
const mockedParseReceiptOCR = parseReceiptOCR as jest.MockedFunction<typeof parseReceiptOCR>;

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
  });

  describe('POST /api/families/:familyId/ai/chat', () => {
    test('returns AI response and saves conversation', async () => {
      mockedChatCompletion.mockResolvedValue('AI回复内容');
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/chat')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ content: '你好' });

      expect(res.status).toBe(200);
      expect(res.body.response).toBe('AI回复内容');
      expect(mockedChatCompletion).toHaveBeenCalled();
      expect(mockedPrisma.aiConversation.create).toHaveBeenCalledTimes(2);
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
    test('returns parsed receipt data', async () => {
      mockedParseReceiptOCR.mockResolvedValue({
        amount: 125.5,
        date: '2026-07-10',
        category: '餐饮',
        description: '午餐',
      });
      mockedPrisma.aiConversation.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/families/family_1/ai/ocr')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ image: 'base64string' });

      expect(res.status).toBe(200);
      expect(res.body.data.amount).toBe(125.5);
      expect(mockedParseReceiptOCR).toHaveBeenCalledWith('base64string');
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
