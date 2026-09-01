# Asset CRUD Transactional Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Move ordinary Asset HTTP create, update, and delete mutations onto the shared family-authorized, idempotent, audited PostgreSQL transaction boundary with optimistic version checks.

**Architecture:** Keep Asset as an independent balance model. Add an additive `Asset.version` column, extend the existing `LedgerTransactionClient` with family-scoped Asset reads and conditional writes, and expose `createAsset`, `updateAsset`, and `deleteAsset` application functions that all delegate to `coordinateFinancialMutation`. The route remains a thin HTTP adapter; list and allocation remain read-only paths using centralized family authorization.

**Tech Stack:** TypeScript, Express, Prisma, PostgreSQL, Jest, Supertest, ts-jest.

## Global Constraints

- `familyId` is the tenant boundary; authorization occurs before idempotency lookup, Asset read, or Asset write.
- `viewer`, unknown roles, non-members, and unauthenticated callers cannot mutate Assets.
- Asset mutations are atomic, idempotent, auditable, and replayable through the existing coordinator.
- Update and delete predicates include `id`, `familyId`, and `version`; stale writes return `VERSION_CONFLICT`.
- The migration is additive and backfills existing Asset rows to version `1` through the database default.
- Existing Asset URLs and Chinese error/message fields remain compatible; enriched mutation responses add `version`, `operationId`, and `deduplicated`.
- No Liability CRUD, valuation, currency conversion, Redis/MinIO behavior, or browser E2E work is included in this slice.
- Every production behavior edit follows RED → GREEN → REFACTOR and keeps the existing quality gates visible.

---

### Task 1: Freeze the Asset application-service contract with RED tests

**Files:**
- Modify: `backend/src/services/balanceMutationService.test.ts`
- Modify: `backend/src/services/ledgerTypes.ts`

**Interfaces:**
- `createAsset(command: CreateAssetCommand, store: FinancialMutationStore): Promise<MutationResult<LedgerRecord>>`
- `updateAsset(command: UpdateAssetCommand, store: FinancialMutationStore): Promise<MutationResult<LedgerRecord>>`
- `deleteAsset(command: DeleteAssetCommand, store: FinancialMutationStore): Promise<MutationResult<LedgerRecord>>`
- `UpdateAssetCommand` adds `assetId` and optional positive `expectedVersion` to `CreateAssetCommand`.
- `DeleteAssetCommand` contains `familyId`, `actorId`, `source`, `idempotencyKey`, `assetId`, and optional positive `expectedVersion`.

- [ ] **Step 1: Write the failing service tests**

  Import the three application functions and add a transaction-backed in-memory test store with one versioned Asset, an idempotency map, and audit capture. Assert that create, update, and delete use the family-scoped transaction methods; update increments version from `1` to `2`; delete returns the deleted version; and negative value, invalid currency, missing Asset, and stale conditional write produce the stable domain errors without audit writes.

- [ ] **Step 2: Run the focused RED command**

  ```powershell
  cd backend
  npm test -- --runInBand src/services/balanceMutationService.test.ts
  ```

  Expected: FAIL because the application functions and version-aware Asset transaction methods are not yet exported.

- [ ] **Step 3: Commit the RED contract only**

  ```powershell
  git add backend/src/services/balanceMutationService.test.ts backend/src/services/ledgerTypes.ts
  git commit -m "test: define transactional asset mutation contract"
  ```

### Task 2: Add Asset version persistence and transaction adapter methods

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260901100000_add_asset_version/migration.sql`
- Modify: `backend/src/services/ledgerTypes.ts`
- Modify: `backend/src/services/prismaFinancialMutationStore.ts`
- Test: `backend/src/services/prismaFinancialMutationStore.test.ts`

**Interfaces:**
- `LedgerTransactionClient.asset.findFirst({ where: { id, familyId } })` returns a numeric `LedgerRecord` or `null`.
- `LedgerTransactionClient.asset.updateMany({ where: { id, familyId, version }, data })` returns `{ count }`.
- `LedgerTransactionClient.asset.deleteMany({ where: { id, familyId, version } })` returns `{ count }`.
- `LedgerTransactionClient.asset.create` accepts the existing Asset fields and returns `version`.

- [ ] **Step 1: Add the adapter RED assertion**

  Extend the existing Prisma adapter test fixture with a versioned Asset. Assert that `findFirst` converts Decimal `value` and `costBasis` to numbers, `updateMany` forwards the family/version predicate and increment data, and `deleteMany` forwards the same predicate. Run the focused adapter test and record the missing-method failure.

- [ ] **Step 2: Add the additive schema/migration contract**

  Add `version Int @default(1)` to `Asset`. Create migration SQL:

  ```sql
  ALTER TABLE "Asset" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
  ```

  Do not drop or rewrite existing Asset rows. Validate and format the schema against the non-production database.

- [ ] **Step 3: Implement the narrow adapter methods**

  Add the typed Asset methods to `ledgerTypes.ts`; map all Asset Decimal fields through `toAssetRecord`; call `tx.asset.findFirst`, `tx.asset.updateMany`, and `tx.asset.deleteMany` without exposing root-level Asset access through `FinancialMutationStore`.

- [ ] **Step 4: Run focused GREEN verification**

  ```powershell
  cd backend
  npx prisma generate
  npm test -- --runInBand src/services/prismaFinancialMutationStore.test.ts src/services/balanceMutationService.test.ts
  npx prisma validate
  npx prisma format --check
  ```

  Expected: adapter assertions pass; service tests remain RED until Task 3 supplies the application functions.

- [ ] **Step 5: Commit the persistence/adapter slice**

  ```powershell
  git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/services/ledgerTypes.ts backend/src/services/prismaFinancialMutationStore.ts backend/src/services/prismaFinancialMutationStore.test.ts
  git commit -m "feat: add versioned asset transaction adapter"
  ```

### Task 3: Implement the Asset application service GREEN and refactor

**Files:**
- Modify: `backend/src/services/balanceMutationService.ts`
- Modify: `backend/src/services/balanceMutationService.test.ts`
- Modify: `backend/src/services/ledgerTypes.ts`
- Modify: `backend/src/services/prismaFinancialMutationStore.ts`

**Interfaces:**
- Create uses operation `CREATE_ASSET` and audit entity `Asset`.
- Update uses operation `UPDATE_ASSET`, reads only `{ id, familyId }`, then conditionally updates with `{ id, familyId, version }` and `version: { increment: 1 }`.
- Delete uses operation `DELETE_ASSET`, records the before snapshot, then conditionally deletes with `{ id, familyId, version }`.
- Missing family-scoped records return `RESOURCE_NOT_FOUND`; zero conditional writes return `VERSION_CONFLICT`.

- [ ] **Step 1: Implement the minimum coordinator-backed functions**

  Reuse the existing Balance field validators and normalize the request payload before hashing. `createAsset` calls `coordinateFinancialMutation` with HTTP status `201`; update/delete call it with default `200`. Each executor writes only through the supplied transaction and returns `resourceId`, `record`, `version`, and `before` where applicable.

- [ ] **Step 2: Run the focused GREEN command**

  ```powershell
  cd backend
  npm test -- --runInBand src/services/balanceMutationService.test.ts src/services/prismaFinancialMutationStore.test.ts
  ```

  Expected: all Asset service and adapter tests pass, including replay, authorization-before-idempotency, missing resource, stale version, invalid amount/currency, and audit ordering assertions.

- [ ] **Step 3: Refactor only while green**

  Extract shared Asset command normalization and conditional-write helpers only if they remove duplication without changing the public command/result contract. Re-run the same focused command after each refactor.

- [ ] **Step 4: Commit the service slice**

  ```powershell
  git add backend/src/services/balanceMutationService.ts backend/src/services/balanceMutationService.test.ts backend/src/services/ledgerTypes.ts backend/src/services/prismaFinancialMutationStore.ts
  git commit -m "feat: add transactional asset application service"
  ```

### Task 4: Migrate the Asset HTTP route adapter

**Files:**
- Modify: `backend/src/routes/assets.ts`
- Modify: `backend/src/routes/assets.test.ts`
- Modify: `backend/src/app.test.ts` only if route dependency wiring requires it

**Interfaces:**
- GET `/api/families/:familyId/assets` and `/allocation` use `requireFamilyAccess` before reads.
- POST `/api/families/:familyId/assets` calls `createAsset` with `MANUAL` and `Idempotency-Key`.
- PUT `/api/families/:familyId/assets/:id` calls `updateAsset` with parsed `If-Match`.
- DELETE `/api/families/:familyId/assets/:id` calls `deleteAsset` with parsed `If-Match`.
- Mutation responses use `mutationResource`, `mutationDeleteResponse`, `markIdempotencyReplay`, and `sendLedgerMutationError`.

- [ ] **Step 1: Write route RED assertions**

  Replace direct-write expectations with tests proving route calls the application service, never calls `asset.create/update/delete` directly, emits `Idempotency-Replayed` on replay, forwards `If-Match` including weak/quoted values, and returns `VERSION_CONFLICT` without a direct write. Add unauthenticated, non-member, viewer, unknown-role, malformed-body, and cross-family negative cases with zero application-service/direct-write side effects.

- [ ] **Step 2: Run route RED**

  ```powershell
  cd backend
  npm test -- --runInBand src/routes/assets.test.ts
  ```

  Expected: FAIL because the route still performs the legacy direct Prisma writes and local membership lookup.

- [ ] **Step 3: Implement the thin route adapter**

  Import `requireFamilyAccess`, `requireFamilyWriteAccess`, the Asset application functions, the Prisma mutation store, and shared route response helpers. Remove `checkFamilyAccess` and all mutation calls to root Prisma. Keep list ordering, pagination, allocation buckets, and compatible Chinese validation messages.

- [ ] **Step 4: Run focused route and service GREEN verification**

  ```powershell
  npm test -- --runInBand src/routes/assets.test.ts src/services/balanceMutationService.test.ts src/services/prismaFinancialMutationStore.test.ts
  ```

- [ ] **Step 5: Commit route adoption**

  ```powershell
  git add backend/src/routes/assets.ts backend/src/routes/assets.test.ts backend/src/app.test.ts
  git commit -m "feat: adopt transactional asset routes"
  ```

### Task 5: Prove Asset persistence, concurrency, rollback, and quality gates

**Files:**
- Create: `backend/src/tests/balanceRoutes.phase1.integration.test.ts`
- Create: `docs/delivery/phase-1/evidence/P1-BALANCE-ASSET.md`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md`
- Modify: `docs/project-memory.md`
- Modify: `docs/adr/0007-ai-balance-mutation.md`
- Modify: `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` only through the approved incremental Graphify workflow

- [ ] **Step 1: Write and run integration RED**

  Add a real PostgreSQL route suite that creates/replays one Asset, updates it with version `1`, rejects a stale update with `VERSION_CONFLICT`, deletes with version `2`, rejects viewer/non-member writes with unchanged Asset/operation/audit/cacheVersion counts, and injects a transaction failure to prove no partial Asset/idempotency/audit commit. Run the focused suite before final adoption and record the expected failure.

- [ ] **Step 2: Run integration GREEN and regression gates**

  ```powershell
  cd backend
  npm run test:integration -- src/tests/balanceRoutes.phase1.integration.test.ts
  npm run test:integration
  npm run build
  npm test -- --runInBand --coverage
  npx prisma validate
  npx prisma format --check
  ```

  Record exact suite/test/coverage numbers. Keep any external Docker, Redis, MinIO, Playwright, populated-restore, release-observation, or semantic-Graphify limitations as BLOCKED/AT_RISK rather than converting them to PASS.

- [ ] **Step 3: Synchronize durable evidence**

  Update the tracker, project memory, ADR-0007 scope/implementation note, and evidence card with the exact commits, commands, observed outcomes, migration/backfill behavior, rollback result, and remaining Liability/valuation risks. Run the available Graphify incremental workflow and review generated changes; do not accept AST-only output as a semantic refresh when it would replace the reviewed graph.

- [ ] **Step 4: Commit the evidence slice**

  ```powershell
  git add backend/src/tests/balanceRoutes.phase1.integration.test.ts docs/delivery/phase-1 docs/project-memory.md docs/adr/0007-ai-balance-mutation.md graphify-out
  git commit -m "docs: record transactional asset CRUD evidence"
  ```

## Self-review

- The approved Phase 1 design and ADR-0007 provide the architectural basis; this plan narrows the next implementation to ordinary Asset CRUD.
- Each production behavior change has a preceding focused RED step, and integration evidence is separate from mock route/service evidence.
- Asset and Liability remain separate models; Liability migration is intentionally the next slice after Asset evidence is green.
- No currency conversion, valuation, object storage, or browser behavior is implied by this plan.
- All operation names and response helpers used here are defined in the existing coordinator/type contracts or in the tasks above.
