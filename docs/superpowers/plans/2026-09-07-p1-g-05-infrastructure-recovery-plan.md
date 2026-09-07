# P1-G-05 Infrastructure Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Redis and MinIO outage/recovery plus family object isolation on the real disposable Compose stack, while fixing only the file-route failure semantics demonstrated by focused tests.

**Architecture:** Keep the existing six-service `docker-compose.e2e.yml` as the system under test. A dependency-free Node 20 black-box runner drives public `/api` behavior and uses narrowly scoped `docker compose` commands only to stop/start Redis or MinIO and inspect their test data; a dedicated GitHub Actions workflow owns setup, diagnostics, and unconditional teardown. Production changes remain inside `backend/src/routes/files.ts` and reuse centralized family policy.

**Tech Stack:** TypeScript, Express, Jest/Supertest, Prisma, Node.js 20 Fetch/FormData, Docker Compose, Redis 7, MinIO, GitHub Actions.

## Global Constraints

- `familyId` remains the tenant boundary; authorization must run before file metadata queries, URL signing, upload, or deletion.
- `viewer` remains read-only; unauthenticated users return 401 and non-members return 403 with zero storage/file-row side effects.
- Do not change Prisma schema, route URLs, cache-key protocol, financial calculations, frontend behavior, or the successful file response shapes.
- Redis remains an optional cache: outage reads and writes use PostgreSQL, and post-recovery correctness comes from durable `Family.cacheVersion` rather than deleting old keys.
- MinIO failure returns retryable HTTP 503 with `code: STORAGE_UNAVAILABLE`; failed deletion retains the database row, and database-create failure after upload triggers best-effort object compensation.
- The real file lifecycle uses one file per request; multi-file distributed atomicity and a durable outbox are outside this gate.
- Use bounded polling with explicit deadlines; do not add arbitrary sleeps or weaken an assertion after a real failure.
- Only one GitHub-hosted run containing Redis recovery, MinIO recovery, the object-isolation matrix, and final cleanup may establish `PASS-REAL`.
- Do not replace the reviewed semantic graph with the currently available AST-only Graphify output; record semantic refresh as pending.

---

### Task 1: Lock the file-route failure and isolation contract in RED

**Files:**
- Modify: `backend/src/routes/files.test.ts`

**Interfaces:**
- Consumes: `POST /api/families/:familyId/files/upload`, `DELETE /api/families/:familyId/files/:id`, centralized family membership query, and mocked `uploadFileBuffer`, `getFileUrl`, `deleteFile`.
- Produces: focused regression names and zero-side-effect assertions used to constrain Task 2.

- [ ] **Step 1: Import and reset the MinIO mocks and centralized-policy fixture**

Add the MinIO imports after the Prisma import and make the default membership match `requireFamilyAccess`'s include shape:

```ts
import { prisma } from '../db/prisma';
import { deleteFile, getFileUrl, uploadFileBuffer } from '../config/minio';

const mockedPrisma = prisma as any;
const mockedUploadFileBuffer = uploadFileBuffer as jest.MockedFunction<typeof uploadFileBuffer>;
const mockedGetFileUrl = getFileUrl as jest.MockedFunction<typeof getFileUrl>;
const mockedDeleteFile = deleteFile as jest.MockedFunction<typeof deleteFile>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.familyMember.findUnique.mockResolvedValue({
    familyId: 'fam_1',
    userId: 'user_1',
    role: 'admin',
    family: { cacheVersion: 0 },
  });
  mockedPrisma.file.findMany.mockResolvedValue([]);
  mockedPrisma.file.findFirst.mockResolvedValue(null);
  mockedPrisma.file.create.mockResolvedValue({});
  mockedPrisma.file.delete.mockResolvedValue({});
  mockedUploadFileBuffer.mockResolvedValue('test-path');
  mockedGetFileUrl.mockResolvedValue('http://localhost:9000/test-url');
  mockedDeleteFile.mockResolvedValue(undefined);
});
```

Extend the Prisma file mock with `findFirst: jest.fn()` and remove `findUnique`, because family-scoped lookup is the Task 2 contract.

- [ ] **Step 2: Add authorization-order and malformed-request regressions**

Add tests that make membership return `null` and assert list/check-duplicates return 403 without `prisma.file.findMany` or `getFileUrl`, upload returns 403 without `uploadFileBuffer`/`prisma.file.create`, and delete returns 403 without `prisma.file.findFirst`/`deleteFile`/`prisma.file.delete`. Keep the existing no-file upload assertion as the malformed 400 contract, and add one unauthenticated list assertion for 401 before the membership query.

```ts
test('authorizes list before file metadata or URL signing', async () => {
  mockedPrisma.familyMember.findUnique.mockResolvedValue(null);
  const res = await request(app)
    .get('/api/families/fam_1/files')
    .set('Authorization', `Bearer ${createToken()}`);
  expect(res.status).toBe(403);
  expect(mockedPrisma.file.findMany).not.toHaveBeenCalled();
  expect(mockedGetFileUrl).not.toHaveBeenCalled();
});

test('authorizes upload before object or file-row work', async () => {
  mockedPrisma.familyMember.findUnique.mockResolvedValue(null);
  const res = await request(app)
    .post('/api/families/fam_1/files/upload')
    .set('Authorization', `Bearer ${createToken()}`)
    .attach('files', Buffer.from('blocked'), 'blocked.txt');
  expect(res.status).toBe(403);
  expect(mockedUploadFileBuffer).not.toHaveBeenCalled();
  expect(mockedPrisma.file.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Add storage-failure and compensation regressions**

Add these exact contracts:

```ts
test('returns retryable 503 when object upload fails', async () => {
  mockedUploadFileBuffer.mockRejectedValueOnce(new Error('MinIO unavailable'));
  const res = await request(app)
    .post('/api/families/fam_1/files/upload')
    .set('Authorization', `Bearer ${createToken()}`)
    .attach('files', Buffer.from('not stored'), 'failed.txt');
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
  expect(res.body.files).toBeUndefined();
  expect(mockedPrisma.file.create).not.toHaveBeenCalled();
});

test('compensates the object when database create fails', async () => {
  mockedPrisma.file.create.mockRejectedValueOnce(new Error('database unavailable'));
  const res = await request(app)
    .post('/api/families/fam_1/files/upload')
    .set('Authorization', `Bearer ${createToken()}`)
    .attach('files', Buffer.from('uploaded first'), 'compensate.txt');
  expect(res.status).toBe(500);
  const objectName = mockedUploadFileBuffer.mock.calls[0][0];
  expect(mockedDeleteFile).toHaveBeenCalledWith(objectName);
});

test('returns retryable 503 and preserves the row when object delete fails', async () => {
  mockedPrisma.file.findFirst.mockResolvedValue({
    id: 'f1', path: 'fam_1/test.txt', familyId: 'fam_1',
  });
  mockedDeleteFile.mockRejectedValueOnce(new Error('MinIO unavailable'));
  const res = await request(app)
    .delete('/api/families/fam_1/files/f1')
    .set('Authorization', `Bearer ${createToken()}`);
  expect(res.status).toBe(503);
  expect(res.body.code).toBe('STORAGE_UNAVAILABLE');
  expect(mockedPrisma.file.delete).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Add the cross-family object-ID regression**

Authorize the caller for family B, make `file.findFirst` return `null`, call `/api/families/fam_2/files/family-a-file`, and assert 404 plus no MinIO or database delete. Assert the lookup itself is tenant-scoped:

```ts
expect(mockedPrisma.file.findFirst).toHaveBeenCalledWith({
  where: { id: 'family-a-file', familyId: 'fam_2' },
});
expect(mockedDeleteFile).not.toHaveBeenCalled();
expect(mockedPrisma.file.delete).not.toHaveBeenCalled();
```

- [ ] **Step 5: Run the focused suite and record the intended RED**

Run from `backend/`:

```powershell
npm test -- src/routes/files.test.ts --runInBand
```

Expected: the suite fails because upload currently returns 201 after MinIO rejection, delete currently returns 200 and deletes the row after MinIO rejection, database-create failure does not compensate, and delete still calls `findUnique` rather than a family-scoped `findFirst`. Authorization-order tests may already pass and remain guardrails.

- [ ] **Step 6: Commit the RED contract**

```powershell
git add backend/src/routes/files.test.ts
git commit -m "test: define file storage recovery contract"
```

---

### Task 2: Apply the minimum file-route production fix

**Files:**
- Modify: `backend/src/routes/files.ts`
- Test: `backend/src/routes/files.test.ts`

**Interfaces:**
- Consumes: `requireFamilyAccess`, `requireFamilyWriteAccess`, Prisma `file.findFirst`, and the Task 1 response assertions.
- Produces: all file routes authorized centrally, `STORAGE_UNAVAILABLE` 503 responses, family-scoped delete lookup, and best-effort upload compensation.

- [ ] **Step 1: Centralize authorization on every file route**

Import `requireFamilyAccess` and remove `checkFamilyAccess`. Apply these exact declaration replacements, then delete each handler's `membership` query and its adjacent 403 branch:

```ts
import { requireFamilyAccess, requireFamilyWriteAccess } from '../middleware/familyAccess';

// before: router.get('/', authMiddleware, async (req: AuthRequest, res) => {
router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {

// before: router.post('/upload', authMiddleware, requireFamilyWriteAccess, upload.array('files', 10), ...)
router.post('/upload', authMiddleware, requireFamilyWriteAccess, upload.array('files', 10), async (req: AuthRequest, res) => {

// before: router.delete('/:id', authMiddleware, createFamilyWriteAccess('无权删除文件'), ...)
router.delete('/:id', authMiddleware, requireFamilyWriteAccess, async (req: AuthRequest, res) => {

// before: router.get('/check-duplicates', authMiddleware, async (req: AuthRequest, res) => {
router.get('/check-duplicates', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res) => {
```

- [ ] **Step 2: Return one stable retryable storage error**

Add a local helper above the routes:

```ts
const sendStorageUnavailable = (res: any) => res.status(503).json({
  error: '对象存储暂时不可用，请稍后重试',
  code: 'STORAGE_UNAVAILABLE',
});
```

In the upload storage catch, log the error and `return sendStorageUnavailable(res)` instead of `continue`. This prevents `201` with an empty file list.

- [ ] **Step 3: Compensate an object whose database row cannot be created**

Wrap `prisma.file.create` only after `uploadFileBuffer` succeeds:

```ts
let dbFile;
try {
  dbFile = await prisma.file.create({
    data: {
      name: file.originalname,
      path: filename,
      type: file.mimetype,
      size: file.size,
      mimeType: file.mimetype,
      phash,
      familyId,
      userId: req.userId!,
    },
  });
} catch (error) {
  try {
    await deleteFile(filename);
  } catch (compensationError) {
    console.error('Error compensating uploaded MinIO object:', compensationError);
  }
  throw error;
}
uploadedFiles.push(dbFile);
```

Do not convert the database error to 503; the existing outer handler keeps it as 500 after compensation.

- [ ] **Step 4: Scope delete lookup and preserve metadata on storage failure**

Replace the lookup and failure flow with:

```ts
const file = await prisma.file.findFirst({ where: { id, familyId } });
if (!file) return res.status(404).json({ error: '文件不存在' });

try {
  await deleteFile(file.path);
} catch (error) {
  console.error('Error deleting file from MinIO:', error);
  return sendStorageUnavailable(res);
}

await prisma.file.delete({ where: { id } });
return res.json({ message: '删除成功' });
```

- [ ] **Step 5: Run focused GREEN and relevant permission regressions**

Run from `backend/`:

```powershell
npm test -- src/routes/files.test.ts src/tests/family-permissions.test.ts src/tests/roleMethodMatrix.integration.test.ts --runInBand
```

Expected: all selected suites pass; the integration-named role matrix may report its documented skip when `RUN_INTEGRATION` is absent, but no selected test fails.

- [ ] **Step 6: Build and commit the production fix**

```powershell
npm run build
git add backend/src/routes/files.ts
git commit -m "fix: preserve file metadata during storage outages"
```

Expected: TypeScript build exits 0.

---

### Task 3: Build the dependency-free black-box recovery runner

**Files:**
- Create: `e2e/infra-recovery/run.mjs`

**Interfaces:**
- Consumes: `E2E_BASE_URL` (default `http://127.0.0.1:4173/api`), Node 20 `fetch`/`FormData`/`Blob`, and `docker compose -p homefinance-e2e -f docker-compose.e2e.yml`.
- Produces: `--list` discovery, named checkpoints, bounded HTTP/recovery polling, non-zero assertion failures, Redis key persistence/recovery proof, and MinIO lifecycle/isolation proof.

- [ ] **Step 1: Add process, assertion, HTTP, and polling primitives**

The runner must define these exact interfaces:

```js
const API_BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173/api';
const COMPOSE = ['compose', '-p', 'homefinance-e2e', '-f', 'docker-compose.e2e.yml'];
const CHECKPOINTS = [
  'identity-and-family-setup',
  'redis-miss-hit-and-persisted-stale-key',
  'redis-outage-authorized-fresh-read-write',
  'redis-recovery-miss-hit-without-backend-restart',
  'minio-object-isolation-matrix',
  'minio-outage-preserves-file-row',
  'minio-recovery-and-second-lifecycle',
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function runDocker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', [...COMPOSE, ...args], {
    cwd: repositoryDirectory,
    encoding: 'utf8',
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw result.error ?? new Error(result.stderr || `docker exited ${result.status}`);
  }
  return result;
}

async function poll(label, operation, accept, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await operation();
      if (accept(last)) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out: ${String(last)}`);
}
```

Each `fetch` uses `AbortSignal.timeout(15_000)`, parses JSON/text once, and checks the exact expected status. The multipart helper creates a fresh `FormData`, appends one deterministic `Blob` under `files`, and returns the parsed API body.

- [ ] **Step 2: Implement identity and family setup**

Register unique admin A, viewer, and admin B users; create family A with admin A and family B with admin B; invite the viewer to family A through `POST /families/:id/invite` with `{ role: 'viewer' }`. Store all bearer tokens and IDs from the responses. Use a run suffix derived from `Date.now()` so reruns cannot collide.

- [ ] **Step 3: Implement Redis MISS/HIT, outage freshness, and recovery**

Create income 100 CNY with an `Idempotency-Key`, read `/families/:id/reports/income-statement` until the observed sequence contains `MISS` then `HIT`, and assert `totalIncome === 100`, `netIncome === 100`, and `reconciliationStatus === 'passed'`. Discover the exact old key with:

```js
runDocker(['exec', '-T', 'redis', 'redis-cli', '--raw', '--scan', '--pattern',
  `cache:family:v2:${familyA.id}:v*:*income-statement*`]);
runDocker(['exec', '-T', 'redis', 'redis-cli', 'SAVE']);
runDocker(['stop', 'redis']);
```

While Redis is stopped, assert unauthenticated report 401, admin B report 403, admin A report 200/100, a second idempotent income create for 25 returns 201, and the next report is 200/125 with passed reconciliation. Restart Redis, poll `redis-cli ping` until `PONG`, assert the exact old key still exists, then poll reports until the first new-version `MISS` and following `HIT`; every 200 body observed after the write must remain 125 and must never regress to 100.

- [ ] **Step 4: Implement MinIO object inspection and isolation matrix**

Use `docker compose exec -T backend node -e <script> <objectPath>` and the backend container's installed `minio` package to `statObject` in `homefinance-e2e`. Return JSON `{ exists, size }`, treating only `NoSuchKey`/`NotFound` as `exists: false`; propagate all other errors.

Upload one deterministic admin-A file and assert 201, one returned row, `path.startsWith(`${familyA.id}/`)`, and exact MinIO size. List family A and require that row plus a non-empty signed URL. Then execute the matrix:

```text
unauthenticated: family A list/upload/delete => 401
admin B non-member: family A list/upload/delete => 403
viewer: family A list => 200; upload/delete => 403
admin B on family B route with family A file ID => 404
family B list => 200 and contains neither family A row nor family A URL/path
```

After every mutation denial, assert family A's row is still listed and direct MinIO stat still reports the original object and size.

- [ ] **Step 5: Implement MinIO outage and post-recovery lifecycle**

Stop MinIO. Upload one new file as admin A and require 503 with `code === 'STORAGE_UNAVAILABLE'`, no `files` property, and no new row in the next list. Delete the original file and require the same 503, then assert its row remains. Start MinIO and poll its Compose health by running the container's health command until success. Assert the original object and row still exist; retry delete and require 200, row absence, and `exists: false`. Finally upload a new file, stat it, delete it, and assert both row and object are absent.

- [ ] **Step 6: Add discovery mode and checkpoint output**

When `process.argv.includes('--list')`, print every `CHECKPOINTS` value and exit without HTTP or Docker. During a real run, print `PASS <checkpoint> (<milliseconds>ms)` only after all assertions in that checkpoint succeed. On failure, print `FAIL <message>` and set `process.exitCode = 1`.

- [ ] **Step 7: Validate runner syntax and discovery, then commit**

Run from the repository root:

```powershell
node --check e2e/infra-recovery/run.mjs
node e2e/infra-recovery/run.mjs --list
```

Expected: syntax check exits 0 and discovery prints exactly seven checkpoint names without requiring Docker.

```powershell
git add e2e/infra-recovery/run.mjs
git commit -m "test: add infrastructure recovery runner"
```

---

### Task 4: Add the dedicated GitHub Actions recovery workflow

**Files:**
- Create: `.github/workflows/infra-recovery.yml`

**Interfaces:**
- Consumes: `docker-compose.e2e.yml` and `e2e/infra-recovery/run.mjs`.
- Produces: a read-only, disposable `ubuntu-latest` job with failure diagnostics and unconditional volume cleanup.

- [ ] **Step 1: Create the workflow**

Use this workflow shape:

```yaml
name: Infrastructure Recovery

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: infra-recovery-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  compose-recovery:
    name: Redis and MinIO recovery against Compose
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Check out repository
        uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Start disposable Compose stack
        run: docker compose -p homefinance-e2e -f docker-compose.e2e.yml up --build --detach --wait
      - name: Run infrastructure recovery suite
        env:
          E2E_BASE_URL: http://127.0.0.1:4173/api
        run: node e2e/infra-recovery/run.mjs
      - name: Dump Compose diagnostics on failure
        if: failure()
        run: |
          docker compose -p homefinance-e2e -f docker-compose.e2e.yml ps || true
          docker compose -p homefinance-e2e -f docker-compose.e2e.yml logs --no-color backend redis minio || true
      - name: Tear down recovery stack
        if: always()
        run: docker compose -p homefinance-e2e -f docker-compose.e2e.yml down --volumes --remove-orphans
```

- [ ] **Step 2: Parse the workflow and verify mandatory safety clauses**

Parse the workflow with Ruby's YAML parser and then search for the mandatory clauses:

```powershell
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/infra-recovery.yml', aliases: true); puts 'workflow yaml ok'"
rg -n "contents: read|if: always\(\)|down --volumes --remove-orphans|ubuntu-latest" .github/workflows/infra-recovery.yml
```

Expected: parse exits 0 and all four safety clauses are present.

- [ ] **Step 3: Commit the workflow**

```powershell
git add .github/workflows/infra-recovery.yml
git commit -m "ci: exercise Redis and MinIO recovery"
```

---

### Task 5: Run all local quality gates before remote execution

**Files:**
- Verify: `backend/`, `frontend/`, `.github/workflows/infra-recovery.yml`, `e2e/infra-recovery/run.mjs`

**Interfaces:**
- Consumes: the production fix and both test harness files.
- Produces: reproducible local regression evidence and an explicit record that local Windows lacks Docker rather than a false real-infrastructure claim.

- [ ] **Step 1: Run backend build and full coverage**

```powershell
Push-Location backend
npm run build
npm test -- --runInBand --coverage
Pop-Location
```

Expected: build exits 0, all default Jest suites pass, and global statements/branches/functions/lines remain at or above 60%.

- [ ] **Step 2: Run Prisma validation and formatting check with a non-production URL**

```powershell
Push-Location backend
$env:DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/homefinance_validation?schema=public'
npx prisma validate
npx prisma format --check
Remove-Item Env:DATABASE_URL
Pop-Location
```

Expected: validation exits 0. If format check still reports the already-recorded baseline schema formatting failure and `git diff -- backend/prisma/schema.prisma` is empty, record it as pre-existing; do not format an unrelated schema in this gate.

- [ ] **Step 3: Run frontend non-behavior gates**

```powershell
Push-Location frontend
npm run lint
npm run build
npx playwright test --list
Pop-Location
```

Expected: lint/build exit 0 and Playwright still discovers four P1-G-04 journeys. The existing >500 kB chunk warning may remain but no new warning is introduced by this backend/test-only change.

- [ ] **Step 4: Record local Docker availability without claiming PASS-REAL**

```powershell
docker --version
```

Expected on the current Windows host: command unavailable. This is an environment fact; the authoritative P1-G-05 execution remains GitHub Actions.

- [ ] **Step 5: Confirm only intended files changed**

```powershell
git status --short
git diff --check
git log --oneline e95205a..HEAD
```

Expected: no generated artifacts, schema changes, frontend changes, or P1-G-04 artifact directories are added; whitespace check passes.

---

### Task 6: Execute and iterate on the real GitHub-hosted gate

**Files:**
- Modify only when evidenced by a failed checkpoint: `backend/src/routes/files.ts`, `backend/src/routes/files.test.ts`, `e2e/infra-recovery/run.mjs`, `.github/workflows/infra-recovery.yml`

**Interfaces:**
- Consumes: pushed branch `codex/p1-g05-infra-recovery` and the pull-request/manual workflow trigger.
- Produces: one exact green run ID/SHA with checkpoint timings and successful teardown, or an exact RED checkpoint/log that drives a focused TDD fix.

- [ ] **Step 1: Push the implementation branch**

```powershell
git push origin codex/p1-g05-infra-recovery
```

- [ ] **Step 2: Trigger the workflow from the branch**

If a pull request for the branch already exists, use its `pull_request` run. If the workflow is not yet present on the default branch and therefore cannot be manually dispatched, create a draft pull request targeting `main` so GitHub executes the new workflow file:

```powershell
gh pr create --draft --base main --head codex/p1-g05-infra-recovery --title "P1-G-05 infrastructure recovery evidence" --body "Implements the approved Redis/MinIO outage-recovery and object-isolation gate."
gh run list --workflow infra-recovery.yml --branch codex/p1-g05-infra-recovery --limit 5
```

If the workflow is already registered on the default branch, dispatch it directly instead:

```powershell
gh workflow run infra-recovery.yml --ref codex/p1-g05-infra-recovery
```

- [ ] **Step 3: Watch the exact run and collect evidence**

```powershell
$recoveryRunId = gh run list --workflow infra-recovery.yml --branch codex/p1-g05-infra-recovery --limit 1 --json databaseId --jq '.[0].databaseId'
if (-not $recoveryRunId) { throw 'No infrastructure recovery run found' }
gh run watch $recoveryRunId --exit-status
gh run view $recoveryRunId --log
```

Expected green log: all seven `PASS` checkpoint lines, Compose startup success, and the final teardown step succeeds. Record runner OS/image from the run setup log rather than assuming its patch version.

- [ ] **Step 4: Iterate only from observed RED evidence**

For a failure, capture the first failed named checkpoint and relevant backend/Redis/MinIO logs. Write or strengthen a focused local test when production behavior is wrong, observe RED, make the minimum fix, rerun Task 5 gates, commit with a precise message, push, and rerun. If the harness expectation is wrong, correct the runner without weakening tenant, side-effect, stale-value, status, or cleanup assertions.

- [ ] **Step 5: Verify cleanup independently**

Inspect the Actions teardown log and require removal of the recovery containers, `postgres_e2e_data`, `minio_e2e_data`, and Compose network. A green runner with failed/skipped cleanup is not `PASS-REAL`.

---

### Task 7: Record P1-G-05 evidence and remaining gates

**Files:**
- Modify: `docs/delivery/phase-1/evidence/P1-G-05.md`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md`
- Modify: `docs/project-memory.md`

**Interfaces:**
- Consumes: exact final commit SHA, Actions run ID/URL, runner image, seven checkpoint timings, regressions, and teardown result.
- Produces: evidence status `PASS-REAL`, tracker closure facts, and durable project-memory facts while leaving P1-H-03/P1-H-04 and semantic Graphify refresh open.

- [ ] **Step 1: Replace stale blocked evidence with the observed run**

Record baseline `fa43c16`, branch/final SHA, focused RED failure messages, focused GREEN command, backend coverage numbers, Prisma/frontend results, the exact Actions URL, each Redis/MinIO/isolation checkpoint, and cleanup. State explicitly that no production data or staging environment was used and that multi-file distributed atomicity remains outside this gate.

- [ ] **Step 2: Update tracker state without over-claiming release**

Change only P1-G-05's evidence facts/state supported by the run. Keep P1-H-03 blocked on staging/restore/release observation and keep P1-H-04 open. Do not turn a disposable Compose pass into `RELEASED` or `OBSERVED`.

- [ ] **Step 3: Update project memory and Graphify status**

Add a dated fact stating centralized file policy, 503 outage semantics, compensation behavior, Redis stale-key recovery, object isolation, exact run/SHA, and full cleanup. State that semantic Graphify refresh remains pending because only the AST-only replacement workflow is available; do not run it.

- [ ] **Step 4: Cross-check documentation and commit**

```powershell
rg -n "P1-G-05|PASS-REAL|P1-H-03|P1-H-04|Graphify" docs/delivery/phase-1/evidence/P1-G-05.md docs/delivery/phase-1/phase-1-tracker.md docs/project-memory.md
git diff --check
git add docs/delivery/phase-1/evidence/P1-G-05.md docs/delivery/phase-1/phase-1-tracker.md docs/project-memory.md
git commit -m "docs: record P1-G-05 recovery evidence"
git push origin codex/p1-g05-infra-recovery
```

Expected: the three sources agree on run/SHA/state, P1-H-03/P1-H-04 remain open, and the branch is pushed cleanly.
