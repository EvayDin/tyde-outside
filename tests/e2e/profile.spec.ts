import { createHash } from 'node:crypto';
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
  roles: ['NAVIGATOR', 'PM', 'EXPERT'],
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
  headers: Record<string, string>;
  form: Record<string, string>;
  fileName?: string;
  fileBytes?: Buffer;
}
const avatarBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);
const avatarReceipt = {
  objectKey: 'avatar/2026/10/21/0123456789abcdef0123456789abcdef.png',
  uploadToken: 'u'.repeat(43),
  url: 'https://avatars.example.test/local-avatar.png',
  sensitive: false,
  fileName: 'avatar-local.png',
  extension: 'png',
  size: avatarBytes.length,
  contentType: 'image/png',
  fileHash: createHash('sha256').update(avatarBytes).digest('hex'),
};
async function profileBackend(page: Page, origin: string, signedIn = true) {
  const state = {
    signedIn,
    user: { ...fixtureUser },
    updateStatus: 200,
    orgStatus: 200,
    uploadStatus: 200,
  };
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
      body: avatarBytes,
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = await request.allHeaders();
    const authenticated = state.signedIn && !!headers.cookie?.includes('profile_session=active');
    const body = headers['content-type']?.includes('application/json')
      ? (request.postDataJSON() as Record<string, unknown>)
      : null;
    const record: RecordedRequest = {
      path,
      method: request.method(),
      body,
      authenticated,
      headers,
      form: {},
    };
    if (headers['content-type']?.includes('multipart/form-data')) {
      const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(headers['content-type']);
      for (const part of (request.postDataBuffer()?.toString('latin1') ?? '').split(
        `--${boundary?.[1] ?? boundary?.[2]}`,
      )) {
        const name = /name="([^"]+)"/.exec(part)?.[1];
        const start = part.indexOf('\r\n\r\n');
        if (!name || start < 0) continue;
        const value = part.slice(start + 4).replace(/\r\n$/, '');
        const fileName = /filename="([^"]+)"/.exec(part)?.[1];
        if (fileName) {
          record.fileName = fileName;
          record.fileBytes = Buffer.from(value, 'latin1');
        } else record.form[name] = value;
      }
    }
    requests.push(record);
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
                ? path === '/api/v1/files/upload'
                  ? '头像存储暂不可用'
                  : '资料服务暂不可用'
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
    if (path === '/api/v1/auth/switch-role' && request.method() === 'POST') {
      const role = body?.role as AuthUser['role'];
      if (!state.user.roles.includes(role)) return reply(null, 403);
      state.user.role = role;
      state.user.selectedRole = role;
      return reply({ selectedRole: role, roles: [...state.user.roles] });
    }
    if (path === '/api/v1/expert-assignments/my-projects' && request.method() === 'GET')
      return reply([]);
    if (path === '/api/v1/files/upload' && request.method() === 'POST')
      return reply(state.uploadStatus === 200 ? avatarReceipt : null, state.uploadStatus);
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
      if (body?.avatarUrl === avatarReceipt.objectKey) {
        expect(body.avatarUploadToken).toBe(avatarReceipt.uploadToken);
        state.user.avatarUrl = avatarReceipt.url;
      } else if (typeof body?.avatarUrl === 'string')
        state.user.avatarUrl = body.avatarUrl.trim() || null;
      if (typeof body?.bio === 'string') state.user.bio = body.bio.trim() || null;
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
async function avatarLinkInput(page: Page) {
  const avatar = page.getByRole('region', { name: '头像设置', exact: true });
  const toggle = avatar.getByRole('button', { name: '使用图片链接', exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const input = avatar.getByLabel('头像地址', { exact: true });
  await expect(input).toBeEditable();
  return input;
}
const writes = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.path === '/api/v1/users/me/update');
const uploads = (requests: RecordedRequest[]) =>
  requests.filter((request) => request.path === '/api/v1/files/upload');
async function blobIsReadable(page: Page, url: string) {
  return page.evaluate(async (value) => {
    try {
      return (await fetch(value)).ok;
    } catch {
      return false;
    }
  }, url);
}

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
    await expect(page.getByLabel('上传本地头像', { exact: true })).toHaveAttribute('type', 'file');
    expect(uploads(requests)).toHaveLength(0);
    await (await avatarLinkInput(page)).fill('javascript:alert(1)');
    await page.getByRole('button', { name: '使用图片链接', exact: true }).click();
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(
      page.getByText('请输入不含用户名和密码的 HTTPS 图片地址', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '使用图片链接', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(writes(requests)).toHaveLength(0);
    await (await avatarLinkInput(page)).fill('https://avatars.example.test/avatar.png');
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
  test(`个人中心 ${mode} 本地头像保存时上传，存储失败留稿且资料失败重试复用认领凭证`, async ({
    page,
  }) => {
    if (desktop)
      await page.addInitScript((apiBaseUrl) => {
        window.tydeDesktop = { getRuntimeConfig: async () => ({ ok: true, data: { apiBaseUrl } }) };
      }, origin);
    const { state, requests } = await profileBackend(page, origin);
    await openProfile(page, origin);
    await editProfile(page);
    const panel = page.getByRole('tabpanel', { name: '个人资料', exact: true });
    const choosingAvatar = page.waitForEvent('filechooser');
    await panel.getByRole('button', { name: '更换头像', exact: true }).click();
    await (
      await choosingAvatar
    ).setFiles({
      name: avatarReceipt.fileName,
      mimeType: 'image/png',
      buffer: avatarBytes,
    });
    const preview = panel.getByRole('img', { name: `${fixtureUser.nickname}的头像`, exact: true });
    await expect(preview).toHaveAttribute('src', /^blob:/);
    const previewUrl = (await preview.getAttribute('src'))!;
    await expect(
      panel.getByText(`待保存头像：${avatarReceipt.fileName}`, { exact: true }),
    ).toBeVisible();
    await panel.getByLabel('个人简介', { exact: true }).fill('本地头像联调后的资料');
    expect(uploads(requests)).toHaveLength(0);
    expect(writes(requests)).toHaveLength(0);
    state.uploadStatus = 503;
    await panel.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(panel.getByText('头像存储暂不可用', { exact: true })).toBeVisible();
    await expect(preview).toHaveAttribute('src', previewUrl);
    await expect(panel.getByLabel('个人简介', { exact: true })).toHaveValue('本地头像联调后的资料');
    expect(uploads(requests)).toHaveLength(1);
    expect(writes(requests)).toHaveLength(0);
    state.uploadStatus = 200;
    state.updateStatus = 503;
    await panel.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(panel.getByText('资料服务暂不可用', { exact: true })).toBeVisible();
    await expect(preview).toHaveAttribute('src', previewUrl);
    expect(uploads(requests)).toHaveLength(2);
    expect(writes(requests)).toHaveLength(1);
    for (const label of ['策略官', '执行专家']) {
      await page.getByRole('combobox', { name: '当前角色', exact: true }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await expect(page.getByRole('combobox', { name: '当前角色', exact: true })).toContainText(
        label,
      );
      await expect(page).toHaveURL(/#\/profile$/);
      await expect(preview).toHaveAttribute('src', previewUrl);
      await expect(panel.getByLabel('个人简介', { exact: true })).toHaveValue(
        '本地头像联调后的资料',
      );
      expect(uploads(requests)).toHaveLength(2);
      expect(writes(requests)).toHaveLength(1);
    }
    state.updateStatus = 200;
    await panel.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(panel.getByText('个人资料已保存', { exact: true })).toBeVisible();
    expect(uploads(requests)).toHaveLength(2);
    expect(writes(requests)).toHaveLength(2);
    expect(writes(requests)[0].body).toEqual({
      avatarUrl: avatarReceipt.objectKey,
      avatarUploadToken: avatarReceipt.uploadToken,
      bio: '本地头像联调后的资料',
    });
    expect(writes(requests)[1].body).toEqual(writes(requests)[0].body);
    for (const request of uploads(requests)) {
      expect(request.form).toEqual({ bizType: 'AVATAR', category: 'IMAGE' });
      expect(request.fileName).toBe(avatarReceipt.fileName);
      expect(request.fileBytes).toEqual(avatarBytes);
      expect(request.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
      expect(request.headers['x-tyde-client']).toBe('web');
      expect(request.headers.authorization).toBeUndefined();
      expect(request.authenticated).toBe(true);
    }
    await expect.poll(() => blobIsReadable(page, previewUrl)).toBe(false);
    expect(state.user.avatarUrl).toBe(avatarReceipt.url);
    await page.reload();
    await expect(
      page.getByRole('complementary', { name: '个人资料摘要', exact: true }).getByRole('img'),
    ).toHaveAttribute('src', avatarReceipt.url);
    await editProfile(page);
    await panel.getByRole('button', { name: '清除头像', exact: true }).click();
    expect(uploads(requests)).toHaveLength(2);
    await panel.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(panel.getByText('个人资料已保存', { exact: true })).toBeVisible();
    expect(writes(requests).at(-1)?.body).toEqual({ avatarUrl: '' });
    expect(state.user.avatarUrl).toBeNull();
    expect(
      await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
    ).toEqual({ local: {}, session: {} });
  });
  test(`个人中心 ${mode} 头像类型大小本地拦截，换图清除取消不上传且释放预览`, async ({ page }) => {
    if (desktop)
      await page.addInitScript((apiBaseUrl) => {
        window.tydeDesktop = { getRuntimeConfig: async () => ({ ok: true, data: { apiBaseUrl } }) };
      }, origin);
    const { requests } = await profileBackend(page, origin);
    await openProfile(page, origin);
    await editProfile(page);
    const panel = page.getByRole('tabpanel', { name: '个人资料', exact: true });
    const fileInput = panel.getByLabel('上传本地头像', { exact: true });
    expect((await fileInput.getAttribute('accept'))?.split(',').sort()).toEqual(
      ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].sort(),
    );
    await panel.getByLabel('个人简介', { exact: true }).fill('校验未通过时不能保存的简介');
    for (const file of [
      { name: 'unsupported.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg />') },
      { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
      { name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
    ]) {
      await fileInput.setInputFiles(file);
      await expect(
        panel.getByText('请选择非空的 JPG、PNG、GIF、BMP 或 WebP 图片，最大 10 MiB', {
          exact: true,
        }),
      ).toBeVisible();
      await panel.getByRole('button', { name: '保存修改', exact: true }).click();
      expect(uploads(requests)).toHaveLength(0);
      expect(writes(requests)).toHaveLength(0);
    }
    await fileInput.setInputFiles({
      name: 'first.png',
      mimeType: 'image/png',
      buffer: avatarBytes,
    });
    const preview = panel.getByRole('img', { name: `${fixtureUser.nickname}的头像`, exact: true });
    await expect(preview).toHaveAttribute('src', /^blob:/);
    const firstPreview = (await preview.getAttribute('src'))!;
    expect(await blobIsReadable(page, firstPreview)).toBe(true);
    await fileInput.setInputFiles({
      name: 'second.png',
      mimeType: 'image/png',
      buffer: avatarBytes,
    });
    await expect(panel.getByText('待保存头像：second.png', { exact: true })).toBeVisible();
    await expect(preview).not.toHaveAttribute('src', firstPreview);
    const secondPreview = (await preview.getAttribute('src'))!;
    await expect.poll(() => blobIsReadable(page, firstPreview)).toBe(false);
    expect(await blobIsReadable(page, secondPreview)).toBe(true);
    await panel.getByRole('button', { name: '清除头像', exact: true }).click();
    await expect(panel.locator('img[src^="blob:"]')).toHaveCount(0);
    await expect.poll(() => blobIsReadable(page, secondPreview)).toBe(false);
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    await editProfile(page);
    await fileInput.setInputFiles({
      name: 'cancelled.png',
      mimeType: 'image/png',
      buffer: avatarBytes,
    });
    await expect(preview).toHaveAttribute('src', /^blob:/);
    const cancelledPreview = (await preview.getAttribute('src'))!;
    await panel.getByRole('button', { name: '取消', exact: true }).click();
    await expect.poll(() => blobIsReadable(page, cancelledPreview)).toBe(false);
    expect(uploads(requests)).toHaveLength(0);
    expect(writes(requests)).toHaveLength(0);
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
    { width: 320, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('tab', { name: '概览', exact: true }).click();
    const expertTabs = page.getByRole('tablist', { name: '执行专家个人中心业务', exact: true });
    await expect(expertTabs).toBeVisible();
    await expect(expertTabs.getByRole('tab')).toHaveText(['我的项目', '排班考勤', '组织与申请']);
    await expect(page.getByText('示例数据', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await editProfile(page);
    const avatar = page.getByRole('region', { name: '头像设置', exact: true });
    await expect(avatar).toBeVisible();
    const fileInput = avatar.getByLabel('上传本地头像', { exact: true });
    await expect(fileInput).toHaveAttribute('hidden', '');
    await expect(fileInput).not.toBeVisible();
    await expect(avatar.getByText(fixtureUser.nickname.slice(0, 1), { exact: true })).toBeVisible();
    for (const name of ['更换头像', '清除头像']) {
      const button = avatar.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(avatar.getByRole('button', { name: '使用图片链接', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(avatar.getByLabel('头像地址', { exact: true })).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    if (viewport.width === 1280 || viewport.width === 375) {
      await avatar.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `artifacts/profile-avatar-${viewport.width === 1280 ? 'desktop' : 'mobile'}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    await avatarLinkInput(page);
    await expect(avatar.getByRole('button', { name: '预览头像', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole('button', { name: '取消', exact: true }).click();
  }
});
