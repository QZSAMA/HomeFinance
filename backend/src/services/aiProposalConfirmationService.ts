import { createIncomeInTransaction, createExpenseInTransaction } from './ledgerApplicationService';
import { coordinateFinancialMutation, hashNormalizedPayload } from './financialMutationCoordinator';
import { DomainError } from './ledgerErrors';
import { normalizeAction } from './aiProposalService';
import type { AIAction } from './aiActions';
import {
  AiProposalSnapshot,
  CreateExpenseCommand,
  CreateIncomeCommand,
  FinancialMutationStore,
  LedgerTransactionClient,
  MutationResult,
} from './ledgerTypes';

export interface ConfirmAiProposalInput {
  familyId: string;
  actorUserId: string;
  proposalId: string;
  expectedVersion: number;
  expectedHash: string;
  idempotencyKey: string;
  actions: AIAction[];
  now?: Date;
}

export interface ConfirmedAiActionResult {
  ordinal: number;
  type: 'create_income' | 'create_expense';
  resourceId: string;
  version?: number;
}

export interface AiProposalConfirmationResponse {
  proposalId: string;
  status: 'EXECUTED';
  version: number;
  actions: ConfirmedAiActionResult[];
}

const isCreateLedgerAction = (action: AIAction): action is AIAction & {
  type: 'create_income' | 'create_expense';
} => action.type === 'create_income' || action.type === 'create_expense';

const requireValidDate = (value: Date | undefined): Date => {
  const now = value ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new DomainError('VALIDATION_FAILED', 'The AI confirmation clock must be valid.', 400);
  }
  return now;
};

const requireExpectedVersion = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DomainError('VALIDATION_FAILED', 'expectedVersion must be a positive integer.', 400);
  }
  return value as number;
};

const requireExpectedHash = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new DomainError('VALIDATION_FAILED', 'expectedHash must be a SHA-256 hash.', 400);
  }
  return value;
};

const requireProposalStore = (transaction: LedgerTransactionClient) => {
  if (!transaction.aiProposal || !transaction.aiProposalItem) {
    throw new DomainError(
      'INTERNAL_ERROR',
      'AI proposal confirmation is not available for this transaction store.',
      500,
    );
  }
  return {
    proposal: transaction.aiProposal,
    item: transaction.aiProposalItem,
  };
};

const proposalNotConfirmable = (): never => {
  throw new DomainError(
    'AI_PROPOSAL_NOT_CONFIRMABLE',
    'The AI proposal is no longer confirmable.',
    409,
  );
};

const proposalNotFound = (): never => {
  throw new DomainError(
    'RESOURCE_NOT_FOUND',
    'The AI proposal was not found in this family.',
    404,
  );
};

const validateFinalActions = (proposal: AiProposalSnapshot, actions: AIAction[]) => {
  if (!Array.isArray(actions) || actions.length > proposal.items.length || actions.length === 0) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'The confirmed actions must be non-empty and cannot exceed the proposal item count.',
      400,
    );
  }

  const normalizedActions = actions.map((action) => normalizeAction(action));
  const usedItemIds = new Set<string>();
  const resolvedItems = normalizedActions.map((action, ordinal) => {
    const item = action.proposalItemId
      ? proposal.items.find((candidate) => candidate.id === action.proposalItemId)
      : proposal.items[ordinal];
    if (!item || usedItemIds.has(item.id)) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Each confirmed action must reference a unique proposal item.',
        400,
      );
    }
    usedItemIds.add(item.id);
    return item;
  });
  normalizedActions.forEach((action, ordinal) => {
    const item = resolvedItems[ordinal];
    if (!item) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'The confirmed actions cannot exceed the proposal item count.',
        400,
      );
    }
    if (
      !isCreateLedgerAction(action)
      || !['create_income', 'create_expense'].includes(item.typedAction)
    ) {
      throw new DomainError(
        'AI_BALANCE_MUTATION_UNAVAILABLE',
        'Asset and liability AI confirmation requires the balance mutation service.',
        409,
      );
    }
  });
  return { actions: normalizedActions, items: resolvedItems };
};

const actionDate = (value: unknown, now: Date): Date => {
  if (value === undefined) return now;
  if (typeof value !== 'string') {
    throw new DomainError('VALIDATION_FAILED', 'AI action date must use YYYY-MM-DD.', 400);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError('VALIDATION_FAILED', 'AI action date must be valid.', 400);
  }
  return date;
};

const actionDescription = (value: unknown): string | undefined => (
  value === undefined || value === null ? undefined : String(value)
);

const runLedgerAction = async (
  action: AIAction & { type: 'create_income' | 'create_expense' },
  ordinal: number,
  input: ConfirmAiProposalInput,
  now: Date,
  transaction: LedgerTransactionClient,
): Promise<ConfirmedAiActionResult> => {
  const data = action.data;
  const idempotencyKey = `${input.idempotencyKey}:item:${ordinal}`;
  const common = {
    familyId: input.familyId,
    actorId: input.actorUserId,
    source: 'AI_CONFIRMATION' as const,
    idempotencyKey,
    effectiveDate: actionDate(data.date, now),
  };
  const result = action.type === 'create_income'
    ? await createIncomeInTransaction({
      ...common,
      payload: {
        amount: Number(data.amount),
        category: typeof data.category === 'string' ? data.category : '其他收入',
        description: actionDescription(data.description),
        source: actionDescription(data.source),
        currency: typeof data.currency === 'string' ? data.currency : 'CNY',
      },
    } satisfies CreateIncomeCommand, transaction)
    : await createExpenseInTransaction({
      ...common,
      payload: {
        amount: Number(data.amount),
        category: typeof data.category === 'string' ? data.category : '其他支出',
        description: actionDescription(data.description),
        paymentMethod: actionDescription(data.paymentMethod),
        currency: typeof data.currency === 'string' ? data.currency : 'CNY',
      },
    } satisfies CreateExpenseCommand, transaction);

  return {
    ordinal,
    type: action.type,
    resourceId: result.resourceId,
    version: result.version,
  };
};

const resultRecord = (
  proposal: AiProposalSnapshot,
  version: number,
  actions: ConfirmedAiActionResult[],
): AiProposalConfirmationResponse => ({
  proposalId: proposal.id,
  status: 'EXECUTED',
  version,
  actions,
});

export async function confirmAiProposal(
  input: ConfirmAiProposalInput,
  store: FinancialMutationStore,
): Promise<MutationResult<AiProposalConfirmationResponse>> {
  if (!input.familyId.trim() || !input.actorUserId.trim() || !input.proposalId.trim()) {
    throw new DomainError('VALIDATION_FAILED', 'familyId, actorUserId and proposalId are required.', 400);
  }
  requireExpectedVersion(input.expectedVersion);
  requireExpectedHash(input.expectedHash);
  const now = requireValidDate(input.now);

  return coordinateFinancialMutation<AiProposalConfirmationResponse>(
    {
      familyId: input.familyId,
      actorId: input.actorUserId,
      source: 'AI_CONFIRMATION',
      idempotencyKey: input.idempotencyKey,
      operation: 'CONFIRM_AI_PROPOSAL',
      requestPayload: {
        proposalId: input.proposalId,
        expectedVersion: input.expectedVersion,
        expectedHash: input.expectedHash,
        actions: input.actions,
      },
      audit: { action: 'CONFIRM', entity: 'AiProposal' },
    },
    store,
    async (transaction) => {
      const proposalStore = requireProposalStore(transaction);
      const proposal = await proposalStore.proposal.findFirst({
        where: { id: input.proposalId, familyId: input.familyId },
      });
      if (!proposal) return proposalNotFound();
      if (proposal.originalHash !== input.expectedHash) {
        throw new DomainError(
          'AI_PROPOSAL_HASH_MISMATCH',
          'The AI proposal hash does not match the server-owned proposal.',
          409,
        );
      }
      if (proposal.status !== 'PROPOSED') return proposalNotConfirmable();
      if (proposal.version !== input.expectedVersion) {
        throw new DomainError(
          'VERSION_CONFLICT',
          'The AI proposal was changed by another request.',
          409,
        );
      }
      if (proposal.expiresAt <= now) {
        throw new DomainError(
          'AI_PROPOSAL_EXPIRED',
          'The AI proposal has expired and cannot be confirmed.',
          409,
        );
      }

      const { actions: normalizedActions, items: resolvedItems } = validateFinalActions(proposal, input.actions);
      const confirmedPayload = { actions: normalizedActions };
      const confirmedHash = hashNormalizedPayload(confirmedPayload);
      const claim = await proposalStore.proposal.updateMany({
        where: {
          id: proposal.id,
          familyId: input.familyId,
          status: 'PROPOSED',
          version: input.expectedVersion,
        },
        data: { status: 'CONFIRMING', version: { increment: 1 } },
      });
      if (claim.count !== 1) return proposalNotConfirmable();

      const actionResults: ConfirmedAiActionResult[] = [];
      for (const [ordinal, action] of normalizedActions.entries()) {
        actionResults.push(await runLedgerAction(action as AIAction & { type: 'create_income' | 'create_expense' }, ordinal, input, now, transaction));
      }

      const confirmedVersion = input.expectedVersion + 2;
      const result = resultRecord(proposal, confirmedVersion, actionResults);
      for (const [ordinal, item] of proposal.items.entries()) {
        const resolvedOrdinal = resolvedItems.findIndex((candidate) => candidate.id === item.id);
        await proposalStore.item.update({
          where: { id: item.id },
          data: {
            resultJson: resolvedOrdinal >= 0
              ? actionResults[resolvedOrdinal]
              : { ordinal, status: 'SKIPPED' },
          },
        });
      }

      const completed = await proposalStore.proposal.updateMany({
        where: {
          id: proposal.id,
          familyId: input.familyId,
          status: 'CONFIRMING',
          version: input.expectedVersion + 1,
        },
        data: {
          status: 'EXECUTED',
          version: { increment: 1 },
          confirmedPayload,
          confirmedHash,
          resultJson: result,
        },
      });
      if (completed.count !== 1) return proposalNotConfirmable();

      return {
        resourceId: proposal.id,
        record: result,
        version: confirmedVersion,
      };
    },
  );
}
