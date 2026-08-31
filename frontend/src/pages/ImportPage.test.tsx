import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportPage from './ImportPage';
import * as importService from '../services/importService';
import { useFamilyStore } from '../store/useFamilyStore';

vi.mock('../services/importService', () => ({
  previewCSV: vi.fn(),
  confirmImport: vi.fn(),
}));

const family = {
  id: 'family-1',
  name: '测试家庭',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  members: [],
};

const previewCSVMock = vi.mocked(importService.previewCSV);
const confirmImportMock = vi.mocked(importService.confirmImport);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ImportPage confirmation', () => {
  beforeEach(() => {
    useFamilyStore.setState({ currentFamily: family, families: [family] });
    previewCSVMock.mockResolvedValue([
      {
        date: '2026-08-31',
        description: '午餐',
        amount: 30,
        type: 'EXPENSE',
        category: '餐饮',
      },
    ]);
  });

  it('associates the CSV file control with its visible label', () => {
    render(<ImportPage />);

    expect(screen.getByLabelText('CSV 文件')).toHaveAttribute('type', 'file');
  });

  it('announces a failed confirmation so the user can safely retry', async () => {
    confirmImportMock.mockRejectedValue({
      response: { data: { error: '导入被拒绝' } },
    });
    render(<ImportPage />);
    fireEvent.change(screen.getByLabelText('CSV 文件'), {
      target: { files: [new File(['date,amount'], 'transactions.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));

    const confirmButton = await screen.findByRole('button', { name: '确认导入' });
    fireEvent.click(confirmButton);

    expect(await screen.findByRole('alert')).toHaveTextContent('导入被拒绝');
    expect(confirmButton).toBeEnabled();
  });

  it('prevents a confirmation replay while pending and announces its success', async () => {
    const pendingConfirmation = deferred<number>();
    confirmImportMock.mockReturnValue(pendingConfirmation.promise);
    render(<ImportPage />);
    fireEvent.change(screen.getByLabelText('CSV 文件'), {
      target: { files: [new File(['date,amount'], 'transactions.csv', { type: 'text/csv' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: '解析预览' }));

    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }));
    const pendingButton = await screen.findByRole('button', { name: '导入中...' });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(confirmImportMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingConfirmation.resolve(1);
      await pendingConfirmation.promise;
    });

    expect(await screen.findByRole('status')).toHaveTextContent('成功导入 1 条记录');
  });
});
