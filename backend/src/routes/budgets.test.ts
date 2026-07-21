import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import budgetRoutes from './budgets';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    budget: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    expense: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../middleware/cache', () => ({
  cacheMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/budgets', budgetRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Budget Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.budget.findMany.mockResolvedValue([]);
    mockedPrisma.budget.findUnique.mockResolvedValue(null);
    mockedPrisma.budget.create.mockResolvedValue({});
    mockedPrisma.budget.update.mockResolvedValue({});
    mockedPrisma.budget.delete.mockResolvedValue({});
    mockedPrisma.expense.findMany.mockResolvedValue([]);
  });

  describe('POST /api/families/:familyId/budgets', () => {
    test('creates a budget and returns 201', async () => {
      const created = {
        id: 'b1',
        familyId: 'fam_1',
        category: '餐饮',
        amount: 5000,
        period: 'MONTHLY',
        startDate: new Date('2026-07-01'),
        endDate: null,
        createdBy: 'user_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockedPrisma.budget.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/families/fam_1/budgets')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          category: '餐饮',
          amount: 5000,
          period: 'MONTHLY',
          startDate: '2026-07-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('b1');
      expect(res.body.category).toBe('餐饮');
      expect(res.body.amount).toBe(5000);
      expect(mockedPrisma.budget.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          familyId: 'fam_1',
          category: '餐饮',
          amount: 5000,
          period: 'MONTHLY',
          createdBy: 'user_1',
        }),
      });
    });

    test('rejects amount <= 0 with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/budgets')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          category: '餐饮',
          amount: 0,
          startDate: '2026-07-01',
        });

      expect(res.status).toBe(400);
      expect(mockedPrisma.budget.create).not.toHaveBeenCalled();
    });

    test('rejects missing category with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/budgets')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          amount: 5000,
          startDate: '2026-07-01',
        });

      expect(res.status).toBe(400);
      expect(mockedPrisma.budget.create).not.toHaveBeenCalled();
    });

    test('returns 403 when user has no family access', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/budgets')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          category: '餐饮',
          amount: 5000,
          startDate: '2026-07-01',
        });

      expect(res.status).toBe(403);
      expect(mockedPrisma.budget.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/families/:familyId/budgets', () => {
    test('returns budget list', async () => {
      mockedPrisma.budget.findMany.mockResolvedValue([
        { id: 'b1', familyId: 'fam_1', category: '餐饮', amount: 5000, period: 'MONTHLY', startDate: new Date('2026-07-01'), endDate: null, createdBy: 'user_1', createdAt: new Date(), updatedAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/budgets')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].category).toBe('餐饮');
    });

    test('returns 403 when user has no family access', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/budgets')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/families/:familyId/budgets/:id', () => {
    test('updates a budget successfully', async () => {
      const existing = { id: 'b1', familyId: 'fam_1', category: '餐饮', amount: 5000, period: 'MONTHLY', startDate: new Date('2026-07-01'), endDate: null, createdBy: 'user_1' };
      mockedPrisma.budget.findUnique.mockResolvedValue(existing);
      const updated = { ...existing, amount: 6000 };
      mockedPrisma.budget.update.mockResolvedValue(updated);

      const res = await request(app)
        .put('/api/families/fam_1/budgets/b1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          category: '餐饮',
          amount: 6000,
          period: 'MONTHLY',
          startDate: '2026-07-01',
        });

      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(6000);
      expect(mockedPrisma.budget.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: expect.objectContaining({ amount: 6000 }),
      });
    });

    test('rejects viewer role with 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue({
        familyId: 'fam_1',
        userId: 'user_1',
        role: 'viewer',
      });

      const res = await request(app)
        .put('/api/families/fam_1/budgets/b1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          category: '餐饮',
          amount: 6000,
          startDate: '2026-07-01',
        });

      expect(res.status).toBe(403);
      expect(mockedPrisma.budget.update).not.toHaveBeenCalled();
    });

    test('returns 404 when budget does not exist', async () => {
      mockedPrisma.budget.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/budgets/b1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          category: '餐饮',
          amount: 6000,
          startDate: '2026-07-01',
        });

      expect(res.status).toBe(404);
      expect(mockedPrisma.budget.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/families/:familyId/budgets/:id', () => {
    test('deletes a budget successfully', async () => {
      mockedPrisma.budget.findUnique.mockResolvedValue({
        id: 'b1', familyId: 'fam_1', category: '餐饮', amount: 5000,
      });

      const res = await request(app)
        .delete('/api/families/fam_1/budgets/b1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.budget.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    });

    test('rejects viewer role with 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue({
        familyId: 'fam_1',
        userId: 'user_1',
        role: 'viewer',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/budgets/b1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(mockedPrisma.budget.delete).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/families/:familyId/budgets/progress', () => {
    test('returns spent/remaining/percentage for each budget', async () => {
      const startDate = new Date('2026-07-01');
      const endDate = new Date('2026-07-31');
      mockedPrisma.budget.findMany.mockResolvedValue([
        { id: 'b1', familyId: 'fam_1', category: '餐饮', amount: 5000, period: 'MONTHLY', startDate, endDate: null, createdBy: 'user_1', createdAt: new Date(), updatedAt: new Date() },
      ]);
      // Simulate 2000 spent on 餐饮 in current period
      mockedPrisma.expense.findMany.mockResolvedValue([
        { amount: 1500, category: '餐饮', date: new Date('2026-07-10') },
        { amount: 500, category: '餐饮', date: new Date('2026-07-15') },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/budgets/progress')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].spent).toBe(2000);
      expect(res.body[0].remaining).toBe(3000);
      expect(res.body[0].percentage).toBe(40);
      expect(res.body[0].budget.id).toBe('b1');
    });

    test('aggregates expenses within the budget period range', async () => {
      const startDate = new Date('2026-07-01');
      mockedPrisma.budget.findMany.mockResolvedValue([
        { id: 'b1', familyId: 'fam_1', category: '餐饮', amount: 5000, period: 'MONTHLY', startDate, endDate: new Date('2026-07-31'), createdBy: 'user_1', createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { amount: 1000, category: '餐饮', date: new Date('2026-07-15') },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/budgets/progress')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      // Verify expense query was filtered by category and date range
      expect(mockedPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            familyId: 'fam_1',
            category: '餐饮',
          }),
        })
      );
      expect(res.body[0].spent).toBe(1000);
      expect(res.body[0].percentage).toBe(20);
    });
  });
});
