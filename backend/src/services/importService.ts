import { parse } from 'csv-parse';

export interface ImportedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE';
  category?: string;
}

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
  const parser = parsers[format];
  if (!parser) {
    throw new Error(`不支持的格式: ${format}`);
  }
  return parser(buffer);
}
