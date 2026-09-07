# Staging release and recovery runbook

This runbook is an operator gate for P1-H-03. The disposable rehearsal proves repository-owned migration, backup, restore, and forward-recovery behavior; it does not authorize a staging release.

## Prerequisites

- A protected GitHub Environment `staging` with a required reviewer.
- Named Release Owner and Repository Owner, with non-production URLs and secret names documented without exposing secret values.
- An approved populated staging dataset or anonymized production-like fixture, plus observability access.
- Coordinated PostgreSQL and MinIO backup scope, including whether object storage must be snapshotted.
- Immutable backend and frontend image digests. Reject `latest` and mutable tags.

## Preflight and release

1. Record the exact Git SHA, previous backend/frontend image digests, deployment ID, and current migration head.
2. Enter a write pause and verify that no migration job is running.
3. Capture and validate the staging backup. Record backup ID, checksum, byte count, start/end timestamps, and database migration head.
4. Apply migrations once, then deploy the exact immutable image digests. Record the new deployment ID.
5. Run the populated smoke: unauthenticated 401, non-member 403, viewer mutation 403, family isolation, idempotent income replay, CSV Import, Recurring execution, AI proposal confirmation, GoalContribution replay, and explicit income-statement reconciliation over generated records.

## Observation

Collect 30 one-minute samples. Every health check must succeed. Stop and investigate any unexplained 5xx, cross-family result, duplicate financial fact, reconciliation failure, migration error, Redis reconnect loop, or MinIO error. Preserve the exact smoke IDs and all owner decisions.

## Cleanup and rollback

Delete only generated smoke records through authorized application APIs and preserve audit/deployment evidence. If application behavior fails while database integrity remains valid, redeploy the previous image digest and retain the additive schema. If migration or data integrity fails, stop writes, restore the validated backup into a fresh database, validate the manifest, switch only after owner approval, and then deploy a forward fix. Never use an in-place down migration or manually delete financial rows.

## Evidence template

Record: Git SHA; backend/frontend immutable image digests; deployment and backup IDs; checksum and bytes; timestamps; migration head; all 30 observation results; smoke user/family/transaction/import/recurring/AI/goal IDs; owner approvals; rollback or forward fix action; cleanup and audit confirmation.

P1-H-03 remains `BLOCKED` until this protected staging sequence succeeds. The rehearsal alone is never `RELEASED` or `OBSERVED`.
