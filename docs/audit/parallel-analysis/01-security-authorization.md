# HomeFinance 安全与权限并行分析

**范围**：viewer 写权限、`familyId` 租户隔离、报表缓存的授权顺序、认证与 JWT/session/localStorage、登录限流与密码策略、Compose 凭据与端口、依赖供应链。  
**审查基线**：`b103e4221ae58d2cd09ee586d69f3cf90c79c146`；审查日期为 2026-08-27。  
**工作性质**：只读代码/配置/测试/锁定依赖审查。本文件提出未来整改的 TDD 计划，未执行其中 RED/GREEN，也未验证真实生产部署或生产数据。

## 1. 执行摘要

发布阻断项有两项：

| 优先级 | 发现 | 结论 |
| --- | --- | --- |
| P0 / SEC-001 | viewer 可经多条 POST 路由写入，且可由 AI 路径执行写动作 | 只读角色的服务端强制失效；不能仅靠前端隐藏按钮缓解。 |
| P0 / SEC-002 | 报表缓存位于家庭成员校验之前 | 一个已认证但不属于目标家庭的用户，在缓存被成员预热后可能取得该家庭报表。 |
| P1 / SEC-003～007 | 会话撤销、认证防爆破、租户策略集中化、部署默认安全和依赖供应链均存在缺口 | 应在关闭两个 P0 后按本报告的 TDD 门禁推进，不能以“构建通过”替代安全证明。 |

已有的积极控制不应被忽略：数据模型以 `FamilyMember` 的复合唯一键表达成员关系（`backend/prisma/schema.prisma:45-56`）；多数读取和对象级更新会以 `familyId` 比对；生产/开发启动时会拒绝缺失、弱或少于 32 字符的 JWT secret（`backend/src/config/security.ts:20-59`，由 `backend/src/app.ts:7-10` 调用）。这些控制不足以抵消 P0 问题，尤其不能使缓存成为授权边界。

## 2. 方法、证据等级与边界

### 2.1 审查方法

已查阅根目录 `AGENTS.md`、`docs/project-memory.md`、基线审查/改进文件、Prisma schema、所有家庭范围路由、认证/缓存/限流中间件、MinIO 配置、路由/中间件测试、Compose、CI 和前后端锁定依赖。Graphify 的安全节点仅作为定位索引：其“Family-Scoped Authorization Pattern”“Authentication and Persistent Session Flow”“Response Cache Middleware”等关系标记为 `EXTRACTED`；任何 `INFERRED` 边均未单独作为本报告事实依据。源代码行号才是本报告的主证据。

### 2.2 证据等级

- **已验证事实（F）**：本轮直接从可定位源码、配置、schema、测试或 `npm audit --json` 输出确认的行为。
- **合理推断（I）**：由已验证设计必然或高概率导致的攻击面/运维后果；不表示已在生产利用。
- **尚未验证（U）**：需要真实 PostgreSQL/Redis/MinIO、反向代理、浏览器 CSP 或生产配置才能确认的内容。不得以本报告替代渗透测试或部署验收。

### 2.3 当前安全流与应有顺序

当前受保护家庭路由大多采用 `authMiddleware → 路由内 checkFamilyAccess → 数据操作`。报表例外为 `authMiddleware → cacheMiddleware → 路由内 checkFamilyAccess`（`backend/src/routes/reports.ts:21-26`）。推荐的统一顺序如下：

```text
认证 → 解析并验证 familyId → 一次性加载成员关系/权限 →
授权拒绝（不读缓存、不读数据库资源、不调用 AI/对象存储） →
按 family + 规范化查询 + 数据版本读取缓存 → 领域服务/事务 → 审计与缓存版本推进
```

角色合同应明确为：`admin` 管理家庭和成员；`member` 可在家庭内读写财务资源；`viewer` 对家庭范围资源仅可读。最后管理员不能移除或降级的现有保护位于 `backend/src/routes/families.ts:367-387`，但其中允许 viewer 自行删除自己的成员关系，详见 SEC-001。

## 3. 已验证的权限矩阵

下表只列出本范围的**状态变更入口**。`M` 表示已验证只检查成员关系、没有拒绝 viewer；`D` 表示源码已有 viewer 拒绝；`N/A` 表示无需家庭成员角色（例如创建自己的家庭）。它不是“前端能力表”，所有结论均以服务端路由为准。

| 家庭资源/入口 | viewer 当前状态 | 证据（相对路径:行） | 期望 |
| --- | --- | --- | --- |
| 收入、支出创建 | M | `backend/src/routes/incomes.ts:101-123`；`backend/src/routes/expenses.ts:101-123` | 403，且不创建记录 |
| 资产、负债创建 | M | `backend/src/routes/assets.ts:125-149`；`backend/src/routes/liabilities.ts:66-90` | 403 |
| 预算、目标创建 | M | `backend/src/routes/budgets.ts:123-145`；`backend/src/routes/goals.ts:106-127` | 403 |
| 定期规则创建、执行 | M | `backend/src/routes/recurring.ts:99-125,135-188` | 403，且不生成收入/支出 |
| 文件上传、确认导入 | M | `backend/src/routes/files.ts:85-165`；`backend/src/routes/import.ts:55-107` | 403，且不写对象/DB |
| AI 文本 chat 的自动动作、`execute-actions` | M | `backend/src/routes/ai.ts:132-175,457-485` | 403，且不调用动作执行器 |
| 上述资源的典型更新/删除 | D | 如 `backend/src/routes/incomes.ts:139-141`、`backend/src/routes/files.ts:174-176`、`backend/src/routes/recurring.ts:211-212` | 维持 403 |
| viewer 自行移除成员资格 | M | `backend/src/routes/families.ts:353-389`，条件在 `:367` 对任意本人放行 | 应按“viewer 无任何 mutation”合同拒绝，或产品明确例外 |
| 创建家庭 | N/A | `backend/src/routes/families.ts:56-86` | 已认证用户可创建自己的家庭 |

`backend/src/routes/recurring.test.ts:345-356` 与 `backend/src/routes/files.test.ts:139-150` 已覆盖个别删除的 viewer 403；但 `backend/src/routes/recurring.test.ts:58-151,195-288` 和 `backend/src/routes/files.test.ts:88-119` 的创建/执行/上传用例默认 admin，未建立同一角色的拒绝合同。这是测试缺口，不是对当前代码的豁免。

## 4. 发现与整改计划

### SEC-001 — viewer 写权限绕过及 AI 直接写入

**严重度：P0 / 发布阻断**

#### 证据、根因、影响与复现

- **F — 根因**：每个受影响的创建/执行处理器都先调用路由局部 `checkFamilyAccess`，但只在 `!membership` 时拒绝；同一模块的更新/删除才使用 `membership.role === 'viewer'`。最小对照是 `backend/src/routes/incomes.ts:106-123` 与 `:139-141`。同型局部 helper 分散在 `incomes.ts:19-29`、`expenses.ts:19-29`、`assets.ts:21-31`、`liabilities.ts:20-30`、`budgets.ts:22-32`、`goals.ts:21-31`、`recurring.ts:28-38`、`files.ts:21-31`、`import.ts:13-23`、`ai.ts:14-24`、`reports.ts:9-19`、`export.ts:11-21`、`category.ts:8-18`。
- **F — AI 附加缺口**：纯文本 `/chat` 在模型返回动作后立即调用 `executeActions`（`backend/src/routes/ai.ts:165-175`）；`/execute-actions` 也只检查 membership（`:457-468`）。动作执行器可创建和删除账本/资产/负债（`backend/src/services/aiActions.ts:34-54,66-206`）。图片 OCR 路径则将动作作为 `proposedActions` 返回（`backend/src/routes/ai.ts:394-455`），两条路径的确认语义不一致。
- **F — 文件及成员关系**：上传先于对象存储写入只校验 membership（`backend/src/routes/files.ts:85-152`）；viewer 也可因 `req.userId === memberId` 调用成员删除（`backend/src/routes/families.ts:367-387`）。
- **I — 影响**：一个被邀请为 viewer 的账户可篡改家庭财务数据、创建定期规则、上传文件、批量导入，或以自然语言触发 AI 生成写入；定期执行/导入可将单次越权扩大为多条记录。AI 文本自动执行也使模型输出成为未经确认的变更入口。未发现任何生产利用证据。
- **可复现场景（F，可在隔离测试库/Mock 下复现）**：以合法 viewer JWT 调用 `POST /api/families/fam_1/incomes` 并提供有效金额、类别、日期；当前逻辑在 membership 返回 `{ role: 'viewer' }` 后调用 `prisma.income.create` 并返回 201。对 `POST /api/families/fam_1/recurring/rec_1/execute`、`POST .../import/confirm`、`POST .../files/upload` 及 `POST .../ai/execute-actions` 同理。文本 `/ai/chat` 的复现还需令 `chatWithActions` 返回至少一个动作。

#### 方案与推荐

1. **逐路由补 `membership.role === 'viewer'`**：改动小、可快速止血；但已存在 13 份 helper，未来后台作业、导入或 AI 仍会漏接，且无法表达 action/resource policy。
2. **统一家庭授权中间件/策略服务**：新增例如 `requireFamilyRole(['admin', 'member'])` 与 `requireFamilyAccess()`，在授权成功后将不可变的 membership context 附到 request；路由只声明读/写/管理意图。这会一次性解决角色语义和授权顺序问题，需仔细迁移所有路由。
3. **数据库行级安全（RLS）叠加应用策略**：对每个数据库会话设置 tenant context，由 PostgreSQL 再次限制 `familyId`。隔离更强，但 Prisma 连接池、迁移、后台任务和对象存储仍需应用层 policy；单独采用 RLS 不能解决缓存或 AI 确认。

**推荐**：方案 2 作为立即修复，后续评估方案 3 作为纵深防御。统一 policy 应把“读取”“普通写入”“成员管理”“AI 提议确认/执行”定义为显式能力；所有 mutation 默认拒绝 viewer。文本 AI 必须改为只返回服务端签名/保存的提议，且由允许写入的用户在明确确认后执行；不得仅信任客户端回传的模型 action。

#### 兼容迁移、回滚与风险

- **兼容迁移**：先以 shadow/audit 模式记录新策略将拒绝的 route、role、familyId（字段脱敏），仅在测试/预发布确认无预期 member/admin 受阻后，对写入口启用强制；前端可继续显示 viewer 的读页面，但根据服务端能力禁用写控件。为“viewer 自行退出家庭”先取得产品决定：若需要保留，应将它命名为一个显式、审计化的例外，而非通用写权限。
- **回滚**：保留 feature flag，可将策略回退为仅对新路由生效；不得用回滚绕过数据修复。已经被 viewer 创建的数据无法靠代码回滚识别，应先建立审计查询与人工处置流程。AI 提议表/记录要保留 schema 的 expand 阶段，直到旧客户端停止调用自动执行。
- **风险/残余风险**：不对每个 mutation 使用数据库事务/幂等键，重放和并发重复仍会存在；该问题属于账本写入整改，但 policy 测试必须确认 403 时 `Prisma`、MinIO 和 AI executor 均为零调用。中央 middleware 的错误挂载顺序本身会造成新的绕过，故需要 route registration contract test。

#### TDD 整改合同

- **第一个 RED 测试**：在 `backend/src/routes/incomes.test.ts` 新增 `rejects viewer creation without calling prisma.income.create`。Mock membership 为 `{ familyId: 'fam_1', userId: 'user_1', role: 'viewer' }`，以有效 bearer token POST 有效收入；核心断言为 `403` 且 `mockedPrisma.income.create` 未调用。命令：`cd backend; npm test -- --runInBand src/routes/incomes.test.ts -t "rejects viewer creation without calling prisma.income.create"`。**当前预期 RED**：路由只拒绝空 membership，故返回 201 并调用 create。
- **最小 GREEN**：实现并接入 `requireFamilyRole(['admin', 'member'])`，首先覆盖 incomes 创建；保证身份/成员加载只执行一次且拒绝发生于请求体以外的外部副作用之前。
- **REFACTOR 目标**：将矩阵中的 11 类 mutation 及 viewer self-removal 的显式产品决定迁至同一 policy；AI 文本只落提议，不直接执行；导入、定期、AI 执行走同一受事务/幂等保护的应用服务。
- **退出门禁**：参数化 `viewer write matrix` 覆盖本节表中每一写路径，断言 401（未认证）、403（非成员/viewer）、2xx（member/admin）及所有拒绝分支零副作用；运行 `cd backend; npm run build` 和 `cd backend; npm test -- --runInBand --coverage`。涉及 Prisma 写语义时，PostgreSQL 可用后额外运行 `cd backend; npm run test:integration`。AI 路径还须覆盖畸形 action、重放确认及并发确认。

### SEC-002 — 报表缓存先于家庭授权

**严重度：P0 / 发布阻断**

#### 证据、根因、影响与复现

- **F — 根因**：四个报表路由按 `authMiddleware, cacheMiddleware(300), handler` 注册（`backend/src/routes/reports.ts:21,61,119,207`）；`checkFamilyAccess` 位于 handler 内，例如资产负债表 `:23-27`、利润表 `:63-67`。缓存以 `cache:${req.originalUrl}` 为 key（`backend/src/middleware/cache.ts:10`），命中时直接 `res.json(JSON.parse(cached))` 返回（`:13-17`）。
- **F — 测试缺口**：`backend/src/middleware/cache.test.ts:28-51` 只断言 hit/miss 和 URL key；没有 authenticated non-member 的路由集成测试。报表测试文件存在（`backend/src/routes/reports.test.ts`），但当前基线没有缓存前授权合同。
- **I — 影响**：成员 A 访问 `/api/families/fam_A/reports/balance-sheet` 后，已认证但不是 `fam_A` 成员的用户 B 若请求同 URL，将在 route handler 的 membership 查询前命中缓存并得到报表。familyId 在 URL 中不等于已完成授权；该风险不依赖 B 是 viewer 还是其他家庭成员。
- **可复现场景（F）**：在 Redis mock/测试 Redis 中把 key `cache:/api/families/fam_A/reports/balance-sheet` 预置为敏感报表；令 JWT 代表 user B，`familyMember.findUnique` 对 `(fam_A,user_B)` 返回 null；请求同 URL。当前 middleware 已足以在不执行 handler 的情况下返回 200/cache body。真实 Redis 的完整端到端复现为 U。

#### 方案与推荐

1. **仅把路由内 membership middleware 前置于 cache**：以 `auth → requireFamilyAccess → cache → handler` 修复即时泄露。保留 URL key 可在同一家庭成员之间共享缓存，但尚未解决 query 规范化和写后陈旧数据。
2. **以 userId 作为 cache key**：降低不同用户之间复用导致的风险，却扩大缓存空间、损失同家庭复用；更重要的是，若授权仍在 cache 后，缓存依然不应被读取。
3. **family-scoped、版本化 ReportCache**：授权在前；key 包含 `familyId`、路由、规范化后的允许 query 和 `financeVersion`；成功事务提交后递增该家庭版本。这既保护授权顺序，也避免针对 `cache:*` 的全局扫描失效。

**推荐**：立即采用方案 1 关闭泄露，再在同一工作流演进至方案 3。不要以 `userId` key 替代前置授权；缓存永远不是 policy 决策点。

#### 兼容迁移、回滚与风险

- **兼容迁移**：将现有 cache 视为不可信旧数据；发布时使用 namespace 版本（例如 `report:v2:`）而非复用 `cache:`。白名单化 `startDate/endDate` 等查询参数并使用稳定排序/默认值，防止同义 URL 造成缓存分裂。每个财务写事务在 commit 成功后才推进版本。
- **回滚**：可关闭 ReportCache 保持 `auth → authorization → handler`，而不是恢复旧顺序；旧 `cache:*` 键自然过期或由受控、按前缀的维护作业清理。数据库记录不受缓存回滚影响。
- **风险/残余风险**：只改 key 不能修复“先 cache 后授权”；只做 TTL 不能保证写后读新。Redis 不可用时当前 middleware fail-open 到 handler（`backend/src/middleware/cache.ts:29-31`），这对可用性可接受，但需监控，且绝不能降级跳过授权。

#### TDD 整改合同

- **第一个 RED 测试**：在 `backend/src/routes/reports.test.ts` 新增 `rejects a non-member before cache lookup even if a family report is warm`。先模拟成员预热 key，再以 non-member JWT 请求相同报表；核心断言为 `403`、响应不包含缓存 body、`redisClient.get` 未调用。命令：`cd backend; npm test -- --runInBand src/routes/reports.test.ts -t "rejects a non-member before cache lookup even if a family report is warm"`。**当前预期 RED**：middleware 在 membership handler 前返回 200。
- **最小 GREEN**：新增只负责 request family policy 的 middleware 并置于全部 report cache middleware 前；先不改变计算代码和 TTL。
- **REFACTOR 目标**：抽取 `ReportCache`，使用规范化 key + family finance version；所有写应用服务在 commit 后推进版本；淘汰直接覆写 `res.json` 的通用缓存模式，或至少限制它只能用于已经授权、无个体化响应的读路由。
- **退出门禁**：每个报表端点均覆盖缓存 hit/miss 下的未认证、non-member、viewer/member/admin；证明 403 不访问 Redis/Prisma 报表数据，证明不同日期 filter 不能互串，证明写后第一次读为新版本。执行后端 build、`npm test -- --runInBand --coverage` 和真实 PostgreSQL integration；在有 Redis 的预发布环境完成 cache/Redis 故障 smoke（目前 U）。

### SEC-003 — JWT/session 生命周期与 localStorage 暴露面

**严重度：P1**

#### 证据、根因、影响与复现

- **F**：注册/登录签发 bearer JWT，默认有效期为 7 天（`backend/src/routes/auth.ts:46-50,76-80`）；认证 middleware 只验签和过期时间，并没有查询会话、用户状态或撤销记录（`backend/src/middleware/auth.ts:13-37`）。`POST /logout` 仅返回成功（`backend/src/routes/auth.ts:99-100`）。
- **F**：前端将 token 与 user 放在 `localStorage`（`frontend/src/store/useAuthStore.ts:16-25,28-34,41-47`），Axios 在每次请求从 localStorage 构造 `Authorization: Bearer`（`frontend/src/services/api.ts:10-17`）；遇到 401 才删除本地数据（`:21-29`）。认证测试覆盖基本 register/login/me（`backend/src/routes/auth.test.ts:29-164`），未覆盖 logout 后 token 重放、token 轮换或失效。
- **I**：登出后复制出的 bearer token 在到期前仍可访问 API；任何成功执行的同源脚本（例如未来 XSS 或受污染的第三方脚本）可以读取 localStorage token。该推断不等于本轮发现了 XSS，也不等于确认 token 已被盗用。
- **可复现场景（F）**：取得有效 token → 调用 `/api/auth/logout` → 再以相同 token 调用 `/api/auth/me`。由于 logout 无状态且 auth middleware 没有 deny-list 查询，当前实现会验证并继续到 handler（是否返回 200 还取决于 user mock/DB 存在）。

#### 方案与推荐

1. **保持 bearer JWT，仅新增 `jti` + Redis deny-list**：logout 写入 TTL 等于 token 剩余寿命，middleware 拒绝被撤销的 jti；上线快，但所有 bearer token 仍可被脚本读取，Redis 可用性会进入认证路径。
2. **短生命周期 access token + HttpOnly Secure refresh cookie**：access token 仅保存在内存，refresh session 存 HttpOnly、Secure、SameSite cookie，并实现轮换、会话族撤销和 CSRF 防护。可显著降低 token 被 XSS 直接读取的面，但需要 CORS、代理、CSRF、跨域前端和移动端兼容设计。
3. **不透明服务器会话**：cookie 仅持有随机 session id，服务端存 Redis/数据库会话。撤销简单但需要会话存储、横向扩缩容和灾备设计。

**推荐**：分阶段采用 1 → 2。先为 token 加 `jti` 与明确的服务端撤销合同，保留授权头以避免突然破坏 API 客户端；随后转向短 access + 可轮换 HttpOnly refresh session。若短期必须保留 localStorage，应把严格 CSP、第三方脚本控制和 XSS 测试列为必要缓解，而非把它表述为等价安全方案。

#### 兼容迁移、回滚与风险

- **兼容迁移**：签发包含 `jti` 的 JWT，同时兼容不含 jti 的旧 token 直至其最大 7 天寿命结束；引入 refresh cookie 时允许受版本控制的旧 bearer 客户端过渡，发布前验证 `CORS_ORIGIN` 的固定 origin + credentials 设置（当前为 `backend/src/app.ts:16-22`）。添加 cookie 不得关闭 CSRF 验证。
- **回滚**：保留已验证的旧 bearer 接受路径直至迁移窗口结束；若 refresh 服务故障，以短期 bearer 登录重试/受控功能降级为主，不能临时放宽 origin、`Secure` 或 CSRF 规则。撤销表/Redis 键按最大 token TTL 自动清理。
- **风险/残余风险**：deny-list 会增加 Redis 依赖；cookie 会引入 CSRF，需要 origin/CSRF 双重验证；无论选哪一方案，签名密钥轮换、密码改动/账号禁用导致的全会话失效和设备会话可见性仍应成为明确的后续合同。

#### TDD 整改合同

- **第一个 RED 测试**：在 `backend/src/routes/auth.test.ts` 新增 `rejects the same bearer token after logout`。签发含 jti 的测试 JWT，调用 logout 后再次请求 `/api/auth/me`；核心断言为第二次为 401 且受保护 handler/用户查询不执行。命令：`cd backend; npm test -- --runInBand src/routes/auth.test.ts -t "rejects the same bearer token after logout"`。**当前预期 RED**：logout 不存撤销状态，auth middleware 仍只验签。
- **最小 GREEN**：logout 把 `jti` 加入 TTL 与 token 剩余时间一致的 deny-list，auth middleware 在设置 `req.userId` 前检查；对缺失 jti 的过渡 token 有明确到期策略。
- **REFACTOR 目标**：抽取 `SessionService`，支持 refresh rotation、全设备/单设备撤销、secret/key 轮换；前端以 cookie + 内存 access token 取代 localStorage token，错误处理不再依赖强制 `window.location.href`。
- **退出门禁**：覆盖无 token、伪造 token、过期 token、logout 重放、轮换 refresh 重放、账号禁用/密码改动后的 session 失效和 CSRF 负例；后端完整质量门禁，前端执行 `cd frontend; npm run lint`、`cd frontend; npm run build`，并增加浏览器测试证明刷新、登出、401 与跨站 mutation 行为。生产 Cookie/代理头部署验证目前为 U，必须在预发布验收。

### SEC-004 — 登录/注册限流与密码策略不足

**严重度：P1**

#### 证据、根因、影响与复现

- **F**：注册和登录路由没有 `rateLimitMiddleware`（`backend/src/routes/auth.ts:21-97`），password schema 仅要求 6 位（`:10-19`），bcrypt cost 为 10（`:30`）。现有 Redis 限流只挂在 AI 路由（如 `backend/src/routes/ai.ts:132,330,394,457`）。
- **F**：限流 identifier 接受未解析的 `x-forwarded-for`，并在 Redis 异常时记录错误后 `next()`（`backend/src/middleware/rateLimit.ts:10-16,18-36`）。现有单测验证一般限额和不同 IP，但未验证 Redis 故障、代理可信边界或 auth 端点（`backend/src/middleware/rateLimit.test.ts:36-64`）。
- **I**：攻击者可持续尝试登录或批量注册；若公开反向代理没有安全地剥离/设置信任的 `X-Forwarded-For`，伪造 header 可导致限流分片。密码强度过低会降低凭据猜测成本。未验证真实代理的 `trust proxy`、Redis 高可用、账号锁定或凭据泄露情况。
- **可复现场景（F）**：连续发送超过任何期望阈值的错误密码请求到 `/api/auth/login`，当前路由没有计数/429 分支；将 `redisClient.multi().exec()` 设为 reject 后，现有 middleware 将调用 next（`:33-35`）。

#### 方案与推荐

1. **只用现有 Redis middleware 包装 login/register**：最快，但当前 fail-open、client-controlled IP 和全局键无法分别处理账号/IP/注册，且 Redis 故障会恢复无限制尝试。
2. **专用 AuthRateLimitService：按 IP + 标准化 email 的多维滑动窗口/令牌桶**：分别限制 login 失败、login 成功重置策略、注册、密码重置；使用可信代理解析，并在 Redis 失效时转入小容量进程内保守限制及告警。
3. **账户锁定/CAPTCHA**：可在阈值后提高攻击成本，但误伤、枚举和可访问性风险大；不能取代基础限流。不要以“用户不存在”与“密码错误”差异暴露账户。

**推荐**：方案 2，配合渐进密码策略。新密码采用长度优先的明确最小值（例如 12）并允许长 passphrase；不应强制不可预测的组合规则。已有 bcrypt hash 登录成功时可以 rehash 为目标 cost（需依硬件基准决定，不在本报告虚构具体值）；不要强制旧用户立即改密，除非存在可信泄露事件。

#### 兼容迁移、回滚与风险

- **兼容迁移**：先只对登录失败和注册实施监测/阈值告警，校准非生产真实流量后强制 429；新注册实施新密码规则，旧 hash 仍可登录，成功登录后按 hash metadata 渐进升级。响应对存在/不存在用户保持相同文案，沿用当前 `邮箱或密码错误`（`backend/src/routes/auth.ts:67-74`）。
- **回滚**：阈值错误时调整配置而不移除审计/告警；Redis 故障时启用显式保守进程内 bucket 而非无限制 `next()`。密码规则发布问题可仅停止对新注册的强制，不修改既有 hash。
- **风险/残余风险**：过严阈值可能锁住共享 NAT 用户；进程内 fallback 在多实例之间不共享；密码长度不能防御钓鱼/凭据填充，因此后续需要 MFA、密码重置防护和异常登录审计的产品决定。

#### TDD 整改合同

- **第一个 RED 测试**：在 `backend/src/routes/auth.test.ts` 新增 `returns 429 after the configured failed-login threshold for one normalized email and IP`。以同一受信任测试 IP、相同大小写不同的 email 连续发送失败登录，核心断言为达到阈值后 429，且第 N+1 次不再调用 bcrypt。命令：`cd backend; npm test -- --runInBand src/routes/auth.test.ts -t "returns 429 after the configured failed-login threshold for one normalized email and IP"`。**当前预期 RED**：auth routes 未挂限流，所有尝试得到普通 401。
- **最小 GREEN**：在 login/register 前接入专用、可注入的 AuthRateLimitService；只实现测试中的失败登录 bucket，返回统一 429 和 `Retry-After`。
- **REFACTOR 目标**：将通用 middleware 的 Redis 错误策略、可信 proxy IP 解析、指标/告警和注册/重置/登录 buckets 合并为策略化服务；在新密码注册 schema 中实施长度优先规则并记录 hash 版本。
- **退出门禁**：覆盖 malformed 输入、同邮箱不同大小写、同 IP 多账号、多 IP 同账号、成功登录后行为、Redis reject、伪造 forwarded header、注册阈值及非枚举错误；执行后端 build/coverage。真实反向代理 header 与 Redis 故障演练为 U，须在预发布完成并留存结果。

### SEC-005 — `familyId` 租户隔离的策略分散与对象存储边界

**严重度：P1（SEC-002 是已证实的 P0 例外）**

#### 证据、根因、影响与复现

- **F — 数据层边界**：`FamilyMember` 以 `[familyId,userId]` 唯一约束成员关系（`backend/prisma/schema.prisma:45-56`）；Income、Expense、Asset、Liability、File、AiConversation、Budget、RecurringTransaction、Goal 都有 `familyId` 外键和/或索引（`:59-229`）。
- **F — 路由层正向证据**：典型对象更新会在成员检查后取对象并验证对象 familyId，如 income `backend/src/routes/incomes.ts:139-150`、asset `backend/src/routes/assets.ts:165-175`、recurring `backend/src/routes/recurring.ts:140-147`、file 删除 `backend/src/routes/files.ts:174-180`。导出也先成员检查（`backend/src/routes/export.ts:44-63`）。这证明不少路径确实意图实施租户隔离。
- **F — 系统性根因**：每个 family router 复制局部 `checkFamilyAccess`（SEC-001 中完整清单），没有单一 middleware、resource/action matrix 或可供缓存/对象存储/AI 共用的 request policy context。`app.ts` 将全部路由直接注册（`backend/src/app.ts:52-67`），因此新增路由不经过强制 family guard。
- **F — 对象存储关联**：文件列表先做 membership 检查（`backend/src/routes/files.ts:35-78`），随后为每项 path 生成预签名 URL；MinIO 客户端默认凭据和公开端点回退见 `backend/src/config/minio.ts:6-24,60-62`。对象 key 包含 familyId（`backend/src/routes/files.ts:101-104`），但 key 命名不是授权。
- **I**：在当前已读路由中，除 SEC-002 外未验证发现另一条明确的跨家庭 DB 读取绕过；然而策略分散会使新 route、后台任务、缓存或直接对象存储调用遗漏成员检查的概率上升。预签名 URL 一经签发可在其有效期（默认 3600 秒，`minio.ts:60-62`）内被持有者使用；是否被转发、bucket policy、TLS 或外网访问情况均为 U。
- **可复现场景（计划验证）**：以 family B 成员 token 对 family A 的每个 GET、POST、PUT、DELETE 及资源 ID 发请求，期望 403（family 路由）或 404（对象不存在于目标 family 的反枚举策略）；对 file URL，先以非成员请求列表，断言不调用 `getFileUrl`。完整真实 DB/MinIO 复现为 U，需 integration 环境。

#### 方案与推荐

1. **保留局部 helper 并补 route checklist**：不改架构、低风险，但靠人工审查，无法保证新入口、cache 和 background job 的一致性。
2. **集中 `FamilyAccessPolicy` + route declaration**：`auth → requireFamilyAccess(intent)` 成为 family router 的唯一入口；将 membership 放入 typed request context，并由 service 入参要求 `FamilyPrincipal`。对象 storage/AI/cache 必须在取得 context 后调用。
3. **方案 2 + PostgreSQL RLS + 每请求 DB tenant context**：纵深隔离最强，但复杂度高，不能保护 Redis/MinIO，需要单独设计 Prisma transaction 连接语义。

**推荐**：方案 2 作为近期必做，在大规模多租户或外部 API/后台任务扩展前评估方案 3。数据库 schema 的 `familyId` 应继续保留，即使引入 RLS。

#### 兼容迁移、回滚与风险

- **兼容迁移**：先新增 policy 和 typed request context，不删除旧 helper；按 route group（read、ledger write、files、AI、reports/export）迁移，每组在上一个组的 contract matrix 绿灯后再删除局部 helper。旧 URL、body 和响应格式保持不变。
- **回滚**：按 route group feature flag 回退到旧 handler 仅用于短时故障处置；SEC-002 报表绝不可回退到授权后缓存。保留请求日志的 route/family/user（脱敏）以定位误拒绝。
- **风险/残余风险**：中心 policy 代码错误影响面大，故应先用受限 route group 和测试矩阵；对象 URL 无法在已签发后即时撤销，短 TTL、最小权限和撤销设计仍是残余风险。RLS 如果错误配置会制造“看似安全”的假象，不能替代应用层测试。

#### TDD 整改合同

- **第一个 RED 测试**：新增 `backend/src/middleware/familyAccess.test.ts`，测试名 `denies a viewer write intent and exposes no family principal to the downstream handler`。期望对 `requireFamilyAccess({ intent: 'write' })` 的 viewer 请求返回 403，且 downstream spy 为零调用。命令：`cd backend; npm test -- --runInBand src/middleware/familyAccess.test.ts -t "denies a viewer write intent and exposes no family principal to the downstream handler"`。**当前预期 RED**：集中 middleware/typed principal 不存在，且等价路由实现没有统一写意图。
- **最小 GREEN**：实现最小 typed `FamilyPrincipal`、一次 `FamilyMember.findUnique` 查找和 read/write role 判定；先将一个读/写 route pair 接入。
- **REFACTOR 目标**：移除重复 helper；为 Prisma/object-storage/AI/cache 提供只能从已授权 context 获得 familyId 的 service API；在路由注册层加入“family-scoped route 必须声明 policy”的 contract test。
- **退出门禁**：对每个 family route 执行 unauthenticated、non-member、viewer、member、admin、跨 family resource id、恶意/格式错误 familyId 的矩阵；file list non-member 断言不调用 presigner，AI non-member 断言不调用 provider，cache non-member 断言不读 Redis。真实 PostgreSQL/MinIO integration 与权限撤销后的 presigned URL 行为均须验收。

### SEC-006 — Compose 凭据、数据服务端口和镜像供应链暴露

**严重度：P1（取决于 Compose 是否用于可达环境）**

#### 证据、根因、影响与复现

- **F**：Compose 固定 PostgreSQL `postgres/postgres`、映射 `5432:5432`（`docker-compose.yml:5-10`）；Redis 无 `requirepass`/ACL 配置并映射 `6379:6379`（`:19-30`）；MinIO 可回退 `minioadmin/minioadmin` 并映射 API/console `9000/9001`，镜像为浮动 `latest`（`:32-42`）。
- **F**：backend Compose 连接串同样含 PostgreSQL 默认凭据，JWT fallback 为 `change-this-in-production`，MinIO access/secret 有弱回退，backend 端口 8080 暴露（`:51-76`）；frontend 暴露 80（`:86-95`）。应用安全校验会在生产环境拒绝弱 JWT secret（`backend/src/config/security.ts:31-59`），这是积极控制，但不保护 PostgreSQL/Redis/MinIO 默认值。
- **I**：若在公网主机、办公网络或受感染的开发者主机运行，host 映射使数据服务直接成为扫描目标；无认证 Redis 可被本机/网络可达者读写缓存/限流状态。浮动镜像 tag 降低构建可复现性。是否存在防火墙、仅本机绑定、私有网络、TLS、Docker daemon 访问控制或实际公网暴露，本轮均为 U。
- **可复现场景（F 配置级）**：在未提供环境变量时，Compose 解析到已列出的默认数据库/MinIO凭据并发布数据服务端口。未运行完整 Compose；因此网络可达性和容器实际启动结果不在本报告事实范围。

#### 方案与推荐

1. **仅用 `.env` 覆盖默认值**：对本机开发简便，但缺少值时仍可能启动弱服务，且 ports 继续暴露。
2. **开发与生产 profile 分离，生产 required secrets + internal network**：生产不设置默认凭据；仅 gateway 公开 80/443，PostgreSQL/Redis/MinIO 仅 internal network；Redis 配置 ACL/认证，MinIO 使用非 root service credentials，secrets 由部署平台注入。
3. **采用托管数据库/缓存/对象存储**：把网络/备份/TLS 一部分交由平台，但仍需最小 IAM、private endpoint、secret rotation、出站控制和应用层租户授权。

**推荐**：方案 2；方案 3 由部署策略决定。开发 profile 可发布 loopback 端口以便利调试，但绝不作为生产 compose 默认。

#### 兼容迁移、回滚与风险

- **兼容迁移**：保留显式 `compose.dev.yml` 的开发端口和无生产数据卷；新增 `compose.prod.yml`/profile，使用 `${VAR:?required}` 或 secrets 文件，固定 image tag 并优先 digest。给 backend 以专用 DB 用户、MinIO application access key，而不是 root/admin。
- **回滚**：生产改造先做只读/备份恢复演练，网络策略按服务逐个开放内部 DNS，不回滚为公开数据端口。凭据轮换采用双凭据重叠窗口；泄露时撤销旧凭据而不是恢复默认值。
- **风险/残余风险**：internal network 不能防止应用被攻破后横向访问；secrets 进入错误日志/CI 输出仍会泄露；镜像固定 digest 需要持续更新流程，不能永久冻结。

#### TDD/配置整改合同

- **第一个 RED 测试**：新增 `backend/src/config/deploymentConfig.test.ts`，测试名 `rejects production configuration containing any documented development credential fallback`。对 `NODE_ENV=production` 和缺失 JWT/DB/Redis/MinIO secrets 调用纯配置验证函数；核心断言为抛出且错误不回显 secret 值。命令：`cd backend; npm test -- --runInBand src/config/deploymentConfig.test.ts -t "rejects production configuration containing any documented development credential fallback"`。**当前预期 RED**：只校验 JWT；MinIO client 在 `backend/src/config/minio.ts:7-23` 仍自行回退，Compose 也允许默认值。
- **最小 GREEN**：实现不读取/打印 secret 的 production config validator，先拒绝缺失或默认 DB/Redis/MinIO/JWT 值；生产 Compose 删除 data-service host port mapping。
- **REFACTOR 目标**：拆分 dev/prod Compose，采用 secret provider、最小服务账号、TLS/ACL、镜像 digest 和容器安全扫描；healthcheck 改为不含敏感连接信息的单独 app probe。
- **退出门禁**：`docker compose config` 在 production profile 缺少任一 secret 时失败；渲染配置不含默认数据服务凭据；静态检查证明仅 gateway 有 host ports；在隔离预发布完成启动、health、TLS、备份恢复、Redis auth、MinIO最小权限与从外网/旁路网络的不可达验证。该运行时验证当前为 U，不得以本文件宣称完成。

### SEC-007 — 依赖供应链与安全门禁不足

**严重度：P1（安全公告需逐项验证可达性）**

#### 证据、根因、影响与复现

- **F — 本轮 lockfile 审计输出**：在当前工作区执行 `npm audit --json`，backend 得到 6 项（1 low、2 moderate、3 high；生产依赖仍有 5 项），涉及 `body-parser`、`brace-expansion`、`exceljs → uuid`、`fast-xml-parser`、`js-yaml`；frontend 得到 6 项 high，涉及 `brace-expansion`、`fast-uri`、`nanoid`、直接 devDependency `postcss`、`react-router`、直接 dependency `react-router-dom`。这表示依赖解析链命中公告，不表示每个漏洞均可被本产品输入触发。
- **F — manifest 证据**：backend 使用 `exceljs`、`express`、`multer:^1.4.5-lts.1` 等（`backend/package.json:16-30`）；frontend 使用 `vite-plugin-pwa`、`react-router-dom:^7.18.1` 与 `postcss:^8.5.16`（`frontend/package.json:12-32`）。
- **F — CI 缺口**：后端 CI 仅执行 `npm test`（`.github/workflows/ci.yml:31-33`），虽有 Jest coverage threshold（`backend/jest.config.js:17-23`），却没有 `--coverage`，故该阈值在当前 CI 命令中不生效；前端 CI 只类型检查/构建（`.github/workflows/ci.yml:83-106`），`frontend/package.json:6-10` 没有组件或浏览器测试脚本。
- **I**：若盲目执行 `npm audit fix --force`，可能跨越 Express/Vite/Router/Workbox 的破坏性主版本变更；仅升级 lockfile又不做导入、导出、PWA、路由和认证回归，会制造功能/安全回退。公告严重度不等于产品实际风险，需对每条依赖链及输入可达性验证。
- **可复现场景**：`cd backend; npm audit --json` 与 `cd frontend; npm audit --json` 可重复得到当前锁文件的 advisory 集合；具体 CVE 可利用性、攻击 payload 和生产镜像 SBOM 为 U，需版本固定后进一步验证。

#### 方案与推荐

1. **`npm audit fix --force` 一次性修复**：速度快但不可控，可能升级主版本并悄然改变 PWA/Router/构建链；不推荐。
2. **按依赖链分组、小批升级**：先直接且高严重的 `react-router-dom/react-router`、`postcss`，再处理 Workbox/vite-plugin-pwa、ExcelJS/UUID、Express 链；每组审查 lockfile diff、release notes、SBOM 和针对性测试。
3. **持续供应链门禁**：启用锁文件完整性、依赖更新机器人、`npm audit --omit=dev`/全量审计、SBOM、镜像扫描与允许/例外清单；这不能替代当前修复。

**推荐**：方案 2 立即执行、方案 3 固化到 CI。对前端 React Router 公告优先验证当前应用是否启用受影响的服务器组件/动作模式，不能只因版本号就声称远程利用成立。

#### 兼容迁移、回滚与风险

- **兼容迁移**：每个依赖组单独 PR，提交 `package.json`/lockfile/SBOM diff 及公告处置说明；先在隔离分支升级，运行安全及功能回归，才进入下一组。将 npm registry、Node 版本和构建 image 固定在 CI；当前 CI 的 Node 20 见 `.github/workflows/ci.yml:16-21,55-60,89-94`。
- **回滚**：保留上一份 lockfile 和可复现构建 artifact；若升级破坏功能，回滚整个依赖组并以临时隔离/禁用危险入口减轻风险，不能无说明地 ignore advisory。对已确认可利用高危漏洞，回滚需经书面风险接受。
- **风险/残余风险**：transitive dependency 可能由多个父包引入，单一 override 会损害其他路径；devDependency 仍可能影响 CI、构建/源码处理和供应链；SBOM/扫描无法证明运行时授权正确。

#### TDD/升级整改合同

- **第一个 RED 测试**：在 `frontend/src/services/api.test.ts`（引入 Vitest/测试环境后）新增 `clears an unauthorized session without persisting a bearer token after the router/toolchain upgrade`；以 mock 401 响应调用 API，核心断言为不再存在 token 且路由转到 login。命令：`cd frontend; npm run test -- --run src/services/api.test.ts -t "clears an unauthorized session without persisting a bearer token after the router/toolchain upgrade"`。**当前预期 RED**：`frontend/package.json:6-10` 没有 `test` 脚本或测试运行器；这首先暴露“升级没有前端行为门禁”。
- **最小 GREEN**：在不升级业务依赖的独立变更中增加 Vitest + Testing Library（并提供 `npm run test`），使该认证回归可运行；随后按一个依赖组升级，先令该测试和受影响功能测试保持绿。
- **REFACTOR 目标**：为登录、家庭切换、viewer 权限、记账后报表、AI 确认和 PWA 更新建立小而稳定的 component/browser suite；CI 运行 `npm audit` 策略、后端 coverage 和前端测试，并上传 audit/SBOM artifact。
- **退出门禁**：每个依赖组 lockfile diff 经审查，`npm audit --json` 中 high 公告已修复、隔离或有明确书面接受；执行 `cd backend; npm run build`、`cd backend; npm test -- --runInBand --coverage`、必要时 integration、`cd frontend; npm run lint`、`cd frontend; npm run build` 与前端 component/browser tests。不得把“`npm audit` 无输出”作为唯一验收。

## 5. 统一整改依赖、排序与质量门禁

### 5.1 推荐推进顺序

1. **先冻结高风险发布路径**：在合并前完成 SEC-001 的 viewer matrix 和 SEC-002 的 cache authorization RED；若短期不能修复，禁止在不受隔离的环境发布带真实家庭数据的版本。
2. **建立基础 policy 再迁移路由**：实现 `FamilyAccessPolicy`，首先接入 reports、ledger create、recurring/import/files/AI；每迁移一组删除对应局部 helper 的重复实现。
3. **收敛写入与确认合同**：AI 只提议、受授权用户显式确认；定期/导入/AI 使用事务和幂等设计（本报告不声称该部分已完成）。事务 commit 后推进报表 cache version。
4. **认证防护与部署基线**：会话撤销、auth rate limit/password migration、生产 Compose secret/internal network 同步进入预发布验收。
5. **供应链与持续证明**：以小批依赖升级和 CI 门禁使未来变更持续可审计。

### 5.2 跨发现退出标准

以下全部满足才可将安全工作流标记为关闭：

- P0 的非成员缓存命中仍 403，且授权失败时没有 cache/DB/AI/MinIO 外部副作用。
- viewer 对所有 family mutation 403，member/admin 的既有允许行为保持；产品若保留 viewer 自行退出，已有明确 ADR、审计和单独测试。
- token 登出/撤销、过期、轮换和 rate-limit 的负例都有可重复测试；localStorage 到 cookie 的迁移（若实施）有 CSRF/CORS/浏览器测试。
- 每个 family scoped endpoint 的 tenant matrix 在 unit/route 测试绿，跨表写入和存储在 PostgreSQL/Redis/MinIO 预发布 integration 绿。
- production Compose 不能在默认凭据下渲染/启动；只有设计允许的入口有 host port；凭据、端口、TLS/ACL和恢复演练有运行时证据。
- 高危依赖公告均有升级、隔离或风险接受记录，且 CI 执行 coverage、前端行为测试和供应链检查。

## 6. 尚未验证项（不得误报为已关闭）

1. 完整 Docker Compose 尚未在本轮启动，因此 PostgreSQL/Redis/MinIO 的真实监听、网络策略、TLS、bucket policy、服务账号和环境变量来源均为 U。
2. 未对真实数据库执行跨家庭并发/重放/对象存储预签名 URL 转发实验；已确认的是源码控制流和 schema，而不是生产数据可见性。
3. 未检查反向代理、WAF、`trust proxy`、CSP/HSTS、安全响应头、第三方脚本清单或真实浏览器 XSS 防护，不能断言 localStorage token 已被窃取或 cookie 改造已安全。
4. `npm audit` 反映当前 lockfile advisory，不证明某个 CVE 在本产品输入面可利用；需要逐条版本、调用链和运行时验证。
5. 没有生产访问日志、用户数量、人日、成本、SLO/p95 或攻击事件证据；本报告未虚构这些数据。

## 7. 结论

HomeFinance 已有 family 外键/成员约束和 JWT secret 启动校验，但服务端 RBAC 并未覆盖所有 mutation，且 report cache 允许在 family 授权前返回结果。两者共同破坏“viewer 只读”和“familyId 是 tenant boundary”这两个产品不变量，应作为发布阻断优先关闭。其余会话、限流、部署和依赖问题不应被延后到功能迭代后：它们需要与统一 family policy、可回滚的 session 迁移、生产配置校验及 CI 证据链一起推进。

本轮仅完成分析和方案设计；所有 RED/GREEN/REFACTOR 事项均为后续实现计划，尚未通过测试或部署验收。
