import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma';
import { hashNormalizedPayload } from './financialMutationCoordinator';
import { DomainError } from './ledgerErrors';

export type GoalSourceType = 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'MANUAL';

export interface CreateGoalContributionCommand {
  familyId: string;
  actorUserId: string;
  goalId: string;
  sourceType: GoalSourceType;
  sourceId?: string;
  amount: number;
  currency: string;
  contributionDate: Date;
  allocationKey: string;
  idempotencyKey: string;
}

export interface GoalContributionResult {
  id: string;
  goalId: string;
  amount: number;
  currency: string;
  contributionDate: Date;
  sourceType: GoalSourceType;
  sourceId: string | null;
  deduplicated: boolean;
}

type TransactionClient = Prisma.TransactionClient;

const OPERATION = 'CREATE_GOAL_CONTRIBUTION';

const invalid = (message: string): never => {
  throw new DomainError('VALIDATION_FAILED', message, 400);
};

const assertCommand = (command: CreateGoalContributionCommand) => {
  if (!command.familyId || !command.actorUserId || !command.goalId) invalid('Goal contribution scope is required.');
  if (!Number.isFinite(command.amount) || command.amount <= 0) invalid('Contribution amount must be positive.');
  if (!/^[A-Za-z]{3}$/.test(command.currency.trim())) invalid('Currency must be a three-letter ISO code.');
  if (!(command.contributionDate instanceof Date) || !Number.isFinite(command.contributionDate.getTime())) invalid('Contribution date is invalid.');
  if (!command.allocationKey.trim() || !command.idempotencyKey.trim()) invalid('Allocation and idempotency keys are required.');
  if (command.sourceType !== 'MANUAL' && !command.sourceId?.trim()) invalid('A source record is required for this contribution.');
};

const toResult = (row: {
  id: string;
  goalId: string;
  amount: Prisma.Decimal;
  currency: string;
  contributionDate: Date;
  sourceType: string;
  sourceId: string | null;
}, deduplicated: boolean): GoalContributionResult => ({
  id: row.id,
  goalId: row.goalId,
  amount: Number(row.amount),
  currency: row.currency,
  contributionDate: row.contributionDate,
  sourceType: row.sourceType as GoalSourceType,
  sourceId: row.sourceId,
  deduplicated,
});

const assertWritableMembership = async (tx: TransactionClient, command: CreateGoalContributionCommand) => {
  const membership = await tx.familyMember.findUnique({
    where: { familyId_userId: { familyId: command.familyId, userId: command.actorUserId } },
  });
  if (!membership || !['admin', 'member'].includes(membership.role)) {
    throw new DomainError('FAMILY_WRITE_FORBIDDEN', '无权修改该家庭数据', 403);
  }
  return membership;
};

const assertSourceBelongsToFamily = async (tx: TransactionClient, command: CreateGoalContributionCommand) => {
  if (command.sourceType === 'MANUAL') return;
  const where = { id: command.sourceId!, familyId: command.familyId };
  const source = command.sourceType === 'INCOME'
    ? await tx.income.findFirst({ where })
    : command.sourceType === 'EXPENSE'
      ? await tx.expense.findFirst({ where })
      : command.sourceType === 'ASSET'
        ? await tx.asset.findFirst({ where })
        : await tx.liability.findFirst({ where });
  if (!source) throw new DomainError('RESOURCE_NOT_FOUND', '来源账目不存在或不属于该家庭', 404);
};

const parseReplay = (value: unknown): GoalContributionResult | null => {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (typeof result.id !== 'string' || typeof result.goalId !== 'string' || typeof result.amount !== 'number') return null;
  if (typeof result.currency !== 'string' || typeof result.contributionDate !== 'string') return null;
  if (typeof result.sourceType !== 'string') return null;
  return {
    id: result.id,
    goalId: result.goalId,
    amount: result.amount,
    currency: result.currency,
    contributionDate: new Date(result.contributionDate),
    sourceType: result.sourceType as GoalSourceType,
    sourceId: typeof result.sourceId === 'string' ? result.sourceId : null,
    deduplicated: true,
  };
};

const isP2002 = (error: unknown): boolean => (
  typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'P2002'
);

export const createGoalContribution = async (
  command: CreateGoalContributionCommand,
  client: PrismaClient = prisma,
): Promise<GoalContributionResult> => {
  assertCommand(command);
  const currency = command.currency.trim().toUpperCase();
  const sourceKey = command.sourceType === 'MANUAL'
    ? `MANUAL:${command.allocationKey.trim()}`
    : `${command.sourceType}:${command.sourceId}`;
  const actorScope = `USER:${command.actorUserId}`;
  const scope = {
    familyId: command.familyId,
    actorScope,
    operation: OPERATION,
    key: command.idempotencyKey.trim(),
  };
  const payloadHash = hashNormalizedPayload({
    goalId: command.goalId,
    sourceType: command.sourceType,
    sourceId: command.sourceId ?? null,
    amount: command.amount,
    currency,
    contributionDate: command.contributionDate,
    allocationKey: command.allocationKey.trim(),
  });

  return client.$transaction(async (tx) => {
    const membership = await assertWritableMembership(tx, command);
    const goal = await tx.goal.findFirst({ where: { id: command.goalId, familyId: command.familyId } });
    if (!goal) throw new DomainError('RESOURCE_NOT_FOUND', '目标不存在或不属于该家庭', 404);
    await assertSourceBelongsToFamily(tx, command);

    const existing = await tx.idempotencyRecord.findUnique({
      where: { familyId_actorScope_operation_key: scope as any },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used for another payload.', 409);
      }
      const replay = parseReplay(existing.responseJson);
      if (replay) return replay;
      throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'The idempotency request is still in progress.', 409, true);
    }

    const mutation = await tx.idempotencyRecord.create({
      data: {
        id: randomUUID(),
        ...scope,
        payloadHash,
      },
    });

    try {
      const contribution = await tx.goalContribution.create({
        data: {
          familyId: command.familyId,
          goalId: command.goalId,
          sourceType: command.sourceType,
          sourceId: command.sourceId ?? null,
          amount: command.amount,
          currency,
          contributionDate: command.contributionDate,
          allocationKey: command.allocationKey.trim(),
          sourceKey,
          createdBy: command.actorUserId,
        },
      });
      const result = toResult(contribution, false);
      const persistedResult = {
        ...result,
        contributionDate: result.contributionDate.toISOString(),
        deduplicated: false,
      };
      await tx.auditEvent.create({
        data: {
          familyId: command.familyId,
          mutationId: mutation.id,
          actorUserId: command.actorUserId,
          actorSnapshot: { userId: membership.userId, role: membership.role },
          action: 'CREATE',
          entity: 'GoalContribution',
          entityId: contribution.id,
          before: Prisma.DbNull,
          after: persistedResult as Prisma.InputJsonValue,
        },
      });
      await tx.idempotencyRecord.update({
        where: { id: mutation.id },
        data: { httpStatus: 201, responseJson: persistedResult },
      });
      return result;
    } catch (error) {
      if (isP2002(error)) {
        throw new DomainError('GOAL_CONTRIBUTION_CONFLICT', '该来源已经分配给其他目标', 409);
      }
      throw error;
    }
  });
};
