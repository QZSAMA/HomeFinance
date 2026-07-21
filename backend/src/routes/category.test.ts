import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import categoryRoutes from './category';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../services/categoryService', () => ({
  suggestCategory: jest.fn(),
}));

import { prisma } from '../app';
import { suggestCategory } from '../services/categoryService';

const mockedPrisma = prisma as any;
const mockedSuggestCategory = suggestCategory as jest.MockedFunction<typeof suggestCategory>;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/category', categoryRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Category Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
  });

  describe('GET /api/families/:familyId/category/suggest', () => {
    test('returns suggested category for EXPENSE', async () => {
      mockedSuggestCategory.mockResolvedValue('餐饮');

      const res = await request(app)
        .get('/api/families/fam_1/category/suggest')
        .set('Authorization', `Bearer ${createToken()}`)
        .query({ type: 'EXPENSE', description: '星巴克' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBe('餐饮');
      expect(mockedSuggestCategory).toHaveBeenCalledWith('星巴克', 'fam_1', 'EXPENSE');
    });

    test('returns null category when no match', async () => {
      mockedSuggestCategory.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/category/suggest')
        .set('Authorization', `Bearer ${createToken()}`)
        .query({ type: 'EXPENSE', description: '未知' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBeNull();
    });

    test('rejects missing description with 400', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/category/suggest')
        .set('Authorization', `Bearer ${createToken()}`)
        .query({ type: 'EXPENSE' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockedSuggestCategory).not.toHaveBeenCalled();
    });

    test('rejects invalid type with 400', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/category/suggest')
        .set('Authorization', `Bearer ${createToken()}`)
        .query({ type: 'OTHER', description: '星巴克' });

      expect(res.status).toBe(400);
      expect(mockedSuggestCategory).not.toHaveBeenCalled();
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/category/suggest')
        .query({ type: 'EXPENSE', description: '星巴克' });

      expect(res.status).toBe(401);
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/category/suggest')
        .set('Authorization', `Bearer ${createToken()}`)
        .query({ type: 'EXPENSE', description: '星巴克' });

      expect(res.status).toBe(403);
    });

    test('passes INCOME type to service', async () => {
      mockedSuggestCategory.mockResolvedValue('工资');

      const res = await request(app)
        .get('/api/families/fam_1/category/suggest')
        .set('Authorization', `Bearer ${createToken()}`)
        .query({ type: 'INCOME', description: '工资' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBe('工资');
      expect(mockedSuggestCategory).toHaveBeenCalledWith('工资', 'fam_1', 'INCOME');
    });
  });
});
