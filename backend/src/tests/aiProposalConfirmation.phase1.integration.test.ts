import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { confirmAiProposal } from '../services/aiProposalConfirmationService';
import { hashNormalizedPayload } from '../services/financialMutationCoordinator';
import { createPrismaFinancialMutationStore } from '../services/prismaFinancialMutationStore';

const prisma = new PrismaClient();
const runId = randomUUID();
const memberId = `p1-ai-confirm-member-${runId}`;
const viewerId = `p1-ai-confirm-viewer-${runId}`;
const outsiderId = `p1-ai-confirm-outsider-${runId}`;

const action = {
  type: 'create_income' as const,
  data: { amount: 125, category: '工资', description: 'AI confirm', date: '2026-09-01' },
};

const balanceActions = [
  {
    type: 'create_asset' as const,
    data: {
      name: 'Index fund',
      type: 'FUND',
      value: 1234.56,
      costBasis: 1000,
      currency: 'CNY',
      purchaseDate: '2026-08-01',
      description: 'AI asset',
    },
  },
  {
    type: 'create_liability' as const,
    data: {
      name: 'Mortgage',
      type: 'MORTGAGE',
      amount: 4567.89,
      interestRate: 0.0325,
      currency: 'CNY',
      startDate: '2026-08-01',
      description: 'AI liability',
    },
  },
];

const createProposal = async (familyId: string, expiresAt = new Date('2026-09-02T00:00:00.000Z')) => {
  const originalPayload = { reply: '请确认', actions: [action] };
  return prisma.aiProposal.create({
    data: {
      familyId,
      actorUserId: memberId,
      actorSnapshot: { version: 1, userId: memberId, role: 'member' },
      sourceType: 'TEXT',
      originalPayload,
      originalHash: hashNormalizedPayload(originalPayload),
      expiresAt,
      items: {
        create: [{
          ordinal: 0,
          typedAction: action.type,
          canonicalData: action.data,
        }],
      },
    },
    include: { items: true },
  });
};

const createBalanceProposal = async (
  familyId: string,
  expiresAt = new Date('2026-09-02T00:00:00.000Z'),
) => {
  const originalPayload = { reply: '请确认资产和负债', actions: balanceActions };
  return prisma.aiProposal.create({
    data: {
      familyId,
      actorUserId: memberId,
      actorSnapshot: { version: 1, userId: memberId, role: 'member' },
      sourceType: 'TEXT',
      originalPayload,
      originalHash: hashNormalizedPayload(originalPayload),
      expiresAt,
      items: {
        create: balanceActions.map((balanceAction, ordinal) => ({
          ordinal,
          typedAction: balanceAction.type,
          canonicalData: balanceAction.data,
        })),
      },
    },
    include: { items: true },
  });
};

const confirmationFor = (familyId: string, proposal: { id: string; originalHash: string }, actorUserId = memberId, idempotencyKey = 'confirm-1') => ({
  familyId,
  actorUserId,
  proposalId: proposal.id,
  expectedVersion: 1,
  expectedHash: proposal.originalHash,
  idempotencyKey,
  actions: [action],
  now: new Date('2026-09-01T12:00:00.000Z'),
});

const balanceConfirmationFor = (
  familyId: string,
  proposal: { id: string; originalHash: string },
  idempotencyKey = 'balance-confirm-1',
) => ({
  familyId,
  actorUserId: memberId,
  proposalId: proposal.id,
  expectedVersion: 1,
  expectedHash: proposal.originalHash,
  idempotencyKey,
  actions: balanceActions,
  now: new Date('2026-09-01T12:00:00.000Z'),
});

describe('Phase 1 real PostgreSQL AI proposal confirmation', () => {
  let familyId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        { id: memberId, email: `${memberId}@example.test`, passwordHash: 'test', name: 'AI confirmer' },
        { id: viewerId, email: `${viewerId}@example.test`, passwordHash: 'test', name: 'AI viewer' },
        { id: outsiderId, email: `${outsiderId}@example.test`, passwordHash: 'test', name: 'AI outsider' },
      ],
    });
  });

  beforeEach(async () => {
    familyId = `p1-ai-confirm-family-${randomUUID()}`;
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'AI confirmation family',
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
    await prisma.family.delete({ where: { id: familyId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [memberId, viewerId, outsiderId] } } });
    await prisma.$disconnect();
  });

  test('commits the proposal, Income, item result, audit and idempotency result together', async () => {
    const proposal = await createProposal(familyId);
    const store = createPrismaFinancialMutationStore(prisma);

    const result = await confirmAiProposal(confirmationFor(familyId, proposal), store);

    expect(result).toMatchObject({
      operationId: expect.any(String),
      resourceId: proposal.id,
      version: 3,
      deduplicated: false,
      record: { proposalId: proposal.id, status: 'EXECUTED', version: 3 },
    });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.aiProposal.findUnique({ where: { id: proposal.id }, include: { items: true } }))
      .resolves.toMatchObject({
        status: 'EXECUTED',
        version: 3,
        confirmedHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        items: [expect.objectContaining({ resultJson: expect.objectContaining({ resourceId: expect.any(String) }) })],
      });
  });

  test('replays the same confirmation without creating another financial fact', async () => {
    const proposal = await createProposal(familyId);
    const store = createPrismaFinancialMutationStore(prisma);
    const input = confirmationFor(familyId, proposal);

    const first = await confirmAiProposal(input, store);
    const replay = await confirmAiProposal(input, store);

    expect(replay).toEqual({ ...first, deduplicated: true });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);
  });

  test('commits Asset and Liability confirmation facts with proposal, audit and idempotency atomically', async () => {
    const proposal = await createBalanceProposal(familyId);
    const store = createPrismaFinancialMutationStore(prisma);

    const result = await confirmAiProposal(balanceConfirmationFor(familyId, proposal), store);

    expect(result.record).toMatchObject({
      proposalId: proposal.id,
      status: 'EXECUTED',
      version: 3,
      actions: [
        { type: 'create_asset', resourceId: expect.any(String) },
        { type: 'create_liability', resourceId: expect.any(String) },
      ],
    });
    await expect(prisma.asset.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.liability.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
    const persistedProposal = await prisma.aiProposal.findUnique({ where: { id: proposal.id }, include: { items: true } });
    expect(persistedProposal).toMatchObject({ status: 'EXECUTED', version: 3 });
    expect(persistedProposal?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ resultJson: expect.objectContaining({ type: 'create_asset' }) }),
      expect.objectContaining({ resultJson: expect.objectContaining({ type: 'create_liability' }) }),
    ]));
  });

  test('rolls back balance facts and confirmation metadata when the transaction callback fails', async () => {
    const proposal = await createBalanceProposal(familyId);
    const failingClient = {
      $transaction: (work: (transaction: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<unknown>) => (
        prisma.$transaction(async (transaction) => {
          await work(transaction);
          throw new Error('injected balance confirmation failure');
        })
      ),
    } as unknown as PrismaClient;
    const store = createPrismaFinancialMutationStore(failingClient);

    await expect(confirmAiProposal(balanceConfirmationFor(familyId, proposal), store))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(prisma.asset.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.liability.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.aiProposal.findUnique({ where: { id: proposal.id } }))
      .resolves.toMatchObject({ status: 'PROPOSED', version: 1 });
  });

  test('allows only one of two different keys to claim one proposal occurrence', async () => {
    const proposal = await createProposal(familyId);
    const store = createPrismaFinancialMutationStore(prisma);

    const outcomes = await Promise.allSettled([
      confirmAiProposal(confirmationFor(familyId, proposal, memberId, 'confirm-a'), store),
      confirmAiProposal(confirmationFor(familyId, proposal, memberId, 'confirm-b'), store),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(1);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(1);
  });

  test.each([
    ['viewer', viewerId],
    ['non-member', outsiderId],
  ])('rejects %s before proposal lookup or any persisted mutation', async (_label, actorUserId) => {
    const proposal = await createProposal(familyId);
    const store = createPrismaFinancialMutationStore(prisma);

    await expect(confirmAiProposal(confirmationFor(familyId, proposal, actorUserId, `denied-${actorUserId}`), store))
      .rejects.toMatchObject({ code: 'FAMILY_WRITE_FORBIDDEN', status: 403 });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.auditEvent.count({ where: { familyId } })).resolves.toBe(0);
  });

  test('rejects an expired proposal before claim and ledger mutation', async () => {
    const proposal = await createProposal(familyId, new Date('2026-09-01T11:59:59.000Z'));
    const store = createPrismaFinancialMutationStore(prisma);

    await expect(confirmAiProposal(confirmationFor(familyId, proposal), store))
      .rejects.toMatchObject({ code: 'AI_PROPOSAL_EXPIRED', status: 409 });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.idempotencyRecord.count({ where: { familyId } })).resolves.toBe(0);
    await expect(prisma.aiProposal.findUnique({ where: { id: proposal.id } }))
      .resolves.toMatchObject({ status: 'PROPOSED', version: 1 });
  });
});
