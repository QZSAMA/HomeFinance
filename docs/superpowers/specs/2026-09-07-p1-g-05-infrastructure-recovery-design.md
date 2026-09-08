# P1-G-05 Infrastructure Recovery and Object Isolation Design

## Context

P1-G-04 proved the normal six-service Docker Compose path on GitHub Actions:
PostgreSQL, Redis, MinIO, deterministic mock-AI, backend, and frontend became
healthy and all four Chromium journeys passed. P1-G-05 is a different gate. It
must prove what happens when Redis or MinIO becomes unavailable after startup,
that the services recover without stale or cross-family data exposure, and that
the disposable environment is always cleaned up.

The local Windows host has no Docker CLI. The authoritative execution target is
a dedicated GitHub-hosted `ubuntu-latest` workflow. Local unit, static, build,
and discovery checks remain useful but cannot produce the real-infrastructure
evidence for this gate.

## Goals

1. Prove report reads remain authorized and financially fresh while Redis is
   unavailable.
2. Prove an old cache entry cannot be served after a database mutation made
   while Redis is down, even when that old entry is deliberately restored.
3. Prove the Redis client resumes cache use after Redis returns, without
   restarting the backend.
4. Prove MinIO upload, metadata listing, content existence, deletion, outage,
   and recovery behavior against the real service.
5. Prove non-members, viewers, and cross-family resource IDs cannot cause an
   object-storage read, write, URL-signing, or delete operation outside their
   allowed family.
6. Replace false-success or destructive failure behavior only when a focused
   RED demonstrates it, preserving existing successful API responses.

## Non-goals

- No production deployment, staging observation, backup restore, or migration
  rollback rehearsal; those remain P1-H-03.
- No Redis cluster, Sentinel, replication, eviction-load, or performance test.
- No MinIO replication, versioning, lifecycle-retention policy, malware scan,
  or public CDN design.
- No historical valuation/FX work and no changes to financial calculations.
- No claim that a test-only Compose workflow is production availability proof.
- No AST-only Graphify replacement of the reviewed semantic graph.

## Considered approaches

### A. Dedicated black-box recovery workflow (selected)

Add a small Node.js recovery runner and a dedicated GitHub Actions workflow.
The runner uses the public same-origin `/api` surface for application behavior
and Docker Compose commands only for fault injection and storage inspection.
It stops and starts Redis/MinIO without restarting the backend, asserts each
failure/recovery transition, and leaves teardown to an `if: always()` workflow
step.

This keeps P1-G-04's browser suite stable, makes infrastructure failures easy to
classify, and exercises real authorization, PostgreSQL, Redis, MinIO, and HTTP
paths with no production credentials.

### B. Extend the Playwright suite

Playwright could trigger service failures through an auxiliary controller, but
the browser would be coupled to privileged Docker operations and failures would
mix UI state with infrastructure state. This provides weaker diagnostics and is
not selected.

### C. Mock-only backend tests

Mock tests remain valuable for focused RED/GREEN cycles, but cannot prove Redis
reconnection, persisted stale keys, MinIO object existence, or Compose cleanup.
They are necessary regression tests, not gate evidence.

## Architecture

### Recovery runner

Create `e2e/infra-recovery/run.mjs` as a dependency-free Node 20 script. It owns
test identities and API assertions but does not own final stack cleanup. Its
interfaces are:

- HTTP through `E2E_BASE_URL`, defaulting to `http://127.0.0.1:4173/api`;
- `docker compose -p homefinance-e2e -f docker-compose.e2e.yml` for controlled
  `stop`, `start`, `exec`, and health inspection;
- MinIO object inspection through the already installed `minio` package inside
  the backend container, using the exact object path returned by the API;
- Redis key inspection through `redis-cli` inside the Redis container.

Every assertion prints a short named checkpoint. A failed command or assertion
exits non-zero. The runner uses bounded polling with explicit deadlines for
service recovery; it does not use arbitrary fixed sleeps.

### Workflow

Create `.github/workflows/infra-recovery.yml` as a separate manual and
pull-request workflow. It will:

1. check out the requested commit;
2. start the existing disposable Compose stack with `--build --detach --wait`;
3. run `node e2e/infra-recovery/run.mjs`;
4. print Compose status plus backend/Redis/MinIO logs on failure;
5. always run `down --volumes --remove-orphans`.

The workflow has `contents: read`, uses no secrets, and never targets production
hosts or volumes.

## Redis scenario and acceptance

1. Register an administrator, create one family, and create a known income.
2. Read the income statement twice and require `X-Cache: MISS` followed by
   `X-Cache: HIT`, with the expected totals on both responses.
3. Force Redis to persist the old versioned cache key, then stop Redis.
4. Read the report while Redis is down. It must return HTTP 200 from PostgreSQL,
   retain correct reconciliation, and must not bypass family authorization.
5. Create a second income while Redis is down. The write and durable
   `Family.cacheVersion` advancement must succeed.
6. Read again while Redis is down and require the new total, proving Redis is
   not an availability or authorization boundary.
7. Start Redis and wait until it is healthy. Confirm the deliberately persisted
   old cache key is present.
8. Poll the report until the backend reconnects. The first new-version response
   must be fresh and not equal to the stale total; the following response must
   become `X-Cache: HIT` with the same fresh total.

The Redis recovery test does not require deleting old versioned keys. Correctness
comes from the family/version key; TTL bounds obsolete cache memory. Redis
authentication and network exposure are production deployment concerns and stay
outside this disposable test topology.

## MinIO lifecycle and outage semantics

The real scenario uses one file per request so each observed operation has a
single object and database record.

1. Upload a small deterministic file as a family administrator and require HTTP
   201 with one `File` record whose path begins with `<familyId>/`.
2. Inspect MinIO from the backend network and require that exact object and byte
   size to exist.
3. List family files and require the database record plus a signed URL.
4. Stop MinIO without stopping the backend.
5. A new upload must not report success. It returns retryable HTTP 503 with code
   `STORAGE_UNAVAILABLE`, creates no `File` record, and exposes no object path.
6. Listing existing metadata may remain HTTP 200 because PostgreSQL is still
   available. A signed URL is not treated as proof that content is available
   during the outage.
7. Deleting an existing file while MinIO is down must return retryable HTTP 503
   and retain the database record. The system must not discard the only durable
   reference to an object that it failed to delete.
8. Start MinIO and wait for health. The original object and database record must
   still exist.
9. Retry deletion. It must remove the object and then the database record; a
   following list must not contain the file.
10. Perform one new upload after recovery and verify the complete lifecycle once
    more, proving recovery without a backend restart.

For successful object upload followed by database-create failure, the route
attempts compensating object deletion and returns an error; a focused mock test
protects this path. A durable cross-system outbox and multi-file atomic batch
protocol are not introduced in this gate and remain a separately reviewable
storage-architecture enhancement if compensation failure is later observed.

## Authorization and object isolation

The file routes must use the centralized family policy before any Prisma file
query, MinIO upload, signed-URL generation, or deletion. The route-local
`checkFamilyAccess` copy is removed.

The real matrix asserts:

- unauthenticated requests receive 401;
- a non-member receives 403 for list, upload, and delete attempts;
- a viewer may list family metadata but receives 403 for upload and delete;
- an administrator of family B using family B's authorized route with a family
  A file ID receives 404, and the family A object and record remain unchanged;
- family B listings never include family A metadata or signed URLs;
- uploaded object names are prefixed by the authorized route family ID, never a
  client-provided family or user value.

Negative assertions include unchanged file lists and direct MinIO object
existence checks, so an HTTP status alone is not treated as proof of zero side
effects.

## Minimal production behavior changes

Production code changes are allowed only for failures demonstrated by focused
tests or the real runner:

- use centralized `requireFamilyAccess` / `requireFamilyWriteAccess` before the
  file handler and remove duplicate membership reads;
- map complete MinIO upload failure to HTTP 503
  `STORAGE_UNAVAILABLE` instead of `201 成功上传 0 个文件`;
- if MinIO deletion fails, return the same retryable 503 and keep the File row;
- after an uploaded object cannot be recorded in PostgreSQL, attempt immediate
  object compensation before returning an error;
- preserve successful upload 201, list 200, delete 200, response fields, 10 MiB
  limit, pHash behavior, and viewer read-only semantics.

No Prisma schema, route URL, financial service, cache-key protocol, or frontend
page behavior changes in this design.

## Testing strategy

1. Add focused Jest route tests first and observe RED for false upload success,
   destructive delete-on-MinIO-failure, centralized authorization ordering, and
   cross-family object ID isolation.
2. Make the minimum route changes and rerun the focused suite.
3. Run backend build and the full required coverage suite; do not lower the 60%
   global threshold.
4. Validate workflow/Compose YAML and statically execute the runner's discovery
   or syntax check locally. Record local Docker unavailability without claiming
   infrastructure success.
5. Push the isolated branch and dispatch the dedicated workflow. Preserve the
   exact failed checkpoint and logs on RED; fix only the evidenced defect.
6. Mark P1-G-05 `PASS-REAL` only when Redis outage/recovery, MinIO
   outage/recovery, the real authorization matrix, object side-effect checks,
   and final cleanup pass in one GitHub-hosted run.

## Evidence and remaining gates

On success, update `docs/delivery/phase-1/evidence/P1-G-05.md`, the Phase 1
tracker, and `docs/project-memory.md` with the run URL, commit SHA, runner image,
checkpoint results, recovery timings, and cleanup result. P1-H-03 and P1-H-04
remain blocked or open until staging, restore, release, rollback, and observation
criteria are separately satisfied. Semantic Graphify refresh remains pending
while only the AST-only replacement runner is available.
