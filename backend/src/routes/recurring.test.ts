import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import recurringRoutes from './recurring';

jest.mock('../app', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    recurringTransaction: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    income: { create: jest.fn() },
    expense: { create: jest.fn() },
  },
}));

jest.mock('../middleware/cache', () => ({
  cacheMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/recurring', recurringRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Recurring Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.recurringTransaction.findMany.mockResolvedValue([]);
    mockedPrisma.recurringTransaction.findUnique.mockResolvedValue(null);
    mockedPrisma.recurringTransaction.create.mockResolvedValue({});
    mockedPrisma.recurringTransaction.update.mockResolvedValue({});
    mockedPrisma.recurringTransaction.delete.mockResolvedValue({});
    mockedPrisma.income.create.mockResolvedValue({});
    mockedPrisma.expense.create.mockResolvedValue({});
  });

  describe('POST /api/families/:familyId/recurring', () => {
    test('creates a recurring transaction successfully', async () => {
      mockedPrisma.recurringTransaction.create.mockResolvedValue({
        id: 'rec_1',
        familyId: 'fam_1',
        type: 'INCOME',
        category: '工资',
        amount: 15000,
        description: '月度工资',
        frequency: 'MONTHLY',
        interval: 1,
        nextDate: new Date('2026-08-01'),
        endDate: null,
        isActive: true,
        lastExecutedAt: null,
        createdBy: 'user_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/families/fam_1/recurring')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          type: 'INCOME',
          category: '工资',
          amount: 15000,
          frequency: 'MONTHLY',
          interval: 1,
          nextDate: '2026-08-01',
          description: '月度工资',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('rec_1');
      expect(res.body.type).toBe('INCOME');
      expect(mockedPrisma.recurringTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'fam_1',
          type: 'INCOME',
          category: '工资',
          amount: 15000,
          frequency: 'MONTHLY',
          interval: 1,
        }),
      }));
    });

    test('rejects amount <= 0', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/recurring')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          type: 'INCOME',
          category: '工资',
          amount: 0,
          frequency: 'MONTHLY',
          interval: 1,
          nextDate: '2026-08-01',
        });

      expect(res.status).toBe(400);
    });

    test('rejects missing type/category', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/recurring')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          amount: 100,
          frequency: 'MONTHLY',
          interval: 1,
          nextDate: '2026-08-01',
        });

      expect(res.status).toBe(400);
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/recurring')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          type: 'INCOME',
          category: '工资',
          amount: 100,
          frequency: 'MONTHLY',
          interval: 1,
          nextDate: '2026-08-01',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/families/:familyId/recurring', () => {
    test('returns recurring transaction list', async () => {
      mockedPrisma.recurringTransaction.findMany.mockResolvedValue([
        { id: 'rec_1', type: 'INCOME', category: '工资', amount: 15000, frequency: 'MONTHLY', interval: 1, nextDate: new Date('2026-08-01'), isActive: true, familyId: 'fam_1', createdBy: 'user_1', createdAt: new Date(), updatedAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/recurring')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('rec_1');
    });
  });

  describe('GET /api/families/:familyId/recurring/due', () => {
    test('returns due recurring transactions', async () => {
      const pastDate = new Date('2020-01-01');
      mockedPrisma.recurringTransaction.findMany.mockResolvedValue([
        { id: 'rec_1', type: 'INCOME', nextDate: pastDate, isActive: true, familyId: 'fam_1' },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/recurring/due')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      // 验证查询条件包含 nextDate lte now
      expect(mockedPrisma.recurringTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          familyId: 'fam_1',
          isActive: true,
          nextDate: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      }));
    });
  });

  describe('POST /api/families/:familyId/recurring/:id/execute', () => {
    test('executes an INCOME rule and advances nextDate', async () => {
      mockedPrisma.recurringTransaction.findUnique.mockResolvedValue({
        id: 'rec_1',
        familyId: 'fam_1',
        type: 'INCOME',
        category: '工资',
        amount: 15000,
        description: '月度工资',
        frequency: 'MONTHLY',
        interval: 1,
        nextDate: new Date('2026-07-01'),
        endDate: null,
        isActive: true,
        lastExecutedAt: null,
        createdBy: 'user_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockedPrisma.recurringTransaction.update.mockResolvedValue({
        id: 'rec_1',
        nextDate: new Date('2026-08-01'),
        lastExecutedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/families/fam_1/recurring/rec_1/execute')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('成功');
      // 应创建 Income 记录
      expect(mockedPrisma.income.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'fam_1',
          category: '工资',
          amount: 15000,
          createdBy: 'user_1',
        }),
      }));
      // 应更新 nextDate
      expect(mockedPrisma.recurringTransaction.update).toHaveBeenCalled();
      const updateArgs = mockedPrisma.recurringTransaction.update.mock.calls[0][0];
      expect(updateArgs.where.id).toBe('rec_1');
      // nextDate 应推进一个月（8月）
      const newNextDate = new Date(updateArgs.data.nextDate);
      expect(newNextDate.getMonth()).toBe(7); // 8 月（0-indexed）
    });

    test('executes an EXPENSE rule', async () => {
      mockedPrisma.recurringTransaction.findUnique.mockResolvedValue({
        id: 'rec_2',
        familyId: 'fam_1',
        type: 'EXPENSE',
        category: '房租',
        amount: 5000,
        description: '月度房租',
        frequency: 'MONTHLY',
        interval: 1,
        nextDate: new Date('2026-07-01'),
        endDate: null,
        isActive: true,
        lastExecutedAt: null,
        createdBy: 'user_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app)
        .post('/api/families/fam_1/recurring/rec_2/execute')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.expense.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          familyId: 'fam_1',
          category: '房租',
          amount: 5000,
          createdBy: 'user_1',
        }),
      }));
    });

    test('returns 404 when rule not found', async () => {
      mockedPrisma.recurringTransaction.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/recurring/nonexistent/execute')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/families/:familyId/recurring/:id', () => {
    test('updates a recurring transaction', async () => {
      mockedPrisma.recurringTransaction.findUnique.mockResolvedValue({
        id: 'rec_1',
        familyId: 'fam_1',
        type: 'INCOME',
        category: '工资',
        amount: 15000,
        frequency: 'MONTHLY',
        interval: 1,
        nextDate: new Date('2026-08-01'),
        isActive: true,
        createdBy: 'user_1',
      });
      mockedPrisma.recurringTransaction.update.mockResolvedValue({
        id: 'rec_1',
        amount: 16000,
      });

      const res = await request(app)
        .put('/api/families/fam_1/recurring/rec_1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ amount: 16000 });

      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(16000);
    });

    test('returns 404 when not found', async () => {
      mockedPrisma.recurringTransaction.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/recurring/nonexistent')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ amount: 100 });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/families/:familyId/recurring/:id', () => {
    test('deletes a recurring transaction', async () => {
      mockedPrisma.recurringTransaction.findUnique.mockResolvedValue({
        id: 'rec_1',
        familyId: 'fam_1',
        createdBy: 'user_1',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/recurring/rec_1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.recurringTransaction.delete).toHaveBeenCalledWith({ where: { id: 'rec_1' } });
    });

    test('returns 403 for viewer role', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue({
        familyId: 'fam_1',
        userId: 'user_1',
        role: 'viewer',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/recurring/rec_1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });
});
