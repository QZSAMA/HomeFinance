import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();



const createFamilySchema = z.object({
  name: z.string().min(2, '家庭名称至少2位'),
  description: z.string().optional()
});

const inviteMemberSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  role: z.enum(['admin', 'member', 'viewer']).default('member')
});

const updateRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer'])
});

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const families = await prisma.family.findMany({
      where: {
        members: {
          some: {
            userId: req.userId
          }
        }
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.json(families);
  } catch (error) {
    console.error('获取家庭列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { name, description } = createFamilySchema.parse(req.body);

    const family = await prisma.family.create({
      data: {
        name,
        description,
        members: {
          create: {
            userId: req.userId!,
            role: 'admin'
          }
        }
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.status(201).json(family);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('创建家庭错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;

    const membership = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: id,
          userId: req.userId!
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const family = await prisma.family.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });

    if (!family) {
      return res.status(404).json({ error: '家庭不存在' });
    }

    res.json(family);
  } catch (error) {
    console.error('获取家庭详情错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { name, description } = createFamilySchema.parse(req.body);

    const membership = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: id,
          userId: req.userId!
        }
      }
    });

    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: '无权修改该家庭' });
    }

    const family = await prisma.family.update({
      where: { id },
      data: { name, description },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.json(family);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('更新家庭错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;

    const membership = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: id,
          userId: req.userId!
        }
      }
    });

    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: '无权删除该家庭' });
    }

    await prisma.family.delete({ where: { id } });

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除家庭错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/:id/invite', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const { email, role } = inviteMemberSchema.parse(req.body);

    const membership = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: id,
          userId: req.userId!
        }
      }
    });

    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: '无权邀请成员' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: '该用户不存在，请先注册' });
    }

    const existingMember = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: id,
          userId: user.id
        }
      }
    });

    if (existingMember) {
      return res.status(400).json({ error: '该用户已在家庭中' });
    }

    await prisma.familyMember.create({
      data: {
        familyId: id,
        userId: user.id,
        role
      }
    });

    const family = await prisma.family.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.status(201).json(family);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('邀请成员错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.put('/:id/members/:memberId/role', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const memberId = req.params.memberId as string;
    const { role } = updateRoleSchema.parse(req.body);

    const membership = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: id,
          userId: req.userId!
        }
      }
    });

    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: '无权修改成员角色' });
    }

    const targetMember = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: id,
          userId: memberId
        }
      }
    });

    if (!targetMember) {
      return res.status(404).json({ error: '成员不存在' });
    }

    await prisma.familyMember.update({
      where: {
        familyId_userId: {
          familyId: id,
          userId: memberId
        }
      },
      data: { role }
    });

    const family = await prisma.family.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });

    res.json(family);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('修改角色错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.delete('/:id/members/:memberId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const memberId = req.params.memberId as string;

    const membership = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: id,
          userId: req.userId!
        }
      }
    });

    if (!membership || (membership.role !== 'admin' && req.userId !== memberId)) {
      return res.status(403).json({ error: '无权移除成员' });
    }

    if (membership.role === 'admin' && req.userId === memberId) {
      const adminCount = await prisma.familyMember.count({
        where: { familyId: id, role: 'admin' }
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: '至少需要一名管理员' });
      }
    }

    await prisma.familyMember.delete({
      where: {
        familyId_userId: {
          familyId: id,
          userId: memberId
        }
      }
    });

    res.json({ message: '移除成功' });
  } catch (error) {
    console.error('移除成员错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
