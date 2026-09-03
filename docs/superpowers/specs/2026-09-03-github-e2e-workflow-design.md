# GitHub Actions E2E workflow design

## Context

The repository already contains a deterministic Playwright suite and an isolated
Compose stack for P1-G-04. The current Windows development host has no Docker
CLI, so the stack cannot be executed locally. GitHub-hosted Ubuntu runners
provide Docker Compose and are suitable for disposable browser validation.

## Decision

Add a dedicated `.github/workflows/e2e.yml` workflow. It runs on pushes to
`main`, pull requests targeting `main`, and manual dispatch. The workflow uses
`ubuntu-latest`, Node.js 20, the frontend lockfile cache, and the existing
`frontend/scripts/run-e2e.mjs` entry point. That entry point owns Compose
startup and cleanup, so the workflow does not duplicate service lifecycle logic.

The workflow installs Chromium with Playwright's Linux dependencies, runs the
four P1-G-04 journeys against the isolated PostgreSQL/Redis/MinIO/mock-AI
stack, and uploads Playwright reports, screenshots, traces, and videos when a
run fails. It has read-only repository permissions and does not use production
secrets.

## Acceptance criteria

1. GitHub Actions can discover and run the workflow on `main`, pull requests,
   and manual dispatch.
2. A runner executes `npm run test:e2e` from `frontend/` after installing
   Chromium and its system dependencies.
3. A failed run preserves `frontend/playwright-report` and
   `frontend/test-results` as an artifact.
4. Existing CI and tag-triggered GHCR publishing behavior is unchanged.
5. The project must not mark P1-G-04 as PASS-E2E until a real GitHub runner run
   is green; adding this workflow only changes the status to CI-ready.

## Rollback

Delete `.github/workflows/e2e.yml`. No application code, schema, production
environment, or data volume is changed by this workflow.
