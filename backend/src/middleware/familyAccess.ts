import { NextFunction, Response } from 'express';
import { prisma } from '../app';
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

const loadFamilyMembership = async (req: FamilyAccessRequest) => {
  const familyId = req.params.familyId as string;
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

export const requireFamilyAccess = async (
  req: FamilyAccessRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const membership = await loadFamilyMembership(req);

    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    attachFamilyContext(req, membership);
    return next();
  } catch (error) {
    console.error('家庭访问权限校验错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
};

export const createFamilyWriteAccess = (forbiddenMessage = '无权修改该家庭数据') => (
  async (req: FamilyAccessRequest, res: Response, next: NextFunction) => {
    try {
      const membership = await loadFamilyMembership(req);

      if (!membership || !['admin', 'member'].includes(membership.role)) {
        return res.status(403).json({ error: forbiddenMessage });
      }

      attachFamilyContext(req, membership);
      return next();
    } catch (error) {
      console.error('家庭写权限校验错误:', error);
      return res.status(500).json({ error: '服务器内部错误' });
    }
  }
);

export const requireFamilyWriteAccess = createFamilyWriteAccess();
