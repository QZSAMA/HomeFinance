import { coordinateFinancialMutation } from './financialMutationCoordinator';
import { DomainError } from './ledgerErrors';
import {
  CreateExpenseCommand,
  CreateIncomeCommand,
  FinancialMutationStore,
  LedgerRecord,
  MUTATION_SOURCES,
  MutationResult,
  MutationSource,
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
    date: requireDate(command.payload.date),
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
    date: requireDate(command.payload.date),
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
