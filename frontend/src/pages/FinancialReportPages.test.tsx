import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CashFlowPage from './CashFlowPage';
import IncomeStatementPage from './IncomeStatementPage';
import * as reportService from '../services/reportService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/reportService', () => ({
  getCashFlow: vi.fn(),
}));

const family = {
  id: 'family-1',
  name: '测试家庭',
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  members: [],
};

const cashFlowData = {
  operating: { income: 100, expense: 20, net: 80 },
  investing: { income: 0, expense: 0, net: 0 },
  financing: { income: 0, expense: 0, net: 0 },
  other: { income: 0, expense: 0 },
  netCashFlow: 80,
  startDate: null,
  endDate: null,
};

const fetchMock = vi.fn();
const getCashFlowMock = vi.mocked(reportService.getCashFlow);

beforeEach(() => {
  useFamilyStore.setState({ currentFamily: family, families: [family] });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({
    totalIncome: 100,
    totalExpense: 20,
    netIncome: 80,
    incomeByCategory: {},
    expenseByCategory: {},
    startDate: null,
    endDate: null,
  }) });
  getCashFlowMock.mockResolvedValue(cashFlowData);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('financial report date filters', () => {
  it('resets the income statement query without sending stale dates', async () => {
    const { container } = render(<IncomeStatementPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/families/family-1/reports/income-statement',
    ));
    fetchMock.mockClear();

    const [startDate, endDate] = container.querySelectorAll('input[type="date"]');
    fireEvent.change(startDate, { target: { value: '2026-08-01' } });
    fireEvent.change(endDate, { target: { value: '2026-08-31' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/families/family-1/reports/income-statement?startDate=2026-08-01&endDate=2026-08-31',
    ));

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/families/family-1/reports/income-statement',
    ));
  });

  it('resets the cash flow query without sending stale dates', async () => {
    const { container } = render(<CashFlowPage />);

    await waitFor(() => expect(getCashFlowMock).toHaveBeenCalledWith(
      'family-1', undefined, undefined,
    ));
    getCashFlowMock.mockClear();

    const [startDate, endDate] = container.querySelectorAll('input[type="date"]');
    fireEvent.change(startDate, { target: { value: '2026-08-01' } });
    fireEvent.change(endDate, { target: { value: '2026-08-31' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(getCashFlowMock).toHaveBeenCalledWith(
      'family-1', '2026-08-01', '2026-08-31',
    ));

    getCashFlowMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    await waitFor(() => expect(getCashFlowMock).toHaveBeenCalledWith(
      'family-1', undefined, undefined,
    ));
  });
});
