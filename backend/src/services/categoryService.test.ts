import { suggestCategory } from './categoryService';

jest.mock('../app', () => ({
  prisma: {
    expense: { findMany: jest.fn() },
    income: { findMany: jest.fn() },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

describe('categoryService.suggestCategory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('精确匹配：历史含"星巴克"且 category="餐饮" → 返回"餐饮"', async () => {
    mockedPrisma.expense.findMany.mockResolvedValue([
      { category: '餐饮', description: '星巴克中粮广场店', amount: 35 },
      { category: '餐饮', description: '星巴克咖啡', amount: 40 },
      { category: '饮品', description: '星巴克', amount: 38 },
    ]);

    const result = await suggestCategory('星巴克', 'family_1', 'EXPENSE');

    expect(result).toBe('餐饮');
    expect(mockedPrisma.expense.findMany).toHaveBeenCalled();
  });

  test('关键字匹配：历史含"星巴克"/"麦当劳"等餐饮类 → 返回"餐饮"', async () => {
    // 输入"肯德基"，无完全匹配，但历史 description 含"肯德基"等关键字时返回餐饮类
    mockedPrisma.expense.findMany.mockResolvedValue([
      { category: '餐饮', description: '肯德基早餐', amount: 20 },
    ]);

    const result = await suggestCategory('肯德基', 'family_1', 'EXPENSE');

    expect(result).toBe('餐饮');
  });

  test('无匹配：返回 null', async () => {
    mockedPrisma.expense.findMany.mockResolvedValue([]);

    const result = await suggestCategory('未知的东西', 'family_1', 'EXPENSE');

    expect(result).toBeNull();
  });

  test('INCOME 类型：历史 description 含"工资"且 category="工资" → 返回"工资"', async () => {
    mockedPrisma.income.findMany.mockResolvedValue([
      { category: '工资', description: '8月份工资', amount: 15000 },
    ]);

    const result = await suggestCategory('工资', 'family_1', 'INCOME');

    expect(result).toBe('工资');
    expect(mockedPrisma.income.findMany).toHaveBeenCalled();
    expect(mockedPrisma.expense.findMany).not.toHaveBeenCalled();
  });

  test('空描述：返回 null 且不查询数据库', async () => {
    const result = await suggestCategory('   ', 'family_1', 'EXPENSE');

    expect(result).toBeNull();
    expect(mockedPrisma.expense.findMany).not.toHaveBeenCalled();
  });
});
