# 贡献指南

感谢您对 HomeFinance 项目的关注！本文档说明如何参与开发。

## 开发环境准备

1. Fork 仓库并克隆到本地
2. 安装 Docker 与 Node.js 20+
3. 启动依赖服务：
   ```bash
   docker-compose up -d postgres redis minio
   ```
4. 安装后端依赖并初始化数据库：
   ```bash
   cd backend
   npm install
   cp .env.example .env  # 修改配置
   npx prisma migrate dev
   npm run dev
   ```
5. 安装前端依赖并启动：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## 开发流程

1. 新建分支：`git checkout -b feature/<feature-name>` 或 `fix/<bug-name>`
2. 编写代码，遵循以下规范：
   - TypeScript 严格模式
   - 后端 API 使用 Zod 校验请求体
   - 路由模式：`/api/families/:familyId/<resource>`，使用 `Router({ mergeParams: true })`
   - 所有家庭资源接口需通过 `checkFamilyAccess` 中间件校验权限
3. 编写测试（TDD 优先）：
   - 后端：在 `backend/src/routes/<resource>.test.ts` 添加测试，使用 `jest.mock('../app')` mock Prisma
   - 确保 `cd backend && npm test` 全绿
4. 提交前自检：
   ```bash
   cd backend && npm test
   cd ../frontend && npx tsc -b && npx vite build
   ```
5. Commit 信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：
   - `feat: 新增 XXX 功能`
   - `fix: 修复 XXX 问题`
   - `chore: 工程/配置变更`
   - `docs: 文档更新`
   - `refactor: 重构`
6. Push 并发起 Pull Request，描述变更内容与测试方式

## 测试规范

- **后端**：所有新接口必须有对应的 `*.test.ts`，覆盖：
  - 成功路径（200/201）
  - 鉴权失败（401）
  - 权限不足（403）
  - 参数校验失败（400）
  - 资源不存在（404）
- **前端**：当前无自动化测试框架，请手动验证关键流程

## 代码风格

- 后端使用 `type AuthRequest = Request & { userId?: string }` 传递用户信息
- 错误响应统一格式：`res.status(code).json({ error: 'message' })`
- 前端 API 服务统一放在 `frontend/src/services/` 下，按资源分文件
- 前端页面统一放在 `frontend/src/pages/` 下，使用 `useFamilyStore` 取当前家庭

## 路由权限模型

| 角色 | 权限 |
|------|------|
| admin | 创建/编辑/删除/邀请成员 |
| member | 创建/编辑自己的记录 |
| viewer | 只读 |

## 发布流程

- 主分支合并后，由维护者打 tag `vX.Y.Z` 触发 `deploy.yml` 构建并推送 Docker 镜像
- 镜像地址：`ghcr.io/<owner>/homefinance/backend:<tag>` 与 `.../frontend:<tag>`

## 问题反馈

- Bug 请提 Issue 并附复现步骤与日志
- 功能建议请提 Issue 并描述使用场景
