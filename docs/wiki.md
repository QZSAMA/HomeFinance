# HomeFinance 项目 Wiki

## 目录

1. [项目概述](#项目概述)
2. [系统架构](#系统架构)
3. [数据库设计](#数据库设计)
4. [API 接口文档](#api-接口文档)
5. [部署指南](#部署指南)
6. [开发环境](#开发环境)
7. [故障排查](#故障排查)

---

## 项目概述

HomeFinance 是一个家庭财务公司化管理系统，将企业三大财务报表（资产负债表、利润表、现金流量表）概念应用到家庭财务管理中。

### 核心价值

- **专业财务视角**：用企业级财务报表思维管理家庭财务
- **智能协作**：支持多成员协作，角色权限控制
- **数据安全**：密码加密存储，数据隔离访问

### 技术栈

| 层级 | 技术 | 版本 |
|-----|------|------|
| 前端 | React | 19.x |
| 前端 | TypeScript | 6.x |
| 前端 | Tailwind CSS | 3.x |
| 前端 | Vite | 8.x |
| 后端 | Node.js | 20.x |
| 后端 | Express | 4.x |
| 后端 | Prisma | 5.x |
| 数据库 | PostgreSQL | 16.x |
| 缓存 | Redis | 7.x |
| 文件存储 | MinIO | latest |

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层 (Web)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │  报表展示  │ │  数据录入  │ │  文件管理  │ │  用户管理        ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│
└──────────────────────┬──────────────────────────────────────┘
                       │ RESTful API (CORS)
┌──────────────────────▼──────────────────────────────────────┐
│                        后端层                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│
│  │  用户认证  │ │  报表引擎  │ │  文件服务  │ │  权限管理        ││
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
│   ├── Layout.tsx       # 布局组件
│   ├── FamilySelector.tsx # 家庭选择器
│   └── ProtectedRoute.tsx # 路由守卫
├── pages/               # 页面组件
│   ├── DashboardPage.tsx
│   ├── FamiliesPage.tsx
│   ├── TransactionsPage.tsx
│   ├── AssetsPage.tsx
│   ├── LiabilitiesPage.tsx
│   ├── BalanceSheetPage.tsx      # 资产负债表
│   ├── IncomeStatementPage.tsx   # 利润表
│   ├── CashFlowPage.tsx          # 现金流量表
│   └── InvestmentPage.tsx        # 投资配置
├── services/            # API 服务层
│   ├── api.ts           # Axios 配置
│   ├── authService.ts   # 认证服务
│   ├── familyService.ts # 家庭服务
│   ├── financeService.ts # 财务数据服务
│   └── reportService.ts # 报表服务
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
├── routes/              # REST API 路由
│   ├── auth.ts          # 认证路由
│   ├── families.ts      # 家庭管理路由
│   ├── incomes.ts       # 收入路由
│   ├── expenses.ts      # 支出路由
│   ├── assets.ts        # 资产路由
│   ├── liabilities.ts   # 负债路由
│   ├── reports.ts       # 报表路由
│   └── files.ts         # 文件路由
├── middleware/          # 中间件
│   └── auth.ts          # JWT 认证中间件
├── config/              # 配置文件
│   └── minio.ts         # MinIO 配置
├── utils/               # 工具函数
│   ├── decimal.ts       # Decimal 转换
│   └── phash.ts         # 图片哈希
└── app.ts               # Express 应用入口
```

---

## 数据库设计

### 实体关系图

```
users ───< family_members >─── families
users ───> incomes, expenses, files
families ───> incomes, expenses, assets, liabilities, files
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
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

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
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

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
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

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
| description | String (可选) | 描述 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

---

## API 接口文档

### 认证接口

#### POST /api/auth/register

注册新用户

请求体：
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "张三"
}
```

响应：
```json
{
  "user": {
    "id": "xxx",
    "email": "user@example.com",
    "name": "张三",
    "createdAt": "2026-07-09T00:00:00Z"
  },
  "token": "jwt-token"
}
```

#### POST /api/auth/login

用户登录

请求体：
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

响应：
```json
{
  "user": {
    "id": "xxx",
    "email": "user@example.com",
    "name": "张三"
  },
  "token": "jwt-token"
}
```

#### GET /api/auth/me

获取当前用户信息

请求头：`Authorization: Bearer <token>`

响应：
```json
{
  "id": "xxx",
  "email": "user@example.com",
  "name": "张三",
  "createdAt": "2026-07-09T00:00:00Z"
}
```

### 家庭管理接口

#### POST /api/families

创建家庭

请求头：`Authorization: Bearer <token>`

请求体：
```json
{
  "name": "我的家庭",
  "description": "三口之家"
}
```

响应：
```json
{
  "id": "xxx",
  "name": "我的家庭",
  "description": "三口之家",
  "members": [...]
}
```

#### GET /api/families

获取用户所属家庭列表

请求头：`Authorization: Bearer <token>`

响应：
```json
[
  {
    "id": "xxx",
    "name": "我的家庭",
    "members": [...]
  }
]
```

#### POST /api/families/:id/invite

邀请成员加入家庭

请求头：`Authorization: Bearer <token>`

请求体：
```json
{
  "email": "member@example.com",
  "role": "member"
}
```

### 财务数据接口

#### POST /api/families/:familyId/incomes

添加收入

请求头：`Authorization: Bearer <token>`

请求体：
```json
{
  "category": "工资",
  "amount": 10000,
  "description": "月薪",
  "source": "公司",
  "date": "2026-07-01"
}
```

#### GET /api/families/:familyId/incomes

获取收入列表

请求头：`Authorization: Bearer <token>`

查询参数：
- `startDate`: 开始日期
- `endDate`: 结束日期
- `category`: 类别筛选

#### POST /api/families/:familyId/expenses

添加支出

请求头：`Authorization: Bearer <token>`

请求体：
```json
{
  "category": "餐饮",
  "amount": 350,
  "description": "超市购物",
  "paymentMethod": "微信支付",
  "date": "2026-07-09"
}
```

### 报表接口

#### GET /api/families/:familyId/reports/balance-sheet

获取资产负债表

请求头：`Authorization: Bearer <token>`

响应：
```json
{
  "totalAssets": 500000,
  "totalLiabilities": 200000,
  "netWorth": 300000,
  "assets": { "STOCK": 100000, "CASH": 50000 },
  "liabilities": { "LOAN": 200000 },
  "assetList": [...],
  "liabilityList": [...]
}
```

#### GET /api/families/:familyId/reports/income-statement

获取利润表

请求头：`Authorization: Bearer <token>`

查询参数：
- `startDate`: 开始日期
- `endDate`: 结束日期

响应：
```json
{
  "totalIncome": 15000,
  "totalExpense": 8000,
  "netIncome": 7000,
  "incomeByCategory": { "工资": 10000 },
  "expenseByCategory": { "餐饮": 2000 },
  "incomes": [...],
  "expenses": [...]
}
```

#### GET /api/families/:familyId/reports/cash-flow

获取现金流量表

请求头：`Authorization: Bearer <token>`

查询参数：
- `startDate`: 开始日期
- `endDate`: 结束日期

响应：
```json
{
  "operating": { "income": 10000, "expense": 5000, "net": 5000 },
  "investing": { "income": 5000, "expense": 3000, "net": 2000 },
  "financing": { "income": 0, "expense": 0, "net": 0 },
  "other": { "income": 0, "expense": 0 },
  "netCashFlow": 7000
}
```

#### GET /api/families/:familyId/reports/summary

获取财务概览

请求头：`Authorization: Bearer <token>`

响应：
```json
{
  "balanceSheet": { "totalAssets": 500000, "totalLiabilities": 200000, "netWorth": 300000 },
  "incomeStatement": { "thisMonthIncome": 10000, "thisMonthExpense": 8000, "incomeChange": 10.5, "expenseChange": -5.2 },
  "investmentAllocation": [{ "category": "STOCK", "value": 100000, "percentage": 20 }],
  "recentTransactions": { "incomes": [...], "expenses": [...] }
}
```

### 财务数据更新接口

#### PUT /api/families/:familyId/incomes/:id

更新收入记录

请求头：`Authorization: Bearer <token>`

请求体：
```json
{
  "category": "工资",
  "amount": 12000,
  "description": "调整后月薪",
  "source": "公司",
  "date": "2026-07-01"
}
```

#### DELETE /api/families/:familyId/incomes/:id

删除收入记录

请求头：`Authorization: Bearer <token>`

#### PUT /api/families/:familyId/expenses/:id

更新支出记录

请求头：`Authorization: Bearer <token>`

请求体：
```json
{
  "category": "餐饮",
  "amount": 400,
  "description": "超市购物",
  "paymentMethod": "微信支付",
  "date": "2026-07-09"
}
```

#### DELETE /api/families/:familyId/expenses/:id

删除支出记录

请求头：`Authorization: Bearer <token>`

#### PUT /api/families/:familyId/assets/:id

更新资产记录

请求头：`Authorization: Bearer <token>`

请求体：
```json
{
  "name": "现金",
  "type": "CASH",
  "value": 15000,
  "currency": "CNY"
}
```

#### DELETE /api/families/:familyId/assets/:id

删除资产记录

请求头：`Authorization: Bearer <token>`

#### PUT /api/families/:familyId/liabilities/:id

更新负债记录

请求头：`Authorization: Bearer <token>`

请求体：
```json
{
  "name": "房贷",
  "type": "MORTGAGE",
  "amount": 180000,
  "currency": "CNY"
}
```

#### DELETE /api/families/:familyId/liabilities/:id

删除负债记录

请求头：`Authorization: Bearer <token>`

---

## 部署指南

### 环境变量配置

后端 `.env` 文件：

```env
PORT=8080
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/family_finance"
REDIS_URL="redis://localhost:6379"
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=7d
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=family-finance
MINIO_USE_SSL=false
CORS_ORIGIN=http://localhost:5173
```

前端 `.env` 文件：

```env
VITE_API_URL=http://localhost:8080/api
```

### Docker 部署

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重启服务
docker-compose restart
```

### 数据库迁移

```bash
cd backend

# 生成迁移
npx prisma migrate dev --name init

# 部署迁移到生产环境
npx prisma migrate deploy

# 生成 Prisma 客户端
npx prisma generate
```

---

## 开发环境

### 启动步骤

```bash
# 1. 启动 Docker 服务
docker-compose up -d

# 2. 安装后端依赖
cd backend
npm install

# 3. 配置环境变量
cp .env.example .env

# 4. Prisma 生成和迁移
npx prisma generate
npx prisma migrate dev

# 5. 启动后端
npm run dev

# 6. 安装前端依赖（另一个终端）
cd ../frontend
npm install

# 7. 启动前端
npm run dev
```

### 访问地址

| 服务 | 地址 |
|-----|------|
| 前端 | http://localhost:5173 |
| 后端 API | http://localhost:8080 |
| MinIO 控制台 | http://localhost:9001 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

### 常用命令

```bash
# 后端
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npx prisma studio    # 打开 Prisma Studio

# 前端
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npm run lint         # 代码检查
```

---

## 故障排查

### 数据库连接失败

**问题**：后端无法连接到 PostgreSQL

**解决方案**：
1. 检查 Docker 容器是否运行：`docker-compose ps`
2. 检查数据库配置：确认 `.env` 文件中的 `DATABASE_URL`
3. 等待数据库初始化完成：使用 `docker-compose logs postgres` 查看状态

### JWT 认证失败

**问题**：请求返回 401 未授权

**解决方案**：
1. 检查请求头是否包含 `Authorization: Bearer <token>`
2. 确认 `JWT_SECRET` 环境变量正确配置
3. 检查 token 是否过期

### 文件上传失败

**问题**：文件上传返回错误

**解决方案**：
1. 检查 MinIO 服务是否运行：`docker-compose ps`
2. 检查 MinIO 控制台：http://localhost:9001
3. 确认 `.env` 中的 MinIO 配置正确
4. 检查文件大小是否超过 10MB 限制

### CORS 错误

**问题**：前端请求被 CORS 阻止

**解决方案**：
1. 检查后端 `.env` 中的 `CORS_ORIGIN` 配置
2. 确认前端请求地址与配置匹配
3. 开发环境使用 `http://localhost:5173`

### Prisma 迁移失败

**问题**：`prisma migrate dev` 失败

**解决方案**：
1. 删除 `prisma/migrations` 目录和数据库
2. 重新创建数据库：`docker-compose down -v && docker-compose up -d`
3. 重新运行迁移：`npx prisma migrate dev --name init`