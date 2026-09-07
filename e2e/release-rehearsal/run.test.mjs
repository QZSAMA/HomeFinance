import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_MIGRATIONS,
  ALLOWED_DATABASES,
  LEGACY_MIGRATIONS,
  assertDatabaseName,
  assertMigrationInventory,
} from './lib/database.mjs';
import { canonicalize, compareManifest } from './lib/manifest.mjs';
import { redact, runChecked } from './lib/process.mjs';

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
