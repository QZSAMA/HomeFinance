# AI Balance Mutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Route confirmed AI `create_asset` and `create_liability` actions through a transaction-scoped Balance Mutation Service so the proposal claim, balance fact, audit event, idempotency result, and proposal completion remain atomic.

**Architecture:** Keep the existing proposal-level `FinancialMutationCoordinator` as the single idempotency and transaction boundary. Add a small transaction-only Balance Mutation Service for Asset/Liability creation, expose only the minimum `asset` and `liability` methods through `LedgerTransactionClient`, and dispatch confirmed AI actions by their persisted proposal-item type. Ordinary Asset/Liability HTTP CRUD, balance queries, valuation, and currency conversion stay outside this slice.

**Tech Stack:** TypeScript, Express, Prisma, PostgreSQL, Jest, ts-jest.

## Global Constraints

- `familyId` is the tenant boundary; authorization is completed by the existing coordinator before proposal or balance reads/writes.
- `viewer` cannot confirm or create any balance fact.
- AI output and edited confirmation actions are untrusted; both action type and fields are revalidated at confirmation time.
- One proposal confirmation uses one PostgreSQL transaction; no nested independent transaction or direct route Prisma mutation is introduced.
- Asset `value` and Liability `amount` are finite non-negative numbers; currency is a normalized three-letter code.
- Do not add Asset/Liability HTTP route migration or a schema version field in this slice; existing models do not expose a balance version contract.
- Every production behavior change must have a focused RED test observed before the implementation and a focused GREEN/regression run afterward.

### Task 1: Extend the transaction protocol and Prisma adapter

**Files:**
- Modify: `backend/src/services/ledgerTypes.ts`
- Modify: `backend/src/services/prismaFinancialMutationStore.ts`
- Test: `backend/src/services/prismaFinancialMutationStore.test.ts`

**Interfaces:**
- Produces `LedgerTransactionClient.asset.create(args)` returning a `LedgerRecord` with numeric `value` and `costBasis` when present.
- Produces `LedgerTransactionClient.liability.create(args)` returning a `LedgerRecord` with numeric `amount` and `interestRate` when present.
- Keeps `FinancialMutationOperation` unchanged because the outer operation remains `CONFIRM_AI_PROPOSAL`.

- [ ] **Step 1: Write the failing adapter test**

  Add one test that invokes the Prisma transaction adapter's new `asset.create` and `liability.create` methods with Decimal-shaped return values and asserts that the exposed records contain JavaScript numbers. The test must also assert the family and actor fields passed to Prisma.

- [ ] **Step 2: Run the adapter test to verify RED**

  Run from `backend/`:

  ```powershell
  npm test -- --runInBand src/services/prismaFinancialMutationStore.test.ts
  ```

  Expected: FAIL because the transaction client does not yet expose `asset` and `liability` methods.

- [ ] **Step 3: Add the narrow protocol and adapter methods**

  Extend `LedgerTransactionClient` with typed `asset.create` and `liability.create` input contracts. In `createPrismaLedgerTransactionClient`, call `tx.asset.create` and `tx.liability.create`, converting Decimal fields to numbers while preserving nullable dates and strings. Do not expose root-level balance reads through `FinancialMutationStore`.

- [ ] **Step 4: Run the adapter test to verify GREEN**

  Run the same focused command and expect the new test and the existing Prisma adapter tests to pass.

- [ ] **Step 5: Commit**

  ```powershell
  git add backend/src/services/ledgerTypes.ts backend/src/services/prismaFinancialMutationStore.ts backend/src/services/prismaFinancialMutationStore.test.ts
  git commit -m "feat: add balance transaction adapter"
  ```

### Task 2: Implement transaction-scoped Balance Mutation Service

**Files:**
- Create: `backend/src/services/balanceMutationService.ts`
- Create: `backend/src/services/balanceMutationService.test.ts`

**Interfaces:**
- `createAssetInTransaction(command: CreateAssetCommand, transaction): Promise<MutationExecutionResult<LedgerRecord>>`
- `createLiabilityInTransaction(command: CreateLiabilityCommand, transaction): Promise<MutationExecutionResult<LedgerRecord>>`
- Both functions validate command scope, required text, finite non-negative balance amount, optional date, and three-letter currency, then write only through the supplied transaction client.

- [ ] **Step 1: Write the failing service test**

  Add tests for a valid Asset and Liability creation using a transaction double. Assert that each service passes `familyId`, `createdBy`, normalized currency, and `originType: 'AI_CONFIRMATION'`, and returns the created resource ID and record. Add one invalid negative/invalid-currency assertion that proves the transaction write is not called.

- [ ] **Step 2: Run the service test to verify RED**

  ```powershell
  npm test -- --runInBand src/services/balanceMutationService.test.ts
  ```

  Expected: FAIL because the service module and exported functions do not exist.

- [ ] **Step 3: Implement the minimum service**

  Add shared private validators for text, finite non-negative amounts, valid dates, and uppercase ISO-like currency codes. Map `CreateAssetCommand.payload` to the existing Asset columns and `CreateLiabilityCommand.payload` to the existing Liability columns. Return `resourceId`, `record`, and no fabricated version.

- [ ] **Step 4: Run the service test to verify GREEN**

  Run the focused service test, then the adapter and ledger service tests. Expected: all pass without changing existing Income/Expense behavior.

- [ ] **Step 5: Commit**

  ```powershell
  git add backend/src/services/balanceMutationService.ts backend/src/services/balanceMutationService.test.ts
  git commit -m "feat: add transaction-scoped balance mutations"
  ```

### Task 3: Dispatch Asset/Liability actions during AI confirmation

**Files:**
- Modify: `backend/src/services/aiProposalConfirmationService.ts`
- Modify: `backend/src/services/aiProposalConfirmationService.test.ts`

**Interfaces:**
- `ConfirmedAiActionResult.type` includes `create_asset` and `create_liability`.
- Proposal item type must exactly match the edited action type; a mismatch returns `VALIDATION_FAILED` before the proposal claim.
- Asset/Liability actions call `createAssetInTransaction` or `createLiabilityInTransaction` with the already claimed parent transaction and `AI_CONFIRMATION` source.

- [ ] **Step 1: Extend the in-memory test fixture and add the first failing behavior test**

  Add `assets` and `liabilities` arrays and transaction create methods to the test store. Add a test that confirms a proposal containing one `create_asset` and one `create_liability`, asserts one record of each, `EXECUTED`, one idempotency record, one audit event, and a replay that creates no second balance fact.

- [ ] **Step 2: Run the confirmation test to verify RED**

  ```powershell
  npm test -- --runInBand src/services/aiProposalConfirmationService.test.ts
  ```

  Expected: FAIL with the current `AI_BALANCE_MUTATION_UNAVAILABLE` error, proving the new confirmation behavior is not already present.

- [ ] **Step 3: Implement action dispatch and type matching**

  Import both Balance service functions. Replace the ledger-only action guard with a supported-create-action guard, require `item.typedAction === action.type`, and dispatch income/expense/asset/liability through their corresponding transaction-only function. Keep the parent coordinator's idempotency, proposal claim, item results, audit, and result persistence unchanged.

- [ ] **Step 4: Run focused confirmation tests to verify GREEN**

  Run the confirmation service tests and the AI route contract tests. Update the former unsupported-balance expectation to the new successful behavior and keep the edited-type mismatch as a negative validation test.

- [ ] **Step 5: Commit**

  ```powershell
  git add backend/src/services/aiProposalConfirmationService.ts backend/src/services/aiProposalConfirmationService.test.ts
  git commit -m "feat: confirm AI balance proposals atomically"
  ```

### Task 4: Verify real PostgreSQL atomicity and synchronize evidence

**Files:**
- Modify: `backend/src/tests/aiProposalConfirmation.phase1.integration.test.ts`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md`
- Modify: `docs/project-memory.md`
- Modify: `docs/audit/evidence/P1-E-04.md`
- Modify: `docs/audit/evidence/P1-E-06.md`
- Modify: `docs/audit/evidence/P1-A-07.md`
- Modify: `docs/audit/evidence/P1-G-06.md`
- Modify: `docs/audit/evidence/P1-H-01.md`

- [ ] **Step 1: Add the failing real-PostgreSQL assertion**

  Add a fixture for a proposal with `create_asset` and `create_liability`, confirm it through `createPrismaFinancialMutationStore`, and assert both rows plus the parent proposal, item results, audit, and idempotency facts. Add a rollback injection assertion that leaves both balance tables and proposal status unchanged.

- [ ] **Step 2: Run the integration test to verify RED**

  From `backend/`, run `npm run test:integration -- src/tests/aiProposalConfirmation.phase1.integration.test.ts`. Expected: the new assertion fails before the service dispatch exists (or the test cannot start if PostgreSQL credentials are unavailable; record that as an environment blocker rather than a business pass).

- [ ] **Step 3: Run the real integration test to verify GREEN**

  With the configured non-production PostgreSQL available, run the focused integration suite, then `npm run test:integration`. Expect the balance confirmation cases and existing suites to pass.

- [ ] **Step 4: Run required quality gates**

  From `backend/`: `npm run build`, `npm test -- --runInBand --coverage`, `npx prisma validate`, and `npx prisma format --check`. Keep the global branch threshold failure visible if it remains below 60%. Do not claim Compose/Playwright until Docker is available.

- [ ] **Step 5: Update durable memory and evidence**

  Record the commit(s), exact focused/full suite counts, coverage values, PostgreSQL result or credential blocker, and the fact that ordinary Asset/Liability HTTP CRUD remains outside this slice. Update the tracker state only to the evidence actually obtained; keep P1-A-07 at risk until the strict compatibility adapter and remaining direct mutation paths are resolved.

- [ ] **Step 6: Commit the evidence update**

  ```powershell
  git add docs/delivery/phase-1/phase-1-tracker.md docs/project-memory.md docs/audit/evidence
  git commit -m "docs: record AI balance confirmation evidence"
  ```

## Self-review

- Scope is one subsystem: transaction-scoped AI Asset/Liability confirmation; ordinary balance CRUD and external infrastructure are explicitly excluded.
- All production edits have a preceding focused RED step.
- No new financial mutation operation is needed because the proposal coordinator already owns `CONFIRM_AI_PROPOSAL`.
- No migration is required because Asset and Liability tables already exist and this slice adds no columns or constraints.
- The plan does not claim success for PostgreSQL, coverage, Docker, E2E, Graphify semantic refresh, or release observation without executable evidence.
