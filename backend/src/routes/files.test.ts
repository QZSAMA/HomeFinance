import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import fileRoutes from './files';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    file: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('../config/minio', () => ({
  uploadFileBuffer: jest.fn().mockResolvedValue('test-path'),
  getFileUrl: jest.fn().mockResolvedValue('http://localhost:9000/test-url'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/phash', () => ({
  computePHash: jest.fn().mockResolvedValue(null),
  isSimilarImage: jest.fn().mockReturnValue(false),
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/files', fileRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('File Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.file.findMany.mockResolvedValue([]);
    mockedPrisma.file.findUnique.mockResolvedValue(null);
    mockedPrisma.file.create.mockResolvedValue({});
    mockedPrisma.file.delete.mockResolvedValue({});
  });

  describe('GET /api/families/:familyId/files', () => {
    test('returns file list with URLs', async () => {
      mockedPrisma.file.findMany.mockResolvedValue([
        { id: 'f1', name: 'receipt.jpg', path: 'fam_1/receipt.jpg', type: 'image/jpeg', size: 1024, mimeType: 'image/jpeg', phash: null, familyId: 'fam_1', uploadedAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/files')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('receipt.jpg');
      expect(res.body[0].url).toBeDefined();
    });

    test('returns 403 when user has no access', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/files')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/families/:familyId/files/upload', () => {
    test('uploads a file successfully', async () => {
      mockedPrisma.file.create.mockResolvedValue({
        id: 'f1',
        name: 'test.txt',
        path: 'fam_1/test.txt',
        type: 'text/plain',
        size: 12,
        mimeType: 'text/plain',
        phash: null,
        familyId: 'fam_1',
      });

      const res = await request(app)
        .post('/api/families/fam_1/files/upload')
        .set('Authorization', `Bearer ${createToken()}`)
        .attach('files', Buffer.from('hello world!'), 'test.txt');

      expect(res.status).toBe(201);
      expect(res.body.files).toHaveLength(1);
      expect(res.body.message).toContain('成功上传');
    });

    test('returns 400 when no file uploaded', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/files/upload')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('没有上传文件');
    });
  });

  describe('DELETE /api/families/:familyId/files/:id', () => {
    test('deletes a file successfully', async () => {
      mockedPrisma.file.findUnique.mockResolvedValue({
        id: 'f1',
        name: 'test.txt',
        path: 'fam_1/test.txt',
        familyId: 'fam_1',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/files/f1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('删除成功');
      expect(mockedPrisma.file.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    });

    test('returns 403 for viewer role', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue({
        familyId: 'fam_1',
        userId: 'user_1',
        role: 'viewer',
      });

      const res = await request(app)
        .delete('/api/families/fam_1/files/f1')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('无权删除文件');
    });

    test('returns 404 when file not found', async () => {
      mockedPrisma.file.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/families/fam_1/files/nonexistent')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('文件不存在');
    });
  });

  describe('GET /api/families/:familyId/files/check-duplicates', () => {
    test('returns empty duplicates when no similar images', async () => {
      mockedPrisma.file.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/files/check-duplicates')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.duplicates).toEqual([]);
    });

    test('detects duplicate images', async () => {
      const { isSimilarImage } = require('../utils/phash');
      (isSimilarImage as jest.Mock).mockReturnValue(true);

      mockedPrisma.file.findMany.mockResolvedValue([
        { id: 'f1', name: 'img1.jpg', phash: 'abc123' },
        { id: 'f2', name: 'img2.jpg', phash: 'abc124' },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/files/check-duplicates')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.duplicates).toHaveLength(1);
      expect(res.body.duplicates[0].file1).toBe('img1.jpg');
      expect(res.body.duplicates[0].file2).toBe('img2.jpg');
    });
  });
});
