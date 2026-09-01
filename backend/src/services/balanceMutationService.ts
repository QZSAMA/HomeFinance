import { DomainError } from './ledgerErrors';
import {
  CreateAssetCommand,
  CreateLiabilityCommand,
  LedgerRecord,
  LedgerTransactionClient,
  MutationExecutionResult,
  MUTATION_SOURCES,
} from './ledgerTypes';

const invalid = (message: string): never => {
  throw new DomainError('VALIDATION_FAILED', message, 400);
};

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) return invalid(`${field} must be a nonblank string.`);
  return value.trim();
};

const optionalText = (value: unknown, field: string): string | null | undefined => {
  if (value === undefined || value === null) return value;
  return requireText(value, field);
};

const requireNonNegativeAmount = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return invalid(`${field} must be a finite non-negative number.`);
  }
  return Object.is(value, -0) ? 0 : value;
};

const optionalNonNegativeAmount = (value: unknown, field: string): number | null | undefined => (
  value === undefined || value === null ? value : requireNonNegativeAmount(value, field)
);

const optionalDate = (value: unknown, field: string): Date | null | undefined => {
  if (value === undefined || value === null) return value;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return invalid(`${field} must be a valid date.`);
  }
  return new Date(value.getTime());
};

const normalizeCurrency = (value: unknown): string => {
  const currency = value === undefined || value === null ? 'CNY' : requireText(value, 'currency');
  const normalized = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return invalid('currency must be a three-letter code.');
  return normalized;
};

const validateCommandScope = (command: {
  familyId: string;
  actorId: string;
  source: string;
  idempotencyKey: string;
}) => {
  requireText(command.familyId, 'familyId');
  requireText(command.actorId, 'actorId');
  requireText(command.idempotencyKey, 'idempotencyKey');
  if (!(MUTATION_SOURCES as readonly string[]).includes(command.source)) {
    return invalid('source is not supported.');
  }
};

const requireAssetStore = (transaction: LedgerTransactionClient) => {
  if (!transaction.asset) {
    throw new DomainError(
      'INTERNAL_ERROR',
      'Asset mutation is not available for this transaction store.',
      500,
    );
  }
  return transaction.asset;
};

const requireLiabilityStore = (transaction: LedgerTransactionClient) => {
  if (!transaction.liability) {
    throw new DomainError(
      'INTERNAL_ERROR',
      'Liability mutation is not available for this transaction store.',
      500,
    );
  }
  return transaction.liability;
};

export async function createAssetInTransaction(
  command: CreateAssetCommand,
  transaction: LedgerTransactionClient,
): Promise<MutationExecutionResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = {
    familyId: command.familyId,
    name: requireText(command.payload.name, 'name'),
    type: requireText(command.payload.type, 'type'),
    category: optionalText(command.payload.category, 'category'),
    value: requireNonNegativeAmount(command.payload.value, 'value'),
    costBasis: optionalNonNegativeAmount(command.payload.costBasis, 'costBasis'),
    currency: normalizeCurrency(command.payload.currency),
    purchaseDate: optionalDate(command.payload.purchaseDate, 'purchaseDate'),
    description: optionalText(command.payload.description, 'description'),
  };
  const record = await requireAssetStore(transaction).create({ data: payload });
  return {
    resourceId: record.id,
    record,
    version: record.version,
  };
}

export async function createLiabilityInTransaction(
  command: CreateLiabilityCommand,
  transaction: LedgerTransactionClient,
): Promise<MutationExecutionResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = {
    familyId: command.familyId,
    name: requireText(command.payload.name, 'name'),
    type: requireText(command.payload.type, 'type'),
    amount: requireNonNegativeAmount(command.payload.amount, 'amount'),
    interestRate: optionalNonNegativeAmount(command.payload.interestRate, 'interestRate'),
    startDate: optionalDate(command.payload.startDate, 'startDate'),
    endDate: optionalDate(command.payload.endDate, 'endDate'),
    currency: normalizeCurrency(command.payload.currency),
    description: optionalText(command.payload.description, 'description'),
  };
  const record = await requireLiabilityStore(transaction).create({ data: payload });
  return {
    resourceId: record.id,
    record,
    version: record.version,
  };
}
