export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'FAMILY_WRITE_FORBIDDEN'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'CONCURRENT_MUTATION_CONFLICT'
  | 'IMPORT_BATCH_NOT_CONFIRMABLE'
  | 'AI_PROPOSAL_NOT_CONFIRMABLE'
  | 'AI_PROPOSAL_EXPIRED'
  | 'AI_PROPOSAL_HASH_MISMATCH'
  | 'AI_BALANCE_MUTATION_UNAVAILABLE'
  | 'RULE_INACTIVE'
  | 'RECURRING_NOT_DUE'
  | 'RESOURCE_NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'TRANSIENT_DATABASE_FAILURE'
  | 'INVALID_TIMEZONE'
  | 'FAMILY_TIMEZONE_IMMUTABLE'
  | 'INVALID_PERIOD_WINDOW'
  | 'RECONCILIATION_FAILED'
  | 'GOAL_CONTRIBUTION_CONFLICT'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const prismaCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
};

export const mapPrismaError = (error: unknown): DomainError => {
  if (error instanceof DomainError) return error;

  switch (prismaCode(error)) {
    case 'P2002':
      return new DomainError(
        'CONCURRENT_MUTATION_CONFLICT',
        'A concurrent mutation must be resolved before retrying.',
        409,
        true,
        error,
      );
    case 'P2025':
      return new DomainError(
        'RESOURCE_NOT_FOUND',
        'The requested family resource was not found.',
        404,
        false,
        error,
      );
    case 'P2034':
      return new DomainError(
        'TRANSIENT_DATABASE_FAILURE',
        'The database transaction could not be completed.',
        503,
        true,
        error,
      );
    default:
      return new DomainError(
        'INTERNAL_ERROR',
        'The mutation could not be completed.',
        500,
        false,
        error,
      );
  }
};
