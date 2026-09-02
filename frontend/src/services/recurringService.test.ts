import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { executeRecurring } from './recurringService';

vi.mock('./api', () => ({
  default: {
    post: vi.fn(),
  },
}));

const postMock = vi.mocked(api.post);

describe('recurring service exactly-once contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the selected occurrence and stable idempotency key', async () => {
    postMock.mockResolvedValue({
      data: {
        message: '执行成功',
        executionId: 'execution-1',
        entryId: 'income-1',
        nextDate: '2026-10-01T00:00:00.000Z',
        isActive: true,
        deduplicated: false,
      },
    } as never);

    const execute = executeRecurring as unknown as (
      familyId: string,
      id: string,
      scheduledFor: string,
      idempotencyKey: string,
    ) => Promise<unknown>;
    await execute(
      'family-1',
      'recurring-1',
      '2026-09-01T00:00:00.000Z',
      'recurring-key-1',
    );

    expect(postMock).toHaveBeenCalledWith(
      '/families/family-1/recurring/recurring-1/execute',
      { scheduledFor: '2026-09-01T00:00:00.000Z' },
      { headers: { 'Idempotency-Key': 'recurring-key-1' } },
    );
  });
});
