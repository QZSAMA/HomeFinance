
# ADR-0003: 导入确认采用服务端批次和整批原子

- 状态：Proposed
- 日期：2026-08-28

## Context

当前 import preview 只返回内存数组，confirm 接受客户端完整 items，并逐行写入。合法行可能已经成功，后续行才失败，导致隐式部分成功；客户端还可以篡改金额、日期和类型。

## Decision

preview 解析并规范化文件，在服务端持久化 ImportBatch 和 ImportRow，记录文件 hash、parser version、preview hash、行号和 validation 状态。confirm 只接收 batch ID、expected preview hash、受控 category patch 和 Idempotency-Key；金额、日期和 type 以服务端 batch 为准。

所有行先完成服务端校验。任意一行失败则不产生账目。确认时在一个 PostgreSQL transaction 内条件推进 batch、调用统一 Ledger service 批量创建账目、写审计并保存结果。相同 batch 的并发确认只允许一次，重试返回原结果。

这是有意改变当前 partial-success API 合同。兼容窗口保留旧 response 字段和路径，但不保留隐式部分提交；窗口结束移除 raw items 旁路。文件大小、行数和字段长度有配置上限，超限返回 413。

## Consequences

导入更容易解释和重试，但需要持久化预览、清理过期批次和更新前端状态。旧客户端的行为需要兼容 adapter，不能直接把 items 当成可信账目输入。

## Verification

由 P1-C 和 P1-G 提供边界、篡改、原子回滚、并发和浏览器证据。现有 partial-success 测试作为历史行为先记录，再以首个新 RED 证明合同变化。

