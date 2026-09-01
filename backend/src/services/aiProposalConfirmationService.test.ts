import { confirmAiProposal } from './aiProposalConfirmationService';
import { FinancialMutationStore, LedgerRecord } from './ledgerTypes';

type ProposalState = {
  id: string;
  familyId: string;
  actorUserId: string;
  actorSnapshot: { userId: string; role: string };
  originalHash: string;
  status: 'PROPOSED' | 'CONFIRMING' | 'EXECUTED';
  version: number;
  expiresAt: Date;
  items: Array<{
    id: string;
    ordinal: number;
    typedAction: string;
    canonicalData: Record<string, unknown>;
  }>;
};

type MemoryState = {
  proposal: ProposalState;
  incomes: LedgerRecord[];
  expenses: LedgerRecord[];
  idempotency: Array<{
    id: string;
    familyId: string;
    actorScope: string;
    operation: 'CONFIRM_AI_PROPOSAL';
    key: string;
    payloadHash: string;
    httpStatus: number | null;
    responseJson: unknown | null;
  }>;
  audits: unknown[];
};

const cloneState = (state: MemoryState): MemoryState => structuredClone(state);

const createStore = (initial: MemoryState, options: { failAfterLedger?: boolean; role?: string } = {}) => {
  let state = cloneState(initial);

  const buildTransaction = (transactionState: MemoryState): any => ({
    familyMember: {
      findUnique: async ({ where }: any) => where.familyId_userId.familyId === transactionState.proposal.familyId
        && where.familyId_userId.userId === transactionState.proposal.actorUserId
        ? { familyId: transactionState.proposal.familyId, userId: transactionState.proposal.actorUserId, role: options.role ?? 'member' }
        : null,
    },
    idempotencyRecord: {
      findUnique: async ({ where }: any) => transactionState.idempotency.find((record) => (
        record.familyId === where.familyId_actorScope_operation_key.familyId
        && record.actorScope === where.familyId_actorScope_operation_key.actorScope
        && record.operation === where.familyId_actorScope_operation_key.operation
        && record.key === where.familyId_actorScope_operation_key.key
      )) ?? null,
      create: async ({ data }: any) => {
        const record = {
          ...data,
          httpStatus: null,
          responseJson: null,
        };
        transactionState.idempotency.push(record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const record = transactionState.idempotency.find((item) => item.id === where.id);
        if (!record) throw new Error('idempotency record not found');
        Object.assign(record, data);
        return record;
      },
    },
    aiProposal: {
      findFirst: async ({ where }: any) => {
        const proposal = transactionState.proposal;
        return proposal.id === where.id && proposal.familyId === where.familyId
          ? structuredClone(proposal)
          : null;
      },
      updateMany: async ({ where, data }: any) => {
        const proposal = transactionState.proposal;
        if (
          proposal.id !== where.id
          || proposal.familyId !== where.familyId
          || proposal.status !== where.status
          || proposal.version !== where.version
        ) return { count: 0 };
        if (data.version?.increment) proposal.version += data.version.increment;
        Object.assign(proposal, { ...data, version: proposal.version });
        return { count: 1 };
      },
    },
    aiProposalItem: {
      update: async ({ where, data }: any) => {
        const item = transactionState.proposal.items.find((candidate) => candidate.id === where.id);
        if (!item) throw new Error('proposal item not found');
        Object.assign(item, data);
        return item;
      },
    },
    income: {
      create: async ({ data }: any) => {
        const record = { id: `income-${transactionState.incomes.length + 1}`, version: 1, ...data };
        transactionState.incomes.push(record);
        return record;
      },
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
    },
    expense: {
      create: async ({ data }: any) => {
        const record = { id: `expense-${transactionState.expenses.length + 1}`, version: 1, ...data };
        transactionState.expenses.push(record);
        return record;
      },
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 }),
    },
    auditEvent: {
      create: async ({ data }: any) => {
        transactionState.audits.push(data);
      },
    },
  });

  const store: FinancialMutationStore & { getState: () => MemoryState } = {
    $transaction: async (work: any) => {
      const transactionState = cloneState(state);
      const result = await work(buildTransaction(transactionState));
      if (options.failAfterLedger && transactionState.incomes.length + transactionState.expenses.length > 0) {
        throw new Error('injected transaction failure');
      }
      state = transactionState;
      return result;
    },
    getState: () => state,
  };
  return store;
};

const proposal = (overrides: Partial<ProposalState> = {}): ProposalState => ({
  id: 'proposal-1',
  familyId: 'family-1',
  actorUserId: 'user-1',
  actorSnapshot: { userId: 'user-1', role: 'member' },
  originalHash: 'a'.repeat(64),
  status: 'PROPOSED',
  version: 1,
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  items: [{
    id: 'item-1',
    ordinal: 0,
    typedAction: 'create_income',
    canonicalData: { amount: 100, category: '工资', date: '2029-12-31' },
  }],
  ...overrides,
});

const confirmation = (overrides: Record<string, unknown> = {}) => ({
  familyId: 'family-1',
  actorUserId: 'user-1',
  proposalId: 'proposal-1',
  expectedVersion: 1,
  expectedHash: 'a'.repeat(64),
  idempotencyKey: 'confirm-1',
  actions: [{
    type: 'create_income' as const,
    data: { amount: 100, category: '工资', date: '2029-12-31' },
  }],
  now: new Date('2029-12-31T12:00:00.000Z'),
  ...overrides,
});

describe('AiProposalConfirmationService', () => {
  test('confirms an Income proposal exactly once and replays the same result', async () => {
    const store = createStore({ proposal: proposal(), incomes: [], expenses: [], idempotency: [], audits: [] });

    const first = await confirmAiProposal(confirmation(), store);
    const replay = await confirmAiProposal(confirmation(), store);

    expect(first).toMatchObject({ resourceId: 'proposal-1', deduplicated: false });
    expect(replay).toEqual({ ...first, deduplicated: true });
    expect(store.getState().incomes).toHaveLength(1);
    expect(store.getState().idempotency).toHaveLength(1);
    expect(store.getState().audits).toHaveLength(1);
    expect(store.getState().proposal.status).toBe('EXECUTED');
  });

  test('rejects a stale version or original hash before creating any ledger fact', async () => {
    const store = createStore({ proposal: proposal(), incomes: [], expenses: [], idempotency: [], audits: [] });

    await expect(confirmAiProposal(confirmation({ expectedVersion: 2 }), store))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(confirmAiProposal(confirmation({ expectedHash: 'b'.repeat(64) }), store))
      .rejects.toMatchObject({ code: 'AI_PROPOSAL_HASH_MISMATCH' });

    expect(store.getState().incomes).toHaveLength(0);
    expect(store.getState().idempotency).toHaveLength(0);
    expect(store.getState().audits).toHaveLength(0);
  });

  test('rejects viewers and non-members before proposal lookup or any ledger mutation', async () => {
    const viewerStore = createStore(
      { proposal: proposal(), incomes: [], expenses: [], idempotency: [], audits: [] },
      { role: 'viewer' },
    );
    await expect(confirmAiProposal(confirmation(), viewerStore))
      .rejects.toMatchObject({ code: 'FAMILY_WRITE_FORBIDDEN' });

    const nonMemberStore = createStore({ proposal: proposal(), incomes: [], expenses: [], idempotency: [], audits: [] });
    await expect(confirmAiProposal(confirmation({ familyId: 'family-2' }), nonMemberStore))
      .rejects.toMatchObject({ code: 'FAMILY_WRITE_FORBIDDEN' });

    expect(viewerStore.getState().incomes).toHaveLength(0);
    expect(viewerStore.getState().idempotency).toHaveLength(0);
    expect(nonMemberStore.getState().incomes).toHaveLength(0);
    expect(nonMemberStore.getState().idempotency).toHaveLength(0);
  });

  test('rejects an expired proposal without claiming it or writing a ledger fact', async () => {
    const store = createStore({
      proposal: proposal({ expiresAt: new Date('2029-12-31T11:59:59.000Z') }),
      incomes: [], expenses: [], idempotency: [], audits: [],
    });

    await expect(confirmAiProposal(confirmation(), store))
      .rejects.toMatchObject({ code: 'AI_PROPOSAL_EXPIRED' });

    expect(store.getState().proposal.status).toBe('PROPOSED');
    expect(store.getState().incomes).toHaveLength(0);
    expect(store.getState().idempotency).toHaveLength(0);
  });

  test('rejects a second confirmation with a different idempotency key after the proposal is confirmed', async () => {
    const store = createStore({ proposal: proposal(), incomes: [], expenses: [], idempotency: [], audits: [] });

    await confirmAiProposal(confirmation(), store);
    await expect(confirmAiProposal(confirmation({ idempotencyKey: 'confirm-2' }), store))
      .rejects.toMatchObject({ code: 'AI_PROPOSAL_NOT_CONFIRMABLE' });

    expect(store.getState().incomes).toHaveLength(1);
    expect(store.getState().idempotency).toHaveLength(1);
    expect(store.getState().audits).toHaveLength(1);
  });

  test('rolls back proposal claim, ledger, idempotency and audit when the transaction fails', async () => {
    const store = createStore(
      { proposal: proposal(), incomes: [], expenses: [], idempotency: [], audits: [] },
      { failAfterLedger: true },
    );

    await expect(confirmAiProposal(confirmation(), store)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    expect(store.getState().proposal.status).toBe('PROPOSED');
    expect(store.getState().incomes).toHaveLength(0);
    expect(store.getState().idempotency).toHaveLength(0);
    expect(store.getState().audits).toHaveLength(0);
  });

  test('rejects asset and liability actions until a balance mutation service exists', async () => {
    const store = createStore({
      proposal: proposal({
        items: [{
          id: 'item-asset', ordinal: 0, typedAction: 'create_asset',
          canonicalData: { name: '基金', type: 'FUND', value: 1000 },
        }],
      }),
      incomes: [], expenses: [], idempotency: [], audits: [],
    });

    await expect(confirmAiProposal(confirmation({
      actions: [{ type: 'create_asset' as const, data: { name: '基金', type: 'FUND', value: 1000 } }],
    }), store)).rejects.toMatchObject({ code: 'AI_BALANCE_MUTATION_UNAVAILABLE' });
    expect(store.getState().incomes).toHaveLength(0);
    expect(store.getState().idempotency).toHaveLength(0);
  });
});
