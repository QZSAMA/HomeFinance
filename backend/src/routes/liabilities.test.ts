import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import liabilitiesRoutes from './liabilities';

jest.mock('../services/balanceMutationService', () => ({
  createLiability: jest.fn(),
  updateLiability: jest.fn(),
  deleteLiability: jest.fn(),
}));

jest.mock('../db/prisma', () => {
  const model = () => ({
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  });

  return {
    prisma: {
      familyMember: model(),
      liability: model(),
    },
  };
});

import { prisma } from '../db/prisma';
import * as balanceMutationService from '../services/balanceMutationService';

const mockedPrisma = prisma as any;
const mockedBalance = balanceMutationService as any;
const app = express();
app.use(express.json());
app.use('/api/families/:familyId/liabilities', liabilitiesRoutes);

const tokenFor = (userId = 'member-1') => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Member' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const liabilityBody = {
  name: '住房贷款',
  type: 'MORTGAGE',
  amount: 350000,
  interestRate: 3.8,
  startDate: '2024-01-01T00:00:00.000Z',
  endDate: '2044-01-01T00:00:00.000Z',
  currency: 'CNY',
  description: '测试负债',
};

const member = { familyId: 'family-1', userId: 'member-1', role: 'member' };

describe('liability routes characterization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue(member);
    mockedPrisma.liability.findMany.mockResolvedValue([]);
    mockedPrisma.liability.count.mockResolvedValue(0);
    mockedPrisma.liability.findUnique.mockResolvedValue(null);
    mockedPrisma.liability.create.mockResolvedValue({ id: 'liability-1', ...liabilityBody });
    mockedPrisma.liability.update.mockResolvedValue({ id: 'liability-1', ...liabilityBody, amount: 340000 });
    mockedPrisma.liability.delete.mockResolvedValue({ id: 'liability-1' });
    mockedBalance.createLiability.mockResolvedValue({
      operationId: 'operation-liability-create',
      resourceId: 'liability-1',
      record: { id: 'liability-1', ...liabilityBody, currency: 'CNY', version: 1 },
      version: 1,
      deduplicated: false,
    });
    mockedBalance.updateLiability.mockResolvedValue({
      operationId: 'operation-liability-update',
      resourceId: 'liability-1',
      record: { id: 'liability-1', ...liabilityBody, amount: 340000, currency: 'CNY', version: 2 },
      version: 2,
      deduplicated: false,
    });
    mockedBalance.deleteLiability.mockResolvedValue({
      operationId: 'operation-liability-delete',
      resourceId: 'liability-1',
      version: 2,
      deduplicated: false,
    });
  });

  test('lists all family liabilities and supports pagination', async () => {
    mockedPrisma.liability.findMany.mockResolvedValueOnce([{ id: 'liability-1', amount: 1000 }]);
    const list = await request(app)
      .get('/api/families/family-1/liabilities')
      .set('Authorization', `Bearer ${tokenFor()}`);

    mockedPrisma.liability.findMany.mockResolvedValueOnce([{ id: 'liability-2', amount: 500 }]);
    mockedPrisma.liability.count.mockResolvedValueOnce(2);
    const page = await request(app)
      .get('/api/families/family-1/liabilities?page=2&pageSize=1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(list.status).toBe(200);
    expect(list.body).toEqual([{ id: 'liability-1', amount: 1000 }]);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ total: 2, page: 2, pageSize: 1, totalPages: 2 });
    expect(mockedPrisma.liability.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 1, take: 1 }));
  });

  test('rejects a non-member from reading liabilities', async () => {
    mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/families/family-1/liabilities')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(403);
    expect(mockedPrisma.liability.findMany).not.toHaveBeenCalled();
  });

  test('creates a liability and converts date strings for Prisma', async () => {
    const response = await request(app)
      .post('/api/families/family-1/liabilities')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(liabilityBody);

    expect(response.status).toBe(201);
    expect(mockedPrisma.liability.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'family-1',
        amount: 350000,
        startDate: new Date(liabilityBody.startDate),
        endDate: new Date(liabilityBody.endDate),
      }),
    });
  });

  test('creates a liability through the transactional application service', async () => {
    const response = await request(app)
      .post('/api/families/family-1/liabilities')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .set('Idempotency-Key', 'liability-create-1')
      .send(liabilityBody);

    expect(response.status).toBe(201);
    expect(mockedBalance.createLiability).toHaveBeenCalledWith({
      familyId: 'family-1',
      actorId: 'member-1',
      source: 'MANUAL',
      idempotencyKey: 'liability-create-1',
      payload: {
        name: liabilityBody.name,
        type: liabilityBody.type,
        amount: liabilityBody.amount,
        interestRate: liabilityBody.interestRate,
        startDate: new Date(liabilityBody.startDate),
        endDate: new Date(liabilityBody.endDate),
        currency: liabilityBody.currency,
        description: liabilityBody.description,
      },
    }, expect.any(Object));
    expect(mockedPrisma.liability.create).not.toHaveBeenCalled();
  });

  test('rejects malformed and forbidden liability creates', async () => {
    const invalid = await request(app)
      .post('/api/families/family-1/liabilities')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...liabilityBody, name: '', amount: -1 });

    mockedPrisma.familyMember.findUnique.mockResolvedValueOnce({ ...member, role: 'viewer' });
    const viewer = await request(app)
      .post('/api/families/family-1/liabilities')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(liabilityBody);

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('负债名称不能为空');
    expect(viewer.status).toBe(403);
    expect(mockedPrisma.liability.create).toHaveBeenCalledTimes(0);
  });

  test('updates a liability and refuses a cross-family record', async () => {
    mockedPrisma.liability.findUnique.mockResolvedValueOnce({ id: 'liability-1', familyId: 'family-1' });
    const update = await request(app)
      .put('/api/families/family-1/liabilities/liability-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...liabilityBody, amount: 340000 });

    mockedPrisma.liability.findUnique.mockResolvedValueOnce({ id: 'liability-2', familyId: 'family-2' });
    const missing = await request(app)
      .put('/api/families/family-1/liabilities/liability-2')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(liabilityBody);

    expect(update.status).toBe(200);
    expect(mockedPrisma.liability.update).toHaveBeenCalledWith({
      where: { id: 'liability-1' },
      data: expect.objectContaining({ amount: 340000 }),
    });
    expect(missing.status).toBe(404);
  });

  test('returns the update/delete authorization and not-found contracts', async () => {
    mockedPrisma.familyMember.findUnique
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce(null);
    const updateForbidden = await request(app)
      .put('/api/families/family-1/liabilities/liability-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(liabilityBody);

    mockedPrisma.liability.findUnique.mockResolvedValue(null);
    const deleteMissing = await request(app)
      .delete('/api/families/family-1/liabilities/liability-1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(updateForbidden.status).toBe(403);
    expect(deleteMissing.status).toBe(404);
    expect(mockedPrisma.liability.delete).not.toHaveBeenCalled();
  });

  test('deletes a liability for a member', async () => {
    mockedPrisma.liability.findUnique.mockResolvedValue({ id: 'liability-1', familyId: 'family-1' });

    const response = await request(app)
      .delete('/api/families/family-1/liabilities/liability-1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '删除成功' });
    expect(mockedPrisma.liability.delete).toHaveBeenCalledWith({ where: { id: 'liability-1' } });
  });

  test('converts database failures to 500 responses', async () => {
    mockedPrisma.liability.findMany.mockRejectedValueOnce(new Error('database unavailable'));
    const list = await request(app)
      .get('/api/families/family-1/liabilities')
      .set('Authorization', `Bearer ${tokenFor()}`);

    mockedPrisma.liability.create.mockRejectedValueOnce(new Error('database unavailable'));
    const create = await request(app)
      .post('/api/families/family-1/liabilities')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(liabilityBody);

    expect(list.status).toBe(500);
    expect(create.status).toBe(500);
  });
});
