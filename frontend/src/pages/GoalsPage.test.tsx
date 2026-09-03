import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GoalsPage from './GoalsPage';
import * as goalService from '../services/goalService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/goalService', () => ({
  getGoalProgress: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
}));

vi.mock('recharts', () => ({
  RadialBarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RadialBar: () => null,
  PolarAngleAxis: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

const getGoalProgressMock = vi.mocked(goalService.getGoalProgress);

describe('GoalsPage contribution semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFamilyStore.setState({ currentFamily: family, families: [family] });
  });

  it('explains unavailable contribution progress instead of rendering a zero amount', async () => {
    getGoalProgressMock.mockResolvedValue([{
      goal: {
        id: 'goal-1', familyId: family.id, title: '应急金', type: 'SAVING', targetAmount: 10000,
        currency: 'CNY', deadline: null, isCompleted: false, createdBy: 'user-1',
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
      },
      currentAmount: null,
      percentage: null,
      totalsByCurrency: { CNY: 100, USD: 20 },
      conversionStatus: 'unavailable',
      progressStatus: 'unavailable',
    }]);

    render(<GoalsPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('暂无法合计'));
    expect(screen.getByRole('alert')).toHaveTextContent('US$20.00');
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
    expect(screen.getAllByText('尚未建立贡献关联').length).toBeGreaterThan(0);
  });
});
