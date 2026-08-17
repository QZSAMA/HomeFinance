import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 配置文件 - HomeFinance E2E 测试
 *
 * 前置条件：
 * 1. 启动依赖服务: docker-compose up -d postgres redis minio
 * 2. 启动后端: cd backend && npm run dev
 * 3. 启动前端: cd frontend && npm run dev
 * 4. 运行测试: npm run test:e2e
 *
 * 说明：
 * - baseURL 指向 Vite 默认开发端口 5173
 * - 仅启用 chromium 浏览器
 * - webServer 配置已注释：默认假设用户手动启动前后端服务，
 *   如需 Playwright 自动拉起服务，请取消下方 webServer 段落注释。
 * - retries: 0 失败不重试，便于本地调试
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  timeout: 30 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15 * 1000,
    navigationTimeout: 15 * 1000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer 配置（可选）：取消注释后 Playwright 会自动启动前后端服务
  // 默认保持注释，因为用户可能手动启动服务进行调试
  // webServer: [
  //   {
  //     command: 'cd backend && npm run dev',
  //     url: 'http://localhost:8080/api/health',
  //     timeout: 60 * 1000,
  //     reuseExistingServer: true,
  //     cwd: process.cwd(),
  //   },
  //   {
  //     command: 'cd frontend && npm run dev',
  //     url: 'http://localhost:5173',
  //     timeout: 60 * 1000,
  //     reuseExistingServer: true,
  //     cwd: process.cwd(),
  //   },
  // ],
});
