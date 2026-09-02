import {
  AiProposalPersistenceStore,
  normalizeAction,
  persistAiProposal,
} from './aiProposalService';
import { hashNormalizedPayload } from './financialMutationCoordinator';

const createStore = (role: string = 'member') => {
  const create = jest.fn();
  const store = {
    aiProposal: { create },
    familyMember: {
      findUnique: jest.fn().mockResolvedValue({
        familyId: 'family-1',
        userId: 'member-1',
        role,
      }),
    },
    aiConversation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        familyId: 'family-1',
        userId: 'member-1',
        type: 'chat',
      }),
    },
    file: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'file-1',
        familyId: 'family-1',
        userId: 'member-1',
      }),
    },
  } as unknown as AiProposalPersistenceStore;

  return { create, store };
};

describe('AiProposalService', () => {
  test('rejects a viewer before persisting an AI proposal', async () => {
    const { create, store } = createStore('viewer');

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'viewer-1',
      actorRole: 'viewer',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: {
        reply: '建议记录午餐支出',
        actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
      },
      actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
    }, store)).rejects.toMatchObject({
      code: 'FAMILY_WRITE_FORBIDDEN',
      status: 403,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('rejects an empty action list before persisting an AI proposal', async () => {
    const { create, store } = createStore();

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: { reply: '没有需要确认的动作', actions: [] },
      actions: [],
    }, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('rejects an invalid server clock before persisting an AI proposal', async () => {
    const { create, store } = createStore();

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: {
        reply: '建议记录午餐支出',
        actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
      },
      actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
      now: new Date('not-a-date'),
    }, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('persists a versioned actor snapshot supplied by the authorized server context', async () => {
    const { create, store } = createStore();
    create.mockResolvedValue({
      id: 'proposal-1',
      version: 1,
      originalHash: 'a'.repeat(64),
      expiresAt: new Date('2026-09-01T12:15:00.000Z'),
    });

    await persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: {
        reply: '建议记录午餐支出',
        actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
      },
      actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
      now: new Date('2026-09-01T12:00:00.000Z'),
    }, store);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorSnapshot: {
          version: 1,
          userId: 'member-1',
          role: 'member',
        },
      }),
    }));
  });

  test('rejects read-only query actions instead of persisting them as financial proposals', async () => {
    const { create, store } = createStore();

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: {
        reply: '这是最近的支出',
        actions: [{ type: 'query_expense', data: {} }],
      },
      actions: [{ type: 'query_expense', data: {} }],
    }, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('persists the same canonical payload that is covered by the proposal hash', async () => {
    const { create, store } = createStore();
    create.mockResolvedValue({
      id: 'proposal-1',
      version: 1,
      originalHash: 'a'.repeat(64),
      expiresAt: new Date('2026-09-01T12:15:00.000Z'),
    });
    const originalPayload = {
      metadata: { z: 2, ignored: undefined, a: 1 },
      actions: [{
        type: 'create_expense',
        data: { category: '餐饮', amount: 50, ignored: undefined },
      }],
    };

    await persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload,
      actions: [{
        type: 'create_expense',
        data: { category: '餐饮', amount: 50, ignored: undefined },
      }],
    }, store);

    const createData = create.mock.calls[0][0].data;
    expect(Object.prototype.hasOwnProperty.call(createData.originalPayload.metadata, 'ignored')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(createData.items.create[0].canonicalData, 'ignored')).toBe(false);
    expect(createData.originalHash).toBe(hashNormalizedPayload(createData.originalPayload));
  });

  test('rejects malformed create actions before persisting an AI proposal', async () => {
    const { create, store } = createStore();

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: {
        reply: '建议记录支出',
        actions: [{ type: 'create_expense', data: { amount: 0, date: '2026-02-30' } }],
      },
      actions: [{ type: 'create_expense', data: { amount: 0, date: '2026-02-30' } }],
    }, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('normalizes action fields before writing ordered proposal items', async () => {
    const { create, store } = createStore();
    create.mockResolvedValue({
      id: 'proposal-1',
      version: 1,
      originalHash: 'a'.repeat(64),
      expiresAt: new Date('2026-09-01T12:15:00.000Z'),
    });

    await persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: { reply: '建议记录', actions: [] },
      actions: [
        { type: 'create_expense', data: { amount: '50.00', category: ' 餐饮 ', date: '2026-09-01' } },
        { type: 'create_income', data: { amount: 100, category: '工资' } },
      ],
    }, store);

    const items = create.mock.calls[0][0].data.items.create;
    expect(items).toEqual([
      {
        ordinal: 0,
        typedAction: 'create_expense',
        canonicalData: { amount: 50, category: '餐饮', date: '2026-09-01' },
      },
      {
        ordinal: 1,
        typedAction: 'create_income',
        canonicalData: { amount: 100, category: '工资' },
      },
    ]);
  });

  test('does not carry unknown AI fields into confirmable canonical action data', async () => {
    const { create, store } = createStore();
    create.mockResolvedValue({
      id: 'proposal-1',
      version: 1,
      originalHash: 'a'.repeat(64),
      expiresAt: new Date('2026-09-01T12:15:00.000Z'),
    });

    await persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: {
        reply: '建议记录支出',
        actions: [{
          type: 'create_expense',
          data: { amount: 50, category: '餐饮', deleteFamily: true },
        }],
      },
      actions: [{
        type: 'create_expense',
        data: { amount: 50, category: '餐饮', deleteFamily: true },
      }],
    }, store);

    expect(create.mock.calls[0][0].data.items.create[0].canonicalData).toEqual({
      amount: 50,
      category: '餐饮',
    });
  });

  test('rejects an unknown proposal source type before persistence', async () => {
    const { create, store } = createStore();

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'PROVIDER_CALLBACK' as 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: { reply: '建议记录支出', actions: [] },
      actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
    }, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('rejects an action list over the proposal limit before persistence', async () => {
    const { create, store } = createStore();
    const actions = Array.from({ length: 51 }, () => ({
      type: 'create_expense' as const,
      data: { amount: 1, category: '餐饮' },
    }));

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: { reply: '建议批量记录', actions },
      actions,
    }, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('does not trust a caller-supplied admin role over the current viewer membership', async () => {
    const { create, store } = createStore('viewer');

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'admin',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      originalPayload: { reply: '建议记录支出', actions: [] },
      actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
    }, store)).rejects.toMatchObject({
      code: 'FAMILY_WRITE_FORBIDDEN',
      status: 403,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('rejects a file source attached to a text proposal', async () => {
    const { create, store } = createStore('member');

    await expect(persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'TEXT',
      sourceConversationId: 'conversation-1',
      sourceFileId: 'file-1',
      originalPayload: { reply: '建议记录支出', actions: [] },
      actions: [{ type: 'create_expense', data: { amount: 50, category: '餐饮' } }],
    }, store)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('normalizes all supported balance fields and preserves the proposal item identity', () => {
    expect(normalizeAction({
      type: 'create_asset',
      proposalItemId: 'item-asset',
      data: {
        value: '-0',
        name: '  Emergency fund ',
        type: ' CASH ',
        category: ' LIQUID ',
        costBasis: '0',
        purchaseDate: '2026-09-01',
        currency: ' cny ',
        description: '  reserve ',
      },
    })).toEqual({
      type: 'create_asset',
      proposalItemId: 'item-asset',
      data: {
        value: 0,
        name: 'Emergency fund',
        type: 'CASH',
        category: 'LIQUID',
        costBasis: 0,
        purchaseDate: '2026-09-01',
        currency: 'cny',
        description: 'reserve',
      },
    });

    expect(normalizeAction({
      type: 'create_liability',
      data: {
        amount: '0',
        name: '  Mortgage ',
        type: ' HOME ',
        interestRate: '0.0325',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        currency: ' cny ',
        description: '  loan ',
      },
    })).toEqual({
      type: 'create_liability',
      data: {
        amount: 0,
        name: 'Mortgage',
        type: 'HOME',
        interestRate: 0.0325,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        currency: 'cny',
        description: 'loan',
      },
    });

    expect(normalizeAction({
      type: 'create_income',
      data: {
        amount: 100,
        category: ' 工资 ',
        description: '  salary ',
        date: '2026-09-01',
        source: '  employer ',
        paymentMethod: '  bank ',
        currency: ' cny ',
      },
    })).toEqual({
      type: 'create_income',
      data: {
        amount: 100,
        category: '工资',
        description: 'salary',
        date: '2026-09-01',
        source: 'employer',
        paymentMethod: 'bank',
        currency: 'CNY',
      },
    });
  });

  test('rejects malformed action data before it can become a confirmable proposal', () => {
    expect(() => normalizeAction({
      type: 'create_expense',
      data: { amount: '   ' },
    })).toThrow('amount must be a finite number.');

    expect(() => normalizeAction({
      type: 'create_expense',
      data: Object.create(new Date()),
    })).toThrow('AI action data must contain plain data only.');

    expect(() => normalizeAction({
      type: 'create_expense',
      data: { amount: 10, date: '2026-02-30' },
    })).toThrow('date must be a real calendar date.');

    expect(() => normalizeAction({
      type: 'create_expense',
      data: { amount: 10, currency: 'CN' },
    })).toThrow('currency must be a three-letter code.');
  });

  test('persists an OCR proposal only when both sources belong to the actor family', async () => {
    const { create, store } = createStore();
    create.mockResolvedValue({
      id: 'proposal-ocr-1',
      version: 1,
      originalHash: 'b'.repeat(64),
      expiresAt: new Date('2026-09-01T12:15:00.000Z'),
      items: [],
    });
    const conversationFindUnique = store.aiConversation.findUnique as jest.Mock;
    conversationFindUnique.mockResolvedValue({
      id: 'conversation-ocr-1',
      familyId: 'family-1',
      userId: 'member-1',
      type: 'ocr',
    });

    await persistAiProposal({
      familyId: 'family-1',
      actorUserId: 'member-1',
      actorRole: 'member',
      sourceType: 'OCR',
      sourceConversationId: 'conversation-ocr-1',
      sourceFileId: 'file-1',
      originalPayload: {
        reply: '识别到一笔负债',
        actions: [{ type: 'create_liability', data: { amount: 100 } }],
      },
      actions: [{ type: 'create_liability', data: { amount: 100 } }],
      now: new Date('2026-09-01T12:00:00.000Z'),
    }, store);

    expect(store.aiConversation.findUnique).toHaveBeenCalledWith({
      where: { id: 'conversation-ocr-1' },
      select: { id: true, familyId: true, userId: true, type: true },
    });
    expect(store.file.findUnique).toHaveBeenCalledWith({
      where: { id: 'file-1' },
      select: { id: true, familyId: true, userId: true },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
