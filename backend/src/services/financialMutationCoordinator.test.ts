import {
  coordinateFinancialMutation,
  hashNormalizedPayload,
} from './financialMutationCoordinator';
import { mapPrismaError } from './ledgerErrors';
import {
  CoordinateFinancialMutationInput,
  FinancialMutationStore,
  IdempotencyRecordSnapshot,
  LedgerTransactionClient,
} from './ledgerTypes';

const createCoordinatorStore = () => {
  const idempotencyRecords = new Map<string, IdempotencyRecordSnapshot>();
  const transaction: LedgerTransactionClient = {
    familyMember: {
      findUnique: jest.fn(async () => ({
        familyId: 'family-1',
        userId: 'user-1',
        role: 'member',
      })),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async ({ where }) => idempotencyRecords.get(
        JSON.stringify(where.familyId_actorScope_operation_key),
      ) ?? null),
      create: jest.fn(async ({ data }) => {
        const record: IdempotencyRecordSnapshot = {
          ...data,
          httpStatus: null,
          responseJson: null,
        };
        idempotencyRecords.set(
          JSON.stringify({
            familyId: data.familyId,
            actorScope: data.actorScope,
            operation: data.operation,
            key: data.key,
          }),
          record,
        );
        return record;
      }),
      update: jest.fn(async ({ where, data }) => {
        const record = [...idempotencyRecords.values()].find(
          (candidate) => candidate.id === where.id,
        );
        if (!record) throw new Error('missing idempotency record');
        Object.assign(record, data);
        return record;
      }),
    },
    income: { create: jest.fn() },
    expense: { create: jest.fn() },
    auditEvent: {
      create: jest.fn(async ({ data }) => ({ id: 'audit-1', ...data })),
    },
  };
  const store: FinancialMutationStore = {
    $transaction: jest.fn(async (work) => work(transaction)),
  };
  return { store, transaction };
};

const createInput = (
  requestPayload: Record<string, unknown>,
): CoordinateFinancialMutationInput => ({
  familyId: 'family-1',
  actorId: 'user-1',
  source: 'MANUAL',
  idempotencyKey: 'request-1',
  operation: 'CREATE_INCOME',
  requestPayload,
  audit: {
    action: 'CREATE',
    entity: 'Income',
  },
});

describe('FinancialMutationCoordinator', () => {
  test('replays the same family-scoped key and hash without a second mutation', async () => {
    const { store, transaction } = createCoordinatorStore();
    const mutate = jest.fn(async () => ({
      resourceId: 'income-1',
      record: { id: 'income-1', version: 1 },
      version: 1,
    }));
    const input = createInput({
      amount: 100,
      date: new Date('2026-08-28T00:00:00.000Z'),
    });

    const first = await coordinateFinancialMutation(input, store, mutate);
    const replay = await coordinateFinancialMutation(input, store, mutate);

    expect(first).toMatchObject({
      resourceId: 'income-1',
      deduplicated: false,
    });
    expect(replay).toEqual({ ...first, deduplicated: true });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  test('rejects reuse of one scoped key with a different normalized payload', async () => {
    const { store } = createCoordinatorStore();
    const mutate = jest.fn(async () => ({ resourceId: 'income-1' }));

    await coordinateFinancialMutation(createInput({ amount: 100 }), store, mutate);

    await expect(
      coordinateFinancialMutation(createInput({ amount: 200 }), store, mutate),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
      retryable: false,
    });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  test('includes the mutation source in the request hash', async () => {
    const { store } = createCoordinatorStore();
    const mutate = jest.fn(async () => ({ resourceId: 'income-1' }));
    const manual = createInput({ amount: 100 });
    const imported = { ...manual, source: 'IMPORT' as const };

    await coordinateFinancialMutation(manual, store, mutate);

    await expect(
      coordinateFinancialMutation(imported, store, mutate),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  test('hashes equivalent payloads independently of object key order', () => {
    const date = new Date('2026-08-28T00:00:00.000Z');

    expect(hashNormalizedPayload({ b: 2, date, a: 1 })).toBe(
      hashNormalizedPayload({ a: 1, b: 2, date }),
    );
  });

  test.each([
    ['a non-finite number', { amount: Number.NaN }],
    ['an invalid date', { date: new Date('not-a-date') }],
    ['a non-plain object', { metadata: new Map([['source', 'manual']]) }],
    ['an unsupported value', { metadata: Symbol('untrusted') }],
  ])('rejects %s before opening a financial transaction', async (_case, requestPayload) => {
    const { store } = createCoordinatorStore();

    await expect(coordinateFinancialMutation(createInput(requestPayload), store, jest.fn()))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(store.$transaction).not.toHaveBeenCalled();
  });

  test.each([
    ['another family', { familyId: 'family-2', userId: 'user-1', role: 'member' }],
    ['another user', { familyId: 'family-1', userId: 'user-2', role: 'member' }],
  ])('rejects a membership belonging to %s before an idempotency lookup', async (_case, membership) => {
    const { store, transaction } = createCoordinatorStore();
    (transaction.familyMember.findUnique as jest.Mock).mockResolvedValue(membership);

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .rejects.toMatchObject({ code: 'FAMILY_WRITE_FORBIDDEN', status: 403 });
    expect(transaction.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  test('rejects an existing operation whose stored response cannot be replayed', async () => {
    const { store, transaction } = createCoordinatorStore();
    (transaction.idempotencyRecord.findUnique as jest.Mock).mockResolvedValue({
      id: 'operation-1',
      familyId: 'family-1',
      actorScope: 'USER:user-1',
      operation: 'CREATE_INCOME',
      key: 'request-1',
      payloadHash: hashNormalizedPayload({ source: 'MANUAL', payload: { amount: 100 } }),
      httpStatus: 201,
      responseJson: { operationId: 42, resourceId: 'income-1' },
    });
    const mutate = jest.fn();

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, mutate))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409, retryable: true });
    expect(mutate).not.toHaveBeenCalled();
  });

  test.each([
    ['P2002', 'CONCURRENT_MUTATION_CONFLICT', 409, true],
    ['P2025', 'RESOURCE_NOT_FOUND', 404, false],
    ['P2034', 'TRANSIENT_DATABASE_FAILURE', 503, true],
  ] as const)(
    'maps Prisma %s to stable %s semantics',
    (prismaCode, domainCode, status, retryable) => {
      const mapped = mapPrismaError({ code: prismaCode, message: 'database detail' });

      expect(mapped).toMatchObject({ code: domainCode, status, retryable });
      expect(mapped.message).not.toContain('database detail');
    },
  );

  test('maps unknown failures to non-retryable internal errors', () => {
    expect(mapPrismaError(new Error('secret database detail'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      retryable: false,
    });
  });

  test('retains the raw Prisma code as a non-enumerable cause for an unmapped failure', () => {
    const rawPrismaError = {
      code: 'P2028',
      message: 'Transaction API error: Transaction already closed.',
    };

    const mapped = mapPrismaError(rawPrismaError);

    expect(mapped).toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      retryable: false,
    });
    expect((mapped as Error & { cause?: unknown }).cause).toBe(rawPrismaError);
    expect(Object.keys(mapped)).not.toContain('cause');
  });

  test('resolves a PostgreSQL arbitration conflict by replaying the committed winner', async () => {
    const winner = {
      id: 'winner-operation',
      familyId: 'family-1',
      actorScope: 'USER:user-1',
      operation: 'CREATE_INCOME' as const,
      key: 'request-1',
      payloadHash: hashNormalizedPayload({ source: 'MANUAL', payload: { amount: 100 } }),
      httpStatus: 201,
      responseJson: { operationId: 'winner-operation', resourceId: 'income-1', deduplicated: false },
    };
    const store: FinancialMutationStore = {
      $transaction: jest.fn(async () => {
        throw { code: 'P2002', meta: { target: ['IdempotencyRecord_scope_key'] } };
      }),
      familyMember: {
        findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
      },
      idempotencyRecord: {
        findUnique: jest.fn(async () => winner),
      },
    };

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .resolves.toEqual({ ...winner.responseJson, deduplicated: true });
  });

  test('recognizes Prisma composite-field metadata for the scoped arbitration winner', async () => {
    const winner = {
      id: 'winner-operation',
      familyId: 'family-1',
      actorScope: 'USER:user-1',
      operation: 'CREATE_INCOME' as const,
      key: 'request-1',
      payloadHash: hashNormalizedPayload({ source: 'MANUAL', payload: { amount: 100 } }),
      httpStatus: 201,
      responseJson: { operationId: 'winner-operation', resourceId: 'income-1', deduplicated: false },
    };
    const store: FinancialMutationStore = {
      $transaction: jest.fn(async () => {
        throw {
          code: 'P2002',
          meta: { target: ['familyId', 'actorScope', 'operation', 'key'] },
        };
      }),
      familyMember: {
        findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
      },
      idempotencyRecord: {
        findUnique: jest.fn(async () => winner),
      },
    };

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .resolves.toEqual({ ...winner.responseJson, deduplicated: true });
  });

  test('recognizes Prisma model metadata when PostgreSQL omits the composite target', async () => {
    const winner = {
      id: 'winner-operation',
      familyId: 'family-1',
      actorScope: 'USER:user-1',
      operation: 'CREATE_INCOME' as const,
      key: 'request-1',
      payloadHash: hashNormalizedPayload({ source: 'MANUAL', payload: { amount: 100 } }),
      httpStatus: 201,
      responseJson: { operationId: 'winner-operation', resourceId: 'income-1', deduplicated: false },
    };
    const store: FinancialMutationStore = {
      $transaction: jest.fn(async () => {
        throw { code: 'P2002', meta: { modelName: 'IdempotencyRecord', target: null } };
      }),
      familyMember: {
        findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
      },
      idempotencyRecord: { findUnique: jest.fn(async () => winner) },
    };

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .resolves.toEqual({ ...winner.responseJson, deduplicated: true });
  });

  test('does not treat an unrelated unique conflict as an idempotency arbitration', async () => {
    const winnerLookup = jest.fn(async () => null);
    const store: FinancialMutationStore = {
      $transaction: jest.fn(async () => {
        throw { code: 'P2002', meta: { target: ['User_email_key'] } };
      }),
      familyMember: {
        findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
      },
      idempotencyRecord: { findUnique: winnerLookup },
    };

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .rejects.toMatchObject({ code: 'CONCURRENT_MUTATION_CONFLICT', status: 409, retryable: true });
    expect(winnerLookup).not.toHaveBeenCalled();
  });

  test('does not treat a P2002 for another Prisma model as an idempotency arbitration', async () => {
    const winnerLookup = jest.fn(async () => null);
    const store: FinancialMutationStore = {
      $transaction: jest.fn(async () => {
        throw { code: 'P2002', meta: { modelName: 'Income' } };
      }),
      familyMember: {
        findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
      },
      idempotencyRecord: { findUnique: winnerLookup },
    };

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .rejects.toMatchObject({ code: 'CONCURRENT_MUTATION_CONFLICT', status: 409, retryable: true });
    expect(winnerLookup).not.toHaveBeenCalled();
  });

  test('preserves the stable conflict error if an arbitration winner cannot be read', async () => {
    const store = {
      $transaction: jest.fn(async () => {
        throw { code: 'P2002', meta: { target: ['IdempotencyRecord_scope_key'] } };
      }),
    } as FinancialMutationStore;

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .rejects.toMatchObject({ code: 'CONCURRENT_MUTATION_CONFLICT', status: 409, retryable: true });
  });

  test('returns stable key-reused semantics when the arbitration winner hash differs', async () => {
    const store: FinancialMutationStore = {
      $transaction: jest.fn(async () => {
        throw { code: 'P2002', meta: { target: ['IdempotencyRecord_scope_key'] } };
      }),
      familyMember: {
        findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
      },
      idempotencyRecord: {
        findUnique: jest.fn(async () => ({
          id: 'winner-operation', familyId: 'family-1', actorScope: 'USER:user-1',
          operation: 'CREATE_INCOME' as const, key: 'request-1', payloadHash: 'f'.repeat(64),
          httpStatus: 201, responseJson: null,
        })),
      },
    };

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409, retryable: false });
  });

  test('returns retryable in-progress when the arbitration winner is not complete', async () => {
    const store: FinancialMutationStore = {
      $transaction: jest.fn(async () => {
        throw { code: 'P2002', meta: { target: ['IdempotencyRecord_scope_key'] } };
      }),
      familyMember: {
        findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
      },
      idempotencyRecord: {
        findUnique: jest.fn(async () => ({
          id: 'winner-operation', familyId: 'family-1', actorScope: 'USER:user-1',
          operation: 'CREATE_INCOME' as const, key: 'request-1', payloadHash: hashNormalizedPayload({ source: 'MANUAL', payload: { amount: 100 } }),
          httpStatus: null, responseJson: null,
        })),
      },
    };

    await expect(coordinateFinancialMutation(createInput({ amount: 100 }), store, jest.fn()))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409, retryable: true });
  });
});
