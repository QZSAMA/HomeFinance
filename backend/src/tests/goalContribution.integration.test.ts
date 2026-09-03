import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import goalRoutes from '../routes/goals';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `goal-contribution-user-${runId}`;
const viewerId = `goal-contribution-viewer-${runId}`;
const familyId = `goal-contribution-family-${runId}`;
const otherFamilyId = `goal-contribution-other-family-${runId}`;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/goals', goalRoutes);

const token = (subject = userId) => jwt.sign(
  { userId: subject, email: `${subject}@example.test`, name: 'Goal contribution integration' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

describe('Goal contribution persistence and isolation', () => {
  let connected = false;
  let goalA = '';
  let goalB = '';
  let incomeId = '';
  let otherIncomeId = '';

  beforeAll(async () => {
    await prisma.$connect();
    connected = true;
    await prisma.user.createMany({
      data: [
        { id: userId, email: `${userId}@example.test`, passwordHash: 'test', name: 'Goal owner' },
        { id: viewerId, email: `${viewerId}@example.test`, passwordHash: 'test', name: 'Goal viewer' },
      ],
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Goal contribution family',
        baseCurrency: 'CNY',
        members: {
          create: [
            { userId, role: 'admin' },
            { userId: viewerId, role: 'viewer' },
          ],
        },
      },
    });
    await prisma.family.create({
      data: {
        id: otherFamilyId,
        name: 'Other family',
        members: { create: { userId, role: 'admin' } },
      },
    });
    const [a, b] = await Promise.all([
      prisma.goal.create({ data: { id: `${familyId}-goal-a`, familyId, title: '目标 A', type: 'SAVING', targetAmount: 1000, createdBy: userId } }),
      prisma.goal.create({ data: { id: `${familyId}-goal-b`, familyId, title: '目标 B', type: 'SAVING', targetAmount: 1000, createdBy: userId } }),
    ]);
    goalA = a.id;
    goalB = b.id;
    const income = await prisma.income.create({
      data: { familyId, createdBy: userId, category: '工资', amount: 100, currency: 'CNY', date: new Date('2026-09-03T00:00:00Z') },
    });
    incomeId = income.id;
    const otherIncome = await prisma.income.create({
      data: { familyId: otherFamilyId, createdBy: userId, category: '工资', amount: 100, currency: 'CNY', date: new Date('2026-09-03T00:00:00Z') },
    });
    otherIncomeId = otherIncome.id;
  });

  afterAll(async () => {
    if (!connected) return;
    await prisma.family.deleteMany({ where: { id: { in: [familyId, otherFamilyId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, viewerId] } } });
    await prisma.$disconnect();
  });

  test('keeps two goals isolated and rejects the same source twice', async () => {
    const first = await request(app)
      .post(`/api/families/${familyId}/goals/${goalA}/contributions`)
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'goal-source-1')
      .send({ sourceType: 'INCOME', sourceId: incomeId, amount: 100, currency: 'CNY', allocationKey: 'allocation-a' });
    expect(first.status).toBe(201);

    const duplicateSource = await request(app)
      .post(`/api/families/${familyId}/goals/${goalB}/contributions`)
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'goal-source-2')
      .send({ sourceType: 'INCOME', sourceId: incomeId, amount: 100, currency: 'CNY', allocationKey: 'allocation-b' });
    expect(duplicateSource.status).toBe(409);
    expect(duplicateSource.body.code).toBe('GOAL_CONTRIBUTION_CONFLICT');

    const progress = await request(app)
      .get(`/api/families/${familyId}/goals/progress`)
      .set('Authorization', `Bearer ${token()}`);
    expect(progress.status).toBe(200);
    const byId = Object.fromEntries(progress.body.map((item: any) => [item.goal.id, item]));
    expect(byId[goalA]).toMatchObject({ currentAmount: 100, percentage: 10, progressStatus: 'exact' });
    expect(byId[goalB]).toMatchObject({ currentAmount: null, percentage: null, progressStatus: 'unavailable' });
    expect(await prisma.goalContribution.count({ where: { familyId } })).toBe(1);
  });

  test('viewer and cross-family source have zero contribution writes', async () => {
    const viewer = await request(app)
      .post(`/api/families/${familyId}/goals/${goalA}/contributions`)
      .set('Authorization', `Bearer ${token(viewerId)}`)
      .set('Idempotency-Key', 'viewer-goal-source')
      .send({ sourceType: 'MANUAL', amount: 50, currency: 'CNY', allocationKey: 'viewer-allocation' });
    expect(viewer.status).toBe(403);

    const crossFamily = await request(app)
      .post(`/api/families/${familyId}/goals/${goalA}/contributions`)
      .set('Authorization', `Bearer ${token()}`)
      .set('Idempotency-Key', 'cross-family-source')
      .send({ sourceType: 'INCOME', sourceId: otherIncomeId, amount: 100, currency: 'CNY', allocationKey: 'cross-allocation' });
    expect(crossFamily.status).toBe(404);
    expect(await prisma.goalContribution.count({ where: { familyId } })).toBe(1);
  });
});
