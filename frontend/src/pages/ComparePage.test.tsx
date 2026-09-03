import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ComparePage from './ComparePage';
import * as compareService from '../services/compareService';

vi.mock('../services/compareService', () => ({
  getCompareSummary: vi.fn(),
}));

const getCompareSummaryMock = vi.mocked(compareService.getCompareSummary);

const window = {
  timezone: 'Asia/Shanghai',
  startUtc: '2026-09-01T00:00:00.000Z',
  endUtc: '2026-10-01T00:00:00.000Z',
  startLocal: '2026-09-01',
  endLocalExclusive: '2026-10-01',
};

describe('ComparePage period and currency semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not sum families with different base currencies into a false total', async () => {
    getCompareSummaryMock.mockResolvedValue([
      {
        familyId: 'family-1', familyName: '上海家庭', totalAssets: 1000, totalLiabilities: 0, netWorth: 1000,
        thisMonthIncome: 100, thisMonthExpense: 20, totalAssetsByCurrency: { CNY: 1000 },
        conversionStatus: 'exact', window, timezone: 'Asia/Shanghai', baseCurrency: 'CNY',
      },
      {
        familyId: 'family-2', familyName: '纽约家庭', totalAssets: 1000, totalLiabilities: 0, netWorth: 1000,
        thisMonthIncome: 100, thisMonthExpense: 20, totalAssetsByCurrency: { USD: 1000 },
        conversionStatus: 'exact', window: { ...window, timezone: 'America/New_York' }, timezone: 'America/New_York', baseCurrency: 'USD',
      },
    ]);

    render(<ComparePage />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('暂无法合计'));
    expect(screen.getByRole('alert')).toHaveTextContent('¥1,000.00');
    expect(screen.getByRole('alert')).toHaveTextContent('US$1,000.00');
    expect(screen.queryByText('¥2,000.00')).not.toBeInTheDocument();
  });

  it('reloads the comparison window when the selected month changes', async () => {
    getCompareSummaryMock.mockResolvedValue([{
      familyId: 'family-1', familyName: '上海家庭', totalAssets: 1000, totalLiabilities: 0, netWorth: 1000,
      thisMonthIncome: 100, thisMonthExpense: 20, conversionStatus: 'exact', window,
      timezone: 'Asia/Shanghai', baseCurrency: 'CNY',
    }]);
    render(<ComparePage />);
    await waitFor(() => expect(getCompareSummaryMock).toHaveBeenCalled());
    getCompareSummaryMock.mockClear();

    fireEvent.change(screen.getByLabelText('比较月份'), { target: { value: '2026-08' } });
    await waitFor(() => expect(getCompareSummaryMock).toHaveBeenCalledWith('2026-08'));
  });
});
