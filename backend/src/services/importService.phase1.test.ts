import { parseCSV } from './importService';

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
