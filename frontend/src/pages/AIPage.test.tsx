import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIPage from './AIPage';
import * as aiService from '../services/aiService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/aiService', () => ({
  sendChat: vi.fn(),
  getHistory: vi.fn(),
  undoAction: vi.fn(),
  confirmAiProposal: vi.fn(),
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
const confirmAiProposalMock = vi.mocked(aiService.confirmAiProposal);

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
      proposalId: 'proposal-1',
      proposalVersion: 1,
      proposalHash: 'a'.repeat(64),
      proposalItems: [
        {
          proposalItemId: 'item-1',
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
    confirmAiProposalMock.mockRejectedValue({
      response: { data: { error: '确认被拒绝' } },
    });

    const confirmButton = await renderProposedAction();
    fireEvent.click(confirmButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('确认被拒绝');
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    expect(confirmAiProposalMock).toHaveBeenCalledTimes(2);
    expect(confirmAiProposalMock.mock.calls[0][0]).toMatchObject({
      proposalId: 'proposal-1',
      expectedVersion: 1,
      expectedHash: 'a'.repeat(64),
      actions: [{
        proposalItemId: 'item-1',
        type: 'create_expense',
        data: {
          amount: 30,
          category: '餐饮',
          description: '午餐',
          date: '2026-08-31',
        },
      }],
    });
    expect(confirmAiProposalMock.mock.calls[0][1]).toBe('ai-confirm-proposal-1');
    expect(confirmAiProposalMock.mock.calls[1][1]).toBe('ai-confirm-proposal-1');
  });

  it('prevents a local confirmation replay while pending and announces success', async () => {
    const pendingConfirmation = deferred<Awaited<ReturnType<typeof aiService.confirmAiProposal>>>();
    confirmAiProposalMock.mockReturnValue(pendingConfirmation.promise);

    const confirmButton = await renderProposedAction();
    fireEvent.click(confirmButton);

    const pendingButton = await screen.findByRole('button', { name: '记账中...' });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(confirmAiProposalMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingConfirmation.resolve({
        operationId: 'operation-1',
        resourceId: 'proposal-1',
        deduplicated: false,
        record: {
          proposalId: 'proposal-1',
          status: 'EXECUTED',
          version: 3,
          actions: [{ ordinal: 0, type: 'create_expense', resourceId: 'expense-1' }],
        },
      });
      await pendingConfirmation.promise;
    });

    expect(await screen.findByRole('status')).toHaveTextContent('已完成 1 笔记账');
  });

  it('restores a pending server-owned proposal from history so refresh can confirm it', async () => {
    getHistoryMock.mockResolvedValueOnce([{
      id: 'conversation-1',
      familyId: 'family-1',
      userId: 'user-1',
      content: '午餐 30 元',
      response: '请确认这笔支出',
      type: 'chat',
      fileId: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      proposal: {
        id: 'proposal-history-1',
        version: 1,
        originalHash: 'b'.repeat(64),
        expiresAt: '2026-09-01T12:00:00.000Z',
        status: 'PROPOSED',
        items: [{
          proposalItemId: 'proposal-item-history-1',
          type: 'create_expense',
          data: { amount: 30, category: '餐饮', date: '2026-09-01' },
        }],
      },
    } as any]);
    confirmAiProposalMock.mockResolvedValueOnce({
      operationId: 'operation-history-1',
      resourceId: 'proposal-history-1',
      deduplicated: false,
      record: {
        proposalId: 'proposal-history-1',
        status: 'EXECUTED',
        version: 3,
        actions: [{ ordinal: 0, type: 'create_expense', resourceId: 'expense-history-1' }],
      },
    });

    render(<AIPage />);

    const confirmButton = await screen.findByRole('button', { name: '确认全部记账（1 笔）' });
    fireEvent.click(confirmButton);

    expect(await screen.findByRole('status')).toHaveTextContent('已完成 1 笔记账');
    expect(confirmAiProposalMock).toHaveBeenCalledWith(expect.objectContaining({
      familyId: 'family-1',
      proposalId: 'proposal-history-1',
      expectedVersion: 1,
      expectedHash: 'b'.repeat(64),
      actions: [{
        proposalItemId: 'proposal-item-history-1',
        type: 'create_expense',
        data: { amount: 30, category: '餐饮', date: '2026-09-01' },
      }],
    }), 'ai-confirm-proposal-history-1');
  });

  it('restores a pending OCR proposal from history so refresh can confirm it', async () => {
    getHistoryMock.mockResolvedValueOnce([{
      id: 'conversation-ocr-1',
      familyId: 'family-1',
      userId: 'user-1',
      content: '[上传图片 1 张]',
      response: JSON.stringify({ proposedActions: [{ type: 'create_expense', data: { amount: 45 } }] }),
      type: 'ocr',
      fileId: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      proposal: {
        id: 'proposal-ocr-1',
        version: 1,
        originalHash: 'c'.repeat(64),
        expiresAt: '2026-09-01T12:00:00.000Z',
        status: 'PROPOSED',
        items: [{
          proposalItemId: 'proposal-item-ocr-1',
          type: 'create_expense',
          data: { amount: 45, category: '餐饮', date: '2026-09-01' },
        }],
      },
    } as any]);
    confirmAiProposalMock.mockResolvedValueOnce({
      operationId: 'operation-ocr-1',
      resourceId: 'proposal-ocr-1',
      deduplicated: false,
      record: {
        proposalId: 'proposal-ocr-1',
        status: 'EXECUTED',
        version: 3,
        actions: [{ ordinal: 0, type: 'create_expense', resourceId: 'expense-ocr-1' }],
      },
    });

    render(<AIPage />);

    fireEvent.click(await screen.findByRole('button', { name: '确认全部记账（1 笔）' }));

    expect(await screen.findByRole('status')).toHaveTextContent('已完成 1 笔记账');
    expect(confirmAiProposalMock).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: 'proposal-ocr-1',
      actions: [{
        proposalItemId: 'proposal-item-ocr-1',
        type: 'create_expense',
        data: { amount: 45, category: '餐饮', date: '2026-09-01' },
      }],
    }), 'ai-confirm-proposal-ocr-1');
  });
});
