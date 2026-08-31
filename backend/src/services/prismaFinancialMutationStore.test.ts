import { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaFinancialMutationStore } from './prismaFinancialMutationStore';

const persistedRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'operation-1',
  familyId: 'family-1',
  actorScope: 'USER:user-1',
  operation: 'CREATE_INCOME',
  key: 'request-1',
  payloadHash: 'a'.repeat(64),
  httpStatus: null,
  responseJson: null,
  ...overrides,
});

const ledgerRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'ledger-1',
  version: 1,
  familyId: 'family-1',
  createdBy: 'user-1',
  category: 'SALARY',
  amount: new Prisma.Decimal('123.45'),
  description: null,
  source: null,
  paymentMethod: null,
  date: new Date('2026-08-31T00:00:00.000Z'),
  currency: 'CNY',
  originType: 'MANUAL',
  originRef: null,
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  updatedAt: new Date('2026-08-31T00:00:00.000Z'),
  ...overrides,
});

const createClient = () => {
  const transaction = {
    familyMember: {
      findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async () => persistedRecord()),
      create: jest.fn(async ({ data }) => persistedRecord(data)),
      update: jest.fn(async ({ data }) => persistedRecord(data)),
    },
    income: { create: jest.fn(async () => ledgerRecord()) },
    expense: { create: jest.fn(async () => ledgerRecord({ id: 'expense-1', paymentMethod: 'CARD' })) },
    auditEvent: { create: jest.fn(async ({ data }) => ({ id: 'audit-1', ...data })) },
  };
  const client = {
    $transaction: jest.fn(async (work) => work(transaction)),
    familyMember: {
      findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async () => persistedRecord()),
    },
  } as unknown as PrismaClient;

  return { client, transaction };
};

describe('Prisma financial mutation store', () => {
  test('serializes a replay result without losing dates, nulls, or tenant operation scope', async () => {
    const { client, transaction } = createClient();
    const store = createPrismaFinancialMutationStore(client);
    const createdAt = new Date('2026-08-31T12:00:00.000Z');

    const result = await store.$transaction((tx) => tx.idempotencyRecord.update({
      where: { id: 'operation-1' },
      data: {
        httpStatus: 201,
        responseJson: {
          createdAt,
          nullable: null,
          nested: [{ appliedAt: createdAt }],
          omitted: undefined,
        },
      },
    }));

    expect(transaction.idempotencyRecord.update).toHaveBeenCalledWith({
      where: { id: 'operation-1' },
      data: {
        httpStatus: 201,
        responseJson: {
          createdAt: '2026-08-31T12:00:00.000Z',
          nullable: null,
          nested: [{ appliedAt: '2026-08-31T12:00:00.000Z' }],
        },
      },
    });
    expect(result).toMatchObject({
      familyId: 'family-1',
      actorScope: 'USER:user-1',
      operation: 'CREATE_INCOME',
      httpStatus: 201,
    });
  });

  test('persists audit JSON with database null semantics and converts ledger decimals to numbers', async () => {
    const { client, transaction } = createClient();
    const store = createPrismaFinancialMutationStore(client);
    const recordedAt = new Date('2026-08-31T12:00:00.000Z');

    const result = await store.$transaction(async (tx) => {
      await tx.auditEvent.create({
        data: {
          familyId: 'family-1',
          mutationId: 'operation-1',
          actorUserId: 'user-1',
          actorSnapshot: { authenticatedAt: recordedAt },
          action: 'CREATE',
          entity: 'Income',
          entityId: 'ledger-1',
          before: null,
          after: { recordedAt, nullable: null, omitted: undefined },
        },
      });
      return {
        income: await tx.income.create({
          data: {
            familyId: 'family-1',
            createdBy: 'user-1',
            category: 'SALARY',
            amount: 123.45,
            date: recordedAt,
            currency: 'CNY',
            originType: 'MANUAL',
          },
        }),
        expense: await tx.expense.create({
          data: {
            familyId: 'family-1',
            createdBy: 'user-1',
            category: 'FOOD',
            amount: 45.67,
            date: recordedAt,
            currency: 'CNY',
            originType: 'MANUAL',
          },
        }),
      };
    });

    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorSnapshot: { authenticatedAt: '2026-08-31T12:00:00.000Z' },
        before: Prisma.DbNull,
        after: { recordedAt: '2026-08-31T12:00:00.000Z', nullable: null },
      }),
    });
    expect(result.income).toMatchObject({ id: 'ledger-1', amount: 123.45 });
    expect(result.expense).toMatchObject({ id: 'expense-1', amount: 123.45 });
  });

  test('rejects unsupported or invalid JSON before the persistence adapter writes it', async () => {
    const { client, transaction } = createClient();
    const store = createPrismaFinancialMutationStore(client);

    await expect(store.$transaction((tx) => tx.idempotencyRecord.update({
      where: { id: 'operation-1' },
      data: { httpStatus: 201, responseJson: { createdAt: new Date('invalid') } },
    }))).rejects.toThrow('Mutation JSON contains invalid date');
    await expect(store.$transaction((tx) => tx.idempotencyRecord.update({
      where: { id: 'operation-1' },
      data: { httpStatus: 201, responseJson: { nonJson: () => undefined } },
    }))).rejects.toThrow('Mutation JSON contains unsupported value');
    await expect(store.$transaction((tx) => tx.idempotencyRecord.update({
      where: { id: 'operation-1' },
      data: { httpStatus: 201, responseJson: { values: [undefined] } },
    }))).rejects.toThrow('Mutation JSON contains unsupported value');

    expect(transaction.idempotencyRecord.update).not.toHaveBeenCalled();
  });

  test.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s before the persistence adapter writes it', async (_label, invalidNumber) => {
    const { client, transaction } = createClient();
    const store = createPrismaFinancialMutationStore(client);

    await expect(store.$transaction((tx) => tx.idempotencyRecord.update({
      where: { id: 'operation-1' },
      data: { httpStatus: 201, responseJson: { amount: invalidNumber } },
    }))).rejects.toThrow('Mutation JSON contains non-finite number');

    expect(transaction.idempotencyRecord.update).not.toHaveBeenCalled();
  });

  test('maps root snapshots and rejects an operation that is outside the coordinator contract', async () => {
    const { client } = createClient();
    const store = createPrismaFinancialMutationStore(client);

    await expect(store.idempotencyRecord?.findUnique({
      where: {
        familyId_actorScope_operation_key: {
          familyId: 'family-1',
          actorScope: 'USER:user-1',
          operation: 'CREATE_INCOME',
          key: 'request-1',
        },
      },
    })).resolves.toMatchObject({ operation: 'CREATE_INCOME' });

    (client.idempotencyRecord.findUnique as jest.Mock).mockResolvedValueOnce(persistedRecord({ operation: 'UNKNOWN' }));
    await expect(store.idempotencyRecord?.findUnique({
      where: {
        familyId_actorScope_operation_key: {
          familyId: 'family-1',
          actorScope: 'USER:user-1',
          operation: 'CREATE_INCOME',
          key: 'request-1',
        },
      },
    })).rejects.toThrow('Unsupported persisted mutation operation: UNKNOWN');
  });
});
