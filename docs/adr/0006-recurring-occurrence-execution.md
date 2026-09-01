# ADR-0006: 定期发生项的 exactly-once 执行与历史保留

- 状态：Accepted
- 日期：2026-09-01
- 接受依据：Repository Owner 已批准 Scheme B、Phase 1 实施计划及 P1-D 推进；实现提交为 370b2d9

## Context

旧定期执行由 HTTP route 先创建 Income/Expense，再独立推进 RecurringTransaction.nextDate。它没有稳定的发生项身份，也无法在并发、响应丢失或规则更新失败时区分“尚未执行”和“已经提交但调用方未收到结果”。物理删除规则还会破坏执行历史的长期归属。

通用 IdempotencyRecord 解决一次请求的重放，但不同客户端 key 仍可能指向同一个业务发生项。因此 Recurring 需要比请求 key 更强的数据库业务唯一性。

## Decision

1. 定期发生项的业务身份是 (recurringTransactionId, scheduledFor)，由 RecurringExecution_occurrence_key 在 PostgreSQL commit-time 仲裁。不同请求 key 不能为同一发生项创建第二条账目。
2. 执行 API 接受可选 scheduledFor 以兼容旧调用；迁移后的前端必须发送当前界面展示的 nextDate。Ledger effectiveDate 使用该发生日期，而不是重试或服务器接收时间。
3. family membership 和 writer role 必须在任何执行结果回读之前验证。缓存、幂等记录和 winner reread 都不能成为授权边界。
4. 一次 PostgreSQL transaction 内依次完成：读取非墓碑规则、校验 active/due/endDate、创建 RecurringExecution(PROCESSING)、通过 transaction-backed Ledger 创建 Income/Expense、以 id + familyId + version + nextDate 条件推进规则、保存 committed replay result、提交幂等记录和 AuditEvent。
5. 竞争者在唯一约束或事务冲突后，只能在重新授权后读取已 COMMITTED 且可验证的 winner result。未完成或损坏结果返回可重试冲突，不能伪造成功。
6. Recurring 执行审计的业务实体是 RecurringExecution，因此 AuditEvent.entityId 指向 execution ID。生成的 Income/Expense ID 独立保存在 entryId；两者不得混用。
7. 已有执行历史的规则不物理删除。DELETE 将规则设为 inactive 并写 deletedAt；list、due、update、execute 排除墓碑，而历史 execution 保留外键归属。
8. inactive 返回 RULE_INACTIVE；过期、未来、endDate 之后或已经不是当前 occurrence 返回 RECURRING_NOT_DUE。这些拒绝路径不得产生账目、execution 或规则推进。

## Consequences

同一发生项在数据库层最多提交一次，失败重试和不同 key 并发可安全收敛；entry、execution、schedule、audit 和 replay result 具备统一提交边界。代价是新增持久化、结果序列化校验、墓碑过滤和长期执行历史容量。

这项决定不等于引入自动调度器。后台 worker、租约、补跑窗口、时区策略、保留/归档策略需要单独设计；它们必须复用相同 occurrence 身份，不能绕过本事务边界。

## Rejected alternatives

- 仅依赖客户端 Idempotency-Key：不同 key 仍可重复执行同一发生项。
- Redis/进程锁：不能提供多实例 commit-time 正确性，也不能与账本和 schedule 原子提交。
- 先写账再推进规则：规则更新失败会留下不可安全重试的部分事实。
- 物理删除规则：会删除或悬空执行历史，削弱审计和重放证据。
- 让 AuditEvent 指向 ledger entry：会混淆“执行命令”与“执行产出的财务事实”。

## Verification

- focused unit/route/schema tests 覆盖 inactive、future、endDate、事务编排、route 无直接写账、稳定错误、墓碑过滤和前端稳定 occurrence/key。
- PostgreSQL 18.1 集成测试覆盖 20 个不同 key 对同一 occurrence 只产生一条 execution/ledger fact、19 个 replay、一次规则推进、正确执行审计、强制回滚和墓碑历史保留。
- fresh schema p1_recurring_fresh_20260901 应用全部 9 个 migration 后通过 6 个 recurring integration cases，并在验证后删除。

## Rollback and revisit

发布回滚优先关闭执行入口或前向修复，保留 additive RecurringExecution、审计、幂等和墓碑事实。不得回退到直接 route 写账、物理删除规则或仅依赖客户端 key。

当引入自动调度、多时区补跑、跨区域 active-active、历史归档，或真实负载证明 occurrence 唯一索引/事务存在不可接受竞争时，重新评审本 ADR。
