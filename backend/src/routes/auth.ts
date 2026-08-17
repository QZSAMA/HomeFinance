import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validatePasswordStrength } from '../utils/passwordPolicy';
import { checkLoginLock, recordLoginFailure, clearLoginFailures } from '../middleware/loginLock';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().refine(
    (pw) => validatePasswordStrength(pw).valid,
    (pw) => ({ message: validatePasswordStrength(pw).reason || '密码强度不足' })
  ),
  name: z.string().min(2, '姓名至少2位')
});

const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(1, '密码不能为空')
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: '该邮箱已被注册' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
        name
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    });

    const token = (jwt as any).sign(
      { userId: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET as string,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ user, token });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('注册错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    // 登录前检查账号锁定状态
    const lockStatus = await checkLoginLock(email);
    if (lockStatus.locked) {
      return res.status(423).json({ error: '账号已被锁定，请15分钟后再试' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      await recordLoginFailure(email);
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await recordLoginFailure(email);
      return res.status(401).json({ error: '邮箱或密码错误' });
    }

    // 登录成功，清除失败计数
    await clearLoginFailures(email);

    const token = (jwt as any).sign(
      { userId: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET as string,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      token
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('登录错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/logout', authMiddleware, (_req: AuthRequest, res) => {
  res.json({ message: '登出成功' });
});

router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    res.json(user);
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '当前密码不能为空'),
  newPassword: z.string().min(1, '新密码不能为空')
});

router.post('/change-password', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return res.status(401).json({ error: '当前密码错误' });
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return res.status(400).json({ error: strength.reason });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.userId },
      data: { passwordHash: newHash }
    });

    res.json({ message: '密码修改成功' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('修改密码错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
