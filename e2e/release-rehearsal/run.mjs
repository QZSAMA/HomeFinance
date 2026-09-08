import { pathToFileURL } from 'node:url';
import { runApplicationSmoke } from './lib/api.mjs';
import {
  ALL_MIGRATIONS,
  COMPOSE_PROJECT,
  LEGACY_MIGRATIONS,
  compose,
  createDatabase,
  createLegacyPrismaDirectory,
  createValidatedDump,
  databaseExists,
  deployMigrations,
  listRepositoryMigrations,
  loadLegacyFixture,
  psql,
  removeDumps,
  repositoryDirectory,
  restoreDump,
  stopBackend,
} from './lib/database.mjs';
import {
  LEGACY_EXPECTED,
  REQUIRED_CURRENT_CONSTRAINTS,
  REQUIRED_CURRENT_INDEXES,
  REQUIRED_CURRENT_TABLES,
  REQUIRED_CURRENT_TRIGGERS,
  assertNoOrphans,
  compareManifest,
  readCurrentManifest,
  readLegacyManifest,
  readUpgradedManifest,
} from './lib/manifest.mjs';
import { redact, runChecked } from './lib/process.mjs';

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

const CONTROL_DATABASE = 'homefinance_rehearsal_control';
const LEGACY_DATABASE = 'homefinance_rehearsal_legacy';
const APP_DATABASE = 'homefinance_rehearsal_app';

const STABLE_LEGACY_ROWS = [
  { entity: 'Asset', id: 'legacy-asset-a', familyId: 'legacy-family-a', amount: '5000.00', description: 'legacy-a-asset', date: null },
  { entity: 'Asset', id: 'legacy-asset-b', familyId: 'legacy-family-b', amount: '3000.00', description: 'legacy-b-asset', date: null },
  { entity: 'Expense', id: 'legacy-expense-a', familyId: 'legacy-family-a', amount: '250.00', description: 'legacy-a-expense', date: '2026-01-16T00:00:00.000Z' },
  { entity: 'Expense', id: 'legacy-expense-b', familyId: 'legacy-family-b', amount: '125.00', description: 'legacy-b-expense', date: '2026-01-16T00:00:00.000Z' },
  { entity: 'Income', id: 'legacy-income-a', familyId: 'legacy-family-a', amount: '1000.00', description: 'legacy-a-income', date: '2026-01-15T00:00:00.000Z' },
  { entity: 'Income', id: 'legacy-income-b', familyId: 'legacy-family-b', amount: '700.00', description: 'legacy-b-income', date: '2026-01-15T00:00:00.000Z' },
  { entity: 'Liability', id: 'legacy-liability-a', familyId: 'legacy-family-a', amount: '1000.00', description: 'legacy-a-liability', date: null },
  { entity: 'Liability', id: 'legacy-liability-b', familyId: 'legacy-family-b', amount: '500.00', description: 'legacy-b-liability', date: null },
];

const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const parseJson = (value, label) => {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
};

const readAppliedMigrations = (database) => parseJson(
  psql(
    database,
    `SELECT COALESCE(json_agg(migration_name ORDER BY migration_name), '[]'::json)
       FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  ),
  'migration inventory',
);

const assertNamesPresent = (actual, expected, label) => {
  for (const name of expected) {
    requireCondition(actual.includes(name), `${label} missing ${name}`);
  }
};

const assertUpgradedManifest = (manifest) => {
  compareManifest(LEGACY_EXPECTED.roles, manifest.legacy.roles, 'upgraded legacy roles');
  compareManifest(LEGACY_EXPECTED.totals, manifest.legacy.totals, 'upgraded legacy totals');
  compareManifest(STABLE_LEGACY_ROWS, manifest.legacy.rows, 'upgraded stable legacy rows');
  compareManifest(ALL_MIGRATIONS, manifest.contract.migrations, 'upgraded migrations');

  requireCondition(manifest.contract.families.length === 2, 'upgraded manifest must contain two legacy families');
  for (const family of manifest.contract.families) {
    requireCondition(family.baseCurrency === 'CNY', `${family.id} baseCurrency was not backfilled`);
    requireCondition(family.timezone === 'Asia/Shanghai', `${family.id} timezone was not backfilled`);
    requireCondition(Number.isSafeInteger(family.cacheVersion) && family.cacheVersion >= 0, `${family.id} cacheVersion is invalid`);
  }
  requireCondition(manifest.contract.versions.length === 14, 'upgraded manifest has an unexpected legacy version row count');
  for (const row of manifest.contract.versions) {
    if (['Budget', 'Goal'].includes(row.entity)) {
      requireCondition(row.version === null && row.currency === 'CNY', `${row.entity} ${row.id} currency backfill is invalid`);
    } else if (row.entity === 'RecurringTransaction') {
      requireCondition(row.version === 1 && row.currency === null, `${row.entity} ${row.id} version backfill is invalid`);
    } else {
      requireCondition(row.version === 1 && row.currency === 'CNY', `${row.entity} ${row.id} financial backfill is invalid`);
    }
  }
  assertNamesPresent(manifest.contract.tables, REQUIRED_CURRENT_TABLES, 'table contract');
  assertNamesPresent(manifest.contract.triggers, REQUIRED_CURRENT_TRIGGERS, 'trigger contract');
  assertNamesPresent(manifest.contract.constraints, REQUIRED_CURRENT_CONSTRAINTS, 'constraint contract');
  assertNamesPresent(manifest.contract.indexes, REQUIRED_CURRENT_INDEXES, 'index contract');
};

const readLegacyOrphanCount = (database) => Number(psql(
  database,
  `SELECT
     (SELECT count(*) FROM "FamilyMember" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "FamilyMember" child LEFT JOIN "User" parent ON parent.id=child."userId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Income" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Income" child LEFT JOIN "User" parent ON parent.id=child."createdBy" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Expense" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Expense" child LEFT JOIN "User" parent ON parent.id=child."createdBy" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Asset" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Liability" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Budget" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Budget" child LEFT JOIN "User" parent ON parent.id=child."createdBy" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "RecurringTransaction" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "RecurringTransaction" child LEFT JOIN "User" parent ON parent.id=child."createdBy" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Goal" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "Goal" child LEFT JOIN "User" parent ON parent.id=child."createdBy" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "AiConversation" child LEFT JOIN "Family" parent ON parent.id=child."familyId" WHERE parent.id IS NULL)
   + (SELECT count(*) FROM "AiConversation" child LEFT JOIN "User" parent ON parent.id=child."userId" WHERE parent.id IS NULL)`,
));

const resourceCommands = Object.freeze({
  containers: ['ps', '-aq', '--filter', `label=com.docker.compose.project=${COMPOSE_PROJECT}`],
  volumes: ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${COMPOSE_PROJECT}`],
  networks: ['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${COMPOSE_PROJECT}`],
});

const readComposeResources = () => Object.fromEntries(
  Object.entries(resourceCommands).map(([kind, args]) => [
    kind,
    runChecked('docker', args, { cwd: repositoryDirectory }).stdout.trim(),
  ]),
);

const assertNoComposeResources = () => {
  const resources = readComposeResources();
  for (const [kind, ids] of Object.entries(resources)) {
    requireCondition(ids === '', `cleanup left ${kind}: ${ids.split(/\r?\n/).length}`);
  }
};

const cleanupStack = () => {
  removeDumps();
  compose(['down', '--volumes', '--remove-orphans'], { profiles: ['application'] });
  assertNoComposeResources();
};

const startBackend = async () => {
  compose(['up', '--build', '--detach', '--wait', 'backend'], { profiles: ['application'] });
  const deadline = Date.now() + 60_000;
  let lastStatus = 'unreachable';
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4180/api/health', {
        signal: AbortSignal.timeout(2_000),
      });
      lastStatus = String(response.status);
      if (response.ok) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.name : 'request-error';
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`backend health deadline exceeded (${lastStatus})`);
};

const collectDiagnostics = () => {
  for (const args of [
    ['ps', '--all'],
    ['logs', '--no-color', '--tail', '200', 'backend', 'postgres'],
  ]) {
    try {
      const result = compose(args, { allowFailure: true, profiles: ['application'] });
      const output = redact([result.stdout, result.stderr].filter(Boolean).join('\n').trim());
      if (output) console.error(`DIAGNOSTIC ${args[0]}\n${output}`);
    } catch (error) {
      console.error(`DIAGNOSTIC ${args[0]} unavailable: ${redact(error instanceof Error ? error.message : error)}`);
    }
  }
};

async function main() {
  const runId = Date.now().toString(36);
  const state = {
    checkpointDurations: {},
    postgresVersion: null,
    legacyManifest: null,
    upgradedManifest: null,
    currentManifest: null,
    runtimeIds: null,
    dumps: {},
    cleanup: false,
  };
  let activeCheckpoint = null;
  let legacyPrisma = null;
  let failure = null;

  const checkpoint = async (name, operation) => {
    activeCheckpoint = name;
    const started = Date.now();
    await operation();
    const duration = Date.now() - started;
    state.checkpointDurations[name] = duration;
    console.log(`PASS ${name} (${duration}ms)`);
    activeCheckpoint = null;
  };

  try {
    await checkpoint(CHECKPOINTS[0], async () => {
      listRepositoryMigrations();
      assertNoComposeResources();
      compose(['up', '--build', '--detach', '--wait', 'postgres', 'redis', 'minio', 'mock-ai']);
      const composeState = compose(['ps', '--all', '--format', 'json']).stdout;
      requireCondition(!/"Service"\s*:\s*"backend"/.test(composeState), 'backend started before the application checkpoint');
      const versionNumber = psql(CONTROL_DATABASE, 'SHOW server_version_num');
      requireCondition(/^16\d{4}$/.test(versionNumber), `PostgreSQL 16 required, received ${versionNumber}`);
      state.postgresVersion = psql(CONTROL_DATABASE, 'SHOW server_version');
      requireCondition(databaseExists(CONTROL_DATABASE), 'control database is missing');
      requireCondition(!databaseExists(LEGACY_DATABASE), 'legacy target was not empty');
      requireCondition(!databaseExists(APP_DATABASE), 'application target was not empty');
    });

    await checkpoint(CHECKPOINTS[1], async () => {
      legacyPrisma = createLegacyPrismaDirectory();
      createDatabase(LEGACY_DATABASE);
      deployMigrations(LEGACY_DATABASE, 'legacy', legacyPrisma);
      compareManifest(LEGACY_MIGRATIONS, readAppliedMigrations(LEGACY_DATABASE), 'legacy migration cut');
      loadLegacyFixture(LEGACY_DATABASE);
      state.legacyManifest = readLegacyManifest(LEGACY_DATABASE);
      compareManifest(LEGACY_EXPECTED, state.legacyManifest, 'legacy populated fixture');
      requireCondition(readLegacyOrphanCount(LEGACY_DATABASE) === 0, 'legacy fixture contains orphan rows');
    });

    await checkpoint(CHECKPOINTS[2], async () => {
      state.dumps.preUpgrade = createValidatedDump(LEGACY_DATABASE, 'pre-upgrade.dump');
      console.log(`BACKUP pre-upgrade.dump bytes=${state.dumps.preUpgrade.size} sha256=${state.dumps.preUpgrade.sha256}`);
    });

    await checkpoint(CHECKPOINTS[3], async () => {
      createDatabase(APP_DATABASE);
      restoreDump(APP_DATABASE, 'pre-upgrade.dump');
      deployMigrations(APP_DATABASE, 'current');
      legacyPrisma.cleanup();
      state.upgradedManifest = readUpgradedManifest(APP_DATABASE);
      assertUpgradedManifest(state.upgradedManifest);
      assertNoOrphans(APP_DATABASE);
    });

    await checkpoint(CHECKPOINTS[4], async () => {
      await startBackend();
      state.runtimeIds = await runApplicationSmoke(`current-${runId}`);
      state.currentManifest = readCurrentManifest(APP_DATABASE, state.runtimeIds);
      assertUpgradedManifest(state.currentManifest.upgraded);
      requireCondition(state.currentManifest.orphans.every((row) => row.orphanCount === 0), 'current application workload contains orphan rows');
    });

    await checkpoint(CHECKPOINTS[5], async () => {
      stopBackend();
      state.dumps.current = createValidatedDump(APP_DATABASE, 'current.dump');
      console.log(`BACKUP current.dump bytes=${state.dumps.current.size} sha256=${state.dumps.current.sha256}`);
    });

    await checkpoint(CHECKPOINTS[6], async () => {
      restoreDump(APP_DATABASE, 'current.dump');
      await startBackend();
      compareManifest(
        state.currentManifest,
        readCurrentManifest(APP_DATABASE, state.runtimeIds),
        'current dump verification restore',
      );

      psql(
        APP_DATABASE,
        `CREATE TABLE rehearsal_failure_sentinel(id integer primary key);
         UPDATE "Family" SET description='CORRUPTED-BY-REHEARSAL' WHERE id='legacy-family-a'`,
      );
      requireCondition(
        psql(APP_DATABASE, `SELECT to_regclass('public.rehearsal_failure_sentinel') IS NOT NULL`) === 't',
        'failure sentinel was not injected',
      );
      requireCondition(
        psql(APP_DATABASE, `SELECT description FROM "Family" WHERE id='legacy-family-a'`) === 'CORRUPTED-BY-REHEARSAL',
        'failure corruption was not injected',
      );

      restoreDump(APP_DATABASE, 'current.dump');
      requireCondition(
        psql(APP_DATABASE, `SELECT to_regclass('public.rehearsal_failure_sentinel') IS NULL`) === 't',
        'failure sentinel survived restore',
      );
      requireCondition(
        psql(APP_DATABASE, `SELECT description FROM "Family" WHERE id='legacy-family-a'`) === 'P1-H-03 family A',
        'corrupted family description survived restore',
      );
      compareManifest(
        state.currentManifest,
        readCurrentManifest(APP_DATABASE, state.runtimeIds),
        'failed release recovery manifest',
      );
      await startBackend();
    });

    await checkpoint(CHECKPOINTS[7], async () => {
      restoreDump(APP_DATABASE, 'pre-upgrade.dump');
      deployMigrations(APP_DATABASE, 'current');
      const forwardUpgraded = readUpgradedManifest(APP_DATABASE);
      assertUpgradedManifest(forwardUpgraded);
      assertNoOrphans(APP_DATABASE);
      await startBackend();
      const forwardRuntimeIds = await runApplicationSmoke(`forward-${runId}`);
      const forwardManifest = readCurrentManifest(APP_DATABASE, forwardRuntimeIds);
      assertUpgradedManifest(forwardManifest.upgraded);
      requireCondition(forwardManifest.orphans.every((row) => row.orphanCount === 0), 'forward recovery workload contains orphan rows');
    });

    await checkpoint(CHECKPOINTS[8], async () => {
      const migrationReplay = deployMigrations(APP_DATABASE, 'current');
      requireCondition(
        /No pending migrations to apply/i.test(`${migrationReplay.stdout}\n${migrationReplay.stderr}`),
        'final migration deploy did not report zero pending migrations',
      );
      cleanupStack();
      state.cleanup = true;
    });
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    failure = new Error(`${activeCheckpoint ?? 'rehearsal'}: ${detail}`);
    collectDiagnostics();
  } finally {
    if (legacyPrisma) {
      try {
        legacyPrisma.cleanup();
      } catch (error) {
        const cleanupError = error instanceof Error ? error : new Error(String(error));
        failure ??= cleanupError;
      }
    }
    try {
      cleanupStack();
      state.cleanup = true;
    } catch (error) {
      const cleanupError = error instanceof Error ? error : new Error(String(error));
      if (failure) {
        console.error(`CLEANUP FAIL ${redact(cleanupError.stack ?? cleanupError.message)}`);
      } else {
        failure = cleanupError;
      }
      state.cleanup = false;
    }
  }

  if (failure) throw failure;
  console.log(`SUMMARY ${JSON.stringify({
    migrationCut: LEGACY_MIGRATIONS.at(-1),
    migrationHead: ALL_MIGRATIONS.at(-1),
    dumps: state.dumps,
    checkpointDurations: state.checkpointDurations,
    postgresVersion: state.postgresVersion,
    cleanup: state.cleanup,
  })}`);
}

if (process.argv.includes('--list')) {
  for (const name of CHECKPOINTS) console.log(name);
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL ${redact(error instanceof Error ? error.stack ?? error.message : error)}`);
    process.exitCode = 1;
  });
}
