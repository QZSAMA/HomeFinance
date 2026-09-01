export const MUTATION_SOURCES = [
  'MANUAL',
  'IMPORT',
  'RECURRING',
  'AI_CONFIRMATION',
  'BACKGROUND',
] as const;

export type MutationSource = typeof MUTATION_SOURCES[number];

export interface CreateIncomeCommand {
  familyId: string;
  actorId: string;
  source: MutationSource;
  idempotencyKey: string;
  effectiveDate: Date;
  payload: {
    amount: number;
    category: string;
    description?: string | null;
    source?: string | null;
    currency?: string;
  };
}

export interface CreateExpenseCommand {
  familyId: string;
  actorId: string;
  source: MutationSource;
  idempotencyKey: string;
  effectiveDate: Date;
  payload: {
    amount: number;
    category: string;
    description?: string | null;
    paymentMethod?: string | null;
    currency?: string;
  };
}

export type UpdateIncomeCommand = CreateIncomeCommand & {
  incomeId: string;
  expectedVersion?: number;
};

export type UpdateExpenseCommand = CreateExpenseCommand & {
  expenseId: string;
  expectedVersion?: number;
};

export type DeleteIncomeCommand = Pick<
  CreateIncomeCommand,
  'familyId' | 'actorId' | 'source' | 'idempotencyKey' | 'effectiveDate'
> & {
  incomeId: string;
  expectedVersion?: number;
};

export type DeleteExpenseCommand = Pick<
  CreateExpenseCommand,
  'familyId' | 'actorId' | 'source' | 'idempotencyKey' | 'effectiveDate'
> & {
  expenseId: string;
  expectedVersion?: number;
};

export interface MutationResult<TRecord = unknown> {
  operationId: string;
  resourceId: string;
  record?: TRecord;
  version?: number;
  deduplicated: boolean;
}

export type FinancialMutationOperation =
  | 'CREATE_INCOME'
  | 'CREATE_EXPENSE'
  | 'UPDATE_INCOME'
  | 'UPDATE_EXPENSE'
  | 'DELETE_INCOME'
  | 'DELETE_EXPENSE'
  | 'EXECUTE_RECURRING'
  | 'CONFIRM_IMPORT_BATCH'
  | 'CONFIRM_AI_PROPOSAL';

export interface CoordinateFinancialMutationInput {
  familyId: string;
  actorId: string;
  source: MutationSource;
  idempotencyKey: string;
  operation: FinancialMutationOperation;
  requestPayload: unknown;
  httpStatus?: number;
  audit: {
    action: string;
    entity: string;
  };
}

export interface LedgerRecord {
  id: string;
  version?: number;
  [key: string]: unknown;
}

export interface AiProposalItemSnapshot {
  id: string;
  ordinal: number;
  typedAction: string;
  canonicalData: unknown;
}

export interface AiProposalSnapshot {
  id: string;
  familyId: string;
  actorUserId: string | null;
  actorSnapshot: unknown;
  originalHash: string;
  status: string;
  version: number;
  expiresAt: Date;
  items: AiProposalItemSnapshot[];
}

export interface MutationExecutionResult<TRecord = LedgerRecord> {
  resourceId: string;
  record?: TRecord;
  version?: number;
  before?: unknown;
  responseFields?: Record<string, unknown>;
  deduplicated?: boolean;
}

export interface FamilyMembershipSnapshot {
  familyId: string;
  userId: string;
  role: string;
}

export interface IdempotencyScope {
  familyId: string;
  actorScope: string;
  operation: FinancialMutationOperation;
  key: string;
}

export interface IdempotencyRecordSnapshot extends IdempotencyScope {
  id: string;
  payloadHash: string;
  httpStatus: number | null;
  responseJson: unknown | null;
}

export interface LedgerTransactionClient {
  familyMember: {
    findUnique(args: {
      where: {
        familyId_userId: {
          familyId: string;
          userId: string;
        };
      };
    }): Promise<FamilyMembershipSnapshot | null>;
  };
  idempotencyRecord: {
    findUnique(args: {
      where: {
        familyId_actorScope_operation_key: IdempotencyScope;
      };
    }): Promise<IdempotencyRecordSnapshot | null>;
    create(args: {
      data: Omit<IdempotencyRecordSnapshot, 'httpStatus' | 'responseJson'>;
    }): Promise<IdempotencyRecordSnapshot>;
    update(args: {
      where: { id: string };
      data: {
        httpStatus: number;
        responseJson: unknown;
      };
    }): Promise<IdempotencyRecordSnapshot>;
  };
  income: {
    create(args: {
      data: {
        familyId: string;
        createdBy: string;
        category: string;
        amount: number;
        description?: string | null;
        source?: string | null;
        date: Date;
        currency: string;
        originType: MutationSource;
      };
    }): Promise<LedgerRecord>;
    findFirst(args: {
      where: { id: string; familyId: string };
    }): Promise<LedgerRecord | null>;
    updateMany(args: {
      where: { id: string; familyId: string; version: number };
      data: {
        amount: number;
        category: string;
        description?: string | null;
        source?: string | null;
        date: Date;
        currency: string;
        version: { increment: number };
      };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { id: string; familyId: string; version: number };
    }): Promise<{ count: number }>;
  };
  expense: {
    create(args: {
      data: {
        familyId: string;
        createdBy: string;
        category: string;
        amount: number;
        description?: string | null;
        paymentMethod?: string | null;
        date: Date;
        currency: string;
        originType: MutationSource;
      };
    }): Promise<LedgerRecord>;
    findFirst(args: {
      where: { id: string; familyId: string };
    }): Promise<LedgerRecord | null>;
    updateMany(args: {
      where: { id: string; familyId: string; version: number };
      data: {
        amount: number;
        category: string;
        description?: string | null;
        paymentMethod?: string | null;
        date: Date;
        currency: string;
        version: { increment: number };
      };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: { id: string; familyId: string; version: number };
    }): Promise<{ count: number }>;
  };
  auditEvent: {
    create(args: {
      data: {
        familyId: string;
        mutationId: string;
        actorUserId: string;
        actorSnapshot: unknown;
        action: string;
        entity: string;
        entityId: string;
        before: unknown;
        after: unknown;
      };
    }): Promise<unknown>;
  };
  /** Optional until the AI confirmation adapter is mounted; required by the confirmation service at runtime. */
  aiProposal?: {
    findFirst(args: {
      where: { id: string; familyId: string };
    }): Promise<AiProposalSnapshot | null>;
    updateMany(args: {
      where: { id: string; familyId: string; status: string; version: number };
      data: {
        status?: string;
        version?: { increment: number };
        confirmedPayload?: unknown;
        confirmedHash?: string;
        resultJson?: unknown;
      };
    }): Promise<{ count: number }>;
  };
  aiProposalItem?: {
    update(args: {
      where: { id: string };
      data: { resultJson: unknown };
    }): Promise<unknown>;
  };
}

export interface FinancialMutationStore {
  $transaction<TResult>(
    work: (transaction: LedgerTransactionClient) => Promise<TResult>,
  ): Promise<TResult>;
  /** Root Prisma adapter used only after a transaction-level arbitration conflict. */
  familyMember?: LedgerTransactionClient['familyMember'];
  idempotencyRecord?: Pick<LedgerTransactionClient['idempotencyRecord'], 'findUnique'>;
}

export type FinancialMutationExecutor<TRecord = LedgerRecord> = (
  transaction: LedgerTransactionClient,
  operationId: string,
) => Promise<MutationExecutionResult<TRecord>>;
