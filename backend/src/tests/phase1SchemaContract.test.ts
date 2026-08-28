import fs from 'fs';
import path from 'path';

const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
const migrationsPath = path.resolve(__dirname, '../../prisma/migrations');

const readSchema = () => fs.readFileSync(schemaPath, 'utf8');

const readMigration = (name: string) => fs.readFileSync(
  path.join(migrationsPath, name, 'migration.sql'),
  'utf8',
);

describe('Phase 1 additive ledger persistence contract', () => {
  test('declares financial version, currency, origin, idempotency and audit models', () => {
    const schema = readSchema();

    expect(schema).toMatch(/model Family[\s\S]*baseCurrency\s+String\s+@default\("CNY"\)/);
    expect(schema).toMatch(/model Income[\s\S]*version\s+Int\s+@default\(1\)/);
    expect(schema).toMatch(/model Income[\s\S]*currency\s+String\s+@default\("CNY"\)/);
    expect(schema).toMatch(/model Income[\s\S]*originType\s+String\?/);
    expect(schema).toMatch(/model Expense[\s\S]*version\s+Int\s+@default\(1\)/);
    expect(schema).toMatch(/model Expense[\s\S]*currency\s+String\s+@default\("CNY"\)/);
    expect(schema).toMatch(/model RecurringTransaction[\s\S]*version\s+Int\s+@default\(1\)/);
    expect(schema).toContain('model IdempotencyRecord');
    expect(schema).toMatch(
      /@@unique\(\[familyId, actorScope, operation, key\], map: "IdempotencyRecord_scope_key"\)/,
    );
    expect(schema).toContain('model AuditEvent');
    expect(schema).toMatch(/actorUserId\s+String\?/);
    expect(schema).toMatch(
      /mutation\s+IdempotencyRecord\s+@relation\(fields: \[mutationId\], references: \[id\], onDelete: NoAction\)/,
    );
  });

  test('ships ordered additive migrations with database constraints', () => {
    const financial = readMigration(
      '20260828100000_phase1_add_financial_versions_and_currency',
    );
    const operations = readMigration(
      '20260828100100_phase1_add_idempotency_and_audit',
    );

    expect(financial).toContain('ADD COLUMN "baseCurrency" TEXT');
    expect(financial).toContain('CHECK ("version" > 0)');
    expect(financial).toContain("SET \"currency\" = 'CNY'");
    expect(operations).toContain('CREATE TABLE "IdempotencyRecord"');
    expect(operations).toContain('CREATE TABLE "AuditEvent"');
    expect(operations).toContain('IdempotencyRecord_scope_key');
    expect(operations).toContain('payloadHash_format_check');
    expect(operations).toContain('completion_state_check');
    expect(operations).toMatch(
      /FOREIGN KEY \("mutationId"\) REFERENCES "IdempotencyRecord"\("id"\) ON DELETE NO ACTION/,
    );
  });
});
