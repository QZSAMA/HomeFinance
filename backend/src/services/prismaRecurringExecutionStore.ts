import { Prisma, PrismaClient } from '@prisma/client';
import {
  createPrismaLedgerTransactionClient,
  toJson,
} from './prismaFinancialMutationStore';
import {
  RecurringExecutionSnapshot,
  RecurringExecutionStore,
  RecurringExecutionTransaction,
} from './recurringService';

const toRule = (value: {
  id: string;
  familyId: string;
  type: string;
  category: string;
  amount: Prisma.Decimal;
  description: string | null;
  frequency: string;
  interval: number;
  nextDate: Date;
  endDate: Date | null;
  isActive: boolean;
  lastExecutedAt: Date | null;
  version: number;
  createdBy: string;
}) => ({
  ...value,
  amount: Number(value.amount),
});

const toExecution = (value: {
  id: string;
  familyId: string;
  recurringTransactionId: string;
  scheduledFor: Date;
  status: string;
  entryType: string | null;
  entryId: string | null;
  mutationId: string | null;
  resultJson: Prisma.JsonValue | null;
} | null): RecurringExecutionSnapshot | null => value && ({ ...value });

const adapt = (transaction: Prisma.TransactionClient): RecurringExecutionTransaction => ({
  ...createPrismaLedgerTransactionClient(transaction),
  recurringTransaction: {
    findFirst: ({ where }) => transaction.recurringTransaction.findFirst({ where }).then((value) => (
      value === null ? null : toRule(value)
    )),
    updateMany: ({ where, data }) => transaction.recurringTransaction.updateMany({ where, data }),
  },
  recurringExecution: {
    create: ({ data }) => transaction.recurringExecution.create({ data }).then((value) => ({
      id: value.id,
      familyId: value.familyId,
      recurringTransactionId: value.recurringTransactionId,
      scheduledFor: value.scheduledFor,
      status: value.status,
    })),
    findUnique: ({ where }) => transaction.recurringExecution.findUnique({ where }).then(toExecution),
    findFirst: ({ where, orderBy }) => transaction.recurringExecution.findFirst({ where, orderBy }).then(toExecution),
    update: ({ where, data }) => transaction.recurringExecution.update({
      where,
      data: {
        status: data.status,
        entryType: data.entryType,
        entryId: data.entryId,
        mutationId: data.mutationId,
        resultJson: toJson(data.resultJson) as Prisma.InputJsonValue,
      },
    }).then((value) => toExecution(value)!),
  },
});

export const createPrismaRecurringExecutionStore = (client: PrismaClient): RecurringExecutionStore => ({
  $transaction: (work) => client.$transaction((transaction) => work(adapt(transaction))),
  familyMember: {
    findUnique: ({ where }) => client.familyMember.findUnique({ where }),
  },
  recurringExecution: {
    findFirst: ({ where, orderBy }) => client.recurringExecution.findFirst({ where, orderBy }).then(toExecution),
    findUnique: ({ where }) => client.recurringExecution.findUnique({ where }).then(toExecution),
  },
});
