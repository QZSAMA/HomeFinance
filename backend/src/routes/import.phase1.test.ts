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

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/import', importRoutes);

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;
const MAX_IMPORT_FIELD_LENGTH = 512;

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' },
  );
}

describe('Import resource limits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedParseCSV.mockResolvedValue([]);
    mockedPersistImportPreview.mockResolvedValue({
      batchId: 'batch_1',
      previewHash: 'a'.repeat(64),
      status: 'PREVIEWED',
      rowCount: 0,
    });
  });

  test('rejects a CSV whose byte size exceeds the import limit', async () => {
    const res = await request(app)
      .post('/api/families/fam_1/import/csv')
      .set('Authorization', `Bearer ${createToken()}`)
      .field('format', 'alipay')
      .attach('file', Buffer.alloc(MAX_IMPORT_BYTES + 1, 'x'), 'oversized.csv');

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('IMPORT_LIMIT_EXCEEDED');
    expect(mockedParseCSV).not.toHaveBeenCalled();
  });

  test('rejects a parsed CSV whose data row count exceeds the import limit', async () => {
    mockedParseCSV.mockResolvedValue(Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => ({
      date: '2026-09-01',
      description: `row-${index}`,
      amount: 1,
      type: 'EXPENSE' as const,
    })));

    const res = await request(app)
      .post('/api/families/fam_1/import/csv')
      .set('Authorization', `Bearer ${createToken()}`)
      .field('format', 'alipay')
      .attach('file', Buffer.from('row data'), 'too-many-rows.csv');

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('IMPORT_LIMIT_EXCEEDED');
  });

  test('rejects a parsed CSV whose field length exceeds the import limit', async () => {
    mockedParseCSV.mockResolvedValue([{
      date: '2026-09-01',
      description: 'x'.repeat(MAX_IMPORT_FIELD_LENGTH + 1),
      amount: 1,
      type: 'EXPENSE',
    }]);

    const res = await request(app)
      .post('/api/families/fam_1/import/csv')
      .set('Authorization', `Bearer ${createToken()}`)
      .field('format', 'alipay')
      .attach('file', Buffer.from('row data'), 'too-long-field.csv');

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('IMPORT_LIMIT_EXCEEDED');
  });

  test('publishes server-owned batch identifiers for a parsed preview', async () => {
    const items = [{
      date: '2026-09-01',
      description: 'server-owned preview',
      amount: 1,
      type: 'INCOME' as const,
    }];
    mockedParseCSV.mockResolvedValue(items);
    mockedPersistImportPreview.mockResolvedValue({
      batchId: 'batch_server_owned',
      previewHash: 'b'.repeat(64),
      status: 'PREVIEWED',
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/families/fam_1/import/csv')
      .set('Authorization', `Bearer ${createToken()}`)
      .field('format', 'alipay')
      .attach('file', Buffer.from('row data'), 'preview.csv');

    expect(res.status).toBe(200);
    expect(res.headers['x-import-batch-id']).toBe('batch_server_owned');
    expect(res.headers['x-import-preview-hash']).toBe('b'.repeat(64));
    expect(res.body).toEqual(items);
    expect(mockedPersistImportPreview).toHaveBeenCalledWith({
      familyId: 'fam_1',
      actorUserId: 'user_1',
      format: 'alipay',
      buffer: expect.any(Buffer),
      items,
    });
  });

  test('uses the write authorization membership without a second route-local lookup', async () => {
    mockedParseCSV.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/families/fam_1/import/csv')
      .set('Authorization', `Bearer ${createToken()}`)
      .field('format', 'alipay')
      .attach('file', Buffer.from('row data'), 'preview.csv');

    expect(res.status).toBe(200);
    expect(mockedPrisma.familyMember.findUnique).toHaveBeenCalledTimes(1);
  });

  test('rejects legacy client-owned items during batch-only confirmation', async () => {
    const res = await request(app)
      .post('/api/families/fam_1/import/confirm')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({
        items: [{
          date: '2026-09-01',
          description: 'tampered client item',
          amount: 999999,
          type: 'INCOME',
        }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(mockedPrisma.income.create).not.toHaveBeenCalled();
    expect(mockedPrisma.expense.create).not.toHaveBeenCalled();
  });
});
