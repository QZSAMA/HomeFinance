import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportsPage from './ReportsPage';
import * as reportService from '../services/reportService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/reportService', () => ({
  getBalanceSheet: vi.fn(),
  getIncomeStatement: vi.fn(),
  getCashFlow: vi.fn(),
  getSummary: vi.fn(),
}));

const family = {
  id: 'family-1',
  name: '测试家庭',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
  members: [],
  timezone: 'Asia/Shanghai',
};

const secondFamily = {
  ...family,
  id: 'family-2',
  name: '第二家庭',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const incomeStatement = {
  totalIncome: 1234,
  totalExpense: 234,
  netIncome: 1000,
  incomeByCategory: { 工资: 1234 },
  expenseByCategory: { 餐饮: 234 },
  incomes: [],
  expenses: [],
  startDate: null,
  endDate: null,
};

const fetchMock = vi.fn();
const getBalanceSheetMock = vi.mocked(reportService.getBalanceSheet);
const getIncomeStatementMock = vi.mocked(reportService.getIncomeStatement);
const getCashFlowMock = vi.mocked(reportService.getCashFlow);
const getSummaryMock = vi.mocked(reportService.getSummary);

describe('ReportsPage income statement', () => {
  beforeEach(() => {
    useFamilyStore.setState({ currentFamily: family, families: [family] });
    vi.stubGlobal('fetch', fetchMock);

    getBalanceSheetMock.mockResolvedValue({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
      assets: {},
      liabilities: {},
      assetList: [],
      liabilityList: [],
    });
    getCashFlowMock.mockResolvedValue({
      operating: { income: 0, expense: 0, net: 0 },
      investing: { income: 0, expense: 0, net: 0 },
      financing: { income: 0, expense: 0, net: 0 },
      other: { income: 0, expense: 0, net: 0 },
      netCashFlow: 0,
      startDate: null,
      endDate: null,
    });
    getSummaryMock.mockResolvedValue({
      balanceSheet: { totalAssets: 0, totalLiabilities: 0, netWorth: 0 },
      incomeStatement: {
        thisMonthIncome: 0,
        lastMonthIncome: 0,
        thisMonthExpense: 0,
        lastMonthExpense: 0,
        incomeChange: 0,
        expenseChange: 0,
        netIncome: 0,
      },
      investmentAllocation: [],
      recentTransactions: { incomes: [], expenses: [] },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads data through the configured report service', async () => {
    getIncomeStatementMock.mockResolvedValue(incomeStatement);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => incomeStatement,
    });

    render(<ReportsPage />);

    await waitFor(() => {
      expect(getIncomeStatementMock).toHaveBeenCalledWith(
        family.id,
        undefined,
        undefined,
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const totalIncomeCard = (await screen.findByText('总收入')).parentElement;
    expect(totalIncomeCard).toHaveTextContent('¥1,234.00');
  });

  it('shows an error instead of financial zeroes when loading fails', async () => {
    getIncomeStatementMock.mockRejectedValue(new Error('Unauthorized'));
    fetchMock.mockRejectedValue(new Error('Unauthorized'));

    render(<ReportsPage />);

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('利润表加载失败');

    const section = screen.getByRole('heading', { name: '利润表' }).closest('section');
    expect(section).not.toBeNull();
    expect(within(section!).queryByText('总收入')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows explicit errors for every failed report instead of zero-valued facts', async () => {
    getBalanceSheetMock.mockRejectedValue(new Error('balance unavailable'));
    getIncomeStatementMock.mockRejectedValue(new Error('income unavailable'));
    getCashFlowMock.mockRejectedValue(new Error('cash unavailable'));
    getSummaryMock.mockRejectedValue(new Error('allocation unavailable'));

    render(<ReportsPage />);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(4);
    expect(alerts.map((alert) => alert.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('资产负债表加载失败'),
      expect.stringContaining('利润表加载失败'),
      expect.stringContaining('现金流量表加载失败'),
      expect.stringContaining('投资配置加载失败'),
    ]));
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
  });

  it('does not render unavailable mixed-currency totals as zero', async () => {
    getIncomeStatementMock.mockResolvedValue({
      ...incomeStatement,
      totalIncome: null,
      totalExpense: null,
      netIncome: null,
      totalsByCurrency: { CNY: 1234, USD: 20 },
      expenseTotalsByCurrency: { CNY: 234, USD: 5 },
      baseCurrency: 'CNY',
      conversionStatus: 'unavailable',
    });

    render(<ReportsPage />);

    const section = screen.getByRole('heading', { name: '利润表' }).closest('section');
    expect(section).not.toBeNull();
    await waitFor(() => expect(within(section!).getByRole('alert')).toHaveTextContent('暂无法合计'));
    expect(within(section!).getByRole('alert')).toHaveTextContent('¥1,234.00');
    expect(within(section!).getByRole('alert')).toHaveTextContent('US$20.00');
    expect(within(section!).queryByText('¥0.00')).not.toBeInTheDocument();
  });

  it('ignores a slower response from the previously selected family', async () => {
    const first = deferred<Awaited<ReturnType<typeof reportService.getBalanceSheet>>>();
    const second = deferred<Awaited<ReturnType<typeof reportService.getBalanceSheet>>>();
    getBalanceSheetMock.mockImplementation((familyId) => (
      familyId === family.id ? first.promise : second.promise
    ));
    getIncomeStatementMock.mockResolvedValue(incomeStatement);

    render(<ReportsPage />);
    await waitFor(() => expect(getBalanceSheetMock).toHaveBeenCalledWith(family.id));

    act(() => {
      useFamilyStore.setState({ currentFamily: secondFamily, families: [family, secondFamily] });
    });
    await waitFor(() => expect(getBalanceSheetMock).toHaveBeenCalledWith(secondFamily.id));

    second.resolve({
      totalAssets: 2000,
      totalLiabilities: 0,
      netWorth: 2000,
      assets: { CASH: 2000 },
      liabilities: {},
      assetList: [],
      liabilityList: [],
    });
    await screen.findAllByText('¥2,000.00');

    first.resolve({
      totalAssets: 1000,
      totalLiabilities: 0,
      netWorth: 1000,
      assets: { CASH: 1000 },
      liabilities: {},
      assetList: [],
      liabilityList: [],
    });
    await act(async () => {
      await first.promise;
      await Promise.resolve();
    });

    const section = screen.getByRole('heading', { name: '资产负债表' }).closest('section');
    expect(section).not.toBeNull();
    expect(within(section!).queryByText('¥1,000.00')).not.toBeInTheDocument();
    expect(within(section!).getAllByText('¥2,000.00').length).toBeGreaterThan(0);
  });

  it('resets income statement filters without reusing stale dates', async () => {
    getIncomeStatementMock.mockResolvedValue(incomeStatement);
    render(<ReportsPage />);

    await waitFor(() => expect(getIncomeStatementMock).toHaveBeenCalled());
    getIncomeStatementMock.mockClear();

    const section = screen.getByRole('heading', { name: '利润表' }).closest('section');
    expect(section).not.toBeNull();
    fireEvent.change(within(section!).getByLabelText('开始日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(within(section!).getByLabelText('结束日期'), { target: { value: '2026-08-31' } });
    fireEvent.click(within(section!).getByRole('button', { name: '查询' }));
    await waitFor(() => expect(getIncomeStatementMock).toHaveBeenCalledWith(
      family.id,
      '2026-08-01',
      '2026-09-01',
    ));

    getIncomeStatementMock.mockClear();
    fireEvent.click(within(section!).getByRole('button', { name: '重置' }));
    await waitFor(() => expect(getIncomeStatementMock).toHaveBeenCalledWith(
      family.id,
      undefined,
      undefined,
    ));
  });
});
