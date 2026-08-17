# E2E 测试（Playwright）

本目录包含 HomeFinance 的端到端测试，基于 [Playwright](https://playwright.dev/) 实现，覆盖核心冒烟场景和完整认证/记账业务流程。

## 测试文件

| 文件 | 用途 | 前置服务 |
| --- | --- | --- |
| `smoke.spec.ts` | 冒烟测试：登录页、注册页加载，未登录访问受保护页面跳转 | 仅前端 |
| `auth-flow.spec.ts` | 完整业务流程：注册 → 登录 → 创建家庭 → 记收入 → 记支出 → 查看报表 | 前端 + 后端 + 依赖 |

> 服务不可用时，测试会自动 `test.skip`，不会导致 CI 失败。

## 前置条件

E2E 测试需要前后端及依赖服务全部运行。请按顺序启动：

```bash
# 1. 启动依赖服务（Postgres / Redis / MinIO）
docker-compose up -d postgres redis minio

# 2. 启动后端（监听 8080 端口）
cd backend
npm install        # 首次运行需要
npx prisma generate
npm run dev

# 3. 启动前端（监听 5173 端口）
cd frontend
npm install        # 首次运行需要
npm run dev

# 4. 在项目根目录运行 E2E 测试
cd ..
npm run test:e2e
```

### 服务就绪检查

- 后端健康检查：`GET http://localhost:8080/api/health`
  - 200：postgres / redis / minio 全部 up
  - 503：部分依赖 down（status=degraded）
- 前端就绪：`http://localhost:5173` 可访问

`auth-flow.spec.ts` 的 `beforeAll` 会同时探测前后端，任一不可用即跳过整个文件。`smoke.spec.ts` 仅探测前端。

## 常用命令

```bash
# 运行所有 E2E 测试（headless）
npm run test:e2e

# 以 UI 模式运行（带调试面板、watch、时间旅行）
npm run test:e2e:ui

# 仅列出测试用例（不实际运行，用于验证测试可被识别）
npm run test:e2e:list

# 运行某个具体文件
npx playwright test e2e/smoke.spec.ts

# 查看上次运行的 HTML 报告
npx playwright show-report
```

## 配置说明

配置文件位于项目根目录 `playwright.config.ts`：

- `baseURL`: `http://localhost:5173`（Vite 默认端口）
- `testDir`: `./e2e`
- 浏览器：仅 chromium
- 超时：单测 30s，断言 10s，动作/导航 15s
- 失败时截图、保留视频、首次重试时记录 trace
- `retries: 0`（失败不重试，便于本地调试）
- `webServer` 配置已注释：默认假设用户手动启动服务；如需 Playwright 自动拉起，请取消注释配置文件中的 `webServer` 段落

## 浏览器安装

首次运行前需安装浏览器二进制：

```bash
npx playwright install chromium
```

> 若因网络问题无法下载，可设置镜像：
> ```bash
> set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright
> npx playwright install chromium
> ```
> 或参考 [Playwright 官方代理文档](https://playwright.dev/docs/browsers#download-from-behind-a-proxy)。

## 测试覆盖的场景

### 冒烟测试 (`smoke.spec.ts`)

1. 登录页可正常加载（标题、邮箱/密码输入框、登录按钮、注册链接）
2. 注册页可正常加载（标题、姓名/邮箱/密码输入框、注册按钮、登录链接）
3. 未登录访问根路径 → 跳转到 `/login`
4. 未登录访问 `/reports` → 跳转到 `/login`
5. 未登录访问 `/transactions` → 跳转到 `/login`

### 认证流程测试 (`auth-flow.spec.ts`)

1. 注册新用户（时间戳生成唯一邮箱，密码 `Test1234` 满足后端策略：≥8 位且含字母+数字）
2. 验证注册后自动登录态（Layout 顶部"退出"按钮可见）
3. 退出登录后用相同账号重新登录
4. 创建家庭（唯一家庭名）
5. 记一笔收入（金额 8888.88，类别"工资"）
6. 切换到支出 tab，记一笔支出（金额 66.66，类别"餐饮"）
7. 访问报表页 `/reports`，等待数据加载完成

## 与现有测试的关系

| 测试类型 | 位置 | 命令 | 说明 |
| --- | --- | --- | --- |
| 后端单元测试 | `backend/src/**/*.test.ts` | `cd backend && npm test` | Jest，不依赖外部服务 |
| 后端集成测试 | `backend/src/tests/database.integration.test.ts` | `cd backend && npm run test:integration` | 需要真实 Postgres |
| E2E 测试 | `e2e/*.spec.ts` | `npm run test:e2e` | Playwright，需要完整环境 |

E2E 测试是项目最顶层的测试，覆盖从前端 UI 到后端 API 的完整链路。CI 中默认不会运行 E2E（依赖服务较多），开发者本地完成功能后建议手动运行一次。
