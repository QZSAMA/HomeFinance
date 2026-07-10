import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import familyRoutes from './families';

jest.mock('../app', () => ({
  prisma: {
    family: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    familyMember: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families', familyRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Family Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/families', () => {
    test('returns family list for authenticated user', async () => {
      mockedPrisma.family.findMany.mockResolvedValue([
        { id: 'fam_1', name: 'Family 1', members: [] },
      ]);

      const res = await request(app)
        .get('/api/families')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });

    test('returns 401 without token', async () => {
      const res = await request(app).get('/api/families');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/families', () => {
    test('creates a new family', async () => {
      mockedPrisma.family.create.mockResolvedValue({
        id: 'fam_1',
        name: 'New Family',
        members: [{ userId: 'user_1', role: 'admin' }],
      });

      const res = await request(app)
        .post('/api/families')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ name: 'New Family' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('New Family');
    });

    test('rejects short name', async () => {
      const res = await request(app)
        .post('/api/families')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ name: 'A' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/families/:id', () => {
    test('returns family details for member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue({ familyId: 'fam_1', userId: 'user_1', role: 'admin' });
      mockedPrisma.family.findUnique.mockResolvedValue({ id: 'fam_1', name: 'Family 1', members: [] });

      const res = await request(app)
        .get('/api/families/fam_1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('fam_1');
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/families/:id/invite', () => {
    test('invites a user to family', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue({ familyId: 'fam_1', userId: 'user_1', role: 'admin' });
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 'user_2', email: 'new@example.com', name: 'New' });
      mockedPrisma.familyMember.findUnique.mockResolvedValueOnce({ familyId: 'fam_1', userId: 'user_1', role: 'admin' });
      mockedPrisma.familyMember.findUnique.mockResolvedValueOnce(null);
      mockedPrisma.familyMember.create.mockResolvedValue({});
      mockedPrisma.family.findUnique.mockResolvedValue({ id: 'fam_1', name: 'Family 1', members: [] });

      const res = await request(app)
        .post('/api/families/fam_1/invite')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ email: 'new@example.com', role: 'member' });

      expect(res.status).toBe(201);
    });

    test('rejects non-admin invite', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue({ familyId: 'fam_1', userId: 'user_1', role: 'member' });

      const res = await request(app)
        .post('/api/families/fam_1/invite')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ email: 'new@example.com', role: 'member' });

      expect(res.status).toBe(403);
    });
  });
});
