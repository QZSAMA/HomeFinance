
# ADR-0002: 数据库仲裁幂等、乐观并发和审计提交

- 状态：Proposed
- 日期：2026-08-28

## Context

重复请求、客户端重试、recurring 并发和 AI 双击可能在现有“先查再写”路径中产生重复或覆盖。Redis 和进程内锁不能作为多实例下的最终正确性保障。

## Decision

新增 IdempotencyRecord，唯一键为 family、actor scope、operation 和 key；规范化 payload 计算 hash。同 key 同 hash 重放原响应并标记 deduplicated；同 key 不同 hash 返回 409。数据库唯一约束负责 commit-time arbitration。

为 Income 和 Expense 增加 version。更新/删除使用 familyId、id 和 expected version 条件，冲突返回 409 VERSION_CONFLICT。新增 AuditEvent，在同一 transaction 中记录 actor、action、entity 和必要的 before/after snapshot。审计事件追加后不可由业务路径更新或删除。

Phase 0 的 Family.cacheVersion PostgreSQL trigger 是 revision 事实源。Phase 1 初期 service 不手工 bump，不增加第二个 commit hook；后续如需批量优化，另立 ADR 并提供真实 PostgreSQL 锁竞争证据。

## Consequences

可以证明回放、并发和变更可追溯；增加 migration、唯一约束和响应存储成本。Prisma P2002、P2025、P2034 需要稳定业务错误映射。Prisma 没有安全自动 down migration，回滚优先前向修复或恢复演练。

## Verification

由 P1-B、P1-A、P1-D、P1-E、P1-G 提供 mock 契约和真实 PostgreSQL 并发/回滚证据。

