import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';

const require = createRequire(resolve('apps/electron/package.json'));

test('Web 登录和注册页签不请求接口，支持角色和登录方式切换', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url());
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '欢迎使用 Tyde 潮汐协作平台', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: '登录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: '注册账号', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText('验证码功能暂未开放');
  await page.getByRole('radio', { name: '策略官', exact: true }).check();
  await page.getByRole('tab', { name: '密码登录' }).click();
  await page.getByLabel(/^手机号/).fill('13812345678');
  await page.getByLabel('密码', { exact: true }).fill('Password123');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '以「策略官」身份登录', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText('登录功能暂未开放');
  await expect(page.getByRole('radio', { name: '策略官', exact: true })).toBeChecked();
  expect(requests).toEqual([]);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.reload();
  await expect(page.getByRole('tab', { name: '登录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(requests).toEqual([]);
  await page.screenshot({ path: 'artifacts/screenshots/frontend-web.png' });
});

test('注册直接显示完整个人表单，不以手机号验证作为入口条件', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url());
  });
  await page.goto('/#/register');
  await expect(page.getByRole('tab', { name: '注册账号', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel(/^登录密码/)).toBeVisible();
  await expect(page.getByLabel(/^姓名/)).toBeVisible();
  await page.getByLabel(/^手机号码/).fill('13812345678');
  await page.getByLabel(/^短信验证码/).fill('123456');
  await page.getByLabel(/^登录密码/).fill('Password123');
  await page.getByLabel(/^确认密码/).fill('Password123');
  await page.getByLabel(/^姓名/).fill('测试小明');
  await page.getByRole('button', { name: '立即注册 Tyde 个人账号 →', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText('填写的信息尚未提交');
  await expect(page).toHaveURL(/#\/register$/);
  expect(requests).toEqual([]);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.getByRole('tab', { name: '注册账号', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/screenshots/frontend-register.png', fullPage: true });
});

test('组织注册字段和角色约束在本地切换，材料选择不上传', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url());
  });
  await page.goto('/#/register');
  await page.getByRole('radio', { name: '组织', exact: true }).check();
  await expect(page.getByLabel(/^组织名称/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '领航员', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '策略官', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '执行专家', exact: true })).toBeChecked();
  await page.getByLabel(/^组织名称/).fill('潮汐测试组织');
  await page.getByLabel('选择营业执照照片', { exact: true }).setInputFiles({
    name: 'license.png',
    mimeType: 'image/png',
    buffer: Buffer.from('local-only-file'),
  });
  await expect(page.getByText('license.png', { exact: true })).toBeVisible();
  await page.getByLabel('选择组织 Logo 图片', { exact: true }).setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByRole('img', { name: '组织 Logo 预览' })).toHaveAttribute(
    'src',
    /^data:image\/png;base64,/,
  );
  await page.getByRole('radio', { name: '个人', exact: true }).check();
  await expect(page.getByLabel(/^组织名称/)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '领航员', exact: true })).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: '领航员', exact: true })).toBeChecked();
  await page.getByText('策略官', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '策略官', exact: true })).toBeChecked();
  expect(requests).toEqual([]);
});

test('前端验证、刷新、前进后退和页签切换不保留敏感输入', async ({ page }) => {
  await page.goto('/#/auth');
  await page.getByRole('button', { name: '以「领航员」身份登录', exact: true }).click();
  await expect(page.getByText('请输入手机号', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '密码登录' }).click();
  await page.getByLabel('密码', { exact: true }).fill('Sensitive123');
  await page.getByRole('tab', { name: '注册账号', exact: true }).click();
  await expect(page).toHaveURL(/#\/register$/);
  await page.getByLabel(/^登录密码/).fill('Register123');
  await page.reload();
  await expect(page.getByRole('tab', { name: '注册账号', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel(/^登录密码/)).toHaveValue('');
  await page.goBack();
  await expect(page.getByRole('tab', { name: '登录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: '密码登录' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
  await page.goForward();
  await expect(page.getByRole('tab', { name: '注册账号', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel(/^登录密码/)).toHaveValue('');
});

test('窄屏页签支持键盘切换，表单无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/missing');
  await expect(page.getByRole('tab', { name: '登录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: '登录', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '注册账号', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: '注册账号', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel(/^登录密码/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('radio', { name: '组织', exact: true }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel(/^邮箱/).scrollIntoViewIfNeeded();
  const emailBox = await page.getByLabel(/^邮箱/).boundingBox();
  const submitBox = await page
    .getByRole('button', { name: '立即注册 Tyde 组织账号 →', exact: true })
    .boundingBox();
  if (!emailBox || !submitBox) throw new Error('窄屏注册字段与提交按钮必须可见');
  expect(submitBox.y).toBeGreaterThanOrEqual(emailBox.y + emailBox.height);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({
    path: 'artifacts/screenshots/frontend-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('Electron 无后端也可切换完整表单，保留安全隔离且不发 API 请求', async () => {
  let requests = 0;
  const unavailableBackend = createServer((_request, response) => {
    requests++;
    response.writeHead(503).end();
  });
  await new Promise<void>((resolve) => unavailableBackend.listen(0, '127.0.0.1', resolve));
  const address = unavailableBackend.address();
  if (!address || typeof address === 'string') throw new Error('未能分配隔离测试端口');
  await mkdir('.local/frontend', { recursive: true });
  const profile = await mkdtemp(resolve('.local/frontend/ui-'));
  try {
    const app = await electron.launch({
      executablePath: require('electron') as string,
      args: [resolve('apps/electron/out/main/index.js')],
      env: {
        ...process.env,
        TYDE_WEB_URL: 'http://127.0.0.1:5176/',
        TYDE_API_BASE_URL: `http://127.0.0.1:${address.port}`,
        TYDE_TEST_USER_DATA: profile,
      },
    });
    try {
      const page = await app.firstWindow();
      await expect(
        page.getByRole('heading', { name: '欢迎使用 Tyde 潮汐协作平台', level: 1 }),
      ).toBeVisible();
      await expect(page.getByRole('tab', { name: '登录', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.getByRole('tab', { name: '注册账号', exact: true }).click();
      await expect(page.getByLabel(/^姓名/)).toBeVisible();
      await page.reload();
      await expect(page.getByRole('tab', { name: '注册账号', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.getByRole('button', { name: '获取', exact: true }).click();
      await expect(page.getByRole('status', { name: '操作提示' })).toContainText(
        '验证码功能暂未开放',
      );
      const preferences = await app.evaluate(({ BrowserWindow }) => {
        const options = BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences();
        return {
          sandbox: options.sandbox,
          contextIsolation: options.contextIsolation,
          nodeIntegration: options.nodeIntegration,
        };
      });
      expect(preferences).toEqual({
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      });
      expect(requests).toBe(0);
      await mkdir('artifacts/screenshots', { recursive: true });
      await page.getByRole('tab', { name: '注册账号', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'artifacts/screenshots/frontend-electron.png' });
    } finally {
      await app.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      unavailableBackend.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
