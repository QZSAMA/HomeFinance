# HomeFinance 项目 Wiki

## 目录

1. [项目概述](#项目概述)
2. [系统架构](#系统架构)
3. [数据库设计](#数据库设计)
4. [API 接口文档](#api-接口文档)
5. [AI 智能模块](#ai-智能模块)
6. [安全中间件](#安全中间件)
7. [部署指南](#部署指南)
8. [开发环境](#开发环境)
9. [测试](#测试)
10. [故障排查](#故障排查)

---

## 项目概述

HomeFinance 是一个家庭财务公司化管理系统，将企业三大财务报表（资产负债表、利润表、现金流量表）概念应用到家庭财务管理中。

### 核心价值

- **专业财务视角**：用企业级财务报表思维管理家庭财务
- **智能协作**：支持多成员协作，角色权限控制（admin/member/viewer）
- **AI 赋能**：多轮对话、OCR 票据识别、智能分类、财务分析
- **数据安全**：密码加密存储，数据隔离访问，JWT 鉴权

### 技术栈

| 层级 | 技术 | 版本 |
|-----|------|------|
| 前端 | React | 19.x |
| 前端 | TypeScript | 6.x |
| 前端 | Tailwind CSS | 3.x |
| 前端 | Vite | 8.x |
| 前端 | Zustand | 状态管理 |
| 前端 | Recharts | 图表库 |
| 前端 | vite-plugin-pwa | PWA 支持 |
| 后端 | Node.js | 20.x |
| 后端 | Express | 4.x |
| 后端 | Prisma | 5.x |
| 后端 | Zod | 参数校验 |
| 数据库 | PostgreSQL | 16.x |
| 缓存 | Redis | 7.x |
| 文件存储 | MinIO | latest |
| AI | Volcano Engine Ark | 兼容 OpenAI API |
| OCR | Tesseract.js | 本地识别 |
| 测试 | Jest + ts-jest + supertest | - |

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层 (PWA Web)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │  报表展示  │ │  数据录入  │ │  AI 助手   │ │  预算/目标/定期   ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │  文件管理  │ │  CSV导入  │ │  多家庭对比 │ │  数据导出 Excel  ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
└──────────────────────┬──────────────────────────────────────┘
                       │ RESTful API (CORS + JWT)
┌──────────────────────▼──────────────────────────────────────┐
│                        后端层                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │  用户认证  │ │  报表引擎  │ │  AI 服务  │ │  权限管理        ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │  限流中间件│ │  缓存中间件│ │ OCR 服务  │ │  安全配置校验    ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                        数据层                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐│
│  │  PostgreSQL   │ │   Redis缓存   │ │   MinIO 文件存储     ││
│  └──────────────┘ └──────────────┘ └──────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 前端架构

```
frontend/src/
├── components/          # 通用组件
│   ├── Layout.tsx       # 布局组件（响应式 + 移动端抽屉）
│   ├── FamilySelector.tsx # 家庭选择器
│   ├── ProtectedRoute.tsx # 路由守卫
│   └── charts/          # 图表组件
│       ├── AssetAllocationChart.tsx
│       ├── CashFlowChart.tsx
│       └── IncomeExpenseChart.tsx
├── pages/               # 20 个页面组件
│   ├── LoginPage.tsx / RegisterPage.tsx
│   ├── DashboardPage.tsx
│   ├── FamiliesPage.tsx
│   ├── TransactionsPage.tsx
│   ├── AssetsPage.tsx / LiabilitiesPage.tsx
│   ├── BalanceSheetPage.tsx      # 资产负债表
│   ├── IncomeStatementPage.tsx   # 利润表
│   ├── CashFlowPage.tsx          # 现金流量表
│   ├── InvestmentPage.tsx        # 投资配置
│   ├── BudgetPage.tsx            # 预算管理
│   ├── GoalsPage.tsx             # 财务目标（RadialBarChart）
│   ├── RecurringPage.tsx         # 定期记账
│   ├── AIPage.tsx                # AI 助手（OCR + 对话）
│   ├── AIAnalysisPage.tsx        # AI 分析
│   ├── FilesPage.tsx             # 文件管理
│   ├── ImportPage.tsx            # CSV 导入
│   ├── ComparePage.tsx           # 多家庭对比
│   └── ReportsPage.tsx           # 综合报表
├── services/            # 14 个 API 服务
│   ├── api.ts           # Axios 配置（30s 超时）
│   ├── authService.ts / familyService.ts / financeService.ts
│   ├── reportService.ts / budgetService.ts / goalService.ts
│   ├── recurringService.ts / importService.ts / exportService.ts
│   ├── fileService.ts / categoryService.ts / compareService.ts
│   └── aiService.ts     # AI 服务（含 OCR）
├── store/               # 状态管理 (Zustand)
│   ├── useAuthStore.ts  # 认证状态
│   └── useFamilyStore.ts # 当前家庭状态
├── types/               # TypeScript 类型
│   └── index.ts
├── App.tsx              # 路由配置
├── main.tsx             # 入口文件
└── index.css            # 全局样式
```

### 后端架构

```
backend/src/
├── routes/              # REST API 路由（16 个，含 *.test.ts）
│   ├── auth.ts          # 认证路由
│   ├── families.ts      # 家庭管理路由
│   ├── incomes.ts       # 收入路由（+ 重复检测）
│   ├── expenses.ts      # 支出路由（+ 重复检测）
│   ├── assets.ts        # 资产路由
│   ├── liabilities.ts   # 负债路由
│   ├── reports.ts       # 报表路由
│   ├── files.ts         # 文件路由（+ pHash 去重）
│   ├── ai.ts            # AI 路由（对话 + OCR + 动作执行）
│   ├── budgets.ts       # 预算路由（+ 进度查询）
│   ├── recurring.ts     # 定期记账路由（+ 到期执行）
│   ├── goals.ts         # 财务目标路由（+ 进度计算）
│   ├── category.ts      # 智能分类路由
│   ├── compare.ts       # 多家庭对比路由
│   ├── import.ts        # CSV 导入路由
│   └── export.ts        # Excel 导出路由
├── services/            # 业务服务
│   ├── aiService.ts     # AI 对话 + 多模态
│   ├── aiActions.ts     # AI 动作执行（记账/查询）
│   ├── ocrService.ts    # OCR（Tesseract.js 本地识别）
│   ├── categoryService.ts # 智能分类
│   ├── fileStorageService.ts # MinIO 文件存储
│   ├── importService.ts # CSV 解析
│   └── recurringService.ts # 周期计算
├── middleware/          # 中间件
│   ├── auth.ts          # JWT 认证
│   ├── cache.ts         # Redis 缓存
│   └── rateLimit.ts     # 限流
├── config/              # 配置
│   ├── ai.ts            # AI 服务配置
│   ├── minio.ts         # MinIO 配置
│   ├── redis.ts         # Redis 配置
│   └── security.ts      # 安全配置校验
├── utils/               # 工具函数
│   ├── decimal.ts       # Decimal 转换
│   ├── phash.ts         # 图片哈希
│   └── pagination.ts    # 分页工具
├── tests/               # 测试工厂与 setup
│   ├── factories.ts     # 测试数据工厂
│   ├── setup.ts         # 测试 setup
│   └── database.integration.test.ts # 数据库集成测试
└── app.ts               # Express 应用入口
```

---

## 数据库设计

### 实体关系图

```
users ───< family_members >─── families
users ───> incomes, expenses, files, ai_conversations
families ───> incomes, expenses, assets, liabilities, files,
              ai_conversations, budgets, recurring_transactions, goals
files ───> ai_conversations (可选关联)
```

### 核心表结构

#### users 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| email | String | 邮箱（唯一） |
| passwordHash | String | 密码哈希 |
| name | String | 姓名 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

#### families 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| name | String | 家庭名称 |
| description | String (可选) | 描述 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

#### family_members 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| userId | String | 用户 ID |
| role | String | 角色（admin/member/viewer） |
| createdAt | DateTime | 创建时间 |

#### incomes 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| createdBy | String | 创建者 ID |
| category | String | 类别 |
| amount | Decimal(15,2) | 金额 |
| description | String (可选) | 描述 |
| source | String (可选) | 来源 |
| date | DateTime | 日期 |

#### expenses 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| createdBy | String | 创建者 ID |
| category | String | 类别 |
| amount | Decimal(15,2) | 金额 |
| description | String (可选) | 描述 |
| paymentMethod | String (可选) | 支付方式 |
| date | DateTime | 日期 |

#### assets 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| name | String | 资产名称 |
| type | String | 类型（CASH/STOCK/BOND/GOLD/REAL_ESTATE/FUND/OTHER） |
| category | String (可选) | 类别 |
| value | Decimal(15,2) | 价值 |
| costBasis | Decimal(15,2) (可选) | 成本 |
| currency | String | 货币（默认 CNY） |
| purchaseDate | DateTime (可选) | 购买日期 |
| description | String (可选) | 描述 |

#### liabilities 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| name | String | 负债名称 |
| type | String | 类型 |
| amount | Decimal(15,2) | 金额 |
| interestRate | Decimal(5,4) (可选) | 利率 |
| startDate | DateTime (可选) | 开始日期 |
| endDate | DateTime (可选) | 结束日期 |
| currency | String | 货币（默认 CNY） |

#### files 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| userId | String | 上传者 ID |
| name | String | 文件名 |
| path | String | MinIO 存储路径 |
| type | String | 文件类型 |
| phash | String (可选) | 感知哈希（去重） |
| size | Int | 文件大小 |
| mimeType | String | MIME 类型 |
| uploadedAt | DateTime | 上传时间 |

#### ai_conversations 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| userId | String | 用户 ID |
| content | String | 用户输入 |
| response | String | AI 响应 |
| type | String | 类型（chat/ocr） |
| fileId | String (可选) | 关联文件 ID |
| createdAt | DateTime | 创建时间 |

#### budgets 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| category | String | 类别 |
| amount | Decimal(15,2) | 预算金额 |
| period | String | 周期（默认 MONTHLY） |
| startDate | DateTime | 开始日期 |
| endDate | DateTime (可选) | 结束日期 |
| createdBy | String | 创建者 ID |

#### recurring_transactions 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| type | String | 类型（income/expense） |
| category | String | 类别 |
| amount | Decimal(15,2) | 金额 |
| frequency | String | 频率（DAILY/WEEKLY/MONTHLY/YEARLY） |
| interval | Int | 间隔（默认 1） |
| nextDate | DateTime | 下次执行日期 |
| endDate | DateTime (可选) | 结束日期 |
| isActive | Boolean | 是否激活 |
| lastExecutedAt | DateTime (可选) | 上次执行时间 |
| createdBy | String | 创建者 ID |

#### goals 表

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | String (cuid) | 主键 |
| familyId | String | 家庭 ID |
| title | String | 目标标题 |
| type | String | 类型（SAVING/DEBT_PAYOFF/INVESTMENT） |
| targetAmount | Decimal(15,2) | 目标金额 |
| deadline | DateTime (可选) | 截止日期 |
| isCompleted | Boolean | 是否完成 |
| createdBy | String | 创建者 ID |

---

## API 接口文档

### 认证接口

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户 |

### 家庭管理接口

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/api/families` | 创建家庭 |
| GET | `/api/families` | 家庭列表 |
| GET | `/api/families/:id` | 家庭详情 |
| POST | `/api/families/:id/invite` | 邀请成员 |

### 财务数据接口（均挂在 `/api/families/:familyId/` 下）

| 资源 | 路径 | 说明 |
|-----|------|------|
| 收入 | `/incomes` | CRUD + 重复检测 |
| 支出 | `/expenses` | CRUD + 重复检测 |
| 资产 | `/assets` | CRUD |
| 负债 | `/liabilities` | CRUD |
| 文件 | `/files` | 上传/列表/删除，pHash 去重 |
| 预算 | `/budgets` | CRUD + `/progress` 进度查询 |
| 定期记账 | `/recurring` | CRUD + `/due` + `/:id/execute` |
| 财务目标 | `/goals` | CRUD + `/progress` 进度计算 |
| AI 对话 | `/ai/chat` | 多轮对话 + 动作执行 |
| AI OCR | `/ai/ocr` | 票据图片识别 |
| AI 分类 | `/category/suggest` | 智能分类推荐 |
| CSV 导入 | `/import/csv` `/import/confirm` | 解析预览 + 确认导入 |
| Excel 导出 | `/export/incomes` `/export/expenses` `/export/balance-sheet` | Excel 导出 |

### 报表接口

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/families/:id/reports/balance-sheet` | 资产负债表 |
| GET | `/api/families/:id/reports/income-statement` | 利润表 |
| GET | `/api/families/:id/reports/cash-flow` | 现金流量表 |
| GET | `/api/families/:id/reports/summary` | 财务概览 |
| GET | `/api/families/:id/reports/investment` | 投资配置分析 |

### 跨家庭接口

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/compare/summary` | 多家庭对比汇总 |

### 健康检查

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/health` | 服务健康状态 |

---

## AI 智能模块

### AI 服务架构

```
用户输入 ──> aiService.ts ──> Volcano Engine Ark API
               │                    │
               │                    ▼
               │              结构化 JSON 响应
               │                    │
               ▼                    ▼
          aiActions.ts <──── 解析 action（记账/查询/统计）
               │
               ▼
          执行数据库操作
```

### AI 能力

1. **多轮对话**：维护上下文，支持自然语言查询和操作
2. **动作执行**：AI 返回结构化 action，后端执行记账/查询
3. **OCR 票据识别**：
   - Tesseract.js 本地提取图片文字
   - AI 解析为结构化交易数据
   - 支持多笔交易识别
   - 行内可编辑确认 + 重复检测
4. **智能分类**：基于历史交易描述推荐类别
5. **财务分析**：自动生成财务诊断与建议

### AI 配置

| 变量 | 说明 | 默认 |
|------|------|------|
| `AI_BASE_URL` | AI 服务地址 | Volcano Ark |
| `AI_API_KEY` | AI API Key（留空禁用 AI） | - |
| `AI_MODEL` | AI 模型名 | `ark-code-latest` |

### AI 降级策略

- AI 未配置时：返回 `aiConfigured: false`，OCR 降级返回原始文本
- AI 调用失败时：返回友好错误提示
- 前端超时设置：30 秒

---

## 安全中间件

### 安全配置校验

启动时校验 `JWT_SECRET`：
- 未设置 → 抛错退出
- 使用默认弱值 → 抛错退出
- 长度不足 32 字符 → 抛错退出

### JWT 认证

- 所有 `/api/families/*` 路由需要 JWT
- Token 通过 `Authorization: Bearer <token>` 传递
- 默认有效期 7 天

### 家庭权限控制

- `admin`：完整权限（增删改查 + 邀请成员）
- `member`：增删改查自己创建的数据
- `viewer`：只读

### 限流中间件

- 基于 Redis 计数
- 默认 100 次/15 分钟

### 缓存中间件

- 基于 Redis
- GET 请求缓存
- 数据变更时自动失效

---

## 部署指南

### 一键部署（Docker Compose）

```bash
# 1. 克隆仓库
git clone https://github.com/QZSAMA/HomeFinance.git
cd HomeFinance

# 2. 配置环境变量（生产环境必须修改 JWT_SECRET 和 MINIO_ROOT_PASSWORD）
cp .env.example .env
# 生成强 JWT_SECRET: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. 一键启动
docker-compose up -d

# 4. 查看日志
docker-compose logs -f backend
```

启动后访问：
- 前端：http://localhost
- 后端 API：http://localhost:8080
- MinIO 控制台：http://localhost:9001

数据库迁移自动执行（`prisma migrate deploy`）。

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥（生产必改，至少 32 字符） | `change-this-in-production` |
| `CORS_ORIGIN` | 允许的前端来源 | `http://localhost` |
| `MINIO_ROOT_USER` | MinIO 管理员用户名（生产必改） | `minioadmin` |
| `MINIO_ROOT_PASSWORD` | MinIO 管理员密码（生产必改） | `minioadmin` |
| `AI_BASE_URL` | AI 服务地址 | Volcano Ark |
| `AI_API_KEY` | AI API Key（留空禁用 AI） | - |
| `AI_MODEL` | AI 模型名 | `ark-code-latest` |
| `DATABASE_URL` | PostgreSQL 连接串 | docker-compose 内置 |
| `REDIS_URL` | Redis 连接串 | docker-compose 内置 |

### Docker 命令

```bash
docker-compose up -d        # 启动
docker-compose logs -f      # 查看日志
docker-compose down         # 停止
docker-compose restart      # 重启
```

### 数据库迁移

```bash
cd backend
npx prisma migrate dev      # 开发环境
npx prisma migrate deploy   # 生产环境
npx prisma generate         # 生成客户端
npx prisma studio           # 可视化管理
```

---

## 开发环境

### 启动步骤

```bash
# 1. 启动依赖服务
docker-compose up -d postgres redis minio

# 2. 后端
cd backend
npm install
cp .env.example .env
npx prisma migrate dev
npm run dev  # http://localhost:8080

# 3. 前端（新终端）
cd frontend
npm install
cp .env.example .env
npm run dev  # http://localhost:5173
```

### 访问地址

| 服务 | 地址 |
|-----|------|
| 前端 | http://localhost:5173 |
| 后端 API | http://localhost:8080 |
| MinIO 控制台 | http://localhost:9001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### 环境要求

- Node.js >= 20.x
- Docker >= 24.x（一键部署）/ npm >= 10.x（开发模式）

---

## 测试

```bash
cd backend && npm test
# 22 套件 / 215 测试全绿
```

### 测试覆盖

| 模块 | 测试文件 | 说明 |
|------|----------|------|
| 认证 | auth.test.ts | 注册/登录/获取当前用户 |
| 家庭权限 | families.test.ts | CRUD + 角色权限 |
| 收入/支出 | - | CRUD + 重复检测 |
| 资产/负债 | - | CRUD |
| 预算 | budgets.test.ts | CRUD + 进度计算 |
| 定期记账 | recurring.test.ts | CRUD + 周期计算 + 执行 |
| 财务目标 | goals.test.ts | CRUD + 进度计算 |
| AI | ai.test.ts + aiService.test.ts | 对话 + OCR + 动作执行 |
| 智能分类 | category.test.ts + categoryService.test.ts | 分类推荐 |
| 文件 | files.test.ts + fileStorageService.test.ts | 上传 + pHash 去重 |
| OCR | ocrService.test.ts | Tesseract 本地识别 |
| CSV 导入 | import.test.ts | 解析 + 预览 |
| Excel 导出 | export.test.ts | 导出 |
| 多家庭对比 | compare.test.ts | 对比汇总 |
| 报表 | reports.test.ts | 三大报表 |
| 限流 | rateLimit.test.ts | 限流逻辑 |
| 缓存 | cache.test.ts | 缓存逻辑 |
| 安全配置 | security.test.ts | 环境校验 |
| MinIO | minio.test.ts | 连接配置 |
| 分页 | pagination.test.ts | 分页工具 |
| 数据库集成 | database.integration.test.ts | 真实 DB CRUD/约束/级联 |

### 集成测试

```bash
cd backend && npm run test:integration
# 15 个真实数据库集成测试
```

---

## 故障排查

### 数据库连接失败

1. 检查 Docker 容器：`docker-compose ps`
2. 确认 `DATABASE_URL` 配置
3. 查看日志：`docker-compose logs postgres`

### JWT 认证失败（401）

1. 检查请求头 `Authorization: Bearer <token>`
2. 确认 `JWT_SECRET` 已正确配置（至少 32 字符）
3. 检查 token 是否过期

### 文件上传失败

1. 检查 MinIO 服务：`docker-compose ps`
2. 访问 MinIO 控制台：http://localhost:9001
3. 确认 `.env` 中 MinIO 配置
4. 检查文件大小限制（10MB）

### CORS 错误

1. 检查 `CORS_ORIGIN` 配置
2. 开发环境使用 `http://localhost:5173`

### AI 调用失败

1. 确认 `AI_API_KEY` 已配置（非占位符）
2. 确认 `AI_BASE_URL` 可访问
3. 前端超时设置为 30 秒
4. OCR 首次调用需下载 ~15MB 语言包

### Redis 连接失败

- 系统会降级运行（缓存和限流功能不可用）
- 查看后端日志确认
- 检查 `REDIS_URL` 配置

### Prisma 迁移失败

1. 删除 `prisma/migrations` 目录
2. 重建数据库：`docker-compose down -v && docker-compose up -d`
3. 重新迁移：`npx prisma migrate dev --name init`
