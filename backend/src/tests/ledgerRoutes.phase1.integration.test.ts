import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import expenseRoutes from '../routes/expenses';
import incomeRoutes from '../routes/incomes';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `p1-ledger-routes-user-${runId}`;
const familyId = `p1-ledger-routes-family-${runId}`;

const token = jwt.sign(
  { userId, email: `${runId}@example.test`, name: 'Ledger routes' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/incomes', incomeRoutes);
app.use('/api/families/:familyId/expenses', expenseRoutes);

const incomePayload = (amount: number) => ({
  amount,
  category: 'SALARY',
  description: 'HTTP route integration',
  date: '2026-08-31T00:00:00.000Z',
  source: 'Employer',
  currency: 'CNY',
});

const expensePayload = (amount: number) => ({
  amount,
  category: 'FOOD',
  description: 'HTTP route integration',
  date: '2026-08-31T00:00:00.000Z',
  paymentMethod: 'CARD',
  currency: 'CNY',
});

describe('Phase 1 real PostgreSQL ledger route adoption', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: { id: userId, email: `${runId}@example.test`, passwordHash: 'test', name: 'Ledger routes' },
    });
    await prisma.family.create({
      data: {
        id: familyId,
        name: 'Ledger routes family',
        members: { create: { userId, role: 'member' } },
      },
    });
  });

  afterAll(async () => {
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('persists and replays an Income POST, then conditionally updates and deletes it', async () => {
    const create = await request(app)
      .post(`/api/families/${familyId}/incomes`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'income-http-create')
      .send(incomePayload(100));

    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ version: 1, deduplicated: false });

    const replay = await request(app)
      .post(`/api/families/${familyId}/incomes`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'income-http-create')
      .send(incomePayload(100));

    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toMatchObject({
      id: create.body.id,
      operationId: create.body.operationId,
      version: 1,
      deduplicated: true,
    });
    await expect(Promise.all([
      prisma.income.count({ where: { familyId } }),
      prisma.idempotencyRecord.count({ where: { familyId, operation: 'CREATE_INCOME' } }),
      prisma.auditEvent.count({ where: { familyId, entity: 'Income', action: 'CREATE' } }),
    ])).resolves.toEqual([1, 1, 1]);

    const updated = await request(app)
      .put(`/api/families/${familyId}/incomes/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'income-http-update')
      .set('If-Match', 'W/"1"')
      .send(incomePayload(101));

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: create.body.id, version: 2, deduplicated: false });

    const stale = await request(app)
      .put(`/api/families/${familyId}/incomes/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'income-http-stale')
      .set('If-Match', '1')
      .send(incomePayload(102));

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', retryable: false });

    const deleted = await request(app)
      .delete(`/api/families/${familyId}/incomes/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'income-http-delete')
      .set('If-Match', '2');

    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ version: 2, deduplicated: false });
    await expect(prisma.income.count({ where: { familyId } })).resolves.toBe(0);
  });

  test('persists an Expense POST and rejects a stale HTTP update without another write', async () => {
    const create = await request(app)
      .post(`/api/families/${familyId}/expenses`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'expense-http-create')
      .send(expensePayload(25));

    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ version: 1, deduplicated: false });

    const updated = await request(app)
      .put(`/api/families/${familyId}/expenses/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'expense-http-update')
      .set('If-Match', '1')
      .send(expensePayload(26));

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: create.body.id, version: 2, deduplicated: false });

    const stale = await request(app)
      .put(`/api/families/${familyId}/expenses/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'expense-http-stale')
      .set('If-Match', '1')
      .send(expensePayload(27));

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', retryable: false });
    await expect(prisma.expense.findUniqueOrThrow({ where: { id: create.body.id } })).resolves
      .toMatchObject({ version: 2, amount: expect.anything() });

    const deleted = await request(app)
      .delete(`/api/families/${familyId}/expenses/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'expense-http-delete')
      .set('If-Match', '2');

    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ version: 2, deduplicated: false });
    await expect(prisma.expense.count({ where: { familyId } })).resolves.toBe(0);
  });
});
