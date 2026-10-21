import { test, expect, type Page } from '@playwright/test';
import type { AuthUser, OrganizationDetail } from '../../packages/shared/src/index';

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
const organization: OrganizationDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  name: '潮汐协作组',
  unifiedCreditCode: '91310000TEST000001',
  description: '组织接口返回的介绍',
  businessLicenseUrl: null,
  logoUrl: null,
  expertiseTags: ['数据标注'],
  verifyStatus: 'APPROVED',
  status: 'ACTIVE',
  position: 'OWNER',
  createdAt: '2026-01-01T00:00:00.000Z',
};
interface RecordedRequest {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
  authenticated: boolean;
}
async function profileBackend(page: Page, origin: string, signedIn = true) {
  const state = { signedIn, user: { ...fixtureUser }, updateStatus: 200, orgStatus: 200 };
  const requests: RecordedRequest[] = [];
  const signIn = async () => {
    state.signedIn = true;
    await page
      .context()
      .addCookies([
        { name: 'profile_session', value: 'active', url: origin, httpOnly: true, sameSite: 'Lax' },
      ]);
  };
  if (signedIn) await signIn();
  await page.route('https://avatars.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
        'base64',
      ),
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const authenticated =
      state.signedIn && !!(await request.allHeaders()).cookie?.includes('profile_session=active');
    const body = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : null;
    requests.push({ path, method: request.method(), body, authenticated });
    const reply = (data: unknown, status = 200, extra = {}) =>
      route.fulfill({
        status,
        headers: extra,
        json: {
          code: status,
          message:
            status === 200
              ? '操作成功'
              : status === 503
                ? '资料服务暂不可用'
                : '请先登录或检查权限',
          data,
        },
      });
    if (!authenticated) return reply(null, 401);
    if (path === '/api/v1/auth/logout') {
      state.signedIn = false;
      return reply(null, 200, {
        'Set-Cookie': 'profile_session=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax',
      });
    }
    if (path === '/api/v1/users/me' && request.method() === 'GET') return reply(state.user);
    if (path === '/api/v1/organizations' && request.method() === 'GET')
      return reply(organization, state.orgStatus);
    if (path === '/api/v1/users/me/update' && request.method() === 'POST') {
      if (state.updateStatus !== 200) return reply(null, state.updateStatus);
      if (body?.newPassword) {
        state.signedIn = false;
        return reply(state.user, 200, {
          'Set-Cookie': 'profile_session=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax',
        });
      }
      for (const key of ['bio', 'avatarUrl'] as const)
        if (typeof body?.[key] === 'string') state.user[key] = (body[key] as string).trim() || null;
      if (typeof body?.idCardNo === 'string')
        state.user.idCardNo = body.idCardNo.slice(0, 3) + '************' + body.idCardNo.slice(-3);
      return reply(state.user);
    }
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
const writes = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.path === '/api/v1/users/me/update');

for (const [mode, origin, desktop] of [
  ['Web 生产', 'http://127.0.0.1:5176', false],
  ['Web DEV', 'http://127.0.0.1:5177', false],
  ['Electron 运行配置', 'http://127.0.0.1:5176', true],
] as const) {
  test(`个人中心 ${mode} 真实资料差量保存、失败留稿、头像地址和刷新持久化`, async ({ page }) => {
    if (desktop)
      await page.addInitScript((apiBaseUrl) => {
        window.tydeDesktop = { getRuntimeConfig: async () => ({ ok: true, data: { apiBaseUrl } }) };
      }, origin);
    const { state, requests } = await profileBackend(page, origin);
    await openProfile(page, origin);
    await editProfile(page);
    await expect(page.getByLabel('身份证号', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('个人简介', { exact: true })).toHaveAttribute('maxlength', '1000');
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    await page.getByLabel('头像地址', { exact: true }).fill('javascript:alert(1)');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(
      page.getByText('请输入不含用户名和密码的 HTTPS 图片地址', { exact: true }),
    ).toBeVisible();
    expect(writes(requests)).toHaveLength(0);
    await page
      .getByLabel('头像地址', { exact: true })
      .fill('https://avatars.example.test/avatar.png');
    await page.getByLabel('个人简介', { exact: true }).fill('  联调后的个人简介  ');
    state.updateStatus = 503;
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByText('资料服务暂不可用', { exact: true })).toBeVisible();
    await expect(page.getByLabel('个人简介', { exact: true })).toHaveValue('  联调后的个人简介  ');
    expect(writes(requests)).toHaveLength(1);
    state.updateStatus = 200;
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByText('个人资料已保存', { exact: true })).toBeVisible();
    expect(writes(requests).at(-1)?.body).toEqual({
      avatarUrl: 'https://avatars.example.test/avatar.png',
      bio: '联调后的个人简介',
    });
    await page.reload();
    await page.getByRole('tab', { name: '个人资料', exact: true }).click();
    await expect(
      page
        .getByRole('tabpanel', { name: '个人资料', exact: true })
        .getByText('联调后的个人简介', { exact: true }),
    ).toBeVisible();
    await editProfile(page);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByText('个人资料没有变化', { exact: true })).toBeVisible();
    expect(writes(requests)).toHaveLength(2);
    await editProfile(page);
    await page.getByRole('button', { name: '清除头像', exact: true }).click();
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByText('个人资料已保存', { exact: true })).toBeVisible();
    expect(writes(requests).at(-1)?.body).toEqual({ avatarUrl: '' });
    expect(state.user.avatarUrl).toBeNull();
    expect(requests.some((r) => r.path.includes('/files/'))).toBe(false);
    expect(requests.every((r) => r.authenticated)).toBe(true);
  });
  test(`个人中心 ${mode} 改密真实提交且全部会话失效，失败不模拟成功`, async ({ page }) => {
    if (desktop)
      await page.addInitScript((apiBaseUrl) => {
        window.tydeDesktop = { getRuntimeConfig: async () => ({ ok: true, data: { apiBaseUrl } }) };
      }, origin);
    const { state, requests } = await profileBackend(page, origin);
    await openProfile(page, origin);
    await page.getByRole('tab', { name: '账户安全', exact: true }).click();
    await expect(
      page.getByText('修改成功后，全部设备需重新登录，包括当前设备。', { exact: true }),
    ).toBeVisible();
    const password = page.getByLabel(/^新密码\s*\*?\s*$/);
    const confirmation = page.getByLabel(/^确认新密码\s*\*?\s*$/);
    await password.fill('NewPassword123!');
    await confirmation.fill('Different123!');
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await expect(page.getByText('两次输入的新密码不一致', { exact: true })).toBeVisible();
    expect(writes(requests)).toHaveLength(0);
    await confirmation.fill('NewPassword123!');
    state.updateStatus = 503;
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await expect(page.getByText('资料服务暂不可用', { exact: true })).toBeVisible();
    await expect(password).toHaveValue('NewPassword123!');
    expect(writes(requests)).toHaveLength(1);
    state.updateStatus = 200;
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await expect(page).toHaveURL(/#\/auth$/);
    await expect(
      page.getByText('密码修改成功，全部设备需重新登录。', { exact: true }),
    ).toBeVisible();
    expect(writes(requests).at(-1)?.body).toEqual({
      newPassword: 'NewPassword123!',
      confirmNewPassword: 'NewPassword123!',
    });
    expect(state.signedIn).toBe(false);
    await page.goto(`${origin}/#/profile`);
    await expect(page).toHaveURL(/#\/auth$/);
    expect(writes(requests)).toHaveLength(2);
  });
  test(`个人中心 ${mode} 组织只读查询、权限隔离及失败重试`, async ({ page }) => {
    if (desktop)
      await page.addInitScript((apiBaseUrl) => {
        window.tydeDesktop = { getRuntimeConfig: async () => ({ ok: true, data: { apiBaseUrl } }) };
      }, origin);
    const { state, requests } = await profileBackend(page, origin);
    state.user.organization = {
      ...organization,
      description: '当前用户返回的组织摘要',
      joinStatus: 'ACTIVE',
    };
    state.orgStatus = 403;
    await openProfile(page, origin);
    const org = page.getByRole('region', { name: '所属组织', exact: true });
    await expect(org.getByText('当前用户返回的组织摘要', { exact: true })).toBeVisible();
    await expect(org.getByText(/组织详情未加载/)).toBeVisible();
    expect(requests.filter((r) => r.path === '/api/v1/organizations')).toHaveLength(1);
    state.orgStatus = 200;
    await org.getByRole('button', { name: '重新读取组织信息', exact: true }).click();
    await expect(org.getByText(organization.description!, { exact: true })).toBeVisible();
    state.user.organization = {
      ...organization,
      position: 'MEMBER',
      joinStatus: 'ACTIVE',
      description: '普通成员可见摘要',
    };
    await page.reload();
    await expect(org.getByText('普通成员可见摘要', { exact: true })).toBeVisible();
    expect(requests.filter((r) => r.path === '/api/v1/organizations')).toHaveLength(2);
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });
}

test('个人中心登录保护、概览与资料表单在桌面和手机无横向溢出', async ({ page }) => {
  const origin = 'http://127.0.0.1:5176';
  const { signIn } = await profileBackend(page, origin, false);
  await page.goto(`${origin}/#/profile`);
  await expect(page).toHaveURL(/#\/auth$/);
  await signIn();
  await page.reload();
  await openProfile(page, origin);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('tab', { name: '概览', exact: true }).click();
    await expect(page.getByText('示例数据', { exact: true })).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await editProfile(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: '取消', exact: true }).click();
  }
});
