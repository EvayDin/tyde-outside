import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AuthUser } from '../../packages/shared/src/index';

const require = createRequire(resolve('apps/electron/package.json'));
const phone = '13812345678';
const verificationCode = '731846';
const password = 'Password123!';
const registrationToken = 'g'.repeat(43);
const serverMessage = '服务端已受理短信请求 A7';
const successNotice = `${serverMessage} 测试验证码：095270`;
const user: AuthUser = {
  id: 'fixture-user',
  uid: 'TYDE10001',
  accountType: 'INDIVIDUAL',
  phone,
  nickname: '潮汐测试员',
  realName: '测试小明',
  idCardNo: '110************01X',
  idVerified: 0,
  avatarUrl: null,
  bio: null,
  role: 'EXPERT',
  roles: ['EXPERT'],
  selectedRole: 'EXPERT',
  hasExpertManagementRole: false,
  status: 'ACTIVE',
  creditScore: 100,
  lastLoginAt: null,
  lastLoginIp: null,
  organization: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const loginTokens = {
  accessToken: 'a'.repeat(43),
  refreshToken: 'r'.repeat(43),
  tokenType: 'Bearer',
  expiresIn: 1800,
};
const grant = () => ({
  status: 'registration_required',
  registrationToken,
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
});
const success = (data: unknown) => ({ code: 200, message: '操作成功', data });
const failure = (status: number, message: string) => ({
  code: status === 429 ? 4292 : status,
  message,
  data: null,
});
interface RequestRecord {
  path: string;
  method: string;
  body: unknown;
  client?: string;
}

async function webBackend(page: Page) {
  const state = {
    signedIn: false,
    registered: false,
    sendStatus: 200,
    sendMessage: serverMessage,
    sendNetworkFailure: false,
    currentStatus: 200,
    smsStatus: 200,
  };
  const requests: RequestRecord[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({
      path,
      method: request.method(),
      body: request.postData() ? request.postDataJSON() : null,
      client: request.headers()['x-tyde-client'],
    });
    const reply = (data: unknown, headers?: Record<string, string>) =>
      route.fulfill({ json: success(data), headers });
    const reject = (status: number, message: string, headers?: Record<string, string>) =>
      route.fulfill({ status, json: failure(status, message), headers });
    switch (path) {
      case '/api/v1/users/me':
        if (state.currentStatus !== 200) return reject(state.currentStatus, '会话服务暂不可用');
        return state.signedIn && request.headers().cookie?.includes('fixture_session=active')
          ? reply(user)
          : reject(401, '请先登录');
      case '/api/v1/auth/refresh':
        return state.signedIn ? reply(loginTokens) : reject(401, '登录已过期');
      case '/api/v1/auth/sms/send':
        if (state.sendNetworkFailure) return route.abort('failed');
        if (state.sendStatus === 429)
          return reject(429, '发送频繁，请稍后重试', { 'Retry-After': '60' });
        if (state.sendStatus !== 200) return reject(state.sendStatus, '短信服务暂不可用');
        return reply(state.sendMessage);
      case '/api/v1/auth/sms/login':
        if (state.smsStatus !== 200) return reject(state.smsStatus, '验证码校验失败');
        if (!state.registered) return reply(grant());
        state.signedIn = true;
        return reply(loginTokens, {
          'Set-Cookie': 'fixture_session=active; HttpOnly; SameSite=Lax; Path=/',
        });
      case '/api/v1/auth/register':
        state.registered = true;
        return reply(user);
      case '/api/v1/auth/login':
        state.signedIn = true;
        return reply(loginTokens, {
          'Set-Cookie': 'fixture_session=active; HttpOnly; SameSite=Lax; Path=/',
        });
      case '/api/v1/auth/logout':
        state.signedIn = false;
        return reply(null, { 'Set-Cookie': 'fixture_session=; Max-Age=0; HttpOnly; Path=/' });
      default:
        return reject(503, '调用了未约定的接口');
    }
  });
  return { state, requests };
}
const smsButton = (page: Page) =>
  page.getByRole('button', { name: /获取验证码|发送中|\d+s 后重发/ });
async function openAuth(page: Page, origin: string) {
  await page.goto(origin + '/#/auth');
  await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
}
async function smsLogin(page: Page) {
  await page.getByLabel(/^手机号/).fill(phone);
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill(verificationCode);
  await page.getByRole('button', { name: '继续', exact: true }).click();
}
async function fillRegistration(page: Page) {
  await page.getByLabel(/^登录密码/).fill(password);
  await page.getByLabel(/^确认密码/).fill(password);
  await page.getByLabel(/^姓名/).fill(user.realName);
  await page.getByLabel(/^昵称/).fill(user.nickname);
  await page.getByLabel(/^身份证号/).fill('11010119900101001X');
  await page.getByLabel(/^邮箱/).fill('sample@example.com');
}
async function expectWelcome(page: Page) {
  await expect(
    page.getByRole('heading', { name: '欢迎，' + user.nickname, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
}
function expectNoLegacyRequests(requests: RequestRecord[]) {
  expect(requests.some(({ path }) => /\/health\/|\/auth\/(code|verify|me)$/.test(path))).toBe(
    false,
  );
  expect(requests.every(({ client }) => client === 'web' || client === 'desktop')).toBe(true);
}

for (const [mode, origin] of [
  ['生产', 'http://127.0.0.1:5176'],
  ['DEV', 'http://127.0.0.1:5177'],
] as const) {
  test(`Web ${mode} 验证码真实发送，成功显示测试码并保留服务端提示且不重复`, async ({ page }) => {
    const { state, requests } = await webBackend(page);
    await openAuth(page, origin);
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('radio')).toHaveCount(0);
    await smsButton(page).click();
    await expect(page.getByText('请输入手机号', { exact: true })).toBeVisible();
    await page.getByLabel(/^手机号/).fill('123');
    await smsButton(page).click();
    await expect(page.getByText('请输入 11 位大陆手机号码', { exact: true })).toBeVisible();
    expect(requests.filter(({ path }) => path.includes('/sms/'))).toEqual([]);
    await page.getByLabel(/^手机号/).fill(phone);
    await smsButton(page).click();
    await expect(page.getByRole('status', { name: '操作提示' })).toHaveText(successNotice);
    await expect(smsButton(page)).toBeEnabled();
    await expect(smsButton(page)).toHaveText('获取验证码');
    expect(requests.filter(({ path }) => path.endsWith('/sms/send'))).toEqual([
      {
        path: '/api/v1/auth/sms/send',
        method: 'POST',
        body: { phone, scene: 'login' },
        client: 'web',
      },
    ]);
    state.sendMessage = '本地测试验证码：095270（不会发送短信）。';
    await smsButton(page).click();
    await expect(page.getByRole('status', { name: '操作提示' })).toHaveText(state.sendMessage);
    await smsLogin(page);
    await expect(page).toHaveURL(/#\/register$/);
    expect(requests.find(({ path }) => path.endsWith('/sms/login'))?.body).toEqual({
      phone,
      code: verificationCode,
    });
    expectNoLegacyRequests(requests);
  });

  test(`Web ${mode} 429 遵守 Retry-After，503和网络失败不会本地成功`, async ({ page }) => {
    const { state, requests } = await webBackend(page);
    await page.clock.install();
    await openAuth(page, origin);
    await page.getByLabel(/^手机号/).fill(phone);
    await smsButton(page).click();
    await expect(page.getByRole('status', { name: '操作提示' })).toHaveText(successNotice);
    state.sendStatus = 429;
    await smsButton(page).click();
    await expect(page.getByText('发送频繁，请稍后重试', { exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: '操作提示' })).toHaveCount(0);
    await expect(smsButton(page)).toHaveText(/^(60|59)s 后重发$/);
    await expect(smsButton(page)).toBeDisabled();
    await page.getByLabel(/^手机号/).fill('13912345678');
    await expect(smsButton(page)).toBeDisabled();
    await page.clock.fastForward(61_000);
    state.sendStatus = 503;
    await smsButton(page).click();
    await expect(page.getByText('短信服务暂不可用', { exact: true })).toBeVisible();
    await expect(smsButton(page)).toBeEnabled();
    await expect(page.getByRole('status', { name: '操作提示' })).toHaveCount(0);
    state.sendNetworkFailure = true;
    await smsButton(page).click();
    await expect(page.getByText('连接服务失败，请检查网络后重试', { exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: '操作提示' })).toHaveCount(0);
    await expect(page).toHaveURL(/#\/auth$/);
    expect(requests.filter(({ path }) => path.endsWith('/sms/send'))).toHaveLength(4);
    expectNoLegacyRequests(requests);
  });

  test(`Web ${mode} 验证码由服务端验证，老用户登录后恢复会话并退出`, async ({ page }) => {
    const { state, requests } = await webBackend(page);
    state.registered = true;
    state.smsStatus = 400;
    await openAuth(page, origin);
    await smsLogin(page);
    await expect(page.getByText('验证码校验失败', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#\/auth$/);
    state.smsStatus = 200;
    await page.getByRole('textbox', { name: '验证码', exact: true }).fill('268519');
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await expectWelcome(page);
    expect(requests.filter(({ path }) => path.endsWith('/sms/send'))).toHaveLength(0);
    expect(
      requests.filter(({ path }) => path.endsWith('/sms/login')).map(({ body }) => body),
    ).toEqual([
      { phone, code: verificationCode },
      { phone, code: '268519' },
    ]);
    await page.reload();
    await expectWelcome(page);
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL(/#\/auth$/);
    await page.reload();
    await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
    expect(requests.filter(({ path }) => path.endsWith('/auth/logout'))).toHaveLength(1);
    expectNoLegacyRequests(requests);
  });

  test(`Web ${mode} 密码登录提交真实账号密码，验证码注册入口清空敏感字段`, async ({ page }) => {
    const { requests } = await webBackend(page);
    await openAuth(page, origin);
    await page.getByRole('tab', { name: '密码登录', exact: true }).click();
    await expect(page.getByText('还没有账号？')).toBeVisible();
    await expect(page.getByRole('button', { name: '验证码注册', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '登录', exact: true }).click();
    expect(requests.filter(({ path }) => path.endsWith('/auth/login'))).toHaveLength(0);
    await page.getByLabel(/^手机号/).fill(phone);
    const input = page.getByLabel(/^密码\s*\*?\s*$/);
    await input.fill(password);
    await page.getByRole('button', { name: '显示密码', exact: true }).click();
    await expect(input).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: '验证码注册', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toBeFocused();
    await expect(page.getByLabel(/^手机号/)).toHaveValue(phone);
    await page.getByRole('tab', { name: '密码登录', exact: true }).click();
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('type', 'password');
    await input.fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expectWelcome(page);
    expect(requests.find(({ path }) => path.endsWith('/auth/login'))?.body).toEqual({
      account: phone,
      password,
    });
    const storage = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    );
    expect(storage).not.toContain(loginTokens.accessToken);
    expect(storage).not.toContain(loginTokens.refreshToken);
    expectNoLegacyRequests(requests);
  });

  test(`Web ${mode} 注册携带服务端凭证和个人字段，成功后返回密码登录且不自动登录`, async ({
    page,
  }) => {
    const { requests } = await webBackend(page);
    await openAuth(page, origin);
    await smsLogin(page);
    await expect(page.getByRole('heading', { name: '完善个人资料', exact: true })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByLabel(/^手机|^组织名称/)).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '验证码', exact: true })).toHaveCount(0);
    await fillRegistration(page);
    const currentCalls = requests.filter(({ path }) => path.endsWith('/users/me')).length;
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page).toHaveURL(/#\/auth$/);
    await expect(page.getByRole('tab', { name: '密码登录', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('status', { name: '操作提示' })).toHaveText(
      '注册成功，请使用密码登录。',
    );
    await expect(page.getByLabel(/^手机号/)).toHaveValue(phone);
    expect(requests.find(({ path }) => path.endsWith('/auth/register'))?.body).toEqual({
      accountType: 'INDIVIDUAL',
      phone,
      registrationToken,
      password,
      confirmPassword: password,
      realName: user.realName,
      nickname: user.nickname,
      idCardNo: '11010119900101001X',
      email: 'sample@example.com',
    });
    expect(requests.filter(({ path }) => path.endsWith('/auth/login'))).toHaveLength(0);
    expect(requests.filter(({ path }) => path.endsWith('/users/me'))).toHaveLength(currentCalls);
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
    expectNoLegacyRequests(requests);
  });

  test(`Web ${mode} 注册凭证仅存在内存，直访、刷新和离开资料页均不能复用`, async ({ page }) => {
    const { requests } = await webBackend(page);
    await page.goto(origin + '/#/register');
    await expect(page).toHaveURL(/#\/auth$/);
    await smsLogin(page);
    await expect(page).toHaveURL(/#\/register$/);
    await fillRegistration(page);
    await page.reload();
    await expect(page).toHaveURL(/#\/auth$/);
    await expect(page.getByLabel(/^手机号/)).toHaveValue('');
    await smsLogin(page);
    await expect(page).toHaveURL(/#\/register$/);
    await page.getByRole('link', { name: '返回登录 / 注册', exact: true }).click();
    await page.goto(origin + '/#/register');
    await expect(page).toHaveURL(/#\/auth$/);
    expect(requests.filter(({ path }) => path.endsWith('/auth/register'))).toHaveLength(0);
    const storage = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    );
    expect(storage).not.toContain(registrationToken);
  });

  test(`Web ${mode} 会话恢复503显示重试，恢复后进入欢迎页`, async ({ page }) => {
    const { state } = await webBackend(page);
    state.signedIn = true;
    state.currentStatus = 503;
    await page
      .context()
      .addCookies([
        { name: 'fixture_session', value: 'active', url: origin, httpOnly: true, sameSite: 'Lax' },
      ]);
    await page.goto(origin + '/');
    await expect(page.getByText('会话服务暂不可用', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toHaveCount(0);
    state.currentStatus = 200;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expectWelcome(page);
  });
}

test('个人资料在1280与375视口保留字段、键盘操作和完整单页布局', async ({ page }) => {
  await webBackend(page);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 812 });
    await openAuth(page, 'http://127.0.0.1:5176');
    await page.getByRole('tab', { name: '验证码登录', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '密码登录', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('button', { name: '验证码注册', exact: true }).focus();
    await page.keyboard.press('Enter');
    await smsLogin(page);
    await expect(page).toHaveURL(/#\/register$/);
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page.getByText('请输入密码', { exact: true })).toBeVisible();
    await expect(page.getByText('请输入姓名', { exact: true })).toBeVisible();
    for (const field of ['登录密码', '确认密码', '姓名', '昵称', '身份证号', '邮箱']) {
      await expect(page.getByLabel(new RegExp('^' + field))).toBeInViewport({ ratio: 1 });
    }
    await expect(page.getByRole('button', { name: '提交', exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect(
      await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= innerWidth,
        vertical:
          Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) <=
          innerHeight + 1,
      })),
    ).toEqual({ horizontal: true, vertical: true });
    await mkdir('artifacts/screenshots', { recursive: true });
    await page.screenshot({
      path: `artifacts/screenshots/frontend-register-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
});

async function desktopBackend() {
  const requests: RequestRecord[] = [];
  const state = { registered: false, signedIn: false };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      const path = request.url ?? '';
      requests.push({
        path,
        method: request.method ?? '',
        body,
        client: String(request.headers['x-tyde-client'] ?? ''),
      });
      const reply = (data: unknown) =>
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(success(data)));
      const reject = () =>
        response
          .writeHead(401, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(failure(401, '请先登录')));
      switch (path) {
        case '/api/v1/auth/sms/send':
          return reply(serverMessage);
        case '/api/v1/auth/sms/login':
          if (!state.registered) return reply(grant());
          state.signedIn = true;
          return reply(loginTokens);
        case '/api/v1/auth/register':
          state.registered = true;
          return reply(user);
        case '/api/v1/auth/login':
          state.signedIn = true;
          return reply(loginTokens);
        case '/api/v1/users/me':
          return state.signedIn &&
            request.headers.authorization === 'Bearer ' + loginTokens.accessToken
            ? reply(user)
            : reject();
        case '/api/v1/auth/refresh':
          return state.signedIn ? reply(loginTokens) : reject();
        case '/api/v1/auth/logout':
          state.signedIn = false;
          return reply(null);
        default:
          response.writeHead(503).end(JSON.stringify(failure(503, '调用了未约定的接口')));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('未分配测试端口');
  return {
    requests,
    url: 'http://127.0.0.1:' + address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

for (const [mode, origin] of [
  ['生产', 'http://127.0.0.1:5176/'],
  ['DEV', 'http://127.0.0.1:5177/'],
] as const) {
  test(`Electron ${mode} 通过真实bridge注册、登录、加密恢复及退出，令牌留在main`, async () => {
    const backend = await desktopBackend();
    await mkdir('.local/frontend', { recursive: true });
    const profile = await mkdtemp(resolve('.local/frontend/session-'));
    const env = {
      ...process.env,
      TYDE_WEB_URL: origin,
      TYDE_API_BASE_URL: backend.url,
      TYDE_TEST_USER_DATA: profile,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const launch = () =>
      electron.launch({
        executablePath: require('electron') as string,
        args: [resolve('apps/electron/out/main/index.js')],
        env,
      });
    let app: Awaited<ReturnType<typeof launch>> | undefined;
    try {
      app = await launch();
      let page = await app.firstWindow();
      const rendererRequests: string[] = [];
      const rendererTraffic: Promise<{ headers: Record<string, string>; body: string }>[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/api/')) rendererRequests.push(request.url());
      });
      page.on('response', (response) => {
        if (response.url().startsWith('tyde-debug://desktop/api/'))
          rendererTraffic.push(
            Promise.all([response.request().allHeaders(), response.text()]).then(
              ([headers, body]) => ({
                headers,
                body,
              }),
            ),
          );
      });
      await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
      if (mode === 'DEV') {
        const abandoned: { url?: string; body?: string } = {};
        const inspection = await app.context().newCDPSession(page);
        await inspection.send('Network.enable');
        inspection.on('Network.requestWillBeSent', ({ request }) => {
          if (request.url.startsWith('tyde-debug://desktop/api/v1/auth/sms/send?')) {
            abandoned.url = request.url;
            abandoned.body = request.postData ?? '';
          }
        });
        await inspection.send('Network.setBlockedURLs', {
          urls: ['tyde-debug://desktop/api/v1/auth/sms/send*'],
        });
        const aborted = await page.evaluate(
          (phone) => window.tydeDesktop!.sendCode({ phone, scene: 'login' }),
          phone,
        );
        expect(aborted.ok).toBe(false);
        expect(backend.requests.filter(({ path }) => path.endsWith('/sms/send'))).toHaveLength(0);
        if (!abandoned.url) throw new Error('未捕获开发代理请求');
        const oldTicket = { url: abandoned.url, body: abandoned.body ?? '' };
        await page.reload();
        await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
        await inspection.send('Network.setBlockedURLs', { urls: [] });
        const replay = await page.evaluate(async ({ url, body }) => {
          const response = await fetch(url, { method: 'POST', body, credentials: 'omit' });
          await response.arrayBuffer();
          return response.status;
        }, oldTicket);
        expect(replay).toBe(403);
        expect(backend.requests.filter(({ path }) => path.endsWith('/sms/send'))).toHaveLength(0);
        await inspection.detach();
      }
      await page.getByLabel(/^手机号/).fill(phone);
      const sending = page.waitForResponse((response) =>
        response.url().startsWith('tyde-debug://desktop/api/v1/auth/sms/send?'),
      );
      await smsButton(page).click();
      await expect(page.getByRole('status', { name: '操作提示' })).toHaveText(successNotice);
      const sent = await sending;
      expect(sent.status()).toBe(200);
      expect(sent.request().method()).toBe('POST');
      expect(JSON.parse(sent.request().postData()!)).toEqual({ phone, scene: 'login' });
      expect(await sent.json()).toEqual({ ok: true, data: serverMessage });
      await smsLogin(page);
      await expect(page).toHaveURL(/#\/register$/);
      await fillRegistration(page);
      await page.getByRole('button', { name: '提交', exact: true }).click();
      await expect(page.getByRole('status', { name: '操作提示' })).toHaveText(
        '注册成功，请使用密码登录。',
      );
      expect(backend.requests.filter(({ path }) => path.endsWith('/auth/login'))).toHaveLength(0);
      await page.getByLabel(/^密码\s*\*?\s*$/).fill(password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expectWelcome(page);
      const login = await page.evaluate(
        ({ phone, password }) => window.tydeDesktop!.login({ account: phone, password }),
        { phone, password },
      );
      expect(login.ok).toBe(true);
      const verification = await page.evaluate(
        ({ phone, code }) => window.tydeDesktop!.verifyCode({ phone, code }),
        { phone, code: verificationCode },
      );
      expect(verification).toEqual({ ok: true, data: { status: 'authenticated' } });
      expect(JSON.stringify({ login, verification })).not.toContain(loginTokens.accessToken);
      expect(JSON.stringify({ login, verification })).not.toContain(loginTokens.refreshToken);
      const preferences = await app.evaluate(({ BrowserWindow }) => {
        const p = BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences();
        return {
          contextIsolation: p.contextIsolation,
          sandbox: p.sandbox,
          nodeIntegration: p.nodeIntegration,
        };
      });
      expect(preferences).toEqual({
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      });
      expect(rendererRequests.length).toBeGreaterThan(0);
      expect(rendererRequests.every((url) => url.startsWith('tyde-debug://desktop/api/'))).toBe(
        true,
      );
      const traffic = await Promise.all(rendererTraffic);
      expect(traffic.every(({ headers }) => !headers.authorization && !headers.cookie)).toBe(true);
      expect(JSON.stringify(traffic)).not.toContain(loginTokens.accessToken);
      expect(JSON.stringify(traffic)).not.toContain(loginTokens.refreshToken);
      await page.getByRole('button', { name: '退出登录', exact: true }).click();
      await expect(page).toHaveURL(/#\/auth$/);
      await smsLogin(page);
      await expectWelcome(page);
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await expectWelcome(page);
      await page.getByRole('button', { name: '退出登录', exact: true }).click();
      await expect(page).toHaveURL(/#\/auth$/);
      const cleared = await page.evaluate(() => window.tydeDesktop!.getCurrentUser());
      expect(cleared.ok).toBe(false);
      if (!cleared.ok) expect(cleared.status).toBe(401);
      expect(
        backend.requests.filter(({ path }) => path.endsWith('/sms/send')).map(({ body }) => body),
      ).toEqual([{ phone, scene: 'login' }]);
      expectNoLegacyRequests(backend.requests);
    } finally {
      await app?.close();
      await backend.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
