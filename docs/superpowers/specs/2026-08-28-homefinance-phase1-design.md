
# HomeFinance Phase 1 可信账本与质量门禁设计

- 日期：2026-08-28
- 设计基线：codex/phase0-remediation@081084a
- 实施分支：codex/phase1-ledger-trust
- 设计状态：已获对话批准，等待书面规格审阅
- 任务追踪主文件：docs/delivery/phase-1/phase-1-tracker.md
- 审查基线：docs/audit/2026-08-27-homefinance-integrated-remediation-plan.md

## 1. 目标和非目标

### 1.1 目标

Phase 1 将 HomeFinance 从功能入口较完整的模块化单体原型推进为交易写入可验证、可重放、可观察的生产候选工程：

1. 收入、支出、导入、定期记账和 AI 财务 mutation 使用统一的授权、校验、事务、幂等和审计提交协议。
2. 同一请求重试、客户端双击、worker 并发和响应丢失不会生成重复财务事实。
3. 导入确认整批原子；AI 输出先成为服务端 proposal，显式确认后才写入。
4. 普通更新具备乐观并发语义，旧版本不能覆盖新版本。
5. 报表、预算、目标和币种行为具有明确期间、汇总和对账合同。
6. PostgreSQL、Redis、MinIO、Compose 和浏览器关键旅程成为退出证据。
7. 任务、测试证据、架构决策、项目记忆和 Graphify 随提交持续追踪。

### 1.2 非目标

本阶段不物理合并 Income 与 Expense，不拆分微服务，不重写前端，不把 Redis 变成事实源，不把 MinIO 或 AI provider 放入 PostgreSQL 事务，不实现无人值守的后台 recurring scheduler，也不扩大 AI 自动写入权限。

没有汇率源、估值日和舍入规则时，不承诺完整多币种估值。后台执行 actor、历史汇率和离线同步另立决策和项目。

## 2. 基线与不可削弱的不变量

main 当前为 ee5d813；Phase 0 实施提交 081084a 位于 codex/phase0-remediation。因此本阶段分支从 081084a 创建，不自动合并 main。

已确认事实：

| 事实 | 证据 | 设计影响 |
|---|---|---|
| Income、Expense 独立存储 | backend/prisma/schema.prisma | 通过服务层统一，不物理合并 |
| 普通路由直接写 Prisma | backend/src/routes/incomes.ts、expenses.ts | 改成 application service adapter |
| import confirm 接收完整客户端 items 并逐行写入 | backend/src/routes/import.ts | 改为服务端 batch 和整批原子 |
| recurring 先写账再推进规则且无执行唯一记录 | backend/src/routes/recurring.ts | 新增 RecurringExecution 和同事务执行 |
| 文本 AI 会直接执行 actions | backend/src/routes/ai.ts、backend/src/services/aiActions.ts | text/OCR 统一 proposal-only |
| AI action 也覆盖 Asset/Liability | backend/src/services/aiActions.ts | AI 确认使用 FinancialMutationCoordinator |
| Phase 0 使用 PostgreSQL trigger 推进 Family.cacheVersion | backend/prisma/migrations/20260827190000_add_durable_family_cache_revision/migration.sql | 初期不手工重复 bump |
| app.ts 导入时启动 listener 和 Redis | backend/src/app.ts | 先分离 app、server、db |
| 真实 PostgreSQL、Redis、MinIO、Compose、E2E 未完成验证 | docs/audit/2026-08-27-homefinance-phase0-implementation-report.md | 必须区分 mock、real、E2E 和 observed |

不可削弱：

- familyId 是租户边界；授权必须先于 cache、DB、object storage 和 AI。
- viewer 在所有 mutation 入口只读；最后一名 admin 不可删除或降级。
- 无可靠换算时不同币种只能分组返回。
- net income、net cash flow、balance sheet 和 dashboard 必须按同一口径对账。
- 交易生成操作必须原子、幂等；AI 输出必须显式确认并经过同样的授权、校验、审计和事务。

## 3. 推荐架构

请求路径为：

    React UI 或未来受控 worker
      -> configured API client 或 application command
      -> authentication
      -> Family Policy
      -> Express route adapter
      -> Financial Mutation Coordinator
      -> Ledger Application Service / Balance Mutation Service
      -> Idempotency Coordinator + Audit Event Writer
      -> 一个 Prisma transaction
      -> PostgreSQL
      -> Family.cacheVersion trigger

外部依赖路径与财务事务隔离：

    report route -> authorize -> versioned Redis cache -> Report Query/Formula Service
    import preview -> parse and validate -> persist ImportBatch/ImportRow
    AI/OCR -> provider or local parser -> persist AIProposal
    file upload -> MinIO boundary -> File metadata compensation policy

### 3.1 进程边界

将当前启动职责拆开：

| 文件 | 唯一责任 |
|---|---|
| backend/src/app.ts | 构造 Express app、middleware 和 routes；不得 listen |
| backend/src/server.ts | listen、Redis 初始化、优雅退出和进程信号 |
| backend/src/db/prisma.ts | 构造并导出 Prisma client |

服务通过构造函数注入 Prisma client 或 transaction client，不从 app.ts 导入数据库实例。这样 route test、service test 和真实 app test 不会因 import 产生 listener 或外部依赖副作用。

### 3.2 服务职责

| 组件 | 负责 | 不负责 |
|---|---|---|
| Route adapter | HTTP、状态码、请求头、兼容字段 | 事务、重复权限、直接写账 |
| Family Policy | membership、role、resource family | cache 授权、财务公式 |
| Ledger Application Service | Income/Expense command 编排 | Express request/response |
| Balance Mutation Service | Asset/Liability mutation | AI 可信度判断 |
| Financial Mutation Coordinator | 跨领域 proposal 的同一事务编排 | 外部服务事务 |
| Validator | 金额、日期、类别和 payload | DB 访问、副作用 |
| Idempotency Coordinator | key、payload hash、重放和冲突 | 内存锁作为最终保障 |
| Audit Event Writer | 同事务写不可变审计事件 | 业务状态决定 |
| Report Query/Formula Service | 聚合、期间、币种和 reconciliation | 交易写入 |

## 4. 统一写入合同

服务层使用判别联合命令：

    CreateIncomeCommand
    CreateExpenseCommand
    UpdateIncomeCommand
    UpdateExpenseCommand
    DeleteIncomeCommand
    DeleteExpenseCommand
    ExecuteRecurringCommand
    ConfirmImportBatchCommand
    ConfirmAIProposalCommand

每个 mutation 命令包含 familyId、actorId 或明确受控 actor scope、source、idempotencyKey、规范化 payload、effectiveDate，以及更新/删除所需的 expectedVersion。source 取 MANUAL、IMPORT、RECURRING、AI_CONFIRMATION 或 BACKGROUND；BACKGROUND 在本阶段只保留合同，不实现无人值守执行。

服务结果至少包含 operationId、受影响资源 ID、deduplicated、最新 version 和可安全重放的业务响应引用。

### 4.1 事务序列

所有数据库 mutation 在一个事务内完成：

1. 再次验证 actor 对 familyId 的 membership 和 role。
2. 对规范化 payload 计算 requestHash，创建或读取幂等记录。
3. 验证资源存在并属于当前 family。
4. 执行 Income/Expense 或 Balance mutation。
5. 写 AuditEvent。
6. 更新 import、recurring execution 或 AI proposal 状态。
7. 保存可重放结果。
8. 由现有 PostgreSQL trigger 推进 Family.cacheVersion。
9. 一次提交。

Redis、MinIO 和 AI provider 不参与上述财务事务，也不能决定财务事实是否提交。

### 4.2 幂等和并发

- 同 family、actor scope、operation、key 且 hash 相同：返回原结果，deduplicated=true，并返回 Idempotency-Replayed。
- 同 key 但 hash 不同：返回 409 IDEMPOTENCY_KEY_REUSED，零写入。
- 并发由数据库唯一约束在 commit time 仲裁；先查后写、进程内 Map 或 Redis lock 不能作为最终保障。
- 首次事务回滚时幂等记录也回滚，可使用同 key 重试。
- 更新/删除使用 familyId、id、version 条件；旧版本返回 409 VERSION_CONFLICT。
- Prisma P2002、P2025、P2034 映射到稳定业务错误；未知异常不能伪装为安全可重试。

## 5. 数据库设计和迁移

Phase 1 采用 additive migration，不删除历史数据。

| 模型或变更 | 关键字段/约束 | 作用 |
|---|---|---|
| IdempotencyRecord | familyId、actorScope、operation、key、payloadHash、httpStatus、responseJson；唯一 familyId+actorScope+operation+key | 重放和 commit-time 仲裁 |
| AuditEvent | familyId、mutationId、actorUserId 可空、actor snapshot、action、entity、before/after、createdAt | 不可变变更轨迹 |
| RecurringExecution | familyId、recurringTransactionId、scheduledFor、entry、mutation；唯一 recurringTransactionId+scheduledFor | exactly-once |
| ImportBatch | family、actor、format、file hash、parser version、preview hash、status、row count | preview/confirm 生命周期 |
| ImportRow | batch、row number、canonical payload、validation errors、result entry | 行级追踪 |
| AIProposal | family、actor、来源、original payload/hash、confirmed payload、status、version、expiresAt | AI 提议和确认边界 |
| AIProposalItem | proposal、ordinal、typed action、canonical data、result | 可编辑 action 明细 |

现有模型 additive 修改：

- Income 和 Expense 增加 version、originType、originRef，历史版本回填 1。
- Income 和 Expense 增加 currency，历史回填 CNY；Family 增加 baseCurrency，默认 CNY。
- RecurringTransaction 增加版本和 execution 关系；interval 必须大于 0。
- 创建者关系不再使用会删除财务事实的 Cascade；财务事实建议 Restrict，AuditEvent.actorUserId 使用 SetNull 并保留 actor snapshot。
- 能表达的金额和版本约束使用 CHECK；不在同一迁移中批量重做所有历史 String 类型。

### 5.1 Revision 决策

Phase 0 trigger 是当前 revision 事实源。Phase 1 初期 service 不手工 bump，不增加第二个 commit hook。批量导入逐行 trigger 增量只影响缓存效率，不影响正确性。只有真实 PostgreSQL 锁竞争和数据测量证明需要优化时，才另立 ADR 改为每命令一次 revision。

### 5.2 迁移顺序

采用 expand、backfill、dual read/write、contract：

1. Expand：增加表、可空列、索引和约束，旧代码仍可运行。
2. Backfill：在 staging 和备份副本核对行数、唯一性、金额、日期和币种。
3. Dual read/write：兼容窗口内服务写新模型，旧响应由 adapter 返回；不静默改变财务结果。
4. Contract：所有客户端迁移并完成观察后，移除旧 raw-items/raw-actions 旁路。

Prisma 没有安全自动 down migration。回滚优先使用前向修复或恢复演练，不删除 operation、audit、execution、batch 或 proposal 事实。

## 6. 入口迁移

### 6.1 普通收入/支出

保留现有 URL 和主要响应形状；create 继续 201，update 返回资源，delete 保留 message，同时以非破坏性字段增加 version、operationId。路由只解析 HTTP 和调用服务，不再直接调用 income/expense create、update、delete。

### 6.2 Recurring

事务固定 scheduledFor=nextDate，并验证 rule 属于 family、isActive、nextDate 不晚于当前时间且未超过 endDate。先创建 RecurringExecution 取得唯一执行权，再由 Ledger service 创建账目，条件推进 rule，记录审计和结果。竞争者返回已提交结果或 replay，不返回 500。规则删除不级联历史 execution。

后台 scheduler 不在本阶段实现。没有 system actor ADR 前，不使用虚构用户或 recurring 创建者替代系统 actor。

### 6.3 Import

解析、资源限制和规范化在事务外完成。preview 持久化 ImportBatch/ImportRow 并生成版本/hash。confirm 只接受 batch ID、expected preview hash、受控 category patch 和幂等 key，不信任客户端回传金额、日期和类型。

全部行先完成服务端校验；任意失败返回明确错误且账本写入为零。确认事务条件更新 batch，调用 Ledger 批量创建，写审计并保存结果。同一 batch 并发确认只成功一次，重试返回原结果。

这是有意改变当前 partial success 合同。旧测试先保留为历史行为证据，首个新 RED 证明新合同缺失后再替换为整批原子断言。

### 6.4 AI proposal

text 和 OCR 都先持久化 proposal，不直接执行 actions。proposal 保存原始 AI 输出、规范化 action、来源 conversation/file、hash、状态和过期时间。

确认请求包含 proposalId、expectedVersion 或 originalHash、用户编辑后的 final actions 和 Idempotency-Key。final actions 仍是不可信输入，必须重新严格校验；原始 payload 与 confirmed payload 分开保存，以支持编辑/删除。确认事务条件抢占 proposal，调用 Ledger 或 Balance service，写审计并更新 proposal；默认整批原子。

execute-actions 在兼容窗口保留路径。新前端必须使用 proposal 合同；旧 raw actions 仅由严格验证的迁移 adapter 接收，不能绕过统一事务，窗口结束后移除。

### 6.5 Asset/Liability

AI 当前也能创建和删除 Asset/Liability，因此 AI proposal confirm 使用 FinancialMutationCoordinator，在同一事务内调用 Ledger 和 Balance Mutation Service。普通资产/负债 CRUD 的全面迁移不扩大到本阶段关键路径，除非共享 policy、idempotency、audit 和 transaction 合同需要。

## 7. API、错误和权限合同

### 7.1 兼容策略

- URL 保持不变。
- 资源响应增加 version；recurring 增加 executionId 和 deduplicated。
- 错误保留 error 字段，增加 code、requestId、retryable。
- 新前端为每次用户 mutation 保存稳定 idempotency key；retry 不能重新生成。
- CORS 允许 Idempotency-Key 和 If-Match。
- 兼容窗口允许缺省 header，但缺省请求不享有跨请求 exactly-once；窗口后受控 mutation 强制 key/version。
- csv 新接口返回 batchId/hash；旧数组响应保留兼容 adapter。
- chat 保留 response/actions/proposedActions 字段，新 mutation 返回 actions 为空和 proposal 信息；手工记账走普通账本 API。

### 7.2 错误映射

| HTTP | code | 含义 |
|---:|---|---|
| 400 | VALIDATION_FAILED | 结构、格式或规范化失败 |
| 401 | UNAUTHENTICATED | JWT 缺失或无效 |
| 403 | FAMILY_WRITE_FORBIDDEN | 非成员、viewer 或未知角色 |
| 404 | RESOURCE_NOT_FOUND | 当前 family 范围内不存在 |
| 409 | IDEMPOTENCY_KEY_REUSED | 同 key 不同 payload |
| 409 | VERSION_CONFLICT | stale update/delete |
| 409 | RECURRING_NOT_DUE / RULE_INACTIVE | recurring 不可执行 |
| 409 | PROPOSAL_NOT_CONFIRMABLE | proposal 已处理、过期或 hash/version 不符 |
| 413 | IMPORT_LIMIT_EXCEEDED | 文件、行数或字段超限 |
| 429 | RATE_LIMITED | 超过访问频率 |
| 503 | TRANSIENT_DATABASE_FAILURE | 可使用同 key 重试的瞬态 DB 失败 |
| 500 | INTERNAL_ERROR | 未分类错误，不泄露 SQL/Prisma 细节 |

### 7.3 角色矩阵

| 操作 | 未认证 | 非成员 | viewer | member | admin | 未知角色 |
|---|---:|---:|---:|---:|---:|---:|
| 财务读取 | 401 | 403 | 200 | 200 | 200 | 403 |
| 收入/支出 mutation | 401 | 403 | 403 | 2xx | 2xx | 403 |
| recurring mutation/execute | 401 | 403 | 403 | 2xx | 2xx | 403 |
| import preview/confirm | 401 | 403 | 403 | 2xx | 2xx | 403 |
| AI proposal/confirm | 401 | 403 | 403 | 2xx | 2xx | 403 |
| file upload/delete | 401 | 403 | 403 | 2xx | 2xx | 403 |
| 家庭成员/角色管理 | 401 | 403 | 403 | 403 | 2xx | 403 |

拒绝路径同时断言无 Prisma mutation、cache read、MinIO 写入或 AI provider/executor 调用；跨 family 资源不泄露存在性；最后 admin 保护继续成立。

## 8. 财务语义

### 8.1 日期和期间

以 family timezone 解释期间，API 使用半开区间 [start, end)。月、季度、年、闰年、夏令时边界必须测试。report、budget、compare 和 goal 统计复用 PeriodWindow service。

### 8.2 币种

Phase 1 使用保守合同：Family.baseCurrency 默认 CNY；Income/Expense 保留 currency，历史回填 CNY。无可靠汇率时返回 totalsByCurrency，只有 base currency 部分进入 base total。历史汇率源、估值日、舍入、缺失汇率和重算另立项目。

### 8.3 对账

自动验证 netIncome=income-expense；netCashFlow 包含每个展示 cash-flow class；balance sheet 与 dashboard 使用相同 valuation/as-of 规则；空集合、真实零值和错误状态可区分。

## 9. TDD、测试和证据

每个行为任务执行 RED → GREEN → REFACTOR：

1. 写一个聚焦测试并记录命令。
2. 运行并确认失败原因是目标缺陷；环境失败只能标记 BLOCKED。
3. 实现最小修复。
4. 聚焦通过后运行相关回归。
5. 重构期间保持绿色。
6. 记录 commit、环境、迁移、回滚和剩余风险。

禁止先实现后补测试、删除旧断言、用 mock 替代 integration，或排除业务文件提高 coverage。

| 测试 ID | 场景 | 必须证明 |
|---|---|---|
| P1-T0-01 | app 导入 | 不启动 listener、Redis、MinIO |
| P1-CRUD-01 | 普通 CRUD | 响应兼容且 family 隔离 |
| P1-CRUD-02 | 同 key 并发 20 次 | 一条账、一个 operation、稳定 replay |
| P1-CRUD-03 | stale update | 一个成功，一个 VERSION_CONFLICT |
| P1-RBAC-01 | 全入口矩阵 | 未认证/非成员/viewer 零副作用 |
| P1-REC-01 | recurring 并发 20 次 | 一条 entry、一次推进 |
| P1-REC-02 | inactive/future/endDate | 不写账、不推进 |
| P1-IMP-01 | import 第 N 行失败 | 整批零写入，batch 可重试 |
| P1-IMP-02 | import 并发 confirm | 只提交一次 |
| P1-IMP-03 | batch 篡改/跨 family/过期 | 拒绝且零副作用 |
| P1-AI-01 | text/OCR proposal | 确认前账本不变 |
| P1-AI-02 | AI confirm | 只接受服务端 proposal/hash |
| P1-AI-03 | proposal 编辑 | original/confirmed 分离可审计 |
| P1-AI-04 | AI 双击确认 | 一次提交、稳定 replay |
| P1-FIN-01 | 期间边界 | timezone + half-open |
| P1-FIN-02 | 混合币种 | 分币种、不虚假 total |
| P1-FIN-03 | 三表 fixture | reconciliation 恒等式 |
| P1-INF-PG | 真实 PostgreSQL | migration、回滚、并发 |
| P1-INF-REDIS | Redis stop/restart | 正确降级、旧缓存不复活 |
| P1-INF-MINIO | MinIO 故障 | 元数据和对象生命周期明确 |
| P1-SYS-01 | Compose | migration、health、重启可重复 |
| P1-E2E-01 | Playwright | 登录、切换、CRUD、导入、AI confirm |

证据等级：

| 等级 | 含义 |
|---|---|
| DESIGNED | 只有设计 |
| NOT_RUN | 有测试但当前 commit/环境未运行 |
| BLOCKED | 环境不可用，不能视为 RED/PASS |
| PASS-MOCK | mock 通过，只证明应用合同 |
| PASS-REAL | 真实 PostgreSQL/Redis/MinIO 通过 |
| PASS-E2E | Compose 全栈和浏览器通过 |
| OBSERVED | staging 部署、重启和故障恢复通过 |
| FAILED | 可复现失败 |
| WAIVED | 书面接受，有责任人和到期日 |

## 10. 并行 agent 边界

Wave 0 由主交付 agent 完成：分支、tracker、证据模板、ADR、app/server/db 分离、共享命令/错误合同和 integration harness。其他 agent 不修改共享边界。

Wave 1 使用互斥写集：

| agent | 写入范围 |
|---|---|
| Ledger | services/ledger* 和纯服务测试 |
| Database | Prisma schema/migration 和数据库测试 |
| API | income/expense adapter 和契约测试 |
| Review | 只读审查和评论 |

Wave 2 在 Ledger 和幂等基础达到 REGRESSION_VERIFIED 后并行：Import、Recurring、AI proposal、Frontend、Integration/E2E。共享合同由主 agent 先冻结。Wave 3 做安全、数据、财务和发布独立复核。agent 通过不能代替 Repository Owner、Finance/Product Owner 或 Release Owner 最终验收。

## 11. CI、发布和回滚

### 11.1 Gate

| Gate | 阻断条件 |
|---|---|
| G0 Design | 规格、ADR、tracker、兼容和回滚未完成 |
| G1 Focused TDD | 没有有效 RED 或 focused test 未通过 |
| G2 PR Fast | backend build/coverage 或 frontend lint/test/build 失败 |
| G3 Data | Prisma、真实 PG 回滚/并发失败 |
| G4 Infrastructure | Redis、MinIO、Compose 真实验证失败 |
| G5 Browser | 关键旅程、console error、Promise 或跨 family 残留失败 |
| G6 RC | migration upgrade、restart、replay、故障注入或 rollback 失败 |
| G7 Exit | 未接受 P0/P1 或只有 mock 证据 |

强制命令：

    backend: npm run build
    backend: npm test -- --runInBand --coverage
    backend: npm run test:integration
    backend: npx prisma validate
    backend: npx prisma format --check
    frontend: npm run lint
    frontend: npm test
    frontend: npm run build
    frontend: npm run test:e2e
    system: docker compose config --quiet
    system: docker compose build
    system: docker compose up -d --wait

后端全局 coverage 至少达到既有 60% threshold；新增核心服务行/分支 coverage 不低于 90%；前端变更页面/service 行/分支不低于 80%。变更文件 0 warning，退出时处理既有 16 个 warning。high advisory 不得新增；遗留项必须修复、隔离或由责任人和到期日书面接受。

### 11.2 回滚

- Policy/cache：关闭新 cache read path 也保留授权，旧 cache 不能成为授权来源。
- Ledger：按入口 flag 回到旧 handler，但不能双写。
- Schema：保留 expand 结构，前向修复或恢复，不删除 operation/audit 事实。
- Import/AI：新入口不完整时暂停 mutation，不回退隐式 partial 或未确认 AI 写入。
- 依赖：按 lockfile 分组回退并重跑回归，不用 audit fix force 作为唯一策略。

发现跨租户暴露、重复写入或对账失败时，暂停相关发布，保留审计和快照，从可验证版本恢复；不能删除数据或削弱测试断言。

## 12. 任务治理

唯一状态源是 docs/delivery/phase-1/phase-1-tracker.md；evidence 保存执行证据，ADR 保存稳定决策，project-memory 保存长期事实，审查报告保存基线，Graphify 只作导航和假设。

生命周期为 BACKLOG → EVIDENCE_CONFIRMED → READY → RED_REPRODUCED → GREEN_MINIMAL → REFACTORED → REGRESSION_VERIFIED → IN_REVIEW → MERGED → RELEASED → OBSERVED → DONE。健康度独立为 ON_TRACK、AT_RISK、BLOCKED；Epic 状态由子任务和 Gate 推导，不填写虚假百分比。

每次状态变化、证据更新和代码变更应在同一提交或 PR 关联。阻塞当天记录原因、解除责任人和复查日期；活跃任务连续两个工作日无证据更新标 AT_RISK；阻塞超过三个工作日进入 Phase 评审。

## 13. Phase 1 退出标准

只有同时满足以下条件才能 DONE：

- 所有收入、支出、import、recurring 和 AI 财务 mutation 进入统一协调协议。
- AI text/OCR 全部 proposal-only，显式确认后写入。
- import 整批原子且安全重放。
- recurring 同一 occurrence exactly-once。
- 普通写入支持幂等和乐观并发。
- 所有角色负向矩阵通过且拒绝零副作用。
- 混合币种无虚假合计，三表对账通过。
- PostgreSQL、Redis、MinIO、Compose 达到 PASS-REAL。
- 浏览器达到 PASS-E2E；验证环境 migration、重启、故障恢复和回滚达到 OBSERVED。
- backend/frontend/Prisma/coverage/advisory 门禁通过。
- project memory、ADR、风险、tracker、证据和 Graphify 同步。
- 没有未处理 P0/P1；接受的残余风险有责任人、原因和到期日。

书面规格获得用户审阅确认前，不创建实施计划、不修改生产代码、不启动 feature implementation。涉及财务期间、币种、导入失败策略、目标贡献和后台 actor 的任务，必须由对应责任人写入 ADR 后才能进入 GREEN。

