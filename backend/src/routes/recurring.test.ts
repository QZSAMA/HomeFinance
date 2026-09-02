import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

const executeRecurring = jest.fn();

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    recurringTransaction: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    income: { create: jest.fn() },
    expense: { create: jest.fn() },
  },
}));

jest.mock('../services/recurringService', () => ({
  executeRecurring: (...args: unknown[]) => executeRecurring(...args),
}));

jest.mock('../services/prismaRecurringExecutionStore', () => ({
  createPrismaRecurringExecutionStore: jest.fn(() => ({ name: 'recurring-store' })),
}));

jest.mock('../middleware/cache', () => ({
  cacheMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

import { prisma } from '../db/prisma';
import { DomainError } from '../services/ledgerErrors';
import recurringRoutes from './recurring';

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
    mockedPrisma.recurringTransaction.count.mockResolvedValue(0);
    mockedPrisma.recurringTransaction.findUnique.mockResolvedValue(null);
    mockedPrisma.recurringTransaction.findFirst.mockResolvedValue(null);
    mockedPrisma.recurringTransaction.create.mockResolvedValue({});
    mockedPrisma.recurringTransaction.update.mockResolvedValue({});
    mockedPrisma.recurringTransaction.updateMany.mockResolvedValue({ count: 1 });
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
      executeRecurring.mockResolvedValue({
        executionId: 'execution-1',
        operationId: 'operation-1',
        resourceId: 'execution-1',
        record: { id: 'execution-1', status: 'COMMITTED' },
        version: 2,
        deduplicated: false,
        entryId: 'income-1',
        entryRecord: { id: 'income-1', amount: 15000 },
        nextDate: new Date('2026-08-01'),
        isActive: true,
      });

      const res = await request(app)
        .post('/api/families/fam_1/recurring/rec_1/execute')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('成功');
      expect(executeRecurring).toHaveBeenCalled();
      expect(mockedPrisma.income.create).not.toHaveBeenCalled();
      expect(mockedPrisma.recurringTransaction.update).not.toHaveBeenCalled();
    });

    test('executes an EXPENSE rule', async () => {
      executeRecurring.mockResolvedValue({
        executionId: 'execution-2',
        operationId: 'operation-2',
        resourceId: 'execution-2',
        record: { id: 'execution-2', status: 'COMMITTED' },
        version: 2,
        deduplicated: false,
        entryId: 'expense-1',
        entryRecord: { id: 'expense-1', amount: 5000 },
        nextDate: new Date('2026-08-01'),
        isActive: true,
      });

      const res = await request(app)
        .post('/api/families/fam_1/recurring/rec_2/execute')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(executeRecurring).toHaveBeenCalled();
      expect(mockedPrisma.expense.create).not.toHaveBeenCalled();
    });

    test('returns 404 when rule not found', async () => {
      executeRecurring.mockRejectedValue(new DomainError(
        'RESOURCE_NOT_FOUND',
        'The recurring rule was not found.',
        404,
      ));

      const res = await request(app)
        .post('/api/families/fam_1/recurring/nonexistent/execute')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/families/:familyId/recurring/:id', () => {
    test('updates a recurring transaction', async () => {
      mockedPrisma.recurringTransaction.findFirst.mockResolvedValue({
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
      mockedPrisma.recurringTransaction.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/recurring/nonexistent')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ amount: 100 });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/families/:familyId/recurring/:id', () => {
    test('deletes a recurring transaction', async () => {
      mockedPrisma.recurringTransaction.findFirst.mockResolvedValue({
        id: 'rec_1',
        familyId: 'fam_1',
        createdBy: 'user_1',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/recurring/rec_1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.recurringTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: 'rec_1', familyId: 'fam_1' },
        data: {
          isActive: false,
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        },
      });
      expect(mockedPrisma.recurringTransaction.delete).not.toHaveBeenCalled();
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
