import { Prisma, PrismaClient } from '@prisma/client';
import {
  FinancialMutationOperation,
  FinancialMutationStore,
  IdempotencyRecordSnapshot,
  LedgerRecord,
  LedgerTransactionClient,
} from './ledgerTypes';

const OPERATIONS: readonly FinancialMutationOperation[] = [
  'CREATE_INCOME', 'CREATE_EXPENSE', 'UPDATE_INCOME', 'UPDATE_EXPENSE',
  'DELETE_INCOME', 'DELETE_EXPENSE', 'EXECUTE_RECURRING', 'CONFIRM_IMPORT_BATCH',
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

const toJson = (value: unknown): Prisma.JsonValue => {
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

const adapt = (tx: Prisma.TransactionClient): LedgerTransactionClient => ({
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
  income: { create: ({ data }) => tx.income.create({ data }).then(toLedgerRecord) },
  expense: { create: ({ data }) => tx.expense.create({ data }).then(toLedgerRecord) },
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
});

export const createPrismaFinancialMutationStore = (client: PrismaClient): FinancialMutationStore => ({
  $transaction: (work) => client.$transaction((tx) => work(adapt(tx))),
  familyMember: {
    findUnique: ({ where }) => client.familyMember.findUnique({ where }),
  },
  idempotencyRecord: {
    findUnique: ({ where }) => client.idempotencyRecord.findUnique({ where }).then(snapshot),
  },
});
