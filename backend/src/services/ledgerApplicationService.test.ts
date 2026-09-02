import * as ledgerApplicationService from './ledgerApplicationService';
import { createExpense, createIncome } from './ledgerApplicationService';
import {
  CreateExpenseCommand,
  CreateIncomeCommand,
  DeleteExpenseCommand,
  DeleteIncomeCommand,
  FinancialMutationStore,
  IdempotencyRecordSnapshot,
  LedgerTransactionClient,
  MutationResult,
  LedgerRecord,
  UpdateExpenseCommand,
  UpdateIncomeCommand,
} from './ledgerTypes';

type VersionedLedgerTransactionClient = LedgerTransactionClient & {
  income: LedgerTransactionClient['income'] & {
    findFirst(args: { where: { id: string; familyId: string } }): Promise<LedgerRecord | null>;
    updateMany(args: {
      where: { id: string; familyId: string; version: number };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { id: string; familyId: string; version: number };
    }): Promise<{ count: number }>;
  };
  expense: LedgerTransactionClient['expense'] & {
    findFirst(args: { where: { id: string; familyId: string } }): Promise<LedgerRecord | null>;
    updateMany(args: {
      where: { id: string; familyId: string; version: number };
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { id: string; familyId: string; version: number };
    }): Promise<{ count: number }>;
  };
};

const command: CreateIncomeCommand = {
  familyId: 'family-1',
  actorId: 'user-1',
  source: 'MANUAL',
  idempotencyKey: 'income-request-1',
  effectiveDate: new Date('2026-08-28T00:00:00.000Z'),
  payload: {
    amount: 1250.5,
    category: ' 工资 ',
    description: ' 八月工资 ',
    source: '雇主转账',
    currency: 'cny',
  },
};

const expenseCommand: CreateExpenseCommand = {
  familyId: 'family-1',
  actorId: 'user-1',
  source: 'MANUAL',
  idempotencyKey: 'expense-request-1',
  effectiveDate: new Date('2026-08-28T04:00:00.000Z'),
  payload: {
    amount: 88,
    category: ' 餐饮 ',
    description: ' 午餐 ',
    paymentMethod: ' 银行卡 ',
  },
};

const updateIncome = (ledgerApplicationService as unknown as {
  updateIncome: (
    command: UpdateIncomeCommand,
    store: FinancialMutationStore,
  ) => Promise<MutationResult<LedgerRecord>>;
}).updateIncome;

const updateExpense = (ledgerApplicationService as unknown as {
  updateExpense: (
    command: UpdateExpenseCommand,
    store: FinancialMutationStore,
  ) => Promise<MutationResult<LedgerRecord>>;
}).updateExpense;

const deleteIncome = (ledgerApplicationService as unknown as {
  deleteIncome: (
    command: DeleteIncomeCommand,
    store: FinancialMutationStore,
  ) => Promise<MutationResult<LedgerRecord>>;
}).deleteIncome;

const deleteExpense = (ledgerApplicationService as unknown as {
  deleteExpense: (
    command: DeleteExpenseCommand,
    store: FinancialMutationStore,
  ) => Promise<MutationResult<LedgerRecord>>;
}).deleteExpense;

const createStore = (role: string | null) => {
  const events: string[] = [];
  const idempotencyRecords = new Map<string, IdempotencyRecordSnapshot>();
  let incomeRecord = {
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
  let expenseRecord = {
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

  const transaction: VersionedLedgerTransactionClient = {
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
      findFirst: jest.fn(async () => {
        events.push('income.findFirst');
        return incomeRecord;
      }),
      updateMany: jest.fn(async () => {
        events.push('income.updateMany');
        incomeRecord = { ...incomeRecord, version: (incomeRecord.version ?? 0) + 1 };
        return { count: 1 };
      }),
      deleteMany: jest.fn(async () => {
        events.push('income.deleteMany');
        return { count: 1 };
      }),
    },
    expense: {
      create: jest.fn(async () => {
        events.push('expense.create');
        return expenseRecord;
      }),
      findFirst: jest.fn(async () => {
        events.push('expense.findFirst');
        return expenseRecord;
      }),
      updateMany: jest.fn(async () => {
        events.push('expense.updateMany');
        expenseRecord = { ...expenseRecord, version: (expenseRecord.version ?? 0) + 1 };
        return { count: 1 };
      }),
      deleteMany: jest.fn(async () => {
        events.push('expense.deleteMany');
        return { count: 1 };
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
  test('requires the effective date at the command boundary', async () => {
    const { store, transaction } = createStore('member');
    const missingEffectiveDate = { ...command } as CreateIncomeCommand;

    delete (missingEffectiveDate as Partial<CreateIncomeCommand>).effectiveDate;

    await expect(createIncome(missingEffectiveDate, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(transaction.familyMember.findUnique).not.toHaveBeenCalled();
  });

  test.each([
    ['a non-positive amount', { ...command, payload: { ...command.payload, amount: 0 } }],
    ['a blank category', { ...command, payload: { ...command.payload, category: '  ' } }],
    ['an invalid currency', { ...command, payload: { ...command.payload, currency: 'CN' } }],
    ['an unsupported source', { ...command, source: 'UNTRUSTED' as CreateIncomeCommand['source'] }],
  ])('rejects %s before checking family membership', async (_case, invalidCommand) => {
    const { store, transaction } = createStore('member');

    await expect(createIncome(invalidCommand, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(transaction.familyMember.findUnique).not.toHaveBeenCalled();
  });

  test('defaults currency and preserves absent optional income fields as undefined', async () => {
    const { store, transaction } = createStore('member');
    const commandWithoutOptionals: CreateIncomeCommand = {
      ...command,
      payload: {
        amount: 1250.5,
        category: '工资',
      },
    };

    await createIncome(commandWithoutOptionals, store);

    expect(transaction.income.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: undefined,
        source: undefined,
        currency: 'CNY',
      }),
    });
  });

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

describe('LedgerApplicationService versioned mutations', () => {
  test('updates an income only through a family- and version-scoped predicate', async () => {
    const { store, transaction } = createStore('member');
    const incomeUpdateCommand: UpdateIncomeCommand = {
      ...command,
      incomeId: 'income-1',
      expectedVersion: 1,
      idempotencyKey: 'income-update-1',
      payload: { ...command.payload, amount: 1300 },
    };

    expect(updateIncome).toBeDefined();
    const result = await updateIncome(incomeUpdateCommand, store);

    expect(transaction.income.updateMany).toHaveBeenCalledWith({
      where: { id: 'income-1', familyId: 'family-1', version: 1 },
      data: {
        amount: 1300,
        category: '工资',
        description: '八月工资',
        source: '雇主转账',
        date: new Date('2026-08-28T00:00:00.000Z'),
        currency: 'CNY',
        version: { increment: 1 },
      },
    });
    expect(result).toMatchObject({
      resourceId: 'income-1',
      version: 2,
      deduplicated: false,
    });
  });

  test('updates an expense only through a family- and version-scoped predicate', async () => {
    const { store, transaction } = createStore('admin');
    const expenseUpdateCommand: UpdateExpenseCommand = {
      ...expenseCommand,
      expenseId: 'expense-1',
      expectedVersion: 1,
      idempotencyKey: 'expense-update-1',
      payload: { ...expenseCommand.payload, amount: 99 },
    };

    expect(updateExpense).toBeDefined();
    const result = await updateExpense(expenseUpdateCommand, store);

    expect(transaction.expense.updateMany).toHaveBeenCalledWith({
      where: { id: 'expense-1', familyId: 'family-1', version: 1 },
      data: {
        amount: 99,
        category: '餐饮',
        description: '午餐',
        paymentMethod: '银行卡',
        date: new Date('2026-08-28T04:00:00.000Z'),
        currency: 'CNY',
        version: { increment: 1 },
      },
    });
    expect(result).toMatchObject({
      resourceId: 'expense-1',
      version: 2,
      deduplicated: false,
    });
  });

  test('deletes an income only through a family- and version-scoped predicate', async () => {
    const { store, transaction } = createStore('member');
    const incomeDeleteCommand: DeleteIncomeCommand = {
      familyId: 'family-1',
      actorId: 'user-1',
      source: 'MANUAL',
      idempotencyKey: 'income-delete-1',
      effectiveDate: new Date('2026-08-28T00:00:00.000Z'),
      incomeId: 'income-1',
      expectedVersion: 1,
    };

    expect(deleteIncome).toBeDefined();
    const result = await deleteIncome(incomeDeleteCommand, store);

    expect(transaction.income.deleteMany).toHaveBeenCalledWith({
      where: { id: 'income-1', familyId: 'family-1', version: 1 },
    });
    expect(result).toMatchObject({
      resourceId: 'income-1',
      version: 1,
      deduplicated: false,
    });
  });

  test('deletes an expense only through a family- and version-scoped predicate', async () => {
    const { store, transaction } = createStore('admin');
    const expenseDeleteCommand: DeleteExpenseCommand = {
      familyId: 'family-1',
      actorId: 'user-1',
      source: 'MANUAL',
      idempotencyKey: 'expense-delete-1',
      effectiveDate: new Date('2026-08-28T04:00:00.000Z'),
      expenseId: 'expense-1',
      expectedVersion: 1,
    };

    expect(deleteExpense).toBeDefined();
    const result = await deleteExpense(expenseDeleteCommand, store);

    expect(transaction.expense.deleteMany).toHaveBeenCalledWith({
      where: { id: 'expense-1', familyId: 'family-1', version: 1 },
    });
    expect(result).toMatchObject({
      resourceId: 'expense-1',
      version: 1,
      deduplicated: false,
    });
  });

  test('returns a stable version conflict when the income predicate no longer matches', async () => {
    const { store, transaction } = createStore('member');
    (transaction.income.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    const incomeUpdateCommand: UpdateIncomeCommand = {
      ...command,
      incomeId: 'income-1',
      expectedVersion: 1,
      idempotencyKey: 'income-update-stale-1',
    };

    expect(updateIncome).toBeDefined();
    await expect(updateIncome(incomeUpdateCommand, store)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
      retryable: false,
    });
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  test('does not delete an expense outside the command family', async () => {
    const { store, transaction } = createStore('admin');
    (transaction.expense.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const expenseDeleteCommand: DeleteExpenseCommand = {
      familyId: 'family-1',
      actorId: 'user-1',
      source: 'MANUAL',
      idempotencyKey: 'expense-delete-missing-1',
      effectiveDate: new Date('2026-08-28T04:00:00.000Z'),
      expenseId: 'another-family-expense',
      expectedVersion: 1,
    };

    expect(deleteExpense).toBeDefined();
    await expect(deleteExpense(expenseDeleteCommand, store)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
    expect(transaction.expense.deleteMany).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});
