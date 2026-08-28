
# ADR-0004: AI 财务动作采用 proposal-only 和显式确认

- 状态：Proposed
- 日期：2026-08-28

## Context

OCR 路径已有 proposal，但文本 chat 会直接执行 AI actions；execute-actions 接受任意客户端 action 结构，执行器还允许逐条部分成功。AI 输出是不可信输入，不能绕过普通账本规则。

## Decision

text chat 和 OCR 都只创建服务端 AIProposal/AIProposalItem 并返回 proposal 信息，不直接写入财务事实。proposal 保存原始输出、规范化 action、来源、hash、状态、version 和 expiresAt。

用户确认提交 proposalId、expected version/hash、编辑后的 final actions 和 Idempotency-Key。服务端重新验证 final actions，并区分 original payload 与 confirmed payload，支持当前前端编辑/删除体验。确认事务条件抢占 proposal，调用 Financial Mutation Coordinator 批量执行 Ledger 或 Balance mutation，写 AuditEvent 并保存结果；默认整批原子。

execute-actions 在兼容窗口保留路径，但 raw actions 只能进入严格校验的迁移 adapter，不能绕过统一事务，之后移除。viewer、非成员、proposal 跨家庭、篡改、过期、重复确认均拒绝且零账本副作用。

## Consequences

AI 写入变得可审查和可取消，前端多一步确认；需要 proposal 生命周期、过期清理和更明确的错误提示。AI provider、OCR 和 MinIO 在事务外，失败不会伪造财务提交。

## Verification

由 P1-E、P1-B、P1-G 和 Playwright 旅程提供 proposal-only、编辑、重放、篡改、角色和故障证据。

