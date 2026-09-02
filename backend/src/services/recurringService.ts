import { DomainError } from './ledgerErrors';
import { createIncome, createExpense } from './ledgerApplicationService';
import { coordinateFinancialMutation } from './financialMutationCoordinator';
import {
  FinancialMutationStore,
  LedgerRecord,
  LedgerTransactionClient,
  MutationResult,
} from './ledgerTypes';

/**
 * 计算下次执行日期
 * @param from 基准日期
 * @param frequency 频率：DAILY/WEEKLY/MONTHLY/YEARLY
 * @param interval 间隔（默认 1）
 */
export function calculateNextDate(
  from: Date,
  frequency: string,
  interval: number = 1
): Date {
  const result = new Date(from);
  switch (frequency) {
    case 'DAILY':
      result.setDate(result.getDate() + interval);
      break;
    case 'WEEKLY':
      result.setDate(result.getDate() + interval * 7);
      break;
    case 'MONTHLY':
      result.setMonth(result.getMonth() + interval);
      break;
    case 'YEARLY':
      result.setFullYear(result.getFullYear() + interval);
      break;
    default:
      result.setDate(result.getDate() + interval);
  }
  return result;
}

export interface ExecuteRecurringCommand {
  familyId: string;
  actorId: string;
  recurringId: string;
  idempotencyKey: string;
  scheduledFor?: Date;
  now?: Date;
}

interface RecurringRuleSnapshot {
  id: string;
  familyId: string;
  type: string;
  category: string;
  amount: number;
  description: string | null;
  frequency: string;
  interval: number;
  nextDate: Date;
  endDate: Date | null;
  isActive: boolean;
  lastExecutedAt: Date | null;
  version: number;
  createdBy: string;
}

export interface RecurringExecutionTransaction extends LedgerTransactionClient {
  recurringTransaction: {
    findFirst(args: { where: { id: string; familyId: string; deletedAt: null } }): Promise<RecurringRuleSnapshot | null>;
    updateMany(args: {
      where: { id: string; familyId: string; version: number; nextDate: Date };
      data: { nextDate: Date; lastExecutedAt: Date; isActive: boolean; version: { increment: number } };
    }): Promise<{ count: number }>;
  };
  recurringExecution: {
    create(args: { data: {
      familyId: string;
      recurringTransactionId: string;
      scheduledFor: Date;
      status: string;
      idempotencyKey: string;
    } }): Promise<{
      id: string;
      familyId: string;
      recurringTransactionId: string;
      scheduledFor: Date;
      status: string;
    }>;
    findUnique(args: { where: { recurringTransactionId_scheduledFor: {
      recurringTransactionId: string;
      scheduledFor: Date;
    } } }): Promise<RecurringExecutionSnapshot | null>;
    findFirst(args: { where: { familyId: string; recurringTransactionId: string }; orderBy: { scheduledFor: 'desc' } }): Promise<RecurringExecutionSnapshot | null>;
    update(args: { where: { id: string }; data: {
      status: string;
      entryType: string;
      entryId: string;
      mutationId: string;
      resultJson: unknown;
    } }): Promise<RecurringExecutionSnapshot>;
  };
}

export interface RecurringExecutionSnapshot {
  id: string;
  familyId: string;
  recurringTransactionId: string;
  scheduledFor: Date;
  status: string;
  entryType?: string | null;
  entryId?: string | null;
  mutationId?: string | null;
  resultJson?: unknown;
}

export interface RecurringExecutionResult extends MutationResult<LedgerRecord> {
  executionId: string;
  entryId: string;
  entryRecord?: LedgerRecord;
  nextDate: Date;
  isActive: boolean;
}

export interface RecurringExecutionStore {
  $transaction<TResult>(
    work: (transaction: RecurringExecutionTransaction) => Promise<TResult>,
  ): Promise<TResult>;
  familyMember?: LedgerTransactionClient['familyMember'];
  recurringExecution?: {
    findFirst(args: { where: { familyId: string; recurringTransactionId: string }; orderBy: { scheduledFor: 'desc' } }): Promise<RecurringExecutionSnapshot | null>;
    findUnique(args: { where: { recurringTransactionId_scheduledFor: {
      recurringTransactionId: string;
      scheduledFor: Date;
    } } }): Promise<RecurringExecutionSnapshot | null>;
  };
}

const requireValidDate = (value: Date, field: string): Date => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainError('VALIDATION_FAILED', `${field} must be a valid date.`, 400);
  }
  return new Date(value.getTime());
};

const sameInstant = (left: Date, right: Date) => left.getTime() === right.getTime();

export async function executeRecurring(
  command: ExecuteRecurringCommand,
  store: RecurringExecutionStore,
): Promise<RecurringExecutionResult> {
  const now = requireValidDate(command.now ?? new Date(), 'now');
  if (!command.familyId.trim() || !command.actorId.trim() || !command.recurringId.trim()) {
    throw new DomainError('VALIDATION_FAILED', 'Recurring execution identifiers are required.', 400);
  }
  if (!command.idempotencyKey.trim()) {
    throw new DomainError('VALIDATION_FAILED', 'idempotencyKey is required.', 400);
  }

  const executeInTransaction = async (transaction: RecurringExecutionTransaction, operationId: string) => {
    const rule = await transaction.recurringTransaction.findFirst({
      where: { id: command.recurringId, familyId: command.familyId, deletedAt: null },
    });
    if (!rule) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'The recurring rule was not found.', 404);
    }

    const scheduledFor = command.scheduledFor
      ? requireValidDate(command.scheduledFor, 'scheduledFor')
      : new Date(rule.nextDate.getTime());
    const occurrenceKey = `recurring:${rule.id}:${scheduledFor.toISOString()}`;
    const existing = await transaction.recurringExecution.findUnique({
      where: {
        recurringTransactionId_scheduledFor: {
          recurringTransactionId: rule.id,
          scheduledFor,
        },
      },
    });
    if (existing) {
      if (existing.status === 'COMMITTED' && existing.resultJson) {
        return mutationReplay(existing.resultJson);
      }
      throw new DomainError(
        'IDEMPOTENCY_IN_PROGRESS',
        'The recurring occurrence is already being executed; retry shortly.',
        409,
        true,
      );
    }

    if (!sameInstant(rule.nextDate, scheduledFor)) {
      throw new DomainError('RECURRING_NOT_DUE', 'The requested recurring occurrence is no longer due.', 409);
    }
    if (!rule.isActive) {
      throw new DomainError('RULE_INACTIVE', 'The recurring rule is inactive.', 409);
    }
    if (scheduledFor > now || (rule.endDate !== null && scheduledFor > rule.endDate)) {
      throw new DomainError('RECURRING_NOT_DUE', 'The recurring rule is not due.', 409);
    }

    const execution = await transaction.recurringExecution.create({
      data: {
        familyId: command.familyId,
        recurringTransactionId: rule.id,
        scheduledFor,
        status: 'PROCESSING',
        idempotencyKey: command.idempotencyKey,
      },
    });

    const ledgerStore: FinancialMutationStore = {
      $transaction: async (work) => work(transaction),
    };
    const ledgerResult = rule.type === 'INCOME'
      ? await createIncome({
        familyId: command.familyId,
        actorId: command.actorId,
        source: 'RECURRING',
        idempotencyKey: occurrenceKey,
        effectiveDate: scheduledFor,
        payload: {
          amount: rule.amount,
          category: rule.category,
          description: rule.description,
          source: '定期记账',
        },
      }, ledgerStore)
      : await createExpense({
        familyId: command.familyId,
        actorId: command.actorId,
        source: 'RECURRING',
        idempotencyKey: occurrenceKey,
        effectiveDate: scheduledFor,
        payload: {
          amount: rule.amount,
          category: rule.category,
          description: rule.description,
        },
      }, ledgerStore);

    const nextDate = calculateNextDate(rule.nextDate, rule.frequency, rule.interval);
    const shouldDeactivate = rule.endDate ? nextDate > rule.endDate : false;
    const ruleUpdate = await transaction.recurringTransaction.updateMany({
      where: {
        id: rule.id,
        familyId: command.familyId,
        version: rule.version,
        nextDate: scheduledFor,
      },
      data: {
        nextDate,
        lastExecutedAt: now,
        isActive: !shouldDeactivate,
        version: { increment: 1 },
      },
    });
    if (ruleUpdate.count !== 1) {
      throw new DomainError('VERSION_CONFLICT', 'The recurring rule changed during execution.', 409);
    }

    const executionRecord: LedgerRecord = {
      id: execution.id,
      familyId: command.familyId,
      recurringTransactionId: rule.id,
      scheduledFor,
      status: 'COMMITTED',
      entryType: rule.type,
      entryId: ledgerResult.resourceId,
      mutationId: ledgerResult.operationId,
      nextDate,
      isActive: !shouldDeactivate,
      version: rule.version + 1,
    };
    const result: RecurringExecutionResult = {
      executionId: execution.id,
      operationId,
      resourceId: execution.id,
      record: executionRecord,
      version: rule.version + 1,
      deduplicated: false,
      entryId: ledgerResult.resourceId,
      entryRecord: ledgerResult.record,
      nextDate,
      isActive: !shouldDeactivate,
    };
    await transaction.recurringExecution.update({
      where: { id: execution.id },
      data: {
        status: 'COMMITTED',
        entryType: rule.type,
        entryId: ledgerResult.resourceId,
        mutationId: ledgerResult.operationId,
        resultJson: serializeExecution(result),
      },
    });
    return {
      resourceId: result.resourceId,
      record: result.record,
      version: result.version,
      responseFields: {
        executionId: result.executionId,
        entryId: result.entryId,
        entryRecord: result.entryRecord,
        nextDate: result.nextDate,
        isActive: result.isActive,
      },
    };
  };

  try {
    return await (coordinateFinancialMutation(
      {
        familyId: command.familyId,
        actorId: command.actorId,
        source: 'RECURRING',
        idempotencyKey: command.idempotencyKey,
        operation: 'EXECUTE_RECURRING',
        requestPayload: {
          recurringId: command.recurringId,
          scheduledFor: command.scheduledFor ?? null,
        },
        audit: { action: 'EXECUTE', entity: 'RecurringExecution' },
      },
      store as unknown as FinancialMutationStore,
      (transaction, operationId) => executeInTransaction(transaction as RecurringExecutionTransaction, operationId),
    ) as Promise<RecurringExecutionResult>);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'CONCURRENT_MUTATION_CONFLICT') {
      return replayLatestExecution(command, store);
    }
    throw error;
  }
}

const serializeExecution = (result: RecurringExecutionResult) => ({
  ...result,
  nextDate: result.nextDate.toISOString(),
});

const replayExecution = (value: unknown): RecurringExecutionResult => {
  if (typeof value !== 'object' || value === null || !('executionId' in value)
    || typeof value.executionId !== 'string' || !('resourceId' in value)
    || typeof value.resourceId !== 'string' || !('operationId' in value)
    || typeof value.operationId !== 'string' || !('nextDate' in value)
    || typeof value.nextDate !== 'string' || Number.isNaN(Date.parse(value.nextDate))
    || !('entryId' in value) || typeof value.entryId !== 'string') {
    throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'The recurring execution has no replayable result yet.', 409, true);
  }
  return {
    ...(value as unknown as Omit<RecurringExecutionResult, 'nextDate'>),
    nextDate: new Date(value.nextDate),
    deduplicated: true,
  };
};

const mutationReplay = (value: unknown) => {
  const replay = replayExecution(value);
  return {
    resourceId: replay.resourceId,
    record: replay.record,
    version: replay.version,
    deduplicated: true,
    responseFields: {
      executionId: replay.executionId,
      entryId: replay.entryId,
      entryRecord: replay.entryRecord,
      nextDate: replay.nextDate,
      isActive: replay.isActive,
    },
  };
};

const replayLatestExecution = async (
  command: ExecuteRecurringCommand,
  store: RecurringExecutionStore,
): Promise<RecurringExecutionResult> => {
  if (!store.familyMember || !store.recurringExecution) {
    throw new DomainError('CONCURRENT_MUTATION_CONFLICT', 'A concurrent recurring execution must be retried.', 409, true);
  }
  const membership = await store.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId: command.familyId,
        userId: command.actorId,
      },
    },
  });
  if (!membership || !['admin', 'member'].includes(membership.role)) {
    throw new DomainError('FAMILY_WRITE_FORBIDDEN', 'The actor cannot mutate this family.', 403);
  }
  const execution = command.scheduledFor
    ? await store.recurringExecution.findUnique({
      where: {
        recurringTransactionId_scheduledFor: {
          recurringTransactionId: command.recurringId,
          scheduledFor: command.scheduledFor,
        },
      },
    })
    : await store.recurringExecution.findFirst({
      where: { familyId: command.familyId, recurringTransactionId: command.recurringId },
      orderBy: { scheduledFor: 'desc' },
    });
  if (!execution || execution.status !== 'COMMITTED' || execution.resultJson === undefined) {
    throw new DomainError('CONCURRENT_MUTATION_CONFLICT', 'A concurrent recurring execution must be retried.', 409, true);
  }
  return replayExecution(execution.resultJson);
};
