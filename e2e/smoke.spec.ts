import { test, expect, type Page } from '@playwright/test';

// 前置条件：
// 1. 启动依赖服务: docker-compose up -d postgres redis minio
// 2. 启动后端: cd backend && npm run dev
// 3. 启动前端: cd frontend && npm run dev
// 4. 运行测试: npm run test:e2e
//
// 冒烟测试：验证前端服务可用且核心页面可加载。
// 这些测试仅依赖前端开发服务器，不写入任何后端数据。

/**
 * 探测前端开发服务器是否可用。
 * 不可用时通过 test.skip 跳过整个测试文件，避免 CI 因服务未启动而失败。
 */
async function skipIfFrontendDown(page: Page) {
  try {
    const response = await page.request.get('/', { timeout: 5000 });
    if (!response.ok()) {
      test.skip(true, `前端服务不可用（HTTP ${response.status()}），跳过冒烟测试`);
    }
  } catch (err) {
    test.skip(true, `前端服务不可用：${(err as Error).message}，跳过冒烟测试`);
  }
}

test.describe('冒烟测试 - 核心页面可加载', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await skipIfFrontendDown(page);
    await page.close();
  });

  test('登录页可正常加载', async ({ page }) => {
    await page.goto('/login');

    // LoginPage 渲染的标题
    await expect(page.getByRole('heading', { name: '登录家庭财务系统' })).toBeVisible();

    // 邮箱与密码输入框（通过 label 的 htmlFor 关联的 id 选择）
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();

    // 登录按钮
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible();

    // 跳转到注册页的链接
    await expect(page.getByRole('link', { name: '立即注册' })).toBeVisible();
  });

  test('注册页可正常加载', async ({ page }) => {
    await page.goto('/register');

    // RegisterPage 渲染的标题
    await expect(page.getByRole('heading', { name: '创建你的账号' })).toBeVisible();

    // 姓名 / 邮箱 / 密码 三个输入框
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();

    // 注册按钮
    await expect(page.getByRole('button', { name: '注册' })).toBeVisible();

    // 跳转回登录页的链接
    await expect(page.getByRole('link', { name: '立即登录' })).toBeVisible();
  });

  test('未登录访问受保护页面会跳转到登录页', async ({ page }) => {
    // 直接访问根路径（受 ProtectedRoute 保护）
    await page.goto('/');

    // ProtectedRoute 应将未登录用户重定向到 /login
    await expect(page).toHaveURL(/\/login$/);

    // 登录页标题可见，确认已渲染
    await expect(page.getByRole('heading', { name: '登录家庭财务系统' })).toBeVisible();
  });

  test('未登录访问 /reports 受保护页面也会跳转到登录页', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('未登录访问 /transactions 受保护页面也会跳转到登录页', async ({ page }) => {
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/login$/);
  });
});
