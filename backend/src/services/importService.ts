import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { parse } from 'csv-parse';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { DomainError } from './ledgerErrors';
import { createExpense, createIncome } from './ledgerApplicationService';
import { coordinateFinancialMutation, hashNormalizedPayload } from './financialMutationCoordinator';
import { createPrismaFinancialMutationStoreFromTransaction } from './prismaFinancialMutationStore';
import { MutationResult } from './ledgerTypes';
import {
  assertImportBufferWithinLimit,
  assertImportRowsWithinLimit,
} from './importLimits';

export const IMPORT_PARSER_VERSION = 'csv-v1';

export interface ImportedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  category?: string;
}

export interface PersistImportPreviewInput {
  familyId: string;
  actorUserId: string;
  format: string;
  buffer: Buffer;
  items: ImportedTransaction[];
}

export interface ImportPreviewMetadata {
  batchId: string;
  previewHash: string;
  status: string;
  rowCount: number;
}

export interface ConfirmImportBatchInput {
  familyId: string;
  actorUserId: string;
  batchId: string;
  expectedPreviewHash: string;
  idempotencyKey: string;
  categoryPatch?: Record<string, string>;
}

export interface FailedImportRow {
  row: number;
  errors: Array<{ path: string; message: string }>;
}

export interface ImportConfirmationResponse {
  id: string;
  batchId: string;
  successCount: number;
  failedRows: FailedImportRow[];
}

export class ImportBatchValidationError extends DomainError {
  constructor(public readonly failedRows: FailedImportRow[]) {
    super(
      'VALIDATION_FAILED',
      'The import batch contains invalid rows.',
      400,
    );
  }
}

const canonicalImportPayload = (item: ImportedTransaction): Prisma.InputJsonObject => {
  const { category, ...requiredFields } = item;
  return category === undefined
    ? requiredFields
    : { ...requiredFields, category };
};

const importItemSchema = z.object({
  date: z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), 'date must be valid'),
  description: z.string(),
  amount: z.number().finite().positive(),
  type: z.enum(['INCOME', 'EXPENSE']),
  category: z.string().optional(),
}).strict();

const importBatchNotConfirmable = (): never => {
  throw new DomainError(
    'IMPORT_BATCH_NOT_CONFIRMABLE',
    'The import batch is no longer confirmable.',
    409,
  );
};

const resourceNotFound = (): never => {
  throw new DomainError(
    'RESOURCE_NOT_FOUND',
    'The requested family resource was not found.',
    404,
  );
};

const validateCategoryPatch = (patch: Record<string, string> | undefined) => {
  if (patch === undefined) return {};
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new DomainError('VALIDATION_FAILED', 'categoryPatch must be an object.', 400);
  }

  const normalized: Record<string, string> = {};
  for (const [rowNumber, category] of Object.entries(patch)) {
    if (!/^\d+$/.test(rowNumber) || Number(rowNumber) < 1 || !Number.isSafeInteger(Number(rowNumber))) {
      throw new DomainError('VALIDATION_FAILED', 'categoryPatch row numbers must be positive integers.', 400);
    }
    if (typeof category !== 'string' || !category.trim() || category.length > 512) {
      throw new DomainError('VALIDATION_FAILED', 'categoryPatch values must be nonblank and bounded.', 400);
    }
    normalized[rowNumber] = category.trim();
  }
  return normalized;
};

const rowValidationErrors = (row: {
  status: string;
  canonicalPayload: Prisma.JsonValue;
  validationErrors: Prisma.JsonValue | null;
}, parsed: z.SafeParseReturnType<unknown, ImportedTransaction>): Array<{ path: string; message: string }> => {
  if (row.validationErrors && Array.isArray(row.validationErrors)) {
    const storedErrors = row.validationErrors.flatMap((error) => {
      if (
        typeof error === 'object'
        && error !== null
        && 'path' in error
        && 'message' in error
        && typeof error.path === 'string'
        && typeof error.message === 'string'
      ) {
        return [{ path: error.path, message: error.message }];
      }
      return [];
    });
    if (storedErrors.length > 0) return storedErrors;
  }
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || 'row',
      message: issue.message,
    }));
  }
  return row.status === 'VALID'
    ? []
    : [{ path: 'row', message: 'row is not valid' }];
};

const parseAmount = (raw: string): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/[¥￥,\s]/g, '').replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.abs(n);
};

const normalizeDate = (raw: string): string => {
  const trimmed = (raw || '').trim();
  // "2026-07-01 10:00:00" → "2026-07-01"
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  // "2026/07/01 10:00:00" → "2026-07-01"
  const m2 = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return trimmed;
};

const parseRows = async (buffer: Buffer): Promise<Record<string, string>[]> => {
  return new Promise((resolve, reject) => {
    parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true }, (err, records) => {
      if (err) return reject(err);
      resolve(records as Record<string, string>[]);
    });
  });
};

const parseAlipay = async (buffer: Buffer): Promise<ImportedTransaction[]> => {
  const rows = await parseRows(buffer);
  return rows.map((row) => {
    const rawAmount = row['金额'] || row['金额（元）'] || '';
    const direction = (row['收/支'] || '').trim();
    const category = (row['交易分类'] || '').trim();
    return {
      date: normalizeDate(row['交易时间'] || ''),
      description: (row['商品名称'] || row['交易对方'] || category || '支付宝交易').trim(),
      amount: parseAmount(rawAmount),
      type: direction === '收入' ? 'INCOME' : 'EXPENSE',
      category: category || undefined,
    };
  });
};

const parseWechat = async (buffer: Buffer): Promise<ImportedTransaction[]> => {
  const rows = await parseRows(buffer);
  return rows.map((row) => {
    const rawAmount = row['金额'] || row['金额(元)'] || '';
    const txType = (row['交易类型'] || '').trim();
    const counterpart = (row['交易对方'] || '').trim();
    const direction = (row['收/支'] || '').trim();
    const isIncome = direction === '收入' || /红包|收款|转账收入/.test(txType);
    return {
      date: normalizeDate(row['交易时间'] || ''),
      description: counterpart ? `${txType}-${counterpart}` : txType || '微信交易',
      amount: parseAmount(rawAmount),
      type: isIncome ? 'INCOME' : 'EXPENSE',
    };
  });
};

const parsers: Record<string, (buffer: Buffer) => Promise<ImportedTransaction[]>> = {
  alipay: parseAlipay,
  wechat: parseWechat,
};

export async function parseCSV(
  buffer: Buffer,
  format: string
): Promise<ImportedTransaction[]> {
  assertImportBufferWithinLimit(buffer);
  const parser = parsers[format];
  if (!parser) {
    throw new Error(`不支持的格式: ${format}`);
  }
  const rows = await parser(buffer);
  assertImportRowsWithinLimit(rows);
  return rows;
}

export async function persistImportPreview(
  input: PersistImportPreviewInput,
): Promise<ImportPreviewMetadata> {
  const fileHash = createHash('sha256').update(input.buffer).digest('hex');
  const previewHash = hashNormalizedPayload({
    format: input.format,
    items: input.items,
  });
  const batch = await prisma.importBatch.create({
    data: {
      familyId: input.familyId,
      actorUserId: input.actorUserId,
      format: input.format,
      fileHash,
      parserVersion: IMPORT_PARSER_VERSION,
      previewHash,
      status: 'PREVIEWED',
      rowCount: input.items.length,
      rows: {
        create: input.items.map((item, index) => ({
          rowNumber: index + 1,
          canonicalPayload: canonicalImportPayload(item),
          status: 'VALID',
        })),
      },
    },
  });

  return {
    batchId: batch.id,
    previewHash: batch.previewHash,
    status: batch.status,
    rowCount: batch.rowCount,
  };
}

export async function confirmImportBatch(
  input: ConfirmImportBatchInput,
): Promise<MutationResult<ImportConfirmationResponse>> {
  if (!input.familyId.trim() || !input.actorUserId.trim() || !input.batchId.trim()) {
    throw new DomainError('VALIDATION_FAILED', 'familyId, actorUserId and batchId are required.', 400);
  }
  if (!/^[0-9a-f]{64}$/.test(input.expectedPreviewHash)) {
    throw new DomainError('VALIDATION_FAILED', 'expectedPreviewHash must be a SHA-256 hash.', 400);
  }
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 255) {
    throw new DomainError('VALIDATION_FAILED', 'A valid idempotency key is required.', 400);
  }
  const categoryPatch = validateCategoryPatch(input.categoryPatch);

  return prisma.$transaction(async (transaction) => {
    const store = createPrismaFinancialMutationStoreFromTransaction(transaction);
    return coordinateFinancialMutation<ImportConfirmationResponse>(
      {
        familyId: input.familyId,
        actorId: input.actorUserId,
        source: 'IMPORT',
        idempotencyKey: input.idempotencyKey,
        operation: 'CONFIRM_IMPORT_BATCH',
        requestPayload: {
          batchId: input.batchId,
          expectedPreviewHash: input.expectedPreviewHash,
          categoryPatch,
        },
        audit: { action: 'CONFIRM', entity: 'ImportBatch' },
      },
      store,
      async (_ledgerTransaction, operationId) => {
        const batch = await transaction.importBatch.findFirst({
          where: { id: input.batchId, familyId: input.familyId },
          include: { rows: { orderBy: { rowNumber: 'asc' } } },
        });
        if (!batch) return resourceNotFound();
        if (batch.previewHash !== input.expectedPreviewHash) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'The import preview hash does not match the server-owned batch.',
            400,
          );
        }
        if (batch.status !== 'PREVIEWED') return importBatchNotConfirmable();
        if (batch.expiresAt !== null && batch.expiresAt <= new Date()) {
          return importBatchNotConfirmable();
        }
        if (batch.rowCount !== batch.rows.length || batch.rows.length === 0) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'The import batch row count is invalid.',
            400,
          );
        }

        const patchedRows = new Set(Object.keys(categoryPatch));
        const rowNumbers = new Set(batch.rows.map((row) => String(row.rowNumber)));
        for (const rowNumber of patchedRows) {
          if (!rowNumbers.has(rowNumber)) {
            throw new DomainError(
              'VALIDATION_FAILED',
              `categoryPatch references unknown row ${rowNumber}.`,
              400,
            );
          }
        }

        const validatedRows = batch.rows.map((row) => {
          const parsed = importItemSchema.safeParse(row.canonicalPayload);
          const errors = rowValidationErrors(row, parsed);
          return { row, parsed, errors };
        });
        const failedRows = validatedRows
          .filter(({ errors }) => errors.length > 0)
          .map(({ row, errors }) => ({ row: row.rowNumber, errors }));
        if (failedRows.length > 0) {
          throw new ImportBatchValidationError(failedRows);
        }

        const claim = await transaction.importBatch.updateMany({
          where: {
            id: input.batchId,
            familyId: input.familyId,
            previewHash: input.expectedPreviewHash,
            status: 'PREVIEWED',
          },
          data: { status: 'CONFIRMING' },
        });
        if (claim.count !== 1) return importBatchNotConfirmable();

        const ledgerStore = createPrismaFinancialMutationStoreFromTransaction(transaction);
        for (const { row, parsed } of validatedRows) {
          if (!parsed.success) {
            throw new ImportBatchValidationError([{
              row: row.rowNumber,
              errors: rowValidationErrors(row, parsed),
            }]);
          }
          const item = parsed.data;
          const category = categoryPatch[String(row.rowNumber)]
            ?? item.category
            ?? (item.type === 'INCOME' ? '其他收入' : '其他支出');
          const rowIdempotencyKey = `${input.idempotencyKey}:row:${row.rowNumber}`;
          const result = item.type === 'INCOME'
            ? await createIncome({
              familyId: input.familyId,
              actorId: input.actorUserId,
              source: 'IMPORT',
              idempotencyKey: rowIdempotencyKey,
              effectiveDate: new Date(item.date),
              payload: {
                amount: item.amount,
                category,
                description: item.description || undefined,
                currency: 'CNY',
              },
            }, ledgerStore)
            : await createExpense({
              familyId: input.familyId,
              actorId: input.actorUserId,
              source: 'IMPORT',
              idempotencyKey: rowIdempotencyKey,
              effectiveDate: new Date(item.date),
              payload: {
                amount: item.amount,
                category,
                description: item.description || undefined,
                currency: 'CNY',
              },
            }, ledgerStore);

          await transaction.importRow.update({
            where: { id: row.id },
            data: {
              status: 'COMMITTED',
              resultEntityType: item.type === 'INCOME' ? 'Income' : 'Expense',
              resultEntityId: result.resourceId,
            },
          });
        }

        await transaction.importBatch.update({
          where: { id: input.batchId },
          data: { status: 'COMMITTED' },
        });

        return {
          resourceId: input.batchId,
          record: {
            id: input.batchId,
            batchId: input.batchId,
            successCount: validatedRows.length,
            failedRows: [],
          },
        };
      },
    );
  });
}
