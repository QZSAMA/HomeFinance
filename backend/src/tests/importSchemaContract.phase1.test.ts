import fs from 'fs';
import path from 'path';

const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
const migrationPath = path.resolve(
  __dirname,
  '../../prisma/migrations/20260828100300_phase1_add_import_batch/migration.sql',
);

describe('Phase 1 import batch persistence contract', () => {
  test('declares server-owned ImportBatch and ImportRow with traceable state', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    expect(schema).toContain('model ImportBatch');
    expect(schema).toMatch(/ImportBatch[\s\S]*familyId\s+String/);
    expect(schema).toMatch(/ImportBatch[\s\S]*actorUserId\s+String/);
    expect(schema).toMatch(/ImportBatch[\s\S]*fileHash\s+String/);
    expect(schema).toMatch(/ImportBatch[\s\S]*previewHash\s+String/);
    expect(schema).toMatch(/ImportBatch[\s\S]*status\s+String\s+@default\("PREVIEWED"\)/);
    expect(schema).toContain('model ImportRow');
    expect(schema).toMatch(/ImportRow[\s\S]*rowNumber\s+Int/);
    expect(schema).toMatch(/ImportRow[\s\S]*canonicalPayload\s+Json/);
    expect(schema).toMatch(/ImportRow[\s\S]*validationErrors\s+Json\?/);
    expect(schema).toMatch(/@@unique\(\[batchId, rowNumber\]\)/);

    expect(fs.existsSync(migrationPath)).toBe(true);
    if (!fs.existsSync(migrationPath)) return;

    const migration = fs.readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('CREATE TABLE "ImportBatch"');
    expect(migration).toContain('CREATE TABLE "ImportRow"');
    expect(migration).toContain('ImportRow_batchId_rowNumber_key');
    expect(migration).toContain('ImportBatch_fileHash_format_check');
    expect(migration).toContain('ImportBatch_previewHash_format_check');
    expect(migration).toContain('ImportRow_rowNumber_check');
  });
});
