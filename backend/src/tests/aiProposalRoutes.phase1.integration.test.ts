import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import aiRoutes from '../routes/ai';
import { hashNormalizedPayload } from '../services/financialMutationCoordinator';

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
const foreignFamilyId = `p1-ai-route-foreign-family-${runId}`;
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

const financialCountsFor = async (targetFamilyId: string) => Promise.all([
  prisma.income.count({ where: { familyId: targetFamilyId } }),
  prisma.expense.count({ where: { familyId: targetFamilyId } }),
  prisma.asset.count({ where: { familyId: targetFamilyId } }),
  prisma.liability.count({ where: { familyId: targetFamilyId } }),
]);

const createStoredProposal = async (
  targetFamilyId: string,
  actions: Array<{ type: string; data: Record<string, unknown> }>,
): Promise<any> => {
  const originalPayload = { reply: '请确认', actions };
  return prisma.aiProposal.create({
    data: {
      familyId: targetFamilyId,
      actorUserId: memberId,
      actorSnapshot: { version: 1, userId: memberId, role: 'member' },
      sourceType: 'TEXT',
      originalPayload: originalPayload as any,
      originalHash: hashNormalizedPayload(originalPayload),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      items: {
        create: actions.map((action, ordinal) => ({
          ordinal,
          typedAction: action.type,
          canonicalData: action.data as any,
        })),
      },
    },
    include: { items: true },
  });
};

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
    await prisma.family.create({
      data: {
        id: foreignFamilyId,
        name: 'AI foreign family',
        members: { create: [{ userId: memberId, role: 'member' }] },
      },
    });
  });

  afterEach(async () => {
    const familyIds = { in: [familyId, foreignFamilyId] };
    await prisma.aiProposal.deleteMany({ where: { familyId: familyIds } });
    await prisma.aiConversation.deleteMany({ where: { familyId: familyIds } });
    await prisma.auditEvent.deleteMany({ where: { familyId: familyIds } });
    await prisma.idempotencyRecord.deleteMany({ where: { familyId: familyIds } });
    await prisma.income.deleteMany({ where: { familyId: familyIds } });
    await prisma.expense.deleteMany({ where: { familyId: familyIds } });
    await prisma.asset.deleteMany({ where: { familyId: familyIds } });
    await prisma.liability.deleteMany({ where: { familyId: familyIds } });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.family.deleteMany({ where: { id: foreignFamilyId } });
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

  test('returns pending proposal metadata from history for refresh recovery', async () => {
    const actions = [{
      type: 'create_expense' as const,
      data: { amount: 25, category: '餐饮', date: '2026-09-01' },
    }];
    (chatWithActions as jest.Mock).mockResolvedValue({ reply: '请确认', actions });

    const created = await request(app)
      .post(`/api/families/${familyId}/ai/chat`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ content: '午餐25元' });

    const response = await request(app)
      .get(`/api/families/${familyId}/ai/history`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: '午餐25元',
        proposal: {
          id: created.body.proposalId,
          version: 1,
          originalHash: created.body.proposalHash,
          status: 'PROPOSED',
          expiresAt: expect.any(String),
          items: [{
            proposalItemId: expect.any(String),
            type: 'create_expense',
            data: actions[0].data,
          }],
        },
      }),
    ]));
  });

  test('returns an executed proposal result from history without making it confirmable again', async () => {
    const action = { type: 'create_income' as const, data: { amount: 425, category: '工资' } };
    const proposal = await createStoredProposal(familyId, [action]);
    const conversation = await prisma.aiConversation.create({
      data: {
        familyId,
        userId: memberId,
        content: '工资425元',
        response: '请确认',
        type: 'chat',
      },
    });
    await prisma.aiProposal.update({
      where: { id: proposal.id },
      data: { sourceConversationId: conversation.id },
    });
    await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposal.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-history-executed')
      .send({ expectedVersion: proposal.version, expectedHash: proposal.originalHash, actions: [action] })
      .expect(200);

    const response = await request(app)
      .get(`/api/families/${familyId}/ai/history`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        proposal: expect.objectContaining({
          id: proposal.id,
          status: 'EXECUTED',
          result: expect.objectContaining({
            proposalId: proposal.id,
            status: 'EXECUTED',
            actions: expect.arrayContaining([expect.objectContaining({ resourceId: expect.any(String) })]),
          }),
        }),
      }),
    ]));

    const secondConfirmation = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposal.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-history-executed-second')
      .send({ expectedVersion: proposal.version, expectedHash: proposal.originalHash, actions: [action] });

    expect(secondConfirmation.status).toBe(409);
    expect(secondConfirmation.body).toMatchObject({ code: 'AI_PROPOSAL_NOT_CONFIRMABLE' });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
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

  test('confirms an AI asset proposal through the transaction-scoped Balance mutation path', async () => {
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

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      record: {
        status: 'EXECUTED',
        actions: [{ type: 'create_asset', resourceId: expect.any(String) }],
      },
      deduplicated: false,
    });
    await expect(prisma.asset.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);

    const replay = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposalResponse.body.proposalId}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-confirm-asset')
      .send({
        expectedVersion: proposalResponse.body.proposalVersion,
        expectedHash: proposalResponse.body.proposalHash,
        actions,
      });

    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await expect(prisma.asset.count({ where: { familyId } })).resolves.toBe(1);
  });

  test.each<[string, { amount?: number; date?: string; type?: string }]>([
    ['zero amount', { amount: 0 }],
    ['invalid date', { date: '2026-02-30' }],
    ['unsupported action type', { type: 'transfer_money' }],
  ])('rejects a malformed final action (%s) without claiming the proposal', async (_label, change) => {
    const action = { type: 'create_expense', data: { amount: 35, category: '餐饮', date: '2026-09-01' } };
    const proposal = await createStoredProposal(familyId, [action]);
    const finalAction = {
      ...action,
      ...(change.type ? { type: change.type } : {}),
      data: { ...action.data, ...(change.amount !== undefined ? { amount: change.amount } : {}), ...(change.date ? { date: change.date } : {}) },
    };

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposal.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', `ai-malformed-${_label}`)
      .send({ expectedVersion: proposal.version, expectedHash: proposal.originalHash, actions: [finalAction] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(financialCounts()).resolves.toEqual([0, 0, 0, 0]);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.aiProposal.findUnique({ where: { id: proposal.id } }))
      .resolves.toMatchObject({ status: 'PROPOSED', version: 1 });
  });

  test('rejects duplicate and unknown proposal item ids without a ledger side effect', async () => {
    const first = await createStoredProposal(familyId, [
      { type: 'create_income', data: { amount: 100, category: '工资' } },
      { type: 'create_income', data: { amount: 200, category: '奖金' } },
    ]);
    const duplicateItemActions = first.items.map((item: { id: string }, index: number) => ({
      proposalItemId: index === 0 ? first.items[0].id : first.items[0].id,
      type: 'create_income',
      data: { amount: index === 0 ? 100 : 200, category: index === 0 ? '工资' : '奖金' },
    }));

    const duplicate = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${first.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-duplicate-item')
      .send({ expectedVersion: first.version, expectedHash: first.originalHash, actions: duplicateItemActions });

    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toMatchObject({ code: 'VALIDATION_FAILED' });

    const second = await createStoredProposal(familyId, [
      { type: 'create_income', data: { amount: 300, category: '奖金' } },
    ]);
    const unknown = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${second.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-unknown-item')
      .send({
        expectedVersion: second.version,
        expectedHash: second.originalHash,
        actions: [{ proposalItemId: 'item-from-another-proposal', type: 'create_income', data: { amount: 300, category: '奖金' } }],
      });

    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(financialCounts()).resolves.toEqual([0, 0, 0, 0]);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
  });

  test('rejects a cross-family proposal id before reading or mutating either family', async () => {
    const foreignProposal = await createStoredProposal(foreignFamilyId, [
      { type: 'create_income', data: { amount: 500, category: '跨家庭' } },
    ]);
    const beforePrimary = await financialCountsFor(familyId);
    const beforeForeign = await financialCountsFor(foreignFamilyId);

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${foreignProposal.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-cross-family')
      .send({
        expectedVersion: foreignProposal.version,
        expectedHash: foreignProposal.originalHash,
        actions: [{ type: 'create_income', data: { amount: 500, category: '跨家庭' } }],
      });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(financialCountsFor(familyId)).resolves.toEqual(beforePrimary);
    await expect(financialCountsFor(foreignFamilyId)).resolves.toEqual(beforeForeign);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.idempotencyRecord.count({ where: { familyId: foreignFamilyId } })).resolves.toBe(0);
  });

  test('requires an idempotency key and leaves the proposal untouched when it is missing', async () => {
    const proposal = await createStoredProposal(familyId, [
      { type: 'create_income', data: { amount: 750, category: '工资' } },
    ]);

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposal.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        expectedVersion: proposal.version,
        expectedHash: proposal.originalHash,
        actions: [{ type: 'create_income', data: { amount: 750, category: '工资' } }],
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(financialCounts()).resolves.toEqual([0, 0, 0, 0]);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.aiProposal.findUnique({ where: { id: proposal.id } }))
      .resolves.toMatchObject({ status: 'PROPOSED', version: 1 });
  });

  test('rejects a different payload on the same confirmation key without a second ledger fact', async () => {
    const proposal = await createStoredProposal(familyId, [
      { type: 'create_income', data: { amount: 800, category: '工资' } },
    ]);
    const confirmationUrl = `/api/families/${familyId}/ai/proposals/${proposal.id}/confirm`;
    const headers = { Authorization: `Bearer ${memberToken}`, 'Idempotency-Key': 'ai-replay-tamper' };

    const first = await request(app)
      .post(confirmationUrl)
      .set(headers)
      .send({
        expectedVersion: proposal.version,
        expectedHash: proposal.originalHash,
        actions: [{ type: 'create_income', data: { amount: 800, category: '工资' } }],
      });
    expect(first.status).toBe(200);

    const replayWithDifferentPayload = await request(app)
      .post(confirmationUrl)
      .set(headers)
      .send({
        expectedVersion: proposal.version,
        expectedHash: proposal.originalHash,
        actions: [{ type: 'create_income', data: { amount: 801, category: '篡改' } }],
      });

    expect(replayWithDifferentPayload.status).toBe(409);
    expect(replayWithDifferentPayload.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
  });

  test('rejects a second key after the proposal is executed without adding another fact', async () => {
    const proposal = await createStoredProposal(familyId, [
      { type: 'create_income', data: { amount: 900, category: '奖金' } },
    ]);
    const body = {
      expectedVersion: proposal.version,
      expectedHash: proposal.originalHash,
      actions: [{ type: 'create_income', data: { amount: 900, category: '奖金' } }],
    };
    await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposal.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-executed-first')
      .send(body)
      .expect(200);

    const response = await request(app)
      .post(`/api/families/${familyId}/ai/proposals/${proposal.id}/confirm`)
      .set('Authorization', `Bearer ${memberToken}`)
      .set('Idempotency-Key', 'ai-executed-second')
      .send(body);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'AI_PROPOSAL_NOT_CONFIRMABLE' });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
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
