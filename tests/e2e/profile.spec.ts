import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { AuthUser } from '../../packages/shared/src/index';

const fixtureUser: AuthUser = {
  id: 'profile-fixture',
  uid: 'TYDE10002',
  accountType: 'INDIVIDUAL',
  phone: '138****5678',
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
const avatar = {
  name: 'avatar.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
    'base64',
  ),
};
interface ProfileRequest {
  path: string;
  method: string;
  authenticated: boolean;
}

/** 接口替身只实现现有资料查询与退出；未约定的写接口一律失败。 */
async function profileBackend(page: Page, origin: string, signedIn = true) {
  const state = { signedIn, user: { ...fixtureUser } };
  const requests: ProfileRequest[] = [];
  const signIn = async () => {
    state.signedIn = true;
    await page.context().addCookies([
      {
        name: 'profile_session',
        value: 'active',
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  };
  if (signedIn) await signIn();
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    const path = new URL(request.url()).pathname;
    const authenticated = state.signedIn && !!headers.cookie?.includes('profile_session=active');
    requests.push({ path, method: request.method(), authenticated });
    const reply = (data: unknown, status = 200, extra = {}) =>
      route.fulfill({
        status,
        headers: extra,
        json: { code: status, message: status === 200 ? '操作成功' : '请先登录', data },
      });
    if (!authenticated) return reply(null, 401);
    if (path === '/api/v1/auth/logout' && request.method() === 'POST') {
      state.signedIn = false;
      return reply(null, 200, {
        'Set-Cookie': 'profile_session=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax',
      });
    }
    if (path === '/api/v1/users/me' && request.method() === 'GET') return reply(state.user);
    return reply(null, 404);
  });
  return { state, requests, signIn };
}

const openProfile = async (page: Page, origin: string) => {
  await page.goto(`${origin}/#/profile`);
  await expect(page.getByRole('tablist', { name: '个人中心设置', exact: true })).toBeVisible();
};

async function editProfile(page: Page) {
  await page.getByRole('tab', { name: '个人资料', exact: true }).click();
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await expect(page.getByLabel('个人简介', { exact: true })).toBeEditable();
}

async function exerciseProfilePreview(page: Page) {
  await editProfile(page);
  await expect(
    page.getByText(
      '当前为前端演示：资料修改仅在本次页面内生效，刷新后恢复；实际登录密码不会改变。',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel('身份证号', { exact: true })).toHaveValue('');
  await page.getByLabel('个人简介', { exact: true }).fill('取消的草稿');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await editProfile(page);
  await expect(page.getByLabel('个人简介', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('个人简介', { exact: true })).toHaveAttribute('maxlength', '200');
  await page.getByLabel('身份证号', { exact: true }).fill('invalid');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('请输入 15 位或 18 位身份证号', { exact: true })).toBeVisible();
  await page.getByLabel('身份证号', { exact: true }).fill('110101199003077156');
  await page.getByLabel('个人简介', { exact: true }).fill('  模拟保存的个人简介  ');
  const upload = page.getByLabel('更换头像', { exact: true });
  await upload.setInputFiles({
    name: 'invalid.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('invalid'),
  });
  await expect(
    page.getByText('请选择 JPG、PNG、GIF、BMP 或 WebP 图片', { exact: true }),
  ).toBeVisible();
  await upload.setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
  });
  await expect(page.getByText('请选择非空且不超过 2 MB 的头像图片', { exact: true })).toBeVisible();
  await upload.setInputFiles(avatar);
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(
    page.getByText('个人资料已模拟保存，刷新页面后恢复。', { exact: true }),
  ).toBeVisible();
  const profile = page.getByRole('tabpanel', { name: '个人资料', exact: true });
  await expect(profile.getByText('模拟保存的个人简介', { exact: true })).toBeVisible();
  await expect(profile.getByText(/^110\*+156$/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: '账户菜单', exact: true }).locator('img[src^="blob:"]'),
  ).toBeVisible();
  await editProfile(page);
  await expect(page.getByLabel('身份证号', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '清除头像', exact: true }).click();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑资料', exact: true })).toBeVisible();
  await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
  await expect(profile.getByText(/^110\*+156$/)).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: '个人资料', exact: true }).click();
  await expect(profile.getByText(fixtureUser.idCardNo!, { exact: true })).toBeVisible();
  await expect(page.getByText('模拟保存的个人简介', { exact: true })).toHaveCount(0);
}

for (const [mode, origin] of [
  ['生产', 'http://127.0.0.1:5176'],
  ['DEV', 'http://127.0.0.1:5177'],
] as const) {
  test(`个人中心 Web ${mode} 登录保护与账户菜单的导航、Escape、退出`, async ({ page }) => {
    const { requests, signIn } = await profileBackend(page, origin, false);
    await page.goto(`${origin}/#/profile`);
    await expect(page).toHaveURL(/#\/auth$/);
    await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
    await signIn();
    await page.goto(`${origin}/`);
    await expect(
      page.getByRole('heading', { name: '欢迎，潮汐测试员', exact: true }),
    ).toBeVisible();
    const account = page.getByRole('button', { name: '账户菜单', exact: true });
    await account.click();
    await expect(page.getByRole('navigation', { name: '账户选项', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: '账户选项', exact: true })).toHaveCount(0);
    await expect(account).toBeFocused();
    await account.press('Enter');
    await page
      .getByRole('navigation', { name: '账户选项', exact: true })
      .getByRole('link', { name: '个人中心', exact: true })
      .click();
    await expect(page).toHaveURL(/#\/profile$/);
    await expect(
      page
        .getByRole('complementary', { name: '个人资料摘要', exact: true })
        .getByText(fixtureUser.idCardNo!, { exact: true }),
    ).toBeVisible();
    await account.click();
    await page
      .getByRole('navigation', { name: '账户选项', exact: true })
      .getByRole('button', { name: '退出登录', exact: true })
      .click();
    await expect(page).toHaveURL(/#\/auth$/);
    await page.reload();
    await expect(page.getByRole('heading', { name: '登录 / 注册', exact: true })).toBeVisible();
    expect(requests.filter(({ method }) => method !== 'GET')).toEqual([
      { path: '/api/v1/auth/logout', method: 'POST', authenticated: true },
    ]);
  });

  test(`个人中心 Web ${mode} 资料与头像模拟保存、校验、取消和刷新恢复，无真实写请求`, async ({
    page,
  }) => {
    const { requests } = await profileBackend(page, origin);
    await openProfile(page, origin);
    await exerciseProfilePreview(page);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(
      requests.every(
        ({ path, method, authenticated }) =>
          path === '/api/v1/users/me' && method === 'GET' && authenticated,
      ),
    ).toBe(true);
  });

  test(`个人中心 Web ${mode} 概览示例图与组织按数据展示，编辑和改密演示跨视口无横向溢出`, async ({
    page,
  }) => {
    const { state, requests } = await profileBackend(page, origin);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openProfile(page, origin);
    await expect(page.getByRole('tab', { name: '概览', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const overview = page.getByRole('tabpanel', { name: '概览', exact: true });
    for (const name of ['考勤与报量', '能力雷达']) {
      const chart = overview.getByRole('region', { name, exact: true });
      await expect(chart.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(chart.getByText('示例数据', { exact: true })).toBeVisible();
    }
    await expect(overview.getByRole('group', { name: /年考勤与报量示例/ })).toBeVisible();
    await expect(overview.getByRole('img', { name: /能力雷达示例/ })).toBeVisible();
    for (const name of ['项目', '个人日志', '标签']) {
      await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
      await expect(page.getByRole('tab', { name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: /^(关注|联系|发消息|社交)$/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '所属组织', exact: true })).toHaveCount(0);
    const summary = page.getByRole('complementary', { name: '个人资料摘要', exact: true });
    for (const value of [
      fixtureUser.nickname,
      fixtureUser.realName,
      fixtureUser.phone,
      fixtureUser.uid,
      '执行专家',
    ])
      await expect(summary.getByText(value, { exact: true })).toBeVisible();
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 375, height: 812 },
      { width: 812, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole('tab', { name: '概览', exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(
        page.getByRole('tablist', { name: '个人中心设置', exact: true }),
      ).toHaveAttribute('aria-orientation', 'horizontal');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await mkdir('artifacts', { recursive: true });
      await page.screenshot({
        path: `artifacts/profile-overview-${mode}-${viewport.width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      if (mode === '生产' && viewport.width !== 812) {
        await page
          .getByRole('heading', { level: 1, name: fixtureUser.nickname, exact: true })
          .click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `artifacts/profile-overview-final-${viewport.width}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      await editProfile(page);
      await expect(page.getByLabel('身份证号', { exact: true })).toHaveCSS(
        'height',
        viewport.width > 640 ? '40px' : '44px',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `artifacts/profile-preview-${mode}-${viewport.width}-edit.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('tab', { name: '账户安全', exact: true }).click();
      for (const control of [
        page.getByLabel(/^新密码\s*\*?\s*$/),
        page.getByLabel(/^确认新密码\s*\*?\s*$/),
        page.getByRole('button', { name: '更新密码', exact: true }),
      ])
        await expect(control).toHaveCSS('height', viewport.width > 640 ? '40px' : '44px');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `artifacts/profile-preview-${mode}-${viewport.width}-security.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.getByRole('tab', { name: '个人资料', exact: true }).click();
    }
    await page.getByRole('tab', { name: '账户安全', exact: true }).click();
    const password = page.getByLabel(/^新密码\s*\*?\s*$/);
    const confirmation = page.getByLabel(/^确认新密码\s*\*?\s*$/);
    const submit = page.getByRole('button', { name: '更新密码', exact: true });
    await password.fill('short');
    await confirmation.fill('short');
    await submit.click();
    await expect(
      page.getByText('请输入 8～64 位字母、数字及允许的特殊字符，不能含空格或中文', {
        exact: true,
      }),
    ).toBeVisible();
    await password.fill('NewPassword123!');
    await confirmation.fill('Different123!');
    await submit.click();
    await expect(page.getByText('两次输入的新密码不一致', { exact: true })).toBeVisible();
    await confirmation.fill('NewPassword123!');
    await submit.click();
    await expect(page.getByText('已模拟修改，实际登录密码未改变', { exact: true })).toBeVisible();
    await expect(password).toHaveValue('');
    await expect(confirmation).toHaveValue('');
    state.user.organization = {
      name: '潮汐协作组',
      position: 'ADMIN',
      description: '协作组的现有介绍',
    };
    await page.reload();
    const organization = page.getByRole('region', { name: '所属组织', exact: true });
    await expect(organization.getByText('潮汐协作组', { exact: true })).toBeVisible();
    await expect(organization.getByText('管理员', { exact: true })).toBeVisible();
    await expect(organization.getByText('协作组的现有介绍', { exact: true })).toBeVisible();
    await expect(organization.getByLabel('组织领域', { exact: true })).toHaveCount(0);
    expect(
      requests.every(({ path, method }) => path === '/api/v1/users/me' && method === 'GET'),
    ).toBe(true);
  });
}

test('个人中心 Electron 运行配置适配使用相同本地资料演示，不发送业务写请求', async ({ page }) => {
  const origin = 'http://127.0.0.1:5176';
  const { requests } = await profileBackend(page, origin);
  await page.addInitScript((apiBaseUrl) => {
    window.tydeDesktop = {
      getRuntimeConfig: async () => ({ ok: true, data: { apiBaseUrl } }),
    };
  }, origin);
  await openProfile(page, origin);
  await exerciseProfilePreview(page);
  await page.getByRole('tab', { name: '账户安全', exact: true }).click();
  await page.getByLabel(/^新密码\s*\*?\s*$/).fill('NewPassword123!');
  await page.getByLabel(/^确认新密码\s*\*?\s*$/).fill('NewPassword123!');
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await expect(page.getByText('已模拟修改，实际登录密码未改变', { exact: true })).toBeVisible();
  expect(
    requests.every(
      ({ path, method, authenticated }) =>
        path === '/api/v1/users/me' && method === 'GET' && authenticated,
    ),
  ).toBe(true);
});
