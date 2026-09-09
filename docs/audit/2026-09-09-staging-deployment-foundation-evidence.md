# Staging Deployment Foundation Evidence

Date: 2026-09-09

## Observed evidence

PR #7 commit `3272ada7fd0b057ac75f166c588405ac9fec0f46` passed its GitHub checks: backend tests, PostgreSQL integration tests, frontend build, Playwright against Compose, and Redis/MinIO recovery against Compose. The staging Environment exists in GitHub and requires review by `QZSAMA` before the `Deploy to staging` job can use its environment-scoped configuration.

The follow-up configuration adds a digest-only three-image manifest (backend, frontend, deterministic mock-AI), an Environment-gated SSH deployment job, GitHub/VPS deployment serialization, staged candidate activation with health and Prisma migration checks, workflow-side critical browser journeys, and failure diagnostics. It advances the active manifest only after browser verification. A post-migration failure deliberately remains a forward-recovery incident rather than automatically starting an older application image. Staging disables public registration; the browser suite alone supplies an Environment-held registration key. Backup temporarily stops application writers and MinIO before creating the PostgreSQL custom dump plus named MinIO-volume archive with checksums. Restore rehearsal waits for isolated dependencies, then checks API health and Prisma migration state without touching the active staging database.

Local static verification passed:

```text
node ops/staging/staging-contract.test.mjs
staging contract PASS

node -e "JSON.parse(require('fs').readFileSync('ops/staging/manifest.schema.json')); console.log('manifest schema PASS')"
manifest schema PASS

git diff --check
PASS

backend: npm test -- --runInBand src/routes/auth.test.ts
PASS (11 tests)

backend: npm run build
PASS

frontend: npm run lint && npm run build
PASS (existing 870.23 kB chunk warning)
```

## Limits and remaining gates

This workstation has no Docker CLI, so the new staging Compose configuration and scripts were not run locally. No VPS, GitHub Environment secrets, `STAGING_URL`, GHCR pull token, tag-triggered deployment, backup, restore, rollback, or real staging browser journey has been observed. P1-H-03 remains `BLOCKED` and `AT_RISK`; this is implementation readiness evidence only, not a release or staging-observation claim.

The semantic Graphify incremental runner remains unavailable. Per repository policy, the AST-only Graphify output was not used because it would overwrite the reviewed semantic graph.
