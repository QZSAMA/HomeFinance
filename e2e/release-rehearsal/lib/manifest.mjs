import assert from 'node:assert/strict';
import { psql } from './database.mjs';

const LEGACY_TABLES = [
  'User',
  'Family',
  'FamilyMember',
  'Income',
  'Expense',
  'Asset',
  'Liability',
  'Budget',
  'RecurringTransaction',
  'Goal',
  'AiConversation',
];

export const CURRENT_TABLES = Object.freeze([
  ...LEGACY_TABLES,
  'File',
  'RecurringExecution',
  'IdempotencyRecord',
  'AuditEvent',
  'GoalContribution',
  'ImportBatch',
  'ImportRow',
  'AIProposal',
  'AIProposalItem',
]);

export const LEGACY_EXPECTED = Object.freeze({
  counts: {
    User: 3,
    Family: 2,
    FamilyMember: 3,
    Income: 2,
    Expense: 2,
    Asset: 2,
    Liability: 2,
    Budget: 2,
    RecurringTransaction: 2,
    Goal: 2,
    AiConversation: 2,
  },
  roles: [
    { familyId: 'legacy-family-a', userId: 'legacy-admin-a', role: 'admin' },
    { familyId: 'legacy-family-a', userId: 'legacy-viewer-a', role: 'viewer' },
    { familyId: 'legacy-family-b', userId: 'legacy-admin-b', role: 'admin' },
  ],
  totals: [
    {
      familyId: 'legacy-family-a',
      income: '1000.00',
      expense: '250.00',
      asset: '5000.00',
      liability: '1000.00',
    },
    {
      familyId: 'legacy-family-b',
      income: '700.00',
      expense: '125.00',
      asset: '3000.00',
      liability: '500.00',
    },
  ],
});

export const REQUIRED_CURRENT_TABLES = Object.freeze([
  'AIProposal',
  'AIProposalItem',
  'AuditEvent',
  'GoalContribution',
  'IdempotencyRecord',
  'ImportBatch',
  'ImportRow',
  'RecurringExecution',
]);

export const REQUIRED_CURRENT_TRIGGERS = Object.freeze([
  'AiConversation_bump_family_cache_version',
  'Asset_bump_family_cache_version',
  'Budget_bump_family_cache_version',
  'Expense_bump_family_cache_version',
  'FamilyMember_bump_family_cache_version',
  'Family_timezone_immutable',
  'File_bump_family_cache_version',
  'GoalContribution_bump_family_cache_version',
  'Goal_bump_family_cache_version',
  'Income_bump_family_cache_version',
  'Liability_bump_family_cache_version',
  'RecurringTransaction_bump_family_cache_version',
]);

export const REQUIRED_CURRENT_CONSTRAINTS = Object.freeze([
  'AIProposal_status_check',
  'Budget_currency_check',
  'Expense_currency_check',
  'Family_baseCurrency_check',
  'Family_timezone_nonblank',
  'GoalContribution_amount_check',
  'GoalContribution_currency_check',
  'GoalContribution_source_type_check',
  'Goal_currency_check',
  'IdempotencyRecord_completion_state_check',
  'IdempotencyRecord_payloadHash_format_check',
  'Income_currency_check',
  'RecurringExecution_status_check',
]);

export const REQUIRED_CURRENT_INDEXES = Object.freeze([
  'AIProposalItem_proposalId_ordinal_key',
  'GoalContribution_allocation_key',
  'GoalContribution_source_key',
  'IdempotencyRecord_scope_key',
  'ImportRow_batchId_rowNumber_key',
  'RecurringExecution_occurrence_key',
]);

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

function queryJson(database, sql) {
  const output = psql(database, sql);
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`manifest query returned invalid JSON`);
  }
}

function quoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonArray(database, query) {
  return queryJson(
    database,
    `SELECT COALESCE(json_agg(row_to_json(manifest_row)), '[]'::json) FROM (${query}) manifest_row`,
  );
}

function readCounts(database, tables) {
  const fields = tables
    .map((table) => `'${table}', (SELECT count(*)::int FROM "${table}")`)
    .join(', ');
  return queryJson(database, `SELECT json_build_object(${fields})`);
}

function readRoles(database) {
  return jsonArray(
    database,
    `SELECT "familyId" AS "familyId", "userId" AS "userId", role
       FROM "FamilyMember"
      WHERE "familyId" LIKE 'legacy-family-%'
      ORDER BY "familyId", "userId"`,
  );
}

function readLegacyTotals(database) {
  return jsonArray(
    database,
    `SELECT family.id AS "familyId",
            to_char(COALESCE((SELECT sum(amount) FROM "Income" WHERE "familyId" = family.id), 0), 'FM999999999999990.00') AS income,
            to_char(COALESCE((SELECT sum(amount) FROM "Expense" WHERE "familyId" = family.id), 0), 'FM999999999999990.00') AS expense,
            to_char(COALESCE((SELECT sum(value) FROM "Asset" WHERE "familyId" = family.id), 0), 'FM999999999999990.00') AS asset,
            to_char(COALESCE((SELECT sum(amount) FROM "Liability" WHERE "familyId" = family.id), 0), 'FM999999999999990.00') AS liability
       FROM "Family" family
      WHERE family.id LIKE 'legacy-family-%'
      ORDER BY family.id`,
  );
}

export function readLegacyManifest(database) {
  return {
    counts: readCounts(database, LEGACY_TABLES),
    roles: readRoles(database),
    totals: readLegacyTotals(database),
  };
}

function readStableLegacyFacts(database) {
  return {
    roles: readRoles(database),
    totals: readLegacyTotals(database),
    rows: jsonArray(
      database,
      `SELECT entity, id, "familyId", amount, description, date
         FROM (
           SELECT 'Income' AS entity, id, "familyId", to_char(amount, 'FM999999999999990.00') AS amount, description, to_char(date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date FROM "Income" WHERE id LIKE 'legacy-%'
           UNION ALL
           SELECT 'Expense', id, "familyId", to_char(amount, 'FM999999999999990.00'), description, to_char(date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM "Expense" WHERE id LIKE 'legacy-%'
           UNION ALL
           SELECT 'Asset', id, "familyId", to_char(value, 'FM999999999999990.00'), description, NULL FROM "Asset" WHERE id LIKE 'legacy-%'
           UNION ALL
           SELECT 'Liability', id, "familyId", to_char(amount, 'FM999999999999990.00'), description, NULL FROM "Liability" WHERE id LIKE 'legacy-%'
         ) facts
        ORDER BY entity, id`,
    ),
  };
}

function readUpgradedContract(database) {
  return {
    families: jsonArray(
      database,
      `SELECT id, "baseCurrency" AS "baseCurrency", timezone, "cacheVersion" AS "cacheVersion"
         FROM "Family" WHERE id LIKE 'legacy-family-%' ORDER BY id`,
    ),
    versions: jsonArray(
      database,
      `SELECT entity, id, version, currency FROM (
         SELECT 'Income' AS entity, id, version, currency FROM "Income" WHERE id LIKE 'legacy-%'
         UNION ALL SELECT 'Expense', id, version, currency FROM "Expense" WHERE id LIKE 'legacy-%'
         UNION ALL SELECT 'Asset', id, version, currency FROM "Asset" WHERE id LIKE 'legacy-%'
         UNION ALL SELECT 'Liability', id, version, currency FROM "Liability" WHERE id LIKE 'legacy-%'
         UNION ALL SELECT 'RecurringTransaction', id, version, NULL::text FROM "RecurringTransaction" WHERE id LIKE 'legacy-%'
         UNION ALL SELECT 'Budget', id, NULL::integer, currency FROM "Budget" WHERE id LIKE 'legacy-%'
         UNION ALL SELECT 'Goal', id, NULL::integer, currency FROM "Goal" WHERE id LIKE 'legacy-%'
       ) versioned ORDER BY entity, id`,
    ),
    migrations: jsonArray(
      database,
      `SELECT migration_name AS name
         FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY migration_name`,
    ).map((row) => row.name),
    tables: queryJson(
      database,
      `SELECT COALESCE(json_agg(table_name ORDER BY table_name), '[]'::json)
         FROM information_schema.tables
        WHERE table_schema = 'public'`,
    ),
    triggers: queryJson(
      database,
      `SELECT COALESCE(json_agg(tgname ORDER BY tgname), '[]'::json)
         FROM pg_trigger
        WHERE NOT tgisinternal`,
    ),
    constraints: queryJson(
      database,
      `SELECT COALESCE(json_agg(conname ORDER BY conname), '[]'::json)
         FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace`,
    ),
    indexes: queryJson(
      database,
      `SELECT COALESCE(json_agg(indexname ORDER BY indexname), '[]'::json)
         FROM pg_indexes
        WHERE schemaname = 'public'`,
    ),
  };
}

export function readUpgradedManifest(database) {
  return {
    legacy: readStableLegacyFacts(database),
    contract: readUpgradedContract(database),
  };
}

const ORPHAN_QUERIES = [
  ['FamilyMember.family', '"FamilyMember" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['FamilyMember.user', '"FamilyMember" child LEFT JOIN "User" parent ON parent.id=child."userId"', 'parent.id IS NULL'],
  ['Income.family', '"Income" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['Income.user', '"Income" child LEFT JOIN "User" parent ON parent.id=child."createdBy"', 'parent.id IS NULL'],
  ['Expense.family', '"Expense" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['Expense.user', '"Expense" child LEFT JOIN "User" parent ON parent.id=child."createdBy"', 'parent.id IS NULL'],
  ['Asset.family', '"Asset" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['Liability.family', '"Liability" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['File.family', '"File" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['File.user', '"File" child LEFT JOIN "User" parent ON parent.id=child."userId"', 'parent.id IS NULL'],
  ['AiConversation.family', '"AiConversation" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['AiConversation.user', '"AiConversation" child LEFT JOIN "User" parent ON parent.id=child."userId"', 'parent.id IS NULL'],
  ['AiConversation.file', '"AiConversation" child LEFT JOIN "File" parent ON parent.id=child."fileId"', 'child."fileId" IS NOT NULL AND parent.id IS NULL'],
  ['Budget.family', '"Budget" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['Budget.user', '"Budget" child LEFT JOIN "User" parent ON parent.id=child."createdBy"', 'parent.id IS NULL'],
  ['RecurringTransaction.family', '"RecurringTransaction" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['RecurringTransaction.user', '"RecurringTransaction" child LEFT JOIN "User" parent ON parent.id=child."createdBy"', 'parent.id IS NULL'],
  ['RecurringExecution.family', '"RecurringExecution" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['RecurringExecution.rule', '"RecurringExecution" child LEFT JOIN "RecurringTransaction" parent ON parent.id=child."recurringTransactionId"', 'parent.id IS NULL'],
  ['IdempotencyRecord.family', '"IdempotencyRecord" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['AuditEvent.family', '"AuditEvent" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['AuditEvent.mutation', '"AuditEvent" child LEFT JOIN "IdempotencyRecord" parent ON parent.id=child."mutationId"', 'parent.id IS NULL'],
  ['AuditEvent.actor', '"AuditEvent" child LEFT JOIN "User" parent ON parent.id=child."actorUserId"', 'child."actorUserId" IS NOT NULL AND parent.id IS NULL'],
  ['Goal.family', '"Goal" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['Goal.user', '"Goal" child LEFT JOIN "User" parent ON parent.id=child."createdBy"', 'parent.id IS NULL'],
  ['GoalContribution.family', '"GoalContribution" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['GoalContribution.goal', '"GoalContribution" child LEFT JOIN "Goal" parent ON parent.id=child."goalId"', 'parent.id IS NULL'],
  ['GoalContribution.user', '"GoalContribution" child LEFT JOIN "User" parent ON parent.id=child."createdBy"', 'parent.id IS NULL'],
  ['ImportBatch.family', '"ImportBatch" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['ImportBatch.actor', '"ImportBatch" child LEFT JOIN "User" parent ON parent.id=child."actorUserId"', 'parent.id IS NULL'],
  ['ImportRow.batch', '"ImportRow" child LEFT JOIN "ImportBatch" parent ON parent.id=child."batchId"', 'parent.id IS NULL'],
  ['AIProposal.family', '"AIProposal" child LEFT JOIN "Family" parent ON parent.id=child."familyId"', 'parent.id IS NULL'],
  ['AIProposal.actor', '"AIProposal" child LEFT JOIN "User" parent ON parent.id=child."actorUserId"', 'child."actorUserId" IS NOT NULL AND parent.id IS NULL'],
  ['AIProposal.conversation', '"AIProposal" child LEFT JOIN "AiConversation" parent ON parent.id=child."sourceConversationId"', 'child."sourceConversationId" IS NOT NULL AND parent.id IS NULL'],
  ['AIProposal.file', '"AIProposal" child LEFT JOIN "File" parent ON parent.id=child."sourceFileId"', 'child."sourceFileId" IS NOT NULL AND parent.id IS NULL'],
  ['AIProposalItem.proposal', '"AIProposalItem" child LEFT JOIN "AIProposal" parent ON parent.id=child."proposalId"', 'parent.id IS NULL'],
];

export function readOrphanManifest(database) {
  const unions = ORPHAN_QUERIES.map(([relation, from, where]) => (
    `SELECT ${quoted(relation)} AS relation, count(*)::int AS "orphanCount" FROM ${from} WHERE ${where}`
  ));
  return jsonArray(database, `${unions.join(' UNION ALL ')} ORDER BY relation`);
}

export function assertNoOrphans(database) {
  const rows = readOrphanManifest(database);
  const failures = rows.filter((row) => row.orphanCount !== 0);
  if (failures.length > 0) {
    throw new Error(`orphan rows found: ${JSON.stringify(failures)}`);
  }
  return rows;
}

export function readCurrentManifest(database, runtimeIds) {
  const familyIds = [runtimeIds.familyAId, runtimeIds.familyBId].map(quoted).join(',');
  const runtimeFamilyFilter = familyIds || "''";
  return {
    upgraded: readUpgradedManifest(database),
    counts: readCounts(database, CURRENT_TABLES),
    runtime: {
      identities: canonicalize(runtimeIds),
      memberships: jsonArray(
        database,
        `SELECT "familyId" AS "familyId", "userId" AS "userId", role
           FROM "FamilyMember" WHERE "familyId" IN (${runtimeFamilyFilter})
          ORDER BY "familyId", "userId"`,
      ),
      financialFacts: jsonArray(
        database,
        `SELECT entity, id, "familyId", amount, currency, description FROM (
           SELECT 'Income' AS entity, id, "familyId", to_char(amount, 'FM999999999999990.00') AS amount, currency, description FROM "Income" WHERE "familyId" IN (${runtimeFamilyFilter})
           UNION ALL
           SELECT 'Expense', id, "familyId", to_char(amount, 'FM999999999999990.00'), currency, description FROM "Expense" WHERE "familyId" IN (${runtimeFamilyFilter})
         ) facts ORDER BY entity, id`,
      ),
      mutations: jsonArray(
        database,
        `SELECT mutation.id::text, mutation."familyId" AS "familyId", mutation.operation,
                mutation."httpStatus" AS "httpStatus", count(audit.id)::int AS "auditCount"
           FROM "IdempotencyRecord" mutation
           LEFT JOIN "AuditEvent" audit ON audit."mutationId" = mutation.id
          WHERE mutation."familyId" IN (${runtimeFamilyFilter})
          GROUP BY mutation.id, mutation."familyId", mutation.operation, mutation."httpStatus"
          ORDER BY mutation.id::text`,
      ),
      recurring: jsonArray(
        database,
        `SELECT id, "familyId" AS "familyId", "recurringTransactionId" AS "recurringTransactionId",
                status, "entryType" AS "entryType", "entryId" AS "entryId", "mutationId"::text AS "mutationId"
           FROM "RecurringExecution" WHERE "familyId" IN (${runtimeFamilyFilter}) ORDER BY id`,
      ),
      imports: jsonArray(
        database,
        `SELECT batch.id, batch."familyId" AS "familyId", batch.status,
                row."rowNumber" AS "rowNumber", row.status AS "rowStatus",
                row."resultEntityType" AS "resultEntityType", row."resultEntityId" AS "resultEntityId"
           FROM "ImportBatch" batch LEFT JOIN "ImportRow" row ON row."batchId" = batch.id
          WHERE batch."familyId" IN (${runtimeFamilyFilter}) ORDER BY batch.id, row."rowNumber"`,
      ),
      proposals: jsonArray(
        database,
        `SELECT proposal.id, proposal."familyId" AS "familyId", proposal.status,
                item.id AS "itemId", item.ordinal, item."typedAction" AS "typedAction",
                (item."resultJson" IS NOT NULL) AS "hasResult"
           FROM "AIProposal" proposal LEFT JOIN "AIProposalItem" item ON item."proposalId" = proposal.id
          WHERE proposal."familyId" IN (${runtimeFamilyFilter}) ORDER BY proposal.id, item.ordinal`,
      ),
      goals: jsonArray(
        database,
        `SELECT goal.id, goal."familyId" AS "familyId", goal.currency,
                contribution.id AS "contributionId", contribution."sourceType" AS "sourceType",
                to_char(contribution.amount, 'FM999999999999990.00') AS amount,
                contribution.currency AS "contributionCurrency"
           FROM "Goal" goal LEFT JOIN "GoalContribution" contribution ON contribution."goalId" = goal.id
          WHERE goal."familyId" IN (${runtimeFamilyFilter}) ORDER BY goal.id, contribution.id`,
      ),
      cacheVersions: jsonArray(
        database,
        `SELECT id, "cacheVersion" AS "cacheVersion" FROM "Family"
          WHERE id IN (${runtimeFamilyFilter}) ORDER BY id`,
      ),
      currencyTotals: jsonArray(
        database,
        `SELECT "familyId" AS "familyId", currency, entity,
                to_char(sum(amount), 'FM999999999999990.00') AS total
           FROM (
             SELECT "familyId", currency, 'income' AS entity, amount FROM "Income" WHERE "familyId" IN (${runtimeFamilyFilter})
             UNION ALL
             SELECT "familyId", currency, 'expense', amount FROM "Expense" WHERE "familyId" IN (${runtimeFamilyFilter})
           ) facts GROUP BY "familyId", currency, entity ORDER BY "familyId", currency, entity`,
      ),
    },
    orphans: assertNoOrphans(database),
  };
}
