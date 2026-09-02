import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecurringPage from './RecurringPage';
import * as recurringService from '../services/recurringService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/recurringService', () => ({
  getRecurring: vi.fn(),
  getDueRecurring: vi.fn(),
  createRecurring: vi.fn(),
  updateRecurring: vi.fn(),
  deleteRecurring: vi.fn(),
  executeRecurring: vi.fn(),
}));

const family = {
  id: 'family-1',
  name: '测试家庭',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  members: [],
};

const rule = {
  id: 'recurring-1',
  familyId: 'family-1',
  type: 'INCOME' as const,
  category: '工资',
  amount: 100,
  description: null,
  frequency: 'MONTHLY' as const,
  interval: 1,
  nextDate: '2026-09-01T00:00:00.000Z',
  endDate: null,
  isActive: true,
  lastExecutedAt: null,
  createdBy: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const getRecurringMock = vi.mocked(recurringService.getRecurring);
const getDueRecurringMock = vi.mocked(recurringService.getDueRecurring);
const executeRecurringMock = vi.mocked(recurringService.executeRecurring);

describe('RecurringPage execution retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFamilyStore.setState({ currentFamily: family, families: [family] });
    getRecurringMock.mockResolvedValue([rule]);
    getDueRecurringMock.mockResolvedValue([]);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  it('reuses one key and scheduled occurrence after a failed execution retry', async () => {
    executeRecurringMock
      .mockRejectedValueOnce({ response: { data: { error: '暂时失败' } } })
      .mockResolvedValueOnce({
        message: '执行成功',
        executionId: 'execution-1',
        entryId: 'income-1',
        nextDate: '2026-10-01T00:00:00.000Z',
        isActive: true,
        deduplicated: false,
      } as never);

    render(<RecurringPage />);
    const executeButton = await screen.findByRole('button', { name: '执行' });
    fireEvent.click(executeButton);
    await waitFor(() => expect(executeRecurringMock).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: '执行' }));
    await waitFor(() => expect(executeRecurringMock).toHaveBeenCalledTimes(2));

    const first = executeRecurringMock.mock.calls[0];
    const second = executeRecurringMock.mock.calls[1];
    expect(first).toEqual([
      'family-1',
      'recurring-1',
      '2026-09-01T00:00:00.000Z',
      expect.any(String),
    ]);
    expect(second).toEqual(first);
  });
});
