import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = 'E2ePassw0rd!';
const today = new Date().toISOString().slice(0, 10);

const admin = {
  email: `e2e-admin-${runId}@example.test`,
  name: `E2E 管理员 ${runId}`,
};
const viewer = {
  email: `e2e-viewer-${runId}@example.test`,
  name: `E2E 只读用户 ${runId}`,
};

async function register(page: Page, account: { email: string; name: string }) {
  await page.goto('/register');
  await page.locator('#name').fill(account.name);
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createFamily(page: Page, name: string) {
  await page.goto('/families');
  await expect(page.getByRole('heading', { name: '家庭管理' })).toBeVisible();
  await page.getByRole('button', { name: '+ 创建家庭', exact: true }).click();

  const dialog = page.locator('div.fixed.inset-0').last();
  await dialog.getByPlaceholder('例如：我们的小家').fill(name);
  await dialog.locator('form').getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog).toBeHidden();

  const familyId = await page.locator('header select').inputValue();
  expect(familyId).not.toBe('');
  return familyId;
}

async function selectFamily(page: Page, familyId: string) {
  await page.locator('header select').selectOption(familyId);
  await expect(page.locator('header select')).toHaveValue(familyId);
}

async function addTransaction(
  page: Page,
  type: 'income' | 'expense',
  amount: string,
  category: string,
  description: string,
) {
  if (type === 'expense') {
    await page.getByRole('button', { name: '支出', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '收入', exact: true }).click();
  }
  await page.getByRole('button', { name: '+ 新增记录', exact: true }).click();

  const dialog = page.locator('div.fixed.inset-0').last();
  await dialog.getByPlaceholder('请输入金额').fill(amount);
  await dialog.locator('select').selectOption({ label: category });
  await dialog.locator('input[type="date"]').fill(today);
  await dialog.getByPlaceholder('描述信息（可选，失焦自动推荐类别）').fill(description);

  const path = type === 'income' ? '/incomes' : '/expenses';
  const creation = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes(path)
  ));
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await expect((await creation).status()).toBe(201);
  await expect(page.getByText(description, { exact: true })).toBeVisible();
}

test.describe.serial('P1-G-04 critical browser journeys', () => {
  let adminContext: BrowserContext;
  let viewerContext: BrowserContext;
  let adminPage: Page;
  let viewerPage: Page;
  let familyAId: string;
  let familyBId: string;
  const familyAName = `E2E-A-${runId}`;
  const familyBName = `E2E-B-${runId}`;
  const familyAMarker = `family-a-only-${runId}`;
  const familyBMarker = `family-b-only-${runId}`;

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    viewerContext = await browser.newContext();
    adminPage = await adminContext.newPage();
    viewerPage = await viewerContext.newPage();
    await register(adminPage, admin);
    await register(viewerPage, viewer);
  });

  test.afterAll(async () => {
    await Promise.all([adminContext.close(), viewerContext.close()]);
  });

  test('admin registration, family switching, and tenant data isolation', async () => {
    familyAId = await createFamily(adminPage, familyAName);
    await adminPage.goto('/transactions');
    await addTransaction(adminPage, 'income', '101', '工资', familyAMarker);

    familyBId = await createFamily(adminPage, familyBName);
    await adminPage.goto('/transactions');
    await expect(adminPage.getByText(familyAMarker, { exact: true })).toBeHidden();
    await addTransaction(adminPage, 'income', '120', '工资', familyBMarker);

    await selectFamily(adminPage, familyAId);
    await expect(adminPage.getByText(familyAMarker, { exact: true })).toBeVisible();
    await expect(adminPage.getByText(familyBMarker, { exact: true })).toBeHidden();
  });

  test('admin CRUD reconciles in the income statement', async () => {
    await adminPage.goto('/transactions');
    await selectFamily(adminPage, familyBId);
    await expect(adminPage.getByText(familyBMarker, { exact: true })).toBeVisible();

    const row = adminPage.locator('tr', { hasText: familyBMarker });
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    const editDialog = adminPage.locator('div.fixed.inset-0').last();
    await editDialog.getByPlaceholder('请输入金额').fill('120');
    const update = adminPage.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.url().includes('/incomes/')
    ));
    await editDialog.getByRole('button', { name: '确认', exact: true }).click();
    await expect((await update).ok()).toBeTruthy();
    await expect(row).toContainText('¥120.00');

    await addTransaction(adminPage, 'expense', '20', '餐饮', `crud-expense-${runId}`);
    await adminPage.goto('/reports');
    const statement = adminPage.locator('#income-statement');
    await statement.locator('#income-start-date').fill(today);
    await statement.locator('#income-end-date').fill(today);
    await statement.getByRole('button', { name: '查询', exact: true }).click();
    await expect(statement).toContainText('¥100.00');

    await adminPage.goto('/transactions');
    await adminPage.getByRole('button', { name: '支出', exact: true }).click();
    const expenseRow = adminPage.locator('tr', { hasText: `crud-expense-${runId}` });
    adminPage.once('dialog', (dialog) => dialog.accept());
    const deletion = adminPage.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && response.url().includes('/expenses/')
    ));
    await expenseRow.getByRole('button', { name: '删除', exact: true }).click();
    await expect((await deletion).ok()).toBeTruthy();
    await expect(expenseRow).toBeHidden();
  });

  test('viewer mutation is denied and leaves the ledger unchanged', async () => {
    await adminPage.goto('/families');
    await adminPage.getByText(familyBName, { exact: true }).click();
    await adminPage.getByRole('button', { name: '+ 邀请成员', exact: true }).click();
    const inviteDialog = adminPage.locator('div.fixed.inset-0').last();
    await inviteDialog.locator('input[type="email"]').fill(viewer.email);
    await inviteDialog.locator('select').selectOption('viewer');
    await inviteDialog.getByRole('button', { name: '邀请', exact: true }).click();
    await expect(inviteDialog).toBeHidden();

    await viewerPage.goto('/transactions');
    await expect(viewerPage.locator('header select')).toHaveValue(familyBId);
    await viewerPage.getByRole('button', { name: '支出', exact: true }).click();
    await viewerPage.getByRole('button', { name: '+ 新增记录', exact: true }).click();
    const viewerDialog = viewerPage.locator('div.fixed.inset-0').last();
    await viewerDialog.getByPlaceholder('请输入金额').fill('9');
    await viewerDialog.locator('select').selectOption({ label: '餐饮' });
    await viewerDialog.locator('input[type="date"]').fill(today);
    await viewerDialog.getByPlaceholder('描述信息（可选，失焦自动推荐类别）').fill(`viewer-denied-${runId}`);
    const denied = viewerPage.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/expenses')
      && response.status() === 403
    ));
    await viewerDialog.getByRole('button', { name: '确认', exact: true }).click();
    await denied;

    await adminPage.goto('/transactions');
    await selectFamily(adminPage, familyBId);
    await expect(adminPage.getByText(`viewer-denied-${runId}`, { exact: true })).toBeHidden();
  });

  test('CSV confirmation and deterministic AI proposal require confirmation before mutation', async () => {
    await adminPage.goto('/import');
    await adminPage.locator('#import-file').setInputFiles({
      name: 'alipay-e2e.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('交易时间,收/支,金额,交易分类,商品名称\n2026-09-01 12:00:00,支出,35.00,餐饮,E2E CSV 导入\n'),
    });
    await adminPage.getByRole('button', { name: '解析预览', exact: true }).click();
    await expect(adminPage.getByText('共识别', { exact: false })).toContainText('1');
    const importConfirmation = adminPage.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/import/confirm')
    ));
    await adminPage.getByRole('button', { name: '确认导入', exact: true }).click();
    await expect((await importConfirmation).ok()).toBeTruthy();
    await expect(adminPage.getByRole('status')).toContainText('成功导入 1 条记录');

    await adminPage.goto('/ai');
    const composer = adminPage.getByPlaceholder('输入消息，如：午饭花了50块');
    await composer.fill(`E2E AI 提议 ${runId}`);
    const proposal = adminPage.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/ai/chat')
    ));
    await adminPage.getByRole('button', { name: '发送', exact: true }).click();
    await expect((await proposal).ok()).toBeTruthy();
    await expect(adminPage.getByRole('button', { name: /确认全部记账/ })).toBeVisible();

    await adminPage.goto('/transactions');
    await adminPage.getByRole('button', { name: '支出', exact: true }).click();
    await expect(adminPage.getByText('E2E mock AI proposal', { exact: true })).toBeHidden();

    await adminPage.goto('/ai');
    const confirmation = adminPage.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/ai/proposals/')
      && response.url().includes('/confirm')
    ));
    await adminPage.getByRole('button', { name: /确认全部记账/ }).click();
    await expect((await confirmation).ok()).toBeTruthy();
    await expect(adminPage.getByRole('status')).toContainText('已完成 1 笔记账');

    await adminPage.goto('/transactions');
    await adminPage.getByRole('button', { name: '支出', exact: true }).click();
    await expect(adminPage.getByText('E2E mock AI proposal', { exact: true })).toBeVisible();
  });
});
