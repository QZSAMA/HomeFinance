import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import importRoutes from './import';

jest.mock('../db/prisma', () => ({
  prisma: {
    familyMember: { findUnique: jest.fn() },
  },
}));

jest.mock('../services/importService', () => ({
  parseCSV: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { parseCSV } from '../services/importService';

const mockedPrisma = prisma as any;
const mockedParseCSV = parseCSV as jest.MockedFunction<typeof parseCSV>;

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
});
