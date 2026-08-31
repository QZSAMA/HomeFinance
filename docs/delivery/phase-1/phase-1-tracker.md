
# HomeFinance Phase 1 任务追踪表

- 任务系统：Phase 1 可信账本与质量门禁
- 唯一事实源：本文件
- 设计规格：docs/superpowers/specs/2026-08-28-homefinance-phase1-design.md
- 开发基线：codex/phase0-remediation@081084a
- 实施分支：codex/phase1-ledger-trust
- 当前快照：2026-08-31；设计已批准，P1-B-04 已在 PostgreSQL 18.1 localhost:5433 完成真实并发/重放回归，并在 `DomainError.cause` 保留未分类 Prisma 原始错误；P1-B-05 新增真实数据库证明：20 路相同命令只使 `Family.cacheVersion` 前进一次，已完成的回放不新增事实也不前进 revision（PASS-REAL）；P1-G-06 的 Prisma 适配器测试使默认 function coverage 达到 64.06%，branch coverage 从 45.38% 提升至 46.01%，补上 `Map`/`Set`/`RegExp` 非普通对象拒绝契约，并使 MinIO 初始化失败可交给 `server.ts` 统一降级、验证重复 shutdown 仅释放一次；P1-G-03 已为 ImportPage 建立 3 条 PASS-MOCK 交互合同：可访问文件选择、失败/成功状态和悬挂确认的本地防重复；P1-A-03 已以真实 PostgreSQL failure injection 证明空 resourceId 会回滚 Income、IdempotencyRecord 和 AuditEvent（PASS-REAL）；Income/Expense route adoption、upgrade/restore、staging/release 仍未完成

## 1. 状态和字段规则

生命周期：BACKLOG → EVIDENCE_CONFIRMED → READY → RED_REPRODUCED → GREEN_MINIMAL → REFACTORED → REGRESSION_VERIFIED → IN_REVIEW → MERGED → RELEASED → OBSERVED → DONE。

健康度：ON_TRACK、AT_RISK、BLOCKED。BLOCKED 不替代生命周期，必须保留实际停留状态、原因、解除责任人和复查日期。CANCELLED 必须链接范围变更或 ADR。

证据状态：DESIGNED、NOT_RUN、BLOCKED、PASS-MOCK、PASS-REAL、PASS-E2E、OBSERVED、FAILED、WAIVED。

任务字段固定为：id、type、epic、title、outcome、priority、state、health、dri、approver、reviewers、depends_on、blocked_by、acceptance、evidence、adr、rollback、target、next_action、updated、mirror。

依赖格式：hard:P1-A-03@REGRESSION_VERIFIED、decision:ADR-0001@ACCEPTED、external:POSTGRES_TEST_ENV@AVAILABLE。只维护 depends_on，反向 blocks 由查询推导。

## 2. 基线证据

| 项目 | 证据状态 | 说明 |
|---|---|---|
| Phase 0 后端 26 suites / 241 tests | PASS-MOCK | 历史证据，081084a，本轮未重跑 |
| Phase 0 前端 5 tests | PASS-MOCK | 历史证据，081084a |
| backend coverage | FAILED | 34 suites / 281 tests 通过；本轮 coverage 为 statements 63.22%、branches 46.01%、functions 64.06%、lines 63.58%，全局 branch threshold 60% 未达标；OCR/MinIO fixtures 有既有 console.warn |
| PostgreSQL migration/业务并发 | PASS-REAL | localhost:5433 `homefinance_phase1_test`；fresh migration、schema/rollback、P1-B-04 20 路 coordinator replay 与 P1-B-05 revision/replay 一致性已通过 |
| Redis 故障恢复 | NOT_RUN | 现有主要为 mock |
| MinIO 生命周期 | NOT_RUN | 现有主要为 mock |
| Compose 全栈 | NOT_RUN | 当前未完成全栈验证 |
| Playwright | DESIGNED | 当前尚无脚本 |
| Phase 1 功能 | PASS-MOCK + PASS-REAL | app/server/db、纯 Ledger contract、schema/migration 与 P1-B-04 coordinator adapter 已验证；Income/Expense route、import/recurring/AI adoption 仍未接入 |

## 3. 责任边界

| 角色 | 责任 |
|---|---|
| Delivery DRI | 实现、TDD、状态和证据卡 |
| Repository Owner | 范围、书面规格、合并和工程验收 |
| Technical Approver | 架构、事务、迁移和 API |
| Finance/Product Owner | 期间、币种、分类、导入策略、目标、后台 actor |
| Security Reviewer | family、角色、AI 确认、篡改、重放、零副作用 |
| QA/Evidence Owner | integration、E2E、真实环境和证据 |
| Release Owner | migration、发布、回滚和观察 |
| Agent | 在互斥写集内分析、编码、测试和提出风险，不代替批准人 |

## 4. 任务表

| ID | 类型 | Epic | 任务与结果 | 优先级 | 状态 | 健康 | DRI | Approver | 依赖 | 验收 | 证据 | ADR | 回滚/下一动作 | 更新 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1-0-01 | TASK | P1-0 | 冻结 Phase 1 分支基线 | P0 | DONE | ON_TRACK | Delivery DRI | Repository Owner | — | 从 081084a 创建分支且工作树干净 | evidence/P1-0-01.md | — | 不合并 main；提交治理文件 | 2026-08-28 |
| P1-0-02 | TASK | P1-0 | 建立 tracker 和证据卡规则 | P0 | IN_REVIEW | ON_TRACK | Delivery DRI | Repository Owner | hard:P1-0-01@DONE | 单一状态源、状态机、字段、DoR/DoD 明确 | evidence/P1-0-02.md | — | 保留审查文档；审阅书面规格 | 2026-08-28 |
| P1-0-03 | TASK | P1-0 | 提交详细设计规格 | P0 | IN_REVIEW | ON_TRACK | Delivery DRI | Repository Owner | hard:P1-0-01@DONE | 架构、数据流、API、TDD、门禁、回滚完整 | evidence/P1-0-03.md | ADR-0001~0005 | 审阅前不实施；请用户审阅 | 2026-08-28 |
| P1-0-04 | TASK | P1-0 | 建立所有写入口与角色矩阵 | P0 | EVIDENCE_CONFIRMED | ON_TRACK | Delivery DRI | Security Reviewer | hard:P1-0-03@IN_REVIEW | routes、roles、families、外部副作用可追踪 | evidence/P1-0-04.md | ADR-0001 | 写首个 RBAC RED | 2026-08-28 |
| P1-0-05 | DECISION | P1-0 | 批准 Ledger、事务、幂等合同 | P0 | DONE | ON_TRACK | Delivery DRI | Repository Owner | hard:P1-0-03@IN_REVIEW | service boundary、operation、audit、revision 明确 | evidence/P1-0-05.md | ADR-0001, ADR-0002 | ADR-0001/0002 已正式 Accepted；进入 schema RED | 2026-08-28 |
| P1-0-06 | DECISION | P1-0 | 批准 Import、AI mutation 合同 | P0 | EVIDENCE_CONFIRMED | ON_TRACK | Delivery DRI | Finance/Product Owner | hard:P1-0-03@IN_REVIEW | 整批原子、proposal-only、编辑/hash 明确 | evidence/P1-0-06.md | ADR-0003, ADR-0004 | 不回退 partial/auto write；待批准 | 2026-08-28 |
| P1-0-07 | GATE | P1-0 | 冻结测试和环境基线 | P0 | EVIDENCE_CONFIRMED | AT_RISK | QA/Evidence Owner | Repository Owner | hard:P1-0-03@IN_REVIEW | 命令、套件、coverage、依赖、环境如实记录 | evidence/P1-0-07.md | — | 环境不可用标 BLOCKED；获取 PG | 2026-08-28 |
| P1-G-00 | TASK | P1-G | 分离 app/server/db 启动边界 | P0 | REFACTORED | AT_RISK | Delivery DRI | Technical Approver | hard:P1-0-03@DONE | app import 无 listener/Redis/MinIO 副作用 | evidence/P1-G-00.md | ADR-0001 | build、focused 和 256 个默认单元测试通过；补足全局 branch coverage 后再推进 `REGRESSION_VERIFIED` | 2026-08-28 |
| P1-A-01 | TASK | P1-A | 固化 Income/Expense CRUD 特征测试 | P0 | BACKLOG | ON_TRACK | Ledger Agent | Technical Approver | hard:P1-0-04@READY | 响应兼容、family 隔离、viewer 拒绝 | evidence/P1-A-01.md | ADR-0001 | 先不迁 route；写 focused RED | 2026-08-28 |
| P1-A-02 | TASK | P1-A | 定义 Ledger command/result/error | P0 | REFACTORED | AT_RISK | Ledger Agent | Technical Approver | hard:P1-0-05@ACCEPTED | service 不依赖 Express，错误稳定 | evidence/P1-A-02.md | ADR-0001, ADR-0002 | top-level effectiveDate 合同已通过 12 个 focused tests；待 route/schema 和全局 coverage 门禁 | 2026-08-28 |
| P1-A-03 | TASK | P1-A | 建立 Ledger 事务编排骨架 | P0 | REFACTORED | AT_RISK | Ledger Agent | Technical Approver | hard:P1-A-02@REGRESSION_VERIFIED; hard:P1-G-00@REGRESSION_VERIFIED | policy、idempotency、write、audit 同 transaction | evidence/P1-A-03.md | ADR-0001, ADR-0002 | real PostgreSQL rollback injection 已证明空 resourceId 后 Income、IdempotencyRecord、AuditEvent 零持久化；coverage 依赖未满足，禁止 route adoption | 2026-08-31 |
| P1-A-04 | TASK | P1-A | 迁移 Income create/update/delete | P0 | BACKLOG | ON_TRACK | API Agent | Technical Approver | hard:P1-A-03@REGRESSION_VERIFIED | route 无直接 Income mutation，响应兼容 | evidence/P1-A-04.md | ADR-0001 | 入口回退，不双写 | 2026-08-28 |
| P1-A-05 | TASK | P1-A | 迁移 Expense create/update/delete | P0 | BACKLOG | ON_TRACK | API Agent | Technical Approver | hard:P1-A-03@REGRESSION_VERIFIED | route 无直接 Expense mutation，响应兼容 | evidence/P1-A-05.md | ADR-0001 | 入口回退，不双写 | 2026-08-28 |
| P1-A-06 | TASK | P1-A | 增加乐观版本并发合同 | P1 | REFACTORED | AT_RISK | Database Agent | Technical Approver | hard:P1-A-04@REGRESSION_VERIFIED; hard:P1-A-05@REGRESSION_VERIFIED | 相同 version 竞争一个成功、一个 409 | evidence/P1-A-06.md | ADR-0002 | PostgreSQL predicate PASS-REAL；待 route/service 接入和 409 映射 | 2026-08-28 |
| P1-A-07 | GATE | P1-A | 禁止受控入口绕过 Ledger | P0 | BACKLOG | ON_TRACK | Security Reviewer | Repository Owner | hard:P1-A-04@REGRESSION_VERIFIED; hard:P1-A-05@REGRESSION_VERIFIED | 源码检查和 route tests 无直接账目写入 | evidence/P1-A-07.md | ADR-0001 | 发现旁路即阻断 | 2026-08-28 |
| P1-B-01 | TASK | P1-B | 新增 IdempotencyRecord schema/migration | P0 | REFACTORED | AT_RISK | Database Agent | Technical Approver | hard:P1-0-05@DONE; decision:ADR-0002@ACCEPTED | family/actor/operation/key 唯一 | evidence/P1-B-01.md | ADR-0002 | `17c2644` fresh PG migration/unique/default/version PASS-REAL；待并发 replay/upgrade/restore 后评审 | 2026-08-28 |
| P1-B-02 | TASK | P1-B | 实现 payload hash/coordinator | P0 | REFACTORED | AT_RISK | Ledger Agent | Technical Approver | hard:P1-B-01@REGRESSION_VERIFIED; hard:P1-A-02@REGRESSION_VERIFIED | 相同 key/hash 重放一份结果 | evidence/P1-B-02.md | ADR-0002 | 纯合同为 PASS-MOCK；P1-B-04 已补真实 adapter/replay 证据；route adoption 仍未完成 | 2026-08-28 |
| P1-B-03 | TASK | P1-B | 固化 key 冲突错误 | P0 | BACKLOG | ON_TRACK | Ledger Agent | Security Reviewer | hard:P1-B-02@REGRESSION_VERIFIED | 同 key/不同 hash 409 且零写入 | evidence/P1-B-03.md | ADR-0002 | 不复用不同 payload | 2026-08-28 |
| P1-B-04 | GATE | P1-B | 真实 PostgreSQL 并发仲裁 | P0 | REGRESSION_VERIFIED | AT_RISK | Database Agent | QA/Evidence Owner | hard:P1-B-02@REGRESSION_VERIFIED; external:POSTGRES_TEST_ENV@AVAILABLE | 20 并发一条账且可 replay | evidence/P1-B-04.md | ADR-0002 | localhost:5433 全套重跑通过；映射前原始 Prisma 异常现保留在非枚举 `DomainError.cause`，但尚未在真实偶发故障中采样；route adoption 与全局 coverage 仍是后续门禁 | 2026-08-31 |
| P1-B-05 | GATE | P1-B | 验证 revision/幂等一致 | P0 | REGRESSION_VERIFIED | AT_RISK | Database Agent | Technical Approver | hard:P1-B-04@REGRESSION_VERIFIED; external:POSTGRES_TEST_ENV@AVAILABLE | 20 路同命令 revision 只前进一次；completed replay 不新增事实且不前进 revision | evidence/P1-B-05.md | ADR-0001, ADR-0002 | localhost:5433 PASS-REAL；不手工 bump trigger；route adoption、P1-B-04 偶发 INTERNAL_ERROR 分类、upgrade/restore、staging/release 与全局 coverage 仍为门禁 | 2026-08-31 |
| P1-C-01 | TASK | P1-C | 固化 import 资源限制 | P1 | BACKLOG | ON_TRACK | Import Agent | Security Reviewer | hard:P1-0-06@ACCEPTED | byte/row/field limit 边界返回 413 | evidence/P1-C-01.md | ADR-0003 | limit-1/limit/limit+1 | 2026-08-28 |
| P1-C-02 | TASK | P1-C | 新增 ImportBatch/ImportRow schema | P0 | BACKLOG | ON_TRACK | Database Agent | Technical Approver | hard:P1-B-01@REGRESSION_VERIFIED | hash/version/status 可追踪 | evidence/P1-C-02.md | ADR-0003 | additive migration；写 RED | 2026-08-28 |
| P1-C-03 | TASK | P1-C | 持久化服务端 preview | P0 | BACKLOG | ON_TRACK | Import Agent | Technical Approver | hard:P1-C-02@REGRESSION_VERIFIED | confirm 不信任客户端日期/金额/type | evidence/P1-C-03.md | ADR-0003 | 保留 preview adapter；写篡改 RED | 2026-08-28 |
| P1-C-04 | TASK | P1-C | 实现整批原子 confirm | P0 | BACKLOG | ON_TRACK | Import Agent | Finance/Product Owner | hard:P1-C-03@REGRESSION_VERIFIED; hard:P1-B-02@REGRESSION_VERIFIED | 任意行失败账目为零 | evidence/P1-C-04.md | ADR-0003 | 暂停旧 confirm；写 failure RED | 2026-08-28 |
| P1-C-05 | GATE | P1-C | 验证 import retry/replay/concurrency | P0 | BLOCKED | AT_RISK | QA/Evidence Owner | Technical Approver | hard:P1-C-04@REGRESSION_VERIFIED; external:POSTGRES_TEST_ENV@AVAILABLE | 并发 confirm 只提交一次 | evidence/P1-C-05.md | ADR-0002, ADR-0003 | 无 PG 不关闭；安排集成环境 | 2026-08-28 |
| P1-C-06 | TASK | P1-C | 更新前端 import 状态流程 | P1 | BACKLOG | ON_TRACK | Frontend Agent | Repository Owner | hard:P1-C-04@REGRESSION_VERIFIED | 显示 batch、失败行、确认状态 | evidence/P1-C-06.md | ADR-0003 | 保留旧字段 adapter；冻结 API | 2026-08-28 |
| P1-D-01 | TASK | P1-D | 新增 RecurringExecution schema | P0 | BACKLOG | ON_TRACK | Database Agent | Technical Approver | hard:P1-B-01@REGRESSION_VERIFIED | rule+scheduledFor 唯一 | evidence/P1-D-01.md | ADR-0002 | additive migration；不删历史 rule | 2026-08-28 |
| P1-D-02 | TASK | P1-D | 实现 recurring 同事务执行 | P0 | BACKLOG | ON_TRACK | Recurring Agent | Technical Approver | hard:P1-D-01@REGRESSION_VERIFIED; hard:P1-A-03@REGRESSION_VERIFIED | entry/execution/nextDate 同提交 | evidence/P1-D-02.md | ADR-0002 | 保留 route adapter；写回滚 RED | 2026-08-28 |
| P1-D-03 | TASK | P1-D | 迁移 recurring route 到 Ledger | P0 | BACKLOG | ON_TRACK | Recurring Agent | Technical Approver | hard:P1-D-02@REGRESSION_VERIFIED | route 无直接写账 | evidence/P1-D-03.md | ADR-0001, ADR-0002 | 入口 flag；迁移 route | 2026-08-28 |
| P1-D-04 | GATE | P1-D | 覆盖 recurring 并发/失效/边界 | P0 | BLOCKED | AT_RISK | QA/Evidence Owner | Technical Approver | hard:P1-D-03@REGRESSION_VERIFIED; external:POSTGRES_TEST_ENV@AVAILABLE | 20 并发一条 entry；失效不写 | evidence/P1-D-04.md | ADR-0002 | 无 PG 不标观察通过 | 2026-08-28 |
| P1-E-01 | TASK | P1-E | 固化 text AI 自动写账 RED | P0 | BACKLOG | ON_TRACK | AI Agent | Security Reviewer | hard:P1-0-04@READY | 确认前账目不变 | evidence/P1-E-01.md | ADR-0004 | 保留旧测试为历史证据 | 写 proposal RED | 2026-08-28 |
| P1-E-02 | TASK | P1-E | 新增 AIProposal/Item 合同 | P0 | BACKLOG | ON_TRACK | Database Agent | Technical Approver | hard:P1-B-01@REGRESSION_VERIFIED; hard:P1-0-06@ACCEPTED | 状态、version、hash、来源和过期可追踪 | evidence/P1-E-02.md | ADR-0004 | additive migration；写 schema RED | 2026-08-28 |
| P1-E-03 | TASK | P1-E | chat/OCR 统一 proposal-only | P0 | BACKLOG | ON_TRACK | AI Agent | Security Reviewer | hard:P1-E-01@REGRESSION_VERIFIED; hard:P1-E-02@REGRESSION_VERIFIED | AI provider 输出绝不直接写账 | evidence/P1-E-03.md | ADR-0004 | 暂停 auto adapter；迁移 text | 2026-08-28 |
| P1-E-04 | TASK | P1-E | 实现 AI 显式确认事务 | P0 | BACKLOG | ON_TRACK | AI Agent | Technical Approver | hard:P1-E-03@REGRESSION_VERIFIED; hard:P1-A-03@REGRESSION_VERIFIED | proposal 抢占、mutation、audit 同事务 | evidence/P1-E-04.md | ADR-0001, ADR-0002, ADR-0004 | proposal 过期不删事实；写双击 RED | 2026-08-28 |
| P1-E-05 | TASK | P1-E | 更新前端 proposal 编辑/确认 | P1 | BACKLOG | ON_TRACK | Frontend Agent | Repository Owner | hard:P1-E-04@REGRESSION_VERIFIED | 用户可编辑、确认、取消、查看状态 | evidence/P1-E-05.md | ADR-0004 | 保留旧展示字段；冻结 API | 2026-08-28 |
| P1-E-06 | GATE | P1-E | 覆盖 viewer/篡改/重放/过期 | P0 | BACKLOG | ON_TRACK | Security Reviewer | Repository Owner | hard:P1-E-04@REGRESSION_VERIFIED | 恶意/越权路径零账本副作用 | evidence/P1-E-06.md | ADR-0004 | bypass 阻断发布；负向矩阵 | 2026-08-28 |
| P1-F-01 | DECISION | P1-F | 批准 timezone/period window | P1 | BACKLOG | ON_TRACK | Delivery DRI | Finance/Product Owner | hard:P1-0-03@IN_REVIEW | half-open、family timezone、边界明确 | evidence/P1-F-01.md | ADR-0005 | 未批准不改统计语义；形成 ADR | 2026-08-28 |
| P1-F-02 | DECISION | P1-F | 批准 base currency/缺失汇率 | P1 | BACKLOG | ON_TRACK | Delivery DRI | Finance/Product Owner | hard:P1-0-03@IN_REVIEW | 分币种、不虚假求和、回填明确 | evidence/P1-F-02.md | ADR-0005 | 未批准保守拒绝；形成 ADR | 2026-08-28 |
| P1-F-03 | TASK | P1-F | 让 Budget period 约束统计窗口 | P1 | BACKLOG | ON_TRACK | Backend Agent | Finance/Product Owner | hard:P1-F-01@ACCEPTED | 月/季/年边界正确 | evidence/P1-F-03.md | ADR-0005 | 入口回退；写 period RED | 2026-08-28 |
| P1-F-04 | TASK | P1-F | 隔离 Goal contribution 计算 | P1 | BACKLOG | ON_TRACK | Backend Agent | Finance/Product Owner | hard:P1-F-01@ACCEPTED | 多目标不污染、可解释 | evidence/P1-F-04.md | ADR-0005 | 保留旧只读路径；写 RED | 2026-08-28 |
| P1-F-05 | GATE | P1-F | 建立三表 reconciliation fixtures | P0 | BACKLOG | ON_TRACK | QA/Evidence Owner | Finance/Product Owner | hard:P1-F-01@ACCEPTED; hard:P1-F-02@ACCEPTED | net income/cash flow/balance/dashboard 恒等式 | evidence/P1-F-05.md | ADR-0005 | 未知不渲染为零；建 fixture | 2026-08-28 |
| P1-G-01 | GATE | P1-G | 真实 PostgreSQL migration/事务 | P0 | REFACTORED | AT_RISK | QA/Evidence Owner | Release Owner | external:POSTGRES_TEST_ENV@AVAILABLE | migration、trigger、rollback、concurrency PASS-REAL | evidence/P1-G-01.md | ADR-0001, ADR-0002 | `17c2644` fresh migration/trigger/rollback PASS-REAL；待并发、populated upgrade、restore/staging | 2026-08-28 |
| P1-G-02 | GATE | P1-G | 完成角色×方法×入口矩阵 | P0 | BACKLOG | ON_TRACK | Security Reviewer | Repository Owner | hard:P1-0-04@READY | 401/403/200/2xx 且零副作用 | evidence/P1-G-02.md | ADR-0001 | 不降低断言；扩展 tests | 2026-08-28 |
| P1-G-03 | TASK | P1-G | 补齐前端 mutation 行为测试 | P1 | GREEN_MINIMAL | AT_RISK | Frontend Agent | QA/Evidence Owner | hard:P1-0-03@IN_REVIEW | error/loading/confirm/replay 可测 | evidence/P1-G-03.md | — | ImportPage 3 条与 AIPage 2 条 PASS-MOCK 合同已覆盖可访问文件选择、确认 alert/status 与悬挂确认本地防重复；继续覆盖其他 mutation entry，且不把 UI 禁用当成服务端幂等 | 2026-08-31 |
| P1-G-04 | GATE | P1-G | 建立 Playwright 关键旅程 | P1 | BACKLOG | ON_TRACK | Integration Agent | QA/Evidence Owner | hard:P1-G-00@REGRESSION_VERIFIED | login/switch/CRUD/report/viewer/import/AI | evidence/P1-G-04.md | — | 只 mock 外部 AI；选 E2E 栈 | 2026-08-28 |
| P1-G-05 | GATE | P1-G | Redis/MinIO/Compose 故障恢复 | P0 | BLOCKED | AT_RISK | Integration Agent | Release Owner | external:COMPOSE_ENV@AVAILABLE | down/up、授权、生命周期、降级 PASS-REAL | evidence/P1-G-05.md | — | 不隐藏依赖故障；准备 Compose | 2026-08-28 |
| P1-G-06 | GATE | P1-G | coverage/lint/advisory 门禁 | P1 | RED_REPRODUCED | AT_RISK | QA/Evidence Owner | Repository Owner | hard:P1-0-07@REGRESSION_VERIFIED | coverage 真执行、warning 不增、high 有处置 | evidence/P1-G-06.md | — | Prisma 适配器现拒绝 NaN/±Infinity 和非普通对象；MinIO 初始化错误由 `server.ts` 统一降级并有幂等 shutdown 回归。34 suites/281 tests 通过；branch 46.01% 仍低于 60%，继续安全关键分支测试且不降低阈值 | 2026-08-31 |
| P1-H-01 | TASK | P1-H | 同步 API、ADR、memory、风险 | P0 | BACKLOG | ON_TRACK | Delivery DRI | Repository Owner | hard:P1-A-07@REGRESSION_VERIFIED | 长期事实和证据一致 | evidence/P1-H-01.md | ADR-0001~0005 | 文档随代码同提交；按变更更新 | 2026-08-28 |
| P1-H-02 | TASK | P1-H | 增量更新和复核 Graphify | P1 | BACKLOG | ON_TRACK | Delivery DRI | Technical Approver | hard:P1-H-01@REGRESSION_VERIFIED | EXTRACTED/INFERRED 边有结论 | evidence/P1-H-02.md | — | 不手改生成图；运行 semantic update | 2026-08-28 |
| P1-H-03 | GATE | P1-H | migration/发布/回滚演练 | P0 | BLOCKED | AT_RISK | Release Owner | Repository Owner | hard:P1-G-01@PASS-REAL; hard:P1-G-05@PASS-REAL | staging RELEASED 后 OBSERVED | evidence/P1-H-03.md | — | 前向修复/恢复；安排 staging | 2026-08-28 |
| P1-H-04 | GATE | P1-H | Phase 1 退出评审 | P0 | BACKLOG | ON_TRACK | Repository Owner | Repository Owner | hard:P1-H-03@OBSERVED; hard:P1-G-04@PASS-E2E; hard:P1-F-05@REGRESSION_VERIFIED | 无未接受 P0/P1，退出证据齐全 | evidence/P1-H-04.md | — | 失败保持原状态；生成快照 | 2026-08-28 |

## 5. Definition of Ready

任务进入 READY 前必须具备唯一 ID、结果、范围、DRI、Approver、优先级；源码 route/service/schema 和 family/role 范围；首个 RED 的文件、测试名、fixture、命令和预期失败；授权、重试、并发、异常、日期、币种语义；migration、兼容、回滚路径；对应财务/安全/产品决策。

任务明细中的 reviewers、blocked_by、target 和 mirror 使用证据卡或本节补充登记；它们不另建状态源。当前阻塞登记如下：

| 任务 | blocked_by | 解除责任人 | 复查 |
|---|---|---|---|
| P1-C-05、P1-D-04 | external:POSTGRES_TEST_ENV@AVAILABLE | QA/Evidence Owner / Release Owner | 本地 PostgreSQL 已可用；对应功能 schema/service 完成后复查 |
| P1-G-05 | external:COMPOSE_ENV@AVAILABLE | Integration Agent / Release Owner | Compose 环境可用后立即复查 |

目标日期不在环境和批准条件明确前虚构；GitHub mirror 只在创建 Issue 后回填，Markdown 状态仍是唯一事实源。

## 6. Definition of Done

必须有真实 RED、最小 GREEN、REFACTOR 后绿色；相关 build、lint、unit、integration、coverage、component、E2E 证据；安全负向矩阵；财务边界和 reconciliation；无部分提交、重复事实和越权副作用；migration 和回滚演练；API、ADR、project memory、审计风险、Graphify 同步；已 RELEASED 并 OBSERVED；无未处理高风险或有正式接受责任人和到期日。

## 7. 证据卡规则与 GitHub 镜像

每个任务对应 evidence/<ID>.md，固定记录 baseline commit、branch/commit、source evidence、affected family/role/route/table、RED 命令和失败、GREEN、REFACTOR、regression、security matrix、database/migration、frontend/E2E、release environment、observed result、rollback rehearsal、ADR/memory/Graphify updates、remaining risks。N/A 必须说明原因。

Markdown 是主库，GitHub Issue/Project 只是镜像。Issue 标题为 [P1-A-01] 任务名；字段映射 state→Status、health→Health、priority→Priority、epic→Epic、dri→Assignee。GitHub 状态变更必须通过 PR 更新本文件；冲突以默认分支最新 tracker 为准；每周检查漂移。
