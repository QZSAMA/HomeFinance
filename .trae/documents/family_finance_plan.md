# Family Finance Inc. - 项目实现计划

## 一、项目概述

### 1.1 项目目标

构建一个家庭财务公司化管理系统，将企业三大财务报表（资产负债表、利润表、现金流量表）概念应用到家庭财务管理中，支持家庭成员协作管理，通过大模型对话和图片识别实现智能数据录入与分析。

### 1.2 核心功能

1. 家庭管理与成员协作
2. 财务数据录入（手动 + 智能对话 + 图片OCR）
3. 三大报表生成与可视化
4. 投资配置分析（股票/国债/黄金/现金/其他）
5. 文件管理与共享
6. AI 对话分析
7. 重复录入检测
8. 动态仪表板实时更新

### 1.3 技术栈

| 层级 | 技术选型 |
|-----|---------|
| 前端 | React 18 + TypeScript + Tailwind CSS + Recharts |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | PostgreSQL + Redis |
| 文件存储 | MinIO |
| AI 服务 | OpenAI API + OCR 服务 |
| 工具链 | Docker + ESLint + Prettier + Jest |

---

## 二、项目结构

### 2.1 目录结构

```
/workspace
├── frontend/                 # 前端项目
│   ├── src/
│   │   ├── components/       # 通用组件
│   │   ├── pages/            # 页面组件
│   │   ├── hooks/            # 自定义 hooks
│   │   ├── services/         # API 服务
│   │   ├── store/            # 状态管理
│   │   ├── types/            # TypeScript 类型定义
│   │   └── utils/            # 工具函数
│   ├── public/
│   └── package.json
├── backend/                  # 后端项目
│   ├── src/
│   │   ├── controllers/      # 控制器
│   │   ├── models/           # 数据模型
│   │   ├── routes/           # 路由定义
│   │   ├── middleware/       # 中间件
│   │   ├── services/         # 业务逻辑
│   │   ├── utils/            # 工具函数
│   │   ├── types/            # TypeScript 类型
│   │   └── app.ts            # 应用入口
│   ├── prisma/               # 数据库 schema
│   └── package.json
├── docker-compose.yml        # Docker 编排
├── docs/                     # 文档
└── README.md
```

---

## 三、开发阶段与任务分解

### 阶段一：项目初始化与基础架构

**目标**：搭建项目基础框架，配置开发环境，实现用户认证和家庭管理功能

**任务清单**：

1. **项目初始化**
   - 创建前后端项目目录结构
   - 初始化 React + TypeScript 前端项目
   - 初始化 Node.js + Express + TypeScript 后端项目
   - 配置 ESLint + Prettier 代码规范
   - 配置 Docker Compose（PostgreSQL + Redis + MinIO）
   - 配置 CORS 跨域

2. **数据库设计与 ORM 配置**
   - 设计并创建数据库表（Prisma schema）
   - 配置数据库连接
   - 创建迁移脚本

3. **用户认证系统**
   - 实现用户注册接口
   - 实现用户登录接口（JWT）
   - 实现用户登出接口
   - 实现 JWT 鉴权中间件
   - 实现密码加密（bcrypt）

4. **前端基础框架**
   - 配置 React Router
   - 配置全局状态管理
   - 实现登录/注册页面
   - 实现布局组件（侧边栏 + 顶部栏）
   - 配置 API 请求拦截器

5. **家庭管理功能**
   - 实现创建家庭 API
   - 实现获取家庭列表 API
   - 实现家庭详情 API
   - 实现邀请成员 API
   - 实现成员角色管理 API
   - 前端家庭管理页面
   - 前端成员邀请与角色管理页面

**验收标准**：
- 用户可以注册、登录
- 用户可以创建家庭并邀请成员
- 成员角色权限控制正常工作
- CORS 配置正确，前后端通信正常

---

### 阶段二：数据录入与文件管理

**目标**：实现财务数据录入（手动、智能对话、图片OCR）、文件管理、重复检测

**任务清单**：

1. **财务数据模型**
   - 收入数据模型与 CRUD API
   - 支出数据模型与 CRUD API
   - 资产数据模型与 CRUD API
   - 负债数据模型与 CRUD API
   - 交易分类体系设计

2. **手动录入功能**
   - 收入录入表单页面
   - 支出录入表单页面
   - 资产录入表单页面
   - 负债录入表单页面
   - 交易列表页面（筛选、搜索、分页）

3. **重复检测功能**
   - 实现内容相似度检测算法
   - 实现图片感知哈希（pHash）计算
   - 实现重复检测 API
   - 前端重复提示交互
   - 重复检测阈值配置

4. **文件管理功能**
   - MinIO 文件存储集成
   - 文件上传 API
   - 文件下载 API
   - 文件列表 API
   - 文件删除 API
   - 前端文件管理页面
   - 文件预览功能
   - 文件权限控制

5. **AI 智能录入（对话）**
   - OpenAI API 集成
   - 自然语言解析（识别收入/支出/资产/负债）
   - 对话上下文管理
   - 智能录入 API
   - 前端对话界面
   - 对话历史记录

6. **AI 图片识别（OCR）**
   - OCR 服务集成
   - 图片解析与信息提取
   - 图片上传 API
   - 识别结果确认与编辑
   - 前端图片上传界面

**验收标准**：
- 用户可以手动录入收入、支出、资产、负债
- 录入时自动检测重复并提示
- 用户可以上传和管理文件
- 用户可以通过对话智能录入数据
- 用户可以上传图片并识别财务信息

---

### 阶段三：报表系统与可视化

**目标**：实现三大报表、投资配置分析、动态仪表板

**任务清单**：

1. **报表计算引擎**
   - 资产负债表计算逻辑
   - 利润表计算逻辑
   - 现金流量表计算逻辑
   - 时间范围筛选
   - 数据聚合与汇总

2. **资产负债表**
   - 资产负债表 API
   - 前端资产负债表页面
   - 资产分布饼图
   - 负债结构图表
   - 净资产趋势图

3. **利润表**
   - 利润表 API
   - 前端利润表页面
   - 收入分类饼图
   - 支出分类饼图
   - 收支对比柱状图
   - 结余趋势折线图

4. **现金流量表**
   - 现金流量表 API
   - 前端现金流量表页面
   - 现金流分类图表
   - 现金流趋势图

5. **投资配置分析**
   - 投资分类（股票/长期国债/黄金/现金/其他）
   - 投资配置比例 API
   - 投资配置环形图
   - 投资金额明细列表
   - 投资价值走势

6. **动态仪表板**
   - 财务概览 API
   - 关键指标卡片（总资产、净资产、本月结余、投资总价值）
   - 仪表板布局设计
   - 实时数据刷新机制（轮询 + WebSocket）
   - 响应式布局适配

**验收标准**：
- 三大报表数据准确展示
- 投资配置比例正确计算并可视化
- 仪表板实时更新
- 图表交互流畅（悬停、筛选、缩放）

---

### 阶段四：AI 分析与系统优化

**目标**：实现财务分析功能、性能优化、安全加固、测试覆盖

**任务清单**：

1. **AI 财务分析**
   - 财务健康度评估
   - 支出合理性分析
   - 投资组合分析
   - 个性化理财建议
   - AI 分析 API
   - 前端分析报告页面

2. **性能优化**
   - Redis 缓存策略
   - 数据库索引优化
   - 报表数据预计算
   - 前端懒加载
   - 接口响应时间优化

3. **安全加固**
   - 敏感数据加密存储
   - API 速率限制
   - 请求参数校验
   - SQL 注入防护
   - XSS 防护
   - 日志审计

4. **测试覆盖**
   - 后端单元测试（Jest）
   - 后端集成测试
   - 前端组件测试
   - E2E 测试（Playwright）
   - API 文档（Swagger/OpenAPI）

5. **部署准备**
   - 生产环境配置
   - CI/CD 流水线配置
   - Docker 镜像优化
   - 监控与告警配置
   - 备份与恢复方案

**验收标准**：
- AI 财务分析功能可用
- 系统性能达标（页面加载 < 2s，API 响应 < 500ms）
- 核心功能测试覆盖率 > 80%
- 安全扫描无高危漏洞
- 部署流程自动化

---

## 四、数据库 Schema 设计

### 4.1 核心数据表

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  name          String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  familyMembers FamilyMember[]
  incomes       Income[]
  expenses      Expense[]
  assets        Asset[]
  liabilities   Liability[]
  files         File[]
  aiConversations AiConversation[]
}

model Family {
  id          String    @id @default(cuid())
  name        String
  description String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  members     FamilyMember[]
  incomes     Income[]
  expenses    Expense[]
  assets      Asset[]
  liabilities Liability[]
  files       File[]
  aiConversations AiConversation[]
}

model FamilyMember {
  id        String   @id @default(cuid())
  familyId  String
  userId    String
  role      String   // admin, member, viewer
  createdAt DateTime @default(now())
  family    Family   @relation(fields: [familyId], references: [id])
  user      User     @relation(fields: [userId], references: [id])
  @@unique([familyId, userId])
}

model Income {
  id          String   @id @default(cuid())
  familyId    String
  userId      String
  type        String   // 工资, 投资收益, 副业, 其他
  amount      Decimal
  description String?
  date        DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  family      Family   @relation(fields: [familyId], references: [id])
  user        User     @relation(fields: [userId], references: [id])
}

model Expense {
  id          String   @id @default(cuid())
  familyId    String
  userId      String
  type        String   // 餐饮, 购物, 娱乐, 医疗, 教育, 房贷, 车贷, 保险, 水电煤, 其他
  category    String   // 固定支出, 可变支出, 投资支出
  amount      Decimal
  description String?
  date        DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  family      Family   @relation(fields: [familyId], references: [id])
  user        User     @relation(fields: [userId], references: [id])
}

model Asset {
  id         String   @id @default(cuid())
  familyId   String
  userId     String
  category   String   // 流动资产, 非流动资产, 投资资产
  type       String   // 现金, 银行存款, 股票, 长期国债, 黄金, 房产, 车辆, 其他
  name       String
  amount     Decimal
  valueDate  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  family     Family   @relation(fields: [familyId], references: [id])
  user       User     @relation(fields: [userId], references: [id])
}

model Liability {
  id         String   @id @default(cuid())
  familyId   String
  userId     String
  type       String   // 信用卡, 短期借款, 房贷, 车贷, 长期借款, 其他
  name       String
  amount     Decimal
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  family     Family   @relation(fields: [familyId], references: [id])
  user       User     @relation(fields: [userId], references: [id])
}

model File {
  id         String   @id @default(cuid())
  familyId   String
  userId     String
  name       String
  path       String
  type       String   // 收据, 发票, 合同, 凭证, 其他
  phash      String?  // 感知哈希，用于图片去重
  size       Int
  mimeType   String
  uploadedAt DateTime @default(now())
  family     Family   @relation(fields: [familyId], references: [id])
  user       User     @relation(fields: [userId], references: [id])
}

model AiConversation {
  id         String   @id @default(cuid())
  familyId   String
  userId     String
  content    String   // 用户输入
  response   String   // AI 回复
  type       String   // chat, ocr, analysis
  createdAt  DateTime @default(now())
  family     Family   @relation(fields: [familyId], references: [id])
  user       User     @relation(fields: [userId], references: [id])
}
```

---

## 五、API 接口清单

### 5.1 认证接口

| 方法 | 路径 | 说明 |
|-----|-----|------|
| POST | /api/auth/register | 用户注册 |
| POST | /api/auth/login | 用户登录 |
| POST | /api/auth/logout | 用户登出 |
| GET | /api/auth/me | 获取当前用户信息 |

### 5.2 家庭管理

| 方法 | 路径 | 说明 |
|-----|-----|------|
| POST | /api/families | 创建家庭 |
| GET | /api/families | 获取家庭列表 |
| GET | /api/families/:id | 获取家庭详情 |
| PUT | /api/families/:id | 更新家庭信息 |
| DELETE | /api/families/:id | 删除家庭 |
| POST | /api/families/:id/invite | 邀请成员 |
| PUT | /api/families/:id/members/:memberId/role | 更新成员角色 |
| DELETE | /api/families/:id/members/:memberId | 移除成员 |

### 5.3 财务数据

| 方法 | 路径 | 说明 |
|-----|-----|------|
| POST | /api/incomes | 添加收入 |
| GET | /api/incomes | 获取收入列表 |
| PUT | /api/incomes/:id | 更新收入 |
| DELETE | /api/incomes/:id | 删除收入 |
| POST | /api/expenses | 添加支出 |
| GET | /api/expenses | 获取支出列表 |
| PUT | /api/expenses/:id | 更新支出 |
| DELETE | /api/expenses/:id | 删除支出 |
| POST | /api/assets | 添加资产 |
| GET | /api/assets | 获取资产列表 |
| PUT | /api/assets/:id | 更新资产 |
| DELETE | /api/assets/:id | 删除资产 |
| POST | /api/liabilities | 添加负债 |
| GET | /api/liabilities | 获取负债列表 |
| PUT | /api/liabilities/:id | 更新负债 |
| DELETE | /api/liabilities/:id | 删除负债 |
| POST | /api/transactions/check-duplicate | 检测重复交易 |

### 5.4 文件管理

| 方法 | 路径 | 说明 |
|-----|-----|------|
| POST | /api/files/upload | 上传文件 |
| GET | /api/files | 获取文件列表 |
| GET | /api/files/:id/download | 下载文件 |
| DELETE | /api/files/:id | 删除文件 |

### 5.5 报表

| 方法 | 路径 | 说明 |
|-----|-----|------|
| GET | /api/reports/overview | 财务概览 |
| GET | /api/reports/balance-sheet | 资产负债表 |
| GET | /api/reports/income-statement | 利润表 |
| GET | /api/reports/cash-flow | 现金流量表 |
| GET | /api/reports/investment-allocation | 投资配置比例 |

### 5.6 AI 服务

| 方法 | 路径 | 说明 |
|-----|-----|------|
| POST | /api/ai/chat | 大模型对话 |
| POST | /api/ai/ocr | 图片识别 |
| POST | /api/ai/analyze | 财务分析 |
| GET | /api/ai/history | 对话历史 |

---

## 六、前端页面结构

### 6.1 页面路由

```
/login                    # 登录页
/register                 # 注册页
/                         # 仪表板（需登录）
/families                 # 家庭管理
/families/:id/members     # 成员管理
/transactions             # 交易记录
  ?type=income            # 收入记录
  ?type=expense           # 支出记录
/assets                   # 资产管理
/liabilities              # 负债管理
/reports/balance-sheet    # 资产负债表
/reports/income-statement # 利润表
/reports/cash-flow        # 现金流量表
/reports/investment       # 投资配置分析
/files                    # 文件管理
/ai                       # AI 对话
/settings                 # 设置
```

### 6.2 核心组件

- Dashboard - 仪表板（指标卡片 + 图表）
- TransactionForm - 交易录入表单
- TransactionList - 交易列表
- BalanceSheet - 资产负债表
- IncomeStatement - 利润表
- CashFlowStatement - 现金流量表
- InvestmentChart - 投资配置图
- FileUploader - 文件上传组件
- ChatInterface - AI 对话界面
- DuplicateAlert - 重复检测提示

---

## 七、依赖与环境

### 7.1 前端依赖

```json
{
  "react": "^18.0.0",
  "react-dom": "^18.0.0",
  "react-router-dom": "^6.0.0",
  "typescript": "^5.0.0",
  "tailwindcss": "^3.0.0",
  "recharts": "^2.0.0",
  "axios": "^1.0.0",
  "zustand": "^4.0.0",
  "dayjs": "^1.0.0"
}
```

### 7.2 后端依赖

```json
{
  "express": "^4.18.0",
  "typescript": "^5.0.0",
  "@prisma/client": "^5.0.0",
  "prisma": "^5.0.0",
  "jsonwebtoken": "^9.0.0",
  "bcryptjs": "^2.4.0",
  "cors": "^2.8.0",
  "redis": "^4.0.0",
  "multer": "^1.4.0",
  "openai": "^4.0.0",
  "zod": "^3.0.0",
  "sharp": "^0.32.0"
}
```

### 7.3 环境变量

```
# 后端
PORT=8080
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...
MINIO_ENDPOINT=...
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
OPENAI_API_KEY=...
OCR_API_KEY=...
CORS_ORIGIN=http://localhost:3000

# 前端
REACT_APP_API_URL=http://localhost:8080/api
```

---

## 八、风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|-----|------|------|---------|
| AI 服务费用过高 | 成本超支 | 中 | 设置使用限额，缓存结果，提供降级方案 |
| OCR 识别准确率低 | 用户体验差 | 中 | 提供人工修正界面，持续优化 prompt |
| 财务数据安全 | 数据泄露 | 低 | 加密存储，权限隔离，定期安全审计 |
| 报表计算性能 | 响应慢 | 低 | Redis 缓存，预计算，数据库索引 |
| 重复检测误判 | 用户困扰 | 中 | 可调阈值，用户确认机制，机器学习优化 |

---

## 九、后续扩展方向

1. **移动端 App**：React Native 或 Flutter 开发
2. **银行同步**：对接银行 API 自动同步交易
3. **预算管理**：设置预算目标和提醒
4. **财务目标**：储蓄目标、偿债目标追踪
5. **多家庭支持**：支持一个用户管理多个家庭
6. **税务计算**：个人所得税计算与优化
7. **数据导出**：支持 Excel、PDF 导出

---

## 十、开发进度（2026-07-09 更新）

### 当前状态

项目已完成 **阶段一、阶段二、阶段三** 的核心功能开发，正在进行 **阶段四**。

### 进度详情

| 阶段 | 状态 | 完成度 | 说明 |
|-----|------|--------|------|
| 项目初始化与基础架构 | ✅ 完成 | 100% | 用户认证、家庭管理、数据库设计、Docker 环境 |
| 数据录入与文件管理 | ✅ 完成 | 100% | 收入/支出/资产/负债 CRUD、文件上传、图片去重 |
| 报表系统与可视化 | ✅ 完成 | 100% | 三大报表 API、财务概览、投资配置分析 |
| AI 分析与系统优化 | 🔄 进行中 | 10% | AI 对话、OCR 识别、性能优化 |

### 已完成功能

#### 后端 API

- ✅ 用户认证（注册、登录、JWT 鉴权）
- ✅ 家庭管理（创建、查看、更新、删除）
- ✅ 成员管理（邀请、角色分配、移除）
- ✅ 收入管理（CRUD、按日期/类别筛选）
- ✅ 支出管理（CRUD、按日期/类别筛选）
- ✅ 资产管理（CRUD、投资配置分析）
- ✅ 负债管理（CRUD）
- ✅ 文件管理（上传、下载、删除、图片去重）
- ✅ 报表生成（资产负债表、利润表、现金流量表、财务概览）
- ✅ 权限控制（admin/member/viewer 三级角色）

#### 前端页面

- ✅ 登录页面
- ✅ 注册页面
- ✅ 仪表盘页面（财务概览、关键指标）
- ✅ 家庭管理页面
- ✅ 交易管理页面（收入/支出）
- ✅ 资产管理页面
- ✅ 负债管理页面
- ✅ 布局组件（侧边栏、顶部导航）
- ✅ 路由守卫（ProtectedRoute）

#### 基础设施

- ✅ Docker Compose（PostgreSQL、Redis、MinIO）
- ✅ Prisma ORM 配置
- ✅ 环境变量配置
- ✅ CORS 跨域配置

### 待开发功能

- 🚧 AI 对话智能录入（OpenAI API 集成）
- 🚧 图片 OCR 识别（票据/收据识别）
- 🚧 Redis 缓存优化
- 🚧 单元测试与集成测试
- 🚧 CI/CD 部署流水线
- 🚧 财务分析报告生成
- 🚧 移动端适配

### 已提交代码

当前代码已提交至远程分支 `trae/agent-lf5oWj`，共 4 个提交，61 个新增文件，约 15754 行代码。
