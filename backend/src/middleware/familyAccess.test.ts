import { Response } from 'express';

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '../db/prisma';
import {
  requireFamilyAccess,
  requireFamilyAdminAccess,
  requireFamilyMemberRemovalAccess,
  requireFamilyWriteAccess,
} from './familyAccess';

const mockedMembership = prisma.familyMember.findUnique as jest.Mock;

function createResponse() {
  const originalJson = jest.fn();
  const response = {
    statusCode: 200,
    status: jest.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: originalJson,
  } as unknown as Response;
  return { response, originalJson };
}

describe('family write access response handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedMembership.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'member_1',
      role: 'member',
      family: { cacheVersion: 7 },
    });
  });

  test('loads and exposes the durable family cache revision before continuing', async () => {
    const req = { params: { familyId: 'fam_1' }, userId: 'member_1' } as any;
    const next = jest.fn();

    await requireFamilyAccess(req, createResponse().response, next);

    expect(mockedMembership).toHaveBeenCalledWith({
      where: {
        familyId_userId: {
          familyId: 'fam_1',
          userId: 'member_1',
        },
      },
      include: {
        family: {
          select: { cacheVersion: true },
        },
      },
    });
    expect(req.familyCacheState).toEqual({ version: 7 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('allows an authorized writer without wrapping the handler response', async () => {
    const { response } = createResponse();
    const next = jest.fn();

    await requireFamilyWriteAccess(
      { params: { familyId: 'fam_1' }, userId: 'member_1' } as any,
      response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects a viewer before an administrator-only family mutation', async () => {
    mockedMembership.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'viewer_1',
      role: 'viewer',
      family: { cacheVersion: 7 },
    });
    const { response, originalJson } = createResponse();
    const next = jest.fn();

    await requireFamilyAdminAccess(
      { params: { id: 'fam_1' }, userId: 'viewer_1' } as any,
      response,
      next,
    );

    expect(response.statusCode).toBe(403);
    expect(originalJson).toHaveBeenCalledWith({ error: '无权修改该家庭' });
    expect(next).not.toHaveBeenCalled();
  });

  test('allows a member to remove only their own membership while still rejecting viewers', async () => {
    const { response } = createResponse();
    const next = jest.fn();

    await requireFamilyMemberRemovalAccess(
      { params: { id: 'fam_1', memberId: 'member_1' }, userId: 'member_1' } as any,
      response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
