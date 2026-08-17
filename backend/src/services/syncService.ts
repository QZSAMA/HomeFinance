import path from 'path';
import * as fs from 'fs/promises';
import { prisma } from '../app';
import { parseCSV, ImportedTransaction } from './importService';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('syncService');

export interface SyncResult {
  success: boolean;
  imported: number;
  error?: string;
}

export interface SyncAllResult {
  total: number;
  success: number;
  failed: number;
}

interface ImportSourceConfig {
  watchDirectory?: string;
  fileNamePattern?: string;
}

interface ImportSourceRecord {
  id: string;
  familyId: string;
  name: string;
  type: string;
  config: ImportSourceConfig;
  createdBy: string;
  isActive: boolean;
}

const DEFAULT_FILE_PATTERN = '*.csv';

/**
 * 将 glob 风格的 fileNamePattern（如 *.csv）转为正则以匹配文件名。
 * 默认 *.csv。
 */
const patternToRegExp = (pattern: string): RegExp => {
  // 转义正则元字符，* -> .*
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
};

const isEnoent = (err: unknown): boolean => {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
};

const createTransactions = async (
  items: ImportedTransaction[],
  familyId: string,
  createdBy: string
): Promise<number> => {
  let imported = 0;
  for (const item of items) {
    if (item.type === 'INCOME') {
      await prisma.income.create({
        data: {
          familyId,
          createdBy,
          category: item.category || '其他收入',
          amount: item.amount,
          description: item.description || undefined,
          date: new Date(item.date),
        },
      });
    } else {
      await prisma.expense.create({
        data: {
          familyId,
          createdBy,
          category: item.category || '其他支出',
          amount: item.amount,
          description: item.description || undefined,
          date: new Date(item.date),
        },
      });
    }
    imported++;
  }
  return imported;
};

/**
 * 同步单个 ImportSource：
 * 1. 读取 config.watchDirectory（默认 ./imports/{familyId}/）
 * 2. 扫描匹配 config.fileNamePattern（默认 *.csv）的文件
 * 3. 调用 parseCSV 解析，批量创建 Income/Expense
 * 4. 成功后将文件移动到 {watchDirectory}/archived/
 * 5. 更新 ImportSource 的 lastSync* 字段
 *
 * 目录不存在时返回 { success: false, imported: 0, error: '目录不存在' } 不抛错。
 * ImportSource 不存在时抛错。
 */
export async function syncImportSource(sourceId: string): Promise<SyncResult> {
  const source = (await prisma.importSource.findUnique({
    where: { id: sourceId },
  })) as ImportSourceRecord | null;

  if (!source) {
    throw new Error(`ImportSource ${sourceId} 不存在`);
  }

  const config = source.config || {};
  const watchDirectory =
    config.watchDirectory || path.join('./imports', source.familyId);
  const pattern = config.fileNamePattern || DEFAULT_FILE_PATTERN;
  const fileRegex = patternToRegExp(pattern);

  let entries: string[];
  try {
    entries = await fs.readdir(watchDirectory);
  } catch (err) {
    if (isEnoent(err)) {
      const error = '目录不存在';
      await prisma.importSource.update({
        where: { id: source.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'failed',
          lastSyncError: error,
        },
      });
      return { success: false, imported: 0, error };
    }
    throw err;
  }

  const csvFiles = entries.filter((name) => fileRegex.test(name));

  let totalImported = 0;
  try {
    for (const fileName of csvFiles) {
      const filePath = path.join(watchDirectory, fileName);
      const buffer = await fs.readFile(filePath);
      const items = await parseCSV(buffer, source.type);
      const imported = await createTransactions(
        items,
        source.familyId,
        source.createdBy
      );
      totalImported += imported;

      // 移动到 archived 目录
      const archivedDir = path.join(watchDirectory, 'archived');
      await fs.mkdir(archivedDir, { recursive: true });
      const archivedPath = path.join(archivedDir, fileName);
      await fs.rename(filePath, archivedPath);
    }

    await prisma.importSource.update({
      where: { id: source.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'success',
        lastSyncError: null,
      },
    });

    return { success: true, imported: totalImported };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await prisma.importSource.update({
      where: { id: source.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'failed',
        lastSyncError: error,
      },
    });
    return { success: false, imported: totalImported, error };
  }
}

/**
 * 扫描所有 isActive 的 ImportSource，汇总同步结果。
 */
export async function syncAllActiveSources(): Promise<SyncAllResult> {
  const sources = (await prisma.importSource.findMany({
    where: { isActive: true },
  })) as ImportSourceRecord[];

  let success = 0;
  let failed = 0;
  for (const source of sources) {
    try {
      const result = await syncImportSource(source.id);
      if (result.success) {
        success++;
      } else {
        failed++;
      }
    } catch (err) {
      logger.error('同步 ImportSource 失败', {
        sourceId: source.id,
        error: String(err),
      });
      failed++;
    }
  }

  return { total: sources.length, success, failed };
}
