# P1-G-04 Playwright E2E closure design

## Context

HomeFinance already has four serial Playwright journeys and an isolated
Docker Compose stack containing PostgreSQL, Redis, MinIO, deterministic mock-AI,
the backend, and the frontend proxy. The local Windows host cannot execute
Docker, so P1-G-04 has only reached `CI_READY`. Two GitHub Actions runs have
already exposed and corrected infrastructure/test-contract defects: the
frontend health probe now uses `127.0.0.1`, and ledger creation response
predicates match the resource pathname suffix instead of a broad substring.
The latest frontend family-selection persistence fix is covered by component
tests, but no real four-journey run is green yet.

## Goal

Produce reproducible, evidence-backed `PASS-E2E` for P1-G-04 by running the
existing four browser journeys against the real disposable Compose services on
a GitHub-hosted Ubuntu runner, fixing only test-topology or test-contract
defects discovered by that run.

## Non-goals

- No changes to financial semantics, authorization policy, persistence schema,
  or production API behavior.
- No production secrets or external AI provider calls.
- No claim that Redis/MinIO failure recovery, object isolation, staging, or
  release observation is complete; those remain P1-G-05/P1-H-03 work.
- No local Docker installation workaround or hidden test skip.

## Approach

The workflow remains CI-first. `.github/workflows/e2e.yml` invokes the existing
`frontend/scripts/run-e2e.mjs` entry point, which owns Compose startup,
Playwright execution, diagnostics, and cleanup. The runner installs the locked
frontend dependencies and Chromium with Linux dependencies. Each run uses the
named disposable project `homefinance-e2e`; the stack is never connected to
production data.

When a run fails, the order of investigation is:

1. Identify whether the failure is service startup/health, browser navigation,
   selector/state synchronization, or an application contract mismatch.
2. Capture the failing response/status, Compose service logs, and Playwright
   screenshot/trace/video before changing code.
3. Apply the smallest fix in the E2E spec, Compose health check, runner, or
   workflow. A production-code change is allowed only when the browser run
   proves an existing user-visible defect and a focused regression test is
   written first.
4. Re-run the complete four-journey suite; do not mark the gate from a focused
   or statically discovered test.

## Journey contracts

1. **Registration, family switching, and isolation**: two fresh users and two
   families are created; family A data is absent in family B and visible again
   after switching back.
2. **Ledger CRUD and income statement**: an income and expense are created,
   an income is edited, the report shows `income - expense`, and the expense is
   deleted.
3. **Viewer denial**: a viewer can load the family but an expense POST receives
   `403`; the denied marker is absent from the administrator's ledger.
4. **Import and AI confirmation**: one CSV row is previewed and confirmed; a
   deterministic AI proposal is visible without ledger mutation, then becomes
   one ledger entry only after explicit confirmation.

The journeys run serially with one worker and unique run-scoped emails,
family names, and descriptions. They use accessible labels and stable route
matching rather than arbitrary sleeps. The test must continue to assert HTTP
status and resulting UI state, not only button clicks.

## Failure and artifact handling

- The workflow keeps `E2E_KEEP_STACK=1` so failed runs can dump service status
  and backend/frontend logs before the final teardown step.
- Playwright retains HTML report, screenshot, trace, and video on failure;
  Actions uploads `frontend/playwright-report` and `frontend/test-results` for
  14 days.
- Cleanup runs with `if: always()` and removes the named volumes and orphaned
  containers. A cleanup failure fails the job and is recorded in the evidence.
- A browser timeout, `5xx`, unexpected `401/403`, or missing post-confirmation
  ledger row is a failed gate result, not a flaky success.

## Acceptance criteria

1. `docker compose -p homefinance-e2e -f docker-compose.e2e.yml config --quiet`
   succeeds on the runner.
2. All six services reach healthy state and the frontend is reachable at
   `http://127.0.0.1:4173`.
3. `npm run test:e2e` passes all four journeys in one run with no retries
   required for correctness.
4. A deliberate failure path still uploads diagnostics and the stack is
   removed afterward.
5. Frontend unit tests, lint, build, backend build, and Prisma checks remain
   green after any test-topology change.
6. Only after a real green Actions run, update `P1-G-04.md`, the Phase 1
   tracker, and project memory from `E2E_EXECUTION_PENDING/BLOCKED` to
   `PASS-E2E` evidence. If the run is not green, preserve the exact failure
   and leave the gate open.

## Rollback

Revert only the E2E test, Compose, runner, workflow, or evidence changes from
this slice. No production database or user data is touched. If a production
behavior change becomes necessary, stop this slice and create a separate
design/test cycle with its own rollback and approval.

## Evidence and governance

The final evidence card must record the Actions run ID, commit SHA, runner
image, service health result, four journey names, total duration, artifact
links, cleanup result, and any known warnings. The semantic Graphify graph is
not regenerated with the known AST-only fallback; its refresh remains a
separate governance task.
