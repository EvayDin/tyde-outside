import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
const root = process.cwd();
const require = createRequire(resolve(root, 'apps/electron/package.json'));
async function register(page: Page) {
  const phone = `139${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  await expect(page.getByRole('heading', { name: '登录 / 注册' })).toBeVisible();
  await page.getByLabel('手机号码').fill(phone);
  await page.getByRole('button', { name: '获取验证码' }).click();
  await expect(page.getByText('当前为内部试用', { exact: false })).toBeVisible();
  await page.getByPlaceholder('6 位验证码').fill('095270');
  await page.getByRole('button', { name: /^继\s*续$/ }).click();
  await expect(page.getByRole('heading', { name: '认识一下你' })).toBeVisible();
  await page.getByLabel('用户名（英文）').fill(`trial_${randomInt(1, 1_000_000_000)}`);
  await page.getByLabel('姓名', { exact: true }).fill('测试小明 Alex');
  await page.getByRole('button', { name: '完成注册' }).click();
  await expect(page.getByRole('heading', { name: '欢迎，测试小明 Alex' })).toBeVisible();
  await expect(page.getByText(`+86${phone}`, { exact: true })).toBeVisible();
}
test('Web 注册、刷新会话恢复与主动退出', async ({ page }) => {
  await page.goto('/');
  await register(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: '欢迎，测试小明 Alex' })).toBeVisible();
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/web-welcome.png' });
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录 / 注册' })).toBeVisible();
});
test('Electron 共用页面、加密保存会话、重启恢复与退出', async () => {
  await mkdir('.local/e2e', { recursive: true });
  const userData = await mkdtemp(resolve(root, '.local/e2e/profile-'));
  const options = {
    executablePath: require('electron') as string,
    args: [resolve(root, 'apps/electron/out/main/index.js')],
    env: {
      ...process.env,
      TYDE_WEB_URL: 'http://127.0.0.1:5175/',
      TYDE_API_BASE_URL: 'http://127.0.0.1:3100',
      TYDE_TEST_USER_DATA: userData,
    },
  };
  let app = await electron.launch(options);
  try {
    let page = await app.firstWindow();
    await register(page);
    await mkdir('artifacts/screenshots', { recursive: true });
    await page.screenshot({ path: 'artifacts/screenshots/electron-welcome.png' });
    const result = await page.evaluate(async () => window.tydeDesktop!.getCurrentUser());
    expect(JSON.stringify(result)).not.toContain('sessionToken');
    await app.close();
    app = await electron.launch(options);
    page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '欢迎，测试小明 Alex' })).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录 / 注册' })).toBeVisible();
  } finally {
    await app.close();
  }
});
