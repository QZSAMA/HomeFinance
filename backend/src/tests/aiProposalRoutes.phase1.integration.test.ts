import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import aiRoutes from '../routes/ai';

jest.mock('../services/aiService', () => ({
  chatWithActions: jest.fn(),
  analyzeFinance: jest.fn(),
  parseReceiptOCR: jest.fn(),
  ocrToActions: jest.fn(),
  isAIConfigured: jest.fn().mockReturnValue(false),
  isVisionConfigured: jest.fn().mockReturnValue(false),
  AIError: class AIError extends Error {
    statusCode = 500;
  },
}));

jest.mock('../services/fileStorageService', () => ({
  storeOcrImage: jest.fn(),
}));

import { chatWithActions, ocrToActions, parseReceiptOCR } from '../services/aiService';
import { storeOcrImage } from '../services/fileStorageService';

const prisma = new PrismaClient();
const runId = randomUUID();
const familyId = `p1-ai-route-family-${runId}`;
const memberId = `p1-ai-route-member-${runId}`;
const viewerId = `p1-ai-route-viewer-${runId}`;
const outsiderId = `p1-ai-route-outsider-${runId}`;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/ai', aiRoutes);

const tokenFor = (userId: string) => jwt.sign(
  { userId, email: `${userId}@example.test`, name: userId },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const memberToken = tokenFor(memberId);
const viewerToken = tokenFor(viewerId);
const outsiderToken = tokenFor(outsiderId);

const financialCounts = async () => Promise.all([
  prisma.income.count({ where: { familyId } }),
  prisma.expense.count({ where: { familyId } }),
  prisma.asset.count({ where: { familyId } }),
  prisma.liability.count({ where: { familyId } }),
]);

describe('Phase 1 real PostgreSQL AI proposal routes', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        { id: memberId, email: `${memberId}@example.test`, passwordHash: 'test', name: 'AI member' },
        { id: viewerId, email: `${viewerId}@example.test`, passwordHash: 'test', name: 'AI viewer' },
        { id: outsiderId, email: `${outsiderId}@example.test`, passwordHash: 'test', name: 'AI outsider' },
      ],
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'AI proposal route family',
        members: {
          create: [
            { userId: memberId, role: 'member' },
            { userId: viewerId, role: 'viewer' },
          ],
        },
      },
    });
  });

  afterEach(async () => {
    await prisma.aiProposal.deleteMany({ where: { familyId } });
    await prisma.aiConversation.deleteMany({ where: { familyId } });
    await prisma.auditEvent.deleteMany({ where: { familyId } });
    await prisma.idempotencyRecord.deleteMany({ where: { familyId } });
    await prisma.income.deleteMany({ where: { familyId } });
    await prisma.expense.deleteMany({ where: { familyId } });
    await prisma.asset.deleteMany({ where: { familyId } });
    await prisma.liability.deleteMany({ where: { familyId } });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({ where: { id: { in: [memberId, viewerId, outsiderId] } } });
    await prisma.$disconnect();
  });

  test('persists a text proposal and leaves all financial facts unchanged before confirmation', async () => {
    const actions = [{
      type: 'create_expense' as const,
      data: { amount: 25, category: '餐饮', date: '2026-09-01', description: '午餐' },
    }];
    (chatWithActions as jest.Mock).mockResolvedValue({ reply: '请确认这笔午餐支出', actions });
    const before = await financialCounts();

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/chat`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: '午饭花了25元' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      actions: [],
      proposedActions: actions,
      proposalVersion: 1,
      proposalHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      proposalExpiresAt: expect.any(String),
    });
    expect(response.body.proposalId).toEqual(expect.any(String));
    expect(await financialCounts()).toEqual(before);

    const proposal = await prisma.aiProposal.findUniqueOrThrow({
      where: { id: response.body.proposalId },
      include: { items: true, sourceConversation: true },
    });
    expect(proposal).toMatchObject({
      familyId,
      actorUserId: memberId,
      actorSnapshot: { version: 1, userId: memberId, role: 'member' },
      sourceType: 'TEXT',
      status: 'PROPOSED',
      version: 1,
      originalHash: response.body.proposalHash,
      sourceConversation: { familyId, userId: memberId, type: 'chat' },
    });
    expect(proposal.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(proposal.items).toEqual([expect.objectContaining({
      ordinal: 0,
      typedAction: 'create_expense',
      canonicalData: actions[0].data,
    })]);
  });

  test('persists an OCR proposal with its conversation and leaves financial facts unchanged', async () => {
    (parseReceiptOCR as jest.Mock).mockResolvedValue({
      amount: 35,
      category: '餐饮',
      description: '早餐',
      date: '2026-09-01',
      source: 'tesseract',
    });
    const actions = [{
      type: 'create_expense' as const,
      data: { amount: 35, category: '餐饮', description: '早餐', date: '2026-09-01' },
    }];
    (ocrToActions as jest.Mock).mockReturnValue(actions);
    (storeOcrImage as jest.Mock).mockResolvedValue(null);
    const before = await financialCounts();

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/ocr`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ image: 'test-image-data' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      proposedActions: actions,
      fileId: null,
      proposalVersion: 1,
      proposalHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      proposalExpiresAt: expect.any(String),
    });
    expect(await financialCounts()).toEqual(before);

    const proposal = await prisma.aiProposal.findUniqueOrThrow({
      where: { id: response.body.proposalId },
      include: { items: true, sourceConversation: true },
    });
    expect(proposal).toMatchObject({
      familyId,
      actorUserId: memberId,
      sourceType: 'OCR',
      sourceFileId: null,
      sourceConversation: { familyId, userId: memberId, type: 'ocr' },
    });
    expect(proposal.items).toHaveLength(1);
  });

  test('confirms a server-owned text proposal through HTTP and replays without a duplicate Income', async () => {
    const actions = [{
      type: 'create_income' as const,
      data: { amount: 125, category: '工资', description: 'AI confirm', date: '2026-09-01' },
    }];
    (chatWithActions as jest.Mock).mockResolvedValue({ reply: '请确认', actions });

    const proposalResponse = await request(app)
      .post(`/api/families/${familyId}/ai/chat`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: '记录工资125元' });
    const confirmationBody = {
      expectedVersion: proposalResponse.body.proposalVersion,
      expectedHash: proposalResponse.body.proposalHash,
      actions,
    };

    const first = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposalResponse.body.proposalId}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-confirm-http-1')
      .send(confirmationBody);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      resourceId: proposalResponse.body.proposalId,
      record: { status: 'EXECUTED', version: 3 },
      deduplicated: false,
    });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);

    const replay = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposalResponse.body.proposalId}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-confirm-http-1')
      .send(confirmationBody);

    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
  });

  test('rejects viewer confirmation before proposal lookup and ledger mutation', async () => {
    const actions = [{
      type: 'create_expense' as const,
      data: { amount: 25, category: '餐饮', date: '2026-09-01' },
    }];
    (chatWithActions as jest.Mock).mockResolvedValue({ reply: '请确认', actions });
    const proposalResponse = await request(app)
      .post(`/api/families/${familyId}/ai/chat`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: '午餐25元' });

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposalResponse.body.proposalId}/confirm`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('Idempotency-Key', 'ai-confirm-viewer')
      .send({
        expectedVersion: proposalResponse.body.proposalVersion,
        expectedHash: proposalResponse.body.proposalHash,
        actions,
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: '无权修改该家庭数据' });
    await expect(prisma.expense.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(0);
  });

  test('rejects an AI asset proposal because Balance mutation is not yet transactionally adopted', async () => {
    const actions = [{
      type: 'create_asset' as const,
      data: { name: '基金', type: 'FUND', value: 1000 },
    }];
    (chatWithActions as jest.Mock).mockResolvedValue({ reply: '请确认资产', actions });
    const proposalResponse = await request(app)
      .post(`/api/families/${familyId}/ai/chat`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: '我有1000元基金' });

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposalResponse.body.proposalId}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-confirm-asset')
      .send({
        expectedVersion: proposalResponse.body.proposalVersion,
        expectedHash: proposalResponse.body.proposalHash,
        actions,
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'AI_BALANCE_MUTATION_UNAVAILABLE' });
    await expect(prisma.asset.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(0);
  });

  test.each([
    ['viewer', viewerToken],
    ['non-member', outsiderToken],
  ])('rejects %s before AI execution and proposal or financial persistence', async (_label, token) => {
    (chatWithActions as jest.Mock).mockResolvedValue({
      reply: '不应执行',
      actions: [{ type: 'create_expense', data: { amount: 99, category: '餐饮' } }],
    });
    const before = await financialCounts();

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/chat`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: '记录一笔支出' });

    expect(response.status).toBe(403);
    expect(await financialCounts()).toEqual(before);
    await expect(prisma.aiProposal.count({ where: { familyId } })).resolves.toBe(0);
    expect(chatWithActions).not.toHaveBeenCalled();
  });
});
