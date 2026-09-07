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
