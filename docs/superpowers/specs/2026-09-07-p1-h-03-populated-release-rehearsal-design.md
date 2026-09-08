# P1-H-03 Populated Release Rehearsal Design

## Status and scope

- Date: 2026-09-07
- Delivery item: P1-H-03 migration/release/rollback rehearsal
- Approved direction: build a disposable, populated migration/backup/restore/forward-recovery gate first; connect the same contract to a protected staging environment later.
- Starting point: `codex/p1-h03-release-rehearsal` from the fully green P1-G-05 documentation commit `6e606e386ce43b23596759252a4539c3aec54f9f`.
- Out of scope: production deployment, production data, destructive in-place down migrations, production RPO/RTO claims, MinIO disaster backup, historical FX/valuation redesign, dependency remediation, and Phase 1 exit approval.

P1-H-03 is currently blocked because the repository has no GitHub Environment, staging secrets, deployment record, or target host. The first layer below removes the repository-owned rehearsal gap without pretending that a disposable runner is staging. The second layer defines the exact external evidence still required before P1-H-03 can become `OBSERVED`.

## Approaches considered

### 1. Direct staging deployment

This gives the strongest release evidence, but it cannot run now: no staging environment, credentials, protected approval boundary, immutable image digest, database endpoint, or deployment observability is configured. Building workflow code that assumes those values would create an unexecutable release claim.

### 2. Disposable populated rehearsal, followed by staging observation

This is the selected approach. A GitHub-hosted PostgreSQL 16 rehearsal starts from an exact pre-Phase-1 migration cut, loads deterministic multi-family data, creates and verifies backups, applies the immutable migration chain, exercises the current application, injects a failed-release sentinel, restores into a fresh database, and proves forward recovery. A separate staging runbook consumes the same invariants when real infrastructure becomes available.

This separates repository-owned automation from externally owned infrastructure while producing useful `PASS-REAL` database evidence immediately.

### 3. Documentation-only release runbook

This is inexpensive but produces no executable migration or restore evidence. It would leave both the tooling and environment gaps open, so it is insufficient.

## Safety and evidence model

The rehearsal must use only generated test identities and disposable volumes. It must never accept a production database URL, production credentials, or arbitrary database name. Its PostgreSQL host, port, database name, Compose project name, and dump directory are fixed test-only values in the runner. Teardown runs under `if: always()` and removes containers, networks, volumes, and dump files.

Evidence is split deliberately:

| Layer | Evidence allowed | Evidence not allowed |
| --- | --- | --- |
| Disposable Actions rehearsal | `PASS-REAL (REHEARSAL)` for PostgreSQL 16 populated upgrade, backup integrity, restore, current-app smoke, and forward recovery | `RELEASED`, `OBSERVED`, staging availability, production recoverability, or production RPO/RTO |
| Protected staging execution | `RELEASED` only after an exact image digest is deployed; `OBSERVED` only after the complete smoke and observation window succeeds | Production readiness or production disaster recovery unless separately executed there |

Until the second layer exists and succeeds, the P1-H-03 delivery state remains `BLOCKED / AT_RISK`, even if the rehearsal evidence is green. P1-H-04 remains open.

## Architecture

### Rehearsal topology

A dedicated `docker-compose.release-rehearsal.yml` owns a disposable PostgreSQL 16 service plus Redis, MinIO, deterministic mock AI, and the current backend. PostgreSQL is the only backed-up dependency in this gate. Redis is disposable cache, MinIO is present only so current backend startup and non-file API smoke use the production dependency topology, and mock AI prevents calls to external providers.

The backend is not started until the runner has restored the chosen database and explicitly applied migrations. This prevents the production image entrypoint from migrating the legacy fixture before its pre-upgrade manifest and backup have been captured. The backend always points to the fixed rehearsal database name and is stopped before database replacement.

The runner is dependency-free Node 20 code under `e2e/release-rehearsal/`. It invokes narrowly scoped `docker compose exec` operations for `psql`, `pg_dump`, `pg_restore`, database creation, and database replacement. All waits are deadline-bounded; no fixed sleep establishes readiness.

### Exact migration cut

The populated legacy source is migrated through exactly:

1. `20260710071015_test1`
2. `20260722013029_add_budget_recurring_goal`
3. `20260723030000_add_file_id_to_ai_conversation`

This is the last schema before the durable cache revision and Phase 1 migration series. The runner copies these three immutable migration directories and `migration_lock.toml` into a temporary Prisma directory and runs `prisma migrate deploy` against that temporary directory. It never edits, renames, resolves, or marks an existing migration as applied. The normal `backend/prisma` directory is then used for the full upgrade.

The exact directory list is asserted before any database work. An unexpected added, removed, renamed, or reordered migration fails the gate so reviewers must deliberately update the rehearsal cut and expected manifest.

### Component boundaries

| File | Responsibility |
| --- | --- |
| `docker-compose.release-rehearsal.yml` | Isolated services, health checks, fixed test credentials, backend profile, named disposable volumes |
| `e2e/release-rehearsal/legacy-fixture.sql` | Deterministic pre-Phase-1 users, families, roles, financial rows, budgets, recurring rules, and goals |
| `e2e/release-rehearsal/lib/process.mjs` | Checked child-process execution with captured stdout/stderr and redacted errors |
| `e2e/release-rehearsal/lib/database.mjs` | Allow-listed database lifecycle, migration cut application, dump validation, restore, and SQL query helpers |
| `e2e/release-rehearsal/lib/manifest.mjs` | Canonical JSON manifest construction and exact comparison for counts, IDs, amounts, roles, defaults, constraints, and referential integrity |
| `e2e/release-rehearsal/lib/api.mjs` | Bounded HTTP calls for identity, authorization, current-schema writes, idempotent replay, and report reconciliation |
| `e2e/release-rehearsal/run.mjs` | Named checkpoint state machine; no database or HTTP implementation details |
| `e2e/release-rehearsal/run.test.mjs` | Pure contract tests for migration allow-list, manifest comparison, secret redaction, database-name rejection, and checkpoint discovery |
| `.github/workflows/release-rehearsal.yml` | Read-only PR/manual workflow, syntax/unit checks, Compose execution, failure diagnostics, and unconditional cleanup |
| `docs/runbooks/staging-release-and-recovery.md` | Exact staging prerequisites, deploy/smoke/observation sequence, failure classification, application rollback, database restore, and evidence template |

The files are kept separate so process safety and manifest logic can be tested without Docker, while the Actions job remains the real database proof.

## Fixtures and canonical manifests

### Legacy fixture

The SQL fixture uses stable IDs and timestamps and includes:

- three users: family-A admin, family-A viewer, and family-B admin;
- two families with isolated memberships;
- CNY income and expense in both families, with amounts chosen so each family's income statement has a different exact result;
- one asset and one liability per family;
- one budget, recurring rule, and goal per family;
- an AI conversation row that exercises the existing nullable `fileId` migration contract.

The fixture does not contain real names, email addresses, passwords, files, or object data. File/object backup is intentionally excluded because P1-G-05 already covers the object lifecycle and this gate does not provide coordinated MinIO disaster recovery.

Before migration, the runner records a canonical legacy manifest containing migration names, table counts, stable primary keys, family ownership, membership roles, decimal amounts serialized as strings, timestamps normalized to UTC ISO strings, and orphan counts for every foreign key path in the legacy schema.

### Upgraded fixture

After full migration, the runner verifies backfilled values and constraints before starting the backend:

- `Family.baseCurrency = 'CNY'`, `Family.timezone = 'Asia/Shanghai'`, and `Family.cacheVersion` is present;
- Income/Expense `version = 1`, `currency = 'CNY'`, and origin fields remain nullable;
- RecurringTransaction, Asset, and Liability versions equal 1;
- Budget and Goal currencies equal CNY;
- legacy row IDs, family ownership, amounts, dates, and descriptions are unchanged;
- every expected Phase 1 table, index, foreign key, check constraint, and trigger exists;
- every orphan count is zero.

The current backend then creates a deterministic workload through public APIs: an idempotent financial mutation and replay, server-owned Import preview/confirm, recurring occurrence execution, AI proposal creation/confirmation through deterministic mock AI, and a goal contribution. These calls populate `IdempotencyRecord`, `AuditEvent`, `ImportBatch`, `ImportRow`, `RecurringExecution`, `AiProposal`, `AiProposalItem`, and `GoalContribution` through their production paths.

The current manifest records all table counts, the stable legacy subset, new entity references, idempotency/audit relationships, family cache versions, financial totals grouped by currency, and reconciliation results. Sensitive tokens and password hashes are never printed or included in an uploaded artifact.

## Rehearsal state machine

One Actions run must complete all checkpoints below against one Compose project. A split set of green runs cannot be combined into `PASS-REAL (REHEARSAL)`.

1. `migration-inventory-and-empty-target` — validate the exact migration sequence, test-only configuration, empty PostgreSQL cluster, and tool versions.
2. `legacy-schema-and-populated-fixture` — apply the three-migration cut, load the deterministic fixture, and capture the legacy manifest.
3. `pre-upgrade-backup-validated` — create a PostgreSQL custom-format dump, require a non-zero size, validate `pg_restore --list`, and record SHA-256 plus elapsed time.
4. `populated-upgrade-preserves-legacy-facts` — restore the pre-upgrade dump into a fresh target, run the full immutable migration chain, and verify backfills, constraints, row identity, amounts, family isolation, and zero orphans.
5. `current-application-smoke-and-population` — start the current backend, execute the current-schema workload, verify unauthenticated 401, non-member 403, viewer mutation 403, replay without duplicate facts, and exact report reconciliation.
6. `current-backup-validated` — stop writes, create and validate a current-schema custom-format dump, capture its SHA-256, and record the current canonical manifest.
7. `failed-release-restore` — insert a rehearsal-only sentinel table and change a known fixture description, stop the backend, replace the database with an empty one, restore the current dump, and prove the sentinel/change are absent while the complete current manifest matches.
8. `forward-recovery-from-pre-upgrade-backup` — replace the database again, restore the pre-upgrade dump, rerun the current migrations, restart the same current image, and prove the legacy/upgraded manifest plus API smoke. This is the forward-only schema recovery rehearsal; no down migration runs.
9. `idempotent-migrate-and-final-cleanup` — run `prisma migrate deploy` once more with zero pending migrations, collect only redacted diagnostics, and remove all services, volumes, networks, and dumps.

Every checkpoint prints its duration only after all assertions pass. On failure the runner prints the first failed checkpoint, a redacted command classification, and bounded service diagnostics, then exits non-zero. Teardown failure makes the workflow fail even if all behavioral checkpoints passed.

## Backup and restore rules

- Dumps use PostgreSQL custom format and the PostgreSQL 16 client inside the pinned PostgreSQL image.
- A dump is not valid merely because `pg_dump` exits zero: size must be non-zero, SHA-256 must be computed, and `pg_restore --list` must contain the expected schema and tables.
- Restore always targets a freshly created allow-listed rehearsal database after terminating only connections to that exact database.
- The runner refuses database identifiers outside its hard-coded test allow-list and refuses hosts other than the Compose PostgreSQL service.
- The backend is stopped before database replacement. Writes are never allowed during dump or restore checkpoints.
- The workflow does not upload database dumps. On failure it may upload redacted manifests and test logs only if they contain generated test data and no token, password hash, connection URL, or secret.
- Measured backup, migration, restore, startup, and validation times are evidence from the disposable runner, not production RTO. The deterministic fixture's last successfully captured dump is evidence data, not a production RPO statement.

## Failure and rollback behavior

The rehearsal recognizes four failure classes:

| Failure | Required action |
| --- | --- |
| Backup validation failure | Do not migrate or deploy; retain diagnostics and destroy the disposable environment |
| Migration or manifest mismatch | Stop the backend, retain the pre-upgrade dump for the current job only, fail the run, and do not alter migration history |
| Application smoke/security/reconciliation failure | Stop writes/backend, restore the last validated current dump into a fresh database, verify it, and fail the release gate |
| Restore or cleanup failure | Mark the gate failed; never report recovery success from an incomplete restore or leaked volume |

The repository policy is expand/migrate/contract plus forward fix. Schema rollback never drops the newly added Phase 1 tables or columns in place. The failed-release checkpoint proves recovery from a validated dump, and the forward-recovery checkpoint proves that the same immutable migrations can reconstruct the current contract from the pre-upgrade backup.

## Protected staging gate

The staging runbook remains dormant until an operator provides all of these external prerequisites:

- a GitHub Environment named `staging` with required reviewer protection;
- secret names for the staging database, Redis, MinIO, JWT, CORS origin, and deployment host without exposing their values;
- an existing populated staging dataset or an approved anonymized production-like fixture;
- immutable backend and frontend image digests; `latest` is forbidden;
- a coordinated PostgreSQL backup location and an explicit statement of whether MinIO data must be snapshotted for the release;
- a way to read application/deployment logs and health status during observation;
- named Release Owner and Repository Owner approvals.

The staging sequence is:

1. Record old frontend/backend image digests and the exact Git commit.
2. Enter a write pause for schema/restore work and verify no active migration job exists.
3. Capture and validate the staging backup; record its identifier, checksum, start/end time, and database migration head.
4. Apply migrations once, deploy the exact new image digests, and record the deployment identifier.
5. Run the same tenant/security/idempotency/reconciliation smoke contract against staging-generated records.
6. Observe for 30 minutes with one health sample per minute. All 30 samples must succeed; no unexplained 5xx, duplicate financial fact, cross-family exposure, reconciliation failure, migration error, Redis reconnect loop, or MinIO error is accepted.
7. Remove only the generated smoke records through authorized application paths and preserve audit evidence.

If application smoke fails while database integrity remains valid, redeploy the recorded previous image digest and keep additive schema expanded. If migration/data integrity fails, stop writes, restore the validated backup into a fresh database, validate the canonical manifest, switch the staging connection only after approval, and then deploy a forward fix. In-place down migration, manual deletion of financial rows, and assertion weakening are forbidden.

Only this successful staging sequence may change P1-H-03 to `RELEASED` and then `OBSERVED`.

## Test strategy and quality gates

### Local/static gates

- `node --test e2e/release-rehearsal/run.test.mjs`
- `node --check e2e/release-rehearsal/run.mjs`
- `node e2e/release-rehearsal/run.mjs --list` with exactly nine checkpoint names and no Docker/network access
- YAML parse plus assertions for `contents: read`, explicit timeout, pinned images, `if: always()`, and `down --volumes --remove-orphans`
- `git diff --check`

### Real rehearsal gate

The authoritative Actions run must show:

- PostgreSQL and client version;
- exact migration cut and current migration head;
- both validated dump checksums and non-zero sizes;
- all nine checkpoint PASS lines with durations;
- legacy/current manifest summaries without secrets;
- 401/403/viewer/cross-family negative results, one idempotent replay, and passed reconciliation;
- explicit absence of the injected failure sentinel after restore;
- zero pending migrations on the final deploy;
- removal of all containers, volumes, network, and dump files.

The existing backend build/coverage, PostgreSQL integration, frontend lint/build, Browser E2E, and Infrastructure Recovery workflows remain required regression gates on the same head SHA. `prisma validate` must pass. The pre-existing `prisma format --check` failure may be recorded only if the schema has no diff; this task must not format unrelated schema.

## Documentation and status updates

After the disposable gate is green, update `docs/delivery/phase-1/evidence/P1-H-03.md`, `docs/delivery/phase-1/phase-1-tracker.md`, `docs/project-memory.md`, and the audit follow-up with exact run ID, SHA, migration cut/head, checksums, checkpoint results, measured durations, and cleanup. Record `PASS-REAL (REHEARSAL)` as a partial evidence fact while retaining the P1-H-03 task state as `BLOCKED / AT_RISK` on missing staging execution.

Do not run the available AST-only Graphify updater. Record semantic refresh as pending so the reviewed graph is not replaced by lower-fidelity output.

After a future staging run, add deployment ID, image digests, backup ID/checksum, 30 observation samples, smoke result, cleanup, owner approvals, and any rollback/forward-fix action. Only then may the tracker advance through `RELEASED` and `OBSERVED`; P1-H-04 still requires its own exit review.

## Acceptance criteria

The first implementation slice is accepted when one exact GitHub-hosted run completes all nine rehearsal checkpoints, all same-SHA regression workflows pass, teardown is complete, and documentation preserves the staging blocker. It closes the repository-owned populated migration/backup/restore automation gap only.

P1-H-03 as a whole is accepted only after the protected staging sequence succeeds against populated staging data with immutable image digests, validated backup evidence, security/financial smoke checks, the full 30-minute observation window, and recorded owner approval.
