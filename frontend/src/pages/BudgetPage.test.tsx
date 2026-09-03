import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BudgetPage from './BudgetPage';
import * as budgetService from '../services/budgetService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/budgetService', () => ({
  getBudgetProgress: vi.fn(),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  deleteBudget: vi.fn(),
}));

const family = {
  id: 'family-1',
  name: '测试家庭',
  timezone: 'Asia/Shanghai',
  baseCurrency: 'CNY',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  members: [],
};

const getBudgetProgressMock = vi.mocked(budgetService.getBudgetProgress);

describe('BudgetPage currency and period semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFamilyStore.setState({ currentFamily: family, families: [family] });
  });

  it('explains unavailable mixed-currency budget totals instead of showing zero', async () => {
    getBudgetProgressMock.mockResolvedValue([{
      budget: {
        id: 'budget-1',
        familyId: family.id,
        category: '餐饮',
        amount: 1000,
        currency: 'CNY',
        period: 'MONTHLY',
        startDate: '2026-09-01T00:00:00.000Z',
        endDate: null,
        createdBy: 'user-1',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      spent: null,
      remaining: null,
      percentage: null,
      totalsByCurrency: { CNY: 100, USD: 20 },
      conversionStatus: 'unavailable',
      baseCurrency: 'CNY',
      window: {
        timezone: 'Asia/Shanghai',
        startUtc: '2026-09-01T00:00:00.000Z',
        endUtc: '2026-10-01T00:00:00.000Z',
        startLocal: '2026-09-01',
        endLocalExclusive: '2026-10-01',
      },
    }]);

    render(<BudgetPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('暂无法合计'));
    expect(screen.getByRole('alert')).toHaveTextContent('US$20.00');
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
  });
});
