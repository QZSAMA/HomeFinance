# 架构、性能与运营分域分析

## 1. 结论

HomeFinance 适合继续作为模块化单体演进，不需要当前阶段拆微服务。主要架构问题是 route-heavy：路由同时承担授权、输入解析、业务计算、事务和响应组装；报告全表加载到 Node.js reduce，预算存在 N+1，compare 对每个 family 重复查询，app 构建与 `listen` 有副作用。工程门禁方面，CI 运行 Jest 但不运行 coverage，前端只有 build 没有 component/e2e，Docker/Redis/MinIO 和恢复流程尚未被目标环境验证。

## 2. 证据

| 领域 | 证据 | 风险 |
|---|---|---|
| 报表聚合 | `backend/src/routes/reports.ts:29-44,79-109,137-175,220-293` 多处 `findMany + reduce/filter`。 | 数据量增长时内存、响应大小和延迟随行数增长。 |
| Budget N+1 | `backend/src/routes/budgets.ts:43-80` 循环预算并逐个查询 expense。 | 类别/预算数量增加时 query 数线性增长。 |
| Compare 查询 | 既有审查定位 `backend/src/routes/compare.ts:26-42` 每个家庭多次查询。 | family 数量增加导致乘法式查询。 |
| App 副作用 | `backend/src/app.ts:14-75` 同文件构建 app 与 `app.listen`；既有 coverage 显示 app.ts 因此难以单测。 | route test import 可能打开 listener，启动与测试耦合。 |
| CI coverage 缺失 | `.github/workflows/ci.yml:31-33` 运行 `npm test`；Jest threshold 仅在 coverage 模式应用。 | 53.78% statements 等基线并未阻断合并。 |
| 环境未验证 | 既有基线确认 Docker CLI 不可用，Redis/MinIO 未监听；Compose、真实对象存储、恢复和生产负载未测。 | 不能把本地 build 通过等同为全栈可运营。 |

## 3. 目标架构原则

1. `app.ts` 只导出 Express app；`server.ts`/bootstrap 负责连接依赖和 listen。
2. route 只做 HTTP 边界：认证、policy、schema parse、调用 application service、映射错误。
3. report query service 负责 DB aggregation 和公式 service 负责纯数学；返回 bounded response。
4. 列表默认 pagination，旧无分页接口进入 deprecation 窗口。
5. Redis 是可丢缓存，不承载唯一事实；MinIO/DB 依赖状态必须有 readiness 和降级语义。
6. CI 必须在 Node 20 目标版本运行 build、coverage、真实 DB integration、frontend lint/build/component/e2e。

## 4. 方案比较

### 4.1 模块化单体 vs 微服务

推荐先做模块化单体：在当前仓库内建立 Policy、Ledger、Report Query、Cache、Observability 边界，保留单库 transaction。微服务只有在部署隔离、团队边界、容量数据和一致性需求明确后再评估；当前拆分会放大分布式事务、消息重试和运维成本。

### 4.2 性能优化顺序

先用真实规模 fixture 测量 query count、响应大小和 bundle graph，再将全表 reduce 改为 `aggregate/groupBy`，最后做索引与缓存。不能用未测量的 p95 或“查询应该更快”作为结果。分页迁移需保留旧响应 adapter，并在 API 文档中标记 deprecation。

### 4.3 运营可靠性

先加入 requestId、结构化日志、liveness/readiness、关键 metrics，再做备份恢复演练。Redis 故障允许 cache miss；DB 不可用不能返回空财务事实；AI/OCR timeout 必须显示 degraded 状态。

## 5. TDD/门禁实施合同

### ARCH-001：app/server separation

- RED 文件：`backend/src/app.bootstrap.test.ts`
- 测试名：`imports the express app without opening a listener`
- 核心断言：导入 app 只返回可注入 supertest 的 Express instance；不调用 `listen`。
- 命令：`cd backend; npm test -- src/app.bootstrap.test.ts --runInBand`
- 预期 RED：当前 app.ts 同时包含 listen，import 副作用不可控。
- GREEN：将 app construction 与 process startup 分到 `src/app.ts` 和 `src/server.ts`。
- REFACTOR：依赖连接初始化显式注入，测试使用 fake Prisma/Redis/MinIO adapter。
- 退出门禁：全部 route tests、build、正常启动和 graceful shutdown 全绿。

### ARCH-002：bounded DB aggregation

- RED 文件：`backend/src/services/reportQueryService.test.ts`、`backend/src/routes/budgets.performance.test.ts`
- 测试名：`uses bounded aggregate queries for report totals`、`does not issue one expense query per budget`
- 核心断言：报告 response 不携带全表无关字段；预算按 category 一次聚合；query count 不随预算条目数成比例增长。
- 命令：`cd backend; npm test -- src/services/reportQueryService.test.ts src/routes/budgets.performance.test.ts --runInBand`
- 预期 RED：当前 route 使用多次 findMany/循环查询。
- GREEN：先引入 query service，使用 Prisma aggregate/groupBy。
- REFACTOR：补索引、query budget、response projection 和可观测 query latency。
- 退出门禁：真实规模 fixture 有 query count、响应大小、内存和耗时对比；不得虚构生产 p95。

### ARCH-003：CI quality gates

- RED 文件：`.github/workflows/ci.yml` 的 workflow validation 或 `backend/scripts/verify-ci-contract.test.ts`
- 测试名：`ci executes coverage and frontend behavior gates`
- 核心断言：workflow 真实包含 backend `--coverage`、real DB integration、frontend lint/build/component/e2e；当前 coverage 基线不足时 job 失败。
- 命令：`cd backend; npm test -- --runInBand --coverage`
- 预期 RED：本地 coverage threshold 失败，CI 当前只运行无 coverage 的 `npm test`。
- GREEN：CI 显式执行 coverage，并加入前端测试和 Playwright job。
- REFACTOR：把 Node 20、PostgreSQL service、artifact trace、依赖审计和 warning hygiene 统一为 reusable workflow。
- 退出门禁：PR 上真实阻断 coverage、integration、lint、build、e2e；失败可下载证据。

### ARCH-004：observability and recovery

- RED 文件：`backend/src/observability/health.test.ts`、staging smoke tests
- 测试名：`reports dependency degradation without fabricating financial data`
- 核心断言：Redis down 仅导致 cache miss；DB down 不返回空 totals；readiness 准确反映 DB/MinIO/Redis 状态；request log 包含 requestId/familyId/route/status/duration。
- GREEN：实现 liveness/readiness、structured logger 和 degraded response contract。
- REFACTOR：指标覆盖 auth deny、cache hit/miss、DB latency、AI/OCR error、import rows、recurring duplicate prevented、reconciliation failure。
- 退出门禁：staging 重启、Redis/MinIO 故障、AI timeout、migration、备份恢复演练均有记录。

## 6. 运营与发布策略

生产 profile 只暴露 80/443，数据服务使用 internal network 和 secrets；镜像固定 tag/digest，资源限制和非 root 在可行处启用。PostgreSQL/MinIO 是事实/对象存储，应有备份和恢复演练；Redis 可重建。发布前必须有配置扫描、依赖审计、权限矩阵、对账 fixture、性能基线和回滚步骤。

