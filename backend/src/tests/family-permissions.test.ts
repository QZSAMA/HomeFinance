import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import incomesRoutes from '../routes/incomes';
import expensesRoutes from '../routes/expenses';
import assetsRoutes from '../routes/assets';
import liabilitiesRoutes from '../routes/liabilities';
import budgetsRoutes from '../routes/budgets';
import goalsRoutes from '../routes/goals';
import recurringRoutes from '../routes/recurring';
import filesRoutes from '../routes/files';
import importRoutes from '../routes/import';
import aiRoutes from '../routes/ai';

jest.mock('../app', () => {
  const model = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ id: 'created_1' }),
    update: jest.fn().mockResolvedValue({ id: 'updated_1' }),
    delete: jest.fn().mockResolvedValue({ id: 'deleted_1' }),
  });

  return {
    prisma: {
      familyMember: model(),
      income: model(),
      expense: model(),
      asset: model(),
      liability: model(),
      budget: model(),
      goal: model(),
      recurringTransaction: model(),
      file: model(),
      aiConversation: model(),
    },
  };
});

jest.mock('../middleware/rateLimit', () => ({
  rateLimitMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../config/minio', () => ({
  uploadFileBuffer: jest.fn().mockResolvedValue(undefined),
  getFileUrl: jest.fn().mockResolvedValue('https://example.test/file'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/aiService', () => ({
  AIError: class AIError extends Error {},
  chatWithActions: jest.fn().mockResolvedValue({ reply: '已记录', actions: [] }),
  analyzeFinance: jest.fn(),
  parseReceiptOCR: jest.fn(),
  ocrToActions: jest.fn(),
}));

jest.mock('../services/aiActions', () => ({
  executeActions: jest.fn().mockResolvedValue([{ status: 'success', message: 'created' }]),
}));

jest.mock('../services/fileStorageService', () => ({
  storeOcrImage: jest.fn().mockResolvedValue(null),
}));

jest.mock('../config/ai', () => ({
  isAIConfigured: jest.fn().mockReturnValue(false),
  isVisionConfigured: jest.fn().mockReturnValue(false),
}));

import { prisma } from '../app';
import { uploadFileBuffer } from '../config/minio';
import { executeActions } from '../services/aiActions';
import { analyzeFinance, chatWithActions } from '../services/aiService';

const mockedPrisma = prisma as any;
const mockedUploadFileBuffer = uploadFileBuffer as jest.Mock;
const mockedExecuteActions = executeActions as jest.Mock;
const mockedChatWithActions = chatWithActions as jest.Mock;
const mockedAnalyzeFinance = analyzeFinance as jest.Mock;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/families/:familyId/incomes', incomesRoutes);
app.use('/api/families/:familyId/expenses', expensesRoutes);
app.use('/api/families/:familyId/assets', assetsRoutes);
app.use('/api/families/:familyId/liabilities', liabilitiesRoutes);
app.use('/api/families/:familyId/budgets', budgetsRoutes);
app.use('/api/families/:familyId/goals', goalsRoutes);
app.use('/api/families/:familyId/recurring', recurringRoutes);
app.use('/api/families/:familyId/files', filesRoutes);
app.use('/api/families/:familyId/import', importRoutes);
app.use('/api/families/:familyId/ai', aiRoutes);

function createToken(userId = 'viewer_1') {
  return jwt.sign(
    { userId, email: 'viewer@example.com', name: 'Viewer' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' },
  );
}

type MutationCase = {
  name: string;
  path: string;
  body: Record<string, unknown>;
  sideEffect: () => jest.Mock;
};

const mutationCases: MutationCase[] = [
  {
    name: 'income create',
    path: '/api/families/fam_1/incomes',
    body: { amount: 100, category: '工资', date: '2026-08-01' },
    sideEffect: () => mockedPrisma.income.create,
  },
  {
    name: 'expense create',
    path: '/api/families/fam_1/expenses',
    body: { amount: 50, category: '餐饮', date: '2026-08-01' },
    sideEffect: () => mockedPrisma.expense.create,
  },
  {
    name: 'asset create',
    path: '/api/families/fam_1/assets',
    body: { name: '现金', type: 'CASH', value: 1000, currency: 'CNY' },
    sideEffect: () => mockedPrisma.asset.create,
  },
  {
    name: 'liability create',
    path: '/api/families/fam_1/liabilities',
    body: { name: '借款', type: 'OTHER', amount: 500, currency: 'CNY' },
    sideEffect: () => mockedPrisma.liability.create,
  },
  {
    name: 'budget create',
    path: '/api/families/fam_1/budgets',
    body: { category: '餐饮', amount: 1000, period: 'MONTHLY', startDate: '2026-08-01' },
    sideEffect: () => mockedPrisma.budget.create,
  },
  {
    name: 'goal create',
    path: '/api/families/fam_1/goals',
    body: { title: '应急金', type: 'SAVING', targetAmount: 10000 },
    sideEffect: () => mockedPrisma.goal.create,
  },
  {
    name: 'recurring rule create',
    path: '/api/families/fam_1/recurring',
    body: {
      type: 'INCOME', category: '工资', amount: 100, frequency: 'MONTHLY',
      interval: 1, nextDate: '2026-08-01',
    },
    sideEffect: () => mockedPrisma.recurringTransaction.create,
  },
  {
    name: 'import confirmation',
    path: '/api/families/fam_1/import/confirm',
    body: {
      items: [{ date: '2026-08-01', description: '工资', amount: 100, type: 'INCOME' }],
    },
    sideEffect: () => mockedPrisma.income.create,
  },
  {
    name: 'confirmed AI action execution',
    path: '/api/families/fam_1/ai/execute-actions',
    body: { actions: [{ type: 'create_income', data: { amount: 100, category: '工资' } }] },
    sideEffect: () => mockedExecuteActions,
  },
];

describe('family viewer mutation policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'viewer_1',
      role: 'viewer',
    });
    mockedPrisma.recurringTransaction.findUnique.mockResolvedValue({
      id: 'rec_1', familyId: 'fam_1', type: 'INCOME', amount: 100, category: '工资',
      nextDate: new Date('2026-08-01'), frequency: 'MONTHLY', interval: 1,
    });
  });

  test.each(mutationCases)('rejects viewer $name with no write side effect', async ({ path, body, sideEffect }) => {
    const response = await request(app)
      .post(path)
      .set('Authorization', `Bearer ${createToken()}`)
      .send(body);

    expect(response.status).toBe(403);
    expect(sideEffect()).not.toHaveBeenCalled();
  });

  test('rejects viewer recurring execution before a ledger entry is created', async () => {
    const response = await request(app)
      .post('/api/families/fam_1/recurring/rec_1/execute')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(403);
    expect(mockedPrisma.income.create).not.toHaveBeenCalled();
    expect(mockedPrisma.expense.create).not.toHaveBeenCalled();
  });

  test('rejects viewer upload before object storage or database writes', async () => {
    const response = await request(app)
      .post('/api/families/fam_1/files/upload')
      .set('Authorization', `Bearer ${createToken()}`)
      .attach('files', Buffer.from('financial document'), 'statement.txt');

    expect(response.status).toBe(403);
    expect(mockedUploadFileBuffer).not.toHaveBeenCalled();
    expect(mockedPrisma.file.create).not.toHaveBeenCalled();
  });

  test('rejects a viewer text AI mutation before executing model actions', async () => {
    mockedChatWithActions.mockResolvedValueOnce({
      reply: '已记录',
      actions: [{ type: 'create_income', data: { amount: 100, category: '工资' } }],
    });

    const response = await request(app)
      .post('/api/families/fam_1/ai/chat')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ content: '记录工资 100 元' });

    expect(response.status).toBe(403);
    expect(mockedExecuteActions).not.toHaveBeenCalled();
  });

  test('rejects viewer financial analysis before AI or conversation writes', async () => {
    const response = await request(app)
      .post('/api/families/fam_1/ai/analyze')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(403);
    expect(mockedAnalyzeFinance).not.toHaveBeenCalled();
    expect(mockedPrisma.aiConversation.create).not.toHaveBeenCalled();
  });

  test('fails closed for an unknown family role', async () => {
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'viewer_1',
      role: 'auditor',
    });

    const response = await request(app)
      .post('/api/families/fam_1/incomes')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ amount: 100, category: '工资', date: '2026-08-01' });

    expect(response.status).toBe(403);
    expect(mockedPrisma.income.create).not.toHaveBeenCalled();
  });
});
