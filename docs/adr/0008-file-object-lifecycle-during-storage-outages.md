# ADR-0008: 对象存储故障期间保留文件元数据并采用补偿上传

- 状态：Accepted
- 日期：2026-09-07
- 接受依据：Repository Owner 批准 P1-G-05 基础设施恢复设计；被测实现提交为 `f560b40`，真实恢复证据提交为 `5332588`

## Context

`File` 数据库行是家庭对象的租户归属、文件名、对象路径和后续重试依据，MinIO 对象保存实际内容。旧上传流程在 MinIO 失败时跳过该文件并可能返回 `201`/空列表；旧删除流程在 MinIO 删除失败后仍删除 `File` 行，使系统失去唯一持久化对象引用。上传成功后若数据库创建失败，旧流程还会留下无元数据归属的对象。

PostgreSQL 与 MinIO 不共享事务。本门禁需要明确单文件请求的故障顺序，同时不引入未经验证的分布式事务或 outbox。

## Decision

1. 所有 family 文件路由先通过集中 `requireFamilyAccess` 或 family write policy，再执行 Prisma 文件查询、URL 签发、MinIO 上传或删除；缓存和对象 ID 都不是授权边界。
2. 上传先写 MinIO，再创建 `File` 行。MinIO 上传失败返回可重试 `503`/`STORAGE_UNAVAILABLE`，不得返回成功或暴露对象路径。
3. MinIO 上传成功但 `File` 行创建失败时，立即尝试删除刚上传的对象作为 best-effort compensation，然后返回数据库错误。补偿失败必须记录，但本阶段不伪造事务原子性。
4. 删除先以 `id + familyId` 查找文件，再删除 MinIO 对象；只有对象删除成功后才能删除 `File` 行。MinIO 删除失败返回可重试 `503`/`STORAGE_UNAVAILABLE` 并保留数据库行作为恢复后的重试锚点。
5. viewer 只允许列表；非成员、未认证用户和跨家庭 object ID 在任何对象存储副作用前拒绝。对象路径必须以已授权 route 的 `familyId/` 开头。
6. 保持既有成功响应、10 MiB 限制、pHash 行为、route URL 和 Prisma schema 不变。

## Consequences

MinIO 故障不会再产生“上传 0 个仍成功”或“对象未删但引用已丢失”的状态；服务恢复后可以用保留的行重试删除。上传的数据库失败窗口通过即时补偿缩小，但补偿本身仍可能失败，因此这不是跨系统 exactly-once 保证。

多文件批次原子性、durable outbox、孤儿对象巡检、对象版本和保留策略均保持为独立的后续架构工作。单文件真实恢复门禁不能被解释为生产存储高可用或灾备证明。

## Verification

- `backend/src/routes/files.test.ts` 先以 12/18 的 RED 证明失败上传返回 201、删除故障继续删行、无上传补偿和跨家庭 lookup 未按 family scope；最小实现后 18/18 通过。
- Files 加 family permission focused regression 为 32/32；backend build 与默认 coverage 55 suites / 467 tests 通过，statements 77.89%、branches 61.95%、functions 73.28%、lines 79.31%。
- GitHub Actions run `34091443383` 在 PostgreSQL service 上通过 17 suites / 97 tests；权限矩阵 mock MinIO 以保持 PostgreSQL-only 边界，真实存储由独立 Compose gate 覆盖。
- GitHub Actions run `34091443392` 在 Ubuntu 24.04.4 / Node 20.20.2 上通过 Redis/MinIO outage、recovery、对象隔离和第二次生命周期，并删除六个容器、两个 volume 与 Compose network。

## Rollback and revisit

回滚采用前向修复。不得恢复吞掉 MinIO 删除错误后删除元数据、或返回 `201`/空上传的行为。若即时补偿失败在真实环境出现、引入多文件原子批次、异步对象处理、版本保留、恶意文件扫描或跨区域对象存储，重新评审 durable outbox、状态机和孤儿对象 reconciliation。
