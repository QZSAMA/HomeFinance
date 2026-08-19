import { classifyIncome, migrateExistingIncomes, INCOME_TYPES, IncomeType } from './incomeClassifier';

jest.mock('../app', () => ({
  prisma: {
    income: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

describe('incomeClassifier', () => {
  describe('INCOME_TYPES 常量', () => {
    test('包含全部六种收益类型', () => {
      expect(INCOME_TYPES).toEqual(['SALARY', 'INVESTMENT', 'DIVIDEND', 'INTEREST', 'RENT', 'OTHER']);
    });
  });

  describe('classifyIncome - 基础关键词匹配', () => {
    test('工资 → SALARY', () => {
      expect(classifyIncome('工资')).toBe('SALARY');
    });

    test('薪水 → SALARY', () => {
      expect(classifyIncome('薪水')).toBe('SALARY');
    });

    test('薪资 → SALARY', () => {
      expect(classifyIncome('薪资')).toBe('SALARY');
    });

    test('分红 → DIVIDEND', () => {
      expect(classifyIncome('分红')).toBe('DIVIDEND');
    });

    test('股息 → DIVIDEND', () => {
      expect(classifyIncome('股息')).toBe('DIVIDEND');
    });

    test('派息 → DIVIDEND', () => {
      expect(classifyIncome('派息')).toBe('DIVIDEND');
    });

    test('利息 → INTEREST', () => {
      expect(classifyIncome('利息')).toBe('INTEREST');
    });

    test('理财收益 → INTEREST', () => {
      expect(classifyIncome('理财收益')).toBe('INTEREST');
    });

    test('租金 → RENT', () => {
      expect(classifyIncome('租金')).toBe('RENT');
    });

    test('出租 → RENT', () => {
      expect(classifyIncome('出租')).toBe('RENT');
    });

    test('投资收益 → INVESTMENT', () => {
      expect(classifyIncome('投资收益')).toBe('INVESTMENT');
    });

    test('其他 → OTHER', () => {
      expect(classifyIncome('其他')).toBe('OTHER');
    });
  });

  describe('classifyIncome - description 中的关键词也能匹配', () => {
    test('category 为通用值，description 含"工资" → SALARY', () => {
      expect(classifyIncome('其他', '8月份工资')).toBe('SALARY');
    });

    test('category 为通用值，description 含"分红" → DIVIDEND', () => {
      expect(classifyIncome('其他', '茅台分红')).toBe('DIVIDEND');
    });

    test('category 含关键词 + description 不含 → 仍按 category 匹配', () => {
      expect(classifyIncome('利息', '某银行')).toBe('INTEREST');
    });
  });

  describe('classifyIncome - 忽略大小写', () => {
    test('SALARY（大写）→ SALARY', () => {
      expect(classifyIncome('SALARY')).toBe('SALARY');
    });

    test('salary（小写）→ SALARY', () => {
      expect(classifyIncome('salary')).toBe('SALARY');
    });

    test('SalAry（混合大小写）→ SALARY', () => {
      expect(classifyIncome('SalAry')).toBe('SALARY');
    });

    test('DIVIDEND（大写）→ DIVIDEND', () => {
      expect(classifyIncome('DIVIDEND')).toBe('DIVIDEND');
    });

    test('dividend（小写）→ DIVIDEND', () => {
      expect(classifyIncome('dividend')).toBe('DIVIDEND');
    });
  });

  describe('classifyIncome - 子串匹配', () => {
    test('分红收入（包含"分红"）→ DIVIDEND', () => {
      expect(classifyIncome('分红收入')).toBe('DIVIDEND');
    });

    test('工资入账（包含"工资"）→ SALARY', () => {
      expect(classifyIncome('工资入账')).toBe('SALARY');
    });

    test('银行利息收入（包含"利息"）→ INTEREST', () => {
      expect(classifyIncome('银行利息收入')).toBe('INTEREST');
    });
  });

  describe('classifyIncome - 优先级', () => {
    test('投资分红 应优先匹配 DIVIDEND 而非 INVESTMENT', () => {
      // "投资分红" 同时含 "投资" 和 "分红"，应返回更具体的 DIVIDEND
      expect(classifyIncome('投资分红')).toBe('DIVIDEND');
    });

    test('投资股息 应优先匹配 DIVIDEND 而非 INVESTMENT', () => {
      expect(classifyIncome('投资股息')).toBe('DIVIDEND');
    });

    test('投资利息 应优先匹配 INTEREST 而非 INVESTMENT', () => {
      expect(classifyIncome('投资利息')).toBe('INTEREST');
    });

    test('仅含"投资"时返回 INVESTMENT', () => {
      expect(classifyIncome('投资收益')).toBe('INVESTMENT');
    });
  });

  describe('migrateExistingIncomes', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('批量迁移所有 incomeType 为 null 的 Income', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', description: '8月工资', incomeType: null },
        { id: 'i2', category: '股息', description: '茅台分红', incomeType: null },
        { id: 'i3', category: '利息', description: '银行利息', incomeType: null },
      ]);
      mockedPrisma.income.update.mockResolvedValue({});

      const result = await migrateExistingIncomes();

      expect(result.total).toBe(3);
      expect(result.classified).toBe(3);
      expect(result.details.SALARY).toBe(1);
      expect(result.details.DIVIDEND).toBe(1);
      expect(result.details.INTEREST).toBe(1);
      expect(mockedPrisma.income.findMany).toHaveBeenCalledWith({ where: { incomeType: null } });
      expect(mockedPrisma.income.update).toHaveBeenCalledTimes(3);
      // 验证每条都更新了 incomeType
      expect(mockedPrisma.income.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'i1' },
        data: { incomeType: 'SALARY' },
      });
      expect(mockedPrisma.income.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'i2' },
        data: { incomeType: 'DIVIDEND' },
      });
      expect(mockedPrisma.income.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'i3' },
        data: { incomeType: 'INTEREST' },
      });
    });

    test('incomeType 已有值的不处理（查询过滤 null）', async () => {
      // findMany with where incomeType:null 不会返回已有 incomeType 的记录
      mockedPrisma.income.findMany.mockResolvedValue([]);

      const result = await migrateExistingIncomes();

      expect(result.total).toBe(0);
      expect(result.classified).toBe(0);
      expect(result.details).toEqual({});
      expect(mockedPrisma.income.update).not.toHaveBeenCalled();
    });

    test('出错时不中断，继续处理后续记录', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', description: null, incomeType: null },
        { id: 'i2', category: '股息', description: null, incomeType: null },
      ]);
      // 第一条 update 抛错，第二条成功
      mockedPrisma.income.update
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({});

      const result = await migrateExistingIncomes();

      expect(result.total).toBe(2);
      expect(result.classified).toBe(1);
      expect(result.details.DIVIDEND).toBe(1);
      expect(result.details.SALARY).toBeUndefined();
      expect(mockedPrisma.income.update).toHaveBeenCalledTimes(2);
    });
  });
});
