import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ALL_MIGRATIONS,
  ALLOWED_DATABASES,
  LEGACY_MIGRATIONS,
  assertDatabaseName,
  assertMigrationInventory,
  buildPgCommand,
  buildPrismaEnvironment,
  buildRestoreCommands,
  createLegacyPrismaDirectory,
} from './lib/database.mjs';
import {
  CURRENT_TABLES,
  REQUIRED_CURRENT_CONSTRAINTS,
  REQUIRED_CURRENT_INDEXES,
  REQUIRED_CURRENT_TABLES,
  REQUIRED_CURRENT_TRIGGERS,
  canonicalize,
  compareManifest,
} from './lib/manifest.mjs';
import { assertIncomeStatement, requestApi } from './lib/api.mjs';
import { redact, runChecked } from './lib/process.mjs';

const rehearsalRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('pins the legacy cut and complete migration inventory', () => {
  assert.deepEqual(LEGACY_MIGRATIONS, [
    '20260710071015_test1',
    '20260722013029_add_budget_recurring_goal',
    '20260723030000_add_file_id_to_ai_conversation',
  ]);
  assert.equal(ALL_MIGRATIONS.length, 15);
  assert.equal(ALL_MIGRATIONS.at(-1), '20260903100200_add_goal_contributions');
  assert.doesNotThrow(() => assertMigrationInventory(ALL_MIGRATIONS));
  assert.throws(
    () => assertMigrationInventory([...ALL_MIGRATIONS, '20990101000000_unreviewed']),
    /migration inventory mismatch/,
  );
});

test('accepts only fixed rehearsal database names', () => {
  for (const name of ALLOWED_DATABASES) assert.equal(assertDatabaseName(name), name);
  for (const name of ['postgres', 'family_finance', 'production', '', 'homefinance_rehearsal_app;DROP DATABASE postgres']) {
    assert.throws(() => assertDatabaseName(name), /refusing database name/);
  }
});

test('canonicalizes object keys without hiding array order or scalar types', () => {
  assert.deepEqual(
    canonicalize({ z: [{ b: 2, a: 1 }], a: '1' }),
    { a: '1', z: [{ a: 1, b: 2 }] },
  );
  assert.throws(
    () => compareManifest({ amount: '10.00' }, { amount: 10 }, 'amount manifest'),
    /amount manifest mismatch/,
  );
});

test('redacts credentials, bearer tokens, hashes, and database URLs', () => {
  const raw = 'postgresql://postgres:rehearsal-postgres-password@127.0.0.1:55433/db '
    + 'Authorization: Bearer abc.def.ghi passwordHash=secret JWT_SECRET=top-secret';
  const safe = redact(raw);
  assert.equal(safe.includes('rehearsal-postgres-password'), false);
  assert.equal(safe.includes('abc.def.ghi'), false);
  assert.equal(safe.includes('passwordHash=secret'), false);
  assert.equal(safe.includes('top-secret'), false);
});

test('checked process failure reports redacted command and output', () => {
  assert.throws(
    () => runChecked(process.execPath, ['-e', "console.error('Bearer abc.def.ghi'); process.exit(7)"]),
    (error) => error.message.includes('exited 7') && !error.message.includes('abc.def.ghi'),
  );
});

test('compose is pinned, loopback-only, profiled, and disposable', () => {
  const yaml = readFileSync(
    resolve(rehearsalRoot, 'docker-compose.release-rehearsal.yml'),
    'utf8',
  );
  for (const clause of [
    'postgres:16-alpine',
    'redis:7-alpine',
    'minio/minio:RELEASE.2025-04-22T22-12-26Z',
    '127.0.0.1:55433:5432',
    '127.0.0.1:4180:8080',
    'profiles: [application]',
    'release_rehearsal_dumps:/rehearsal',
  ]) {
    assert.equal(yaml.includes(clause), true, `missing Compose clause: ${clause}`);
  }
  assert.doesNotMatch(yaml, /latest/);
});

test('legacy fixture contains two isolated populated families and no real identity', () => {
  const sql = readFileSync(
    resolve(rehearsalRoot, 'e2e/release-rehearsal/legacy-fixture.sql'),
    'utf8',
  );
  for (const id of [
    'legacy-family-a',
    'legacy-family-b',
    'legacy-admin-a',
    'legacy-viewer-a',
    'legacy-admin-b',
  ]) {
    assert.match(sql, new RegExp(id));
  }
  for (const table of [
    'Income',
    'Expense',
    'Asset',
    'Liability',
    'Budget',
    'RecurringTransaction',
    'Goal',
    'AiConversation',
  ]) {
    assert.match(sql, new RegExp(`INSERT INTO "${table}"`));
  }
  assert.doesNotMatch(sql, /@(gmail|qq|163|outlook)\./i);
});

test('database commands remain inside the fixed postgres service and allow-list', () => {
  assert.deepEqual(
    buildPgCommand('homefinance_rehearsal_app', ['psql', '-Atc', 'SELECT 1']),
    [
      'compose',
      '-p',
      'homefinance-release-rehearsal',
      '-f',
      'docker-compose.release-rehearsal.yml',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'homefinance_rehearsal_app',
      '-Atc',
      'SELECT 1',
    ],
  );
  assert.throws(() => buildPgCommand('production', ['psql']), /refusing database name/);
});

test('Prisma URL is fixed to loopback rehearsal PostgreSQL', () => {
  const env = buildPrismaEnvironment('homefinance_rehearsal_app');
  assert.equal(
    env.DATABASE_URL,
    'postgresql://postgres:rehearsal-postgres-password@127.0.0.1:55433/homefinance_rehearsal_app?schema=public',
  );
});

test('restore replaces only the app database through the control database', () => {
  const commands = buildRestoreCommands('homefinance_rehearsal_app', 'current.dump');
  assert.deepEqual(
    commands.map((entry) => entry.database),
    [
      'homefinance_rehearsal_control',
      'homefinance_rehearsal_control',
      'homefinance_rehearsal_control',
      'homefinance_rehearsal_app',
    ],
  );
  assert.match(commands[0].sql, /pg_terminate_backend/);
  assert.match(commands[1].sql, /DROP DATABASE "homefinance_rehearsal_app"/);
  assert.match(commands[2].sql, /CREATE DATABASE "homefinance_rehearsal_app"/);
  assert.equal(commands[3].args.at(-1), '/rehearsal/current.dump');
});

test('legacy Prisma cut is materialized below OS temp and cleans up idempotently', () => {
  const legacyPrisma = createLegacyPrismaDirectory();
  try {
    assert.equal(readFileSync(legacyPrisma.schemaPath, 'utf8').includes('generator client'), true);
    for (const migration of LEGACY_MIGRATIONS) {
      assert.equal(
        readFileSync(
          resolve(dirname(legacyPrisma.schemaPath), 'migrations', migration, 'migration.sql'),
          'utf8',
        ).length > 0,
        true,
      );
    }
  } finally {
    legacyPrisma.cleanup();
    legacyPrisma.cleanup();
  }
});

test('current manifest counts every Prisma model', () => {
  const schema = readFileSync(resolve(rehearsalRoot, 'backend/prisma/schema.prisma'), 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)]
    .map((match) => match[2].match(/@@map\("([^"]+)"\)/)?.[1] ?? match[1])
    .sort();
  assert.deepEqual([...CURRENT_TABLES].sort(), models);
});

test('required current database objects are source-backed by immutable migrations', () => {
  const migrationSource = ALL_MIGRATIONS.map((migration) => readFileSync(
    resolve(rehearsalRoot, 'backend/prisma/migrations', migration, 'migration.sql'),
    'utf8',
  )).join('\n');
  for (const objectName of [
    ...REQUIRED_CURRENT_TABLES,
    ...REQUIRED_CURRENT_TRIGGERS,
    ...REQUIRED_CURRENT_CONSTRAINTS,
    ...REQUIRED_CURRENT_INDEXES,
  ]) {
    assert.equal(migrationSource.includes(`"${objectName}"`), true, `${objectName} is not migration-backed`);
  }
});

test('API errors expose status/path but redact bearer tokens and bodies', async () => {
  const fakeFetch = async () => new Response(
    JSON.stringify({ token: 'secret-token' }),
    { status: 500 },
  );
  await assert.rejects(
    requestApi('/fail', {
      token: 'abc.def.ghi',
      expectedStatus: 200,
      fetchImpl: fakeFetch,
    }),
    (error) => error.message.includes('expected 200, received 500')
      && !error.message.includes('abc.def.ghi')
      && !error.message.includes('secret-token'),
  );
});

test('income statement assertion requires the exact reconciliation identity', () => {
  assert.doesNotThrow(() => assertIncomeStatement(
    {
      totalIncome: 120,
      totalExpense: 113,
      netIncome: 7,
      reconciliationStatus: 'passed',
    },
    { income: 120, expense: 113, net: 7 },
  ));
  assert.throws(
    () => assertIncomeStatement(
      {
        totalIncome: 120,
        totalExpense: 113,
        netIncome: 8,
        reconciliationStatus: 'passed',
      },
      { income: 120, expense: 113, net: 7 },
    ),
    /netIncome/,
  );
});

test('runner discovery prints exactly nine checkpoints without Docker access', () => {
  const result = spawnSync(process.execPath, ['e2e/release-rehearsal/run.mjs', '--list'], {
    cwd: rehearsalRoot,
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    'migration-inventory-and-empty-target',
    'legacy-schema-and-populated-fixture',
    'pre-upgrade-backup-validated',
    'populated-upgrade-preserves-legacy-facts',
    'current-application-smoke-and-population',
    'current-backup-validated',
    'failed-release-restore',
    'forward-recovery-from-pre-upgrade-backup',
    'idempotent-migrate-and-final-cleanup',
  ]);
});

test('workflow is read-only, bounded, and tears down unconditionally', () => {
  const yaml = readFileSync(resolve(rehearsalRoot, '.github/workflows/release-rehearsal.yml'), 'utf8');
  for (const clause of [
    'contents: read',
    'timeout-minutes: 30',
    'actions/checkout@v5',
    'actions/setup-node@v5',
    'if: always()',
    'down --volumes --remove-orphans',
  ]) {
    assert.match(yaml, new RegExp(clause.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(yaml, /push:\s*\n\s*tags:/);
  assert.doesNotMatch(yaml, /secrets\.|environment:\s*staging|docker login|gh release/i);
});

test('staging runbook preserves external blocker and observation contract', () => {
  const text = readFileSync(resolve(rehearsalRoot, 'docs/runbooks/staging-release-and-recovery.md'), 'utf8');
  for (const phrase of [
    'GitHub Environment `staging`',
    'immutable image digest',
    '30 one-minute samples',
    'previous image digest',
    'fresh database',
    'forward fix',
    'P1-H-03 remains `BLOCKED`',
  ]) {
    assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  }
});
