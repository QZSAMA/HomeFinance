# HomeFinance repository instructions

These instructions apply to the entire repository. Read `docs/project-memory.md` before changing behavior and consult `graphify-out/graph.html` or `graphify-out/graph.json` before broad architectural work.

## Product and architecture invariants

- A `familyId` is the tenant boundary. Every family-scoped read and write must verify the authenticated user's membership before cache lookup, data access, object-storage access, or AI execution.
- Roles are `admin`, `member`, and `viewer`. A viewer is read-only on every mutation path, including imports, uploads, recurring execution, AI actions, and future background jobs.
- Never remove or demote the final family administrator.
- Financial totals may only combine values in one declared base currency. If conversion is unavailable, return amounts grouped by currency instead of summing them.
- Derived statements must reconcile: net income equals income minus expense; net cash flow includes every displayed cash-flow class; balance-sheet totals and dashboard totals use the same valuation rules and as-of date.
- Transaction-generating operations must be atomic and idempotent. Recurring execution, import confirmation, AI actions, and retries must not create duplicate or partially applied records.
- AI-generated mutations require explicit user confirmation. AI output is untrusted input and must pass the same authorization, validation, audit, and transaction rules as ordinary API writes.
- Caches are an optimization, never an authorization boundary. Authorize before reading a cache; scope keys by tenant and relevant query dimensions; invalidate or version derived data after writes.

## Change workflow

1. Locate the affected feature in `docs/project-memory.md` and the knowledge graph.
2. For a bug or behavior change, write one focused failing test and run it to observe the expected failure.
3. Implement the minimum change that passes that test, run the focused test again, then run the relevant regression suite.
4. Refactor only while tests remain green. Do not weaken assertions to make a change pass.
5. Update contracts, project memory, audit risk status, and Graphify when architecture, invariants, routes, data models, or user-visible behavior changes.

## Required quality gates

- Backend: `npm run build` and `npm test -- --runInBand --coverage` from `backend/`.
- Database behavior: `npm run test:integration` from `backend/` when PostgreSQL is available and the change affects persistence, transactions, cascades, or Prisma schema.
- Prisma: `npx prisma validate` and `npx prisma format --check` with a non-production `DATABASE_URL`.
- Frontend: `npm run lint` and `npm run build` from `frontend/`.
- Frontend behavior: add component or browser tests for changed flows. Do not rely solely on build success or manual clicking.
- Security-sensitive changes must include negative tests for unauthenticated users, non-members, viewers, malformed input, replay, and concurrency where applicable.

## Design boundaries

- Keep Express app construction separate from process startup so route tests can import the app without opening network listeners.
- Centralize family authorization and permission policy; do not add another route-local `checkFamilyAccess` copy.
- Put accounting calculations and mutation orchestration in domain/application services, not large route handlers or React pages.
- Prefer database aggregation and bounded pagination over loading complete tables into Node.js.
- Frontend API calls must use the configured API client so bearer token, base URL, and common error handling are consistent.
- Lazy-load route-level pages and heavy optional features. Treat new warnings, oversized chunks, accessibility regressions, and unhandled promise errors as failures.
- Do not claim offline data support unless runtime caching, data freshness, conflict resolution, and security behavior are implemented and tested.

## Persistent memory maintenance

- Source-of-truth order: Prisma schema and executable tests; backend/API implementation; frontend service and UI behavior; design documents and README claims; generated graph summaries.
- `docs/project-memory.md` records stable architecture and invariants. `docs/audit/2026-08-27-homefinance-deep-audit-report.md` is the baseline risk assessment. `docs/audit/2026-08-27-homefinance-integrated-remediation-plan.md` is the consolidated delivery roadmap; the six supporting domain analyses are under `docs/audit/parallel-analysis/`.
- After code-only changes, run `/graphify . --update` or the equivalent Graphify incremental workflow. After documentation or image changes, run the semantic update rather than AST-only refresh.
- Review inferred graph edges before treating them as facts. `EXTRACTED` edges are source-backed; `INFERRED` edges are hypotheses requiring code or test confirmation.
- Record durable architectural decisions as ADRs under `docs/adr/` when a decision changes data ownership, financial semantics, authorization, storage, AI mutation policy, or deployment topology.
