# 财务正确性分域分析

## 1. 结论

HomeFinance 的收入、支出、资产、负债和三表接口已经形成产品主线，但当前“字段存在”不等于“会计语义闭环”。现金流净额遗漏展示出的 other 流入/流出；预算读取 `period` 却未按月/季/年形成窗口；资产和负债允许多币种而汇总直接相加；目标进度使用全局资产/负债/净值；日期处理混合 UTC 和服务器本地月界。财务产品应优先保证未知、不可换算和未定义分类不会被伪装成精确数字。

## 2. 证据

| 领域 | 证据 | 判断 |
|---|---|---|
| 现金流 | `backend/src/routes/reports.ts:148-170` 计算并返回 `totalOtherIncome/Expense`；`:172-175` 的 `netCashFlow` 只加 operating、investing、硬编码 0 的 financing。 | 若存在 other flow，分项之和与净现金流不守恒。 |
| 预算 | `backend/src/routes/budgets.ts:43-80` 读取预算并逐个查询 expense；既有审查指出 `period` 未参与窗口，`effectiveStart` 逻辑为恒等表达式。 | MONTHLY/QUARTERLY/YEARLY 不能按当前周期解释，且存在 N+1。 |
| 多币种 | `backend/prisma/schema.prisma:99-127` Asset/Liability 有 `currency`；`reports.ts:29-34` 直接将 value/amount 相加；前端多处按 CNY formatter 展示。 | 混合币种 total 数学上没有定义。短期应分组或拒绝伪总额。 |
| 目标 | 既有审查定位 `backend/src/routes/goals.ts:42-63` 使用全局资产/负债/净值。 | 多个目标之间没有专项贡献边界，目标进度互相污染。 |
| 日期 | `reports.ts:69-77` 直接 `new Date(startDate/endDate)`，`:215-218` 用服务器本地 `new Date(year, month, day)`。 | 客户端 UTC 日期和服务器本地月界可能在时区边界产生偏移。 |
| 最近交易 | `reports.ts:223-226` 查询本月流水未明确排序，后续 `:291-293` 直接 `slice(0, 5)`。 | 结果集合未排序时不能保证“最近”。 |

## 3. 目标不变量

所有财务接口和测试应共享以下合同：

1. `netIncome = totalIncome - totalExpense`，且类别合计分别等于总额。
2. `netCashFlow = operating.net + investing.net + financing.net + other.income - other.expense`；若某分类未实现，返回 `unavailable`，不能用 0 冒充已计算。
3. 所有金额必须带 currency；只能在同一声明 base currency 内相加。无汇率时按币种分组。
4. 日期区间采用显式 `[start, end)` 或等价规则，所有报表、预算和比较查询一致。
5. 预算周期窗口只包含当前 period 的交易；月末、闰年、未来 startDate、endDate 均有确定行为。
6. 目标进度必须说明其来源：全局指标或专项 allocation；不同目标不得共享同一笔贡献而没有解释。
7. “未知/请求失败/不可换算/空集合/真实零”必须在 API 和 UI 中保持可区分。

## 4. 方案比较

### 4.1 现金流

方案 A 是把 other 流量纳入 `netCashFlow`，并将 financing 明确标记为未实现或实现正式分类；方案 B 是只隐藏 other 分项。推荐 A。B 只是让页面看起来守恒，实际丢失数据，违反可追溯性。公式应抽为纯函数，route 只负责 query 和 response mapping。

### 4.2 多币种

方案 A（短期推荐）是要求 family 使用单一 base currency，非 base 资产/负债在换算来源缺失时按币种分组或拒绝 total；方案 B 是立即接入实时汇率 API。推荐先 A 后 B。汇率功能还需要历史 rate、valuation date、source、rounding、缺失策略和可重放机制，不能以一次 API 调用解决。

### 4.3 目标模型

方案 A 是新增 goal allocation/goal-account 关联，明确专项贡献；方案 B 是把当前全局净值继续作为所有目标的进度。推荐 A；B 可作为明确标注的“家庭总净值参考”，不能继续称为每个目标的完成度。

## 5. TDD 实施合同

### FIN-001：现金流对账

- RED 文件：`backend/src/services/reportFormulas.test.ts` 或现有 `backend/src/routes/reports.test.ts`
- 测试名：`includes other cash flows in netCashFlow and preserves reconciliation`
- 核心断言：other income=100、other expense=30 时，`netCashFlow` 比无 other 时增加 70；所有展示分区净额之和等于 total。
- 命令：`cd backend; npm test -- src/routes/reports.test.ts --runInBand`
- 预期 RED：当前 `netCashFlow` 忽略 other，断言差 70。
- GREEN：最小修改公式并补返回结构的明确字段。
- REFACTOR：将分类和金额计算抽成纯函数，未实现 financing 返回 `unavailable` 或正式实现，不返回误导性 0。
- 退出门禁：中文类别、英文枚举、空集合、负值校验和 reconciliation fixture 全绿。

### FIN-002：预算 period window

- RED 文件：`backend/src/services/periodWindow.test.ts`、`backend/src/routes/budgets.test.ts`
- 测试名：`limits monthly budget progress to the current monthly window`
- 核心断言：冻结一个月中日期，创建跨两个月支出；MONTHLY 只计当前月；QUARTERLY/YEARLY 分别计当前季度/年；startDate/endDate 边界按统一规则处理。
- 命令：`cd backend; npm test -- src/services/periodWindow.test.ts src/routes/budgets.test.ts --runInBand`
- 预期 RED：当前 period 不影响 expense 查询窗口，跨期支出会被累计。
- GREEN：新增纯函数 `getPeriodWindow(period, now, startDate, endDate, timezone)`，先在 route 使用其结果。
- REFACTOR：使用一次 `groupBy(category)` 或聚合查询替代每个 budget 的 N+1。
- 退出门禁：月初/月末、闰年、未来起始日、结束日和非 UTC family timezone 均有行为测试。

### FIN-003：currency safety

- RED 文件：`backend/src/services/reportFormulas.test.ts`、`backend/src/routes/reports.test.ts`
- 测试名：`does not produce a mixed-currency total without an exchange rate`
- 核心断言：CNY + USD 资产请求 balance sheet 时返回按 currency 分组或明确不可计算；不得返回一个无解释的 totalAssets/netWorth。
- 命令：`cd backend; npm test -- src/routes/reports.test.ts --runInBand`
- 预期 RED：当前直接 reduce value 并生成单一 total。
- GREEN：短期在查询层检测币种集合；单一币种正常返回，混合币种返回 grouped/unavailable。
- REFACTOR：ADR 确认 `Family.baseCurrency`、历史 FX rate、rate timestamp、valuationDate、rounding 和缺失率策略，再做 expand/migrate/contract。
- 退出门禁：任何报表、compare、goals、export 都没有未换算的混币 total。

### FIN-004：goal and recent transaction semantics

- RED 文件：`backend/src/routes/goals.test.ts`、`backend/src/routes/reports.test.ts`
- 测试名：`keeps goal progress isolated`、`returns the five most recent transactions by date`
- 核心断言：两个目标只绑定各自 allocation 时互不污染；乱序输入中返回 date 最大的五条。
- GREEN：目标先明确为全局参考或按 allocation 查询；recent query 增加 `orderBy: { date: 'desc' }`。
- REFACTOR：将 as-of、currency、goal contribution 作为 response contract 字段，避免前端猜测。
- 退出门禁：多目标、同日排序、时区边界和空集合均有测试。

## 6. 决策责任与风险

财务 owner 必须在 ADR 中确认分类、预算周期和历史重算规则；工程不能用“常见做法”替代产品口径。若短期无法确认汇率来源，应返回按币种分组，不应继续显示 CNY 总额。报表对账失败或历史重算不一致时，应暂停相关报表发布，保留原始流水和公式版本，采用 forward-fix，不直接覆盖历史金额。

