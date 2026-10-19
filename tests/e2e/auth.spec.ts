import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import { MOCK_CODE } from '../../apps/server/src/modules/auth/security';
import type {
  AuthUser,
  RegistrationRequired,
  LoginResponse,
  Result,
} from '../../packages/shared/src/index';

const root = process.cwd();
const require = createRequire(resolve(root, 'apps/electron/package.json'));
const phone = () => `139${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
const password = 'Password123!';
const profile = {
  accountType: 'INDIVIDUAL' as const,
  password,
  confirmPassword: password,
  realName: '测试小明',
  nickname: '潮汐测试员',
};
const personalFields = (number: string) => ({
  ...profile,
  idCardNo: number.padStart(17, '0') + 'X',
  email: number + '@example.invalid',
});

/** 此套件只使用 playwright.config.ts 配置的3100专用测试服务。 */
async function registerWeb(page: Page) {
  const number = phone();
  const headers = { 'X-Tyde-Client': 'web', Origin: new URL(page.url()).origin };
  const code = await page.request.post('/api/v1/auth/sms/send', {
    headers,
    data: { phone: number, scene: 'login' },
  });
  expect(code.ok()).toBe(true);
  expect(typeof ((await code.json()) as Result<string>).data).toBe('string');
  const verify = await page.request.post('/api/v1/auth/sms/login', {
    headers,
    data: { phone: number, code: MOCK_CODE },
  });
  expect(verify.ok()).toBe(true);
  const grant = ((await verify.json()) as Result<RegistrationRequired>).data;
  expect(grant.status).toBe('registration_required');
  const registered = await page.request.post('/api/v1/auth/register', {
    headers,
    data: { ...personalFields(number), phone: number, registrationToken: grant.registrationToken },
  });
  expect(registered.ok()).toBe(true);
  const registration = (await registered.json()) as Result<AuthUser>;
  expect(registration.data.phone).toBe(number.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'));
  expect(registration.data.nickname).toBe(profile.nickname);
  expect(registration.data.role).toBe('EXPERT');
  expect(JSON.stringify(registration)).not.toMatch(/accessToken|refreshToken/);
  expect((await page.request.get('/api/v1/users/me', { headers })).status()).toBe(401);
  const login = await page.request.post('/api/v1/auth/login', {
    headers,
    data: { account: number, password },
  });
  expect(login.ok()).toBe(true);
  const tokens = ((await login.json()) as Result<LoginResponse>).data;
  expect(tokens.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'tyde_session',
  );
  expect(sessionCookie?.httpOnly).toBe(true);
  return { headers, tokens };
}

test('Web真实API注册不登录、密码登录、Cookie恢复、令牌轮换与200退出', async ({ page }) => {
  await page.goto('/');
  const { headers, tokens } = await registerWeb(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: '欢迎，潮汐测试员', exact: true })).toBeVisible();
  const current = await page.request.get('/api/v1/users/me', { headers });
  expect(current.ok()).toBe(true);
  expect(((await current.json()) as Result<AuthUser>).data.nickname).toBe(profile.nickname);
  const refresh = await page.request.post('/api/v1/auth/refresh', {
    headers,
    data: { refreshToken: tokens.refreshToken },
  });
  expect(refresh.ok()).toBe(true);
  const rotated = ((await refresh.json()) as Result<LoginResponse>).data;
  expect(rotated.accessToken).not.toBe(tokens.accessToken);
  expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
  expect(
    (
      await page.request.post('/api/v1/auth/refresh', {
        headers,
        data: { refreshToken: tokens.refreshToken },
      })
    ).status(),
  ).toBe(401);
  expect((await page.request.get('/api/v1/users/me', { headers })).ok()).toBe(true);
  const logout = await page.request.post('/api/v1/auth/logout', { headers });
  expect(logout.status()).toBe(200);
  expect(await logout.json()).toEqual({ code: 200, message: '操作成功', data: null });
  expect((await page.request.get('/api/v1/users/me', { headers })).status()).toBe(401);
  await page.reload();
  await expect(page).toHaveURL(/#\/auth$/);
});

async function registerDesktop(page: Page) {
  const number = phone();
  const sent = await page.evaluate(
    (number) => window.tydeDesktop!.sendCode({ phone: number, scene: 'login' }),
    number,
  );
  if (!sent.ok) throw new Error(sent.error.message);
  expect(typeof sent.data).toBe('string');
  const verified = await page.evaluate(
    ({ number, code }) => window.tydeDesktop!.verifyCode({ phone: number, code }),
    { number, code: MOCK_CODE },
  );
  if (!verified.ok || verified.data.status !== 'registration_required')
    throw new Error('未获得注册凭证');
  const registered = await page.evaluate(
    ({ input, number, registrationToken }) =>
      window.tydeDesktop!.completeRegistration({ ...input, phone: number, registrationToken }),
    {
      input: personalFields(number),
      number,
      registrationToken: verified.data.registrationToken,
    },
  );
  expect(registered.ok).toBe(true);
  expect(JSON.stringify(registered)).not.toMatch(/accessToken|refreshToken/);
  const anonymous = await page.evaluate(() => window.tydeDesktop!.getCurrentUser());
  expect(anonymous.ok).toBe(false);
  if (!anonymous.ok) expect(anonymous.status).toBe(401);
  const login = await page.evaluate(
    ({ number, password }) => window.tydeDesktop!.login({ account: number, password }),
    { number, password },
  );
  expect(login.ok).toBe(true);
  expect(JSON.stringify(login)).not.toMatch(/accessToken|refreshToken/);
}

test('Electron真实bridge加密保存令牌对、重启恢复与200退出', async () => {
  await mkdir('.local/e2e', { recursive: true });
  const userData = await mkdtemp(resolve(root, '.local/e2e/profile-'));
  const env = {
    ...process.env,
    TYDE_WEB_URL: 'http://127.0.0.1:5175/',
    TYDE_API_BASE_URL: 'http://127.0.0.1:3100',
    TYDE_TEST_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = {
    executablePath: require('electron') as string,
    args: [resolve(root, 'apps/electron/out/main/index.js')],
    env,
  };
  let app = await electron.launch(options);
  try {
    const first = await app.firstWindow();
    await registerDesktop(first);
    await first.reload();
    await expect(
      first.getByRole('heading', { name: '欢迎，潮汐测试员', exact: true }),
    ).toBeVisible();
    await app.close();
    app = await electron.launch(options);
    const page = await app.firstWindow();
    await expect(
      page.getByRole('heading', { name: '欢迎，潮汐测试员', exact: true }),
    ).toBeVisible();
    const current = await page.evaluate(() => window.tydeDesktop!.getCurrentUser());
    if (!current.ok) throw new Error(current.error.message);
    expect(current.data.nickname).toBe(profile.nickname);
    expect(JSON.stringify(current)).not.toMatch(/accessToken|refreshToken/);
    const logout = await page.evaluate(() => window.tydeDesktop!.logout());
    expect(logout.ok).toBe(true);
    const cleared = await page.evaluate(() => window.tydeDesktop!.getCurrentUser());
    expect(cleared.ok).toBe(false);
    if (!cleared.ok) expect(cleared.status).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(/#\/auth$/);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});
