import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { AuthUser, OrganizationDetail } from '../../packages/shared/src/index';

const origin = 'http://127.0.0.1:5176';
const orgId = '00000000-0000-4000-8000-000000000121';
const timestamp = '2026-10-22T02:00:00.000Z';
const roles = ['NAVIGATOR', 'PM', 'EXPERT'] as const;
const picture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);
const licenseReceipt = {
  objectKey: 'business-license/2026/10/22/0123456789abcdef0123456789abcdef.png',
  uploadToken: 'u'.repeat(43),
  url: null,
  sensitive: true,
  fileName: 'business-license.png',
  extension: 'png',
  size: picture.length,
  contentType: 'image/png',
  fileHash: createHash('sha256').update(picture).digest('hex'),
};

const initialUser: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  uid: 'CREATE10001',
  accountType: 'INDIVIDUAL',
  phone: '138****0001',
  nickname: '创建联调用户',
  realName: '测试用户',
  idCardNo: null,
  idVerified: 0,
  avatarUrl: null,
  bio: null,
  role: 'EXPERT',
  roles: [...roles],
  selectedRole: 'EXPERT',
  hasExpertManagementRole: false,
  status: 'ACTIVE',
  creditScore: 100,
  lastLoginAt: null,
  lastLoginIp: null,
  organization: null,
  organizations: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};

interface RequestLog {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
  form: Record<string, string>;
  fileName?: string;
}

async function createBackend(
  page: Page,
  desktop = false,
  selectedRole: 'EXPERT' | 'PM' = 'EXPERT',
  holdUpload = false,
) {
  if (desktop)
    await page.addInitScript((apiBaseUrl) => {
      window.tydeDesktop = { getRuntimeConfig: async () => ({ ok: true, data: { apiBaseUrl } }) };
    }, origin);
  await page
    .context()
    .addCookies([
      { name: 'create_session', value: 'active', url: origin, httpOnly: true, sameSite: 'Lax' },
    ]);
  const state = {
    user: { ...structuredClone(initialUser), role: selectedRole, selectedRole },
    organization: null as OrganizationDetail | null,
    createStatus: 200,
    sessionReads: 0,
  };
  const requests: RequestLog[] = [];
  const pendingUpload: { release?: () => Promise<void> } = {};
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = await request.allHeaders();
    const body = headers['content-type']?.includes('application/json')
      ? (request.postDataJSON() as Record<string, unknown>)
      : null;
    const entry: RequestLog = { path, method: request.method(), body, headers, form: {} };
    if (headers['content-type']?.includes('multipart/form-data')) {
      const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(headers['content-type']);
      for (const part of (request.postDataBuffer()?.toString('latin1') ?? '').split(
        `--${boundary?.[1] ?? boundary?.[2]}`,
      )) {
        const name = /name="([^"]+)"/.exec(part)?.[1];
        const start = part.indexOf('\r\n\r\n');
        if (!name || start < 0) continue;
        entry.form[name] = part.slice(start + 4).replace(/\r\n$/, '');
        const fileName = /filename="([^"]+)"/.exec(part)?.[1];
        if (fileName) entry.fileName = fileName;
      }
    }
    requests.push(entry);
    const reply = (data: unknown, status = 200, message = '操作成功') =>
      route.fulfill({ status, json: { code: status, message, data } });
    if (!headers.cookie?.includes('create_session=active')) return reply(null, 401, '请先登录');
    if (path === '/api/v1/users/me' && request.method() === 'GET') {
      state.sessionReads += 1;
      return reply(state.user);
    }
    if (path === '/api/v1/auth/switch-role' && request.method() === 'POST') {
      if (body?.role !== 'EXPERT') return reply(null, 400, '角色无效');
      state.user.role = 'EXPERT';
      state.user.selectedRole = 'EXPERT';
      return reply({ selectedRole: 'EXPERT', roles: [...roles] });
    }
    if (path === '/api/v1/files/upload' && request.method() === 'POST') {
      if (!holdUpload) return reply(licenseReceipt);
      return new Promise<void>((resolve, reject) => {
        pendingUpload.release = async () => {
          try {
            await reply(licenseReceipt);
            resolve();
          } catch (error) {
            reject(error);
          }
        };
      });
    }
    if (path === '/api/v1/organizations' && request.method() === 'POST') {
      if (state.user.selectedRole !== 'EXPERT')
        return reply(null, 403, '请切换到执行专家角色创建组织');
      if (state.createStatus === 409) return reply(null, 409, '组织名称或统一社会信用代码已被占用');
      state.organization = {
        id: orgId,
        name: String(body?.name),
        unifiedCreditCode: body?.unifiedCreditCode ? String(body.unifiedCreditCode) : null,
        description: body?.description ? String(body.description) : null,
        businessLicenseUrl: body?.businessLicense ? licenseReceipt.objectKey : null,
        logoUrl: body?.logoUrl ? String(body.logoUrl) : null,
        expertiseTags: Array.isArray(body?.expertiseTags) ? body.expertiseTags.map(String) : [],
        verifyStatus: 'APPROVED',
        status: 'ACTIVE',
        position: 'OWNER',
        createdAt: timestamp,
      };
      state.user.organization = { ...state.organization, joinStatus: 'ACTIVE' };
      state.user.organizations = [
        {
          id: orgId,
          name: state.organization.name,
          position: 'OWNER',
          joinStatus: 'ACTIVE',
          status: 'ACTIVE',
          verifyStatus: 'APPROVED',
        },
      ];
      return reply(state.organization);
    }
    if (path === '/api/v1/organizations' && request.method() === 'GET')
      return reply(state.organization);
    if (path === '/api/v1/organizations/members')
      return reply({ total: 0, pages: 0, current: 1, size: 20, records: [] });
    if (path === '/api/v1/organizations/approvals/pending')
      return reply({ total: 0, pages: 0, current: 1, size: 20, records: [] });
    return reply(null, 404, '未匹配接口');
  });
  return {
    state,
    requests,
    releaseUpload: async () => {
      if (!pendingUpload.release) throw new Error('没有等待中的营业执照上传');
      await pendingUpload.release();
    },
  };
}

const calls = (requests: RequestLog[], path: string, method = 'POST') =>
  requests.filter((request) => request.path === path && request.method === method);

async function openCreate(page: Page) {
  await page.goto(`${origin}/#/organization`);
  await expect(page.getByRole('heading', { name: '还没有组织' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: '创建组织', exact: true }).click();
  await expect(page).toHaveURL(/#\/organization\/create$/);
  await expect(page.getByRole('heading', { name: '创建组织', exact: true })).toBeVisible();
}

test('无组织空状态进入创建页，未请求无权读取的组织详情', async ({ page }) => {
  const { requests } = await createBackend(page);
  await openCreate(page);
  expect(calls(requests, '/api/v1/organizations', 'GET')).toHaveLength(0);
  expect(calls(requests, '/api/v1/organizations')).toHaveLength(0);
  await expect(page.getByLabel('组织名称')).toBeVisible();
});

for (const [mode, desktop] of [
  ['Web', false],
  ['Electron 配置', true],
] as const) {
  test(`${mode} 创建最小组织，更新会话并进入组织管理`, async ({ page }) => {
    const { state, requests } = await createBackend(page, desktop);
    await openCreate(page);
    await page.getByLabel('组织名称').fill('  新建联调组织  ');
    await page.locator('form').getByRole('button', { name: '创建组织', exact: true }).click();
    await expect(page).toHaveURL(/#\/organization$/);
    await expect(page.getByRole('heading', { name: '组织管理', exact: true })).toBeVisible();
    await expect(page.getByText('新建联调组织', { exact: true }).first()).toBeVisible();
    const createRequests = calls(requests, '/api/v1/organizations');
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]?.body).toEqual({ name: '新建联调组织' });
    expect(createRequests[0]?.headers.cookie).toContain('create_session=active');
    expect(createRequests[0]?.headers['x-tyde-client']).toBe('web');
    expect(state.sessionReads).toBeGreaterThan(1);
  });
}

test('创建冲突保留草稿，仅在手动重试时再次提交', async ({ page }) => {
  const { state, requests } = await createBackend(page);
  state.createStatus = 409;
  await openCreate(page);
  await page.getByLabel('组织名称').fill('待确认的组织');
  await page.getByLabel('组织简介').fill('保留这段草稿');
  await page.locator('form').getByRole('button', { name: '创建组织', exact: true }).click();
  await expect(page.getByText('组织名称或统一社会信用代码已被占用')).toBeVisible();
  await expect(page.getByLabel('组织名称')).toHaveValue('待确认的组织');
  await expect(page.getByLabel('组织简介')).toHaveValue('保留这段草稿');
  expect(calls(requests, '/api/v1/organizations')).toHaveLength(1);
  state.createStatus = 200;
  await page.getByLabel('组织名称').fill('手动重试的组织');
  await page.locator('form').getByRole('button', { name: '创建组织', exact: true }).click();
  await expect(page).toHaveURL(/#\/organization$/);
  expect(calls(requests, '/api/v1/organizations')).toHaveLength(2);
});

test('非执行专家不能直接访问创建页，顶栏切换真实角色后再创建', async ({ page }) => {
  const { requests } = await createBackend(page, false, 'PM');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/#/organization/create`);
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: '策略官工作台', exact: true })).toBeVisible();
  await expect(page.getByLabel('组织名称')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^(我的组织|组织管理|创建组织)$/ })).toHaveCount(0);
  expect(calls(requests, '/api/v1/organizations')).toHaveLength(0);
  await page.getByRole('combobox', { name: '当前角色', exact: true }).click();
  await page.getByRole('option', { name: '执行专家', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '当前角色', exact: true })).toContainText(
    '执行专家',
  );
  expect(calls(requests, '/api/v1/auth/switch-role')).toHaveLength(1);
  expect(calls(requests, '/api/v1/auth/switch-role')[0]?.body).toEqual({ role: 'EXPERT' });
  await openCreate(page);
  await page.getByLabel('组织名称').fill('切换后创建的组织');
  await page.locator('form').getByRole('button', { name: '创建组织', exact: true }).click();
  await expect(page).toHaveURL(/#\/organization$/);
  expect(calls(requests, '/api/v1/organizations')).toHaveLength(1);
});

test('营业执照只上传一次，创建冲突后手动重试复用认领凭证', async ({ page }) => {
  const { state, requests } = await createBackend(page);
  state.createStatus = 409;
  await openCreate(page);
  await page.getByLabel('组织名称').fill('带营业执照的组织');
  await page.locator('input[type=file]').setInputFiles({
    name: licenseReceipt.fileName,
    mimeType: 'image/png',
    buffer: picture,
  });
  await page.locator('form').getByRole('button', { name: '创建组织', exact: true }).click();
  await expect(page.getByText('组织名称或统一社会信用代码已被占用')).toBeVisible();
  expect(calls(requests, '/api/v1/files/upload')).toHaveLength(1);
  expect(calls(requests, '/api/v1/files/upload')[0]?.form.bizType).toBe('BUSINESS_LICENSE');
  expect(calls(requests, '/api/v1/files/upload')[0]?.fileName).toBe(licenseReceipt.fileName);
  const firstCreate = calls(requests, '/api/v1/organizations')[0];
  expect(firstCreate?.body?.businessLicense).toEqual({
    objectKey: licenseReceipt.objectKey,
    uploadToken: licenseReceipt.uploadToken,
  });
  state.createStatus = 200;
  await page.locator('form').getByRole('button', { name: '创建组织', exact: true }).click();
  await expect(page).toHaveURL(/#\/organization$/);
  expect(calls(requests, '/api/v1/files/upload')).toHaveLength(1);
  expect(calls(requests, '/api/v1/organizations')).toHaveLength(2);
  expect(calls(requests, '/api/v1/organizations')[1]?.body?.businessLicense).toEqual(
    firstCreate?.body?.businessLicense,
  );
});

test('营业执照上传等待期间离开页面，返回上传结果后不再创建或跳回', async ({ page }) => {
  const { requests, releaseUpload } = await createBackend(page, false, 'EXPERT', true);
  await openCreate(page);
  await page.getByLabel('组织名称').fill('离开页面后不应创建');
  await page.locator('input[type=file]').setInputFiles({
    name: licenseReceipt.fileName,
    mimeType: 'image/png',
    buffer: picture,
  });
  await page.locator('form').getByRole('button', { name: '创建组织', exact: true }).click();
  await expect.poll(() => calls(requests, '/api/v1/files/upload').length).toBe(1);
  expect(calls(requests, '/api/v1/organizations')).toHaveLength(0);
  await page.getByRole('link', { name: '返回我的组织' }).click();
  await expect(page).toHaveURL(/#\/organization$/);
  await releaseUpload();
  await page.waitForTimeout(200);
  expect(calls(requests, '/api/v1/organizations')).toHaveLength(0);
  await expect(page).toHaveURL(/#\/organization$/);
  await expect(page.getByRole('heading', { name: '还没有组织' })).toBeVisible();
});

test('错误格式的营业执照可清除，随后只凭组织名称创建', async ({ page }) => {
  const { requests } = await createBackend(page);
  await openCreate(page);
  await page.getByLabel('组织名称').fill('清除无效文件后的组织');
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(page.getByText('请选择 JPG、PNG、GIF、BMP 或 WebP 图片')).toBeVisible();
  await expect(
    page.locator('form').getByRole('button', { name: '创建组织', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '清除营业执照选择' }).click();
  await expect(page.getByText('请选择 JPG、PNG、GIF、BMP 或 WebP 图片')).not.toBeVisible();
  await page.locator('form').getByRole('button', { name: '创建组织', exact: true }).click();
  await expect(page).toHaveURL(/#\/organization$/);
  expect(calls(requests, '/api/v1/files/upload')).toHaveLength(0);
  expect(calls(requests, '/api/v1/organizations')[0]?.body).toEqual({
    name: '清除无效文件后的组织',
  });
});

test('窄屏创建页控件可见且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await createBackend(page);
  await openCreate(page);
  await expect(page.getByLabel('组织名称')).toBeVisible();
  await expect(
    page.locator('form').getByRole('button', { name: '创建组织', exact: true }),
  ).toBeVisible();
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
});
