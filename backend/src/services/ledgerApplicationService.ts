import { coordinateFinancialMutation } from './financialMutationCoordinator';
import { DomainError } from './ledgerErrors';
import {
  CreateExpenseCommand,
  CreateIncomeCommand,
  DeleteExpenseCommand,
  DeleteIncomeCommand,
  FinancialMutationStore,
  LedgerRecord,
  MUTATION_SOURCES,
  MutationResult,
  MutationSource,
  UpdateExpenseCommand,
  UpdateIncomeCommand,
} from './ledgerTypes';

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `${field} is required.`,
      400,
    );
  }
  return value.trim();
};

const optionalText = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined || value === null) return value;
  return value.trim() || null;
};

const requireAmount = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'amount must be a positive finite number.',
      400,
    );
  }
  return value;
};

const requireDate = (value: Date): Date => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'date must be valid.',
      400,
    );
  }
  return new Date(value.getTime());
};

const normalizeCurrency = (value: string | undefined): string => {
  const currency = (value ?? 'CNY').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'currency must be a three-letter code.',
      400,
    );
  }
  return currency;
};

const validateCommandScope = (command: {
  familyId: string;
  actorId: string;
  source: MutationSource;
  idempotencyKey: string;
}) => {
  requireText(command.familyId, 'familyId');
  requireText(command.actorId, 'actorId');
  requireText(command.idempotencyKey, 'idempotencyKey');
  if (!(MUTATION_SOURCES as readonly string[]).includes(command.source)) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'source is not supported.',
      400,
    );
  }
};

const requireVersion = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'expectedVersion must be a positive integer.',
      400,
    );
  }
  return value as number;
};

const storedVersion = (record: LedgerRecord): number => {
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 1) {
    throw new DomainError(
      'INTERNAL_ERROR',
      'The stored ledger record has no valid version.',
      500,
    );
  }
  return record.version as number;
};

const resourceNotFound = (): never => {
  throw new DomainError(
    'RESOURCE_NOT_FOUND',
    'The requested family resource was not found.',
    404,
  );
};

const versionConflict = (): never => {
  throw new DomainError(
    'VERSION_CONFLICT',
    'The ledger record was changed by another request.',
    409,
  );
};

const updatedRecordMissing = (): never => {
  throw new DomainError(
    'INTERNAL_ERROR',
    'The updated ledger record could not be loaded.',
    500,
  );
};

export async function createIncome(
  command: CreateIncomeCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = {
    amount: requireAmount(command.payload.amount),
    category: requireText(command.payload.category, 'category'),
    description: optionalText(command.payload.description),
    source: optionalText(command.payload.source),
    date: requireDate(command.effectiveDate),
    currency: normalizeCurrency(command.payload.currency),
  };

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'CREATE_INCOME',
      requestPayload: { source: command.source, payload },
      httpStatus: 201,
      audit: { action: 'CREATE', entity: 'Income' },
    },
    store,
    async (transaction) => {
      const record = await transaction.income.create({
        data: {
          familyId: command.familyId,
          createdBy: command.actorId,
          ...payload,
          originType: command.source,
        },
      });
      return {
        resourceId: record.id,
        record,
        version: record.version,
      };
    },
  );
}

export async function createExpense(
  command: CreateExpenseCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = {
    amount: requireAmount(command.payload.amount),
    category: requireText(command.payload.category, 'category'),
    description: optionalText(command.payload.description),
    paymentMethod: optionalText(command.payload.paymentMethod),
    date: requireDate(command.effectiveDate),
    currency: normalizeCurrency(command.payload.currency),
  };

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'CREATE_EXPENSE',
      requestPayload: { source: command.source, payload },
      httpStatus: 201,
      audit: { action: 'CREATE', entity: 'Expense' },
    },
    store,
    async (transaction) => {
      const record = await transaction.expense.create({
        data: {
          familyId: command.familyId,
          createdBy: command.actorId,
          ...payload,
          originType: command.source,
        },
      });
      return {
        resourceId: record.id,
        record,
        version: record.version,
      };
    },
  );
}

export async function updateIncome(
  command: UpdateIncomeCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const incomeId = requireText(command.incomeId, 'incomeId');
  if (command.expectedVersion !== undefined) requireVersion(command.expectedVersion);
  const payload = {
    amount: requireAmount(command.payload.amount),
    category: requireText(command.payload.category, 'category'),
    description: optionalText(command.payload.description),
    source: optionalText(command.payload.source),
    date: requireDate(command.effectiveDate),
    currency: normalizeCurrency(command.payload.currency),
  };

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'UPDATE_INCOME',
      requestPayload: {
        incomeId,
        expectedVersion: command.expectedVersion ?? null,
        source: command.source,
        payload,
      },
      audit: { action: 'UPDATE', entity: 'Income' },
    },
    store,
    async (transaction) => {
      const before = await transaction.income.findFirst({
        where: { id: incomeId, familyId: command.familyId },
      });
      if (!before) return resourceNotFound();
      const expectedVersion = command.expectedVersion ?? storedVersion(before);
      const outcome = await transaction.income.updateMany({
        where: { id: incomeId, familyId: command.familyId, version: expectedVersion },
        data: { ...payload, version: { increment: 1 } },
      });
      if (outcome.count !== 1) return versionConflict();
      const record = await transaction.income.findFirst({
        where: { id: incomeId, familyId: command.familyId },
      });
      if (!record) return updatedRecordMissing();
      return {
        resourceId: incomeId,
        record,
        version: storedVersion(record),
        before,
      };
    },
  );
}

export async function updateExpense(
  command: UpdateExpenseCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const expenseId = requireText(command.expenseId, 'expenseId');
  if (command.expectedVersion !== undefined) requireVersion(command.expectedVersion);
  const payload = {
    amount: requireAmount(command.payload.amount),
    category: requireText(command.payload.category, 'category'),
    description: optionalText(command.payload.description),
    paymentMethod: optionalText(command.payload.paymentMethod),
    date: requireDate(command.effectiveDate),
    currency: normalizeCurrency(command.payload.currency),
  };

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'UPDATE_EXPENSE',
      requestPayload: {
        expenseId,
        expectedVersion: command.expectedVersion ?? null,
        source: command.source,
        payload,
      },
      audit: { action: 'UPDATE', entity: 'Expense' },
    },
    store,
    async (transaction) => {
      const before = await transaction.expense.findFirst({
        where: { id: expenseId, familyId: command.familyId },
      });
      if (!before) return resourceNotFound();
      const expectedVersion = command.expectedVersion ?? storedVersion(before);
      const outcome = await transaction.expense.updateMany({
        where: { id: expenseId, familyId: command.familyId, version: expectedVersion },
        data: { ...payload, version: { increment: 1 } },
      });
      if (outcome.count !== 1) return versionConflict();
      const record = await transaction.expense.findFirst({
        where: { id: expenseId, familyId: command.familyId },
      });
      if (!record) return updatedRecordMissing();
      return {
        resourceId: expenseId,
        record,
        version: storedVersion(record),
        before,
      };
    },
  );
}

export async function deleteIncome(
  command: DeleteIncomeCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const incomeId = requireText(command.incomeId, 'incomeId');
  if (command.expectedVersion !== undefined) requireVersion(command.expectedVersion);
  requireDate(command.effectiveDate);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'DELETE_INCOME',
      requestPayload: {
        incomeId,
        expectedVersion: command.expectedVersion ?? null,
        source: command.source,
      },
      audit: { action: 'DELETE', entity: 'Income' },
    },
    store,
    async (transaction) => {
      const before = await transaction.income.findFirst({
        where: { id: incomeId, familyId: command.familyId },
      });
      if (!before) return resourceNotFound();
      const expectedVersion = command.expectedVersion ?? storedVersion(before);
      const outcome = await transaction.income.deleteMany({
        where: { id: incomeId, familyId: command.familyId, version: expectedVersion },
      });
      if (outcome.count !== 1) return versionConflict();
      return {
        resourceId: incomeId,
        version: expectedVersion,
        before,
      };
    },
  );
}

export async function deleteExpense(
  command: DeleteExpenseCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const expenseId = requireText(command.expenseId, 'expenseId');
  if (command.expectedVersion !== undefined) requireVersion(command.expectedVersion);
  requireDate(command.effectiveDate);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'DELETE_EXPENSE',
      requestPayload: {
        expenseId,
        expectedVersion: command.expectedVersion ?? null,
        source: command.source,
      },
      audit: { action: 'DELETE', entity: 'Expense' },
    },
    store,
    async (transaction) => {
      const before = await transaction.expense.findFirst({
        where: { id: expenseId, familyId: command.familyId },
      });
      if (!before) return resourceNotFound();
      const expectedVersion = command.expectedVersion ?? storedVersion(before);
      const outcome = await transaction.expense.deleteMany({
        where: { id: expenseId, familyId: command.familyId, version: expectedVersion },
      });
      if (outcome.count !== 1) return versionConflict();
      return {
        resourceId: expenseId,
        version: expectedVersion,
        before,
      };
    },
  );
}
