# HomeFinance - 家庭财务公司化管理系统

将企业财务管理的专业方法引入家庭，通过三大财务报表（资产负债表、利润表、现金流量表）帮助家庭清晰了解财务状况，支持家庭成员协作管理。

## ✨ 核心功能

### 财务管理
- **三大财务报表**：资产负债表、利润表、现金流量表
- **收支记录管理**：收入/支出 CRUD，支持重复检测
- **资产负债管理**：资产/负债 CRUD，投资配置分析
- **预算管理**：按类别/周期设置预算，实时进度跟踪
- **定期记账**：DAILY/WEEKLY/MONTHLY/YEARLY 周期规则，到期手动触发执行
- **财务目标**：储蓄/还债/投资目标，RadialBarChart 进度可视化

### 智能功能
- **AI 智能助手**：多轮对话上下文，支持账单查询、统计、记账等自然语言操作
- **AI 智能分类**：基于历史交易描述自动推荐类别
- **AI 财务分析**：自动生成财务诊断与建议
- **数据导入**：支付宝/微信账单 CSV 解析预览，确认后批量导入
- **数据导出**：Excel 导出收支明细与资产负债表

### 协作与可视化
- **多家庭对比**：跨家庭财务指标雷达图对比
- **家庭协作管理**：多成员协作、角色权限控制（admin/member/viewer）
- **文件管理**：财务凭证上传、存储、pHash 去重
- **PWA 支持**：可安装到桌面/主屏幕，离线可用，移动端响应式

## 🛠 技术栈

| 层级 | 技术选型 |
|-----|---------|
| 前端 | React 19 + TypeScript + Tailwind CSS + Vite + Zustand + Recharts |
| 后端 | Node.js + Express + TypeScript + Zod |
| ORM | Prisma |
| 数据库 | PostgreSQL |
| 缓存 | Redis |
| 文件存储 | MinIO |
| AI | Volcano Engine Ark（兼容 OpenAI API） |
| PWA | vite-plugin-pwa |
| 测试 | Jest + ts-jest + supertest |

## 🚀 快速开始

### 一键部署（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/QZSAMA/HomeFinance.git
cd HomeFinance

# 2. 复制环境变量并修改（至少修改 JWT_SECRET）
cp .env.example .env

# 3. 一键启动所有服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f backend
```

启动后访问：
- 前端：http://localhost
- 后端 API：http://localhost:8080
- MinIO 控制台：http://localhost:9001（minioadmin/minioadmin）

数据库迁移会自动执行（`prisma migrate deploy`），无需手动操作。

### 开发模式

```bash
# 1. 启动依赖服务（PostgreSQL/Redis/MinIO）
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

### 环境要求

- Node.js >= 20.x
- Docker >= 24.x（一键部署）/ npm >= 10.x（开发模式）

## 📁 项目结构

```
HomeFinance/
├── backend/                  # 后端项目
│   ├── src/
│   │   ├── routes/           # 路由定义（含 *.test.ts）
│   │   ├── services/         # 业务服务（AI、分类、CSV 解析、周期计算）
│   │   ├── middleware/       # 鉴权、缓存、限流中间件
│   │   ├── config/           # AI / MinIO / Redis 配置
│   │   ├── tests/            # 测试工厂与 setup
│   │   ├── utils/            # 工具函数
│   │   └── app.ts            # 应用入口
│   ├── prisma/               # 数据库 schema 与 migration
│   ├── Dockerfile
│   └── package.json
├── frontend/                 # 前端项目
│   ├── src/
│   │   ├── components/       # Layout、FamilySelector、图表组件
│   │   ├── pages/            # 20 个页面组件
│   │   ├── services/         # 14 个 API 服务
│   │   ├── store/            # Zustand 状态（auth、family）
│   │   └── types/            # TypeScript 类型
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── vite.config.ts        # VitePWA 配置
│   └── package.json
├── docs/                     # 文档
│   ├── wiki.md
│   ├── development-rules.md
│   └── contributing.md
├── .github/workflows/        # CI/CD
│   ├── ci.yml                # push/PR 跑测试 + 构建
│   └── deploy.yml            # tag 触发构建 Docker 镜像
├── docker-compose.yml        # 一键部署编排
├── .env.example              # 环境变量模板
├── LICENSE
└── README.md
```

## 🔗 API 接口

### 认证
| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户 |

### 家庭管理
| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/api/families` | 创建家庭 |
| GET | `/api/families` | 家庭列表 |
| GET | `/api/families/:id` | 家庭详情 |
| POST | `/api/families/:id/invite` | 邀请成员 |

### 财务数据（均挂在 `/api/families/:familyId/` 下）
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
| AI 分类 | `/category/suggest` | 智能分类推荐 |
| CSV 导入 | `/import/csv` `/import/confirm` | 解析预览 + 确认导入 |
| Excel 导出 | `/export/incomes` `/export/expenses` `/export/balance-sheet` | Excel 导出 |

### 报表
| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/families/:id/reports/balance-sheet` | 资产负债表 |
| GET | `/api/families/:id/reports/income-statement` | 利润表 |
| GET | `/api/families/:id/reports/cash-flow` | 现金流量表 |
| GET | `/api/families/:id/reports/summary` | 财务概览 |
| GET | `/api/families/:id/reports/investment` | 投资配置分析 |

### 跨家庭
| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/compare/summary` | 多家庭对比汇总 |

## ⚙️ 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥（生产必改） | - |
| `CORS_ORIGIN` | 允许的前端来源 | `http://localhost` |
| `AI_BASE_URL` | AI 服务地址 | Volcano Ark |
| `AI_API_KEY` | AI API Key（留空禁用 AI） | - |
| `AI_MODEL` | AI 模型名 | `ark-code-latest` |
| `DATABASE_URL` | PostgreSQL 连接串 | docker-compose 内置 |
| `REDIS_URL` | Redis 连接串 | docker-compose 内置 |
| `MINIO_*` | MinIO 连接配置 | docker-compose 内置 |

详见 `.env.example`。

## 🧪 测试

```bash
cd backend && npm test
# 16 套件 / 132 测试全绿
```

测试覆盖：鉴权、家庭权限、所有资源 CRUD、AI 调用、CSV 解析、进度计算、限流、缓存。

## 📝 文档

- [贡献指南](docs/contributing.md)
- [开发规则](docs/development-rules.md)
- [项目 Wiki](docs/wiki.md)
- [项目方案设计](docs/superpowers/specs/2026-07-09-family-finance-design.md)

## 🤝 贡献

欢迎提交 PR 和 issue！请先阅读 [贡献指南](docs/contributing.md)。

## 📄 许可证

MIT License — 详见 [LICENSE](LICENSE)
