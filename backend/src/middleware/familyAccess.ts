import { NextFunction, Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthRequest } from './auth';

export type FamilyRole = 'admin' | 'member' | 'viewer';

export interface FamilyAccessRequest extends AuthRequest {
  familyMembership?: {
    familyId: string;
    userId: string;
    role: FamilyRole;
  };
  familyCacheState?: {
    version: number;
  };
}

const loadFamilyMembership = async (req: FamilyAccessRequest, familyParam = 'familyId') => {
  const familyId = req.params[familyParam] as string;
  return prisma.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId,
        userId: req.userId!,
      },
    },
    include: {
      family: {
        select: { cacheVersion: true },
      },
    },
  });
};

const attachFamilyContext = (
  req: FamilyAccessRequest,
  membership: NonNullable<Awaited<ReturnType<typeof loadFamilyMembership>>>,
) => {
  req.familyMembership = {
    familyId: membership.familyId,
    userId: membership.userId,
    role: membership.role as FamilyRole,
  };
  const cacheVersion = (membership as typeof membership & {
    family?: { cacheVersion?: number };
  }).family?.cacheVersion;
  req.familyCacheState = Number.isSafeInteger(cacheVersion) && cacheVersion! >= 0
    ? { version: cacheVersion! }
    : undefined;
};

const createFamilyRoleAccess = (
  allowedRoles: readonly FamilyRole[],
  forbiddenMessage: string,
  familyParam = 'familyId',
  errorLabel = '家庭访问权限校验错误',
) => (
  async (req: FamilyAccessRequest, res: Response, next: NextFunction) => {
    try {
      const membership = await loadFamilyMembership(req, familyParam);

      if (!membership || !allowedRoles.includes(membership.role as FamilyRole)) {
        return res.status(403).json({ error: forbiddenMessage });
      }

      attachFamilyContext(req, membership);
      return next();
    } catch (error) {
      console.error(errorLabel, error);
      return res.status(500).json({ error: '服务器内部错误' });
    }
  }
);

export const requireFamilyAccess = createFamilyRoleAccess(
  ['admin', 'member', 'viewer'],
  '无权访问该家庭',
);

export const createFamilyWriteAccess = (forbiddenMessage = '无权修改该家庭数据') => (
  createFamilyRoleAccess(['admin', 'member'], forbiddenMessage, 'familyId', '家庭写权限校验错误')
);

export const requireFamilyWriteAccess = createFamilyWriteAccess();

export const requireFamilyAdminAccess = createFamilyRoleAccess(
  ['admin'],
  '无权修改该家庭',
  'id',
  '家庭管理员权限校验错误',
);

export const requireFamilyMemberRemovalAccess = async (
  req: FamilyAccessRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const membership = await loadFamilyMembership(req, 'id');
    const isSelfRemoval = req.userId === req.params.memberId && membership?.role === 'member';
    const mayRemove = membership?.role === 'admin' || isSelfRemoval;

    if (!membership || !mayRemove) {
      return res.status(403).json({ error: '无权移除成员' });
    }

    attachFamilyContext(req, membership);
    return next();
  } catch (error) {
    console.error('家庭成员移除权限校验错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
};
