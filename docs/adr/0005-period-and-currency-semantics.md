
# ADR-0005: 固化财务期间和保守币种汇总

- 状态：Proposed
- 日期：2026-08-28

## Context

预算、目标和报表需要一致的期间边界；现有 Income/Expense 没有 currency，而资产/负债存在 currency。未定义汇率源、估值日和舍入规则时直接汇总会制造虚假财务数字。

## Decision

所有期间以家庭 timezone 解释，API 和内部 query 使用半开区间 [start, end)。report、budget、compare 和 goal 复用 PeriodWindow service，并测试月末、季度、年度、闰年和 DST 边界。

Phase 1 增加 Family.baseCurrency，默认 CNY；Income/Expense 增加 currency，历史记录回填 CNY。无可靠汇率时返回 totalsByCurrency，只有 base currency 进入 base total，不直接相加混合币种。历史 FX source、valuation date、rounding、missing-rate policy 和可重放估值另立项目。

目标贡献在 Phase 1 只按明确的数据关系计算，不能把全局收入/支出重复分配给多个目标。三表和 dashboard 必须共享 valuation/as-of 规则并验证 reconciliation。

## Consequences

短期可能返回分币种结果而不是单一 total，避免错误精确。财务负责人必须批准期间、分类、目标贡献和未来 FX 规则；这些不是 agent 可自行决定的实现细节。

## Verification

由 P1-F、P1-G 和 Finance/Product Owner 提供 period、currency、goal isolation 和 reconciliation 证据。

