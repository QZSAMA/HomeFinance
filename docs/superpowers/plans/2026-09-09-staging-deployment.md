# Staging Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a review-gated, immutable-digest staging deployment path that runs the existing Docker Compose stack on one VPS with backup, restore, health, E2E, and rollback evidence.

**Architecture:** GitHub Actions builds and publishes versioned backend/frontend images, resolves their digests, and passes a manifest to a reviewed staging deploy job. The VPS stores only staging configuration and deployment state; a host-side script pulls the manifest, runs Compose and checks, while scheduled host jobs create checksummed PostgreSQL/MinIO backups and disposable restores.

**Tech Stack:** GitHub Actions, Docker Buildx/Compose, Bash, Ubuntu 24.04, PostgreSQL `pg_dump`, MinIO client, existing Playwright E2E runner.

## Global Constraints

- Preserve family authorization, viewer read-only, atomic/idempotent mutations, currency reconciliation, and migration history.
- Never deploy mutable `latest`; deploy only recorded image digests.
- Keep PostgreSQL, Redis, and MinIO off the public network.
- Use staging data only and never add production credentials.
- Do not modify the main worktree `.e2e-artifact/` or `graphify-out/`.
- Run required backend/frontend quality gates and update project memory/Graphify after implementation.

### Task 1: Define deployment manifest and immutable image outputs

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Create: `ops/staging/manifest.schema.json`
- Create: `ops/staging/render-manifest.sh`
- Test: `ops/staging/render-manifest.test.sh`

- [ ] Write a shell test asserting the manifest contains commit, backend digest, frontend digest, migration head, and timestamp, and rejects tag-only image references.
- [ ] Run `bash ops/staging/render-manifest.test.sh`; verify it fails before implementation.
- [ ] Update the workflow to push version tags, inspect pushed digests, generate a JSON manifest artifact, and expose it to the reviewed staging job.
- [ ] Implement strict shell validation/rendering with `set -euo pipefail`, schema checks, and digest-only Compose image values.
- [ ] Run the focused shell test and `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy.yml")'`; expect PASS.
- [ ] Commit as `ci: publish immutable staging manifest`.

### Task 2: Add VPS Compose deployment and rollback scripts

**Files:**
- Create: `ops/staging/deploy.sh`
- Create: `ops/staging/rollback.sh`
- Create: `ops/staging/compose.staging.yml`
- Create: `ops/staging/.env.example`
- Test: `ops/staging/deploy.test.sh`

- [ ] Write tests for private service ports, digest-only images, failed health check preserving the active manifest, and rollback selecting the previous manifest.
- [ ] Run the focused shell test; verify failure before implementation.
- [ ] Implement deployment ordering: validate manifest, pull exact digests, render env, `docker compose config`, start stack, poll health and migration status, run the existing four journey command, then atomically promote `active-manifest.json` and retain diagnostics on failure.
- [ ] Implement rollback by validating and redeploying `previous-manifest.json` without attempting schema downgrade.
- [ ] Run the shell test plus `docker compose -f ops/staging/compose.staging.yml config`; expect PASS.
- [ ] Commit as `feat: add staging deployment and rollback scripts`.

### Task 3: Add backup, retention, checksum, and restore rehearsal

**Files:**
- Create: `ops/staging/backup.sh`
- Create: `ops/staging/restore-rehearsal.sh`
- Create: `ops/staging/backup-retention.sh`
- Create: `ops/staging/backup.test.sh`
- Modify: `ops/staging/README.md`

- [ ] Write tests for PostgreSQL custom dump creation, MinIO object copy, SHA-256 sidecar generation, seven daily/four weekly retention, and restore cleanup.
- [ ] Run the focused shell test; verify failure before implementation.
- [ ] Implement backups into an explicit non-served directory, checksum every artifact, prune by class and age, and fail closed when required services are unavailable.
- [ ] Implement disposable restore against a temporary Compose project and verify migration head, authorization isolation, idempotent replay, and CNY income/expense reconciliation before cleanup.
- [ ] Document cron/systemd timer installation and disk usage alert threshold at 80%.
- [ ] Run the focused shell test; expect PASS.
- [ ] Commit as `ops: add staging backup and restore rehearsal`.

### Task 4: Wire GitHub Environment approval and deployment evidence

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Create: `ops/staging/deployment-manifest.example.json`
- Create: `docs/runbooks/staging-deployment.md`

- [ ] Add a `staging` environment to the deploy job, document the owner-only required reviewer setting, and pass the manifest to the VPS through a short-lived restricted credential.
- [ ] Add evidence upload for manifest, health, migration, E2E, and rollback metadata while excluding secrets and database dumps.
- [ ] Document first provisioning, deploy, failure diagnosis, rollback, backup verification, and restore rehearsal commands.
- [ ] Validate workflow YAML and run shell tests.
- [ ] Commit as `docs: document staging deployment runbook`.

### Task 5: Verify gates and update durable project memory

**Files:**
- Modify: `docs/project-memory.md`
- Create: `docs/audit/2026-09-09-staging-deployment-evidence.md`

- [ ] Run backend build and coverage, frontend lint/build, Prisma validate/format check, focused staging tests, and workflow syntax validation.
- [ ] Record observed results, limitations, and the fact that real VPS execution remains pending until infrastructure exists.
- [ ] Update the affected roadmap/risk entries and run the approved semantic Graphify refresh workflow without overwriting reviewed semantic edges.
- [ ] Commit as `docs: record staging deployment readiness evidence`.
