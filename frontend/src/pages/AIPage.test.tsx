import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIPage from './AIPage';
import * as aiService from '../services/aiService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/aiService', () => ({
  sendChat: vi.fn(),
  getHistory: vi.fn(),
  undoAction: vi.fn(),
  executeProposedActions: vi.fn(),
  getAnalysis: vi.fn(),
}));

const family = {
  id: 'family-1',
  name: '测试家庭',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  members: [],
};

const sendChatMock = vi.mocked(aiService.sendChat);
const getHistoryMock = vi.mocked(aiService.getHistory);
const executeProposedActionsMock = vi.mocked(aiService.executeProposedActions);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function renderProposedAction() {
  render(<AIPage />);
  fireEvent.change(screen.getByPlaceholderText(/输入消息/), {
    target: { value: '午饭花了30块' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));

  return screen.findByRole('button', { name: '确认全部记账（1 笔）' });
}

describe('AIPage proposed-action confirmation', () => {
  beforeEach(() => {
    vi.stubGlobal('alert', vi.fn());
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    useFamilyStore.setState({ currentFamily: family, families: [family] });
    getHistoryMock.mockResolvedValue([]);
    sendChatMock.mockResolvedValue({
      response: '已识别到一笔午餐支出。',
      actions: [],
      proposedActions: [
        {
          type: 'create_expense',
          data: {
            amount: 30,
            category: '餐饮',
            description: '午餐',
            date: '2026-08-31',
          },
        },
      ],
      aiConfigured: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('announces a failed proposed-action confirmation and allows retry', async () => {
    executeProposedActionsMock.mockRejectedValue({
      response: { data: { error: '确认被拒绝' } },
    });

    const confirmButton = await renderProposedAction();
    fireEvent.click(confirmButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('确认被拒绝');
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    expect(executeProposedActionsMock).toHaveBeenCalledTimes(2);
  });

  it('prevents a local confirmation replay while pending and announces success', async () => {
    const pendingConfirmation = deferred<Awaited<ReturnType<typeof aiService.executeProposedActions>>>();
    executeProposedActionsMock.mockReturnValue(pendingConfirmation.promise);

    const confirmButton = await renderProposedAction();
    fireEvent.click(confirmButton);

    const pendingButton = await screen.findByRole('button', { name: '记账中...' });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(executeProposedActionsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingConfirmation.resolve({
        actions: [{ type: 'create_expense', status: 'success', message: '已记账', record: { id: 'expense-1' } }],
        aiConfigured: true,
      });
      await pendingConfirmation.promise;
    });

    expect(await screen.findByRole('status')).toHaveTextContent('已完成 1 笔记账');
  });
});
