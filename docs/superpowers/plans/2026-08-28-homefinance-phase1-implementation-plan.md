# HomeFinance Phase 1 可信账本与质量门禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有 API 兼容性的前提下，把 HomeFinance 的收入、支出、Recurring、Import 和 AI 财务 mutation 迁移到可授权、可审计、原子且可安全重放的统一应用层，并用真实环境门禁证明账本、期间、币种和发布回滚行为。

**Architecture:** 保留 `Income` 与 `Expense` 双表，在 Express route adapter 与 Prisma 之间增加 `FinancialMutationCoordinator`、`LedgerApplicationService` 和 `BalanceMutationService`。`app.ts` 只构造 Express app，`server.ts` 负责进程启动，`db/prisma.ts` 负责数据库 client；所有受控写入在一个 Prisma transaction 中完成 membership/role 校验、数据库仲裁幂等、事实写入、审计和来源状态推进。

**Tech Stack:** TypeScript 5.6、Express 4、Prisma 5/PostgreSQL、Jest/ts-jest、Zod、React/Vite/Vitest、Playwright、Redis、MinIO、Docker Compose。

## Global Constraints

- `familyId` 是租户边界；每个 family-scoped read/write 必须在 cache、数据库、对象存储或 AI 之前验证 membership。
- `viewer` 对所有 mutation 只读；不可删除或降级最终 family administrator。
- 混合币种在没有可靠汇率时只能返回 `totalsByCurrency`，不能直接相加。
- `netIncome = income - expense`；cash flow、balance sheet、dashboard 使用一致的估值与 as-of 规则。
- Income、Expense、Recurring、Import、AI mutation 必须原子且幂等；AI 输出必须显式确认后才可以写入事实。
- Redis、MinIO、AI provider 不参与财务事务；缓存不是授权边界。
- 所有行为变更必须先写一个聚焦 failing test，观察有效 RED，再写最小生产代码；不得删除既有断言或以 mock 代替应有的真实集成验证。
- Phase 1 的 Prisma migration 只做 additive expand/backfill/dual-read-write/contract；不删除 operation、audit、execution、batch、proposal 事实。
- `docs/delivery/phase-1/phase-1-tracker.md` 是唯一任务状态源；每个任务必须更新对应 `docs/delivery/phase-1/evidence/<ID>.md`。

## 1. 文件地图与共享写边界

### Wave 0（主交付 agent 独占）

- Create: `backend/src/db/prisma.ts` — 唯一 Prisma client 构造与导出。
- Create: `backend/src/server.ts` — listener、Redis/MinIO 初始化、优雅关闭和 signal 处理。
- Modify: `backend/src/app.ts` — 只负责 dotenv、安全校验、Express middleware、health 和 route mount；不导出启动副作用。
- Create: `backend/src/app.test.ts` — app 导入无 listener/Redis/MinIO 副作用的隔离测试。
- Modify: `backend/src/config/redis.ts`、`backend/src/config/minio.ts` — 保持导入可安全、连接/初始化由 `server.ts` 显式调用。
- Modify: `backend/src/middleware/familyAccess.ts`、现有 services 中从 `../app` 导入 `prisma` 的引用 — 改为 `../db/prisma`，不改变业务行为。
- Modify: `backend/package.json` — `dev`/`start` 指向 `server.ts`/`dist/server.js`，保持 `app.ts` 可被测试导入。

### Wave 1（共享合同冻结后，互斥写集）

- Ledger agent: Create `backend/src/services/ledgerTypes.ts`, `backend/src/services/ledgerErrors.ts`, `backend/src/services/ledgerApplicationService.ts`, `backend/src/services/financialMutationCoordinator.ts` 及对应 `*.test.ts`；不得改 `backend/prisma/schema.prisma`、`backend/src/routes/*`。
- Database agent: Modify `backend/prisma/schema.prisma`；Create ordered migrations under `backend/prisma/migrations/`；Create `backend/src/tests/database.phase1.integration.test.ts`；不得改 service/route。
- API agent: Modify `backend/src/routes/incomes.ts`, `backend/src/routes/expenses.ts`；Create route contract tests only in `backend/src/routes/*.phase1.test.ts`；不得改 schema/service。
- Review agent: 只读审查，输出评论或 `docs/delivery/phase-1/evidence/` 中指定证据卡，不修改生产源码。

### Wave 2（Ledger 和幂等合同达到 `REGRESSION_VERIFIED` 后）

- Import agent: `backend/src/services/importService.ts`, `backend/src/routes/import.ts` 及 import tests；使用已冻结 ledger command。
- Recurring agent: `backend/src/services/recurringService.ts`, `backend/src/routes/recurring.ts` 及 recurring tests；不得改 import/AI。
- AI agent: `backend/src/services/aiActions.ts`, `backend/src/services/aiService.ts`, `backend/src/services/ocrService.ts`, `backend/src/routes/ai.ts` 及 AI tests；不得改 schema。
- Frontend agent: `frontend/src/services/importService.ts`, `frontend/src/services/aiService.ts`, `frontend/src/pages/ImportPage.tsx`, `frontend/src/pages/AIPage.tsx` 及其组件测试。
- Integration agent: `backend/src/tests/*integration*`, `frontend/tests/` 或 `frontend/src/**/*.e2e.*`、Compose/E2E 配置；不得改业务实现。

## 2. 数据库迁移顺序与兼容策略

Database agent 必须按以下顺序提交，每个 migration 都先由 schema/integration RED 驱动，且在非生产 `DATABASE_URL` 上运行 `npx prisma validate` 和 `npx prisma format --check`：

1. `20260828100000_phase1_add_financial_versions_and_currency`：给 `Family` 增加可空 `baseCurrency`、给 `Income`/`Expense` 增加可空 `version`、`currency`、`originType`、`originRef`，给 `RecurringTransaction` 增加可空 `version`；先添加索引/约束，再 backfill `CNY` 和 `1`，最后在应用层切换非空语义。
2. `20260828100100_phase1_add_idempotency_and_audit`：创建 `IdempotencyRecord`、`AuditEvent`，唯一约束为 `(familyId, actorScope, operation, key)`；Audit actor 使用 nullable FK/actor snapshot，业务路径不提供 update/delete。
3. `20260828100200_phase1_add_recurring_execution`：创建 `RecurringExecution`，唯一约束为 `(recurringTransactionId, scheduledFor)`，保存 entry/mutation/result/status；不删除历史 recurring rule。
4. `20260828100300_phase1_add_import_batch`：创建 `ImportBatch`、`ImportRow`，保存 file/preview/parser hash、row number、canonical payload、validation errors、result entry 和状态。
5. `20260828100400_phase1_add_ai_proposal`：创建 `AIProposal`、`AIProposalItem`，保存 original/confirmed payload、hash、version、status、expiry、source file/conversation 和 result。
6. backfill/contract migration 只在所有旧客户端完成适配、staging 观察通过且 rollback rehearsal 完成后执行；不得在 Phase 1 中自动删除旧列或历史旁路。

每次 migration 的失败回滚使用前向修复或恢复备份，不运行自动 down migration。若新入口出现重复事实、跨 family 暴露或 reconciliation 失败，关闭入口 feature flag，保留 additive schema 和 audit/operation 事实，从最后一个已验证 commit 恢复；禁止双写、删除事实或削弱测试断言。

## 3. 任务执行细则

### Task 0: 冻结实施计划和基线证据

**Files:**

- Create: `docs/superpowers/plans/2026-08-28-homefinance-phase1-implementation-plan.md`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md`
- Modify: `docs/delivery/phase-1/evidence/P1-G-00.md`

**Interfaces:** 计划引用已批准设计规格、ADR-0001~0005 和 tracker 状态机；不改变运行时代码。

- [ ] **Step 1: 写入本计划**，固定 Wave 0/1/2 写集、迁移顺序、命令、回滚和证据点。
- [ ] **Step 2: 自审计划**：执行 `rg -n "TODO|TBD|placeholder|Similar to|write tests later" docs/superpowers/plans/2026-08-28-homefinance-phase1-implementation-plan.md`，预期无输出；逐项核对设计规格第 3~13 节均有对应任务。
- [ ] **Step 3: 更新 tracker**：将 `P1-G-00` 从 `BACKLOG` 置为 `READY`，写入首个 RED 文件/测试名/命令；将 `P1-0-02`、`P1-0-03` 保持 `IN_REVIEW`，不伪造 approver。
- [ ] **Step 4: 更新证据卡**：记录计划 commit、分支、阻塞条件 `external:POSTGRES_TEST_ENV@AVAILABLE` 不影响 Wave 0，以及 rollback rehearsal 尚未执行。
- [ ] **Step 5: 验证并提交**：运行 `git diff --check`；预期无 whitespace error；提交 `docs: add phase1 implementation plan`。

### Task 1: 证明 app 导入会产生启动副作用（P1-G-00 RED）

**Files:**

- Create: `backend/src/app.test.ts`
- Test command: `npm test -- --runInBand src/app.test.ts`

**Interfaces:** 测试以真实 module import 验证 `app` 导出；mock 仅拦截 listener、Redis、MinIO 的外部边界，不 mock 被测 app 组装逻辑。

- [ ] **Step 1: 写 RED 测试**：

```ts
import http from 'http';

describe('app construction', () => {
  test('imports without opening a listener or initializing external services', async () => {
    const listen = jest.spyOn(http.Server.prototype, 'listen');
    jest.isolateModules(() => {
      jest.mock('./config/redis', () => ({
        connectRedis: jest.fn().mockResolvedValue(undefined),
        redisClient: { isOpen: false },
      }));
      jest.mock('./config/minio', () => ({
        ensureBucket: jest.fn().mockResolvedValue(undefined),
      }));
      require('./app');
    });

    expect(listen).not.toHaveBeenCalled();
    expect(require('./config/redis').connectRedis).not.toHaveBeenCalled();
    expect(require('./config/minio').ensureBucket).not.toHaveBeenCalled();
    listen.mockRestore();
  });
});
```

- [ ] **Step 2: 运行有效 RED**：`npm test -- --runInBand src/app.test.ts`；预期测试失败在 `expect(listen).not.toHaveBeenCalled()`，失败原因是当前 `app.ts` 顶层执行 `app.listen`，而不是 Prisma/network 环境异常。若出现 TypeScript/Prisma client 编译错误，先记录为 `BLOCKED`，不得把环境失败冒充 RED。
- [ ] **Step 3: 更新 `P1-G-00`**：只有看到上述目标失败才将状态置为 `RED_REPRODUCED`，证据卡写完整 stdout/stderr、commit 和测试环境。

### Task 2: 最小拆分 app/server/db（P1-G-00 GREEN）

**Files:**

- Create: `backend/src/db/prisma.ts`
- Create: `backend/src/server.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/config/redis.ts`, `backend/src/config/minio.ts`, `backend/src/middleware/familyAccess.ts`
- Modify: `backend/src/services/categoryService.ts`, `backend/src/services/fileStorageService.ts`, `backend/src/services/aiActions.ts`, `backend/src/routes/*.ts` 中直接从 `../app` 导入 `prisma` 的引用
- Modify: `backend/package.json`
- Test: `backend/src/app.test.ts`

**Interfaces:**

- `backend/src/db/prisma.ts` exports `export const prisma = new PrismaClient()` and default `prisma`.
- `backend/src/app.ts` exports `export const createApp = (): Express`, `export const app = createApp()`, and default `app`; importing it never calls `listen`, `connectRedis`, or `ensureBucket`.
- `backend/src/server.ts` exports `startServer()` and only invokes it under the process entry path; `startServer` owns `app.listen`, `ensureBucket`, `connectRedis`, signal cleanup and `prisma.$disconnect()`.

- [ ] **Step 1: 写最小 `db/prisma.ts`**：把原 `app.ts` 的 `PrismaClient` 构造移入该文件；所有 production imports 改为 `../db/prisma`，不改变查询和 mutation。
- [ ] **Step 2: 写最小 `app.ts`**：保留 dotenv/security validation、CORS/body parser、health 和现有 route mounts；删除 `PORT`、`app.listen`、`ensureBucket`、`connectRedis`；CORS `allowedHeaders` 增加 `Idempotency-Key`、`If-Match`。
- [ ] **Step 3: 写最小 `server.ts`**：

```ts
import app from './app';
import { ensureBucket } from './config/minio';
import { connectRedis } from './config/redis';
import { prisma } from './db/prisma';

export async function startServer(): Promise<import('http').Server> {
  const port = Number(process.env.PORT || 8080);
  const server = app.listen(port, () => console.log(`Server is running on port ${port}`));
  await ensureBucket().catch(console.error);
  await connectRedis().catch((error) => console.error('Redis 连接失败，缓存和限流功能将降级运行:', error));
  const shutdown = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (require.main === module) void startServer();
```

- [ ] **Step 4: 更新 package scripts**：`dev` 改为 `ts-node-dev --respawn --transpile-only src/server.ts`，`start` 改为 `node dist/server.js`，保留 build/test scripts。
- [ ] **Step 5: 运行 focused GREEN**：`npm test -- --runInBand src/app.test.ts`；预期 `PASS` 且 listener/Redis/MinIO 三个断言均通过。
- [ ] **Step 6: REFACTOR（保持绿色）**：去重 Prisma import、为 `startServer` 建立明确的 `Server` 类型、把 shutdown handler 保持幂等；再次运行 focused test，预期仍 `PASS`。
- [ ] **Step 7: 运行回归**：`npm run build`；`npm test -- --runInBand --coverage`；预期 build 成功，测试不低于基线通过数，任何 Prisma generation/环境失败须单独记录而不篡改断言。
- [ ] **Step 8: 更新证据并提交**：更新 `P1-G-00.md` 为 `REGRESSION_VERIFIED`（若 build/test 仍被已知 Prisma client 环境阻塞则保持 `BLOCKED`/`AT_RISK`），提交 `refactor: separate app server and prisma lifecycle`。

### Task 3: 冻结稳定错误、命令和 coordinator 合同（P1-A-02/P1-B-02）

**Files:**

- Create: `backend/src/services/ledgerTypes.ts`
- Create: `backend/src/services/ledgerErrors.ts`
- Create: `backend/src/services/financialMutationCoordinator.ts`
- Create: `backend/src/services/ledgerApplicationService.ts`
- Test: `backend/src/services/ledgerApplicationService.test.ts`, `backend/src/services/financialMutationCoordinator.test.ts`

**Interfaces:**

```ts
export type MutationSource = 'MANUAL' | 'IMPORT' | 'RECURRING' | 'AI_CONFIRMATION' | 'BACKGROUND';
export type CreateIncomeCommand = { familyId: string; actorId: string; source: MutationSource; idempotencyKey: string; effectiveDate: Date; payload: { amount: number; category: string; description?: string | null; source?: string | null; currency?: string }; };
export type CreateExpenseCommand = { familyId: string; actorId: string; source: MutationSource; idempotencyKey: string; effectiveDate: Date; payload: { amount: number; category: string; description?: string | null; paymentMethod?: string | null; currency?: string }; };
export type UpdateIncomeCommand = CreateIncomeCommand & { incomeId: string; expectedVersion: number };
export type UpdateExpenseCommand = CreateExpenseCommand & { expenseId: string; expectedVersion: number };
export type DeleteIncomeCommand = Pick<CreateIncomeCommand, 'familyId'|'actorId'|'source'|'idempotencyKey'|'effectiveDate'> & { incomeId: string; expectedVersion: number };
export type DeleteExpenseCommand = Pick<CreateExpenseCommand, 'familyId'|'actorId'|'source'|'idempotencyKey'|'effectiveDate'> & { expenseId: string; expectedVersion: number };
export type MutationResult<T> = { operationId: string; resourceId: string; record?: T; version?: number; deduplicated: boolean };
export class DomainError extends Error { constructor(public readonly code: string, message: string, public readonly status: number, public readonly retryable = false) { super(message); } }
```

- [ ] **Step 1: 写 RED**：在 service test 中调用尚不存在的 `createIncome(command, prisma)`，断言 member 能得到 `resourceId/operationId/deduplicated=false`，viewer 得到 `FAMILY_WRITE_FORBIDDEN` 且 income create 未调用；在 coordinator test 中断言同 key 同 hash replay、同 key 不同 hash `IDEMPOTENCY_KEY_REUSED`。
- [ ] **Step 2: 运行 RED**：`npm test -- --runInBand src/services/ledgerApplicationService.test.ts src/services/financialMutationCoordinator.test.ts`；预期因 export/实现缺失失败，不能接受测试立即通过。
- [ ] **Step 3: GREEN 最小实现**：先实现纯 payload normalization/hash、`DomainError`、依赖注入的 Prisma transaction adapter；transaction 内按规定顺序调用 family membership、idempotency、income/expense mutation、audit 和 result 保存。Prisma P2002/P2025/P2034 只映射到稳定 domain code。
- [ ] **Step 4: 运行 GREEN**：同一 focused 命令；预期所有新增测试通过，replay 不再次调用 income/expense create。
- [ ] **Step 5: REFACTOR**：把 command payload validator、error mapper、transaction callback 分离为单一职责；focused test 必须保持绿色。
- [ ] **Step 6: 回归并证据**：`npm run build`、`npm test -- --runInBand src/services --coverage`；更新 `P1-A-02`、`P1-B-02` 证据卡和 API/ADR 引用。

### Task 4: Income/Expense route adapter 迁移（P1-A-01/P1-A-04/P1-A-05）

**Files:**

- Modify: `backend/src/routes/incomes.ts`, `backend/src/routes/expenses.ts`
- Create: `backend/src/routes/incomes.phase1.test.ts`, `backend/src/routes/expenses.phase1.test.ts`

**Interfaces:** route 只解析 `familyId`, `userId`, body, `Idempotency-Key`, `If-Match`，调用 `ledgerApplicationService`；保留 POST `201`、PUT resource、DELETE `{message}` 响应形状，并 additive 增加 `version`, `operationId`, `deduplicated`。

- [ ] **Step 1: 写 RED**：测试 POST/PUT/DELETE 不直接调用 `prisma.income|expense.create/update/delete`，而调用 service；测试 viewer、非成员、跨 family 和 missing/stale version 的错误码及零 mutation。
- [ ] **Step 2: 运行 RED**：`npm test -- --runInBand src/routes/incomes.phase1.test.ts src/routes/expenses.phase1.test.ts`；预期当前 route 仍直接 Prisma mutation，断言失败。
- [ ] **Step 3: GREEN**：删除 route-local `checkFamilyAccess` 和直接 mutation，使用统一 `requireFamilyWriteAccess` 及 service；兼容缺省 header 的旧请求，但有 header 时严格传入幂等/version；使用 stable error mapper。
- [ ] **Step 4: GREEN 验证**：focused route tests 全部 PASS；`npm test -- --runInBand src/routes/incomes.test.ts src/routes/expenses.test.ts src/tests/family-permissions.test.ts` 回归通过。
- [ ] **Step 5: REFACTOR**：提取 income/expense 共用的 route parsing helper，但不得重新引入第二份 family policy；运行上述 focused/regression commands。
- [ ] **Step 6: 证据/提交**：更新 P1-A-01/P1-A-04/P1-A-05，提交 `refactor: route ledger mutations through application service`。

### Task 5: Schema 幂等、版本和审计落地（P1-B-01/P1-A-06）

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260828100000_phase1_add_financial_versions_and_currency/migration.sql`
- Create: `backend/prisma/migrations/20260828100100_phase1_add_idempotency_and_audit/migration.sql`
- Test: `backend/src/tests/database.phase1.integration.test.ts`

- [ ] **Step 1: 写 integration RED**：在 `RUN_INTEGRATION=1` 时验证同 `(familyId, actorScope, operation, key)` 只能保留一个 IdempotencyRecord，Income/Expense 默认 `version=1,currency=CNY`，stale update 条件只能更新一行；无 PostgreSQL 时明确输出 `BLOCKED`。
- [ ] **Step 2: 运行 RED**：`npm run test:integration -- --runInBand`；预期 schema/model 缺失而失败，若数据库不可用则只登记 external block。
- [ ] **Step 3: GREEN**：按迁移顺序增加 additive model/columns/indexes/check constraints；使用非生产 DB 执行 `npx prisma migrate deploy`、`npx prisma validate`。
- [ ] **Step 4: 验证**：重复运行 integration；预期唯一仲裁和 stale version 断言 PASS-REAL；`npx prisma format --check` PASS。
- [ ] **Step 5: REFACTOR/回归**：检查所有现有 fixture 使用新默认字段；`npm run build`、`npm test -- --runInBand --coverage`；不以修改阈值规避失败。
- [ ] **Step 6: 证据/提交**：更新 P1-B-01/P1-A-06/P1-G-01，记录 migration SQL、数据库版本、回滚前向修复演练和剩余风险。

### Task 6: 真实 PostgreSQL 并发幂等门禁（P1-B-03/P1-B-04/P1-B-05）

**Files:**

- Modify: `backend/src/tests/database.phase1.integration.test.ts`
- Create: `backend/src/tests/phase1-concurrency.integration.test.ts`

- [ ] **Step 1: 写 RED**：启动 20 个并发同 key `createIncome`，断言一条 Income、一个 operation、19 个 replay；同 key 不同 hash 断言 409 且零新增记录；同时写 stale update 竞争断言一成功一 `VERSION_CONFLICT`。
- [ ] **Step 2: 运行并记录 RED**：`npm run test:integration -- --runInBand src/tests/phase1-concurrency.integration.test.ts`；无真实 PostgreSQL 标 `BLOCKED`，不能标 PASS-MOCK 关闭 gate。
- [ ] **Step 3: GREEN**：只补数据库仲裁/transaction 缺口，禁止使用 process Map 或 Redis lock 作为最终保障。
- [ ] **Step 4: 验证**：同命令 PASS-REAL；再运行 `npm run build` 和全部后端 coverage。
- [ ] **Step 5: 证据/提交**：更新 P1-B-03/P1-B-04/P1-B-05，提交 `test: prove database arbitrated ledger idempotency`。

### Task 7: Recurring exactly-once（P1-D-01~04）

**Files:**

- Modify: `backend/prisma/schema.prisma`, `backend/src/services/recurringService.ts`, `backend/src/routes/recurring.ts`
- Create: `backend/prisma/migrations/20260828100200_phase1_add_recurring_execution/migration.sql`
- Create: `backend/src/services/recurringService.phase1.test.ts`, `backend/src/routes/recurring.phase1.test.ts`

- [x] **Step 1: 写 RED**：覆盖 inactive、future、超过 endDate 均不创建 Income/Expense、不推进 `nextDate`；20 并发同 `scheduledFor` 只得到一条 entry 和一次 nextDate 推进。
- [x] **Step 2: 运行 RED**：`npm test -- --runInBand src/services/recurringService.phase1.test.ts src/routes/recurring.phase1.test.ts`；已观察旧 route/service 无法满足 occurrence exactly-once、原子推进和稳定 replay 合同。
- [x] **Step 3: GREEN**：以 `(recurringTransactionId, scheduledFor)` 唯一约束取得 execution，在同一 transaction 调 Ledger command、条件推进 rule、保存 result；竞争者在重新授权后返回已提交结果/replay。
- [x] **Step 4: 验证**：focused、backend build、Prisma validate/format、`npm run test:integration`、frontend tests/lint/build 和 fresh migration rehearsal 已执行；PostgreSQL gate 为 PASS-REAL。
- [x] **Step 5: REFACTOR/证据**：actor/membership/error mapping、审计归属、墓碑历史和前端 occurrence key 已校验；P1-D-01~04、ADR-0002/0006、tracker、memory 和 audit 已更新；实现提交为 `370b2d9`。

### Task 8: Server-side import preview 和 atomic confirm（P1-C-01~06）

**Files:**

- Modify: `backend/prisma/schema.prisma`, `backend/src/services/importService.ts`, `backend/src/routes/import.ts`
- Create: `backend/prisma/migrations/20260828100300_phase1_add_import_batch/migration.sql`
- Create: `backend/src/services/importService.phase1.test.ts`, `backend/src/routes/import.phase1.test.ts`
- Modify: `frontend/src/services/importService.ts`, `frontend/src/pages/ImportPage.tsx`
- Create: `frontend/src/pages/ImportPage.phase1.test.tsx`

- [ ] **Step 1: 写 RED**：超过 byte/row/field limit 返回 `413 IMPORT_LIMIT_EXCEEDED`；confirm 只发送 batch/hash/category patch，不接受客户端篡改 date/amount/type；第 N 行 invalid 时所有 Income/Expense 为零且 batch 可重试。
- [ ] **Step 2: 运行 RED**：`npm test -- --runInBand src/services/importService.phase1.test.ts src/routes/import.phase1.test.ts`；预期现有内存数组和逐行写入失败。
- [ ] **Step 3: GREEN**：preview 事务外解析/规范化，持久化 `ImportBatch`/`ImportRow`；confirm 服务端重新校验全部行，条件推进 batch 并在一个 transaction 批量调用 Ledger；相同 batch 并发只提交一次。
- [ ] **Step 4: 验证**：focused backend tests；`npm test -- --runInBand src/routes/import.test.ts`；前端 `npm test -- ImportPage.phase1.test.tsx`。
- [ ] **Step 5: REFACTOR**：提取 parser/resource-limit/canonical payload helper；前端显示 batch status、失败行、confirm 状态，稳定保存 idempotency key。
- [ ] **Step 6: integration/证据**：`npm run test:integration`、`npm run lint`、`npm run build`（frontend）；更新 P1-C-01~06，提交 `feat: make import preview server-owned and atomic`。

### Task 9: AI/OCR proposal-only 和显式确认（P1-E-01~06）

**Files:**

- Modify: `backend/prisma/schema.prisma`, `backend/src/services/aiService.ts`, `backend/src/services/ocrService.ts`, `backend/src/services/aiActions.ts`, `backend/src/routes/ai.ts`
- Create: `backend/prisma/migrations/20260828100400_phase1_add_ai_proposal/migration.sql`
- Create: `backend/src/services/aiProposalService.ts`, `backend/src/services/aiProposalService.test.ts`, `backend/src/routes/ai.phase1.test.ts`
- Modify: `frontend/src/services/aiService.ts`, `frontend/src/pages/AIPage.tsx`
- Create: `frontend/src/pages/AIPage.phase1.test.tsx`

- [ ] **Step 1: 写 RED**：text chat/OCR 产生 create action 时，proposal 持久化但确认前 Income/Expense/Asset/Liability 计数不变；viewer、跨 family、过期、hash/version mismatch、双击确认全部零副作用；编辑后 original/confirmed payload 分离。
- [ ] **Step 2: 运行 RED**：`npm test -- --runInBand src/services/aiProposalService.test.ts src/routes/ai.phase1.test.ts`；预期现有 `executeActions` 直接逐条写账，断言失败。
- [ ] **Step 3: GREEN**：保存 AI 原始输出和规范化 `AIProposalItem`；确认请求只信 batch-owned proposalId/version/hash，重新验证 final actions，事务内抢占 proposal、调用 Ledger/Balance coordinator、写 audit、保存 result；原 `execute-actions` 兼容 adapter 不可绕过 coordinator。
- [ ] **Step 4: 验证**：focused + `src/routes/ai.test.ts` + family permission negative tests；前端组件测试必须验证 confirm/cancel/loading/error。
- [ ] **Step 5: REFACTOR/证据**：统一 proposal status/error mapper，前端明确“待确认”；更新 P1-E-01~06、ADR-0004，提交 `feat: require explicit confirmation for ai mutations`。

### Task 10: 期间、币种和 reconciliation（P1-F-01~05）

**Files:**

- Create: `backend/src/services/periodWindowService.ts`, `backend/src/services/periodWindowService.test.ts`
- Create: `backend/src/services/currencySummaryService.ts`, `backend/src/services/currencySummaryService.test.ts`
- Modify: `backend/src/routes/reports.ts`, `backend/src/routes/budgets.ts`, `backend/src/routes/compare.ts`, `backend/src/routes/goals.ts`
- Create: `backend/src/utils/reconciliation.ts`, `backend/src/utils/reconciliation.test.ts`

- [ ] **Step 1: 先取得决策证据**：Finance/Product Owner 对 family timezone、half-open `[start,end)`、base currency、missing FX、goal contribution 形成 ADR-0005 accepted 记录；未批准前不改变统计语义。
- [ ] **Step 2: 写 RED**：覆盖月末/季度/年度、闰年、DST 边界；混合币种返回 `totalsByCurrency` 不生成伪 total；fixture 断言 `netIncome=income-expense`、cash flow 含所有显示类别、dashboard/balance sheet 一致。
- [ ] **Step 3: 运行 RED**：`npm test -- --runInBand src/services/periodWindowService.test.ts src/services/currencySummaryService.test.ts src/utils/reconciliation.test.ts`；预期缺少 service 或当前统计边界失败。
- [ ] **Step 4: GREEN**：实现共用 `PeriodWindow` 和币种汇总；report/budget/compare/goal 只消费 service，未知金额明确为 unavailable 而非零。
- [ ] **Step 5: 验证/REFACTOR**：focused + reports/budgets/compare/goals regression；抽取纯公式保持无 DB 副作用；更新 P1-F-03~05 和 ADR-0005。

### Task 11: 前端 mutation、E2E 和基础设施门禁（P1-G-02~06）

**Files:**

- Modify: `frontend/src/services/api.ts`, affected `frontend/src/services/*.ts`, `frontend/src/pages/*.tsx`
- Create: `frontend/src/test/mutation-contract.test.tsx`
- Create: `frontend/tests/phase1-critical-journeys.spec.ts`
- Modify/Create: `frontend/playwright.config.ts`, root `docker-compose.yml` as needed
- Create: `docs/delivery/phase-1/evidence/P1-G-02.md` through `P1-G-06.md` updates

- [ ] **Step 1: 写 RED**：组件/service tests 覆盖 loading/error/confirm/replay、stable `Idempotency-Key` 和 `If-Match`；Playwright 先写登录、family switch、CRUD、viewer deny、import confirm、AI confirm 旅程。
- [ ] **Step 2: 运行 RED**：`npm test`、`npm run test:e2e`；预期新行为未实现而失败，缺少 Compose/Playwright 环境则记录 BLOCKED。
- [ ] **Step 3: GREEN**：所有 mutation 通过 configured API client；lazy load heavy route pages；禁止把 network error 当成功；proposal/batch status 在刷新后可恢复。
- [ ] **Step 4: 验证**：从 `frontend/` 运行 `npm run lint && npm test && npm run build && npm run test:e2e`；检查 browser console、未处理 Promise、跨 family 残留。
- [ ] **Step 5: 基础设施门禁**：运行 `docker compose config --quiet`、`docker compose build`、`docker compose up -d --wait`；验证 Redis stop/restart、MinIO object/metadata 生命周期和 PostgreSQL migration/restart/replay。
- [ ] **Step 6: 证据/回滚**：更新 P1-G-02~06；任何重复写、跨租户、对账错误时暂停入口并保留事实，按 Section 2 前向修复/恢复演练处理。

### Task 12: 完整审查、Graphify、发布和退出评审（P1-H-01~04）

**Files:**

- Modify: `docs/project-memory.md`
- Modify/Create: `docs/audit/2026-08-27-homefinance-deep-audit-report.md`, `docs/audit/2026-08-27-homefinance-integrated-remediation-plan.md` and relevant `docs/audit/parallel-analysis/*`
- Modify: `docs/adr/0001-unified-financial-mutation-coordinator.md` through `docs/adr/0005-period-and-currency-semantics.md`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md` and every completed evidence card
- Modify generated Graphify outputs through the approved incremental workflow, not hand editing

- [ ] **Step 1: 汇总质量门禁**：backend `npm run build`、`npm test -- --runInBand --coverage`、`npm run test:integration`、Prisma validate/format；frontend lint/test/build/E2E；Compose health/restart；记录实际输出。
- [ ] **Step 2: 只读审查**：检查 route 无受控直接写入、family authorization 在 cache/DB/object/AI 前、viewer 全 mutation deny、最终 admin 保护、所有 AI/import/recurring 路径均 coordinator 化。
- [ ] **Step 3: 更新长期记忆和 Graphify**：把已由 schema/test/实现证实的事实写入 project memory；区分 `EXTRACTED` 与 `INFERRED`；运行 `/graphify . --update` 或仓库对应 semantic incremental workflow，并复核 `graphify-out/graph.json/html`。
- [ ] **Step 4: 发布回滚演练**：staging expand/backfill/dual-read-write/contract、restart、retry、故障注入、恢复；只在 `PASS-REAL`/`PASS-E2E`/`OBSERVED` 证据齐全后推进状态。
- [ ] **Step 5: 退出评审**：P0/P1 风险必须已修复或有责任人、期限和正式接受；将 tracker 状态推进到 `IN_REVIEW`，等待 Repository Owner/Technical Approver/Finance/Product Owner/Release Owner 的对应批准。

## 4. 每个任务的固定提交和 tracker 更新点

每个行为任务都必须产生以下可追踪记录，然后才进入下一任务：

1. `RED_REPRODUCED`：证据卡记录精确测试名、命令、目标失败、branch/commit、环境。
2. `GREEN_MINIMAL`：记录最小代码范围、focused PASS 和新增/修改 API 合同。
3. `REFACTORED`：记录保持绿色的重构和无行为变化说明。
4. `REGRESSION_VERIFIED`：记录相关 build/lint/unit/integration/component/E2E 命令和结果；真实环境不可用时保留 `BLOCKED`，不伪造 PASS。
5. `IN_REVIEW`：记录 reviewer、未解决风险、ADR/memory/Graphify 是否同步。

证据卡统一模板为 `docs/delivery/phase-1/evidence/_TEMPLATE.md`。代码提交采用小提交：每个独立 GREEN/REFACTOR/迁移或证据单元一个 commit，commit message 必须表达行为；不将未验证的大批代码混入一次提交。任何 rollback 都记录被关闭的入口、保留的 schema/facts、恢复 commit 和复测命令。

## 5. 自审结论

- 规格覆盖：进程边界、统一 mutation、数据库幂等/版本/审计、Recurring、Import、AI proposal、期间/币种/对账、RBAC、真实基础设施、前端/E2E、Graphify、发布和回滚均有任务。
- 类型一致性：Task 3 定义的 `MutationSource`、create/update/delete commands、`MutationResult` 和 `DomainError` 是 route、Recurring、Import、AI 后续任务的共享输入/输出；不会在后续任务另造 route-local coordinator。
- 环境风险：当前 Prisma Client 生成和真实 PostgreSQL/Redis/MinIO/Compose 尚未完全验证，相关证据保持 `NOT_RUN` 或 `BLOCKED`；这不阻止 Wave 0 app 隔离。
- 回滚结论：Phase 1 不使用破坏性 down migration；新入口以 feature flag/adapter 关闭，schema 和审计事实保留，以前向修复或备份恢复完成回退。
