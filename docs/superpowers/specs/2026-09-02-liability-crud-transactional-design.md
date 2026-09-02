# Liability CRUD 事务化迁移设计

- 日期：2026-09-02
- 实施分支：`codex/phase1-ledger-trust`
- 设计基线：`d4da394`（普通 Asset CRUD 已完成事务化迁移）
- 关联任务：`P1-A-09`
- 设计状态：已获对话批准，等待书面规格审阅
- 相关长期规则：`docs/project-memory.md`
- 相关决策：ADR-0001、ADR-0002、ADR-0007

## 1. 目标与非目标

### 1.1 目标

将普通 Liability 的 family-scoped HTTP 入口迁移到已经用于 Asset 的统一 Balance/FinancialMutationCoordinator 边界，使每次创建、更新和删除具备：

1. 先授权、后资源访问和写入；
2. 单一 PostgreSQL transaction 内的资源事实、AuditEvent、IdempotencyRecord 和 `Family.cacheVersion` 提交；
3. 同一幂等 key/hash 的安全重放，以及 key 重用冲突拒绝；
4. 更新/删除的 `version` CAS，避免陈旧客户端覆盖并发修改；
5. viewer、非成员、跨 family、非法输入、事务失败和并发竞争的零部分写入证据；
6. 既有 Liability URL、主要字段和成功响应保持兼容。

### 1.2 非目标

本切片不实现 Liability 估值、余额查询、资产负债表公式、跨币种换算、利率语义重定义、前端页面重写、软删除或历史修正事件，也不改变 AI proposal 已有的 Balance confirmation 边界。Liability `amount`、`interestRate` 的现有数值表示保持不变。

## 2. 当前问题与目标边界

当前 `backend/src/routes/liabilities.ts` 的 GET、POST、PUT、DELETE 都有 route-local `checkFamilyAccess`；三个写入口直接调用 Prisma `liability.create/update/delete`。这会使写入绕过共享幂等、审计、版本和事务协调器。

目标路径为：

    JWT authentication
      -> requireFamilyAccess / requireFamilyWriteAccess
      -> Liability route adapter（只做 HTTP 解析和响应）
      -> Balance Mutation Service
      -> Financial Mutation Coordinator
      -> Prisma transaction client
      -> Liability + AuditEvent + IdempotencyRecord
      -> PostgreSQL cacheVersion trigger

路由中不得保留第二份 family membership 查询，也不得直接调用 Liability 的 `create`、`update` 或 `delete`。

## 3. 设计方案

### 3.1 API 与授权

- `GET /api/families/:familyId/liabilities` 使用 `authMiddleware` + `requireFamilyAccess`；保留现有完整列表和分页响应。
- `POST /api/families/:familyId/liabilities` 使用 `authMiddleware` + `requireFamilyWriteAccess`，调用 `createLiability`。
- `PUT /api/families/:familyId/liabilities/:id` 使用相同写权限中间件，调用 `updateLiability`。
- `DELETE /api/families/:familyId/liabilities/:id` 使用相同写权限中间件，调用 `deleteLiability`。
- coordinator 在 transaction 内再次验证 actor membership；middleware 是 HTTP 快速拒绝，不能替代事务内授权。
- viewer、未知角色、非成员和未认证用户在访问写服务或资源前被拒绝，拒绝路径不得创建幂等记录、审计事件或 Liability。
- 跨 family 的 `id` 按当前统一合同返回 `RESOURCE_NOT_FOUND`，不泄露资源存在性。

保留当前字段校验和成功状态：创建 201、更新 200、删除 200。响应使用现有 `mutationResource` / `mutationDeleteResponse` 兼容结构，新增 `version`、`operationId`、`deduplicated`；删除继续包含 `message: '删除成功'`。重复成功响应设置 `Idempotency-Replayed: true`。

### 3.2 Command 与 Balance service

扩展 `backend/src/services/ledgerTypes.ts` 和 `balanceMutationService.ts`：

- 已有 `CreateLiabilityCommand` 继续作为创建输入；新增 `UpdateLiabilityCommand` 和 `DeleteLiabilityCommand`，字段形态与 Asset 对称。
- 新增 `createLiability`，将已存在的 `createLiabilityInTransaction` 包装进 coordinator。
- 新增 `updateLiability` 和 `deleteLiability`；校验 family、actor、source、幂等 key、id、正整数 expectedVersion、金额、日期、币种和文本字段。
- `CREATE_LIABILITY`、`UPDATE_LIABILITY`、`DELETE_LIABILITY` 加入 `FinancialMutationOperation` 和 Prisma operation 白名单。
- `createLiabilityInTransaction` 只使用传入的 transaction client；普通和 AI confirmation 不允许回到 root Prisma client。
- 共享金额/日期/币种规范化规则；币种转为大写三字母代码，`-0` 归一为 `0`，日期复制为独立有效 `Date`。
- Liability 类型的 HTTP allow-list 保持现有六项：`MORTGAGE`、`CAR_LOAN`、`STUDENT_LOAN`、`CREDIT_CARD`、`PERSONAL_LOAN`、`OTHER`。

更新流程：先在 family scope 读取资源；不存在返回 404；若未给 `If-Match`，在同一 transaction 使用读取到的当前 version 保持兼容；随后执行 `id + familyId + version` 的 `updateMany`。条件更新为零时返回 409 `VERSION_CONFLICT`，成功后读取新记录并将 version 加一。

删除流程：以同样的 family/version 条件执行 `deleteMany`；成功返回删除前 version，失败返回稳定的 `VERSION_CONFLICT`。所有 before/after 数据由 coordinator 写入审计；删除后的 response 不依赖再次读取已删除资源。

### 3.3 Persistence adapter 与 schema

在 `backend/prisma/schema.prisma` 为 `Liability` 增加：

```prisma
version Int @default(1)
```

使用 additive migration：

1. `ALTER TABLE "Liability" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1`；
2. 增加 `Liability_version_check CHECK ("version" > 0)`；
3. 不删除、不重写既有 Liability 数据和关系。

在 `createPrismaLedgerTransactionClient` 中补齐 Liability 的 `findFirst`、`updateMany`、`deleteMany`，并让 record adapter 保留 Decimal 转 number 与 version。所有条件查询必须带 `id` 和 `familyId`。

### 3.4 Coordinator、审计与幂等

每个写命令使用规范化 request payload，按现有 coordinator 协议执行：

1. 事务内核验 family membership；
2. 计算 hash，并创建或读取 scoped `IdempotencyRecord`；
3. 执行 Liability mutation；
4. 写 `AuditEvent`，实体为 `Liability`，action 为 `CREATE`、`UPDATE` 或 `DELETE`；
5. 持久化可重放响应；
6. 由既有 Liability cache trigger 推进 `Family.cacheVersion`；
7. 一次提交。

同 key/hash 返回原响应且不新增 Liability；同 key/不同 hash 返回 `409 IDEMPOTENCY_KEY_REUSED`，不改变 Liability、幂等、审计和 revision。数据库唯一约束是并发仲裁事实源，不能依赖进程锁或 Redis lock。

### 3.5 错误合同

| 场景 | HTTP | code | retryable |
|---|---:|---|---:|
| Zod/domain 输入非法、非法 If-Match | 400 | `VALIDATION_FAILED` | false |
| 未认证 | 401 | `UNAUTHENTICATED` | false |
| 非成员/viewer/未知角色 | 403 | `FAMILY_WRITE_FORBIDDEN` | false |
| 当前 family 不存在该资源 | 404 | `RESOURCE_NOT_FOUND` | false |
| 同 key 不同 payload | 409 | `IDEMPOTENCY_KEY_REUSED` | false |
| stale version 或 CAS 竞争失败 | 409 | `VERSION_CONFLICT` | false |
| 未分类异常 | 500 | `INTERNAL_ERROR` | false |

错误响应继续保留中文 `error` 字段；不暴露 SQL、Prisma 原始错误或其他 family 的资源信息。

## 4. 测试设计（严格 TDD）

实施必须先新增一个聚焦 failing test，运行并记录目标缺陷的 RED，再写最小实现。建议顺序如下：

| 测试层 | 必须证明 |
|---|---|
| `balanceMutationService.test.ts` | create/update/delete command 规范化、family/version 条件、404/409、事务 writer 使用和非法输入零调用 |
| `prismaFinancialMutationStore.test.ts` | Liability transaction adapter 将 Decimal、version 和条件谓词正确映射 |
| `liabilities.test.ts` | GET 使用集中 middleware；三种写入调用 Balance service；路由不直接调用 Prisma mutation；headers、响应兼容、viewer/非成员和非法 If-Match |
| schema contract test | Liability version 字段、正数约束和新 migration 存在 |
| PostgreSQL integration | migration/fresh schema、member HTTP create/update/delete、同 key replay、不同 hash 冲突、stale update/delete、跨 family/reader denial、20 路相同 create 并发、注入事务失败零副作用 |
| full regression | backend build、完整单元 coverage、integration、Prisma validate/format；确认既有 AI Balance 与 Asset 行为不回归 |

真实集成验收至少包含以下不变量：

- 20 个相同 create 请求最多一条 Liability、一个 IdempotencyRecord 和一个 AuditEvent，其余为 replay；
- 两个相同 expectedVersion 的更新/删除最多一个成功，失败方 409 且不产生第二次事实；
- replay、key conflict、stale version、viewer/non-member、跨 family 和失败注入都不留下部分状态；
- 成功 mutation 只推进一次对应 PostgreSQL transaction 中实际触发的 `cacheVersion`；拒绝和 replay 不额外推进 revision。

## 5. 迁移、兼容与回滚

迁移采用 expand/backfill/contract 的 additive 策略。现有行由数据库默认 `version=1`，旧客户端缺少 `If-Match` 时暂时按 transaction 内读取版本执行；使用 `If-Match` 的客户端获得明确 CAS 保护。`Idempotency-Key` 缺失时沿用共享 adapter 的兼容行为，但调用方无法依靠该请求跨重试获得稳定 key。

回滚只允许前向修复或按入口回退到单一旧 handler，禁止双写和删除 `version`、AuditEvent、IdempotencyRecord。若新服务在发布观察期间出现重复写、跨租户访问或对账影响，暂停 Liability mutation 入口，保留已提交审计/事实，通过兼容修复恢复；不通过删除历史数据来“回滚”。

## 6. Definition of Done

本切片只有在以下条件同时满足时才标记 `REGRESSION_VERIFIED`：

1. 有可复现目标缺陷 RED 和最小 GREEN 记录；
2. Liability route 无直接 Prisma 写 mutation、无 route-local family access copy；
3. focused tests、backend build、完整单元测试和相关 PostgreSQL integration 全部通过；
4. Prisma validate/format 及 fresh/incremental migration 通过；
5. viewer、非成员、跨 family、stale、replay、key conflict、并发和 rollback 负向证据齐全；
6. tracker、evidence、project memory、audit risk 和 Graphify 状态如实同步；
7. Docker/Redis/MinIO/E2E 未运行时保持原有 BLOCKED/NOT_RUN，不得借本切片升级这些证据等级。

书面规格审阅通过后，下一步才创建独立实施计划并开始 TDD 编码。
