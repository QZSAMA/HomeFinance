import { Prisma, PrismaClient } from '@prisma/client';
import {
  FinancialMutationOperation,
  FinancialMutationStore,
  AiProposalSnapshot,
  IdempotencyRecordSnapshot,
  LedgerRecord,
  LedgerTransactionClient,
} from './ledgerTypes';

const OPERATIONS: readonly FinancialMutationOperation[] = [
  'CREATE_INCOME', 'CREATE_EXPENSE', 'CREATE_ASSET', 'UPDATE_INCOME', 'UPDATE_EXPENSE', 'UPDATE_ASSET',
  'DELETE_INCOME', 'DELETE_EXPENSE', 'DELETE_ASSET', 'EXECUTE_RECURRING', 'CONFIRM_IMPORT_BATCH',
  'CONFIRM_AI_PROPOSAL',
];

const operation = (value: string): FinancialMutationOperation => {
  if (!OPERATIONS.includes(value as FinancialMutationOperation)) {
    throw new Error(`Unsupported persisted mutation operation: ${value}`);
  }
  return value as FinancialMutationOperation;
};

const snapshot = (value: {
  id: string;
  familyId: string;
  actorScope: string;
  operation: string;
  key: string;
  payloadHash: string;
  httpStatus: number | null;
  responseJson: Prisma.JsonValue;
} | null): IdempotencyRecordSnapshot | null => value && ({
  ...value,
  operation: operation(value.operation),
});

export const toJson = (value: unknown): Prisma.JsonValue => {
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Mutation JSON contains invalid date');
    return value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Mutation JSON contains non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => toJson(item));
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Mutation JSON contains unsupported object');
    }
    const object: Prisma.JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) object[key] = toJson(item) as Prisma.JsonValue;
    }
    return object;
  }
  throw new Error('Mutation JSON contains unsupported value');
};

const toLedgerRecord = (value: {
  id: string;
  version: number;
  familyId: string;
  createdBy: string;
  category: string;
  amount: Prisma.Decimal;
  description: string | null;
  source?: string | null;
  paymentMethod?: string | null;
  date: Date;
  currency: string;
  originType: string | null;
  originRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LedgerRecord => ({ ...value, amount: Number(value.amount) });

const toAssetRecord = (value: Prisma.AssetGetPayload<{}>): LedgerRecord => ({
  ...value,
  value: Number(value.value),
  costBasis: value.costBasis === null ? null : Number(value.costBasis),
});

const toLiabilityRecord = (value: Prisma.LiabilityGetPayload<{}>): LedgerRecord => ({
  ...value,
  amount: Number(value.amount),
  interestRate: value.interestRate === null ? null : Number(value.interestRate),
});

export const createPrismaLedgerTransactionClient = (tx: Prisma.TransactionClient): LedgerTransactionClient => ({
  familyMember: {
    findUnique: ({ where }) => tx.familyMember.findUnique({ where }),
  },
  idempotencyRecord: {
    findUnique: ({ where }) => tx.idempotencyRecord.findUnique({ where }).then(snapshot),
    create: ({ data }) => tx.idempotencyRecord.create({ data }).then((value) => snapshot(value)!),
    update: ({ where, data }) => tx.idempotencyRecord.update({
      where,
      data: {
        httpStatus: data.httpStatus,
        responseJson: toJson(data.responseJson) as Prisma.InputJsonValue,
      },
    }).then((value) => snapshot(value)!),
  },
  income: {
    create: ({ data }) => tx.income.create({ data }).then(toLedgerRecord),
    findFirst: ({ where }) => tx.income.findFirst({ where }).then((value) => (
      value === null ? null : toLedgerRecord(value)
    )),
    updateMany: ({ where, data }) => tx.income.updateMany({ where, data }),
    deleteMany: ({ where }) => tx.income.deleteMany({ where }),
  },
  expense: {
    create: ({ data }) => tx.expense.create({ data }).then(toLedgerRecord),
    findFirst: ({ where }) => tx.expense.findFirst({ where }).then((value) => (
      value === null ? null : toLedgerRecord(value)
    )),
    updateMany: ({ where, data }) => tx.expense.updateMany({ where, data }),
    deleteMany: ({ where }) => tx.expense.deleteMany({ where }),
  },
  asset: {
    create: ({ data }) => tx.asset.create({ data }).then(toAssetRecord),
    findFirst: ({ where }) => tx.asset.findFirst({ where }).then((value) => (
      value === null ? null : toAssetRecord(value)
    )),
    updateMany: ({ where, data }) => tx.asset.updateMany({ where, data }),
    deleteMany: ({ where }) => tx.asset.deleteMany({ where }),
  },
  liability: {
    create: ({ data }) => tx.liability.create({ data }).then(toLiabilityRecord),
  },
  auditEvent: {
    create: ({ data }) => tx.auditEvent.create({
      data: {
        ...data,
        actorSnapshot: toJson(data.actorSnapshot) as Prisma.InputJsonValue,
        before: data.before === null ? Prisma.DbNull : toJson(data.before) as Prisma.InputJsonValue,
        after: toJson(data.after) as Prisma.InputJsonValue,
      },
    }),
  },
  aiProposal: {
    findFirst: ({ where }) => tx.aiProposal.findFirst({
      where,
      include: { items: { orderBy: { ordinal: 'asc' } } },
    }).then((value) => value === null ? null : ({
      id: value.id,
      familyId: value.familyId,
      actorUserId: value.actorUserId,
      actorSnapshot: value.actorSnapshot,
      originalHash: value.originalHash,
      status: value.status,
      version: value.version,
      expiresAt: value.expiresAt,
      items: value.items.map((item) => ({
        id: item.id,
        ordinal: item.ordinal,
        typedAction: item.typedAction,
        canonicalData: item.canonicalData,
      })),
    } satisfies AiProposalSnapshot)),
    updateMany: ({ where, data }) => tx.aiProposal.updateMany({
      where,
      data: {
        ...(data.status === undefined ? {} : { status: data.status }),
        ...(data.version === undefined ? {} : { version: data.version }),
        ...(data.confirmedPayload === undefined ? {} : {
          confirmedPayload: toJson(data.confirmedPayload) as Prisma.InputJsonValue,
        }),
        ...(data.confirmedHash === undefined ? {} : { confirmedHash: data.confirmedHash }),
        ...(data.resultJson === undefined ? {} : {
          resultJson: toJson(data.resultJson) as Prisma.InputJsonValue,
        }),
      },
    }),
  },
  aiProposalItem: {
    update: ({ where, data }) => tx.aiProposalItem.update({
      where,
      data: { resultJson: toJson(data.resultJson) as Prisma.InputJsonValue },
    }),
  },
});

export const createPrismaFinancialMutationStoreFromTransaction = (
  transaction: Prisma.TransactionClient,
): FinancialMutationStore => ({
  $transaction: (work) => work(createPrismaLedgerTransactionClient(transaction)),
});

export const createPrismaFinancialMutationStore = (client: PrismaClient): FinancialMutationStore => ({
  $transaction: (work) => client.$transaction((tx) => work(createPrismaLedgerTransactionClient(tx))),
  familyMember: {
    findUnique: ({ where }) => client.familyMember.findUnique({ where }),
  },
  idempotencyRecord: {
    findUnique: ({ where }) => client.idempotencyRecord.findUnique({ where }).then(snapshot),
  },
});
