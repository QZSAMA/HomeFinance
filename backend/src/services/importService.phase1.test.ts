import { createHash } from 'crypto';

jest.mock('../db/prisma', () => ({
  prisma: {
    importBatch: { create: jest.fn() },
  },
}));

import { prisma } from '../db/prisma';
import { parseCSV, persistImportPreview } from './importService';

const mockedPrisma = prisma as any;

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;
const MAX_IMPORT_FIELD_LENGTH = 512;

const ALIPAY_HEADER = '交易时间,商品名称,金额,收/支,交易分类';
const validRow = (index: number) => `2026-09-01,transaction-${index},1,收入,OTHER`;

describe('Import parser resource limits', () => {
  test('rejects a buffer larger than the byte limit before parsing', async () => {
    await expect(parseCSV(Buffer.alloc(MAX_IMPORT_BYTES + 1, 'x'), 'alipay'))
      .rejects.toMatchObject({ code: 'IMPORT_LIMIT_EXCEEDED', limit: 'bytes' });
  });

  test('rejects more data rows than the row limit', async () => {
    const csv = [ALIPAY_HEADER, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => validRow(index))]
      .join('\n');

    await expect(parseCSV(Buffer.from(csv), 'alipay'))
      .rejects.toMatchObject({ code: 'IMPORT_LIMIT_EXCEEDED', limit: 'rows' });
  });

  test('rejects a field longer than the field limit', async () => {
    const csv = [ALIPAY_HEADER, `2026-09-01,${'x'.repeat(MAX_IMPORT_FIELD_LENGTH + 1)},1,收入,OTHER`]
      .join('\n');

    await expect(parseCSV(Buffer.from(csv), 'alipay'))
      .rejects.toMatchObject({ code: 'IMPORT_LIMIT_EXCEEDED', limit: 'field' });
  });
});

describe('Import server-owned preview persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.importBatch.create.mockResolvedValue({
      id: 'batch-1',
      status: 'PREVIEWED',
      previewHash: 'c'.repeat(64),
      rowCount: 2,
    });
  });

  test('persists canonical parsed rows with source and preview hashes', async () => {
    const buffer = Buffer.from('source csv');
    const items = [
      {
        date: '2026-09-01',
        description: 'salary',
        amount: 100,
        type: 'INCOME' as const,
      },
      {
        date: '2026-09-02',
        description: 'meal',
        amount: 20,
        type: 'EXPENSE' as const,
        category: 'food',
      },
    ];

    const result = await persistImportPreview({
      familyId: 'family-1',
      actorUserId: 'user-1',
      format: 'alipay',
      buffer,
      items,
    });

    expect(result).toEqual({
      batchId: 'batch-1',
      previewHash: 'c'.repeat(64),
      status: 'PREVIEWED',
      rowCount: 2,
    });
    expect(mockedPrisma.importBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'family-1',
        actorUserId: 'user-1',
        format: 'alipay',
        fileHash: createHash('sha256').update(buffer).digest('hex'),
        parserVersion: 'csv-v1',
        previewHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        status: 'PREVIEWED',
        rowCount: 2,
        rows: {
          create: [
            {
              rowNumber: 1,
              canonicalPayload: {
                date: '2026-09-01',
                description: 'salary',
                amount: 100,
                type: 'INCOME',
              },
              status: 'VALID',
            },
            {
              rowNumber: 2,
              canonicalPayload: {
                date: '2026-09-02',
                description: 'meal',
                amount: 20,
                type: 'EXPENSE',
                category: 'food',
              },
              status: 'VALID',
            },
          ],
        },
      }),
    });
  });
});
