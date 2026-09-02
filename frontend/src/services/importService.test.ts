import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { confirmImport, previewCSV } from './importService';

vi.mock('./api', () => ({
  default: {
    post: vi.fn(),
  },
}));

const postMock = vi.mocked(api.post);

describe('import service batch contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns server-owned batch metadata from preview response headers', async () => {
    postMock.mockResolvedValue({
      data: [{ date: '2026-09-01', description: 'meal', amount: 20, type: 'EXPENSE' }],
      headers: {
        'x-import-batch-id': 'batch-1',
        'x-import-preview-hash': 'a'.repeat(64),
      },
    } as never);

    const result = await previewCSV(
      'family-1',
      new File(['csv'], 'transactions.csv', { type: 'text/csv' }),
      'alipay',
    );

    expect(result).toEqual({
      items: [{ date: '2026-09-01', description: 'meal', amount: 20, type: 'EXPENSE' }],
      batchId: 'batch-1',
      previewHash: 'a'.repeat(64),
    });
  });

  it('confirms only batch metadata, category patches and the stable idempotency key', async () => {
    postMock.mockResolvedValue({ data: { successCount: 1 } } as never);

    await expect(confirmImport(
      'family-1',
      'batch-1',
      'a'.repeat(64),
      { '1': '餐饮' },
      'import-key-1',
    )).resolves.toBe(1);

    expect(postMock).toHaveBeenCalledWith(
      '/families/family-1/import/confirm',
      {
        batchId: 'batch-1',
        expectedPreviewHash: 'a'.repeat(64),
        categoryPatch: { '1': '餐饮' },
      },
      { headers: { 'Idempotency-Key': 'import-key-1' } },
    );
  });
});
