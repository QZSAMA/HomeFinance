import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import reportRoutes from '../routes/reports';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `reports-period-user-${runId}`;
const familyId = `reports-period-family-${runId}`;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/reports', reportRoutes);

const token = () => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Reports integration' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

describe('Reports family period and currency semantics', () => {
  let connected = false;

  beforeAll(async () => {
    await prisma.$connect();
    connected = true;
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'test',
        name: 'Reports integration',
      },
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Reports period family',
        timezone: 'Asia/Shanghai',
        baseCurrency: 'CNY',
        members: { create: { userId, role: 'admin' } },
      },
    });
  });

  beforeEach(async () => {
    await prisma.income.deleteMany({ where: { familyId } });
    await prisma.expense.deleteMany({ where: { familyId } });
    await prisma.asset.deleteMany({ where: { familyId } });
    await prisma.liability.deleteMany({ where: { familyId } });
  });

  afterAll(async () => {
    if (!connected) return;
    await prisma.family.delete({ where: { id: familyId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('uses an exclusive end boundary in the family timezone', async () => {
    await prisma.income.createMany({
      data: [
        {
          familyId,
          createdBy: userId,
          category: '工资',
          amount: 100,
          currency: 'CNY',
          date: new Date('2026-08-31T15:59:59.999Z'),
        },
        {
          familyId,
          createdBy: userId,
          category: '工资',
          amount: 999,
          currency: 'CNY',
          date: new Date('2026-08-31T16:00:00.000Z'),
        },
      ],
    });

    const response = await request(app)
      .get(`/api/families/${familyId}/reports/income-statement`)
      .query({ startDate: '2026-08-01', endDate: '2026-09-01' })
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.totalIncome).toBe(100);
    expect(response.body.incomes).toHaveLength(1);
    expect(response.body.window).toMatchObject({
      startLocal: '2026-08-01',
      endLocalExclusive: '2026-09-01',
      timezone: 'Asia/Shanghai',
    });
  });

  test('returns mixed-currency balance totals as unavailable instead of adding them', async () => {
    await prisma.asset.createMany({
      data: [
        { familyId, name: '现金', type: 'CASH', value: 100, currency: 'CNY' },
        { familyId, name: '股票', type: 'STOCK', value: 20, currency: 'USD' },
      ],
    });

    const response = await request(app)
      .get(`/api/families/${familyId}/reports/balance-sheet`)
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.totalsByCurrency).toEqual({ CNY: 100, USD: 20 });
    expect(response.body.totalAssets).toBeNull();
    expect(response.body.netWorth).toBeNull();
    expect(response.body.conversionStatus).toBe('unavailable');
  });

  test('reconciles every cash-flow class in one family-local window', async () => {
    const date = new Date('2026-08-15T00:00:00.000Z');
    await prisma.income.createMany({
      data: [
        { familyId, createdBy: userId, category: '工资', amount: 100, currency: 'CNY', date },
        { familyId, createdBy: userId, category: '投资', amount: 50, currency: 'CNY', date },
        { familyId, createdBy: userId, category: '其他收入', amount: 20, currency: 'CNY', date },
      ],
    });
    await prisma.expense.createMany({
      data: [
        { familyId, createdBy: userId, category: '餐饮', amount: 30, currency: 'CNY', date },
        { familyId, createdBy: userId, category: '投资', amount: 10, currency: 'CNY', date },
        { familyId, createdBy: userId, category: '其他支出', amount: 5, currency: 'CNY', date },
      ],
    });

    const response = await request(app)
      .get(`/api/families/${familyId}/reports/cash-flow`)
      .query({ startDate: '2026-08-01', endDate: '2026-09-01' })
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.netCashFlow).toBe(125);
    expect(response.body.reconciliationStatus).toBe('passed');
  });
});
