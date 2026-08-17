import { syncImportSource, syncAllActiveSources } from './syncService';

jest.mock('../app', () => ({
  prisma: {
    importSource: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    income: { create: jest.fn() },
    expense: { create: jest.fn() },
  },
}));

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  readFile: jest.fn(),
  rename: jest.fn(),
  mkdir: jest.fn(),
}));

jest.mock('./importService', () => ({
  parseCSV: jest.fn(),
}));

import { prisma } from '../app';
import * as fs from 'fs/promises';
import { parseCSV } from './importService';

const mockedPrisma = prisma as any;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedParseCSV = parseCSV as jest.MockedFunction<typeof parseCSV>;

describe('syncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.importSource.update.mockResolvedValue({});
    mockedPrisma.income.create.mockResolvedValue({});
    mockedPrisma.expense.create.mockResolvedValue({});
  });

  describe('syncImportSource', () => {
    test('ImportSource 不存在时抛错', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue(null);

      await expect(syncImportSource('missing_id')).rejects.toThrow(/不存在/);

      expect(mockedPrisma.importSource.findUnique).toHaveBeenCalledWith({
        where: { id: 'missing_id' },
      });
    });

    test('目录不存在时返回 success: false 且不抛错', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue({
        id: 'src_1',
        familyId: 'fam_1',
        name: '支付宝主账号',
        type: 'alipay',
        config: { watchDirectory: '/nonexistent/dir', fileNamePattern: '*.csv' },
        createdBy: 'user_1',
        isActive: true,
      });
      const notFoundError = Object.assign(new Error('ENOENT'), {
        code: 'ENOENT',
      });
      mockedFs.readdir.mockRejectedValue(notFoundError);

      const result = await syncImportSource('src_1');

      expect(result).toEqual({
        success: false,
        imported: 0,
        error: '目录不存在',
      });
      // 应当记录失败状态
      expect(mockedPrisma.importSource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'src_1' },
          data: expect.objectContaining({
            lastSyncStatus: 'failed',
            lastSyncError: '目录不存在',
          }),
        })
      );
    });

    test('目录有 CSV 文件时解析并导入', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue({
        id: 'src_1',
        familyId: 'fam_1',
        name: '支付宝主账号',
        type: 'alipay',
        config: { watchDirectory: '/imports/fam_1', fileNamePattern: '*.csv' },
        createdBy: 'user_1',
        isActive: true,
      });
      mockedFs.readdir.mockResolvedValue(['file1.csv', 'file2.txt'] as any);
      mockedFs.readFile.mockResolvedValue(Buffer.from('csv-content'));
      mockedParseCSV.mockResolvedValue([
        {
          date: '2026-07-01',
          description: '餐饮',
          amount: 35,
          type: 'EXPENSE',
          category: '餐饮',
        },
        {
          date: '2026-07-02',
          description: '工资',
          amount: 5000,
          type: 'INCOME',
          category: '工资',
        },
      ]);
      mockedFs.rename.mockResolvedValue(undefined);
      mockedFs.mkdir.mockResolvedValue(undefined);

      const result = await syncImportSource('src_1');

      expect(result.success).toBe(true);
      expect(result.imported).toBe(2);
      // 只读取 .csv 文件
      expect(mockedFs.readFile).toHaveBeenCalledTimes(1);
      // 应当创建 1 条 Expense + 1 条 Income
      expect(mockedPrisma.expense.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.income.create).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.income.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          familyId: 'fam_1',
          createdBy: 'user_1',
          category: '工资',
          amount: 5000,
        }),
      });
      // 更新 ImportSource 为 success
      expect(mockedPrisma.importSource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'src_1' },
          data: expect.objectContaining({
            lastSyncStatus: 'success',
            lastSyncError: null,
          }),
        })
      );
    });

    test('同步成功后文件移动到 archived 目录', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue({
        id: 'src_1',
        familyId: 'fam_1',
        name: '支付宝主账号',
        type: 'alipay',
        config: { watchDirectory: '/imports/fam_1', fileNamePattern: '*.csv' },
        createdBy: 'user_1',
        isActive: true,
      });
      mockedFs.readdir.mockResolvedValue(['file1.csv'] as any);
      mockedFs.readFile.mockResolvedValue(Buffer.from('csv-content'));
      mockedParseCSV.mockResolvedValue([
        {
          date: '2026-07-01',
          description: '餐饮',
          amount: 35,
          type: 'EXPENSE',
        },
      ]);
      mockedFs.rename.mockResolvedValue(undefined);
      mockedFs.mkdir.mockResolvedValue(undefined);

      await syncImportSource('src_1');

      // 应当创建 archived 目录
      expect(mockedFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('archived'),
        { recursive: true }
      );
      // 应当把文件移动到 archived
      expect(mockedFs.rename).toHaveBeenCalledWith(
        expect.stringContaining('file1.csv'),
        expect.stringMatching(/archived[\\/]file1\.csv$/)
      );
    });

    test('使用默认 watchDirectory 当 config 未指定时', async () => {
      mockedPrisma.importSource.findUnique.mockResolvedValue({
        id: 'src_1',
        familyId: 'fam_1',
        name: '支付宝主账号',
        type: 'alipay',
        config: {},
        createdBy: 'user_1',
        isActive: true,
      });
      const notFoundError = Object.assign(new Error('ENOENT'), {
        code: 'ENOENT',
      });
      mockedFs.readdir.mockRejectedValue(notFoundError);

      await syncImportSource('src_1');

      // 默认目录应为 ./imports/{familyId}/
      expect(mockedFs.readdir).toHaveBeenCalledWith(
        expect.stringMatching(/imports[\\/]fam_1/)
      );
    });
  });

  describe('syncAllActiveSources', () => {
    test('汇总成功/失败数', async () => {
      mockedPrisma.importSource.findMany.mockResolvedValue([
        {
          id: 'src_1',
          familyId: 'fam_1',
          type: 'alipay',
          config: { watchDirectory: '/dir1', fileNamePattern: '*.csv' },
          createdBy: 'user_1',
          isActive: true,
        },
        {
          id: 'src_2',
          familyId: 'fam_1',
          type: 'wechat',
          config: { watchDirectory: '/dir2', fileNamePattern: '*.csv' },
          createdBy: 'user_1',
          isActive: true,
        },
        {
          id: 'src_3',
          familyId: 'fam_2',
          type: 'cmb',
          config: { watchDirectory: '/dir3', fileNamePattern: '*.csv' },
          createdBy: 'user_2',
          isActive: true,
        },
      ]);
      // src_1: 成功导入 1 条
      // src_2: 目录不存在失败
      // src_3: 成功导入 2 条
      mockedFs.readdir
        .mockResolvedValueOnce(['file1.csv'] as any) // src_1
        .mockRejectedValueOnce(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        ) // src_2
        .mockResolvedValueOnce(['a.csv', 'b.csv'] as any); // src_3
      mockedFs.readFile.mockResolvedValue(Buffer.from('csv'));
      mockedParseCSV.mockResolvedValue([
        {
          date: '2026-07-01',
          description: 'x',
          amount: 10,
          type: 'EXPENSE',
        },
      ]);
      mockedFs.rename.mockResolvedValue(undefined);
      mockedFs.mkdir.mockResolvedValue(undefined);

      const result = await syncAllActiveSources();

      expect(result).toEqual({ total: 3, success: 2, failed: 1 });
      expect(mockedPrisma.importSource.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    test('无 active source 时返回全 0', async () => {
      mockedPrisma.importSource.findMany.mockResolvedValue([]);

      const result = await syncAllActiveSources();

      expect(result).toEqual({ total: 0, success: 0, failed: 0 });
    });
  });
});
