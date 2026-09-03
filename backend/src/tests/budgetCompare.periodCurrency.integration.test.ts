import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import budgetRoutes from '../routes/budgets';
import compareRoutes from '../routes/compare';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `budget-compare-user-${runId}`;
const familyId = `budget-compare-family-${runId}`;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/budgets', budgetRoutes);
app.use('/api/compare', compareRoutes);

const token = () => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Budget compare integration' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

describe('Budget and compare period/currency semantics', () => {
  let connected = false;

  beforeAll(async () => {
    await prisma.$connect();
    connected = true;
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'test',
        name: 'Budget compare integration',
      },
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Budget compare family',
        timezone: 'Asia/Shanghai',
        baseCurrency: 'CNY',
        members: { create: { userId, role: 'admin' } },
      },
    });
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany({ where: { familyId } });
    await prisma.income.deleteMany({ where: { familyId } });
    await prisma.asset.deleteMany({ where: { familyId } });
    await prisma.liability.deleteMany({ where: { familyId } });
    await prisma.budget.deleteMany({ where: { familyId } });
  });

  afterAll(async () => {
    if (!connected) return;
    await prisma.family.delete({ where: { id: familyId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('counts only the current family-local budget window', async () => {
    await prisma.budget.create({
      data: {
        familyId,
        category: '餐饮',
        amount: 500,
        period: 'MONTHLY',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        createdBy: userId,
      },
    });
    await prisma.expense.createMany({
      data: [
        {
          familyId,
          createdBy: userId,
          category: '餐饮',
          amount: 100,
          currency: 'CNY',
          date: new Date('2026-08-31T16:00:00.000Z'),
        },
        {
          familyId,
          createdBy: userId,
          category: '餐饮',
          amount: 999,
          currency: 'CNY',
          date: new Date('2026-09-30T16:00:00.000Z'),
        },
      ],
    });

    const response = await request(app)
      .get(`/api/families/${familyId}/budgets/progress`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body[0].spent).toBe(100);
    expect(response.body[0].window.endLocalExclusive).toBe('2026-10-01');
  });

  test('does not mix family currencies in compare', async () => {
    await prisma.asset.createMany({
      data: [
        { familyId, name: '现金', type: 'CASH', value: 100, currency: 'CNY' },
        { familyId, name: '股票', type: 'STOCK', value: 20, currency: 'USD' },
      ],
    });

    const response = await request(app)
      .get('/api/compare/summary')
      .query({ month: '2026-09' })
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body[0].conversionStatus).toBe('unavailable');
    expect(response.body[0].netWorth).toBeNull();
  });
});


