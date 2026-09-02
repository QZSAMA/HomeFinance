import {
  createAssetInTransaction,
  createLiabilityInTransaction,
} from './balanceMutationService';
import * as balanceMutationService from './balanceMutationService';
import {
  CreateAssetCommand,
  CreateLiabilityCommand,
  FinancialMutationStore,
  LedgerTransactionClient,
} from './ledgerTypes';

type UpdateLiabilityCommandForTest = CreateLiabilityCommand & {
  liabilityId: string;
  expectedVersion?: number;
};

type DeleteLiabilityCommandForTest = Pick<
  CreateLiabilityCommand,
  'familyId' | 'actorId' | 'source' | 'idempotencyKey'
> & {
  liabilityId: string;
  expectedVersion?: number;
};

const createTransaction = () => {
  const transaction = {
    asset: {
      create: jest.fn(async ({ data }) => ({
        id: 'asset-1',
        ...data,
      })),
    },
    liability: {
      create: jest.fn(async ({ data }) => ({
        id: 'liability-1',
        ...data,
      })),
    },
  } as unknown as LedgerTransactionClient;

  return transaction;
};

const assetCommand: CreateAssetCommand = {
  familyId: 'family-1',
  actorId: 'user-1',
  source: 'AI_CONFIRMATION',
  idempotencyKey: 'confirm-1:item:0',
  payload: {
    name: 'Index fund',
    type: 'FUND',
    category: 'INVESTMENT',
    value: 1234.56,
    costBasis: 1000,
    currency: 'cny',
    purchaseDate: new Date('2026-08-01T00:00:00.000Z'),
    description: 'Long-term holding',
  },
};

const liabilityCommand: CreateLiabilityCommand = {
  familyId: 'family-1',
  actorId: 'user-1',
  source: 'AI_CONFIRMATION',
  idempotencyKey: 'confirm-1:item:1',
  payload: {
    name: 'Mortgage',
    type: 'MORTGAGE',
    amount: 4567.89,
    interestRate: 0.0325,
    startDate: new Date('2026-08-01T00:00:00.000Z'),
    endDate: null,
    currency: 'cny',
    description: 'Home loan',
  },
};

const createMutationStore = (): FinancialMutationStore => {
  const idempotency = new Map<string, any>();
  let currentAsset: any = {
    id: 'asset-1',
    familyId: 'family-1',
    version: 1,
    name: 'Index fund',
    type: 'FUND',
    category: 'INVESTMENT',
    value: 1234.56,
    costBasis: 1000,
    currency: 'CNY',
    purchaseDate: new Date('2026-08-01T00:00:00.000Z'),
    description: 'Long-term holding',
  };
  const asset = {
    create: jest.fn(async ({ data }: any) => ({
      id: 'asset-1',
      version: 1,
      ...data,
    })),
    findFirst: jest.fn(async () => currentAsset),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (
        !currentAsset
        || currentAsset.id !== where.id
        || currentAsset.familyId !== where.familyId
        || currentAsset.version !== where.version
      ) {
        return { count: 0 };
      }
      currentAsset = {
        ...currentAsset,
        ...data,
        version: currentAsset.version + data.version.increment,
      };
      return { count: 1 };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      if (
        !currentAsset
        || currentAsset.id !== where.id
        || currentAsset.familyId !== where.familyId
        || currentAsset.version !== where.version
      ) {
        return { count: 0 };
      }
      currentAsset = null;
      return { count: 1 };
    }),
  };
  const transaction = {
    familyMember: {
      findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async ({ where }: any) => idempotency.get(JSON.stringify(where.familyId_actorScope_operation_key)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const record = { ...data, httpStatus: null, responseJson: null };
        idempotency.set(JSON.stringify({
          familyId: data.familyId,
          actorScope: data.actorScope,
          operation: data.operation,
          key: data.key,
        }), record);
        return record;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const record = [...idempotency.values()].find((entry) => entry.id === where.id);
        Object.assign(record, data);
        return record;
      }),
    },
    asset,
    liability: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'liability-1',
        version: 1,
        ...data,
      })),
    },
    auditEvent: { create: jest.fn(async () => ({ id: 'audit-1' })) },
  } as unknown as LedgerTransactionClient;

  return { $transaction: async (work) => work(transaction) };
};

const createLiabilityMutationStore = ({ version = 1 }: { version?: number } = {}) => {
  const idempotency = new Map<string, any>();
  let currentLiability: any = {
    id: 'liability-1',
    familyId: 'family-1',
    version,
    name: 'Mortgage',
    type: 'MORTGAGE',
    amount: 4567.89,
    interestRate: 0.0325,
    startDate: new Date('2026-08-01T00:00:00.000Z'),
    endDate: null,
    currency: 'CNY',
    description: 'Home loan',
  };
  const liability = {
    findFirst: jest.fn(async ({ where }: any) => (
      currentLiability
      && currentLiability.id === where.id
      && currentLiability.familyId === where.familyId
        ? currentLiability
        : null
    )),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (
        !currentLiability
        || currentLiability.id !== where.id
        || currentLiability.familyId !== where.familyId
        || currentLiability.version !== where.version
      ) {
        return { count: 0 };
      }
      currentLiability = {
        ...currentLiability,
        ...data,
        version: currentLiability.version + data.version.increment,
      };
      return { count: 1 };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      if (
        !currentLiability
        || currentLiability.id !== where.id
        || currentLiability.familyId !== where.familyId
        || currentLiability.version !== where.version
      ) {
        return { count: 0 };
      }
      currentLiability = null;
      return { count: 1 };
    }),
  };
  const transaction = {
    familyMember: {
      findUnique: jest.fn(async () => ({ familyId: 'family-1', userId: 'user-1', role: 'member' })),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async ({ where }: any) => idempotency.get(JSON.stringify(where.familyId_actorScope_operation_key)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const record = { ...data, httpStatus: null, responseJson: null };
        idempotency.set(JSON.stringify({
          familyId: data.familyId,
          actorScope: data.actorScope,
          operation: data.operation,
          key: data.key,
        }), record);
        return record;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const record = [...idempotency.values()].find((entry) => entry.id === where.id);
        Object.assign(record, data);
        return record;
      }),
    },
    liability,
    auditEvent: { create: jest.fn(async () => ({ id: 'audit-1' })) },
  } as unknown as LedgerTransactionClient;

  return {
    store: { $transaction: async (work: any) => work(transaction) } as FinancialMutationStore,
    liability,
  };
};

const assetApplicationService = balanceMutationService as unknown as {
  createAsset: (command: CreateAssetCommand, store: FinancialMutationStore) => Promise<Record<string, unknown>>;
  updateAsset: (command: CreateAssetCommand & { assetId: string; expectedVersion?: number }, store: FinancialMutationStore) => Promise<Record<string, unknown>>;
  deleteAsset: (command: Pick<CreateAssetCommand, 'familyId' | 'actorId' | 'source' | 'idempotencyKey'> & { assetId: string; expectedVersion?: number }, store: FinancialMutationStore) => Promise<Record<string, unknown>>;
  createLiability: (command: CreateLiabilityCommand, store: FinancialMutationStore) => Promise<Record<string, unknown>>;
  updateLiability: (command: UpdateLiabilityCommandForTest, store: FinancialMutationStore) => Promise<Record<string, unknown>>;
  deleteLiability: (command: DeleteLiabilityCommandForTest, store: FinancialMutationStore) => Promise<Record<string, unknown>>;
};

describe('BalanceMutationService', () => {
  test('coordinates a manual Asset create through the shared mutation boundary', async () => {
    const store = createMutationStore();

    const result = await assetApplicationService.createAsset({
      ...assetCommand,
      source: 'MANUAL',
      idempotencyKey: 'manual-asset-create-1',
    }, store);

    expect(result).toMatchObject({
      resourceId: 'asset-1',
      version: 1,
      deduplicated: false,
    });
  });

  test('coordinates a manual Liability create through the shared mutation boundary', async () => {
    const store = createMutationStore();

    const result = await assetApplicationService.createLiability({
      ...liabilityCommand,
      source: 'MANUAL',
      idempotencyKey: 'manual-liability-create-1',
    }, store);

    expect(result).toMatchObject({
      operationId: expect.any(String),
      resourceId: 'liability-1',
      version: 1,
      deduplicated: false,
    });
  });

  test('updates a Liability only when the family-scoped version predicate matches', async () => {
    const { store, liability } = createLiabilityMutationStore({ version: 1 });

    const result = await assetApplicationService.updateLiability({
      ...liabilityCommand,
      source: 'MANUAL',
      idempotencyKey: 'manual-liability-update-1',
      liabilityId: 'liability-1',
      expectedVersion: 1,
      payload: { ...liabilityCommand.payload, amount: 340000 },
    }, store);

    expect(result).toMatchObject({ resourceId: 'liability-1', version: 2, deduplicated: false });
    expect(liability.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'liability-1', familyId: 'family-1', version: 1 },
    }));
  });

  test('returns a stable version conflict when a Liability predicate no longer matches', async () => {
    const { store, liability } = createLiabilityMutationStore({ version: 2 });

    await expect(assetApplicationService.updateLiability({
      ...liabilityCommand,
      source: 'MANUAL',
      idempotencyKey: 'manual-liability-stale-update-1',
      liabilityId: 'liability-1',
      expectedVersion: 1,
    }, store)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(liability.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'liability-1', familyId: 'family-1', version: 1 },
    }));
  });

  test('deletes a Liability only when the family-scoped version predicate matches', async () => {
    const { store, liability } = createLiabilityMutationStore({ version: 1 });

    const result = await assetApplicationService.deleteLiability({
      familyId: liabilityCommand.familyId,
      actorId: liabilityCommand.actorId,
      source: 'MANUAL',
      idempotencyKey: 'manual-liability-delete-1',
      liabilityId: 'liability-1',
      expectedVersion: 1,
    }, store);

    expect(result).toMatchObject({ resourceId: 'liability-1', version: 1, deduplicated: false });
    expect(liability.deleteMany).toHaveBeenCalledWith({
      where: { id: 'liability-1', familyId: 'family-1', version: 1 },
    });
  });

  test('updates an Asset only when the family-scoped version predicate matches', async () => {
    const store = createMutationStore();

    const result = await assetApplicationService.updateAsset({
      ...assetCommand,
      source: 'MANUAL',
      idempotencyKey: 'manual-asset-update-1',
      assetId: 'asset-1',
      expectedVersion: 1,
      payload: { ...assetCommand.payload, value: 1300 },
    }, store);

    expect(result).toMatchObject({
      resourceId: 'asset-1',
      version: 2,
      deduplicated: false,
    });
  });

  test('deletes an Asset only when the family-scoped version predicate matches', async () => {
    const store = createMutationStore();

    const result = await assetApplicationService.deleteAsset({
      familyId: assetCommand.familyId,
      actorId: assetCommand.actorId,
      source: 'MANUAL',
      idempotencyKey: 'manual-asset-delete-1',
      assetId: 'asset-1',
      expectedVersion: 1,
    }, store);

    expect(result).toMatchObject({
      resourceId: 'asset-1',
      version: 1,
      deduplicated: false,
    });
  });

  test('creates an Asset with normalized family-scoped fields in the supplied transaction', async () => {
    const transaction = createTransaction();

    const result = await createAssetInTransaction(assetCommand, transaction);

    expect(transaction.asset?.create).toHaveBeenCalledWith({
      data: {
        familyId: 'family-1',
        name: 'Index fund',
        type: 'FUND',
        category: 'INVESTMENT',
        value: 1234.56,
        costBasis: 1000,
        currency: 'CNY',
        purchaseDate: new Date('2026-08-01T00:00:00.000Z'),
        description: 'Long-term holding',
      },
    });
    expect(result).toMatchObject({ resourceId: 'asset-1', record: { id: 'asset-1', value: 1234.56 } });
  });

  test('creates a Liability with normalized family-scoped fields in the supplied transaction', async () => {
    const transaction = createTransaction();

    const result = await createLiabilityInTransaction(liabilityCommand, transaction);

    expect(transaction.liability?.create).toHaveBeenCalledWith({
      data: {
        familyId: 'family-1',
        name: 'Mortgage',
        type: 'MORTGAGE',
        amount: 4567.89,
        interestRate: 0.0325,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: null,
        currency: 'CNY',
        description: 'Home loan',
      },
    });
    expect(result).toMatchObject({ resourceId: 'liability-1', record: { id: 'liability-1', amount: 4567.89 } });
  });

  test('rejects invalid balances before invoking either transaction writer', async () => {
    const assetTransaction = createTransaction();
    const liabilityTransaction = createTransaction();

    await expect(createAssetInTransaction({
      ...assetCommand,
      payload: { ...assetCommand.payload, value: -1 },
    }, assetTransaction)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    await expect(createLiabilityInTransaction({
      ...liabilityCommand,
      payload: { ...liabilityCommand.payload, currency: 'CN' },
    }, liabilityTransaction)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });

    expect(assetTransaction.asset?.create).not.toHaveBeenCalled();
    expect(liabilityTransaction.liability?.create).not.toHaveBeenCalled();
  });

  test('rejects invalid Liability dates before invoking the transaction writer', async () => {
    const transaction = createTransaction();

    await expect(createLiabilityInTransaction({
      ...liabilityCommand,
      payload: { ...liabilityCommand.payload, startDate: new Date('invalid') },
    }, transaction)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });

    expect(transaction.liability?.create).not.toHaveBeenCalled();
  });
});
