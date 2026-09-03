import { createGoalContribution } from './goalContributionService';

describe('goalContributionService', () => {
  test('keeps two goals isolated and rejects the same source twice', async () => {
    const contributions: any[] = [];
    const idempotency = new Map<string, any>();
    const tx = {
      familyMember: { findUnique: jest.fn().mockResolvedValue({ familyId: 'family-1', userId: 'user-1', role: 'member' }) },
      goal: { findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, familyId: where.familyId, targetAmount: 1000 })) },
      income: { findFirst: jest.fn().mockResolvedValue({ id: 'income-1', familyId: 'family-1', amount: 100 }) },
      goalContribution: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
          contributions.find((row) => row.familyId === where.familyId_sourceKey.familyId && row.sourceKey === where.familyId_sourceKey.sourceKey) ?? null,
        )),
        create: jest.fn().mockImplementation(({ data }: any) => {
          if (contributions.some((row) => row.familyId === data.familyId && row.sourceKey === data.sourceKey)) {
            throw { code: 'P2002', meta: { target: ['GoalContribution_source_key'] } };
          }
          const row = { id: `contribution-${contributions.length + 1}`, ...data };
          contributions.push(row);
          return Promise.resolve(row);
        }),
      },
      idempotencyRecord: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(idempotency.get(JSON.stringify(where.familyId_actorScope_operation_key)) ?? null)),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = { id: data.id, ...data, responseJson: null, httpStatus: null };
          idempotency.set(JSON.stringify({ familyId: data.familyId, actorScope: data.actorScope, operation: data.operation, key: data.key }), row);
          return Promise.resolve(row);
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const row = [...idempotency.values()].find((item) => item.id === where.id);
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const client = { $transaction: jest.fn(async (work: any) => work(tx)) };
    const baseCommand = {
      familyId: 'family-1',
      actorUserId: 'user-1',
      sourceType: 'INCOME' as const,
      sourceId: 'income-1',
      amount: 100,
      currency: 'CNY',
      contributionDate: new Date('2026-09-03T00:00:00.000Z'),
      allocationKey: 'allocation-1',
      idempotencyKey: 'request-1',
    };

    const first = await createGoalContribution({ ...baseCommand, goalId: 'goal-a' }, client as any);
    expect(first.amount).toBe(100);
    await expect(createGoalContribution({ ...baseCommand, goalId: 'goal-b', idempotencyKey: 'request-2', allocationKey: 'allocation-2' }, client as any))
      .rejects.toMatchObject({ code: 'GOAL_CONTRIBUTION_CONFLICT' });
  });
});
