
# ADR-0005: 固化家庭时区、财务期间和保守币种汇总

- 状态：Accepted
- 日期：2026-09-03

## Context

预算、目标和报表需要一致的期间边界；现有 Income/Expense 没有 currency，而资产/负债存在 currency。未定义汇率源、估值日和舍入规则时直接汇总会制造虚假财务数字。家庭还需要一个不依赖服务器或浏览器本地设置的业务时区。

## Decision

Family 在创建时保存 IANA `timezone`，默认 `Asia/Shanghai`；既有家庭回填上海，创建后不可修改。所有期间以家庭 timezone 解释，API 和内部 query 使用半开区间 [start, end)。report、budget、compare 和 goal 复用 PeriodWindow service，并测试月末、季度、年度、闰年和 DST 边界。

Phase 1 增加 Family.baseCurrency，默认 CNY；Income/Expense 增加 currency，历史记录回填 CNY。无可靠汇率时返回 totalsByCurrency；混合币种的 base total 为 null，不直接相加，也不以可换算部分伪装完整总额。历史 FX source、valuation date、rounding、missing-rate policy 和可重放估值另立项目。

目标贡献在 Phase 1 只按明确的数据关系计算，不能把全局收入/支出重复分配给多个目标。三表和 dashboard 必须共享 valuation/as-of 规则并验证 reconciliation。

## Consequences

短期可能返回分币种结果而不是单一 total，避免错误精确；家庭时区一旦创建便不可变，避免历史期间被重新解释。财务负责人已批准期间、目标贡献隔离和缺失汇率策略；未来 FX 规则仍需单独决策。

## Verification

由 P1-F、P1-G 和 Finance/Product Owner 提供 period、currency、goal isolation 和 reconciliation 证据。

