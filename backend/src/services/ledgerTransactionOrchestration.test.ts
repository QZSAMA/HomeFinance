import { coordinateFinancialMutation } from './financialMutationCoordinator';
import { CoordinateFinancialMutationInput, FinancialMutationStore, LedgerTransactionClient } from './ledgerTypes';

const input: CoordinateFinancialMutationInput = {
  familyId: 'family-1',
  actorId: 'user-1',
  source: 'MANUAL',
  idempotencyKey: 'orchestration-1',
  operation: 'CREATE_INCOME',
  requestPayload: { amount: 100, category: 'SALARY' },
  httpStatus: 201,
  audit: { action: 'CREATE', entity: 'Income' },
};

const createStore = () => {
  const transaction: LedgerTransactionClient = {
    familyMember: {
      findUnique: jest.fn(async () => ({
        familyId: 'family-1',
        userId: 'user-1',
        role: 'member',
      })),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({
        ...data,
        httpStatus: null,
        responseJson: null,
      })),
      update: jest.fn(async ({ where, data }) => ({
        id: where.id,
        familyId: 'family-1',
        actorScope: 'USER:user-1',
        operation: 'CREATE_INCOME' as const,
        key: 'orchestration-1',
        payloadHash: '0'.repeat(64),
        httpStatus: data.httpStatus,
        responseJson: data.responseJson,
      })),
    },
    income: {
      create: jest.fn(async () => ({ id: 'income-1', version: 1 })),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    expense: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditEvent: { create: jest.fn(async () => ({ id: 'audit-1' })) },
  };

  const store: FinancialMutationStore = {
    $transaction: jest.fn(async (work) => work(transaction)),
  };

  return { store, transaction };
};

describe('financial mutation transaction orchestration', () => {
  test('rejects an invalid mutation result before audit and replay state can commit', async () => {
    const { store, transaction } = createStore();

    await expect(
      coordinateFinancialMutation(input, store, async () => ({ resourceId: '' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
      retryable: false,
    });

    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
    expect(transaction.idempotencyRecord.update).not.toHaveBeenCalled();
  });
});
