import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `phase1-user-${runId}`;
const familyId = `phase1-family-${runId}`;

describe('Phase 1 PostgreSQL ledger contracts', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: `phase1-${runId}@example.test`,
        passwordHash: 'integration-only',
        name: 'Phase 1 Integration',
      },
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Phase 1 Integration Family',
        members: {
          create: {
            userId,
            role: 'admin',
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { familyId } });
    await prisma.idempotencyRecord.deleteMany({ where: { familyId } });
    await prisma.income.deleteMany({ where: { familyId } });
    await prisma.expense.deleteMany({ where: { familyId } });
    await prisma.recurringTransaction.deleteMany({ where: { familyId } });
    await prisma.familyMember.deleteMany({ where: { familyId } });
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('lets PostgreSQL arbitrate one idempotency scope row', async () => {
    const scope = {
      familyId,
      actorScope: `USER:${userId}`,
      operation: 'CREATE_INCOME',
      key: 'phase1-integration-key',
      payloadHash: 'a'.repeat(64),
    };

    await prisma.idempotencyRecord.create({ data: scope });

    await expect(prisma.idempotencyRecord.create({ data: scope })).rejects.toMatchObject({
      code: 'P2002',
    });
    await expect(prisma.idempotencyRecord.count({ where: scope })).resolves.toBe(1);
  });

  test('applies additive defaults to legacy-compatible writes', async () => {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId } });
    const income = await prisma.income.create({
      data: {
        familyId,
        createdBy: userId,
        category: 'SALARY',
        amount: new Prisma.Decimal('100.00'),
        date: new Date('2026-08-28T00:00:00.000Z'),
      },
    });
    const expense = await prisma.expense.create({
      data: {
        familyId,
        createdBy: userId,
        category: 'FOOD',
        amount: new Prisma.Decimal('10.00'),
        date: new Date('2026-08-28T01:00:00.000Z'),
      },
    });

    expect(family.baseCurrency).toBe('CNY');
    expect(income).toMatchObject({ version: 1, currency: 'CNY' });
    expect(expense).toMatchObject({ version: 1, currency: 'CNY' });
  });

  test('allows only one update for the same expected version', async () => {
    const income = await prisma.income.create({
      data: {
        familyId,
        createdBy: userId,
        category: 'BONUS',
        amount: new Prisma.Decimal('50.00'),
        date: new Date('2026-08-28T02:00:00.000Z'),
      },
    });

    const first = await prisma.income.updateMany({
      where: { id: income.id, familyId, version: 1 },
      data: {
        amount: new Prisma.Decimal('55.00'),
        version: { increment: 1 },
      },
    });
    const stale = await prisma.income.updateMany({
      where: { id: income.id, familyId, version: 1 },
      data: {
        amount: new Prisma.Decimal('60.00'),
        version: { increment: 1 },
      },
    });

    expect(first.count).toBe(1);
    expect(stale.count).toBe(0);
    await expect(prisma.income.findUniqueOrThrow({ where: { id: income.id } })).resolves
      .toMatchObject({ version: 2 });
  });
});
