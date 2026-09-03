import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    family: {
      findUnique: jest.fn(),
    },
    asset: {
      findMany: jest.fn(),
    },
    liability: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../config/redis', () => ({
  redisClient: {
    get: jest.fn(),
    setEx: jest.fn(),
  },
}));

import { prisma } from '../db/prisma';
import { redisClient } from '../config/redis';
import reportRoutes from '../routes/reports';

const mockedPrisma = prisma as any;
const mockedRedis = redisClient as any;

function createToken(userId: string) {
  return jwt.sign(
    { userId, email: `${userId}@example.com`, name: userId },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('report cache authorization', () => {
  test('returns 403 without reading a warmed family report cache for an authenticated non-member', async () => {
    const familyId = 'family-private';
    const memberId = 'family-member';
    const nonMemberId = 'authenticated-outsider';
    const reportUrl = `/api/families/${familyId}/reports/balance-sheet`;
    const cacheStore = new Map<string, string>();

    mockedRedis.get.mockImplementation(async (key: string) => cacheStore.get(key) ?? null);
    mockedRedis.setEx.mockImplementation(async (key: string, _ttl: number, value: string) => {
      cacheStore.set(key, value);
      return 'OK';
    });
    mockedPrisma.familyMember.findUnique.mockImplementation(async ({ where }: any) => {
      const userId = where.familyId_userId.userId;
      return userId === memberId
        ? { familyId, userId, role: 'member', family: { cacheVersion: 0 } }
        : null;
    });
    mockedPrisma.family.findUnique.mockResolvedValue({ timezone: 'Asia/Shanghai', baseCurrency: 'CNY' });
    mockedPrisma.asset.findMany.mockResolvedValue([
      {
        id: 'private-asset',
        familyId,
        type: 'CASH',
        value: 98765,
        description: 'private family reserve',
      },
    ]);
    mockedPrisma.liability.findMany.mockResolvedValue([]);

    const app = express();
    app.use('/api/families/:familyId/reports', reportRoutes);

    const memberResponse = await request(app)
      .get(reportUrl)
      .set('Authorization', `Bearer ${createToken(memberId)}`);

    expect(memberResponse.status).toBe(200);
    expect(memberResponse.body.totalAssets).toBe(98765);
    expect(memberResponse.headers['x-cache']).toBe('MISS');
    expect(JSON.parse(cacheStore.get(`cache:family:v2:${familyId}:v0:${reportUrl}`)!)).toMatchObject({
      totalAssets: 98765,
      assetList: [expect.objectContaining({ description: 'private family reserve' })],
    });

    mockedRedis.get.mockClear();
    mockedPrisma.familyMember.findUnique.mockClear();

    const nonMemberResponse = await request(app)
      .get(reportUrl)
      .set('Authorization', `Bearer ${createToken(nonMemberId)}`);

    expect(nonMemberResponse.status).toBe(403);
    expect(nonMemberResponse.body).toEqual({ error: '无权访问该家庭' });
    expect(JSON.stringify(nonMemberResponse.body)).not.toContain('private family reserve');
    expect(mockedPrisma.familyMember.findUnique).toHaveBeenCalledWith({
      where: {
        familyId_userId: {
          familyId,
          userId: nonMemberId,
        },
      },
      include: {
        family: {
          select: { cacheVersion: true },
        },
      },
    });
    expect(mockedRedis.get).not.toHaveBeenCalled();
  });
});
