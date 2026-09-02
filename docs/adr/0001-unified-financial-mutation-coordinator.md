
# ADR-0001: Phase 1 采用统一金融 mutation coordinator

- 状态：Accepted
- 日期：2026-08-28
- 接受依据：Repository Owner 在当前任务连续批准 Scheme B、Phase 1 设计和实施推进；2026-08-28 正式落账
- 范围：Income、Expense、Recurring、Import、AI proposal 及必要的 Asset/Liability mutation

## Context

当前普通收入/支出、recurring、import 和 AI action 分别直接或间接写入 Prisma，授权、事务、重试和审计语义分散。Phase 0 已建立 family policy 和 cacheVersion trigger，但尚未统一所有交易生成入口。

## Decision

保留 Income 和 Expense 双表，在路由与 Prisma 之间建立不依赖 Express 的 Financial Mutation Coordinator。普通收入/支出由 Ledger Application Service 负责；Asset/Liability 由 Balance Mutation Service 负责；AI proposal confirm 由 Coordinator 在一个 Prisma transaction 内编排。所有入口共享 Family Policy、Idempotency、Audit Event 和稳定错误映射。

不在本阶段物理合并账目表、不拆微服务。路由只能作为 HTTP adapter，不直接执行受控账目 create/update/delete。后台 worker 的 system actor 仅保留接口合同，不在本阶段启用。

## Consequences

获得统一权限、事务和重放边界，允许逐入口迁移和回滚；过渡期会有 adapter。需要先拆分 app/server/db 启动边界，并为旧 API 保留兼容窗口。AI 的 Asset/Liability mutation 不能被错误地排除在统一安全合同外。

## Verification

由 P1-A、P1-B、P1-D、P1-E 和 P1-G 任务提供聚焦测试、真实 PostgreSQL 并发/回滚证据和源码旁路检查。
