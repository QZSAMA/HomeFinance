import { describe, expect, it, vi } from 'vitest';
import api from './api';
import { confirmAiProposal } from './aiService';

vi.mock('./api', () => ({
  default: { post: vi.fn() },
}));

describe('AI proposal service', () => {
  it('uses the configured API client and sends the idempotency key as a header', async () => {
    const response = {
      operationId: 'operation-1',
      resourceId: 'proposal-1',
      deduplicated: false,
    };
    vi.mocked(api.post).mockResolvedValueOnce({ data: response } as never);

    await expect(confirmAiProposal({
      familyId: 'family-1',
      proposalId: 'proposal-1',
      expectedVersion: 1,
      expectedHash: 'a'.repeat(64),
      actions: [{ type: 'create_income', data: { amount: 100, category: '工资' } }],
    }, 'ai-confirm-proposal-1')).resolves.toEqual(response);

    expect(api.post).toHaveBeenCalledWith(
      '/families/family-1/ai/proposals/proposal-1/confirm',
      {
        expectedVersion: 1,
        expectedHash: 'a'.repeat(64),
        actions: [{ type: 'create_income', data: { amount: 100, category: '工资' } }],
      },
      { headers: { 'Idempotency-Key': 'ai-confirm-proposal-1' } },
    );
  });
});
