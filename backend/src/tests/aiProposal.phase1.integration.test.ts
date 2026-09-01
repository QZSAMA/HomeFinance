import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `p1-ai-user-${runId}`;
const familyId = `p1-ai-family-${runId}`;

describe('Phase 1 real PostgreSQL AI proposal persistence contracts', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${runId}@example.test`,
        passwordHash: 'integration-only',
        name: 'AI Proposal Integration',
      },
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'AI Proposal Integration Family',
        members: { create: { userId, role: 'admin' } },
      },
    });
  });

  afterAll(async () => {
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('persists original payload and ordered typed actions under one family-owned proposal', async () => {
    const originalPayload = {
      provider: 'test-fixture',
      actions: [{ type: 'create_expense', amount: '25.00', category: 'FOOD' }],
    };
    const proposal = await prisma.aiProposal.create({
      data: {
        familyId,
        actorUserId: userId,
        actorSnapshot: { userId, role: 'admin' },
        sourceType: 'TEXT',
        originalPayload,
        originalHash: 'a'.repeat(64),
        expiresAt: new Date('2026-09-02T00:00:00.000Z'),
        items: {
          create: [
            {
              ordinal: 0,
              typedAction: 'create_expense',
              canonicalData: { amount: '25.00', category: 'FOOD' },
            },
          ],
        },
      },
      include: { items: true },
    });

    expect(proposal).toMatchObject({
      familyId,
      actorUserId: userId,
      status: 'PROPOSED',
      version: 1,
      originalPayload,
      originalHash: 'a'.repeat(64),
      confirmedPayload: null,
      confirmedHash: null,
    });
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0]).toMatchObject({
      ordinal: 0,
      typedAction: 'create_expense',
    });
  });

  test('enforces proposal item ordering and invalid proposal metadata at the database boundary', async () => {
    const proposal = await prisma.aiProposal.create({
      data: {
        familyId,
        actorUserId: userId,
        actorSnapshot: { userId, role: 'admin' },
        sourceType: 'OCR',
        originalPayload: { actions: [] },
        originalHash: 'b'.repeat(64),
        expiresAt: new Date('2026-09-02T00:00:00.000Z'),
      },
    });

    await prisma.aiProposalItem.create({
      data: {
        proposalId: proposal.id,
        ordinal: 0,
        typedAction: 'create_income',
        canonicalData: { amount: '100.00', category: 'SALARY' },
      },
    });
    await expect(prisma.aiProposalItem.create({
      data: {
        proposalId: proposal.id,
        ordinal: 0,
        typedAction: 'create_income',
        canonicalData: { amount: '100.00', category: 'SALARY' },
      },
    })).rejects.toMatchObject({ code: 'P2002' });

    await expect(prisma.aiProposal.create({
      data: {
        familyId,
        actorUserId: userId,
        actorSnapshot: { userId, role: 'admin' },
        sourceType: 'TEXT',
        originalPayload: { actions: [] },
        originalHash: 'not-a-sha256',
        expiresAt: new Date('2026-09-02T00:00:00.000Z'),
      },
    })).rejects.toThrow();

    await expect(prisma.aiProposal.update({
      where: { id: proposal.id },
      data: { version: 0 },
    })).rejects.toThrow();
  });

  test('cascades proposal items when the owning family is deleted', async () => {
    const disposableFamilyId = `p1-ai-cascade-family-${runId}`;
    await prisma.family.create({
      data: {
        id: disposableFamilyId,
        name: 'AI Proposal Cascade Family',
        members: { create: { userId, role: 'admin' } },
      },
    });
    const proposal = await prisma.aiProposal.create({
      data: {
        familyId: disposableFamilyId,
        actorUserId: userId,
        actorSnapshot: { userId, role: 'admin' },
        sourceType: 'TEXT',
        originalPayload: { actions: [] },
        originalHash: 'c'.repeat(64),
        expiresAt: new Date('2026-09-02T00:00:00.000Z'),
        items: { create: [{ ordinal: 0, typedAction: 'create_asset', canonicalData: {} }] },
      },
    });

    await prisma.family.delete({ where: { id: disposableFamilyId } });

    await expect(prisma.aiProposal.findUnique({ where: { id: proposal.id } })).resolves.toBeNull();
    await expect(prisma.aiProposalItem.count({ where: { proposalId: proposal.id } })).resolves.toBe(0);
  });
});
