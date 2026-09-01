import * as recurringService from './recurringService';

type ExecuteRecurring = (
  command: {
    familyId: string;
    actorId: string;
    recurringId: string;
    idempotencyKey: string;
    scheduledFor?: Date;
    now: Date;
  },
  store: unknown,
) => Promise<unknown>;

const executeRecurring = (recurringService as unknown as {
  executeRecurring?: ExecuteRecurring;
}).executeRecurring;

const command = {
  familyId: 'family-1',
  actorId: 'user-1',
  recurringId: 'recurring-1',
  idempotencyKey: 'recurring-execution-1',
  scheduledFor: new Date('2026-08-01T00:00:00.000Z'),
  now: new Date('2026-09-01T12:00:00.000Z'),
};

const inactiveRule = {
  id: 'recurring-1',
  familyId: 'family-1',
  type: 'INCOME',
  category: '工资',
  amount: 100,
  description: 'inactive rule',
  frequency: 'MONTHLY',
  interval: 1,
  nextDate: new Date('2026-08-01T00:00:00.000Z'),
  endDate: null as Date | null,
  isActive: false,
  lastExecutedAt: null as Date | null,
  version: 1,
  createdBy: 'user-1',
};

const dueRule = {
  ...inactiveRule,
  isActive: true,
};

const createStore = (rule: typeof inactiveRule) => {
  const transaction = {
    familyMember: {
      findUnique: jest.fn().mockResolvedValue({
        familyId: 'family-1',
        userId: 'user-1',
        role: 'member',
      }),
    },
    recurringTransaction: {
      findFirst: jest.fn().mockResolvedValue(rule),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    recurringExecution: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    income: { create: jest.fn() },
    expense: { create: jest.fn() },
    idempotencyRecord: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'operation-default',
        familyId: 'family-1',
        actorScope: 'USER:user-1',
        operation: 'EXECUTE_RECURRING',
        key: 'recurring-execution-1',
        payloadHash: 'hash',
        httpStatus: null,
        responseJson: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { create: jest.fn() },
  };

  return {
    transaction,
    store: {
      $transaction: jest.fn(async (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction)),
    },
  };
};

describe('RecurringService exactly-once execution', () => {
  test('rejects an inactive rule before creating execution or ledger facts', async () => {
    if (!executeRecurring) throw new Error('executeRecurring is not implemented');
    const { store, transaction } = createStore(inactiveRule);

    await expect(executeRecurring(command, store)).rejects.toMatchObject({
      code: 'RULE_INACTIVE',
      status: 409,
    });

    expect(transaction.recurringExecution.create).not.toHaveBeenCalled();
    expect(transaction.recurringTransaction.updateMany).not.toHaveBeenCalled();
  });

  test('rejects a future occurrence before creating execution or ledger facts', async () => {
    if (!executeRecurring) throw new Error('executeRecurring is not implemented');
    const { store, transaction } = createStore({
      ...dueRule,
      nextDate: new Date('2026-09-02T00:00:00.000Z'),
    });

    await expect(executeRecurring(command, store)).rejects.toMatchObject({
      code: 'RECURRING_NOT_DUE',
      status: 409,
    });

    expect(transaction.recurringExecution.create).not.toHaveBeenCalled();
    expect(transaction.income.create).not.toHaveBeenCalled();
    expect(transaction.expense.create).not.toHaveBeenCalled();
    expect(transaction.recurringTransaction.updateMany).not.toHaveBeenCalled();
  });

  test('rejects an occurrence after endDate before creating execution or ledger facts', async () => {
    if (!executeRecurring) throw new Error('executeRecurring is not implemented');
    const { store, transaction } = createStore({
      ...dueRule,
      endDate: new Date('2026-07-31T23:59:59.999Z'),
    });

    await expect(executeRecurring(command, store)).rejects.toMatchObject({
      code: 'RECURRING_NOT_DUE',
      status: 409,
    });

    expect(transaction.recurringExecution.create).not.toHaveBeenCalled();
    expect(transaction.income.create).not.toHaveBeenCalled();
    expect(transaction.expense.create).not.toHaveBeenCalled();
    expect(transaction.recurringTransaction.updateMany).not.toHaveBeenCalled();
  });

  test('creates one execution, ledger fact, and next occurrence in one transaction', async () => {
    if (!executeRecurring) throw new Error('executeRecurring is not implemented');
    const { store, transaction } = createStore(dueRule);
    const ledgerRecord = {
      id: 'income-1',
      familyId: 'family-1',
      createdBy: 'user-1',
      category: '工资',
      amount: 100,
      description: 'inactive rule',
      source: null,
      date: dueRule.nextDate,
      currency: 'CNY',
      originType: 'RECURRING',
      version: 1,
    };
    transaction.recurringExecution.create.mockResolvedValue({
      id: 'execution-1',
      familyId: 'family-1',
      recurringTransactionId: 'recurring-1',
      scheduledFor: dueRule.nextDate,
      status: 'PROCESSING',
    });
    transaction.income.create.mockResolvedValue(ledgerRecord);
    transaction.idempotencyRecord.create.mockResolvedValue({
      id: 'operation-1',
      familyId: 'family-1',
      actorScope: 'USER:user-1',
      operation: 'CREATE_INCOME',
      key: 'recurring:recurring-1:2026-08-01T00:00:00.000Z',
      payloadHash: 'hash',
      httpStatus: null,
      responseJson: null,
    });
    transaction.recurringTransaction.updateMany.mockResolvedValue({ count: 1 });
    transaction.recurringExecution.update.mockResolvedValue({
      id: 'execution-1',
      status: 'COMMITTED',
    });

    const result = await executeRecurring(command, store) as {
      executionId: string;
      resourceId: string;
      entryId: string;
      operationId: string;
      deduplicated: boolean;
      nextDate: Date;
      isActive: boolean;
    };

    expect(result).toMatchObject({
      executionId: 'execution-1',
      resourceId: 'execution-1',
      entryId: 'income-1',
      operationId: 'operation-1',
      deduplicated: false,
      isActive: true,
    });
    expect(result.nextDate).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    expect(transaction.recurringExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'family-1',
        recurringTransactionId: 'recurring-1',
        scheduledFor: dueRule.nextDate,
      }),
    });
    expect(transaction.income.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'family-1',
        createdBy: 'user-1',
        category: '工资',
        amount: 100,
        date: dueRule.nextDate,
        originType: 'RECURRING',
      }),
    });
    expect(transaction.recurringTransaction.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'recurring-1',
        familyId: 'family-1',
        version: 1,
        nextDate: dueRule.nextDate,
      }),
      data: expect.objectContaining({
        nextDate: new Date('2026-09-01T00:00:00.000Z'),
        lastExecutedAt: command.now,
      }),
    });
    expect(transaction.recurringExecution.update).toHaveBeenCalledWith({
      where: { id: 'execution-1' },
      data: expect.objectContaining({
        status: 'COMMITTED',
        entryId: 'income-1',
      }),
    });
  });

  test('propagates a failed rule advance so the outer transaction can roll back every fact', async () => {
    if (!executeRecurring) throw new Error('executeRecurring is not implemented');
    const { store, transaction } = createStore(dueRule);
    transaction.recurringExecution.create.mockResolvedValue({ id: 'execution-1' });
    transaction.income.create.mockResolvedValue({
      id: 'income-1',
      familyId: 'family-1',
      createdBy: 'user-1',
      category: '工资',
      amount: 100,
      description: null,
      source: null,
      date: dueRule.nextDate,
      currency: 'CNY',
      originType: 'RECURRING',
      version: 1,
    });
    transaction.idempotencyRecord.create.mockResolvedValue({
      id: 'operation-1',
      familyId: 'family-1',
      actorScope: 'USER:user-1',
      operation: 'CREATE_INCOME',
      key: 'recurring:recurring-1:2026-08-01T00:00:00.000Z',
      payloadHash: 'hash',
      httpStatus: null,
      responseJson: null,
    });
    transaction.recurringTransaction.updateMany.mockRejectedValue(new Error('write failed'));

    await expect(executeRecurring(command, store)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      retryable: false,
    });
    expect(transaction.recurringExecution.update).not.toHaveBeenCalled();
    expect(store.$transaction).toHaveBeenCalledTimes(1);
  });

  test('creates the next due occurrence instead of replaying the previously committed occurrence', async () => {
    if (!executeRecurring) throw new Error('executeRecurring is not implemented');
    const septemberRule = {
      ...dueRule,
      nextDate: new Date('2026-09-01T00:00:00.000Z'),
      version: 2,
    };
    const { store, transaction } = createStore(septemberRule);
    transaction.recurringExecution.findFirst.mockResolvedValue({
      id: 'execution-august',
      familyId: 'family-1',
      recurringTransactionId: 'recurring-1',
      scheduledFor: new Date('2026-08-01T00:00:00.000Z'),
      status: 'COMMITTED',
      resultJson: {
        executionId: 'execution-august',
        operationId: 'operation-august',
        resourceId: 'income-august',
        deduplicated: false,
        nextDate: '2026-09-01T00:00:00.000Z',
        isActive: true,
      },
    });
    transaction.recurringExecution.create.mockResolvedValue({
      id: 'execution-september',
      familyId: 'family-1',
      recurringTransactionId: 'recurring-1',
      scheduledFor: septemberRule.nextDate,
      status: 'PROCESSING',
    });
    transaction.income.create.mockResolvedValue({
      id: 'income-september',
      version: 1,
      amount: 100,
    });
    transaction.recurringTransaction.updateMany.mockResolvedValue({ count: 1 });
    transaction.recurringExecution.update.mockResolvedValue({ id: 'execution-september' });

    const result = await executeRecurring({
      ...command,
      idempotencyKey: 'recurring-execution-september',
      scheduledFor: septemberRule.nextDate,
    }, store) as { executionId: string; resourceId: string; entryId: string; deduplicated: boolean };

    expect(result).toMatchObject({
      executionId: 'execution-september',
      resourceId: 'execution-september',
      entryId: 'income-september',
      deduplicated: false,
    });
    expect(transaction.recurringExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scheduledFor: septemberRule.nextDate }),
    });
  });
});
