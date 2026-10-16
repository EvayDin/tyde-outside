import { test, expect, _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { CodeResult } from '../../packages/shared/src/index';

const require = createRequire(resolve('apps/electron/package.json'));

function codeResult(mode: CodeResult['mode'] = 'mock'): CodeResult {
  return {
    challengeId: 'b8e0a281-3dc9-4ad1-b470-1f6edbeddf63',
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    resendAfterSeconds: 60,
    mode,
  };
}

test('Web 仅为合法手机号发送验证码，发送与倒计时防重复且不自动登录', async ({ page }) => {
  const requests: string[] = [];
  const sent: { method: string; body: unknown }[] = [];
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname);
  });
  await page.route('**/api/v1/auth/code', async (route) => {
    sent.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await responseGate;
    await route.fulfill({ json: codeResult() });
  });
  await page.clock.install();
  await page.goto('/');
  await expect(page).toHaveURL(/#\/auth$/);
  await expect(
    page.getByRole('heading', { name: '欢迎使用 Tyde 潮汐协作平台', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab', { name: '验证码登录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByLabel(/^密码\s*\*?\s*$/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: '注册账号', exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
  const sendButton = page.getByRole('button', { name: /获取验证码|发送中|\d+s 后重发/ });
  await sendButton.click();
  await expect(page.getByText('请输入手机号', { exact: true })).toBeVisible();
  await page.getByLabel(/^手机号/).fill('123');
  await sendButton.click();
  await expect(page.getByText('请输入 11 位大陆手机号码', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByLabel(/^手机号/).fill('13812345678');
  await sendButton.click();
  await expect(sendButton).toHaveText('发送中');
  await expect(sendButton).toBeDisabled();
  await expect(page.getByLabel(/^手机号/)).toBeDisabled();
  await expect(page.getByRole('tab', { name: '验证码登录', exact: true })).toBeDisabled();
  await expect(page.getByRole('tab', { name: '密码登录', exact: true })).toBeDisabled();
  await expect
    .poll(() => sent)
    .toEqual([{ method: 'POST', body: { region: 'CN', phone: '13812345678' } }]);
  releaseResponse();
  await expect(page.getByText(/095270/)).toBeVisible();
  await expect(sendButton).toHaveText(/^(60|59)s 后重发$/);
  await expect(sendButton).toBeDisabled();
  await expect(page.getByLabel(/^手机号/)).toBeEnabled();
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText(
    '登录 / 注册功能暂未开放，尚未验证手机号或创建账号',
  );
  await expect(page).toHaveURL(/#\/auth$/);
  await expect(page.getByRole('heading', { name: '完善个人资料', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
  await page.getByLabel(/^手机号/).fill('13912345678');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
  await expect(page.getByText(/095270/)).toHaveCount(0);
  await expect(page.getByRole('status', { name: '操作提示' })).toHaveCount(0);
  await expect(sendButton).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(sendButton).toHaveText('获取验证码');
  await expect(sendButton).toBeEnabled();
  expect(requests).toEqual(['/api/v1/auth/code']);
  expect(sent).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^手机号/)).toHaveValue('');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
  await expect(page.getByRole('status', { name: '操作提示' })).toHaveCount(0);
  expect(requests).toEqual(['/api/v1/auth/code']);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/frontend-web.png' });
});

test('发送验证码遇到 429 显示错误并遵守 Retry-After，换号不能绕过倒计时', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname);
  });
  await page.route('**/api/v1/auth/code', (route) =>
    route.fulfill({
      status: 429,
      headers: { 'Retry-After': '60' },
      json: { code: 'RATE_LIMITED', message: '发送频繁，请稍后重试' },
    }),
  );
  await page.clock.install();
  await page.goto('/#/auth');
  await page.getByLabel(/^手机号/).fill('13812345678');
  const sendButton = page.getByRole('button', { name: /获取验证码|\d+s 后重发/ });
  await sendButton.click();
  await expect(page.getByText('发送频繁，请稍后重试', { exact: true })).toBeVisible();
  await expect(sendButton).toHaveText(/^(60|59)s 后重发$/);
  await expect(sendButton).toBeDisabled();
  await page.getByLabel(/^手机号/).fill('13912345678');
  await expect(page.getByText('发送频繁，请稍后重试', { exact: true })).toHaveCount(0);
  await expect(sendButton).toBeDisabled();
  await page.clock.fastForward(30_000);
  await expect(sendButton).toBeDisabled();
  await page.clock.fastForward(31_000);
  await expect(sendButton).toHaveText('获取验证码');
  await expect(sendButton).toBeEnabled();
  expect(requests).toEqual(['/api/v1/auth/code']);
  await expect(page.getByText(/095270/)).toHaveCount(0);
});

test('发送验证码遇到 503 可重试，sms 响应不显示固定测试码', async ({ page }) => {
  const requests: string[] = [];
  const sent: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(new URL(request.url()).pathname);
  });
  await page.route('**/api/v1/auth/code', (route) => {
    expect(route.request().method()).toBe('POST');
    sent.push(route.request().postDataJSON());
    return sent.length === 1
      ? route.fulfill({
          status: 503,
          json: { code: 'SERVICE_UNAVAILABLE', message: '短信服务暂不可用' },
        })
      : route.fulfill({ json: codeResult('sms') });
  });
  await page.goto('/#/auth');
  await page.getByLabel(/^手机号/).fill('13812345678');
  const sendButton = page.getByRole('button', { name: /获取验证码|\d+s 后重发/ });
  await sendButton.click();
  await expect(page.getByText('短信服务暂不可用', { exact: true })).toBeVisible();
  await expect(sendButton).toHaveText('获取验证码');
  await expect(sendButton).toBeEnabled();
  await expect(page.getByText(/095270/)).toHaveCount(0);
  await sendButton.click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText('已发送');
  await expect(page.getByText('短信服务暂不可用', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/095270/)).toHaveCount(0);
  await expect(sendButton).toHaveText(/^(60|59)s 后重发$/);
  await expect(sendButton).toBeDisabled();
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('123456');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText('功能暂未开放');
  expect(sent).toEqual([
    { region: 'CN', phone: '13812345678' },
    { region: 'CN', phone: '13812345678' },
  ]);
  expect(requests).toEqual(['/api/v1/auth/code', '/api/v1/auth/code']);
  await expect(page).toHaveURL(/#\/auth$/);
});

test('密码页首次提供验证码注册入口，密码校验与显隐仅在本地完成', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  await page.goto('/#/auth');
  await page.getByRole('tab', { name: '密码登录', exact: true }).click();
  const password = page.getByLabel(/^密码\s*\*?\s*$/);
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveCount(0);
  await expect(page.getByText('还没有账号？')).toBeVisible();
  await expect(page.getByRole('button', { name: '验证码注册', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: '操作提示' })).toHaveCount(0);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/frontend-password.png', fullPage: true });
  await page.getByRole('button', { name: '验证码注册', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toBeFocused();
  await expect(password).toHaveCount(0);
  await expect(page.getByText(/^请输入(手机号|密码|验证码)$/)).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.getByRole('tab', { name: '密码登录', exact: true }).click();
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByText('请输入手机号', { exact: true })).toBeVisible();
  await expect(page.getByText('请输入密码', { exact: true })).toBeVisible();
  await page.getByLabel(/^手机号/).fill('13812345678');
  await password.fill('demo');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toHaveText(
    '密码登录暂未开放，请使用验证码登录或注册。',
  );
  await expect(page).toHaveURL(/#\/auth$/);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await page.getByRole('button', { name: '验证码注册', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: '验证码登录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel(/^手机号/)).toHaveValue('13812345678');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toBeFocused();
  await expect(password).toHaveCount(0);
  await expect(page.getByRole('status', { name: '操作提示' })).toHaveCount(0);
  await expect(page.getByText('请输入密码', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '密码登录', exact: true }).click();
  await expect(password).toHaveValue('');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: '验证码注册', exact: true })).toBeVisible();
  await password.fill('Sensitive123');
  await page.reload();
  await expect(page.getByRole('tab', { name: '验证码登录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: '密码登录', exact: true }).click();
  await expect(password).toHaveValue('');
  await expect(page.getByLabel(/^手机号/)).toHaveValue('');
  expect(requests).toEqual([]);
});

test('个人资料页保留个人字段，校验后仅提示尚未提交', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(request.url());
  });
  await page.goto('/#/register');
  await expect(page.getByRole('heading', { name: '完善个人资料', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel(/^手机/)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/^组织名称/)).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole('button', { name: '完成注册', exact: true }).click();
  await expect(page.getByText('请输入密码', { exact: true })).toBeVisible();
  await expect(page.getByText('请输入姓名', { exact: true })).toBeVisible();
  await page.getByLabel(/^登录密码/).fill('Password123');
  await page.getByLabel(/^确认密码/).fill('Different123');
  await page.getByLabel(/^姓名/).fill('测试小明');
  await expect(page.getByText('两次输入的密码不一致', { exact: true })).toBeVisible();
  await page.getByLabel(/^确认密码/).fill('Password123');
  await page.getByLabel(/^昵称/).fill('潮汐测试员');
  await page.getByLabel(/^身份证号/).fill('123456789012345');
  await page.getByLabel(/^邮箱/).fill('sample@example.com');
  await page.getByRole('button', { name: '完成注册', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText(
    '注册功能暂未开放，个人资料尚未提交',
  );
  await expect(page).toHaveURL(/#\/register$/);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.getByRole('heading', { name: '完善个人资料', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/screenshots/frontend-register.png', fullPage: true });
  await page.getByRole('link', { name: '返回登录 / 注册', exact: true }).click();
  await expect(page).toHaveURL(/#\/auth$/);
  await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
});

test('输入校验、手机号变化、刷新和前进后退不保留敏感输入', async ({ page }) => {
  await page.goto('/#/auth');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText('请输入手机号', { exact: true })).toBeVisible();
  await expect(page.getByText('请输入验证码', { exact: true })).toBeVisible();
  await page.getByLabel(/^手机号/).fill('123');
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('12');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText('请输入 11 位大陆手机号码', { exact: true })).toBeVisible();
  await expect(page.getByText('请输入 6 位验证码', { exact: true })).toBeVisible();
  await page.getByLabel(/^手机号/).fill('13812345678');
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('123456');
  await page.getByLabel(/^手机号/).fill('13912345678');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('654321');
  await page.goto('/#/register');
  await page.getByLabel(/^登录密码/).fill('Register123');
  await page.getByLabel(/^确认密码/).fill('Register123');
  await page.getByLabel(/^姓名/).fill('测试小明');
  await page.reload();
  await expect(page.getByRole('heading', { name: '完善个人资料', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^登录密码/)).toHaveValue('');
  await expect(page.getByLabel(/^确认密码/)).toHaveValue('');
  await expect(page.getByLabel(/^姓名/)).toHaveValue('');
  await page.getByLabel(/^登录密码/).fill('Sensitive123');
  await page.goBack();
  await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^手机号/)).toHaveValue('');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
  await page.getByLabel(/^手机号/).fill('13812345678');
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('123456');
  await page.goForward();
  await expect(page.getByRole('heading', { name: '完善个人资料', exact: true })).toBeVisible();
  await expect(page.getByLabel(/^登录密码/)).toHaveValue('');
  await expect(page.getByLabel(/^姓名/)).toHaveValue('');
  await page.getByRole('link', { name: '返回登录 / 注册', exact: true }).click();
  await expect(page.getByLabel(/^手机号/)).toHaveValue('');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
});

test('375px 窄屏支持键盘操作，入口和资料表单无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/missing');
  await expect(page).toHaveURL(/#\/auth$/);
  await page.getByRole('tab', { name: '验证码登录', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '密码登录', exact: true })).toBeFocused();
  await expect(page.getByLabel(/^密码\s*\*?\s*$/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: '验证码登录', exact: true })).toBeFocused();
  await page.getByLabel(/^手机号/).focus();
  await expect(page.getByLabel(/^手机号/)).toBeFocused();
  await page.keyboard.type('13812345678');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toBeFocused();
  await page.keyboard.type('123456');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '获取验证码', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText('功能暂未开放');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/#/register');
  await expect(page.getByLabel(/^登录密码/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel(/^邮箱/).scrollIntoViewIfNeeded();
  const emailBox = await page.getByLabel(/^邮箱/).boundingBox();
  const submitBox = await page.getByRole('button', { name: '完成注册', exact: true }).boundingBox();
  if (!emailBox || !submitBox) throw new Error('窄屏个人资料字段与提交按钮必须可见');
  expect(submitBox.y).toBeGreaterThanOrEqual(emailBox.y + emailBox.height);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({
    path: 'artifacts/screenshots/frontend-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: '返回登录 / 注册', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/auth$/);
});

test('Electron 仅通过受限 bridge 发送验证码，保留安全隔离和个人资料本地行为', async () => {
  const requests: {
    path: string | undefined;
    method: string | undefined;
    client: string | string[] | undefined;
    body: string;
  }[] = [];
  const fixtureBackend = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        path: request.url,
        method: request.method,
        client: request.headers['x-tyde-client'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (request.url === '/api/v1/auth/code' && request.method === 'POST') {
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(codeResult()));
      } else {
        response
          .writeHead(503, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: '此接口不应被调用' }));
      }
    });
  });
  await new Promise<void>((resolve) => fixtureBackend.listen(0, '127.0.0.1', resolve));
  const address = fixtureBackend.address();
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
        TYDE_API_BASE_URL: 'http://127.0.0.1:' + address.port,
        TYDE_TEST_USER_DATA: profile,
      },
    });
    try {
      const page = await app.firstWindow();
      await expect(
        page.getByRole('heading', { name: '欢迎使用 Tyde 潮汐协作平台', level: 1 }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(2);
      expect(requests).toEqual([]);
      await page.getByRole('button', { name: '获取验证码', exact: true }).click();
      await expect(page.getByText('请输入手机号', { exact: true })).toBeVisible();
      expect(requests).toEqual([]);
      await page.getByLabel(/^手机号/).fill('13812345678');
      await page.getByRole('button', { name: '获取验证码', exact: true }).click();
      await expect(page.getByText(/095270/)).toBeVisible();
      await expect(page.getByRole('button', { name: /\d+s 后重发/ })).toBeDisabled();
      expect(requests).toEqual([
        {
          path: '/api/v1/auth/code',
          method: 'POST',
          client: 'desktop',
          body: JSON.stringify({ region: 'CN', phone: '13812345678' }),
        },
      ]);
      await page.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
      await page.getByRole('button', { name: '继续', exact: true }).click();
      await expect(page.getByRole('status', { name: '操作提示' })).toContainText(
        '尚未验证手机号或创建账号',
      );
      await expect(page).toHaveURL(/#\/auth$/);
      await page.goto('http://127.0.0.1:5176/#/register');
      await expect(page.getByRole('heading', { name: '完善个人资料', exact: true })).toBeVisible();
      await expect(page.getByRole('radio')).toHaveCount(0);
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      await expect(page.getByLabel(/^手机/)).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveCount(0);
      await page.getByLabel(/^登录密码/).fill('Password123');
      await page.getByLabel(/^确认密码/).fill('Password123');
      await page.getByLabel(/^姓名/).fill('测试小明');
      await page.getByRole('button', { name: '完成注册', exact: true }).click();
      await expect(page.getByRole('status', { name: '操作提示' })).toContainText(
        '个人资料尚未提交',
      );
      await page.reload();
      await expect(page.getByLabel(/^登录密码/)).toHaveValue('');
      await expect(page.getByLabel(/^姓名/)).toHaveValue('');
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
      await mkdir('artifacts/screenshots', { recursive: true });
      await page
        .getByRole('heading', { name: '完善个人资料', exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'artifacts/screenshots/frontend-electron.png' });
      await page.getByRole('link', { name: '返回登录 / 注册', exact: true }).click();
      await expect(page).toHaveURL(/#\/auth$/);
      await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
      expect(requests).toHaveLength(1);
    } finally {
      await app.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      fixtureBackend.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('DEV 的 Web 与 Electron 本地验证码引导新账号填写个人资料，全程不发 API 请求', async ({
  page,
}) => {
  async function completeLocalRegistration(currentPage: typeof page) {
    await expect(
      currentPage.getByRole('heading', { name: '登录 / 注册', exact: true }),
    ).toBeVisible();
    await currentPage.getByLabel(/^手机号/).fill('13812345678');
    await currentPage.getByRole('tab', { name: '密码登录', exact: true }).click();
    await expect(
      currentPage.getByRole('button', { name: '验证码注册', exact: true }),
    ).toBeVisible();
    await currentPage.getByRole('button', { name: '验证码注册', exact: true }).click();
    await expect(currentPage.getByLabel(/^手机号/)).toHaveValue('13812345678');
    await expect(currentPage.getByRole('textbox', { name: '验证码', exact: true })).toBeFocused();
    await expect(currentPage.getByLabel(/^密码\s*\*?\s*$/)).toHaveCount(0);
    await currentPage.getByRole('button', { name: '获取验证码', exact: true }).click();
    await expect(currentPage.getByRole('status', { name: '操作提示' })).toContainText(
      '本地测试验证码：095270',
    );
    await expect(currentPage.getByRole('status', { name: '操作提示' })).toContainText(
      '不会发送短信',
    );
    await expect(currentPage.getByRole('button', { name: /^(60|59)s 后重发$/ })).toBeDisabled();
    if (currentPage === page) {
      await mkdir('artifacts/screenshots', { recursive: true });
      await currentPage.screenshot({
        path: 'artifacts/screenshots/frontend-local-sms-mock.png',
        fullPage: true,
      });
    }
    await currentPage.getByRole('textbox', { name: '验证码', exact: true }).fill('123456');
    await currentPage.getByRole('button', { name: '继续', exact: true }).click();
    await expect(currentPage.getByText('验证码不正确', { exact: true })).toBeVisible();
    await expect(currentPage).toHaveURL('http://127.0.0.1:5177/#/auth');
    await currentPage.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
    await currentPage.getByRole('button', { name: '继续', exact: true }).click();
    await expect(currentPage).toHaveURL('http://127.0.0.1:5177/#/register');
    await expect(
      currentPage.getByRole('heading', { name: '完善个人资料', exact: true }),
    ).toBeVisible();
    await expect(currentPage.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
    if (currentPage === page) {
      await currentPage.screenshot({
        path: 'artifacts/screenshots/frontend-local-register-mock.png',
        fullPage: true,
      });
    }
    await currentPage.getByLabel(/^登录密码/).fill('Password123');
    await currentPage.getByLabel(/^确认密码/).fill('Password123');
    await currentPage.getByLabel(/^姓名/).fill('测试小明');
    await currentPage.getByLabel(/^昵称/).fill('潮汐测试员');
    await currentPage.getByLabel(/^身份证号/).fill('123456789012345');
    await currentPage.getByLabel(/^邮箱/).fill('sample@example.com');
    await currentPage.getByRole('button', { name: '完成注册', exact: true }).click();
    await expect(currentPage.getByRole('status', { name: '操作提示' })).toContainText(
      '注册功能暂未开放，个人资料尚未提交',
    );
    await expect(currentPage).toHaveURL('http://127.0.0.1:5177/#/register');
    await expect(currentPage.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
    await currentPage.getByRole('link', { name: '返回登录 / 注册', exact: true }).click();
    await expect(currentPage).toHaveURL('http://127.0.0.1:5177/#/auth');
    await expect(currentPage.getByLabel(/^手机号/)).toHaveValue('');
    await expect(currentPage.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
    await currentPage.reload();
    await expect(currentPage.getByLabel(/^手机号/)).toHaveValue('');
    await expect(currentPage.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
    await expect(currentPage.getByRole('status', { name: '操作提示' })).toHaveCount(0);
  }

  const webRequests: string[] = [];
  await page.route('**/api/**', async (route) => {
    webRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto('http://127.0.0.1:5177/#/auth');
  await completeLocalRegistration(page);
  expect(webRequests).toEqual([]);

  let bridgeRequests = 0;
  const isolatedBackend = createServer((_request, response) => {
    bridgeRequests++;
    response.writeHead(503).end();
  });
  await new Promise<void>((resolve) => isolatedBackend.listen(0, '127.0.0.1', resolve));
  const address = isolatedBackend.address();
  if (!address || typeof address === 'string') throw new Error('未能分配隔离测试端口');
  await mkdir('.local/frontend', { recursive: true });
  const profile = await mkdtemp(resolve('.local/frontend/dev-ui-'));
  try {
    const app = await electron.launch({
      executablePath: require('electron') as string,
      args: [resolve('apps/electron/out/main/index.js')],
      env: {
        ...process.env,
        TYDE_WEB_URL: 'http://127.0.0.1:5177/',
        TYDE_API_BASE_URL: 'http://127.0.0.1:' + address.port,
        TYDE_TEST_USER_DATA: profile,
      },
    });
    try {
      const desktopPage = await app.firstWindow();
      const rendererRequests: string[] = [];
      await desktopPage.route('**/api/**', async (route) => {
        rendererRequests.push(route.request().url());
        await route.abort();
      });
      await expect(
        desktopPage.getByRole('heading', { name: '登录 / 注册', exact: true }),
      ).toBeVisible();
      expect(await desktopPage.evaluate(() => Boolean(window.tydeDesktop))).toBe(true);
      await completeLocalRegistration(desktopPage);
      expect(rendererRequests).toEqual([]);
      expect(bridgeRequests).toBe(0);
    } finally {
      await app.close();
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      isolatedBackend.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('DEV 本地凭证在切模式、换号或刷新后失效且五分钟过期', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  await page.clock.install();
  await page.goto('http://127.0.0.1:5177/#/auth');
  await page.getByLabel(/^手机号/).fill('13812345678');
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText('请先获取本地测试验证码。', { exact: true })).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5177/#/auth');
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText(
    '本地测试验证码：095270',
  );
  await page.getByRole('tab', { name: '密码登录', exact: true }).click();
  await page.getByRole('tab', { name: '验证码登录', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: /\d+s 后重发/ })).toBeDisabled();
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText('请先获取本地测试验证码。', { exact: true })).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5177/#/auth');
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
  await page.getByLabel(/^手机号/).fill('13912345678');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
  await expect(page.getByRole('status', { name: '操作提示' })).toHaveCount(0);
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText('请先获取本地测试验证码。', { exact: true })).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5177/#/auth');
  await page.clock.fastForward(61_000);
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText(
    '本地测试验证码：095270',
  );
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
  await page.clock.fastForward(301_000);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText('验证码已过期，请重新获取。', { exact: true })).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5177/#/auth');
  await page.getByRole('button', { name: '获取验证码', exact: true }).click();
  await expect(page.getByRole('status', { name: '操作提示' })).toContainText(
    '本地测试验证码：095270',
  );
  await page.reload();
  await expect(page.getByLabel(/^手机号/)).toHaveValue('');
  await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveValue('');
  await page.getByLabel(/^手机号/).fill('13912345678');
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('095270');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByText('请先获取本地测试验证码。', { exact: true })).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:5177/#/auth');
  expect(requests).toEqual([]);
});
