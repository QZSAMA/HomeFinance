import type { PrismaClient } from '@prisma/client';
import type { AIAction } from './aiActions';
import { canonicalizePayload, hashNormalizedPayload } from './financialMutationCoordinator';
import { DomainError } from './ledgerErrors';

const DEFAULT_PROPOSAL_TTL_MS = 15 * 60 * 1000;
const MAX_ACTIONS = 50;
const PROPOSABLE_ACTION_TYPES = new Set<AIAction['type']>([
  'create_income',
  'create_expense',
  'create_asset',
  'create_liability',
]);

const MAX_TEXT_LENGTH = 512;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const invalidProposal = (message: string): never => {
  throw new DomainError('VALIDATION_FAILED', message, 400);
};

const parseAmount = (value: unknown, field: string, allowZero = false): number => {
  if (typeof value === 'string' && !value.trim()) {
    return invalidProposal(`${field} must be a finite number.`);
  }
  const parsed = typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN;
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    return invalidProposal(`${field} must be a finite ${allowZero ? 'non-negative' : 'positive'} number.`);
  }
  return Object.is(parsed, -0) ? 0 : parsed;
};

const parseDate = (value: unknown, field: string): string => {
  if (typeof value !== 'string') return invalidProposal(`${field} must use YYYY-MM-DD.`);
  const match = DATE_PATTERN.exec(value);
  if (!match) return invalidProposal(`${field} must use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return invalidProposal(`${field} must be a real calendar date.`);
  }
  return value;
};

const parseText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT_LENGTH) {
    return invalidProposal(`${field} must be a nonblank bounded string.`);
  }
  return value.trim();
};

export const normalizeAction = (action: AIAction): AIAction => {
  if (!action || typeof action !== 'object' || !PROPOSABLE_ACTION_TYPES.has(action.type)) {
    return invalidProposal('AI proposals may contain create actions only.');
  }
  if (!action.data || typeof action.data !== 'object' || Array.isArray(action.data)) {
    return invalidProposal('AI action data must be an object.');
  }
  const prototype = Object.getPrototypeOf(action.data);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidProposal('AI action data must contain plain data only.');
  }

  const data = action.data;
  const normalized: Record<string, unknown> = {};
  switch (action.type) {
    case 'create_income':
    case 'create_expense':
      normalized.amount = parseAmount(data.amount, 'amount');
      if (data.category !== undefined) normalized.category = parseText(data.category, 'category');
      if (data.description !== undefined && data.description !== null) {
        normalized.description = parseText(data.description, 'description');
      }
      if (data.date !== undefined) normalized.date = parseDate(data.date, 'date');
      if (data.source !== undefined && data.source !== null) normalized.source = parseText(data.source, 'source');
      if (data.paymentMethod !== undefined && data.paymentMethod !== null) {
        normalized.paymentMethod = parseText(data.paymentMethod, 'paymentMethod');
      }
      if (data.currency !== undefined && data.currency !== null) {
        const currency = parseText(data.currency, 'currency').toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) return invalidProposal('currency must be a three-letter code.');
        normalized.currency = currency;
      }
      break;
    case 'create_asset':
      normalized.value = parseAmount(data.value, 'value', true);
      if (data.name !== undefined) normalized.name = parseText(data.name, 'name');
      if (data.type !== undefined) normalized.type = parseText(data.type, 'type');
      if (data.category !== undefined && data.category !== null) {
        normalized.category = parseText(data.category, 'category');
      }
      if (data.costBasis !== undefined && data.costBasis !== null) {
        normalized.costBasis = parseAmount(data.costBasis, 'costBasis', true);
      }
      if (data.purchaseDate !== undefined && data.purchaseDate !== null) {
        normalized.purchaseDate = parseDate(data.purchaseDate, 'purchaseDate');
      }
      if (data.currency !== undefined && data.currency !== null) {
        normalized.currency = parseText(data.currency, 'currency');
      }
      if (data.description !== undefined && data.description !== null) {
        normalized.description = parseText(data.description, 'description');
      }
      break;
    case 'create_liability':
      normalized.amount = parseAmount(data.amount, 'amount', true);
      if (data.name !== undefined) normalized.name = parseText(data.name, 'name');
      if (data.type !== undefined) normalized.type = parseText(data.type, 'type');
      if (data.interestRate !== undefined && data.interestRate !== null) {
        normalized.interestRate = parseAmount(data.interestRate, 'interestRate', true);
      }
      if (data.startDate !== undefined && data.startDate !== null) {
        normalized.startDate = parseDate(data.startDate, 'startDate');
      }
      if (data.endDate !== undefined && data.endDate !== null) {
        normalized.endDate = parseDate(data.endDate, 'endDate');
      }
      if (data.currency !== undefined && data.currency !== null) {
        normalized.currency = parseText(data.currency, 'currency');
      }
      if (data.description !== undefined && data.description !== null) {
        normalized.description = parseText(data.description, 'description');
      }
      break;
  }

  return {
    type: action.type,
    data: normalized,
    ...(action.proposalItemId === undefined ? {} : { proposalItemId: action.proposalItemId }),
  } as AIAction;
};

export interface PersistAiProposalInput {
  familyId: string;
  actorUserId: string;
  actorRole: string;
  sourceType: 'TEXT' | 'OCR';
  sourceConversationId?: string | null;
  sourceFileId?: string | null;
  originalPayload: unknown;
  actions: AIAction[];
  now?: Date;
}

export type AiProposalPersistenceStore = Pick<
  PrismaClient,
  'aiProposal' | 'familyMember' | 'aiConversation' | 'file'
>;

export async function persistAiProposal(
  input: PersistAiProposalInput,
  store: AiProposalPersistenceStore,
) {
  const membership = await store.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId: input.familyId,
        userId: input.actorUserId,
      },
    },
    select: {
      familyId: true,
      userId: true,
      role: true,
    },
  });

  if (
    !membership
    || membership.familyId !== input.familyId
    || membership.userId !== input.actorUserId
    || !['admin', 'member'].includes(membership.role)
  ) {
    throw new DomainError(
      'FAMILY_WRITE_FORBIDDEN',
      'The actor cannot create an AI proposal for this family.',
      403,
    );
  }

  if (input.actions.length === 0) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'An AI proposal must contain at least one action.',
      400,
    );
  }

  if (!['TEXT', 'OCR'].includes(input.sourceType)) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'The AI proposal source type is invalid.',
      400,
    );
  }

  if (input.sourceType === 'TEXT' && input.sourceFileId) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Text AI proposals cannot contain a file source.',
      400,
    );
  }

  if (input.actions.length > MAX_ACTIONS) {
    throw new DomainError(
      'VALIDATION_FAILED',
      `An AI proposal cannot contain more than ${MAX_ACTIONS} actions.`,
      400,
    );
  }

  const normalizedActions = input.actions.map(normalizeAction);

  if (input.sourceConversationId) {
    const conversation = await store.aiConversation.findUnique({
      where: { id: input.sourceConversationId },
      select: { id: true, familyId: true, userId: true, type: true },
    });
    const expectedType = input.sourceType === 'TEXT' ? 'chat' : 'ocr';
    if (
      !conversation
      || conversation.familyId !== input.familyId
      || conversation.userId !== input.actorUserId
      || conversation.type !== expectedType
    ) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'The AI proposal source was not found.',
        404,
      );
    }
  }

  if (input.sourceFileId) {
    const file = await store.file.findUnique({
      where: { id: input.sourceFileId },
      select: { id: true, familyId: true, userId: true },
    });
    if (!file || file.familyId !== input.familyId || file.userId !== input.actorUserId) {
      throw new DomainError(
        'RESOURCE_NOT_FOUND',
        'The AI proposal source was not found.',
        404,
      );
    }
  }

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'The AI proposal clock must be valid.',
      400,
    );
  }
  const expiresAt = new Date(now.getTime() + DEFAULT_PROPOSAL_TTL_MS);
  const canonicalOriginalPayload = canonicalizePayload(input.originalPayload);
  const originalHash = hashNormalizedPayload(canonicalOriginalPayload);

  return store.aiProposal.create({
    data: {
      familyId: input.familyId,
      actorUserId: input.actorUserId,
      actorSnapshot: {
        version: 1,
        userId: input.actorUserId,
        role: membership.role,
      },
      sourceType: input.sourceType,
      sourceConversationId: input.sourceConversationId ?? null,
      sourceFileId: input.sourceFileId ?? null,
      originalPayload: canonicalOriginalPayload as any,
      originalHash,
      expiresAt,
      items: {
        create: normalizedActions.map((action, ordinal) => ({
          ordinal,
          typedAction: action.type,
          canonicalData: canonicalizePayload(action.data) as any,
        })),
      },
    },
    select: {
      id: true,
      version: true,
      originalHash: true,
      expiresAt: true,
      items: {
        orderBy: { ordinal: 'asc' },
        select: { id: true, ordinal: true, typedAction: true, canonicalData: true },
      },
    },
  });
}
