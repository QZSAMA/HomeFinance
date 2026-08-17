import { test, expect } from '@playwright/test';

// 前置条件：
// 1. 启动依赖服务: docker-compose up -d postgres redis minio
// 2. 启动后端: cd backend && npm run dev
// 3. 启动前端: cd frontend && npm run dev
// 4. 运行测试: npm run test:e2e
//
// 认证流程 E2E 测试：覆盖注册 -> 登录 -> 创建家庭 -> 记账 -> 查看报表 的完整业务路径。
// 必须同时启动前后端及依赖服务。若后端不可用则整个文件跳过，避免 CI 失败。

/**
 * 后端健康检查端点：backend/src/routes/health.ts 暴露在 /api/health，
 * 全部依赖（postgres/redis/minio）正常时返回 200，否则 503。
 */
const BACKEND_HEALTH_URL = 'http://localhost:8080/api/health';
const FRONTEND_URL = 'http://localhost:5173';

/**
 * 探测前后端服务是否就绪。任一不可用则跳过整个测试文件。
 */
async function skipIfServicesDown() {
  let frontendOk = false;
  let backendOk = false;

  try {
    const res = await fetch(FRONTEND_URL, { method: 'GET' });
    frontendOk = res.ok;
  } catch {
    frontendOk = false;
  }

  try {
    const res = await fetch(BACKEND_HEALTH_URL, { method: 'GET' });
    // 200 = 全部依赖 up；503 = 部分依赖 down，但仍可访问后端
    // 此处要求 200，确保数据库可用（注册/创建家庭需要写库）
    backendOk = res.ok;
  } catch {
    backendOk = false;
  }

  if (!frontendOk || !backendOk) {
    test.skip(
      true,
      `服务不可用（frontend=${frontendOk}, backend=${backendOk}），跳过认证流程 E2E 测试`,
    );
  }
}

// 后端密码策略（backend/src/utils/passwordPolicy.ts）：
// - 至少 8 位
// - 必须包含字母和数字
const TEST_PASSWORD = 'Test1234';

// 使用时间戳生成唯一邮箱，避免重复注册冲突
function uniqueEmail(): string {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1000);
  return `e2e_${ts}_${rand}@test.local`;
}

test.describe('认证流程 E2E 测试', () => {
  test.beforeAll(async () => {
    await skipIfServicesDown();
  });

  test('完整业务流程：注册 -> 登录 -> 创建家庭 -> 记收入 -> 记支出 -> 报表', async ({ page }) => {
    const email = uniqueEmail();
    const name = `E2E用户${Date.now() % 100000}`;

    // ===== 1. 注册新用户 =====
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: '创建你的账号' })).toBeVisible();

    await page.locator('#name').fill(name);
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '注册' }).click();

    // 注册成功后，useAuthStore 会写入 token，ProtectedRoute 放行到根路径
    // 等待跳转离开 /register（到达受保护的 / 或 /login 失败页）
    await page.waitForURL((url) => !url.pathname.includes('/register'), { timeout: 15000 });

    // 注册后应当进入受保护页面（Layout 中的退出按钮可见作为登录态证据）
    await expect(page.getByRole('button', { name: '退出' })).toBeVisible({ timeout: 15000 });

    // ===== 2. 登录态已建立，验证 token 持久化 =====
    // 退出后重新登录，验证账号可登录
    await page.getByRole('button', { name: '退出' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.locator('#email').fill(email);
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByRole('button', { name: '退出' })).toBeVisible({ timeout: 15000 });

    // ===== 3. 创建家庭 =====
    await page.goto('/families');
    await expect(page.getByRole('heading', { name: '家庭管理' })).toBeVisible();

    // 新注册用户没有任何家庭，点击"创建第一个家庭"或"+ 创建家庭"按钮
    await page.getByRole('button', { name: /创建(第一个)?家庭/ }).first().click();

    const familyName = `E2E家庭${Date.now() % 100000}`;
    // 创建家庭弹窗中的输入框（FamiliesPage 中无 id，通过 placeholder 定位）
    await page.getByPlaceholder('例如：我们的小家').fill(familyName);
    await page.getByPlaceholder('简单描述一下这个家庭').fill('E2E 自动化测试创建的家庭');
    await page.getByRole('button', { name: '创建', exact: true }).click();

    // 创建成功后卡片应出现在列表中
    await expect(page.getByRole('heading', { name: familyName })).toBeVisible({ timeout: 10000 });

    // ===== 4. 记一笔收入 =====
    await page.goto('/transactions');
    await expect(page.getByRole('heading', { name: '交易记录' })).toBeVisible();

    // 等待 FamilySelector 加载完成（页面不再显示"加载中..."）
    await expect(page.getByText('加载中...')).toHaveCount(0, { timeout: 10000 });

    // 默认在"收入"tab。点击"+ 新增记录"
    await page.getByRole('button', { name: '+ 新增记录' }).click();

    // 弹窗中的表单字段（TransactionsPage 中无 id，通过 label 和 placeholder 定位）
    await page.getByPlaceholder('请输入金额').fill('8888.88');
    await page.getByLabel('类别').selectOption('工资');
    await page.getByLabel('日期').fill(new Date().toISOString().split('T')[0]);
    await page.getByPlaceholder('收入来源（可选）').fill('E2E 测试工资');
    await page.getByPlaceholder('描述信息（可选，失焦自动推荐类别）').fill('E2E 月度工资');
    await page.getByRole('button', { name: '确认' }).click();

    // 收入记录应出现在表格中
    await expect(page.getByText('8,888.88')).toBeVisible({ timeout: 10000 });

    // ===== 5. 记一笔支出 =====
    // 切换到"支出"tab
    await page.getByRole('button', { name: '支出' }).click();
    await page.getByRole('button', { name: '+ 新增记录' }).click();

    await page.getByPlaceholder('请输入金额').fill('66.66');
    await page.getByLabel('类别').selectOption('餐饮');
    await page.getByLabel('日期').fill(new Date().toISOString().split('T')[0]);
    await page.getByPlaceholder('支付方式（可选）').fill('微信');
    await page.getByPlaceholder('描述信息（可选，失焦自动推荐类别）').fill('E2E 午餐');
    await page.getByRole('button', { name: '确认' }).click();

    // 支出记录应出现在表格中
    await expect(page.getByText('66.66')).toBeVisible({ timeout: 10000 });

    // ===== 6. 查看报表页 =====
    await page.goto('/reports');
    // ReportsPage 顶部应有相关内容渲染（至少 URL 命中 /reports，且页面未跳回 login）
    await expect(page).toHaveURL(/\/reports/);
    // 等待报表数据加载完成（recharts 渲染需要时间）
    await expect(page.getByText('加载中...')).toHaveCount(0, { timeout: 15000 });
  });
});
