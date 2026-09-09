# Staging Deployment Foundation Evidence

Date: 2026-09-09

## Observed evidence

PR #7 commit `3272ada7fd0b057ac75f166c588405ac9fec0f46` passed its GitHub checks: backend tests, PostgreSQL integration tests, frontend build, Playwright against Compose, and Redis/MinIO recovery against Compose. The staging Environment exists in GitHub and requires review by `QZSAMA` before the `Deploy to staging` job can use its environment-scoped configuration.

The follow-up staging configuration adds a digest-only three-image manifest (backend, frontend, deterministic mock-AI), an Environment-gated SSH deployment job, staged Compose activation with health and Prisma migration checks, workflow-side critical browser journeys, and failure diagnostics. Backup creates a PostgreSQL custom dump plus an archive of the named MinIO volume with checksums. Restore rehearsal verifies checksums and uses a separate Compose project and named volumes, never the active staging database.

Local static verification passed:

```text
node ops/staging/staging-contract.test.mjs
staging contract PASS

node -e "JSON.parse(require('fs').readFileSync('ops/staging/manifest.schema.json')); console.log('manifest schema PASS')"
manifest schema PASS

git diff --check
PASS
```

## Limits and remaining gates

This workstation has no Docker CLI, so the new staging Compose configuration and scripts were not run locally. No VPS, GitHub Environment secrets, `STAGING_URL`, GHCR pull token, tag-triggered deployment, backup, restore, rollback, or real staging browser journey has been observed. P1-H-03 remains `BLOCKED` and `AT_RISK`; this is implementation readiness evidence only, not a release or staging-observation claim.

The semantic Graphify incremental runner remains unavailable. Per repository policy, the AST-only Graphify output was not used because it would overwrite the reviewed semantic graph.
