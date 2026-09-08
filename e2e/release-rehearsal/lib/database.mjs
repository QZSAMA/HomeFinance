import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecked } from './process.mjs';

export const repositoryDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
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
  if (!ALLOWED_DATABASES.includes(name)) {
    throw new Error(`refusing database name: ${String(name)}`);
  }
  return name;
}

export function assertMigrationInventory(actual) {
  if (JSON.stringify(actual) !== JSON.stringify(ALL_MIGRATIONS)) {
    throw new Error(`migration inventory mismatch: ${JSON.stringify(actual)}`);
  }
  return actual;
}

const composePrefix = () => [
  'compose',
  '-p',
  COMPOSE_PROJECT,
  '-f',
  COMPOSE_FILE,
];

export function buildPgCommand(database, toolArgs) {
  assertDatabaseName(database);
  const [tool, ...rest] = toolArgs;
  if (!['psql', 'pg_dump', 'pg_restore'].includes(tool)) {
    throw new Error(`refusing PostgreSQL tool: ${String(tool)}`);
  }
  return [
    ...composePrefix(),
    'exec',
    '-T',
    'postgres',
    tool,
    '-U',
    'postgres',
    '-d',
    database,
    ...rest,
  ];
}

export function buildPrismaEnvironment(database) {
  assertDatabaseName(database);
  return {
    DATABASE_URL: `postgresql://postgres:rehearsal-postgres-password@${DATABASE_HOST}:${DATABASE_PORT}/${database}?schema=public`,
  };
}

export function buildRestoreCommands(database, filename) {
  assertDatabaseName(database);
  if (database !== 'homefinance_rehearsal_app') {
    throw new Error('restore target must be rehearsal app database');
  }
  if (!/^(pre-upgrade|current)\.dump$/.test(filename)) {
    throw new Error(`refusing dump filename: ${filename}`);
  }
  return [
    {
      database: 'homefinance_rehearsal_control',
      sql: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
    },
    {
      database: 'homefinance_rehearsal_control',
      sql: `DROP DATABASE "${database}"`,
    },
    {
      database: 'homefinance_rehearsal_control',
      sql: `CREATE DATABASE "${database}"`,
    },
    {
      database,
      args: [
        'pg_restore',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        `/rehearsal/${filename}`,
      ],
    },
  ];
}

export function compose(args, {
  allowFailure = false,
  input,
  profiles = [],
} = {}) {
  const profileArgs = profiles.flatMap((profile) => ['--profile', profile]);
  return runChecked('docker', [...composePrefix(), ...profileArgs, ...args], {
    cwd: repositoryDirectory,
    allowFailure,
    input,
  });
}

export function psql(database, sql) {
  return runChecked(
    'docker',
    buildPgCommand(database, [
      'psql',
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ]),
    { cwd: repositoryDirectory },
  ).stdout.trim();
}

export function listRepositoryMigrations() {
  const migrationDirectory = resolve(repositoryDirectory, 'backend', 'prisma', 'migrations');
  const migrations = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return assertMigrationInventory(migrations);
}

export function createLegacyPrismaDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'homefinance-p1-h03-'));
  const prismaDirectory = join(root, 'prisma');
  const migrationsDirectory = join(prismaDirectory, 'migrations');
  const sourcePrisma = resolve(repositoryDirectory, 'backend', 'prisma');

  cpSync(resolve(sourcePrisma, 'schema.prisma'), resolve(prismaDirectory, 'schema.prisma'), {
    recursive: false,
  });
  cpSync(
    resolve(sourcePrisma, 'migrations', 'migration_lock.toml'),
    resolve(migrationsDirectory, 'migration_lock.toml'),
    { recursive: false },
  );
  for (const migration of LEGACY_MIGRATIONS) {
    cpSync(
      resolve(sourcePrisma, 'migrations', migration),
      resolve(migrationsDirectory, migration),
      { recursive: true },
    );
  }

  let removed = false;
  return {
    root,
    schemaPath: resolve(prismaDirectory, 'schema.prisma'),
    cleanup() {
      if (removed) return;
      const resolvedRoot = resolve(root);
      const resolvedTemp = resolve(tmpdir());
      if (!resolvedRoot.startsWith(`${resolvedTemp}\\`) && !resolvedRoot.startsWith(`${resolvedTemp}/`)) {
        throw new Error(`refusing temporary cleanup outside OS temp: ${resolvedRoot}`);
      }
      rmSync(resolvedRoot, { recursive: true, force: true });
      removed = true;
    },
  };
}

export function createDatabase(database) {
  assertDatabaseName(database);
  if (database === 'homefinance_rehearsal_control') {
    throw new Error('control database is created only by PostgreSQL startup');
  }
  return psql(
    'homefinance_rehearsal_control',
    `CREATE DATABASE "${database}"`,
  );
}

export function databaseExists(database) {
  assertDatabaseName(database);
  const result = psql(
    'homefinance_rehearsal_control',
    `SELECT count(*) FROM pg_database WHERE datname = '${database}'`,
  );
  return result === '1';
}

export function stopBackend() {
  return compose(['stop', 'backend'], {
    allowFailure: true,
    profiles: ['application'],
  });
}

export function replaceDatabase(database) {
  assertDatabaseName(database);
  if (database !== 'homefinance_rehearsal_app') {
    throw new Error('replace target must be rehearsal app database');
  }
  stopBackend();
  psql(
    'homefinance_rehearsal_control',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database}' AND pid <> pg_backend_pid()`,
  );
  psql('homefinance_rehearsal_control', `DROP DATABASE IF EXISTS "${database}"`);
  psql('homefinance_rehearsal_control', `CREATE DATABASE "${database}"`);
}

export function deployMigrations(database, mode, legacyPrisma) {
  assertDatabaseName(database);
  if (!['legacy', 'current'].includes(mode)) {
    throw new Error(`refusing migration mode: ${String(mode)}`);
  }
  if (mode === 'legacy' && !legacyPrisma?.schemaPath) {
    throw new Error('legacy migration requires a temporary Prisma schema');
  }
  const schemaPath = mode === 'legacy'
    ? legacyPrisma.schemaPath
    : resolve(repositoryDirectory, 'backend', 'prisma', 'schema.prisma');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return runChecked(npx, ['prisma', 'migrate', 'deploy', '--schema', schemaPath], {
    cwd: resolve(repositoryDirectory, 'backend'),
    env: buildPrismaEnvironment(database),
  });
}

export function loadLegacyFixture(database) {
  assertDatabaseName(database);
  const fixture = readFileSync(
    resolve(repositoryDirectory, 'e2e', 'release-rehearsal', 'legacy-fixture.sql'),
    'utf8',
  );
  return runChecked(
    'docker',
    buildPgCommand(database, [
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
    ]),
    { cwd: repositoryDirectory, input: fixture },
  );
}

function assertDumpFilename(filename) {
  if (!/^(pre-upgrade|current)\.dump$/.test(filename)) {
    throw new Error(`refusing dump filename: ${String(filename)}`);
  }
  return filename;
}

export function createValidatedDump(database, filename) {
  assertDatabaseName(database);
  assertDumpFilename(filename);
  compose([
    'exec',
    '-T',
    'postgres',
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    database,
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    `/rehearsal/${filename}`,
  ]);
  const size = Number(compose([
    'exec',
    '-T',
    'postgres',
    'stat',
    '-c',
    '%s',
    `/rehearsal/${filename}`,
  ]).stdout.trim());
  if (!Number.isInteger(size) || size <= 0) throw new Error(`${filename} is empty`);

  const listing = compose([
    'exec',
    '-T',
    'postgres',
    'pg_restore',
    '--list',
    `/rehearsal/${filename}`,
  ]).stdout;
  for (const table of ['Family', 'FamilyMember', 'Income', 'Expense']) {
    if (!new RegExp(`TABLE public "?${table}"?`).test(listing)) {
      throw new Error(`${filename} missing ${table}`);
    }
  }

  const sha256 = compose([
    'exec',
    '-T',
    'postgres',
    'sha256sum',
    `/rehearsal/${filename}`,
  ]).stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`${filename} checksum invalid`);
  }
  return { filename, size, sha256 };
}

export function restoreDump(database, filename) {
  assertDumpFilename(filename);
  stopBackend();
  const commands = buildRestoreCommands(database, filename);
  for (const command of commands) {
    if (command.sql) {
      psql(command.database, command.sql);
    } else {
      runChecked('docker', buildPgCommand(command.database, command.args), {
        cwd: repositoryDirectory,
      });
    }
  }
}

export function removeDumps() {
  return compose([
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'rm -f /rehearsal/pre-upgrade.dump /rehearsal/current.dump',
  ], { allowFailure: true });
}
