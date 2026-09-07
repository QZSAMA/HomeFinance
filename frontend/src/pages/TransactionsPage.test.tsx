import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionsPage from './TransactionsPage';
import * as financeService from '../services/financeService';
import * as categoryService from '../services/categoryService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/financeService', () => ({
  getIncomes: vi.fn(),
  getExpenses: vi.fn(),
  createIncome: vi.fn(),
  createExpense: vi.fn(),
  updateIncome: vi.fn(),
  updateExpense: vi.fn(),
  deleteIncome: vi.fn(),
  deleteExpense: vi.fn(),
  checkIncomeDuplicate: vi.fn(),
  checkExpenseDuplicate: vi.fn(),
}));

vi.mock('../services/exportService', () => ({
  exportIncomes: vi.fn(),
  exportExpenses: vi.fn(),
}));

vi.mock('../services/categoryService', () => ({
  suggestCategory: vi.fn(),
}));

const family = {
  id: 'family-1',
  name: '测试家庭',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  members: [],
  timezone: 'Asia/Shanghai',
};

const income = {
  id: 'income-1',
  familyId: family.id,
  createdBy: 'user-1',
  category: '工资',
  amount: 100,
  description: '工资收入',
  source: '公司',
  date: '2026-09-04',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
};

const getIncomesMock = vi.mocked(financeService.getIncomes);
const getExpensesMock = vi.mocked(financeService.getExpenses);
const createExpenseMock = vi.mocked(financeService.createExpense);
const updateIncomeMock = vi.mocked(financeService.updateIncome);
const updateExpenseMock = vi.mocked(financeService.updateExpense);
const checkIncomeDuplicateMock = vi.mocked(financeService.checkIncomeDuplicate);
const checkExpenseDuplicateMock = vi.mocked(financeService.checkExpenseDuplicate);
const suggestCategoryMock = vi.mocked(categoryService.suggestCategory);

describe('TransactionsPage mutation mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFamilyStore.setState({ currentFamily: family, families: [family] });
    getIncomesMock.mockResolvedValue([income]);
    getExpensesMock.mockResolvedValue([]);
    updateIncomeMock.mockResolvedValue({ ...income, amount: 120 });
    createExpenseMock.mockResolvedValue({
      id: 'expense-1',
      familyId: family.id,
      createdBy: 'user-1',
      category: '餐饮',
      amount: 20,
      description: '新增支出',
      paymentMethod: undefined,
      date: '2026-09-04',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });
    checkIncomeDuplicateMock.mockResolvedValue({ hasDuplicate: false, duplicates: [] });
    checkExpenseDuplicateMock.mockResolvedValue({ hasDuplicate: false, duplicates: [] });
    suggestCategoryMock.mockResolvedValue(null);
  });

  it('creates a new expense after editing an income instead of updating the income id', async () => {
    render(<TransactionsPage />);

    const incomeRow = await screen.findByText('工资收入');
    fireEvent.click(incomeRow.closest('tr')!.querySelector('button')!);
    const editDialog = screen.getByRole('heading', { name: '编辑收入' }).closest('div.fixed')!;
    fireEvent.click(editDialog.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(updateIncomeMock).toHaveBeenCalledWith(
      family.id,
      income.id,
      expect.objectContaining({ amount: 100, category: '工资' }),
    ));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '编辑收入' })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^支出$/ }));
    await waitFor(() => expect(getExpensesMock).toHaveBeenCalledWith(family.id));
    fireEvent.click(screen.getByRole('button', { name: /^\+ 新增记录$/ }));

    const addDialog = screen.getByRole('heading', { name: '新增支出' }).closest('div.fixed')!;
    fireEvent.change(addDialog.querySelector('input[placeholder="请输入金额"]')!, { target: { value: '20' } });
    fireEvent.change(addDialog.querySelector('select')!, { target: { value: '餐饮' } });
    fireEvent.change(addDialog.querySelector('input[type="date"]')!, { target: { value: '2026-09-04' } });
    fireEvent.change(addDialog.querySelector('textarea')!, { target: { value: '新增支出' } });
    fireEvent.click(addDialog.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(createExpenseMock).toHaveBeenCalledWith(
      family.id,
      expect.objectContaining({ amount: 20, category: '餐饮', description: '新增支出' }),
    ));
    expect(updateExpenseMock).not.toHaveBeenCalled();
  });
});
