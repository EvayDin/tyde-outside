import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';
import type {
  CodeResult,
  RegistrationRequired,
  SessionResult,
} from '../../packages/shared/src/index';

const root = process.cwd();
const require = createRequire(resolve(root, 'apps/electron/package.json'));
const phone = () => `139${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

/** 显式验证现有 Web API 契约；认证页本身处于 UI 复刻阶段，不自动联调。 */
async function registerWeb(page: Page) {
  const number = phone();
  const headers = { 'X-Tyde-Client': 'web', Origin: new URL(page.url()).origin };
  const code = await page.request.post('/api/v1/auth/code', {
    headers,
    data: { region: 'CN', phone: number },
  });
  expect(code.ok()).toBe(true);
  const challenge = (await code.json()) as CodeResult;
  const verify = await page.request.post('/api/v1/auth/verify', {
    headers,
    data: { region: 'CN', phone: number, code: '095270', challengeId: challenge.challengeId },
  });
  expect(verify.ok()).toBe(true);
  const grant = (await verify.json()) as RegistrationRequired;
  expect(grant.status).toBe('registration_required');
  const registered = await page.request.post('/api/v1/auth/register', {
    headers,
    data: {
      registrationToken: grant.registrationToken,
      username: `trial_${randomInt(1, 1_000_000_000)}`,
      displayName: '测试小明 Alex',
    },
  });
  expect(registered.ok()).toBe(true);
  const session = (await registered.json()) as SessionResult;
  expect(session.user.phoneE164).toBe(`+86${number}`);
  expect(JSON.stringify(session)).not.toContain('sessionToken');
  return headers;
}

test('Web API 注册、Cookie 会话恢复与退出', async ({ page }) => {
  await page.goto('/');
  const headers = await registerWeb(page);
  await page.reload();
  const current = await page.request.get('/api/v1/auth/me', { headers });
  expect(current.ok()).toBe(true);
  expect(((await current.json()) as SessionResult).user.displayName).toBe('测试小明 Alex');
  const logout = await page.request.post('/api/v1/auth/logout', { headers });
  expect(logout.status()).toBe(204);
  expect((await page.request.get('/api/v1/auth/me', { headers })).status()).toBe(401);
});

/** 直接通过受限 bridge 验证当前桌面接口，不依赖尚未联调的表单。 */
async function registerDesktop(page: Page) {
  const number = phone();
  const code = await page.evaluate(
    (number) => window.tydeDesktop!.sendCode({ region: 'CN', phone: number }),
    number,
  );
  if (!code.ok) throw new Error(code.error.message);
  const verified = await page.evaluate(
    ({ number, challengeId }) =>
      window.tydeDesktop!.verifyCode({ region: 'CN', phone: number, code: '095270', challengeId }),
    { number, challengeId: code.data.challengeId },
  );
  if (!verified.ok || verified.data.status !== 'registration_required')
    throw new Error('未获得注册凭证');
  const registered = await page.evaluate(
    (registrationToken) =>
      window.tydeDesktop!.completeRegistration({
        registrationToken,
        username: `trial_${Date.now()}`,
        displayName: '测试小明 Alex',
      }),
    verified.data.registrationToken,
  );
  expect(registered.ok).toBe(true);
  expect(JSON.stringify(registered)).not.toContain('sessionToken');
}

test('Electron bridge 加密保存会话、重启恢复与退出', async () => {
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
    await registerDesktop(await app.firstWindow());
    await app.close();
    app = await electron.launch(options);
    const page = await app.firstWindow();
    const current = await page.evaluate(() => window.tydeDesktop!.getCurrentUser());
    if (!current.ok) throw new Error(current.error.message);
    expect(current.data.user.displayName).toBe('测试小明 Alex');
    const logout = await page.evaluate(() => window.tydeDesktop!.logout());
    expect(logout.ok).toBe(true);
    const cleared = await page.evaluate(() => window.tydeDesktop!.getCurrentUser());
    expect(cleared.ok).toBe(false);
    if (!cleared.ok) expect(cleared.status).toBe(401);
  } finally {
    await app.close();
  }
});
