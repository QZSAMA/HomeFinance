
# ADR-0004: AI 财务动作采用 proposal-only 和显式确认

- 状态：Accepted
- 日期：2026-08-28

## Context

OCR 路径已有 proposal，但文本 chat 会直接执行 AI actions；execute-actions 接受任意客户端 action 结构，执行器还允许逐条部分成功。AI 输出是不可信输入，不能绕过普通账本规则。

## Decision

text chat 和 OCR 都只创建服务端 AIProposal/AIProposalItem 并返回 proposal 信息，不直接写入财务事实。proposal 保存原始输出、规范化 action、来源、hash、状态、version 和 expiresAt。

用户确认提交 proposalId、expected version/hash、编辑后的 final actions 和 Idempotency-Key。服务端重新验证 final actions，并区分 original payload 与 confirmed payload，支持当前前端编辑/删除体验。确认事务条件抢占 proposal，调用 Financial Mutation Coordinator 批量执行 Ledger 或 Balance mutation，写 AuditEvent 并保存结果；默认整批原子。

execute-actions 在兼容窗口保留路径，但 raw actions 只能进入严格校验的迁移 adapter，不能绕过统一事务，之后移除。viewer、非成员、proposal 跨家庭、篡改、过期、重复确认均拒绝且零账本副作用。

proposal 生命周期固定为 `PROPOSED`、`CONFIRMING`、`EXECUTED`、`REJECTED`、`EXPIRED`、`FAILED`。`CONFIRMING` 只用于确认事务中的条件抢占；事务回滚后不得留下持久化 `CONFIRMING`。成功确认直接进入 `EXECUTED`，不增加含义重叠的 `CONFIRMED` 状态。`FAILED` 只允许记录已明确提交、且账本零副作用的终态失败；普通事务异常回滚后 proposal 保持原状态。

`actorUserId` 可空并使用 `SetNull`，用于用户删除后保留历史 proposal；创建和确认服务仍必须要求当前认证 actor、当前 family membership 和写权限，并保存不可变 `actorSnapshot`。conversation/file 外键同样使用 `SetNull`；服务层必须验证来源与 proposal 属于同一 family，不能依赖独立外键推断租户一致性。

## Consequences

AI 写入变得可审查和可取消，前端多一步确认；需要 proposal 生命周期、过期清理和更明确的错误提示。AI provider、OCR 和 MinIO 在事务外，失败不会伪造财务提交。

## Verification

由 P1-E、P1-B、P1-G 和 Playwright 旅程提供 proposal-only、编辑、重放、篡改、角色和故障证据。

2026-09-01 implementation note：提交 `5a564c9` 关闭 text chat 的自动执行路径；`732eafd` 加入 server-owned `AiProposal`/`AiProposalItem` 及原始/确认 payload、hash、version、status、expiry、来源和结果持久化合同；`7f6c366` 将 chat/OCR proposal-producing paths 接入持久化。提交 `cdfcb67` 将支持的 Income/Expense 确认接入 `FinancialMutationCoordinator`，在同一事务内完成 proposal 条件抢占、Ledger mutation、item result、AuditEvent、幂等记录和 `EXECUTED` 结果，并以真实 PostgreSQL/服务测试验证重放、篡改、过期、角色、跨家庭和并发拒绝。 `d945e65` 与 `c769a78` 完成前端 server-owned proposal ID/item 映射、历史刷新恢复及 EXECUTED 状态展示。`6704300` 移除旧 direct Prisma executor，并将兼容 URL 限制为 proposal confirmation adapter；`9e89525` 增加 Playwright/Compose 基础设施，实际 E2E 因本机 Docker 不可用而 BLOCKED。当前证据为 backend AI focused 52/52、frontend full 7 files/19 tests、PostgreSQL AI route 17/17、Playwright discovery 4 journeys；本 ADR 仍保留 AT_RISK，不宣称 Balance actions、legacy `/execute-actions` 移除、Redis/MinIO/Compose 实际验证、浏览器 E2E、staging/release 或全局 coverage 已完成。
