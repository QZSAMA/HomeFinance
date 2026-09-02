# 前端质量与用户体验分域分析

## 1. 结论

基线审查发现前端已有统一 Axios client，但并非所有页面都使用它；报表页面的裸 `fetch` 导致请求缺少 bearer，并将失败结果转成看似正常的零值。Phase 1 当前切片已为 Import、Recurring 和 AI proposal confirmation 增加行为合同；AI 页面能够发送 proposalId/proposalItemId、刷新后恢复 PROPOSED/EXECUTED 状态，并对确认失败提供可重试状态。全局仍有 18 个 Hook dependency warnings，路由页面仍在 `App.tsx` 顶部 eager import，当前构建主包约 856.71 kB minified。PWA 只证明静态 shell 可安装，不能证明受保护财务数据可离线使用。

本领域已按 `web-design-guidelines` 的核心标准审查：可访问名称、键盘跳转、focus-visible、表单 autocomplete、错误可见性和异步状态；按 React 性能实践审查：路由级 lazy loading、稳定依赖、避免无意义 effect、按需加载重模块。技能标准影响了建议，但事实仍以本仓库代码和运行证据为准。

## 2. 证据

| 问题 | 证据 | 影响 |
|---|---|---|
| 认证 API 断链 | `frontend/src/services/api.ts:5-19` 会注入 bearer；但 `frontend/src/pages/ReportsPage.tsx:240-247` 直接 `fetch(url)`。既有浏览器证据显示 income statement 401 后页面呈现 0。 | 用户会把请求失败误判为没有收入/支出，形成财务决策风险。 |
| 状态模型不完整 | `ReportsPage.tsx` 相关加载逻辑没有将 loading/error/empty/zero/data 作为独立状态合同。 | 未知和真实零值混淆，错误不被发现。 |
| Hook warnings | 基线 lint 0 error/18 warnings，分布在 Dashboard、Reports、AI、Transactions、Assets、Liabilities、Budget、Recurring、Goals、Files、Families 和 FamilySelector。 | familyId、过滤条件或闭包可能使用旧值，且质量门禁不干净。 |
| 路由 eager import | `frontend/src/App.tsx:1-18` 静态导入大量页面；构建主包 854.60 kB minified/237.44 kB gzip。 | 首屏加载与缓存成本高，Reports/Recharts/AI 进入主图。 |
| 可访问性 | 既有 `ui-smoke-result.json` 指出 family select 和四个 date input 缺 accessible name，无 skip link，登录字段缺 autocomplete。 | 键盘、读屏和表单自动填充体验不完整。 |
| PWA 语义 | `frontend/vite.config.ts:9-15` 仅配置静态 precache。 | 不能安全宣称动态财务数据离线可用。 |

### 2.1 2026-09-01 实施状态同步

当前 frontend AI slice 的证据包括：`AIPage` 从 `/ai/history` 恢复 server-owned proposal metadata；确认请求保留 `proposalId`、`expectedVersion`、`expectedHash` 和每个 `proposalItemId`；确认失败呈现 `alert` 并允许 retry；pending 状态阻止重复点击；EXECUTED proposal 刷新后展示已完成状态且不再显示确认按钮。对应组件/服务 focused tests 当前为 6/6；Import/Recurring mutation 状态也有独立稳定 key/状态测试。

这些是 PASS-MOCK/组件与服务合同，不等价于浏览器真实旅程。401/403 报表错误态、a11y、全局 lint warning、route splitting、bundle 预算、Playwright、多标签竞争、外部依赖和发布观察仍是开放项；不得把当前 focused tests 描述为完整 E2E 或生产验证。

## 3. 目标前端契约

1. 所有 API 调用使用配置 client；401/403/5xx 保留为错误，不降级为财务 0。
2. 每个异步区域显式区分 `loading | error | empty | data`，真实金额 0 作为 data 状态的一部分。
3. familyId、query、date window 和 mutation result 都必须在测试中可观察。
4. 关键表单控件有 label/aria-label、name、autocomplete、错误提示和键盘焦点；页面有 skip-to-main。
5. 路由页面默认 lazy；重型图表、AI、导入导出按需加载。
6. “离线”只有在数据隔离、过期、写队列、冲突、退出清除和安全存储全部有测试后才可对外承诺。

## 4. 方案比较

### 4.1 API client 与错误态

方案 A 是先把 ReportsPage/IncomeStatementPage 的裸 fetch 迁移到现有 `reportService` + `api`；方案 B 是在每个页面局部补 Authorization header。推荐 A，避免 token/baseURL/error handler 继续分叉。保留 service adapter 可兼容现有调用签名。

### 4.2 测试栈

推荐 Vitest + React Testing Library + MSW 做组件/服务契约，Playwright 做 3–5 条真实旅程；若团队已有等价栈，可替换，但必须覆盖 401、viewer、记账后报表和 AI confirmation。只依赖手工 smoke 不足以发现请求头与错误态问题。

### 4.3 离线产品

短期方案是修正文案为“可安装，静态 shell 可离线打开”；长期方案才做安全数据缓存和 outbox/conflict model。推荐分开立项，避免静态 precache 被误解为离线记账。

## 5. TDD 实施合同

本节原有 FE-001～FE-003 是基于基线审查形成的后续合同。当前 AI proposal UI 的已完成证据不替代 FE-001～FE-003；它补充了 AI confirmation 的 identity、retry、pending guard 和 refresh recovery 覆盖。

### FE-004：AI proposal identity and refresh recovery

- 已验证文件：`frontend/src/pages/AIPage.test.tsx`、`frontend/src/services/aiService.test.ts`
- 已验证行为：proposal response 的 server-owned `proposalId`/version/hash/item IDs 被保留；确认优先使用 item IDs；请求失败可重试；确认 pending 时按钮禁用；history 恢复 PROPOSED 和 EXECUTED 状态。
- 当前证据：focused component/service tests 6/6；真实浏览器、多标签和 API server integration 仍未运行。
- 后续门禁：Playwright 覆盖登录、切换家庭、proposal 生成、编辑、确认、刷新恢复和 viewer 禁止确认；多标签竞争必须保持服务端幂等结果。

### FE-001：authenticated report request

- RED 文件：`frontend/src/pages/ReportsPage.test.tsx` 或 `frontend/src/services/reportService.test.ts`
- 测试名：`uses the configured API client and shows an error instead of zero on 401`
- 核心断言：render income statement；请求经过 reportService/api 并带 bearer；mock 401 后渲染可见 error state，不渲染“0 元”作为数据结果。
- 命令：`cd frontend; npm test -- src/pages/ReportsPage.test.tsx`
- 预期 RED：当前裸 fetch 没有配置 client；组件会按默认/空值继续显示。
- GREEN：删除裸 fetch，调用 `reportService.getIncomeStatement`，补 loading/error/empty/data 四态。
- REFACTOR：统一 query hook/service adapter，错误消息和 retry 行为标准化。
- 退出门禁：登录、家庭切换、报表请求、401/403、网络错误和真实零值组件测试全绿；Playwright 至少覆盖登录后报表旅程。

### FE-002：a11y contract

- RED 文件：`frontend/src/pages/ReportsPage.a11y.test.tsx`
- 测试名：`gives every report control an accessible name and provides skip navigation`
- 核心断言：date inputs、family selector、tabs/buttons 均可由 role/label 查询；存在 skip link；异步错误容器使用 aria-live。
- GREEN：补 label/aria-label、skip-to-main、focus-visible 和错误 live region。
- REFACTOR：抽取可复用 FormField/AsyncState 组件，保持文字和 focus 行为一致。
- 退出门禁：组件 axe 检查、键盘旅程、移动视口截图和屏幕阅读器可观察名称均通过。

### FE-003：route splitting and Hook warnings

- RED 文件：`frontend/src/App.test.tsx`、CI lint job
- 测试名：`loads route-level pages on demand`；门禁：lint warnings 不得增加
- 核心断言：初始模块图不包含 AI/Reports/Recharts 页面；lint 输出 warnings 为 0。
- 命令：`cd frontend; npm run lint; npm run build`
- 预期 RED：当前 eager imports 存在，基线有 18 warnings。
- GREEN：使用 `React.lazy`/`Suspense` 按路由加载；逐条修正 effect dependencies，优先 primitive dependency 或移除不必要 effect。
- REFACTOR：按功能拆分 chart/AI/import chunks，建立 bundle report 作为 CI 趋势而非虚构固定阈值。
- 退出门禁：lint clean；bundle 有前后真实报告；路由失败有用户可见 fallback。

## 6. 迁移与产品文案

API 迁移可先保留现有 service 函数名，只替换内部实现，降低页面改动面；所有请求失败默认 fail-closed。PWA 文案应同步 README、wiki 和安装提示，直到冲突解决和安全存储完成，不得继续使用“离线可用”作为功能验收。若前端测试栈引入失败，回退到已批准的等价栈，但不能回退到零自动化测试。

