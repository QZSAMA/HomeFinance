import { executeActions } from './aiActions';

jest.mock('../app', () => ({
  prisma: {
    income: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    expense: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    asset: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    liability: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const FAMILY_ID = 'family_1';
const USER_ID = 'user_1';

describe('AI Actions - update_* 操作', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('update_income', () => {
    test('修改金额成功：只更新 amount，返回更新后记录', async () => {
      mockedPrisma.income.findUnique.mockResolvedValue({
        id: 'income_1',
        familyId: FAMILY_ID,
        amount: 100,
        category: '工资',
      });
      mockedPrisma.income.update.mockResolvedValue({
        id: 'income_1',
        familyId: FAMILY_ID,
        amount: 200,
        category: '工资',
      });

      const results = await executeActions(FAMILY_ID, USER_ID, [
        { type: 'update_income', data: { id: 'income_1', amount: 200 } },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(results[0].record).toMatchObject({ id: 'income_1', amount: 200 });
      // update 只包含传入的字段
      expect(mockedPrisma.income.update).toHaveBeenCalledWith({
        where: { id: 'income_1' },
        data: { amount: 200 },
      });
    });
  });

  describe('update_expense', () => {
    test('只传 amount：partial update 不动其他字段', async () => {
      mockedPrisma.expense.findUnique.mockResolvedValue({
        id: 'expense_1',
        familyId: FAMILY_ID,
        amount: 50,
        category: '餐饮',
        description: '午饭',
      });
      mockedPrisma.expense.update.mockResolvedValue({
        id: 'expense_1',
        familyId: FAMILY_ID,
        amount: 100,
        category: '餐饮',
        description: '午饭',
      });

      const results = await executeActions(FAMILY_ID, USER_ID, [
        { type: 'update_expense', data: { id: 'expense_1', amount: 100 } },
      ]);

      expect(results[0].status).toBe('success');
      // data 对象只含 amount，不含 category/description 等未传入字段
      expect(mockedPrisma.expense.update).toHaveBeenCalledWith({
        where: { id: 'expense_1' },
        data: { amount: 100 },
      });
    });

    test('记录不存在：返回 error', async () => {
      mockedPrisma.expense.findUnique.mockResolvedValue(null);

      const results = await executeActions(FAMILY_ID, USER_ID, [
        { type: 'update_expense', data: { id: 'not_exist', amount: 100 } },
      ]);

      expect(results[0].status).toBe('error');
      expect(results[0].message).toBe('记录不存在');
      expect(mockedPrisma.expense.update).not.toHaveBeenCalled();
    });

    test('familyId 不匹配：返回 error，不执行更新', async () => {
      mockedPrisma.expense.findUnique.mockResolvedValue({
        id: 'expense_1',
        familyId: 'family_other',
        amount: 50,
      });

      const results = await executeActions(FAMILY_ID, USER_ID, [
        { type: 'update_expense', data: { id: 'expense_1', amount: 100 } },
      ]);

      expect(results[0].status).toBe('error');
      expect(results[0].message).toBe('记录不存在');
      expect(mockedPrisma.expense.update).not.toHaveBeenCalled();
    });

    test('缺少 id 参数：返回 error', async () => {
      const results = await executeActions(FAMILY_ID, USER_ID, [
        { type: 'update_expense', data: { amount: 100 } },
      ]);

      expect(results[0].status).toBe('error');
      expect(mockedPrisma.expense.findUnique).not.toHaveBeenCalled();
      expect(mockedPrisma.expense.update).not.toHaveBeenCalled();
    });
  });

  describe('update_asset', () => {
    test('修改 name 和 value 成功', async () => {
      mockedPrisma.asset.findUnique.mockResolvedValue({
        id: 'asset_1',
        familyId: FAMILY_ID,
        name: '股票',
        value: 100000,
      });
      mockedPrisma.asset.update.mockResolvedValue({
        id: 'asset_1',
        familyId: FAMILY_ID,
        name: '美股股票',
        value: 150000,
      });

      const results = await executeActions(FAMILY_ID, USER_ID, [
        { type: 'update_asset', data: { id: 'asset_1', name: '美股股票', value: 150000 } },
      ]);

      expect(results[0].status).toBe('success');
      expect(results[0].record).toMatchObject({ id: 'asset_1', name: '美股股票', value: 150000 });
      expect(mockedPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'asset_1' },
        data: { name: '美股股票', value: 150000 },
      });
    });
  });

  describe('update_liability', () => {
    test('修改 amount 成功', async () => {
      mockedPrisma.liability.findUnique.mockResolvedValue({
        id: 'liability_1',
        familyId: FAMILY_ID,
        name: '房贷',
        amount: 500000,
      });
      mockedPrisma.liability.update.mockResolvedValue({
        id: 'liability_1',
        familyId: FAMILY_ID,
        name: '房贷',
        amount: 480000,
      });

      const results = await executeActions(FAMILY_ID, USER_ID, [
        { type: 'update_liability', data: { id: 'liability_1', amount: 480000 } },
      ]);

      expect(results[0].status).toBe('success');
      expect(results[0].record).toMatchObject({ id: 'liability_1', amount: 480000 });
      expect(mockedPrisma.liability.update).toHaveBeenCalledWith({
        where: { id: 'liability_1' },
        data: { amount: 480000 },
      });
    });
  });
});
