import { createHash, randomUUID } from 'crypto';
import { DomainError, mapPrismaError } from './ledgerErrors';
import {
  CoordinateFinancialMutationInput,
  FinancialMutationExecutor,
  FinancialMutationStore,
  LedgerTransactionClient,
  MutationResult,
} from './ledgerTypes';

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Mutation payload numbers must be finite.',
        400,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Mutation payload dates must be valid.',
        400,
      );
    }
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (typeof value === 'object' && value !== null) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Mutation payloads must contain plain data only.',
        400,
      );
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }

  throw new DomainError(
    'VALIDATION_FAILED',
    'Mutation payload contains an unsupported value.',
    400,
  );
};

export const hashNormalizedPayload = (payload: unknown): string => {
  const canonicalPayload = JSON.stringify(canonicalize(payload));
  return createHash('sha256').update(canonicalPayload).digest('hex');
};

const replayResult = <TRecord>(responseJson: unknown): MutationResult<TRecord> => {
  if (
    typeof responseJson !== 'object'
    || responseJson === null
    || !('operationId' in responseJson)
    || typeof responseJson.operationId !== 'string'
    || !('resourceId' in responseJson)
    || typeof responseJson.resourceId !== 'string'
  ) {
    throw new DomainError(
      'IDEMPOTENCY_IN_PROGRESS',
      'The matching mutation has not produced a replayable result yet.',
      409,
      true,
    );
  }

  return {
    ...(responseJson as MutationResult<TRecord>),
    deduplicated: true,
  };
};

const requireWriteMembership = async (
  input: CoordinateFinancialMutationInput,
  store: Pick<LedgerTransactionClient, 'familyMember'>,
) => {
  const membership = await store.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId: input.familyId,
        userId: input.actorId,
      },
    },
  });

  if (
    !membership
    || membership.familyId !== input.familyId
    || membership.userId !== input.actorId
    || !['admin', 'member'].includes(membership.role)
  ) {
    throw new DomainError(
      'FAMILY_WRITE_FORBIDDEN',
      'The actor cannot mutate this family.',
      403,
    );
  }

  return membership;
};

const isScopedArbitrationConflict = (error: unknown): boolean => {
  if (
    typeof error !== 'object'
    || error === null
    || !('code' in error)
    || error.code !== 'P2002'
  ) {
    return false;
  }

  if (!('meta' in error) || typeof error.meta !== 'object' || error.meta === null) return false;
  if ('modelName' in error.meta && error.meta.modelName !== 'IdempotencyRecord') return false;
  if ('modelName' in error.meta && error.meta.modelName === 'IdempotencyRecord') {
    if (!('target' in error.meta) || error.meta.target === null) return true;
  }
  if (!('target' in error.meta)) return false;
  const target = error.meta.target;
  if (typeof target === 'string') {
    return target.includes('IdempotencyRecord_scope_key');
  }
  if (!Array.isArray(target)) return false;

  const fields = new Set(target.map((value) => String(value)));
  return target.some((value) => String(value).includes('IdempotencyRecord_scope_key'))
    || ['familyId', 'actorScope', 'operation', 'key'].every((field) => fields.has(field));
};

const waitForWinner = async <TRecord>(
  input: CoordinateFinancialMutationInput,
  store: FinancialMutationStore,
  scope: Parameters<LedgerTransactionClient['idempotencyRecord']['findUnique']>[0]['where']['familyId_actorScope_operation_key'],
  payloadHash: string,
): Promise<MutationResult<TRecord>> => {
  if (!store.familyMember || !store.idempotencyRecord) {
    throw mapPrismaError({ code: 'P2002' });
  }

  // Authorization precedes the root read that resolves the arbitration winner.
  await requireWriteMembership(input, { familyMember: store.familyMember });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const winner = await store.idempotencyRecord.findUnique({
      where: { familyId_actorScope_operation_key: scope },
    });

    if (winner) {
      if (winner.payloadHash !== payloadHash) {
        throw new DomainError(
          'IDEMPOTENCY_KEY_REUSED',
          'The idempotency key was already used for another payload.',
          409,
        );
      }
      if (winner.responseJson !== null) {
        return replayResult<TRecord>(winner.responseJson);
      }
    }

    if (attempt < 2) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }

  throw new DomainError(
    'IDEMPOTENCY_IN_PROGRESS',
    'The matching mutation is still in progress; retry shortly.',
    409,
    true,
  );
};

const validateScope = (input: CoordinateFinancialMutationInput) => {
  if (!input.familyId.trim() || !input.actorId.trim()) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Family and actor identifiers are required.',
      400,
    );
  }

  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 255) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'A valid idempotency key is required.',
      400,
    );
  }
};

export async function coordinateFinancialMutation<TRecord>(
  input: CoordinateFinancialMutationInput,
  store: FinancialMutationStore,
  execute: FinancialMutationExecutor<TRecord>,
): Promise<MutationResult<TRecord>> {
  validateScope(input);
  const payloadHash = hashNormalizedPayload({
    source: input.source,
    payload: input.requestPayload,
  });
  const actorScope = `USER:${input.actorId}`;
  const scope = {
    familyId: input.familyId,
    actorScope,
    operation: input.operation,
    key: input.idempotencyKey,
  };

  try {
    return await store.$transaction(async (transaction) => {
      const membership = await requireWriteMembership(input, transaction);
      const existing = await transaction.idempotencyRecord.findUnique({
        where: { familyId_actorScope_operation_key: scope },
      });

      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new DomainError(
            'IDEMPOTENCY_KEY_REUSED',
            'The idempotency key was already used for another payload.',
            409,
          );
        }
        return replayResult<TRecord>(existing.responseJson);
      }

      const operation = await transaction.idempotencyRecord.create({
        data: {
          id: randomUUID(),
          ...scope,
          payloadHash,
        },
      });
      const mutation = await execute(transaction, operation.id);
      const result: MutationResult<TRecord> = {
        operationId: operation.id,
        resourceId: mutation.resourceId,
        ...(mutation.record === undefined ? {} : { record: mutation.record }),
        ...(mutation.version === undefined ? {} : { version: mutation.version }),
        deduplicated: false,
      };

      await transaction.auditEvent.create({
        data: {
          familyId: input.familyId,
          mutationId: operation.id,
          actorUserId: input.actorId,
          actorSnapshot: {
            userId: membership.userId,
            role: membership.role,
          },
          action: input.audit.action,
          entity: input.audit.entity,
          entityId: mutation.resourceId,
          before: mutation.before ?? null,
          after: mutation.record ?? { id: mutation.resourceId },
        },
      });
      await transaction.idempotencyRecord.update({
        where: { id: operation.id },
        data: {
          httpStatus: input.httpStatus ?? 200,
          responseJson: result,
        },
      });

      return result;
    });
  } catch (error) {
    if (isScopedArbitrationConflict(error)) {
      try {
        return await waitForWinner<TRecord>(input, store, scope, payloadHash);
      } catch (winnerError) {
        if (winnerError instanceof DomainError && winnerError.code !== 'CONCURRENT_MUTATION_CONFLICT') {
          throw winnerError;
        }
      }
    }
    throw mapPrismaError(error);
  }
}
