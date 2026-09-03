# HomeFinance 家庭时区与财务期间语义设计

- 状态：Approved design
- 日期：2026-09-03
- 关联 ADR：[`ADR-0005`](../../adr/0005-period-and-currency-semantics.md)
- 范围：家庭创建时区、统一期间窗口、保守币种汇总、目标贡献隔离和三表对账

## 1. 背景与目标

当前 `Family` 没有时区字段，报表、预算、对比和目标在不同位置自行推导日期边界；部分查询使用服务器本地时区或闭区间 `lte`。资产和负债还可能包含不同币种，而当前汇总会直接相加。目标进度则从家庭全局净资产、负债或资产推导，多个目标之间会互相污染。

本设计把家庭时区设为创建时的不可变配置，并建立一个集中式的 `PeriodWindow`、币种汇总和 reconciliation 边界。目标进度只消费明确的贡献关系。历史家庭统一回填上海时区，不重新解释已保存的交易时间。

## 2. 非目标与约束

- 本阶段不允许修改已有家庭的时区，也不提供时区迁移或历史数据重算。
- 本阶段不引入汇率供应商、历史汇率表、估值快照或可重放估值；没有可靠汇率时必须按币种返回。
- 不重写现有 Income/Expense 双表，不把 Redis、MinIO 或 AI provider 放入财务读事务。
- 所有 family-scoped 读写仍须先完成 membership/role 授权；viewer 在所有 mutation 路径保持只读。
- 不以缓存作为授权边界；派生数据必须按 family 和查询维度隔离并在写入后失效。

## 3. 数据模型和迁移

### 3.1 Family 时区

在 `Family` 增加：

```prisma
timezone String @default("Asia/Shanghai") @db.VarChar(64)
```

迁移对既有行显式回填 `Asia/Shanghai`，再加非空约束。数据库迁移同时建立 `BEFORE UPDATE OF timezone` 触发器，任何修改都抛出稳定的 `FAMILY_TIMEZONE_IMMUTABLE` 错误；应用层 schema 也拒绝该字段，形成双重保护。删除家庭仍按现有级联规则执行。

服务端通过 `Intl.DateTimeFormat` 的 IANA 数据校验时区：接受 `UTC`，其余值必须能被运行时解析；保存前转为运行时解析出的规范标识。校验失败返回 `INVALID_TIMEZONE`，不创建或修改任何记录。运行时若不支持 `Intl.supportedValuesOf`，仍以 `DateTimeFormat(..., { timeZone })` 的 `RangeError` 结果作为权威校验。

### 3.2 Goal 与 GoalContribution

`Goal` 增加 `currency`（默认家庭 `baseCurrency`，旧数据回填家庭币种）。新增 `GoalContribution`：

- `familyId`、`goalId`：强制同一家庭；
- `sourceType`、`sourceId`：明确指向一个 Income、Expense、Asset、Liability 或人工来源；
- `amount`、`currency`、`contributionDate`；
- `allocationKey`（家庭内唯一）和创建者/审计时间。

服务层在写入前验证目标、来源和当前 membership 属于同一家庭。Phase 1 对同一来源事实只允许一个目标归属；需要把一笔事实拆给多个目标时另立 allocation-group ADR，不能通过重复插入规避约束。没有明确贡献关系的旧目标不自动回填，进度返回 `unavailable` 及原因，而不是把全局净资产当作贡献。

迁移只新增字段、表、索引和检查约束，不删除既有目标或财务事实。失败采用前向修复/备份恢复，不运行 destructive down migration。

## 4. API 和前端交互

### 4.1 家庭 API

- `POST /families` 接受 `{ name, description?, timezone? }`。省略 `timezone` 时写入 `Asia/Shanghai`；响应、`GET /families` 和 `GET /families/:id` 均返回 `timezone`。
- `PUT /families/:id` 只允许现有的可编辑资料字段。携带 `timezone` 直接返回 HTTP 409 和 `FAMILY_TIMEZONE_IMMUTABLE`，数据库、缓存、审计均零副作用。
- 创建家庭的调用者是任意已认证用户，创建后自动成为该家庭 `admin`；已有家庭的成员管理仍只允许管理员，viewer 不能执行任何 mutation。
- 时区选项不依赖浏览器本地时区。前端优先使用 `Intl.supportedValuesOf('timeZone')` 生成可搜索列表，并提供 `UTC` 和 `Asia/Shanghai`；不支持该 API 时使用版本化的内置回退列表。服务端始终是最终校验者。

### 4.2 表报 API 响应

所有受影响的 report/budget/compare/goal 响应增加：

- `timezone`、`window: { startUtc, endUtc, startLocal, endLocalExclusive }`；
- `baseCurrency`、`totalsByCurrency`；
- `conversionStatus: exact | unavailable | partial`；
- `reconciliationStatus: passed | unavailable | failed`。

现有标量字段在可以证明为单一币种或完整换算时保持兼容；无法安全计算时置为 `null`，前端显示“暂无法合计”而不是零。错误状态必须和真实的零金额区分。

## 5. PeriodWindow 领域服务

新增纯服务 `periodWindowService`，输入家庭时区、期间类型、业务日期和参考时刻，输出 UTC 半开区间 `[startUtc, endUtc)` 及本地展示边界。

- 支持 `CUSTOM`、`MONTHLY`、`QUARTERLY`、`YEARLY`；月末、季度、闰年和 DST 均由 IANA 规则计算，禁止把一天固定当作 24 小时。
- 内部接口只接受 `localStartInclusive` 与 `localEndExclusive`。为保持现有查询兼容，HTTP 的 date-only `endDate=YYYY-MM-DD` 先解释为家庭本地日的最后一天，再转换为下一本地日零点的 exclusive 边界。
- 所有 Prisma 日期查询统一为 `gte(startUtc)` 与 `lt(endUtc)`。服务器、浏览器和数据库主机时区不参与业务边界。
- Budget 的显式 `startDate/endDate` 通过同一解析器归一化；`period` 只决定当前窗口，不得绕过显式起止日。
- 服务不访问 Prisma，路由负责授权并取得家庭时区后再调用；因此可用纯单元测试覆盖 DST 和边界。

## 6. 币种汇总和估值

新增纯服务 `currencySummaryService`，内部保持 Decimal 精度，按币种分组后再决定是否生成基准币种总额：

```json
{
  "baseCurrency": "CNY",
  "totalsByCurrency": { "CNY": 1200.5, "USD": 50 },
  "totalInBaseCurrency": null,
  "conversionStatus": "unavailable"
}
```

- 所有输入记录必须带币种；缺少或非法币种是校验错误，不当作 CNY 或 0。
- 只有所有金额已经是 `baseCurrency`，或未来提供了同一估值日、可审计且完整的汇率集合时，才生成 `totalInBaseCurrency` 并标记 `exact`。
- 缺失任一汇率时标记 `unavailable`（存在部分可换算数据时可标记 `partial`）；两种状态的 `totalInBaseCurrency` 都必须为 `null`，禁止把不同币种直接相加，也禁止用零填充未知值。
- Balance sheet、dashboard、compare 和 goals 使用相同 as-of 时刻与估值规则；当前 Phase 1 对没有历史估值的资产/负债只提供当前快照语义，并在响应中标出 `valuationRuleVersion`。

## 7. 目标贡献隔离

Goal progress 只聚合该 `goalId` 的 `GoalContribution`。服务按贡献币种汇总；目标币种与贡献币种不一致且没有可靠汇率时返回 `unavailable`。创建、更新、删除贡献均走统一 family policy、幂等和审计边界；viewer、跨 family 来源、重复 `allocationKey` 和过期/篡改请求均在持久化前拒绝。

这样两个目标即使属于同一家庭，也只能看到各自显式绑定的来源事实。未建立贡献关系的目标不会继续显示家庭全局净资产、总负债或总资产作为“当前进度”。

## 8. Reconciliation 合同

新增无副作用的 `reconciliation` 工具和断言：

- 每个可计算币种：`netIncome = income - expense`；
- 现金流净额等于所有展示类别（operating、investing、financing、other）的净额之和；
- 资产负债表按同一估值/as-of 规则满足 `assets = liabilities + netWorth`；
- dashboard、report、compare 使用同一期间窗口、币种分组和估值版本。

对账失败返回 `reconciliationStatus=failed` 并记录结构化日志/审计上下文，不降级为 0。数据不可比较时返回 `unavailable` 及缺失原因。

## 9. 授权、错误和数据流

每个请求遵循：`authMiddleware → family membership/role → load family timezone/baseCurrency → PeriodWindow/currency/reconciliation service → Prisma query → response/cache`。任何 cache read、对象存储访问或 AI 执行都不能早于授权。

稳定错误码：

| 场景 | HTTP | code |
|---|---:|---|
| 无效 IANA 时区 | 400 | `INVALID_TIMEZONE` |
| 已有家庭改时区 | 409 | `FAMILY_TIMEZONE_IMMUTABLE` |
| 非法期间或边界 | 400 | `INVALID_PERIOD_WINDOW` |
| 跨家庭/无权限 | 403 | 现有 family policy 错误 |
| 汇率缺失 | 200 | `conversionStatus=unavailable` |
| 对账失败 | 500 | `RECONCILIATION_FAILED` |

## 10. 测试与验收

### 后端

- Family route/integration：默认上海、显式 `UTC`/非 UTC、无效时区、更新拒绝零副作用、列表/详情返回值、viewer/non-member 拒绝。
- PeriodWindow：月初/月末、季度、年度、闰年、Asia/Shanghai 与 DST 时区的春秋切换、date-only endDate 的 exclusive 转换。
- Currency：单币种精确合计、混合币种无汇率、部分汇率、非法/缺失币种、资产负债表与 compare 不再直接混加。
- Goal：两个目标的贡献互不污染、跨 family 来源、重复 allocationKey、币种不一致、无贡献时 `unavailable`。
- Reconciliation：利润表、现金流、资产负债表和 dashboard fixture 的恒等式；空集合、真实零、未知和失败状态分别断言。
- 真实 PostgreSQL：迁移应用于已有库和空库，触发器不可变约束、级联、索引、并发/幂等路径均有证据。

### 前端

- 创建表单默认 `Asia/Shanghai`、搜索并选择其他时区、服务端错误提示。
- 家庭列表/详情只读显示时区，绝不显示修改控件。
- report/budget/compare/goal 对 `null` 合计、`unavailable` 和 reconciliation failure 显示明确状态；不把网络错误或未知值渲染成 0。

质量门禁仍按仓库要求执行：后端 build、全量 coverage、可用时 PostgreSQL integration；前端 lint、build 和受影响组件/浏览器测试。所有新行为先 RED，再最小 GREEN，最后回归。

## 11. 发布、回滚和后续拆分

先部署 additive migration，再部署能读取 `timezone`/新响应字段的后端，最后部署前端；旧客户端省略 timezone 仍得到上海默认值。若发现重复事实、跨家庭暴露、窗口边界或 reconciliation 回归，关闭相关入口/feature flag，保留新增列、贡献、审计和 migration 事实，使用前向修复或恢复备份。

以下事项不在本设计内，需单独 ADR：可修改/迁移家庭时区、历史汇率和估值快照、跨目标拆分 allocation group、自动 recurring 的多时区 catch-up、离线冲突合并，以及真实基础设施和发布观测。
