import {
  createAssetInTransaction,
  createLiabilityInTransaction,
} from './balanceMutationService';
import {
  CreateAssetCommand,
  CreateLiabilityCommand,
  LedgerTransactionClient,
} from './ledgerTypes';

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

describe('BalanceMutationService', () => {
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
});
