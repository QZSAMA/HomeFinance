# Liability CRUD Transactional Migration Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Each task uses checkbox syntax and must preserve the RED -> GREEN -> REFACTOR sequence.

**Goal:** Migrate ordinary Liability family CRUD from direct Prisma route writes to the transactional Balance Mutation Service and FinancialMutationCoordinator while preserving the existing HTTP contract.

**Architecture:** The Liability route becomes an HTTP adapter protected by centralized family middleware. Create, update, and delete commands enter balanceMutationService, which validates and delegates to coordinateFinancialMutation; the Prisma adapter exposes only transaction-scoped Liability operations. PostgreSQL version, scoped idempotency, audit events, and the existing Family.cacheVersion trigger provide the persistence guarantees.

**Tech Stack:** TypeScript, Express 4, Zod 3, Prisma 5.22, PostgreSQL 18.1, Jest 29, Supertest, JWT middleware.

## Global Constraints

- familyId is the tenant boundary; membership must be verified before cache lookup, data access, object-storage access, or AI execution.
- A viewer is read-only on every mutation path.
- Financial totals may only combine values in one declared base currency; this slice does not change valuation or conversion behavior.
- Transaction-generating operations must be atomic and idempotent.
- Caches are an optimization, never an authorization boundary; successful mutations rely on the database trigger for Family.cacheVersion.
- Route adapters must not contain direct Liability create, update, or delete calls.
- All file edits use apply_patch; no destructive reset or checkout commands are permitted.
- Before implementation code, write and run a focused failing test; do not weaken existing assertions.
- Preserve POST 201, PUT 200, DELETE 200, the existing Chinese error/message fields, and the existing Liability field semantics.
- Missing Idempotency-Key keeps the shared generated-key compatibility behavior; callers must send a stable key for cross-retry replay.
- Docker/Compose/Redis/MinIO/Playwright remain BLOCKED or NOT_RUN unless their environments are actually available.

## File Map

| File | Responsibility |
|---|---|
| backend/src/routes/liabilities.ts | Middleware, HTTP parsing, command construction, compatible responses; no financial Prisma writes |
| backend/src/services/ledgerTypes.ts | Liability command, operation union, and transaction-client signatures |
| backend/src/services/balanceMutationService.ts | Validated transactional Liability create/update/delete |
| backend/src/services/prismaFinancialMutationStore.ts | Transaction-scoped Prisma Liability adapter and operation whitelist |
| backend/prisma/schema.prisma | Additive Liability.version contract |
| backend/prisma/migrations/20260902100000_add_liability_version/migration.sql | Additive version column and positive-version check |
| backend/src/services/balanceMutationService.test.ts | Command normalization, family predicates, CAS, and error contracts |
| backend/src/services/prismaFinancialMutationStore.test.ts | Prisma adapter mapping contract |
| backend/src/routes/liabilities.test.ts | Route boundary and compatibility regression |
| backend/src/tests/phase1SchemaContract.test.ts | Schema and migration contract |
| backend/src/tests/liabilityRoutes.phase1.integration.test.ts | Real PostgreSQL CRUD, replay, CAS, concurrency, authorization, and rollback |
| docs/delivery/phase-1/evidence/P1-A-09.md | Task evidence and residual risks |
| docs/delivery/phase-1/phase-1-tracker.md | Single task state source |
| docs/project-memory.md | Durable architecture facts |
| docs/audit/2026-08-27-homefinance-deep-audit-report.md | Baseline risk status |

## Task 1: Establish the route boundary RED

**Files:**
- Modify: backend/src/routes/liabilities.test.ts
- Read only: backend/src/routes/liabilities.ts

**Interfaces:**
- Consumes: existing liabilityBody, JWT helper, family route mount, and Prisma mocks.
- Produces: a failing test proving the route calls a Balance service and not prisma.liability.create.

- [ ] **Step 1: Add the mocked Balance service and first failing test**

Add this mock before importing the route and add the test to liabilities.test.ts:

~~~ts
jest.mock('../services/balanceMutationService', () => ({
  createLiability: jest.fn(),
  updateLiability: jest.fn(),
  deleteLiability: jest.fn(),
}));

import * as balanceMutationService from '../services/balanceMutationService';

const mockedBalance = balanceMutationService as typeof balanceMutationService & {
  createLiability: jest.Mock;
  updateLiability: jest.Mock;
  deleteLiability: jest.Mock;
};

test('creates a liability through the transactional application service', async () => {
  mockedBalance.createLiability.mockResolvedValue({
    operationId: 'operation-liability-create',
    resourceId: 'liability-1',
    record: { id: 'liability-1', familyId: 'family-1', amount: 350000, currency: 'CNY', version: 1 },
    version: 1,
    deduplicated: false,
  });

  const response = await request(app)
    .post('/api/families/family-1/liabilities')
    .set('Authorization', 'Bearer ' + tokenFor())
    .set('Idempotency-Key', 'liability-create-boundary')
    .send(liabilityBody);

  expect(response.status).toBe(201);
  expect(mockedBalance.createLiability).toHaveBeenCalledWith({
    familyId: 'family-1',
    actorId: 'member-1',
    source: 'MANUAL',
    idempotencyKey: 'liability-create-boundary',
    payload: {
      name: liabilityBody.name,
      type: liabilityBody.type,
      amount: liabilityBody.amount,
      interestRate: liabilityBody.interestRate,
      startDate: new Date(liabilityBody.startDate),
      endDate: new Date(liabilityBody.endDate),
      currency: liabilityBody.currency,
      description: liabilityBody.description,
    },
  }, expect.any(Object));
  expect(mockedPrisma.liability.create).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: Run the focused test and verify the target RED**

Run from backend:

~~~powershell
npm test -- --runInBand src/routes/liabilities.test.ts -t "creates a liability through the transactional application service"
~~~

Expected: FAIL because the current route calls prisma.liability.create and does not call mocked createLiability. This is a target-behavior failure, not an environment failure.

- [ ] **Step 3: Commit the RED contract**

~~~powershell
git add -- backend/src/routes/liabilities.test.ts
git commit -m "test: define transactional liability route boundary"
~~~

## Task 2: Add transactional Liability create

**Files:**
- Modify: backend/src/services/ledgerTypes.ts
- Modify: backend/src/services/balanceMutationService.ts
- Modify: backend/src/services/prismaFinancialMutationStore.ts
- Modify: backend/src/routes/liabilities.ts
- Modify: backend/src/services/balanceMutationService.test.ts
- Modify: backend/src/routes/liabilities.test.ts

**Interfaces:**
- Consumes: CreateLiabilityCommand, createLiabilityInTransaction, FinancialMutationStore, coordinateFinancialMutation, and ledgerRouteSupport.
- Produces: createLiability(command, store): Promise<MutationResult<LedgerRecord>> using operation CREATE_LIABILITY and AuditEvent entity Liability.

- [ ] **Step 1: Add the service RED**

Add a createLiabilityMutationStore fixture with familyMember, scoped idempotencyRecord, liability.create, and auditEvent.create. It must return a member, retain idempotency rows in a Map, return Liability version 1, and not call root Prisma. Add:

~~~ts
test('coordinates a manual Liability create through the shared mutation boundary', async () => {
  const store = createLiabilityMutationStore();

  const result = (balanceMutationService as typeof balanceMutationService & {
    createLiability: (
      command: CreateLiabilityCommand,
      store: FinancialMutationStore,
    ) => Promise<Record<string, unknown>>;
  }).createLiability({
    ...liabilityCommand,
    source: 'MANUAL',
    idempotencyKey: 'manual-liability-create-1',
  }, store);

  await expect(result).resolves.toMatchObject({
    resourceId: 'liability-1',
    version: 1,
    deduplicated: false,
  });
});
~~~

- [ ] **Step 2: Run the service RED**

~~~powershell
npm test -- --runInBand src/services/balanceMutationService.test.ts -t "coordinates a manual Liability create"
~~~

Expected: FAIL because createLiability is not exported.

- [ ] **Step 3: Add the operation and create implementation**

Add CREATE_LIABILITY to FinancialMutationOperation and to the Prisma operation whitelist. Extract the existing normalized Liability payload into liabilityMutationData, shared by the transaction function and application function. Add:

~~~ts
export async function createLiability(
  command: CreateLiabilityCommand,
  store: FinancialMutationStore,
): Promise<MutationResult<LedgerRecord>> {
  validateCommandScope(command);
  const payload = liabilityMutationData(command);

  return coordinateFinancialMutation(
    {
      familyId: command.familyId,
      actorId: command.actorId,
      source: command.source,
      idempotencyKey: command.idempotencyKey,
      operation: 'CREATE_LIABILITY',
      requestPayload: { source: command.source, payload },
      httpStatus: 201,
      audit: { action: 'CREATE', entity: 'Liability' },
    },
    store,
    async (transaction) => createLiabilityInTransaction(command, transaction),
  );
}
~~~

liabilityMutationData requires nonblank name/type, finite non-negative amount/interestRate, valid optional dates, optional text fields, and uppercase three-letter currency. It must not access Prisma.

- [ ] **Step 4: Update the create route**

Import requireFamilyAccess, createLiability, createPrismaFinancialMutationStore, markIdempotencyReplay, mutationResource, readIdempotencyKey, and sendLedgerMutationError. Define one module-level financialMutationStore. Replace the POST write with:

~~~ts
const result = await createLiability({
  familyId,
  actorId: req.userId!,
  source: 'MANUAL',
  idempotencyKey: readIdempotencyKey(req),
  payload: {
    name: data.name,
    type: data.type,
    amount: data.amount,
    interestRate: data.interestRate,
    startDate: data.startDate ? new Date(data.startDate) : undefined,
    endDate: data.endDate ? new Date(data.endDate) : undefined,
    currency: data.currency,
    description: data.description,
  },
}, financialMutationStore);

markIdempotencyReplay(result, res);
return res.status(201).json(mutationResource(result));
~~~

Catch with sendLedgerMutationError(error, res, '创建负债'). Remove the POST membership query and direct Prisma create.

- [ ] **Step 5: Run focused GREEN tests**

~~~powershell
npm test -- --runInBand src/services/balanceMutationService.test.ts -t "coordinates a manual Liability create|creates a Liability with normalized"
npm test -- --runInBand src/routes/liabilities.test.ts -t "creates a liability through the transactional application service"
~~~

Expected: both tests PASS and mockedPrisma.liability.create has zero calls.

- [ ] **Step 6: Commit**

~~~powershell
git add -- backend/src/services/ledgerTypes.ts backend/src/services/balanceMutationService.ts backend/src/services/prismaFinancialMutationStore.ts backend/src/routes/liabilities.ts backend/src/services/balanceMutationService.test.ts backend/src/routes/liabilities.test.ts
git commit -m "feat: route liability create through transactional balance service"
~~~

## Task 3: Add Liability update/delete with version CAS

**Files:**
- Modify: backend/src/services/ledgerTypes.ts
- Modify: backend/src/services/balanceMutationService.ts
- Modify: backend/src/services/prismaFinancialMutationStore.ts
- Modify: backend/src/routes/liabilities.ts
- Modify: backend/src/services/balanceMutationService.test.ts
- Modify: backend/src/routes/liabilities.test.ts

**Interfaces:**
- Consumes: Task 2 create contract and the existing Asset family/version mutation pattern.
- Produces: updateLiability(command, store) and deleteLiability(command, store) using UPDATE_LIABILITY and DELETE_LIABILITY.

- [ ] **Step 1: Add command types**

~~~ts
export type UpdateLiabilityCommand = CreateLiabilityCommand & {
  liabilityId: string;
  expectedVersion?: number;
};

export type DeleteLiabilityCommand = Pick<
  CreateLiabilityCommand,
  'familyId' | 'actorId' | 'source' | 'idempotencyKey'
> & {
  liabilityId: string;
  expectedVersion?: number;
};
~~~

- [ ] **Step 2: Add failing unit contracts**

Add a mutable in-memory Liability fixture that checks id, familyId, and version in findFirst, updateMany, and deleteMany. Add:

~~~ts
test('updates a Liability only when the family-scoped version predicate matches', async () => {
  const store = createLiabilityMutationStore({ version: 1 });

  const result = await balanceMutationService.updateLiability({
    ...liabilityCommand,
    source: 'MANUAL',
    idempotencyKey: 'manual-liability-update-1',
    liabilityId: 'liability-1',
    expectedVersion: 1,
    payload: { ...liabilityCommand.payload, amount: 340000 },
  }, store);

  expect(result).toMatchObject({ resourceId: 'liability-1', version: 2, deduplicated: false });
});

test('returns a stable version conflict when a Liability predicate no longer matches', async () => {
  const store = createLiabilityMutationStore({ version: 2 });

  await expect(balanceMutationService.updateLiability({
    ...liabilityCommand,
    source: 'MANUAL',
    idempotencyKey: 'manual-liability-stale-update-1',
    liabilityId: 'liability-1',
    expectedVersion: 1,
  }, store)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
});

test('deletes a Liability only when the family-scoped version predicate matches', async () => {
  const store = createLiabilityMutationStore({ version: 1 });

  const result = await balanceMutationService.deleteLiability({
    familyId: liabilityCommand.familyId,
    actorId: liabilityCommand.actorId,
    source: 'MANUAL',
    idempotencyKey: 'manual-liability-delete-1',
    liabilityId: 'liability-1',
    expectedVersion: 1,
  }, store);

  expect(result).toMatchObject({ resourceId: 'liability-1', version: 1, deduplicated: false });
});
~~~

- [ ] **Step 3: Run CAS RED**

~~~powershell
npm test -- --runInBand src/services/balanceMutationService.test.ts -t "Liability only when|stable version conflict|deletes a Liability"
~~~

Expected: FAIL because the two application functions and transaction methods do not exist.

- [ ] **Step 4: Implement the service functions**

Use the Asset algorithms with Liability-specific operation and messages. The update transaction must use:

~~~ts
const liabilityStore = requireLiabilityStore(transaction);
const before = await liabilityStore.findFirst({
  where: { id: liabilityId, familyId: command.familyId },
});
if (!before) return resourceNotFound();
const expectedVersion = command.expectedVersion ?? storedVersion(before);
const outcome = await liabilityStore.updateMany({
  where: { id: liabilityId, familyId: command.familyId, version: expectedVersion },
  data: { ...payload, version: { increment: 1 } },
});
if (outcome.count !== 1) return versionConflict('Liability');
const record = await liabilityStore.findFirst({
  where: { id: liabilityId, familyId: command.familyId },
});
if (!record) return updatedRecordMissing('Liability');
return {
  resourceId: liabilityId,
  record,
  version: storedVersion(record),
  before,
};
~~~

The delete transaction reads before, calls deleteMany with id + familyId + version, returns resourceId, expectedVersion, and before, and never reads the deleted row. Both coordinator inputs use Liability audit entity and the normalized request payload.

- [ ] **Step 5: Run service GREEN and regression**

~~~powershell
npm test -- --runInBand src/services/balanceMutationService.test.ts -t "Liability"
npm test -- --runInBand src/services/balanceMutationService.test.ts
~~~

Expected: Liability tests and the complete BalanceMutationService suite PASS; Asset tests remain green.

- [ ] **Step 6: Commit**

~~~powershell
git add -- backend/src/services/ledgerTypes.ts backend/src/services/balanceMutationService.ts backend/src/services/prismaFinancialMutationStore.ts backend/src/services/balanceMutationService.test.ts
git commit -m "feat: add versioned liability balance mutations"
~~~

## Task 4: Add the Liability version schema and Prisma transaction adapter

**Files:**
- Modify: backend/prisma/schema.prisma
- Create: backend/prisma/migrations/20260902100000_add_liability_version/migration.sql
- Modify: backend/src/services/prismaFinancialMutationStore.ts
- Modify: backend/src/tests/phase1SchemaContract.test.ts
- Modify: backend/src/services/prismaFinancialMutationStore.test.ts

**Interfaces:**
- Consumes: LedgerTransactionClient.liability signatures and toLiabilityRecord.
- Produces: persisted Liability.version defaulting to 1, a positive-version constraint, and transaction-scoped findFirst/updateMany/deleteMany.

- [ ] **Step 1: Add the schema RED contract**

Add a test to phase1SchemaContract.test.ts that checks the Liability model has version Int @default(1), the migration directory exists, and the migration contains the version column, Liability_version_check, and CHECK ("version" > 0).

- [ ] **Step 2: Run schema RED**

~~~powershell
npm test -- --runInBand src/tests/phase1SchemaContract.test.ts -t "versioned Liability"
~~~

Expected: FAIL because the schema field and migration directory do not exist.

- [ ] **Step 3: Add the additive schema and migration**

Add version Int @default(1) to the Liability model after id. Create migration.sql with:

~~~sql
ALTER TABLE "Liability" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Liability"
  ADD CONSTRAINT "Liability_version_check" CHECK ("version" > 0);
~~~

Do not remove or alter existing Liability rows, indexes, family relation, or AI Balance tables.

- [ ] **Step 4: Add the transaction adapter**

Extend LedgerTransactionClient.liability with findFirst, updateMany, and deleteMany methods whose where types include id, familyId, and version. Implement them in createPrismaLedgerTransactionClient by calling the matching tx.liability methods and passing reads through toLiabilityRecord. Preserve Decimal-to-number conversion and version.

- [ ] **Step 5: Add and run adapter tests**

Use fake transaction methods and assert that familyId is retained in every read and CAS predicate. Assert the adapter converts a Decimal-like amount and preserves version.

~~~powershell
npm test -- --runInBand src/services/prismaFinancialMutationStore.test.ts src/tests/phase1SchemaContract.test.ts
npx prisma generate
npx prisma validate
npx prisma format --check
~~~

Expected: adapter, schema contract, Prisma generate, validate, and format checks PASS.

- [ ] **Step 6: Commit**

~~~powershell
git add -- backend/prisma/schema.prisma backend/prisma/migrations/20260902100000_add_liability_version backend/src/services/ledgerTypes.ts backend/src/services/prismaFinancialMutationStore.ts backend/src/services/prismaFinancialMutationStore.test.ts backend/src/tests/phase1SchemaContract.test.ts
git commit -m "feat: add liability versioned transaction adapter"
~~~

## Task 5: Complete the HTTP Liability route adapter

**Files:**
- Modify: backend/src/routes/liabilities.ts
- Modify: backend/src/routes/liabilities.test.ts

**Interfaces:**
- Consumes: createLiability, updateLiability, deleteLiability, readExpectedVersion, readIdempotencyKey, mutationResource, mutationDeleteResponse, markIdempotencyReplay, and sendLedgerMutationError.
- Produces: centralized access on GET and all three mutation routes with response and header compatibility.

- [ ] **Step 1: Add route RED assertions for update/delete and centralized read access**

Change route tests so update and delete mock updateLiability and deleteLiability, assert complete command values, and assert direct Prisma mutation methods are never called. Add to the read test:

~~~ts
expect(mockedPrisma.familyMember.findUnique).toHaveBeenCalledWith({
  where: { familyId_userId: { familyId: 'family-1', userId: 'member-1' } },
});
expect(mockedPrisma.liability.findMany).toHaveBeenCalledWith({
  where: { familyId: 'family-1' },
  orderBy: { amount: 'desc' },
});
~~~

The update test sends If-Match W/"1" and expects expectedVersion 1. The delete test sends If-Match "2" and expects expectedVersion 2. Add an invalid If-Match test expecting code VALIDATION_FAILED, retryable false, and zero service calls.

- [ ] **Step 2: Run route RED**

~~~powershell
npm test -- --runInBand src/routes/liabilities.test.ts -t "transactional|invalid If-Match|direct Prisma|centralized"
~~~

Expected: FAIL because the route still uses local checkFamilyAccess and direct Prisma update/delete, and does not parse mutation headers.

- [ ] **Step 3: Replace route-local authorization and mutation bodies**

Use the centralized middleware on GET:

~~~ts
router.get('/', authMiddleware, requireFamilyAccess, async (req: AuthRequest, res: Response) => {
  try {
    const familyId = req.params.familyId as string;
    const pagination = parsePagination(req);
    if (pagination) {
      const [liabilities, total] = await Promise.all([
        prisma.liability.findMany({
          where: { familyId },
          orderBy: { amount: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
        }),
        prisma.liability.count({ where: { familyId } }),
      ]);
      return res.json(paginateResponse(liabilities, total, pagination));
    }
    return res.json(await prisma.liability.findMany({
      where: { familyId },
      orderBy: { amount: 'desc' },
    }));
  } catch (error) {
    console.error('获取负债列表错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});
~~~

The PUT command includes liabilityId from req.params.id, expectedVersion from readExpectedVersion(req), and all liabilitySchema fields. The DELETE command includes family, actor, source, key, id, and expected version. Both handlers call markIdempotencyReplay, return mutationResource or mutationDeleteResponse, and use sendLedgerMutationError for all errors. Remove checkFamilyAccess entirely.

- [ ] **Step 4: Run route GREEN and full route regression**

~~~powershell
npm test -- --runInBand src/routes/liabilities.test.ts -t "liability|Liability|If-Match|direct Prisma|centralized"
npm test -- --runInBand src/routes/liabilities.test.ts
~~~

Expected: all Liability route tests PASS, direct Prisma create/update/delete mocks have zero calls, viewer and non-member writes are rejected before the service, and list/pagination responses remain unchanged.

- [ ] **Step 5: Commit**

~~~powershell
git add -- backend/src/routes/liabilities.ts backend/src/routes/liabilities.test.ts
git commit -m "feat: adopt transactional liability HTTP mutations"
~~~

## Task 6: Prove the migration against real PostgreSQL

**Files:**
- Create: backend/src/tests/liabilityRoutes.phase1.integration.test.ts
- Modify: backend/src/tests/phase1SchemaContract.test.ts only if a failed real-schema assertion identifies an explicit contract gap.

**Interfaces:**
- Consumes: mounted liabilitiesRoutes, JWT middleware, current PostgreSQL test database, and all previous migrations plus 20260902100000_add_liability_version.
- Produces: PASS-REAL evidence for migration, authenticated HTTP CRUD, replay, key conflict, stale CAS, authorization, concurrency, cache revision, audit, and rollback.

- [ ] **Step 1: Add the integration fixture and first real test**

Create an isolated suite with PrismaClient, unique runId, admin/viewer/outsider users, one family, Express JSON middleware, and the route mount. Add:

~~~ts
test('creates and replays one Liability without another fact or revision', async () => {
  const before = await liabilityCounts();
  const responses = await Promise.all(Array.from({ length: 20 }, () => request(app)
    .post('/api/families/' + familyId + '/liabilities')
    .set('Authorization', 'Bearer ' + tokenFor(adminUserId))
    .set('Idempotency-Key', 'liability-concurrent-create')
    .send(liabilityPayload(350000))));

  expect(responses.every((response) => response.status === 201)).toBe(true);
  expect(responses.filter((response) => response.body.deduplicated === false)).toHaveLength(1);
  expect(responses.filter((response) => response.body.deduplicated === true)).toHaveLength(19);
  expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
  expect(await liabilityCounts()).toEqual([
    before[0] + 1,
    before[1] + 1,
    before[2] + 1,
    before[3] + 1,
  ]);
});
~~~

liabilityCounts returns Liability count, CREATE_LIABILITY IdempotencyRecord count, Liability AuditEvent count, and family cacheVersion. liabilityPayload uses the six-value HTTP type allow-list and ISO date strings.

- [ ] **Step 2: Run integration RED before deploying the migration**

~~~powershell
npm run test:integration -- --testPathPattern=liabilityRoutes.phase1.integration.test.ts
~~~

Expected before migration and implementation: FAIL because the Liability version column and/or route transactional path is unavailable. If PostgreSQL is unavailable, record BLOCKED and do not label this target RED.

- [ ] **Step 3: Add the remaining real acceptance tests**

Add cases for versioned update/delete, viewer and non-member denial, same-key replay, different-payload key conflict, and transaction failure. Each rejection must compare Liability, IdempotencyRecord, AuditEvent, and family cacheVersion counts before and after.

The stale test must update with If-Match W/"1", then send update and delete with If-Match "1"; both must return 409 VERSION_CONFLICT and leave state unchanged. The key conflict test must create with one amount and retry the same key with a different amount; it must return 409 IDEMPOTENCY_KEY_REUSED and leave state unchanged. The failure injection must create within coordinateFinancialMutation using CREATE_LIABILITY and return a whitespace resourceId; it must return VALIDATION_FAILED and roll back every record.

- [ ] **Step 4: Run the real integration suite GREEN**

~~~powershell
npx prisma migrate deploy
npm run test:integration
~~~

Expected: the new Liability suite and all prior integration suites PASS. The new suite reports one committed fact for 20 identical creates, one successful versioned update, zero side effects on stale, denied, conflict, and failure paths, and one successful delete with the expected version.

- [ ] **Step 5: Run fresh-schema rehearsal**

Apply all migrations, including 20260902100000_add_liability_version, to a disposable non-production PostgreSQL database or isolated schema. Query information_schema.columns and the Liability check constraint, run the new integration suite, and remove only the disposable schema after capturing evidence.

- [ ] **Step 6: Commit**

~~~powershell
git add -- backend/src/tests/liabilityRoutes.phase1.integration.test.ts backend/prisma/migrations/20260902100000_add_liability_version/migration.sql backend/prisma/schema.prisma
git commit -m "test: verify liability CRUD on PostgreSQL"
~~~

## Task 7: Close evidence, quality gates, and memory

**Files:**
- Modify: docs/delivery/phase-1/evidence/P1-A-09.md
- Modify: docs/delivery/phase-1/phase-1-tracker.md
- Modify: docs/project-memory.md
- Modify: docs/audit/2026-08-27-homefinance-deep-audit-report.md
- Read only: graphify-out/graph.json and graphify-out/GRAPH_REPORT.md

**Interfaces:**
- Consumes: focused RED/GREEN commit IDs, PostgreSQL output, migration output, and current branch quality snapshot.
- Produces: truthful P1-A-09 evidence and synchronized long-term risk status; no claim of Docker, Redis, MinIO, E2E, staging, restore, or semantic Graphify completion.

- [ ] **Step 1: Run required backend gates**

From backend, run exactly:

~~~powershell
npm run build
npm test -- --runInBand --coverage
npm run test:integration
npx prisma validate
npx prisma format --check
~~~

Expected: build, tests, integration, validate, and format pass. Record actual suite, test, and coverage totals. If an existing threshold or infrastructure issue fails, preserve the failure and mark the relevant gate AT_RISK or BLOCKED rather than changing thresholds.

- [ ] **Step 2: Run direct-write and family-scope source checks**

~~~powershell
rg -n "checkFamilyAccess|prisma\.liability\.(create|update|delete)" backend/src/routes/liabilities.ts
rg -n "CREATE_LIABILITY|UPDATE_LIABILITY|DELETE_LIABILITY|liability\.updateMany|liability\.deleteMany" backend/src/services backend/src/routes
git diff --check
~~~

Expected: the first command returns no direct-write or local-access matches in liabilities.ts; the second shows the service and adapter transaction path; diff check passes.

- [ ] **Step 3: Update the evidence card**

Replace the DESIGNED snapshot in P1-A-09.md with the actual RED command/failure, GREEN command/results, commit IDs, migration count, PostgreSQL version, security negative evidence, rollback outcome, and remaining external-environment risks. Use PASS-MOCK, PASS-REAL, BLOCKED, and NOT_RUN precisely; do not promote inherited evidence to this task.

- [ ] **Step 4: Update tracker and durable memory**

Set P1-A-09 to REGRESSION_VERIFIED only if all Definition of Done conditions pass; otherwise keep the actual lifecycle state and health. Update docs/project-memory.md to state that ordinary Liability CRUD uses the Balance/coordinator path, has version/idempotency/audit/cache revision evidence, and that valuation/currency semantics remain open. Update the audit risk table to remove only ordinary Liability CRUD adoption risk.

- [ ] **Step 5: Perform Graphify review without replacing the semantic snapshot**

Read the current reviewed Graphify nodes and record the affected Liability route, Balance service, coordinator, and schema relationships. If the available runner remains AST-only and would overwrite the reviewed semantic graph, record semantic refresh as pending in P1-H-02 and do not replace graphify-out.

- [ ] **Step 6: Commit governance evidence**

~~~powershell
git add -- docs/delivery/phase-1/evidence/P1-A-09.md docs/delivery/phase-1/phase-1-tracker.md docs/project-memory.md docs/audit/2026-08-27-homefinance-deep-audit-report.md
git commit -m "docs: record transactional liability route evidence"
~~~

## Execution Checkpoints

After Task 1, review the RED failure before allowing production edits. After Task 5, review route-only behavior and direct-write source checks. After Task 6, review real PostgreSQL output and migration rollback constraints. Task 7 may not mark Phase 1 complete; existing Balance valuation, external infrastructure, browser E2E, populated restore, release observation, and semantic Graphify gates remain separate.

## Plan Self-Review

- Spec coverage: authorization order and centralized middleware are covered by Tasks 1 and 5; Balance/coordinator operations by Tasks 2 and 3; version migration and adapter by Task 4; HTTP compatibility and errors by Task 5; replay/concurrency/rollback by Task 6; documentation and Graphify truthfulness by Task 7.
- Scope check: no valuation, currency conversion, frontend rewrite, soft delete, AI flow, Redis, MinIO, Docker, or scheduler implementation is included.
- Type consistency: CreateLiabilityCommand is existing; UpdateLiabilityCommand and DeleteLiabilityCommand are introduced in Task 3; operation strings are added before service use; adapter methods are added before integration execution.
- Placeholder scan: all tasks have concrete files, interfaces, commands, expected outcomes, and explicit environment classifications.
- Rollback check: every code task is additive or route-contained; no destructive migration rollback or dual-write path is planned.
