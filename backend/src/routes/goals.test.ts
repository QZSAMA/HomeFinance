import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import goalRoutes from './goals';

jest.mock('../app', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    goal: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    asset: { findMany: jest.fn() },
    liability: { findMany: jest.fn() },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/goals', goalRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Goal Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.goal.findMany.mockResolvedValue([]);
    mockedPrisma.goal.findUnique.mockResolvedValue(null);
    mockedPrisma.goal.create.mockResolvedValue({});
    mockedPrisma.goal.update.mockResolvedValue({});
    mockedPrisma.goal.delete.mockResolvedValue({});
    mockedPrisma.asset.findMany.mockResolvedValue([]);
    mockedPrisma.liability.findMany.mockResolvedValue([]);
  });

  describe('POST /api/families/:familyId/goals', () => {
    test('creates a goal and returns 201', async () => {
      const created = {
        id: 'g1',
        familyId: 'fam_1',
        title: '买房首付',
        type: 'SAVING',
        targetAmount: 1000000,
        deadline: null,
        isCompleted: false,
        createdBy: 'user_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockedPrisma.goal.create.mockResolvedValue(created);

      const res = await request(app)
        .post('/api/families/fam_1/goals')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          title: '买房首付',
          type: 'SAVING',
          targetAmount: 1000000,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('g1');
      expect(res.body.title).toBe('买房首付');
      expect(mockedPrisma.goal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          familyId: 'fam_1',
          title: '买房首付',
          type: 'SAVING',
          targetAmount: 1000000,
          createdBy: 'user_1',
        }),
      });
    });

    test('rejects targetAmount <= 0 with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/goals')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ title: '无效目标', type: 'SAVING', targetAmount: 0 });

      expect(res.status).toBe(400);
      expect(mockedPrisma.goal.create).not.toHaveBeenCalled();
    });

    test('rejects invalid type with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/goals')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ title: '无效类型', type: 'OTHER', targetAmount: 1000 });

      expect(res.status).toBe(400);
      expect(mockedPrisma.goal.create).not.toHaveBeenCalled();
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/goals')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ title: 'x', type: 'SAVING', targetAmount: 1000 });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/families/:familyId/goals', () => {
    test('returns goal list', async () => {
      mockedPrisma.goal.findMany.mockResolvedValue([
        { id: 'g1', title: '买房', type: 'SAVING', targetAmount: 1000000 },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/goals')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
    });

    test('returns 401 without token', async () => {
      const res = await request(app).get('/api/families/fam_1/goals');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/families/:familyId/goals/progress', () => {
    test('returns progress for SAVING goal (net worth)', async () => {
      mockedPrisma.goal.findMany.mockResolvedValue([
        { id: 'g1', familyId: 'fam_1', title: '储蓄', type: 'SAVING', targetAmount: 100000, deadline: null, isCompleted: false },
      ]);
      mockedPrisma.asset.findMany.mockResolvedValue([{ value: 150000 }]);
      mockedPrisma.liability.findMany.mockResolvedValue([{ amount: 50000 }]);

      const res = await request(app)
        .get('/api/families/fam_1/goals/progress')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body[0].currentAmount).toBe(100000); // 150000 - 50000
      expect(res.body[0].percentage).toBe(100);
    });

    test('returns progress for DEBT_PAYOFF goal', async () => {
      mockedPrisma.goal.findMany.mockResolvedValue([
        { id: 'g2', familyId: 'fam_1', title: '还清信用卡', type: 'DEBT_PAYOFF', targetAmount: 50000, deadline: null, isCompleted: false },
      ]);
      // 当前还有 20000 负债 → 已还 30000
      mockedPrisma.asset.findMany.mockResolvedValue([]);
      mockedPrisma.liability.findMany.mockResolvedValue([{ amount: 20000 }]);

      const res = await request(app)
        .get('/api/families/fam_1/goals/progress')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body[0].currentAmount).toBe(30000); // 50000 - 20000
      expect(res.body[0].percentage).toBe(60);
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/goals/progress')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/families/:familyId/goals/:id', () => {
    test('updates a goal', async () => {
      mockedPrisma.goal.findUnique.mockResolvedValue({
        id: 'g1', familyId: 'fam_1', title: '旧标题', type: 'SAVING', targetAmount: 1000,
      });
      mockedPrisma.goal.update.mockResolvedValue({
        id: 'g1', familyId: 'fam_1', title: '新标题', type: 'SAVING', targetAmount: 2000,
      });

      const res = await request(app)
        .put('/api/families/fam_1/goals/g1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ title: '新标题', targetAmount: 2000 });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('新标题');
    });

    test('returns 404 when goal not found', async () => {
      mockedPrisma.goal.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put('/api/families/fam_1/goals/g1')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ title: 'x' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/families/:familyId/goals/:id', () => {
    test('deletes a goal', async () => {
      mockedPrisma.goal.findUnique.mockResolvedValue({
        id: 'g1', familyId: 'fam_1',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/goals/g1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(mockedPrisma.goal.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
    });

    test('rejects viewer with 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue({
        familyId: 'fam_1',
        userId: 'user_1',
        role: 'viewer',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/goals/g1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(mockedPrisma.goal.delete).not.toHaveBeenCalled();
    });
  });
});
