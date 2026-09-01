import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import assetsRoutes from './assets';

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
      asset: model(),
    },
  };
});

import { prisma } from '../db/prisma';

const mockedPrisma = prisma as any;
const app = express();
app.use(express.json());
app.use('/api/families/:familyId/assets', assetsRoutes);

const tokenFor = (userId = 'member-1') => jwt.sign(
  { userId, email: `${userId}@example.test`, name: 'Member' },
  process.env.JWT_SECRET as string,
  { expiresIn: '1h' },
);

const assetBody = {
  name: '应急现金',
  type: 'CASH',
  category: '流动资产',
  value: 12500,
  costBasis: 12000,
  currency: 'cny',
  purchaseDate: '2026-08-01T00:00:00.000Z',
  description: '测试资产',
};

const member = { familyId: 'family-1', userId: 'member-1', role: 'member' };

describe('asset routes characterization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue(member);
    mockedPrisma.asset.findMany.mockResolvedValue([]);
    mockedPrisma.asset.count.mockResolvedValue(0);
    mockedPrisma.asset.findUnique.mockResolvedValue(null);
    mockedPrisma.asset.create.mockResolvedValue({ id: 'asset-1', ...assetBody });
    mockedPrisma.asset.update.mockResolvedValue({ id: 'asset-1', ...assetBody, value: 13000 });
    mockedPrisma.asset.delete.mockResolvedValue({ id: 'asset-1' });
  });

  test('lists all family assets and preserves descending value ordering', async () => {
    mockedPrisma.asset.findMany.mockResolvedValue([
      { id: 'asset-1', familyId: 'family-1', value: 1000 },
      { id: 'asset-2', familyId: 'family-1', value: 500 },
    ]);

    const response = await request(app)
      .get('/api/families/family-1/assets')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(mockedPrisma.asset.findMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1' },
      orderBy: { value: 'desc' },
    });
  });

  test('returns the bounded paginated asset contract when requested', async () => {
    mockedPrisma.asset.findMany.mockResolvedValue([{ id: 'asset-2', value: 500 }]);
    mockedPrisma.asset.count.mockResolvedValue(3);

    const response = await request(app)
      .get('/api/families/family-1/assets?page=2&pageSize=1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [{ id: 'asset-2', value: 500 }],
      total: 3,
      page: 2,
      pageSize: 1,
      totalPages: 3,
    });
    expect(mockedPrisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 1, take: 1 }));
    expect(mockedPrisma.asset.count).toHaveBeenCalledWith({ where: { familyId: 'family-1' } });
  });

  test('rejects a non-member from every read path', async () => {
    mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

    const list = await request(app)
      .get('/api/families/family-1/assets')
      .set('Authorization', `Bearer ${tokenFor()}`);
    const allocation = await request(app)
      .get('/api/families/family-1/assets/allocation')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(list.status).toBe(403);
    expect(allocation.status).toBe(403);
    expect(mockedPrisma.asset.findMany).not.toHaveBeenCalled();
  });

  test('returns allocation buckets for every supported asset type', async () => {
    mockedPrisma.asset.findMany.mockResolvedValue([
      { type: 'STOCK', value: 100 },
      { type: 'FUND', value: 200 },
      { type: 'BOND', value: 300 },
      { type: 'GOLD', value: 400 },
      { type: 'CASH', value: 500 },
      { type: 'REAL_ESTATE', value: 600 },
    ]);

    const response = await request(app)
      .get('/api/families/family-1/assets/allocation')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.totalValue).toBe(2100);
    expect(response.body.allocation).toEqual([
      { category: 'STOCK', value: 300, percentage: 14.29 },
      { category: 'BOND', value: 300, percentage: 14.29 },
      { category: 'GOLD', value: 400, percentage: 19.05 },
      { category: 'CASH', value: 500, percentage: 23.81 },
      { category: 'OTHER', value: 600, percentage: 28.57 },
    ]);
  });

  test('returns zero percentages for an empty allocation', async () => {
    const response = await request(app)
      .get('/api/families/family-1/assets/allocation')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.totalValue).toBe(0);
    expect(response.body.allocation.every((entry: { percentage: number }) => entry.percentage === 0)).toBe(true);
  });

  test('creates an asset after write access and normalizes the date', async () => {
    const response = await request(app)
      .post('/api/families/family-1/assets')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(assetBody);

    expect(response.status).toBe(201);
    expect(mockedPrisma.asset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'family-1',
        name: '应急现金',
        type: 'CASH',
        value: 12500,
        currency: 'cny',
        purchaseDate: new Date(assetBody.purchaseDate),
      }),
    });
  });

  test('rejects malformed asset data before persistence', async () => {
    const response = await request(app)
      .post('/api/families/family-1/assets')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...assetBody, name: '', value: -1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('资产名称不能为空');
    expect(mockedPrisma.asset.create).not.toHaveBeenCalled();
  });

  test('rejects viewer and non-member writes before persistence', async () => {
    mockedPrisma.familyMember.findUnique.mockResolvedValueOnce({ ...member, role: 'viewer' });
    const viewerResponse = await request(app)
      .post('/api/families/family-1/assets')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(assetBody);

    mockedPrisma.familyMember.findUnique.mockResolvedValue(null);
    const nonMemberResponse = await request(app)
      .post('/api/families/family-1/assets')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(assetBody);

    expect(viewerResponse.status).toBe(403);
    expect(nonMemberResponse.status).toBe(403);
    expect(mockedPrisma.asset.create).not.toHaveBeenCalled();
  });

  test('updates an asset and returns 404 for a cross-family record', async () => {
    mockedPrisma.asset.findUnique.mockResolvedValueOnce({ id: 'asset-1', familyId: 'family-1' });
    const update = await request(app)
      .put('/api/families/family-1/assets/asset-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...assetBody, value: 13000 });

    mockedPrisma.asset.findUnique.mockResolvedValueOnce({ id: 'asset-2', familyId: 'family-2' });
    const missing = await request(app)
      .put('/api/families/family-1/assets/asset-2')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(assetBody);

    expect(update.status).toBe(200);
    expect(mockedPrisma.asset.update).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: expect.objectContaining({ value: 13000 }),
    });
    expect(missing.status).toBe(404);
  });

  test('returns the update and delete authorization/404 contracts', async () => {
    mockedPrisma.familyMember.findUnique
      .mockResolvedValueOnce(member)
      .mockResolvedValueOnce(null);
    const updateForbidden = await request(app)
      .put('/api/families/family-1/assets/asset-1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(assetBody);

    mockedPrisma.asset.findUnique.mockResolvedValue(null);
    const deleteMissing = await request(app)
      .delete('/api/families/family-1/assets/asset-1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(updateForbidden.status).toBe(403);
    expect(deleteMissing.status).toBe(404);
    expect(mockedPrisma.asset.delete).not.toHaveBeenCalled();
  });

  test('deletes an asset for a member', async () => {
    mockedPrisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', familyId: 'family-1' });

    const response = await request(app)
      .delete('/api/families/family-1/assets/asset-1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '删除成功' });
    expect(mockedPrisma.asset.delete).toHaveBeenCalledWith({ where: { id: 'asset-1' } });
  });

  test('converts database failures to 500 responses', async () => {
    mockedPrisma.asset.findMany.mockRejectedValueOnce(new Error('database unavailable'));
    const list = await request(app)
      .get('/api/families/family-1/assets')
      .set('Authorization', `Bearer ${tokenFor()}`);

    mockedPrisma.asset.findMany.mockRejectedValueOnce(new Error('database unavailable'));
    const allocation = await request(app)
      .get('/api/families/family-1/assets/allocation')
      .set('Authorization', `Bearer ${tokenFor()}`);

    mockedPrisma.asset.create.mockRejectedValueOnce(new Error('database unavailable'));
    const create = await request(app)
      .post('/api/families/family-1/assets')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(assetBody);

    expect(list.status).toBe(500);
    expect(allocation.status).toBe(500);
    expect(create.status).toBe(500);
  });
});
