import { createExpense, createIncome } from './ledgerApplicationService';
import {
  CreateExpenseCommand,
  CreateIncomeCommand,
  FinancialMutationStore,
  IdempotencyRecordSnapshot,
  LedgerTransactionClient,
} from './ledgerTypes';

const command: CreateIncomeCommand = {
  familyId: 'family-1',
  actorId: 'user-1',
  source: 'MANUAL',
  idempotencyKey: 'income-request-1',
  payload: {
    amount: 1250.5,
    category: ' 工资 ',
    description: ' 八月工资 ',
    source: '雇主转账',
    date: new Date('2026-08-28T00:00:00.000Z'),
    currency: 'cny',
  },
};

const expenseCommand: CreateExpenseCommand = {
  familyId: 'family-1',
  actorId: 'user-1',
  source: 'MANUAL',
  idempotencyKey: 'expense-request-1',
  payload: {
    amount: 88,
    category: ' 餐饮 ',
    description: ' 午餐 ',
    paymentMethod: ' 银行卡 ',
    date: new Date('2026-08-28T04:00:00.000Z'),
  },
};

const createStore = (role: string | null) => {
  const events: string[] = [];
  const idempotencyRecords = new Map<string, IdempotencyRecordSnapshot>();
  const incomeRecord = {
    id: 'income-1',
    familyId: 'family-1',
    createdBy: 'user-1',
    category: '工资',
    amount: 1250.5,
    description: '八月工资',
    source: '雇主转账',
    date: new Date('2026-08-28T00:00:00.000Z'),
    currency: 'CNY',
    originType: 'MANUAL',
    version: 1,
  };
  const expenseRecord = {
    id: 'expense-1',
    familyId: 'family-1',
    createdBy: 'user-1',
    category: '餐饮',
    amount: 88,
    description: '午餐',
    paymentMethod: '银行卡',
    date: new Date('2026-08-28T04:00:00.000Z'),
    currency: 'CNY',
    originType: 'MANUAL',
    version: 1,
  };

  const transaction: LedgerTransactionClient = {
    familyMember: {
      findUnique: jest.fn(async () => {
        events.push('membership.findUnique');
        return role
          ? { familyId: 'family-1', userId: 'user-1', role }
          : null;
      }),
    },
    idempotencyRecord: {
      findUnique: jest.fn(async ({ where }) => {
        events.push('idempotency.findUnique');
        return idempotencyRecords.get(
          JSON.stringify(where.familyId_actorScope_operation_key),
        ) ?? null;
      }),
      create: jest.fn(async ({ data }) => {
        events.push('idempotency.create');
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
        events.push('idempotency.update');
        const record = [...idempotencyRecords.values()].find(
          (candidate) => candidate.id === where.id,
        );
        if (!record) throw new Error('missing idempotency record');
        Object.assign(record, data);
        return record;
      }),
    },
    income: {
      create: jest.fn(async () => {
        events.push('income.create');
        return incomeRecord;
      }),
    },
    expense: {
      create: jest.fn(async () => {
        events.push('expense.create');
        return expenseRecord;
      }),
    },
    auditEvent: {
      create: jest.fn(async ({ data }) => {
        events.push('audit.create');
        return { id: 'audit-1', ...data };
      }),
    },
  };

  const store: FinancialMutationStore = {
    $transaction: jest.fn(async (work) => work(transaction)),
  };

  return { events, expenseRecord, incomeRecord, store, transaction };
};

describe('LedgerApplicationService.createIncome', () => {
  test('authorizes a member before committing one normalized income and audit result', async () => {
    const { events, incomeRecord, store, transaction } = createStore('member');

    const result = await createIncome(command, store);

    expect(result).toMatchObject({
      operationId: expect.any(String),
      resourceId: 'income-1',
      record: incomeRecord,
      version: 1,
      deduplicated: false,
    });
    expect(transaction.income.create).toHaveBeenCalledWith({
      data: {
        familyId: 'family-1',
        createdBy: 'user-1',
        category: '工资',
        amount: 1250.5,
        description: '八月工资',
        source: '雇主转账',
        date: new Date('2026-08-28T00:00:00.000Z'),
        currency: 'CNY',
        originType: 'MANUAL',
      },
    });
    expect(events).toEqual([
      'membership.findUnique',
      'idempotency.findUnique',
      'idempotency.create',
      'income.create',
      'audit.create',
      'idempotency.update',
    ]);
  });

  test('rejects a viewer before idempotency, income, or audit mutations', async () => {
    const { events, store, transaction } = createStore('viewer');

    await expect(createIncome(command, store)).rejects.toMatchObject({
      code: 'FAMILY_WRITE_FORBIDDEN',
      status: 403,
      retryable: false,
    });

    expect(events).toEqual(['membership.findUnique']);
    expect(transaction.idempotencyRecord.create).not.toHaveBeenCalled();
    expect(transaction.income.create).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  test('commits an expense through the same normalized mutation contract', async () => {
    const { expenseRecord, store, transaction } = createStore('admin');

    const result = await createExpense(expenseCommand, store);

    expect(result).toMatchObject({
      resourceId: 'expense-1',
      record: expenseRecord,
      version: 1,
      deduplicated: false,
    });
    expect(transaction.expense.create).toHaveBeenCalledWith({
      data: {
        familyId: 'family-1',
        createdBy: 'user-1',
        category: '餐饮',
        amount: 88,
        description: '午餐',
        paymentMethod: '银行卡',
        date: new Date('2026-08-28T04:00:00.000Z'),
        currency: 'CNY',
        originType: 'MANUAL',
      },
    });
  });
});
