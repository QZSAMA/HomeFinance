# P1-H-03 Populated Release Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an executable PostgreSQL 16 populated upgrade, backup, restore, current-application smoke, and forward-recovery gate while retaining the explicit blocker on protected staging release observation.

**Architecture:** A dependency-free Node 20 runner owns one allow-listed, disposable Compose project and delegates process safety, database lifecycle, canonical manifests, and public-API smoke to focused modules. It creates a deterministic pre-Phase-1 database at migration `20260723030000_add_file_id_to_ai_conversation`, validates two custom-format backups, proves current migrations and current application behavior, restores after injected corruption, repeats the forward upgrade, and verifies its own cleanup; GitHub Actions adds an unconditional idempotent teardown as a second safety layer.

**Tech Stack:** Node.js 20 built-in test runner and Fetch/FormData, Docker Compose, PostgreSQL 16 Alpine (`pg_dump`/`pg_restore`/`psql`), Prisma 5.22 migration deploy, Express public APIs, Redis 7, pinned MinIO, deterministic mock AI, GitHub Actions.

## Global Constraints

- Use only generated test identities, fixed test-only credentials, database names in `homefinance_rehearsal_{control,legacy,app}`, Compose project `homefinance-release-rehearsal`, and loopback port `127.0.0.1:55433`; reject every other database/host target.
- Never accept a database URL, database name, host, credentials, or dump path from workflow inputs or repository secrets in the disposable runner.
- The exact legacy cut is the first three immutable migrations ending at `20260723030000_add_file_id_to_ai_conversation`; never edit, rename, resolve, squash, mark-applied, or add a down migration to the existing migration history.
- PostgreSQL replacement requires the backend to be stopped and may terminate connections only to the exact allow-listed app database.
- Dumps use PostgreSQL custom format, must be non-empty, must pass `pg_restore --list`, and must have a recorded SHA-256; never upload dump files.
- `familyId` remains the tenant boundary; security smoke must include unauthenticated 401, non-member 403, viewer write 403, and zero unauthorized mutation side effects.
- Financial smoke uses only CNY and must reconcile exact income, expense, and net-income values; no mixed-currency sum or historical valuation claim is introduced.
- Idempotent mutation replay, Import confirmation, Recurring execution, AI proposal confirmation, and GoalContribution use their production API paths and may not create duplicate/partial facts.
- Schema rollback is restore plus forward migration/fix. Never drop Phase 1 columns/tables in place and never run a down migration.
- The runner owns bounded startup/recovery polling and success-path cleanup; the Actions workflow repeats `down --volumes --remove-orphans` under `if: always()` and cleanup failure fails the gate.
- A disposable green run is `PASS-REAL (REHEARSAL)` only. P1-H-03 stays `BLOCKED / AT_RISK` until protected staging is `RELEASED` and completes 30 successful one-minute observation samples; P1-H-04 remains open.
- Do not run the available AST-only Graphify updater; record the semantic refresh as pending.

---

### Task 1: Lock process, target, migration, manifest, and redaction safety in RED/GREEN

**Files:**
- Create: `e2e/release-rehearsal/run.test.mjs`
- Create: `e2e/release-rehearsal/lib/process.mjs`
- Create: `e2e/release-rehearsal/lib/database.mjs`
- Create: `e2e/release-rehearsal/lib/manifest.mjs`

**Interfaces:**
- Consumes: repository migration directory and Node 20 built-ins only.
- Produces: `runChecked(command, args, options)`, `redact(text)`, `assertDatabaseName(name)`, `assertMigrationInventory(names)`, `canonicalize(value)`, `compareManifest(expected, actual, label)`, `LEGACY_MIGRATIONS`, `ALL_MIGRATIONS`, and `ALLOWED_DATABASES`.

- [ ] **Step 1: Write the pure safety contract tests before the modules exist**

Create `e2e/release-rehearsal/run.test.mjs` with these initial imports and tests:

```js
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
```

- [ ] **Step 2: Run the focused tests and observe the intended RED**

Run from the repository root:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/database.mjs`. This proves the safety contract precedes the implementation.

- [ ] **Step 3: Implement checked execution and redaction**

Create `e2e/release-rehearsal/lib/process.mjs`:

```js
import { spawnSync } from 'node:child_process';

const REDACTIONS = [
  [/postgresql:\/\/[^\s'"@]+:[^\s'"@]+@[^\s'"]+/gi, '[REDACTED_DATABASE_URL]'],
  [/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]'],
  [/(passwordHash|JWT_SECRET|MINIO_ROOT_PASSWORD|MINIO_SECRET_KEY)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]'],
  [/rehearsal-postgres-password/gi, '[REDACTED_PASSWORD]'],
];

export function redact(value) {
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value ?? ''));
}

export function runChecked(command, args, {
  cwd,
  env,
  input,
  allowFailure = false,
  maxBuffer = 8 * 1024 * 1024,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    encoding: 'utf8',
    maxBuffer,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = redact([result.stderr, result.stdout].filter(Boolean).join('\n').trim());
    const rendered = redact([command, ...args].join(' '));
    throw result.error ?? new Error(`${rendered} exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
```

- [ ] **Step 4: Implement the exact database allow-list and migration inventory**

Create `e2e/release-rehearsal/lib/database.mjs` with these exports first; later tasks extend the same file without changing these contracts:

```js
export const COMPOSE_PROJECT = 'homefinance-release-rehearsal';
export const COMPOSE_FILE = 'docker-compose.release-rehearsal.yml';
export const DATABASE_HOST = '127.0.0.1';
export const DATABASE_PORT = 55433;
export const ALLOWED_DATABASES = Object.freeze([
  'homefinance_rehearsal_control',
  'homefinance_rehearsal_legacy',
  'homefinance_rehearsal_app',
]);
export const LEGACY_MIGRATIONS = Object.freeze([
  '20260710071015_test1',
  '20260722013029_add_budget_recurring_goal',
  '20260723030000_add_file_id_to_ai_conversation',
]);
export const ALL_MIGRATIONS = Object.freeze([
  ...LEGACY_MIGRATIONS,
  '20260827190000_add_durable_family_cache_revision',
  '20260828100000_phase1_add_financial_versions_and_currency',
  '20260828100100_phase1_add_idempotency_and_audit',
  '20260828100200_phase1_add_recurring_execution',
  '20260828100210_phase1_add_recurring_soft_delete',
  '20260828100300_phase1_add_import_batch',
  '20260828100400_phase1_add_ai_proposal',
  '20260901100000_add_asset_version',
  '20260902100000_add_liability_version',
  '20260903100000_add_family_timezone',
  '20260903100100_add_budget_currency',
  '20260903100200_add_goal_contributions',
]);

export function assertDatabaseName(name) {
  if (!ALLOWED_DATABASES.includes(name)) throw new Error(`refusing database name: ${String(name)}`);
  return name;
}

export function assertMigrationInventory(actual) {
  if (JSON.stringify(actual) !== JSON.stringify(ALL_MIGRATIONS)) {
    throw new Error(`migration inventory mismatch: ${JSON.stringify(actual)}`);
  }
  return actual;
}
```

- [ ] **Step 5: Implement canonical manifest comparison**

Create `e2e/release-rehearsal/lib/manifest.mjs`:

```js
import assert from 'node:assert/strict';

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function compareManifest(expected, actual, label) {
  try {
    assert.deepEqual(canonicalize(actual), canonicalize(expected));
  } catch (error) {
    throw new Error(`${label} mismatch: ${error.message}`);
  }
}
```

- [ ] **Step 6: Run GREEN and commit the safety boundary**

Run:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
git diff --check
```

Expected: 5 tests pass, 0 fail.

```powershell
git add e2e/release-rehearsal/run.test.mjs e2e/release-rehearsal/lib
git commit -m "test: lock release rehearsal safety contract"
```

---

### Task 2: Add the pinned disposable topology and deterministic legacy fixture

**Files:**
- Modify: `e2e/release-rehearsal/run.test.mjs`
- Create: `docker-compose.release-rehearsal.yml`
- Create: `e2e/release-rehearsal/legacy-fixture.sql`

**Interfaces:**
- Consumes: the fixed Compose project/database constants from Task 1.
- Produces: loopback PostgreSQL, pinned Redis/MinIO, deterministic mock AI, opt-in backend profile, dump volume, and stable legacy IDs used by Task 3 manifests.

- [ ] **Step 1: Add static topology and fixture tests before creating either file**

Append to `run.test.mjs`:

```js
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rehearsalRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('compose is pinned, loopback-only, profiled, and disposable', () => {
  const yaml = readFileSync(resolve(rehearsalRoot, 'docker-compose.release-rehearsal.yml'), 'utf8');
  for (const clause of [
    'postgres:16-alpine',
    'redis:7-alpine',
    'minio/minio:RELEASE.2025-04-22T22-12-26Z',
    '127.0.0.1:55433:5432',
    '127.0.0.1:4180:8080',
    'profiles: [application]',
    'release_rehearsal_dumps:/rehearsal',
  ]) assert.match(yaml, new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(yaml, /latest/);
});

test('legacy fixture contains two isolated populated families and no real identity', () => {
  const sql = readFileSync(resolve(rehearsalRoot, 'e2e/release-rehearsal/legacy-fixture.sql'), 'utf8');
  for (const id of ['legacy-family-a', 'legacy-family-b', 'legacy-admin-a', 'legacy-viewer-a', 'legacy-admin-b']) {
    assert.match(sql, new RegExp(id));
  }
  for (const table of ['Income', 'Expense', 'Asset', 'Liability', 'Budget', 'RecurringTransaction', 'Goal', 'AiConversation']) {
    assert.match(sql, new RegExp(`INSERT INTO "${table}"`));
  }
  assert.doesNotMatch(sql, /@(gmail|qq|163|outlook)\./i);
});
```

- [ ] **Step 2: Run RED for the missing Compose and fixture files**

Run:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
```

Expected: the original 5 tests pass and the two new tests fail with `ENOENT`.

- [ ] **Step 3: Create the isolated Compose topology**

Create `docker-compose.release-rehearsal.yml` with these exact service contracts:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: rehearsal-postgres-password
      POSTGRES_DB: homefinance_rehearsal_control
    ports: ["127.0.0.1:55433:5432"]
    volumes:
      - release_rehearsal_postgres:/var/lib/postgresql/data
      - release_rehearsal_dumps:/rehearsal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d homefinance_rehearsal_control"]
      interval: 3s
      timeout: 5s
      retries: 20
      start_period: 5s

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 5s
      retries: 20

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: rehearsal-minio-user
      MINIO_ROOT_PASSWORD: rehearsal-minio-password
    volumes: [release_rehearsal_minio:/data]
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:9000/minio/health/live"]
      interval: 3s
      timeout: 5s
      retries: 20
      start_period: 5s

  mock-ai:
    build: { context: ./e2e/mock-ai }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 3s
      timeout: 5s
      retries: 20

  backend:
    profiles: [application]
    build: { context: ./backend, dockerfile: Dockerfile }
    environment:
      NODE_ENV: production
      PORT: 8080
      DATABASE_URL: postgresql://postgres:rehearsal-postgres-password@postgres:5432/homefinance_rehearsal_app?schema=public
      REDIS_URL: redis://redis:6379
      JWT_SECRET: rehearsal-only-jwt-secret-at-least-32-characters
      JWT_EXPIRES_IN: 1h
      CORS_ORIGIN: http://127.0.0.1:4180
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      MINIO_ACCESS_KEY: rehearsal-minio-user
      MINIO_SECRET_KEY: rehearsal-minio-password
      MINIO_BUCKET: homefinance-release-rehearsal
      MINIO_PUBLIC_ENDPOINT: minio
      MINIO_PUBLIC_PORT: 9000
      AI_BASE_URL: http://mock-ai:8787/v1
      AI_API_KEY: rehearsal-deterministic-key
      AI_MODEL: rehearsal-model
      AI_VISION_MODEL: ""
    ports: ["127.0.0.1:4180:8080"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
      mock-ai: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 3s
      timeout: 5s
      retries: 30
      start_period: 10s

volumes:
  release_rehearsal_postgres:
  release_rehearsal_minio:
  release_rehearsal_dumps:
```

- [ ] **Step 4: Create the exact pre-Phase-1 SQL fixture**

Create `e2e/release-rehearsal/legacy-fixture.sql`. Use fixed UTC timestamps, generated `.test` identities, and explicit columns. The file must insert:

```sql
BEGIN;
INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES
('legacy-admin-a','legacy-admin-a@example.test','not-used-by-rehearsal','Legacy Admin A','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-viewer-a','legacy-viewer-a@example.test','not-used-by-rehearsal','Legacy Viewer A','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-admin-b','legacy-admin-b@example.test','not-used-by-rehearsal','Legacy Admin B','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO "Family" ("id","name","description","createdAt","updatedAt") VALUES
('legacy-family-a','Legacy Family A','P1-H-03 family A','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-family-b','Legacy Family B','P1-H-03 family B','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO "FamilyMember" ("id","familyId","userId","role","createdAt") VALUES
('legacy-member-a-admin','legacy-family-a','legacy-admin-a','admin','2026-01-01T00:00:00Z'),
('legacy-member-a-viewer','legacy-family-a','legacy-viewer-a','viewer','2026-01-01T00:00:00Z'),
('legacy-member-b-admin','legacy-family-b','legacy-admin-b','admin','2026-01-01T00:00:00Z');
INSERT INTO "Income" ("id","familyId","createdBy","category","amount","description","source","date","createdAt","updatedAt") VALUES
('legacy-income-a','legacy-family-a','legacy-admin-a','Salary',1000.00,'legacy-a-income','fixture','2026-01-15T00:00:00Z','2026-01-15T00:00:00Z','2026-01-15T00:00:00Z'),
('legacy-income-b','legacy-family-b','legacy-admin-b','Salary',700.00,'legacy-b-income','fixture','2026-01-15T00:00:00Z','2026-01-15T00:00:00Z','2026-01-15T00:00:00Z');
INSERT INTO "Expense" ("id","familyId","createdBy","category","amount","description","paymentMethod","date","createdAt","updatedAt") VALUES
('legacy-expense-a','legacy-family-a','legacy-admin-a','Food',250.00,'legacy-a-expense','cash','2026-01-16T00:00:00Z','2026-01-16T00:00:00Z','2026-01-16T00:00:00Z'),
('legacy-expense-b','legacy-family-b','legacy-admin-b','Food',125.00,'legacy-b-expense','cash','2026-01-16T00:00:00Z','2026-01-16T00:00:00Z','2026-01-16T00:00:00Z');
INSERT INTO "Asset" ("id","familyId","name","type","category","value","costBasis","currency","purchaseDate","description","createdAt","updatedAt") VALUES
('legacy-asset-a','legacy-family-a','A Cash','CASH','cash',5000.00,5000.00,'CNY','2026-01-01T00:00:00Z','legacy-a-asset','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-asset-b','legacy-family-b','B Cash','CASH','cash',3000.00,3000.00,'CNY','2026-01-01T00:00:00Z','legacy-b-asset','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO "Liability" ("id","familyId","name","type","amount","interestRate","startDate","endDate","currency","description","createdAt","updatedAt") VALUES
('legacy-liability-a','legacy-family-a','A Loan','LOAN',1000.00,0.0350,'2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','CNY','legacy-a-liability','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-liability-b','legacy-family-b','B Loan','LOAN',500.00,0.0250,'2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','CNY','legacy-b-liability','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO "Budget" ("id","familyId","category","amount","period","startDate","endDate","createdBy","createdAt","updatedAt") VALUES
('legacy-budget-a','legacy-family-a','Food',600.00,'MONTHLY','2026-01-01T00:00:00Z',NULL,'legacy-admin-a','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-budget-b','legacy-family-b','Food',400.00,'MONTHLY','2026-01-01T00:00:00Z',NULL,'legacy-admin-b','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO "RecurringTransaction" ("id","familyId","type","category","amount","description","frequency","interval","nextDate","endDate","isActive","lastExecutedAt","createdBy","createdAt","updatedAt") VALUES
('legacy-recurring-a','legacy-family-a','EXPENSE','Food',50.00,'legacy-a-recurring','MONTHLY',1,'2026-02-01T00:00:00Z',NULL,true,NULL,'legacy-admin-a','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-recurring-b','legacy-family-b','INCOME','Salary',75.00,'legacy-b-recurring','MONTHLY',1,'2026-02-01T00:00:00Z',NULL,true,NULL,'legacy-admin-b','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO "Goal" ("id","familyId","title","type","targetAmount","deadline","isCompleted","createdBy","createdAt","updatedAt") VALUES
('legacy-goal-a','legacy-family-a','Legacy Goal A','SAVING',2000.00,'2027-01-01T00:00:00Z',false,'legacy-admin-a','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-goal-b','legacy-family-b','Legacy Goal B','DEBT_PAYOFF',1000.00,'2027-01-01T00:00:00Z',false,'legacy-admin-b','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO "AiConversation" ("id","familyId","userId","content","response","type","fileId","createdAt") VALUES
('legacy-ai-a','legacy-family-a','legacy-admin-a','legacy-a-question','legacy-a-answer','chat',NULL,'2026-01-20T00:00:00Z'),
('legacy-ai-b','legacy-family-b','legacy-admin-b','legacy-b-question','legacy-b-answer','chat',NULL,'2026-01-20T00:00:00Z');
COMMIT;
```

- [ ] **Step 5: Run static GREEN and commit the topology/fixture**

Run:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
docker compose -f docker-compose.release-rehearsal.yml config --quiet
```

Expected: 7 tests pass. If Docker is unavailable locally, record `config --quiet` as environment-blocked and require the Actions parse/execution in Task 6; do not claim a local Compose pass.

```powershell
git add docker-compose.release-rehearsal.yml e2e/release-rehearsal/legacy-fixture.sql e2e/release-rehearsal/run.test.mjs
git commit -m "test: define populated release fixture"
```

---

### Task 3: Implement allow-listed migration, dump, restore, and canonical manifest services

**Files:**
- Modify: `e2e/release-rehearsal/run.test.mjs`
- Modify: `e2e/release-rehearsal/lib/database.mjs`
- Modify: `e2e/release-rehearsal/lib/manifest.mjs`

**Interfaces:**
- Consumes: Task 1 safety primitives, Task 2 PostgreSQL service/fixture, `backend/prisma/schema.prisma`, immutable migrations.
- Produces: `listRepositoryMigrations()`, `compose(args, options)`, `psql(database, sql)`, `replaceDatabase(name)`, `createLegacyPrismaDirectory()`, `deployMigrations(database, mode)`, `loadLegacyFixture(database)`, `createValidatedDump(database, filename)`, `restoreDump(database, filename)`, `readLegacyManifest(database)`, `readUpgradedManifest(database)`, `readCurrentManifest(database, runtimeIds)`, and `assertNoOrphans(database)`.

- [ ] **Step 1: Add RED unit contracts for command construction and manifests**

Append tests that inject a fake executor and assert exact commands without Docker:

```js
import {
  buildPgCommand,
  buildPrismaEnvironment,
  buildRestoreCommands,
} from './lib/database.mjs';

test('database commands remain inside the fixed postgres service and allow-list', () => {
  assert.deepEqual(buildPgCommand('homefinance_rehearsal_app', ['psql', '-Atc', 'SELECT 1']), [
    'compose', '-p', 'homefinance-release-rehearsal', '-f', 'docker-compose.release-rehearsal.yml',
    'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'homefinance_rehearsal_app', '-Atc', 'SELECT 1',
  ]);
  assert.throws(() => buildPgCommand('production', ['psql']), /refusing database name/);
});

test('Prisma URL is fixed to loopback rehearsal PostgreSQL', () => {
  const env = buildPrismaEnvironment('homefinance_rehearsal_app');
  assert.equal(env.DATABASE_URL, 'postgresql://postgres:rehearsal-postgres-password@127.0.0.1:55433/homefinance_rehearsal_app?schema=public');
});

test('restore replaces only the app database through the control database', () => {
  const commands = buildRestoreCommands('homefinance_rehearsal_app', 'current.dump');
  assert.deepEqual(commands.map((entry) => entry.database), [
    'homefinance_rehearsal_control',
    'homefinance_rehearsal_control',
    'homefinance_rehearsal_control',
    'homefinance_rehearsal_app',
  ]);
  assert.match(commands[0].sql, /pg_terminate_backend/);
  assert.match(commands[1].sql, /DROP DATABASE "homefinance_rehearsal_app"/);
  assert.match(commands[2].sql, /CREATE DATABASE "homefinance_rehearsal_app"/);
  assert.equal(commands[3].args.at(-1), '/rehearsal/current.dump');
});
```

Run and expect import/export failures for these not-yet-implemented functions.

- [ ] **Step 2: Implement command construction and repository migration validation**

Extend `database.mjs` with `repositoryDirectory` resolved from `import.meta.url`, a fixed Compose prefix, and:

```js
export function buildPgCommand(database, toolArgs) {
  assertDatabaseName(database);
  const [tool, ...rest] = toolArgs;
  return ['compose', '-p', COMPOSE_PROJECT, '-f', COMPOSE_FILE,
    'exec', '-T', 'postgres', tool, '-U', 'postgres', '-d', database, ...rest];
}

export function buildPrismaEnvironment(database) {
  assertDatabaseName(database);
  return {
    DATABASE_URL: `postgresql://postgres:rehearsal-postgres-password@${DATABASE_HOST}:${DATABASE_PORT}/${database}?schema=public`,
  };
}

export function buildRestoreCommands(database, filename) {
  assertDatabaseName(database);
  if (database !== 'homefinance_rehearsal_app') throw new Error('restore target must be rehearsal app database');
  if (!/^(pre-upgrade|current)\.dump$/.test(filename)) throw new Error(`refusing dump filename: ${filename}`);
  return [
    { database: 'homefinance_rehearsal_control', sql: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()` },
    { database: 'homefinance_rehearsal_control', sql: `DROP DATABASE IF EXISTS "${database}"` },
    { database: 'homefinance_rehearsal_control', sql: `CREATE DATABASE "${database}"` },
    { database, args: ['pg_restore', '--exit-on-error', '--no-owner', '--no-privileges', `/rehearsal/${filename}`] },
  ];
}
```

`listRepositoryMigrations()` must use `readdirSync(..., { withFileTypes: true })`, keep directories only, sort them, and call `assertMigrationInventory`. `createLegacyPrismaDirectory()` must create an OS temporary directory, copy `schema.prisma`, `migration_lock.toml`, and only `LEGACY_MIGRATIONS`; it returns `{ root, schemaPath, cleanup }`, where `cleanup()` removes only that resolved OS-temp child.

- [ ] **Step 3: Implement database lifecycle and dump validation**

Use `runChecked('docker', buildPgCommand(...))` for SQL and Compose calls. Implement these exact behaviors:

```js
export function createValidatedDump(database, filename) {
  assertDatabaseName(database);
  if (!/^(pre-upgrade|current)\.dump$/.test(filename)) throw new Error(`refusing dump filename: ${filename}`);
  compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-d', database,
    '--format=custom', '--no-owner', '--no-privileges', '--file', `/rehearsal/${filename}`]);
  const size = Number(compose(['exec', '-T', 'postgres', 'stat', '-c', '%s', `/rehearsal/${filename}`]).stdout.trim());
  if (!Number.isInteger(size) || size <= 0) throw new Error(`${filename} is empty`);
  const listing = compose(['exec', '-T', 'postgres', 'pg_restore', '--list', `/rehearsal/${filename}`]).stdout;
  for (const table of ['Family', 'FamilyMember', 'Income', 'Expense']) {
    if (!listing.includes(`TABLE public ${table}`)) throw new Error(`${filename} missing ${table}`);
  }
  const sha256 = compose(['exec', '-T', 'postgres', 'sha256sum', `/rehearsal/${filename}`]).stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${filename} checksum invalid`);
  return { filename, size, sha256 };
}
```

`replaceDatabase()` and `restoreDump()` must stop the backend through `compose(['stop', 'backend'], { allowFailure: true, profiles: ['application'] })` before calling the four commands from `buildRestoreCommands`. `deployMigrations(database, 'legacy'|'current')` runs `npx prisma migrate deploy --schema <selected schema>` from `backend/` with only the fixed environment URL. `loadLegacyFixture()` pipes the checked-in SQL file to `psql(..., ['psql', '-v', 'ON_ERROR_STOP=1'])`.

- [ ] **Step 4: Implement canonical SQL manifests and orphan checks**

Add SQL constants in `manifest.mjs` and execute them through an injected `queryJson`. The legacy manifest must return ordered arrays for:

```js
export const LEGACY_EXPECTED = Object.freeze({
  counts: { User: 3, Family: 2, FamilyMember: 3, Income: 2, Expense: 2, Asset: 2, Liability: 2, Budget: 2, RecurringTransaction: 2, Goal: 2, AiConversation: 2 },
  roles: [
    { familyId: 'legacy-family-a', userId: 'legacy-admin-a', role: 'admin' },
    { familyId: 'legacy-family-a', userId: 'legacy-viewer-a', role: 'viewer' },
    { familyId: 'legacy-family-b', userId: 'legacy-admin-b', role: 'admin' },
  ],
  totals: [
    { familyId: 'legacy-family-a', income: '1000.00', expense: '250.00', asset: '5000.00', liability: '1000.00' },
    { familyId: 'legacy-family-b', income: '700.00', expense: '125.00', asset: '3000.00', liability: '500.00' },
  ],
});
```

`readUpgradedManifest()` must extend those stable facts with exact defaults (`baseCurrency`, `timezone`, versions, Budget/Goal currency), migration rows equal to `ALL_MIGRATIONS`, required trigger names for all family-scoped tables, required Phase 1 table names, and constraint/index names found in the immutable migrations. `assertNoOrphans()` must query every current foreign-key relation represented in Prisma and throw unless all counts equal zero.

`readCurrentManifest(database, runtimeIds)` must include all upgraded legacy facts, counts for every Prisma model, runtime IDs returned by API calls, `IdempotencyRecord`→`AuditEvent` relationships, `RecurringExecution.entryId`, Import row result references, AI proposal/item results, GoalContribution ownership, family cache versions, and currency-grouped financial totals. Never query `passwordHash`, tokens, connection settings, or dump content.

- [ ] **Step 5: Run unit GREEN and commit database/manifests**

Run:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
node --check e2e/release-rehearsal/lib/database.mjs
node --check e2e/release-rehearsal/lib/manifest.mjs
```

Expected: 10 tests pass.

```powershell
git add e2e/release-rehearsal
git commit -m "feat: add release backup and restore primitives"
```

---

### Task 4: Implement the current public-API population and security/financial smoke

**Files:**
- Modify: `e2e/release-rehearsal/run.test.mjs`
- Create: `e2e/release-rehearsal/lib/api.mjs`

**Interfaces:**
- Consumes: backend at `http://127.0.0.1:4180/api`, Node Fetch/FormData, deterministic mock AI.
- Produces: `requestApi(path, options)`, `assertIncomeStatement(result, totals)`, and `runApplicationSmoke(suffix)` returning all runtime IDs and exact expected counts required by `readCurrentManifest`.

- [ ] **Step 1: Add RED tests with an injected fake fetch**

Append:

```js
import { assertIncomeStatement, requestApi } from './lib/api.mjs';

test('API errors expose status/path but redact bearer tokens and bodies', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ token: 'secret-token' }), { status: 500 });
  await assert.rejects(
    requestApi('/fail', { token: 'abc.def.ghi', expectedStatus: 200, fetchImpl: fakeFetch }),
    (error) => error.message.includes('expected 200, received 500')
      && !error.message.includes('abc.def.ghi')
      && !error.message.includes('secret-token'),
  );
});

test('income statement assertion requires the exact reconciliation identity', () => {
  assert.doesNotThrow(() => assertIncomeStatement({ totalIncome: 120, totalExpense: 113, netIncome: 7, reconciliationStatus: 'passed' }, { income: 120, expense: 113, net: 7 }));
  assert.throws(() => assertIncomeStatement({ totalIncome: 120, totalExpense: 113, netIncome: 8, reconciliationStatus: 'passed' }, { income: 120, expense: 113, net: 7 }), /netIncome/);
});
```

Run and expect `ERR_MODULE_NOT_FOUND` for `lib/api.mjs`.

- [ ] **Step 2: Implement bounded, redacted API requests**

Create `api.mjs` with a fixed base URL, `AbortSignal.timeout(15_000)`, one body read, JSON parsing, and no response body in error messages:

```js
import { redact } from './process.mjs';

const API_BASE_URL = 'http://127.0.0.1:4180/api';

export async function requestApi(path, { method = 'GET', token, json, form, headers = {}, expectedStatus, fetchImpl = fetch } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (json !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetchImpl(`${API_BASE_URL}${path}`, {
    method,
    headers: requestHeaders,
    body: json === undefined ? form : JSON.stringify(json),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(redact(`${method} ${path} expected ${expectedStatus}, received ${response.status}`));
  }
  return { status: response.status, headers: response.headers, body };
}

export function assertIncomeStatement(body, expected) {
  for (const [field, value] of Object.entries({ totalIncome: expected.income, totalExpense: expected.expense, netIncome: expected.net })) {
    if (body?.[field] !== value) throw new Error(`${field} expected ${value}, received ${String(body?.[field])}`);
  }
  if (body?.reconciliationStatus !== 'passed') throw new Error(`reconciliationStatus expected passed`);
}
```

- [ ] **Step 3: Implement one deterministic production-path workload**

`runApplicationSmoke(suffix)` must execute this exact order and return IDs without tokens:

1. Register `rehearsal-admin-a-${suffix}@example.test`, `rehearsal-viewer-${suffix}@example.test`, and `rehearsal-admin-b-${suffix}@example.test` with password `RehearsalPassw0rd!`.
2. Create family A and family B with timezone `Asia/Shanghai`; invite viewer to A with role `viewer`.
3. Assert family-A report without a token is 401; family-B admin reading family A is 403; viewer POSTing family-A expense 9 CNY is 403.
4. POST family-A Income 120 CNY dated `2026-09-01T09:00:00.000Z` twice with the same `Idempotency-Key: p1-h03-income-${suffix}` and identical body. Assert both return the same ID, the second has `Idempotency-Replayed: true` or `deduplicated: true`, and Income list contains exactly one runtime description.
5. Upload this Alipay CSV as `file` with `format=alipay`, capture `X-Import-Batch-Id` and `X-Import-Preview-Hash`, then confirm with `Idempotency-Key: p1-h03-import-${suffix}`:

```text
交易时间,收/支,金额,交易分类,商品名称
2026-09-01 12:00:00,支出,35.00,餐饮,P1-H-03 CSV
```

6. Create an EXPENSE recurring rule for 12 CNY, `DAILY`, interval 1, `nextDate=2026-09-01T00:00:00.000Z`; execute the exact scheduled occurrence with `Idempotency-Key: p1-h03-recurring-${suffix}` and assert an `executionId` and `entryId`.
7. POST `/ai/chat` with `content: P1-H-03 deterministic proposal ${suffix}`. Assert it returns one proposal, zero immediate actions, proposal ID/version/hash/items, and that no expense description `E2E mock AI proposal` exists before confirmation. Confirm exactly the returned proposal items with `Idempotency-Key: p1-h03-ai-${suffix}` and assert one result.
8. Create a SAVING goal for 200 CNY and POST a MANUAL contribution for 40 CNY with `allocationKey: p1-h03-allocation-${suffix}` and `Idempotency-Key: p1-h03-goal-${suffix}`. Replay the same request and assert one contribution ID.
9. GET the family-A income statement with explicit `startDate=2026-09-01&endDate=2026-09-30`; assert exactly Income 120, Expense 113 (35 Import + 12 Recurring + 66 AI), Net 7, `reconciliationStatus=passed`. Do not use the runner's current month. Assert family B contains none of the runtime family-A IDs or descriptions.
10. Query list endpoints after each unauthorized mutation and return `{ users, families, income, importBatch, recurring, recurringExecution, aiProposal, aiProposalItems, goal, goalContribution, expectedTotals: { income: 120, expense: 113, net: 7 } }` without bearer tokens.

Use the response structures already exercised by `frontend/tests/phase1-critical-journeys.spec.ts`; do not introduce a test-only backend route or direct database write for current-schema population.

- [ ] **Step 4: Run GREEN and commit API smoke**

Run:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
node --check e2e/release-rehearsal/lib/api.mjs
```

Expected: 12 tests pass.

```powershell
git add e2e/release-rehearsal
git commit -m "test: add release application smoke contract"
```

---

### Task 5: Build the nine-checkpoint rehearsal orchestrator and prove real recovery

**Files:**
- Modify: `e2e/release-rehearsal/run.test.mjs`
- Create: `e2e/release-rehearsal/run.mjs`

**Interfaces:**
- Consumes: all Task 1–4 modules and the dedicated Compose file.
- Produces: `--list` discovery with no Docker/network access, nine named `PASS` lines, validated backup metadata, first-failure diagnostics, non-zero failure exit, self-verified cleanup, and a machine-readable redacted summary line.

- [ ] **Step 1: Add discovery RED before the runner exists**

Append:

```js
import { spawnSync } from 'node:child_process';

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
```

Run and expect failure because `run.mjs` is absent.

- [ ] **Step 2: Create the runner state machine and bounded checkpoint helper**

Create `run.mjs` with exact checkpoint constants, a `checkpoint(name, operation)` timer, and a single mutable state object containing only database/dump metadata, manifests, and runtime IDs. Use this main guard so importing never executes Docker:

```js
import { pathToFileURL } from 'node:url';

export const CHECKPOINTS = Object.freeze([
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

async function checkpoint(name, operation) {
  const started = Date.now();
  await operation();
  console.log(`PASS ${name} (${Date.now() - started}ms)`);
}

if (process.argv.includes('--list')) {
  for (const name of CHECKPOINTS) console.log(name);
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL ${redact(error instanceof Error ? error.stack ?? error.message : error)}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 3: Implement checkpoints 1–4 (inventory, legacy population, dump, upgrade)**

The runner must:

- start only PostgreSQL/Redis/MinIO/mock-AI via `compose up --build --detach --wait`;
- assert `docker compose ps --format json` has no backend yet;
- validate PostgreSQL reports major version 16 and the three fixed database names do not pre-exist except control;
- create legacy DB, apply only the three-migration temporary Prisma directory, load fixture, require `LEGACY_EXPECTED`, zero orphans, and exact `_prisma_migrations` cut;
- create `pre-upgrade.dump`, store only `{ filename, size, sha256 }`, and print `BACKUP pre-upgrade.dump bytes=<n> sha256=<hash>`;
- replace app DB, restore the pre-upgrade dump, deploy all current migrations, verify the upgraded manifest/defaults/constraints and zero orphans.

Every operation must be inside the matching checkpoint callback. The temporary Prisma directory cleanup runs immediately after current migration deploy and again in `finally` as an idempotent fallback.

- [ ] **Step 4: Implement checkpoints 5–8 (current app, current dump, failed release, forward recovery)**

The runner must:

- start the backend profile with build and wait for its health endpoint through bounded 250 ms polling with a 60-second deadline;
- call `runApplicationSmoke`, assert no orphan/current manifest errors, and store `state.currentManifest`;
- stop backend before `current.dump`, validate the dump, and print only size/checksum metadata;
- restore/restart once and compare a fresh current manifest to the saved canonical current manifest before failure injection;
- inject `CREATE TABLE rehearsal_failure_sentinel(id integer primary key); UPDATE "Family" SET description='CORRUPTED-BY-REHEARSAL' WHERE id='legacy-family-a'`, prove both changes exist, stop backend, replace app DB, restore `current.dump`, and prove the sentinel is absent, the original description is present, and the full current manifest exactly matches;
- stop backend, replace app DB, restore `pre-upgrade.dump`, deploy all migrations, assert the upgraded legacy manifest, start the same current backend image, run a new API smoke suffix `forward-${runId}`, and verify reconciliation/security again.

The failure sentinel is test-only and exists only between injection and database replacement; it is never added to Prisma or migrations.

- [ ] **Step 5: Implement checkpoint 9 plus failure/success cleanup proof**

On the success path, run `prisma migrate deploy` a second time and require output matching `No pending migrations to apply`. Then remove `/rehearsal/pre-upgrade.dump` and `/rehearsal/current.dump`, stop all profiles, run `docker compose down --volumes --remove-orphans`, and verify all three checks are empty/absent:

```powershell
docker ps -aq --filter label=com.docker.compose.project=homefinance-release-rehearsal
docker volume ls -q --filter label=com.docker.compose.project=homefinance-release-rehearsal
docker network ls -q --filter label=com.docker.compose.project=homefinance-release-rehearsal
```

Only after those checks pass may checkpoint 9 print `PASS`. Emit one final JSON line prefixed `SUMMARY ` containing migration cut/head, both dump byte counts/checksums, checkpoint durations, PostgreSQL version, `cleanup: true`, and no tokens/URLs/password hashes.

Wrap `main()` in `try/catch/finally`: on failure, collect bounded `compose ps` plus the last 200 backend/PostgreSQL log lines through `redact`; in `finally`, always invoke the same dump removal/down operation. If behavioral work passed but cleanup failed, throw the cleanup error and keep the run failed.

- [ ] **Step 6: Run local static GREEN and commit the orchestrator**

Run:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
node --check e2e/release-rehearsal/run.mjs
node e2e/release-rehearsal/run.mjs --list
git diff --check
```

Expected: 13 tests pass and exactly nine names print. Do not run the real runner locally when Docker is unavailable.

```powershell
git add e2e/release-rehearsal/run.mjs e2e/release-rehearsal/run.test.mjs
git commit -m "test: add populated release recovery runner"
```

---

### Task 6: Add the read-only Actions gate and protected staging runbook

**Files:**
- Modify: `e2e/release-rehearsal/run.test.mjs`
- Create: `.github/workflows/release-rehearsal.yml`
- Create: `docs/runbooks/staging-release-and-recovery.md`

**Interfaces:**
- Consumes: Task 5 runner and the approved design.
- Produces: PR/manual real rehearsal gate with unconditional cleanup and an external prerequisite/run/evidence contract that cannot silently claim staging.

- [ ] **Step 1: Add RED static workflow/runbook contracts**

Append tests that read both missing files and require:

```js
test('workflow is read-only, bounded, and tears down unconditionally', () => {
  const yaml = readFileSync(resolve(rehearsalRoot, '.github/workflows/release-rehearsal.yml'), 'utf8');
  for (const clause of ['contents: read', 'timeout-minutes: 30', 'actions/checkout@v5', 'actions/setup-node@v5', 'if: always()', 'down --volumes --remove-orphans']) {
    assert.match(yaml, new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(yaml, /push:\s*\n\s*tags:/);
});

test('staging runbook preserves external blocker and observation contract', () => {
  const text = readFileSync(resolve(rehearsalRoot, 'docs/runbooks/staging-release-and-recovery.md'), 'utf8');
  for (const phrase of ['GitHub Environment `staging`', 'immutable image digest', '30 one-minute samples', 'previous image digest', 'fresh database', 'forward fix', 'P1-H-03 remains `BLOCKED`']) {
    assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
```

Run and expect two `ENOENT` failures.

- [ ] **Step 2: Create the Actions workflow**

Create `.github/workflows/release-rehearsal.yml`:

```yaml
name: Populated Release Rehearsal

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: release-rehearsal-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  populated-recovery:
    name: Populated migration, backup, restore, and forward recovery
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Check out repository
        uses: actions/checkout@v5
      - name: Set up Node.js
        uses: actions/setup-node@v5
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - name: Install backend migration runtime
        working-directory: backend
        run: npm ci
      - name: Verify rehearsal unit contracts
        run: node --test e2e/release-rehearsal/run.test.mjs
      - name: Run populated release rehearsal
        run: node e2e/release-rehearsal/run.mjs
      - name: Collect redacted Compose state on failure
        if: failure()
        run: docker compose -p homefinance-release-rehearsal -f docker-compose.release-rehearsal.yml --profile application ps || true
      - name: Tear down rehearsal stack
        if: always()
        run: docker compose -p homefinance-release-rehearsal -f docker-compose.release-rehearsal.yml --profile application down --volumes --remove-orphans
```

Do not add secrets, environments, package write permission, artifact upload, a deploy job, a tag trigger, or a staging input.

- [ ] **Step 3: Write the staging runbook with exact stop/go evidence**

Create `docs/runbooks/staging-release-and-recovery.md` with these sections and rules:

- prerequisites: GitHub Environment `staging`, required reviewer, Release/Repository Owner names, non-production URLs/secrets, approved populated dataset, observability access, coordinated PostgreSQL/MinIO backup scope;
- immutable release identity: Git SHA plus backend/frontend image digest; reject `latest`;
- preflight: record old digests/deployment ID/migration head, enter write pause, verify no migration in progress, validate backup ID/checksum/bytes;
- release: deploy migration once, then exact image digests; run 401/403/viewer/cross-family, idempotency, Import/Recurring/AI/GoalContribution, and reconciliation smoke against generated records;
- observation: 30 one-minute samples, all health checks successful, no unexplained 5xx, cross-family result, duplicate financial fact, reconciliation failure, migration error, Redis reconnect loop, or MinIO error;
- cleanup: delete only generated records through authorized APIs and preserve audit/deployment evidence;
- application failure: redeploy previous image digest and retain additive schema;
- integrity failure: stop writes, restore validated backup into a fresh database, validate manifests, switch only after owner approval, then forward fix;
- evidence template: exact SHA, digests, deployment/backup IDs, checksums, timestamps, 30 results, smoke IDs, owner decisions, rollback/forward-fix action;
- explicit status: P1-H-03 remains `BLOCKED` until this staging sequence succeeds; rehearsal alone is never `RELEASED`/`OBSERVED`.

- [ ] **Step 4: Run GREEN, parse workflow, and commit**

Run:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/release-rehearsal.yml', aliases: true); puts 'workflow yaml ok'"
rg -n "contents: read|timeout-minutes: 30|if: always\(\)|down --volumes --remove-orphans" .github/workflows/release-rehearsal.yml
```

Expected: 15 tests pass, YAML parses, and all safety clauses match.

```powershell
git add .github/workflows/release-rehearsal.yml docs/runbooks/staging-release-and-recovery.md e2e/release-rehearsal/run.test.mjs
git commit -m "ci: rehearse populated release recovery"
```

---

### Task 7: Run all local gates, create a Draft PR, and iterate from observed real failures

**Files:**
- Modify only when a real failure proves it necessary: `e2e/release-rehearsal/**`, `docker-compose.release-rehearsal.yml`, `.github/workflows/release-rehearsal.yml`, `docs/runbooks/staging-release-and-recovery.md`

**Interfaces:**
- Consumes: committed rehearsal implementation.
- Produces: one exact green Actions run on one SHA containing all nine checkpoints and complete cleanup, plus same-SHA project regressions.

- [ ] **Step 1: Run rehearsal static gates and existing project quality gates locally**

Run from repository root:

```powershell
node --test e2e/release-rehearsal/run.test.mjs
node --check e2e/release-rehearsal/run.mjs
node e2e/release-rehearsal/run.mjs --list
Push-Location backend
npm ci
npm run build
npm test -- --runInBand --coverage
$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/homefinance_validation?schema=public'
npx prisma validate
npx prisma format --check
Remove-Item Env:DATABASE_URL
Pop-Location
Push-Location frontend
npm ci
npm run lint
npm run build
npx playwright test --list
Pop-Location
git diff --check
git status --short
```

Expected: rehearsal tests/syntax/discovery pass; backend build/default coverage and frontend lint/build pass; four browser journeys are discovered; Prisma validate passes. If `prisma format --check` reports only the known baseline formatting issue and `git diff -- backend/prisma/schema.prisma` is empty, record it without formatting the schema.

- [ ] **Step 2: Record local Docker availability accurately**

Run:

```powershell
docker --version
```

If Docker remains unavailable on Windows, record the environment fact and do not run or claim the real rehearsal locally. The authoritative execution is GitHub Actions.

- [ ] **Step 3: Push and create a Draft PR**

Run:

```powershell
git push -u origin codex/p1-h03-release-rehearsal
gh pr create --draft --base main --head codex/p1-h03-release-rehearsal --title "P1-H-03 populated release rehearsal" --body "Adds the approved disposable populated migration, backup, restore, and forward-recovery gate. Staging release observation remains explicitly blocked."
```

Keep the PR Draft. Do not merge, tag, publish images, create a GitHub Environment, deploy, or add secrets.
This is a stacked continuation of Draft PR #5 and therefore includes its verified P1-G-05 commits until #5 is merged. Record that dependency in the PR body; if #5 changes or lands, update/rebase the P1-H-03 branch without rewriting existing migrations, then rerun every same-SHA gate.

- [ ] **Step 4: Watch the exact same-SHA workflows**

Wait for and record the IDs for CI, Browser E2E, Infrastructure Recovery, and Populated Release Rehearsal. For the new workflow:

```powershell
$runId = gh run list --workflow release-rehearsal.yml --branch codex/p1-h03-release-rehearsal --limit 1 --json databaseId --jq '.[0].databaseId'
if (-not $runId) { throw 'No populated release rehearsal run found' }
gh run watch $runId --exit-status
gh run view $runId --log
```

Require the run head SHA to equal `git rev-parse HEAD`, all nine `PASS` lines, two backup checksum/size lines, PostgreSQL 16, correct legacy cut/current head, exact restore manifest, sentinel absence, final zero pending migrations, and self-cleanup plus workflow teardown success.

- [ ] **Step 5: Iterate only from the first observed RED**

For any failure, preserve the first failed named checkpoint and bounded redacted logs. If a pure contract or production behavior is wrong, add a focused failing Node/Jest test and observe RED before the minimum fix. If the runner expectation is wrong, correct it without removing allow-list, backup validation, family/role negative tests, idempotency, reconciliation, restore equality, sentinel absence, or cleanup assertions. Rerun Step 1, commit with a precise message, push, and require a new complete same-SHA run.

Do not combine checkpoint evidence from multiple runs.

- [ ] **Step 6: Verify no generated or secret material entered Git**

Run:

```powershell
git status --short
git ls-files | rg -i "\.dump$|\.backup$|\.env$|rehearsal.*artifact|test-results|playwright-report"
git grep -n -I -E "BEGIN (RSA|OPENSSH|PRIVATE)|Bearer [A-Za-z0-9._~-]+|postgresql://[^:]+:[^@]+@" -- ':!docs/superpowers/plans/*' ':!docker-compose.release-rehearsal.yml'
```

Expected: clean worktree; no dump, backup, `.env`, browser artifact, bearer token, or private key is tracked. The fixed test-only Compose password is allowed only in the dedicated Compose file and plan.

---

### Task 8: Record partial rehearsal evidence without closing staging or Phase 1

**Files:**
- Modify: `docs/delivery/phase-1/evidence/P1-H-03.md`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md`
- Modify: `docs/project-memory.md`
- Modify: `docs/audit/2026-08-27-homefinance-deep-audit-report.md`
- Modify: `docs/superpowers/plans/2026-09-07-p1-h-03-populated-release-rehearsal-plan.md`

**Interfaces:**
- Consumes: exact final SHA/run IDs/logs and same-SHA regression results.
- Produces: durable `PASS-REAL (REHEARSAL)` evidence with P1-H-03 still `BLOCKED / AT_RISK`, P1-H-04 still open, and semantic Graphify refresh still pending.

- [x] **Step 1: Replace the P1-H-03 shell with exact observed evidence**

Record:

- baseline `6e606e3`, final branch/SHA, Draft PR URL, workflow run URL/ID, runner image/Node/PostgreSQL versions;
- focused RED command/failure and GREEN unit count;
- exact migration cut/current head;
- both dump byte sizes and SHA-256 values from generated test data;
- all nine checkpoint timings and exact sentinel/manifest/zero-orphan/zero-pending outcomes;
- API negative matrix and Income 120 / Expense 113 / Net 7 reconciliation;
- current-schema production paths exercised and replay facts;
- complete runner/workflow cleanup;
- same-SHA CI, PostgreSQL integration, Browser E2E, and Infrastructure Recovery results;
- limitations: no production/staging data, no MinIO backup, no protected environment, no release observation, no production RPO/RTO.

Set evidence to `PASS-REAL (REHEARSAL) + BLOCKED (STAGING)` and observed result to rehearsal-only.

- [x] **Step 2: Update tracker, memory, and audit conservatively**

Keep the P1-H-03 lifecycle state `BLOCKED` and health `AT_RISK`; update its next action to provision the protected `staging` GitHub Environment, immutable image digests, populated data, coordinated backup scope, and owner approvals. Keep P1-H-04 `BACKLOG`. Add the executable recovery facts to project memory and a dated audit addendum, but do not call the project production-ready.

State that Graphify semantic refresh remains pending because the installed path is AST-only; do not change `graphify-out/`.

- [x] **Step 3: Cross-check status semantics and commit documentation**

Run:

```powershell
rg -n "P1-H-03|PASS-REAL \(REHEARSAL\)|BLOCKED|AT_RISK|RELEASED|OBSERVED|P1-H-04|Graphify" docs/delivery/phase-1/evidence/P1-H-03.md docs/delivery/phase-1/phase-1-tracker.md docs/project-memory.md
git diff --check
git status --short
```

Expected: every source agrees that rehearsal passed but staging is not released/observed, P1-H-04 remains open, and no graph file changed.

```powershell
git add docs/delivery/phase-1/evidence/P1-H-03.md docs/delivery/phase-1/phase-1-tracker.md docs/project-memory.md docs/audit/2026-08-27-homefinance-deep-audit-report.md docs/superpowers/plans/2026-09-07-p1-h-03-populated-release-rehearsal-plan.md
git commit -m "docs: record P1-H-03 rehearsal evidence"
git push origin codex/p1-h03-release-rehearsal
```

- [ ] **Step 4: Wait for final documentation-head gates and stop at review**

Wait for every PR check on the documentation head. Require the new rehearsal to repeat all nine checkpoints and cleanup; confirm branch/local/remote HEAD equality and clean status. Leave the PR Draft, do not merge or deploy, and report the remaining external staging prerequisites from the runbook.
