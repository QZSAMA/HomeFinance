import { coordinateFinancialMutation } from './financialMutationCoordinator';
import { DomainError } from './ledgerErrors';
import {
  CreateAssetCommand,
  CreateLiabilityCommand,
  DeleteAssetCommand,
  DeleteLiabilityCommand,
  FinancialMutationStore,
  LedgerRecord,
  LedgerTransactionClient,
  MutationExecutionResult,
  MutationResult,
  MUTATION_SOURCES,
  UpdateAssetCommand,
  UpdateLiabilityCommand,
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

const requireVersion = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return invalid('expectedVersion must be a positive integer.');
  }
  return value as number;
};

const storedVersion = (record: LedgerRecord): number => {
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 1) {
    throw new DomainError(
      'INTERNAL_ERROR',
      'The stored Asset record has no valid version.',
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
    'The Asset was changed by another request.',
    409,
  );
};

const updatedRecordMissing = (): never => {
  throw new DomainError(
    'INTERNAL_ERROR',
    'The updated Asset record could not be loaded.',
    500,
  );
};

const storedLiabilityVersion = (record: LedgerRecord): number => {
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 1) {
    throw new DomainError(
      'INTERNAL_ERROR',
      'The stored Liability record has no valid version.',
      500,
    );
  }
  return record.version as number;
};

const liabilityVersionConflict = (): never => {
  throw new DomainError(
    'VERSION_CONFLICT',
    'The Liability was changed by another request.',
    409,
  );
};

const liabilityUpdatedRecordMissing = (): never => {
  throw new DomainError(
    'INTERNAL_ERROR',
    'The updated Liability record could not be loaded.',
    500,
  );
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

const assetMutationData = (command: CreateAssetCommand) => ({
  familyId: command.familyId,
  name: requireText(command.payload.name, 'name'),
  type: requireText(command.payload.type, 'type'),
  category: optionalText(command.payload.category, 'category'),
  value: requireNonNegativeAmount(command.payload.value, 'value'),
  costBasis: optionalNonNegativeAmount(command.payload.costBasis, 'costBasis'),
  currency: normalizeCurrency(command.payload.currency),
  purchaseDate: optionalDate(command.payload.purchaseDate, 'purchaseDate'),
  description: optionalText(command.payload.description, 'description'),
});

const liabilityMutationData = (command: CreateLiabilityCommand) => ({
  familyId: command.familyId,
  name: requireText(command.payload.name, 'name'),
  type: requireText(command.payload.type, 'type'),
  amount: requireNonNegativeAmount(command.payload.amount, 'amount'),
  interestRate: optionalNonNegativeAmount(command.payload.interestRate, 'interestRate'),
  startDate: optionalDate(command.payload.startDate, 'startDate'),
  endDate: optionalDate(command.payload.endDate, 'endDate'),
  currency: normalizeCurrency(command.payload.currency),
  description: optionalText(command.payload.description, 'description'),
});

export async function createAssetInTransaction(
  command: CreateAssetCommand,
  transaction: LedgerTransactionClient,
): Promise<MutationExecutionResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = assetMutationData(command);
  const record = await requireAssetStore(transaction).create({ data: payload });
  return {
    resourceId: record.id,
    record,
    version: record.version,
  };
}

export async function createAsset(
  command: CreateAssetCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = assetMutationData(command);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'CREATE_ASSET',
      requestPayload: { source: command.source, payload },
      httpStatus: 201,
      audit: { action: 'CREATE', entity: 'Asset' },
    },
    store,
    async (transaction) => createAssetInTransaction(command, transaction),
  );
}

export async function updateAsset(
  command: UpdateAssetCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const assetId = requireText(command.assetId, 'assetId');
  if (command.expectedVersion !== undefined) requireVersion(command.expectedVersion);
  const payload = assetMutationData(command);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'UPDATE_ASSET',
      requestPayload: {
        assetId,
        expectedVersion: command.expectedVersion ?? null,
        source: command.source,
        payload,
      },
      audit: { action: 'UPDATE', entity: 'Asset' },
    },
    store,
    async (transaction) => {
      const before = await requireAssetStore(transaction).findFirst({
        where: { id: assetId, familyId: command.familyId },
      });
      if (!before) return resourceNotFound();
      const expectedVersion = command.expectedVersion ?? storedVersion(before);
      const outcome = await requireAssetStore(transaction).updateMany({
        where: { id: assetId, familyId: command.familyId, version: expectedVersion },
        data: { ...payload, version: { increment: 1 } },
      });
      if (outcome.count !== 1) return versionConflict();
      const record = await requireAssetStore(transaction).findFirst({
        where: { id: assetId, familyId: command.familyId },
      });
      if (!record) return updatedRecordMissing();
      return {
        resourceId: assetId,
        record,
        version: storedVersion(record),
        before,
      };
    },
  );
}

export async function deleteAsset(
  command: DeleteAssetCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const assetId = requireText(command.assetId, 'assetId');
  if (command.expectedVersion !== undefined) requireVersion(command.expectedVersion);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'DELETE_ASSET',
      requestPayload: {
        assetId,
        expectedVersion: command.expectedVersion ?? null,
        source: command.source,
      },
      audit: { action: 'DELETE', entity: 'Asset' },
    },
    store,
    async (transaction) => {
      const assetStore = requireAssetStore(transaction);
      const before = await assetStore.findFirst({
        where: { id: assetId, familyId: command.familyId },
      });
      if (!before) return resourceNotFound();
      const expectedVersion = command.expectedVersion ?? storedVersion(before);
      const outcome = await assetStore.deleteMany({
        where: { id: assetId, familyId: command.familyId, version: expectedVersion },
      });
      if (outcome.count !== 1) return versionConflict();
      return {
        resourceId: assetId,
        version: expectedVersion,
        before,
      };
    },
  );
}

export async function createLiabilityInTransaction(
  command: CreateLiabilityCommand,
  transaction: LedgerTransactionClient,
): Promise<MutationExecutionResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = liabilityMutationData(command);
  const record = await requireLiabilityStore(transaction).create({ data: payload });
  return {
    resourceId: record.id,
    record,
    version: record.version,
  };
}

export async function createLiability(
  command: CreateLiabilityCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = liabilityMutationData(command);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'CREATE_LIABILITY',
      requestPayload: { source: command.source, payload },
      httpStatus: 201,
      audit: { action: 'CREATE', entity: 'Liability' },
    },
    store,
    async (transaction) => createLiabilityInTransaction(command, transaction),
  );
}

export async function updateLiability(
  command: UpdateLiabilityCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const liabilityId = requireText(command.liabilityId, 'liabilityId');
  if (command.expectedVersion !== undefined) requireVersion(command.expectedVersion);
  const payload = liabilityMutationData(command);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'UPDATE_LIABILITY',
      requestPayload: {
        liabilityId,
        expectedVersion: command.expectedVersion ?? null,
        source: command.source,
        payload,
      },
      audit: { action: 'UPDATE', entity: 'Liability' },
    },
    store,
    async (transaction) => {
      const liabilityStore = requireLiabilityStore(transaction);
      const before = await liabilityStore.findFirst({
        where: { id: liabilityId, familyId: command.familyId },
      });
      if (!before) return resourceNotFound();
      const expectedVersion = command.expectedVersion ?? storedLiabilityVersion(before);
      const outcome = await liabilityStore.updateMany({
        where: { id: liabilityId, familyId: command.familyId, version: expectedVersion },
        data: { ...payload, version: { increment: 1 } },
      });
      if (outcome.count !== 1) return liabilityVersionConflict();
      const record = await liabilityStore.findFirst({
        where: { id: liabilityId, familyId: command.familyId },
      });
      if (!record) return liabilityUpdatedRecordMissing();
      return {
        resourceId: liabilityId,
        record,
        version: storedLiabilityVersion(record),
        before,
      };
    },
  );
}

export async function deleteLiability(
  command: DeleteLiabilityCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const liabilityId = requireText(command.liabilityId, 'liabilityId');
  if (command.expectedVersion !== undefined) requireVersion(command.expectedVersion);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'DELETE_LIABILITY',
      requestPayload: {
        liabilityId,
        expectedVersion: command.expectedVersion ?? null,
        source: command.source,
      },
      audit: { action: 'DELETE', entity: 'Liability' },
    },
    store,
    async (transaction) => {
      const liabilityStore = requireLiabilityStore(transaction);
      const before = await liabilityStore.findFirst({
        where: { id: liabilityId, familyId: command.familyId },
      });
      if (!before) return resourceNotFound();
      const expectedVersion = command.expectedVersion ?? storedLiabilityVersion(before);
      const outcome = await liabilityStore.deleteMany({
        where: { id: liabilityId, familyId: command.familyId, version: expectedVersion },
      });
      if (outcome.count !== 1) return liabilityVersionConflict();
      return {
        resourceId: liabilityId,
        version: expectedVersion,
        before,
      };
    },
  );
}
