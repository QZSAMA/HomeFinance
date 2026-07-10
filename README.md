# HomeFinance - 家庭财务公司化管理系统

将企业财务管理的专业方法引入家庭，通过三大财务报表（资产负债表、利润表、现金流量表）帮助家庭清晰了解财务状况，支持家庭成员协作管理。

## ✨ 核心功能

- **三大财务报表**：资产负债表、利润表、现金流量表
- **投资配置分析**：股票、国债、黄金、现金等资产配置可视化
- **家庭协作管理**：多成员协作、角色权限控制（管理员/成员/查看者）
- **智能数据录入**：手动录入 + AI 对话 + 图片 OCR
- **文件管理**：财务凭证上传、存储、共享
- **重复检测**：基于感知哈希的图片去重、内容相似度检测

## 📊 开发进度

| 阶段 | 状态 | 说明 |
|-----|------|------|
| 项目初始化与基础架构 | ✅ 完成 | 用户认证、家庭管理、数据库设计、Docker 环境 |
| 数据录入与文件管理 | ✅ 完成 | 收入/支出/资产/负债 CRUD、文件上传、图片去重 |
| 报表系统与可视化 | ✅ 完成 | 三大报表 API、财务概览、投资配置分析 |
| AI 分析与系统优化 | 🔄 进行中 | AI 对话、OCR 识别、性能优化 |

### 已完成功能清单

- ✅ 用户注册/登录/登出（JWT 认证）
- ✅ 家庭创建与管理
- ✅ 成员邀请与角色权限管理（admin/member/viewer）
- ✅ 收入/支出记录 CRUD
- ✅ 资产/负债管理
- ✅ 文件上传与管理（MinIO）
- ✅ 图片重复检测（pHash）
- ✅ 资产负债表 API
- ✅ 利润表 API
- ✅ 现金流量表 API
- ✅ 财务概览与投资配置分析
- ✅ 前端仪表盘页面
- ✅ Docker Compose 开发环境

### 待开发功能

- 🚧 AI 对话智能录入
- 🚧 图片 OCR 识别
- 🚧 Redis 缓存优化
- 🚧 单元测试与集成测试
- 🚧 CI/CD 部署流水线

## 🛠 技术栈

| 层级 | 技术选型 |
|-----|---------|
| 前端 | React 19 + TypeScript + Tailwind CSS + Vite |
| 后端 | Node.js + Express + TypeScript |
| ORM | Prisma |
| 数据库 | PostgreSQL |
| 缓存 | Redis |
| 文件存储 | MinIO |
| 状态管理 | Zustand |
| 表单验证 | Zod |

## 🚀 快速开始

### 环境要求

- Node.js >= 20.x
- Docker >= 24.x
- npm >= 10.x

### 启动开发环境

```bash
# 1. 启动数据库和依赖服务
docker-compose up -d

# 2. 安装后端依赖
cd backend
npm install

# 3. 配置环境变量
cp .env.example .env

# 4. 生成 Prisma 客户端
npx prisma generate

# 5. 创建数据库迁移
npx prisma migrate dev

# 6. 启动后端服务（终端1）
npm run dev

# 7. 安装前端依赖（终端2）
cd ../frontend
npm install

# 8. 启动前端服务
npm run dev
```

### 访问地址

- 前端：http://localhost:5173
- 后端 API：http://localhost:8080
- MinIO 控制台：http://localhost:9001

## 📁 项目结构

```
/workspace
├── frontend/                 # 前端项目
│   ├── src/
│   │   ├── components/       # 通用组件
│   │   ├── pages/            # 页面组件
│   │   ├── services/         # API 服务
│   │   ├── store/            # 状态管理
│   │   └── types/            # TypeScript 类型定义
│   └── package.json
├── backend/                  # 后端项目
│   ├── src/
│   │   ├── routes/           # 路由定义
│   │   ├── middleware/       # 中间件
│   │   ├── config/           # 配置文件
│   │   ├── utils/            # 工具函数
│   │   └── app.ts            # 应用入口
│   ├── prisma/               # 数据库 schema
│   └── package.json
├── docker-compose.yml        # Docker 编排
└── docs/                     # 文档目录
```

## 🔗 API 接口

### 认证接口

| 方法 | 路径 | 说明 |
|-----|-----|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户 |

### 家庭管理

| 方法 | 路径 | 说明 |
|-----|-----|------|
| POST | `/api/families` | 创建家庭 |
| GET | `/api/families` | 获取家庭列表 |
| POST | `/api/families/:id/invite` | 邀请成员 |

### 财务数据

| 方法 | 路径 | 说明 |
|-----|-----|------|
| GET/POST/PUT/DELETE | `/api/families/:id/incomes` | 收入管理 |
| GET/POST/PUT/DELETE | `/api/families/:id/expenses` | 支出管理 |
| GET/POST/PUT/DELETE | `/api/families/:id/assets` | 资产管理 |
| GET/POST/PUT/DELETE | `/api/families/:id/liabilities` | 负债管理 |

### 报表接口

| 方法 | 路径 | 说明 |
|-----|-----|------|
| GET | `/api/families/:id/reports/balance-sheet` | 资产负债表 |
| GET | `/api/families/:id/reports/income-statement` | 利润表 |
| GET | `/api/families/:id/reports/cash-flow` | 现金流量表 |
| GET | `/api/families/:id/reports/summary` | 财务概览 |

## 📝 文档

- [项目方案设计](docs/superpowers/specs/2026-07-09-family-finance-design.md)
- [项目实现计划](.trae/documents/family_finance_plan.md)
- [开发规则](docs/development-rules.md)
- [项目 Wiki](docs/wiki.md)

## 🤝 贡献

欢迎提交 PR 和 issue！请参考 [开发规则](docs/development-rules.md)。

## 📄 许可证

MIT License