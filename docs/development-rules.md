# HomeFinance 开发规则

## 目录

1. [代码规范](#代码规范)
2. [Git 工作流](#git-工作流)
3. [PR 流程](#pr-流程)
4. [分支命名规范](#分支命名规范)
5. [提交信息规范](#提交信息规范)
6. [代码审查规范](#代码审查规范)
7. [环境管理](#环境管理)

---

## 代码规范

### TypeScript 规范

#### 基本规则

- 使用 `const` 代替 `let`，除非需要重新赋值
- 使用箭头函数 `=>` 代替普通函数，提高可读性
- 使用 `interface` 定义对象类型，`type` 定义联合类型或别名
- 优先使用 `interface` 扩展而非 `type` 交叉

#### 命名规则

| 类型 | 规范 | 示例 |
|-----|------|------|
| 变量 | 驼峰命名 | `userName`, `totalAmount` |
| 常量 | 全大写+下划线 | `MAX_FILE_SIZE`, `JWT_SECRET` |
| 函数 | 驼峰命名 | `getUser`, `createFamily` |
| 类 | 帕斯卡命名 | `UserService`, `AuthMiddleware` |
| 接口 | 帕斯卡命名，以 `I` 开头 | `IUser`, `IFamily` |
| 类型别名 | 帕斯卡命名 | `IncomeCategory`, `RoleType` |

#### 类型定义

```typescript
interface IUser {
  id: string;
  email: string;
  name: string;
}

type RoleType = 'admin' | 'member' | 'viewer';
```

### React 规范

#### 组件命名

- 组件文件使用帕斯卡命名：`LoginPage.tsx`, `FamilySelector.tsx`
- 组件导出使用默认导出：`export default LoginPage;`

#### Hooks 使用

- 使用 `useState` 管理组件状态
- 使用 `useEffect` 处理副作用
- 使用自定义 Hooks 复用逻辑（以 `use` 开头）

#### 状态管理

- 使用 Zustand 管理全局状态
- 状态存储放在 `frontend/src/store/` 目录

### 后端规范

#### 路由组织

- 每个资源一个路由文件
- 路由文件放在 `backend/src/routes/` 目录
- 使用 RESTful 风格：`GET /api/families`, `POST /api/families`

#### 错误处理

- 使用 `try-catch` 捕获异步错误
- 错误响应格式统一：`{ error: '错误信息' }`
- 使用 Zod 进行请求参数校验

#### 日志规范

- 使用 `console.error` 记录错误日志
- 不要在生产环境使用 `console.log`
- 错误日志应包含上下文信息

---

## Git 工作流

### 分支策略

采用 **Git Flow** 简化版：

```
main           # 主分支，稳定版本
├── develop    # 开发分支，集成功能
│   ├── feature-xxx  # 功能分支
│   └── bugfix-xxx   # 修复分支
└── hotfix-xxx       # 紧急修复分支
```

### 分支类型

| 分支类型 | 用途 | 命名示例 |
|---------|------|---------|
| `main` | 生产稳定版本 | - |
| `develop` | 开发集成分支 | - |
| `feature/xxx` | 新功能开发 | `feature/user-auth`, `feature/report-system` |
| `bugfix/xxx` | Bug 修复 | `bugfix/login-error`, `bugfix/api-response` |
| `hotfix/xxx` | 紧急修复 | `hotfix/security-vulnerability` |
| `trae/xxx` | AI 代理开发 | `trae/agent-lf5oWj` |

### 工作流程

#### 开发新功能

```bash
# 1. 从 develop 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/user-auth

# 2. 开发代码
# ...

# 3. 提交更改
git add .
git commit -m "feat: implement user authentication"

# 4. 推送分支
git push origin feature/user-auth

# 5. 创建 PR 到 develop
```

#### 修复 Bug

```bash
# 1. 从 develop 创建修复分支
git checkout develop
git pull origin develop
git checkout -b bugfix/login-error

# 2. 修复代码
# ...

# 3. 提交更改
git add .
git commit -m "fix: resolve login validation error"

# 4. 推送并创建 PR
git push origin bugfix/login-error
```

#### 紧急修复

```bash
# 1. 从 main 创建热修复分支
git checkout main
git pull origin main
git checkout -b hotfix/security-vulnerability

# 2. 修复代码
# ...

# 3. 提交并合并到 main 和 develop
git add .
git commit -m "hotfix: patch security vulnerability"
git push origin hotfix/security-vulnerability

# 4. 创建 PR 到 main 和 develop
```

---

## PR 流程

### 创建 PR

1. 在 GitHub 上从功能分支创建 PR 到 `develop`
2. 填写 PR 标题和描述
3. 关联相关的 Issue（如有）
4. 请求至少 1 位开发者审查

### PR 标题规范

```
<类型>: <简短描述>

类型：feat / fix / docs / refactor / test / chore

示例：
feat: implement user authentication
fix: resolve login validation error
docs: update API documentation
refactor: optimize report calculation
test: add unit tests for income service
chore: update dependencies
```

### PR 描述模板

```markdown
## 变更说明

简要描述本次变更的内容和目的。

## 变更内容

- [ ] 新增功能：用户注册接口
- [ ] 修复 Bug：登录页面表单校验
- [ ] 优化性能：报表查询优化

## 测试情况

- [ ] 功能测试通过
- [ ] 单元测试覆盖
- [ ] 无回归问题

## 相关 Issue

Closes #123
```

### PR 审查

1. 审查者检查代码质量和规范
2. 提出修改意见（使用 GitHub Review）
3. 开发者根据意见修改代码
4. 审查通过后合并到目标分支

### 合并规则

- PR 必须经过至少 1 位开发者审查通过
- 所有测试必须通过
- 使用 **Squash and Merge** 合并，保持提交历史清晰

---

## 分支命名规范

### 通用规则

```
<类型>/<描述>-<可选编号>
```

### 类型说明

| 类型 | 说明 | 示例 |
|-----|------|------|
| `feature` | 新功能开发 | `feature/user-auth`, `feature/report-system` |
| `bugfix` | Bug 修复 | `bugfix/login-error`, `bugfix/api-response` |
| `hotfix` | 紧急修复 | `hotfix/security-vulnerability` |
| `docs` | 文档更新 | `docs/readme-update`, `docs/api-docs` |
| `refactor` | 代码重构 | `refactor/auth-module`, `refactor/db-queries` |
| `test` | 测试代码 | `test/income-service`, `test/e2e-tests` |
| `chore` | 杂项任务 | `chore/dependencies`, `chore/docker-config` |
| `trae` | AI 代理开发 | `trae/agent-lf5oWj` |

### 命名示例

- `feature/family-management`
- `bugfix/transaction-duplicate`
- `docs/update-wiki`
- `refactor/backend-routes`

---

## 提交信息规范

### 格式

```
<类型>(<范围>): <描述>

<详细说明（可选）>

<关联 Issue（可选）>
```

### 类型说明

| 类型 | 说明 |
|-----|------|
| `feat` | 新增功能 |
| `fix` | 修复 Bug |
| `docs` | 更新文档 |
| `style` | 代码格式调整（不影响逻辑） |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `test` | 添加或修改测试 |
| `chore` | 构建或工具变更 |
| `revert` | 回滚提交 |

### 范围说明

范围用于标识变更涉及的模块：

| 范围 | 说明 |
|-----|------|
| `auth` | 用户认证 |
| `family` | 家庭管理 |
| `income` | 收入管理 |
| `expense` | 支出管理 |
| `asset` | 资产管理 |
| `liability` | 负债管理 |
| `report` | 报表系统 |
| `file` | 文件管理 |
| `api` | API 接口 |
| `frontend` | 前端页面 |
| `backend` | 后端逻辑 |
| `docker` | Docker 配置 |
| `docs` | 文档 |

### 提交示例

```
feat(auth): implement user registration

- 添加注册接口 POST /api/auth/register
- 实现密码 bcrypt 加密
- 添加输入验证

Closes #1
```

```
fix(report): resolve balance sheet calculation error

- 修复资产负债表中资产总额计算错误
- 添加单元测试覆盖

Closes #12
```

```
docs(api): update API documentation

- 添加认证接口详细说明
- 更新家庭管理接口示例
```

---

## 代码审查规范

### 审查标准

#### 代码质量

- [ ] 代码逻辑清晰，易于理解
- [ ] 没有重复代码
- [ ] 函数职责单一
- [ ] 变量命名符合规范

#### 类型安全

- [ ] TypeScript 类型定义完整
- [ ] 没有 `any` 类型滥用
- [ ] 接口定义清晰

#### 错误处理

- [ ] 异常情况有处理
- [ ] 错误信息明确
- [ ] 日志记录完善

#### 安全性

- [ ] 没有 SQL 注入风险
- [ ] 敏感数据已加密
- [ ] 权限控制正确

#### 性能

- [ ] 没有明显的性能问题
- [ ] 数据库查询有索引
- [ ] 避免不必要的计算

### 审查流程

1. 审查者阅读 PR 描述和变更内容
2. 逐文件检查代码
3. 使用 GitHub Review 工具提出意见：
   - **请求更改**：需要修改的问题
   - **建议**：非必须的改进建议
   - **称赞**：好的做法或实现
4. 开发者根据意见修改代码
5. 审查者确认修改后批准

### 审查反馈示例

**请求更改**：
```
请添加输入验证，防止空值提交。参考 auth.ts 中的 Zod schema 实现。
```

**建议**：
```
建议将这个逻辑抽取为独立函数，提高代码复用性。
```

**称赞**：
```
这个错误处理逻辑很清晰，错误信息也很明确。
```

---

## 环境管理

### 环境变量

#### 后端环境变量

| 变量名 | 说明 | 默认值 |
|-------|------|--------|
| `PORT` | 服务端口 | `8080` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | - |
| `REDIS_URL` | Redis 连接字符串 | - |
| `JWT_SECRET` | JWT 密钥 | - |
| `JWT_EXPIRES_IN` | JWT 过期时间 | `7d` |
| `MINIO_ENDPOINT` | MinIO 地址 | `localhost` |
| `MINIO_PORT` | MinIO 端口 | `9000` |
| `MINIO_ACCESS_KEY` | MinIO 访问密钥 | - |
| `MINIO_SECRET_KEY` | MinIO 秘密密钥 | - |
| `MINIO_BUCKET` | MinIO 存储桶 | `family-finance` |
| `MINIO_USE_SSL` | 是否使用 SSL | `false` |
| `CORS_ORIGIN` | CORS 允许的来源 | `http://localhost:5173` |

#### 前端环境变量

| 变量名 | 说明 | 默认值 |
|-------|------|--------|
| `VITE_API_URL` | 后端 API 地址 | `http://localhost:8080/api` |

### 环境文件管理

- `.env.example`：示例配置文件，包含所有必要的环境变量
- `.env`：本地开发配置文件，**不要提交到版本控制**
- `.env.production`：生产环境配置文件

### 配置检查

启动服务前确保：

1. `.env` 文件已正确配置
2. Docker 服务已启动
3. 数据库连接可用
4. 所有依赖已安装

---

## 总结

遵守以上规则有助于：

- 保持代码一致性和可读性
- 提高团队协作效率
- 减少 Bug 和技术债务
- 便于项目维护和迭代

如有疑问或建议，欢迎提出改进！