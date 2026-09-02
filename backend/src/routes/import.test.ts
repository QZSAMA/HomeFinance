import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import importRoutes from './import';

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
    income: { create: jest.fn() },
    expense: { create: jest.fn() },
  },
}));

jest.mock('../services/importService', () => ({
  parseCSV: jest.fn(),
  persistImportPreview: jest.fn(),
  confirmImportBatch: jest.fn(),
  ImportBatchValidationError: class ImportBatchValidationError extends Error {},
}));

import { prisma } from '../db/prisma';
import { parseCSV } from '../services/importService';
import * as importService from '../services/importService';

const mockedPrisma = prisma as any;
const mockedParseCSV = parseCSV as jest.MockedFunction<typeof parseCSV>;
const mockedPersistImportPreview = (importService as any).persistImportPreview as jest.Mock;
const mockedConfirmImportBatch = (importService as any).confirmImportBatch as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/import', importRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

const ALIPAY_CSV = '交易号,交易时间,交易分类,金额,交易状态\n1,2026-07-01 10:00:00,餐饮,35,交易成功';
const WECHAT_CSV = '交易时间,交易类型,交易对方,金额\n2026-07-01 10:00:00,微信红包,张三,200';

describe('Import Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPersistImportPreview.mockResolvedValue({
      batchId: 'batch_1',
      previewHash: 'a'.repeat(64),
      status: 'PREVIEWED',
      rowCount: 0,
    });
    mockedConfirmImportBatch.mockResolvedValue({
      operationId: 'operation-1',
      resourceId: 'batch_1',
      record: {
        id: 'batch_1',
        batchId: 'batch_1',
        successCount: 2,
        failedRows: [],
      },
      deduplicated: false,
    });
  });

  describe('POST /api/families/:familyId/import/csv', () => {
    test('parses alipay CSV and returns preview', async () => {
      mockedParseCSV.mockResolvedValue([
        { date: '2026-07-01', description: '餐饮消费', amount: 35, type: 'EXPENSE', category: '餐饮' },
      ]);

      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'alipay')
        .attach('file', Buffer.from(ALIPAY_CSV), 'alipay.csv');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].amount).toBe(35);
      expect(mockedParseCSV).toHaveBeenCalledWith(expect.any(Buffer), 'alipay');
    });

    test('parses wechat CSV and returns preview', async () => {
      mockedParseCSV.mockResolvedValue([
        { date: '2026-07-01', description: '微信红包', amount: 200, type: 'INCOME' },
      ]);

      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'wechat')
        .attach('file', Buffer.from(WECHAT_CSV), 'wechat.csv');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].amount).toBe(200);
      expect(mockedParseCSV).toHaveBeenCalledWith(expect.any(Buffer), 'wechat');
    });

    test('rejects missing file with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'alipay');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(mockedParseCSV).not.toHaveBeenCalled();
    });

    test('rejects invalid format with 400', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'other')
        .attach('file', Buffer.from(ALIPAY_CSV), 'alipay.csv');

      expect(res.status).toBe(400);
      expect(mockedParseCSV).not.toHaveBeenCalled();
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .field('format', 'alipay')
        .attach('file', Buffer.from(ALIPAY_CSV), 'alipay.csv');

      expect(res.status).toBe(401);
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/import/csv')
        .set('Authorization', `Bearer ${createToken()}`)
        .field('format', 'alipay')
        .attach('file', Buffer.from(ALIPAY_CSV), 'alipay.csv');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/families/:familyId/import/confirm', () => {
    test('confirms a server-owned batch and returns the operation metadata', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .set('Idempotency-Key', 'import-confirm-1')
        .send({
          batchId: 'batch_1',
          expectedPreviewHash: 'a'.repeat(64),
          categoryPatch: { '2': '餐饮' },
        });

      expect(res.status).toBe(200);
      expect(res.body.batchId).toBe('batch_1');
      expect(res.body.successCount).toBe(2);
      expect(res.body.failedRows).toEqual([]);
      expect(res.body.operationId).toBe('operation-1');
      expect(mockedConfirmImportBatch).toHaveBeenCalledWith({
        familyId: 'fam_1',
        actorUserId: 'user_1',
        batchId: 'batch_1',
        expectedPreviewHash: 'a'.repeat(64),
        idempotencyKey: 'import-confirm-1',
        categoryPatch: { '2': '餐饮' },
      });
    });

    test('rejects client-owned financial items', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({
          items: [{ date: '2026-07-01', description: 'tampered', amount: 999, type: 'INCOME' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(mockedConfirmImportBatch).not.toHaveBeenCalled();
    });

    test('rejects a missing batch contract', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(mockedConfirmImportBatch).not.toHaveBeenCalled();
    });

    test('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .send({ batchId: 'batch_1', expectedPreviewHash: 'a'.repeat(64) });

      expect(res.status).toBe(401);
    });

    test('returns 403 for non-member', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/families/fam_1/import/confirm')
        .set('Authorization', `Bearer ${createToken()}`)
        .send({ batchId: 'batch_1', expectedPreviewHash: 'a'.repeat(64) });

      expect(res.status).toBe(403);
    });
  });
});
