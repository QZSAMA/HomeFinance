# HomeFinance Phase 0 第一轮整改实施报告

## 1. 结论

本轮在隔离分支 `codex/phase0-remediation` 完成五项风险优先整改：统一家庭写权限、报表授权前置、家庭版本化缓存与写后读一致性、现金流守恒、前端利润表认证调用与错误态。所有行为变更均保留了先失败后通过的测试证据。

这不是 Phase 0 的完整退出声明。当前代码级回归门禁已通过，但真实 PostgreSQL 集成测试因本机测试凭据不可用未执行成功；真实 Redis、MinIO、Compose 和浏览器 E2E 未验证；后端仍有 3 个 high advisory，前端仍有 6 个 high advisory；前端仍有 16 个既有 lint warning。因此当前状态是“第一轮整改已回归验证，待环境与供应链门禁”，不是 `Released/Observed`。

## 2. 证据卡

| ID | RED 证据 | 最小 GREEN / REFACTOR | 回归状态 | 当前状态 |
|---|---|---|---|---|
| HF-SEC-001 | `family-permissions.test.ts` 初次运行 12/12 失败，viewer 获得 200/201 并触发 mutation；独立复核又发现 AI analyze 可写会话、未知角色 fail-open | 新增统一 `familyAccess` middleware；挂接收入、支出、资产、负债、预算、目标、定期、文件、导入和全部会持久化的 AI 写入口；写角色采用 admin/member allowlist；保留文件删除兼容错误文案 | viewer 参数化测试、AI analyze、未知角色和零副作用断言通过；后端全量单测通过 | Regression verified；完整角色×方法×入口矩阵仍需继续扩展 |
| HF-SEC-002 | 成员预热缓存后，非成员请求同一 URL 收到 200 和缓存数据 | 报表路由固定为 auth → family policy → cache → handler；移除 handler 重复授权 | 非成员 403，且授权失败前 Redis `get` 未调用 | Regression verified；待真实 Redis/多实例观察 |
| HF-CACHE-001 | 写入支出后立即读取 summary 收到 `HIT / 0`，预期 `MISS / 125`；独立复核又复现 500 被缓存，以及 Redis 离线写入后重启/跨实例会丢失进程内 dirty 标记 | cache key 改为 family + durable finance revision + URL；`Family.cacheVersion` 由 PostgreSQL trigger 与 family-scoped mutation 在同一事务内递增；授权查询携带 revision；缺少可信 revision 或 Redis 不可用时 fail-safe 绕过缓存；错误响应不缓存 | 写后读、旧 Redis revision、缺失 revision、错误响应和 migration trigger 合同测试通过 | Regression verified；真实 PostgreSQL migration/trigger、Redis 网络分区和多实例拓扑仍需目标环境观察 |
| HF-FIN-001 | other income 100、other expense 30 时 `netCashFlow` 返回 4000，预期 4070；重叠关键词会把同一记录计算两次 | 增加 `other.net = 70` 并纳入总额；净额与互斥分类抽到 `reportFormulas.ts` | other 守恒和重叠分类 fixture 通过 | Regression verified；分类会计口径仍待财务 owner 确认 |
| HF-FE-001 | 初始 2 个组件测试失败；独立复核又发现其余报表错误显示 0、家庭切换旧请求覆盖、重置复用旧日期 | 统一配置 Axios client；四区 loading/error/data；请求序号忽略过期响应；事件处理器显式传递/清空日期；补可访问 label | 1 file / 5 tests 通过；Node 20.19.5 test/build/lint 通过 | Regression verified；浏览器 E2E 尚未执行 |

## 3. 实施范围

### 3.1 权限边界

- viewer 对 family-scoped mutation 统一返回 403。
- 权限拒绝发生在 Prisma mutation、MinIO upload 和 AI action executor 之前。
- `check-duplicate` 保持只读入口。
- AI chat/OCR/analyze 因会写 conversation/file，整体要求 member/admin。
- family 管理继续使用既有 admin 与最后管理员连续性规则。

### 3.2 缓存协议

报表读取路径为：

```text
JWT authentication → family membership → family-versioned cache → report handler
```

缓存键为：

```text
cache:family:v2:<familyId>:v<version>:<originalUrl>
```

`version` 来自 PostgreSQL `Family.cacheVersion`，不是 Redis 自身状态。`v2` 是协议 epoch，用于保证迁移后不会命中旧实现留下的同 revision key。migration 为所有 family-scoped mutable table 安装 trigger，使 revision 与 INSERT/UPDATE/DELETE 在同一数据库事务内提交或回滚。旧版本对象无需扫描删除；Redis 离线期间的成功写入仍会推进持久 revision，进程重启或请求切换实例后不会重新采用旧 Redis 命名空间。授权上下文拿不到合法 revision 或 Redis 未就绪时直接绕过缓存，Redis 始终只是可丢弃优化而不是事实源。

### 3.3 财务与前端契约

- `netCashFlow = operating + investing + financing + other`。
- `other` 响应现在包含 `income`、`expense`、`net`，前端类型已同步。
- 利润表通过配置 Axios client 请求，沿用 bearer 注入。
- 请求失败显示明确 alert，不再把未知状态渲染为财务 0。

## 4. 可复现质量结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 后端单元/路由回归 | `npm test -- --runInBand --testPathIgnorePatterns=database.integration.test.ts` | 26 suites / 241 tests 通过 |
| 后端构建 | `npm run build` | 通过 |
| Prisma schema | `npx prisma validate`（注入非生产占位 `DATABASE_URL`） | 通过 |
| 前端组件测试 | `npm test` | 1 file / 5 tests 通过 |
| 前端 lint | `npm run lint` | 0 error / 16 个既有 warning |
| 前端构建 | `npm run build` | 通过；主包 856.15 kB / 237.67 kB gzip，仍有大包 warning |
| 后端依赖审计 | `npm audit --json` | 1 low / 2 moderate / 3 high |
| 前端依赖审计 | `npm audit --json` | 6 high |

测试输出中的 OCR/MinIO warning 来自既有的故障降级 fixture。真实数据库集成套件未计入上述 241 个测试；CI 已加入 trigger 增量与事务回滚测试，但本机尚未执行，不得据此宣称 PostgreSQL trigger、Redis 或 MinIO 集成已经通过。

## 5. 回滚与后续推进

- 权限回滚不得恢复到 viewer 可写；若新 policy 有兼容问题，只能入口级修正错误文案或策略映射。
- 缓存可临时关闭读取优化，但不得恢复“缓存先于授权”。
- 财务公式回滚必须同时回滚 API 类型和 reconciliation 测试，不允许仅删断言。
- 前端错误时必须保留 error state，不得回退为零值。

下一批建议按此顺序推进：在 staging 先执行并验证 durable cache revision migration；供应链 high advisory 分组升级与兼容验证；补齐 unauthenticated/non-member/viewer/member/admin 的方法矩阵；在可用 PostgreSQL/Redis/MinIO 环境运行集成与故障恢复测试；完成浏览器关键旅程；然后进入 Ledger Application Service、recurring exactly-once 和 import batch 原子性。
