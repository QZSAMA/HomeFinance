import fs from 'fs';
import path from 'path';

const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
const migrationPath = path.resolve(
  __dirname,
  '../../prisma/migrations/20260827190000_add_durable_family_cache_revision/migration.sql',
);
const ciWorkflowPath = path.resolve(__dirname, '../../../.github/workflows/ci.yml');

describe('durable family cache revision database contract', () => {
  test('stores the revision on the family record', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    expect(schema).toMatch(/model Family[\s\S]*cacheVersion\s+Int\s+@default\(0\)/);
  });

  test('increments the revision transactionally for every family-scoped mutable model', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.readFileSync(migrationPath, 'utf8');
    const tables = [
      'FamilyMember',
      'Income',
      'Expense',
      'Asset',
      'Liability',
      'File',
      'AiConversation',
      'Budget',
      'RecurringTransaction',
      'Goal',
    ];

    expect(migration).toContain('CREATE OR REPLACE FUNCTION bump_family_cache_version()');
    for (const table of tables) {
      expect(migration).toContain(`ON "${table}"`);
    }
  });

  test('applies migrations rather than schema push in the real database CI job', () => {
    const workflow = fs.readFileSync(ciWorkflowPath, 'utf8');

    expect(workflow).toContain('npx prisma migrate deploy');
    expect(workflow).not.toContain('npx prisma db push --skip-generate');
  });
});
