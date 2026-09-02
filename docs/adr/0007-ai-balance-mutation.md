# ADR-0007: AI 资产/负债确认通过事务内 Balance mutation

- 状态：Accepted
- 日期：2026-09-01
- 接受依据：Repository Owner 已批准 Phase 1 方案 B 及 P1-E-07 推进；实现提交为 `fc50633`、`d204201`、`bdabe7b`

## Context

AI proposal confirmation 已将 Income/Expense 写入统一的 `FinancialMutationCoordinator`，但 `create_asset` 与 `create_liability` 仍被拒绝为 `AI_BALANCE_MUTATION_UNAVAILABLE`。如果把这两类动作重新接到 route 或独立事务，它们会失去 proposal claim、审计、幂等和财务事实之间的原子边界。

Asset/Liability 不是 Income/Expense ledger entry 的伪装：它们有独立的存量语义和字段（`value`/`amount`、currency、日期及资产/负债类型）。因此需要共享同一 transaction boundary 和 policy，而不是强行复用 Income/Expense 表或直接暴露普通 Balance CRUD。

## Decision

1. AI `create_asset` 和 `create_liability` 只允许在已认证、已授权、已持久化 proposal 的确认流程中执行；proposal item 的持久化类型必须与用户提交的编辑后 action 类型完全匹配。
2. `FinancialMutationCoordinator` 继续作为唯一的 proposal claim、幂等和 PostgreSQL transaction boundary。Balance service 不开启嵌套事务，也不提供独立 root-level replay/read API。
3. `createAssetInTransaction` 与 `createLiabilityInTransaction` 只接收已打开的 transaction client，校验 family/actor/source/idempotency scope、必填文本、有限非负金额、有效日期和三字母大写 currency，然后调用 transaction-scoped `asset.create`/`liability.create`。
4. 一个确认事务内，proposal 条件抢占、Asset/Liability 写入、item result、AuditEvent、IdempotencyRecord 和 proposal `EXECUTED` completion 必须一起提交；任意异常回滚全部事实。
5. 同一 Idempotency-Key 重放已保存的 proposal result，不得新建第二个 Balance fact；不同 key 的并发请求由 proposal 状态/版本条件在数据库中仲裁。
6. viewer、非成员、过期 proposal、篡改 payload、类型不匹配和非法 balance 输入必须在写入前拒绝。缓存、历史结果或 AI 输出不能成为授权边界。

## Scope and non-goals

本 ADR 只覆盖 AI proposal confirmation 的 Asset/Liability create actions。普通 Asset/Liability HTTP CRUD、balance query、valuation、currency conversion、现有 direct route migration、自动调度和外部 Redis/MinIO/AI provider 不因本 ADR 自动获得“已迁移”或“已验证”状态。

## Consequences

AI 资产/负债确认与 Income/Expense 具有一致的显式确认、事务、审计和重放语义，同时保留 Balance 存量模型的独立性。代价是确认流程依赖 proposal coordinator，Balance service 需要维护独立字段校验，普通 Balance route 仍需后续统一 policy/cache/revision 工作。

## Verification

- `balanceMutationService.test.ts` 的 focused unit regression 为 18/18，包含规范化、非法输入不写 transaction 和 action dispatch 合同。
- 本地 PostgreSQL 18.1 的 AI confirmation/route integration 为 25/25；当前完整 integration 为 12 suites / 80 tests，新增的 Asset HTTP route adoption 也在同一数据库回归中通过。
- 真实测试证明 Asset/Liability 与 proposal、item result、审计、幂等在同一事务中提交，same-key replay 不重复，事务故障不留下 Balance 或 proposal metadata。
- 全量 backend 50 suites / 417 tests 通过；coverage statements 75.81%、branches 60.04%、functions 70.85%、lines 76.67%，已通过未降低的 60% 全局门槛。Docker/E2E、Redis/MinIO、populated restore、release observation 和 semantic Graphify refresh 仍未验证。

## Rollback and revisit

回滚采用前向修复：若确认链路出现问题，关闭 Balance action confirmation 或回退到明确的 proposal-only/人工录入降级，不恢复未经确认的 AI 直写，也不删除已提交的 Asset/Liability、proposal、audit 或 idempotency 历史。普通 Balance CRUD 迁移、不可变更正事件、多币种估值或引入异步 worker 时重新评审本 ADR。
