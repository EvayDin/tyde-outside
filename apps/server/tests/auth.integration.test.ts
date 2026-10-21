import {
  ProjectProductionPlanService,
  type ProductionPlanInput,
} from '../src/modules/projects/project-production-plan.service.js';
import { productionPlanExample } from '../src/modules/projects/project-production-plan.schema.js';
import * as XLSX from 'xlsx';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { MemberImportService } from '../src/modules/organizations/member-import.service.js';
import { ApprovalService } from '../src/modules/approval/approval.service.js';
import { DepartureService, shanghaiDay } from '../src/modules/organizations/departure.service.js';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { FileRegistryService } from '../src/modules/files/file-registry.service.js';
import { Readable } from 'node:stream';
import type { ObjectStorage } from '../src/modules/files/object-storage.js';
import { createApp } from '../src/application.js';
import { readConfig } from '../src/config/index.js';
import { digest } from '../src/modules/auth/security.js';
import { ManagementService } from '../src/modules/management/management.service.js';
import { ProjectManagerService } from '../src/modules/projects/project-manager.service.js';
import { ProjectCreationService } from '../src/modules/projects/project-creation.service.js';
const testEnv = parseEnv(readFileSync(new URL('../.env.test', import.meta.url), 'utf8'));
const config = readConfig(testEnv);
if (
  config.env !== 'test' ||
  !new URL(config.databaseUrl).pathname.endsWith('_test') ||
  testEnv.TEST_DATABASE_RESET !== 'true'
)
  throw new Error('集成测试只能连接允许清空的专用 _test 数据库');
const db = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
const objects = new Map<string, Buffer>();
const storage: ObjectStorage = {
  async put(key, content) {
    objects.set(key, content);
  },
  async head(key) {
    const content = objects.get(key);
    return content ? { size: content.length } : null;
  },
  async open(key) {
    const content = objects.get(key);
    if (!content) throw new Error('missing');
    return { stream: Readable.from(content), size: content.length, contentType: 'image/png' };
  },
  async delete(key) {
    objects.delete(key);
  },
  accessUrl(key) {
    return `https://storage.example/${key}`;
  },
};
const registry = new FileRegistryService(db, storage, config.files);
const app = await createApp(config, db, undefined, storage);
const web = { origin: config.webOrigins[0]!, 'x-tyde-client': 'web' };
const desktop = { 'x-tyde-client': 'desktop' };
beforeEach(async () => {
  objects.clear();
  await db.$executeRawUnsafe(
    'TRUNCATE "EntranceExamGradingRound", "ProjectCategory", "MemberImportReceipt", "ApprovalActionLog", "ApprovalNode", "ApprovalFlow", "OrganizationDeparture", "UploadedFile", "AuthRateLimit", "Session", "RegistrationGrant", "VerificationChallenge", "User", "Organization" CASCADE',
  );
});
afterAll(async () => app.close());
const phone = '13812345678';
const registration = {
  accountType: 'INDIVIDUAL',
  phone,
  code: '095270',
  password: 'Password123',
  confirmPassword: 'Password123',
  realName: '小明',
  email: 'test@example.com',
};
async function post(path: string, payload?: unknown, headers: Record<string, string> = web) {
  return app.inject({ method: 'POST', url: `/api/v1${path}`, payload, headers });
}
async function send(scene: string, value = phone) {
  await db.verificationChallenge.updateMany({
    where: { phoneE164: `+86${value}` },
    data: { createdAt: new Date(Date.now() - 61_000) },
  });
  const response = await post('/auth/sms/send', { phone: value, scene });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toBe('验证码已发送，请注意查收');
}
async function register(extra = {}) {
  await send('register');
  const result = await post('/auth/register', { ...registration, ...extra });
  expect(result.statusCode).toBe(200);
  return result;
}
async function login(headers = web, extra = {}) {
  const result = await post(
    '/auth/login',
    { account: phone, password: 'Password123', ...extra },
    headers,
  );
  expect(result.statusCode).toBe(200);
  return result;
}
const bearer = (token: string) => ({ ...desktop, authorization: `Bearer ${token}` });
test('legacy registration fields, fixed EXPERT, password login by phone/email/uid and cookie recovery', async () => {
  const created = await register({ roles: ['OPS', 'NAVIGATOR'] });
  expect(created.json().data).toMatchObject({
    role: 'EXPERT',
    roles: ['EXPERT'],
    nickname: '小明',
    realName: '小明',
    phone: '138****5678',
  });
  expect(created.cookies).toHaveLength(0);
  const row = await db.user.findFirstOrThrow();
  expect(row.passwordHash).not.toContain('Password123');
  expect(row.role).toBe('EXPERT');
  for (const account of [phone, 'TEST@example.com', row.uid]) {
    const logged = await login(web, { account, role: 'OPS' });
    expect(Object.keys(logged.json().data).sort()).toEqual(
      ['accessToken', 'refreshToken', 'tokenType', 'expiresIn'].sort(),
    );
    const cookie = logged.cookies[0]!;
    const me = await app.inject({
      url: '/api/v1/users/me',
      headers: { ...web, cookie: `${cookie.name}=${cookie.value}` },
    });
    expect(me.json().data.selectedRole).toBe('EXPERT');
    expect(cookie.httpOnly).toBe(true);
  }
});
test('SMS scenes are isolated; successful login consumes code and unknown phones do not auto-register', async () => {
  await register();
  await send('register');
  expect((await post('/auth/sms/login', { phone, code: '095270' })).statusCode).toBe(400);
  await send('login');
  const result = await post('/auth/sms/login', { phone, code: '095270' }, desktop);
  expect(result.statusCode).toBe(200);
  expect((await post('/auth/sms/login', { phone, code: '095270' })).statusCode).toBe(400);
  await send('login', '13912345678');
  expect((await post('/auth/sms/login', { phone: '13912345678', code: '095270' })).statusCode).toBe(
    200,
  );
  expect(await db.user.count()).toBe(1);
});
test('wrong attempts persist, expired code and concurrent registration replay fail', async () => {
  await send('login');
  for (let i = 0; i < 5; i++)
    expect((await post('/auth/sms/login', { phone, code: '000000' })).statusCode).toBe(400);
  expect((await post('/auth/sms/login', { phone, code: '095270' })).statusCode).toBe(429);
  expect((await db.verificationChallenge.findFirstOrThrow()).failedAttempts).toBe(5);
  await send('register');
  const results = await Promise.all([
    post('/auth/register', registration),
    post('/auth/register', registration),
  ]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 400]);
  expect(await db.user.count()).toBe(1);
  await send('login');
  await db.verificationChallenge.updateMany({ data: { expiresAt: new Date(0) } });
  expect((await post('/auth/sms/login', { phone, code: '095270' })).statusCode).toBe(400);
});
test('refresh rotates once; logout revokes access and refresh for current client only', async () => {
  await register();
  const webLogin = await login();
  const logged = await login(desktop);
  const tokens = logged.json().data;
  const responses = await Promise.all([
    post('/auth/refresh', { refreshToken: tokens.refreshToken }, desktop),
    post('/auth/refresh', { refreshToken: tokens.refreshToken }, desktop),
  ]);
  expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 401]);
  const rotated = responses.find((response) => response.statusCode === 200)!.json().data;
  expect(
    (await app.inject({ url: '/api/v1/users/me', headers: bearer(tokens.accessToken) })).statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ url: '/api/v1/users/me', headers: bearer(rotated.accessToken) }))
      .statusCode,
  ).toBe(200);
  await post('/auth/logout', undefined, bearer(rotated.accessToken));
  expect(
    (await post('/auth/refresh', { refreshToken: rotated.refreshToken }, desktop)).statusCode,
  ).toBe(401);
  const cookie = webLogin.cookies[0]!;
  expect(
    (
      await app.inject({
        url: '/api/v1/users/me',
        headers: { ...web, cookie: `${cookie.name}=${cookie.value}` },
      })
    ).statusCode,
  ).toBe(200);
});
test('password reset revokes all clients and old password, including refresh tokens', async () => {
  await register();
  const a = (await login()).json().data;
  const b = (await login(desktop)).json().data;
  await send('reset_password');
  expect(
    (await post('/auth/password/reset', { phone, code: '095270', newPassword: 'Changed123' }))
      .statusCode,
  ).toBe(200);
  expect((await post('/auth/login', { account: phone, password: 'Password123' })).statusCode).toBe(
    401,
  );
  expect((await post('/auth/refresh', { refreshToken: a.refreshToken })).statusCode).toBe(401);
  expect((await post('/auth/refresh', { refreshToken: b.refreshToken }, desktop)).statusCode).toBe(
    401,
  );
  expect(
    (await db.session.findUniqueOrThrow({ where: { tokenDigest: digest(b.accessToken) } }))
      .revokedAt,
  ).not.toBeNull();
  await login(web, { password: 'Changed123' });
});
test('registration validates confirmation/duplicates, and organization fields persist atomically', async () => {
  await send('register');
  expect(
    (await post('/auth/register', { ...registration, confirmPassword: 'Wrong123' })).statusCode,
  ).toBe(400);
  expect(
    (await post('/auth/register', { ...registration, accountType: 'ORGANIZATION' })).statusCode,
  ).toBe(400);
  const org = await post('/auth/register', {
    ...registration,
    accountType: 'ORGANIZATION',
    organization: { name: '测试组织', expertiseTags: ['标注'] },
  });
  expect(org.statusCode).toBe(200);
  expect(org.json().data.organization).toMatchObject({
    name: '测试组织',
    position: 'OWNER',
    expertiseTags: ['标注'],
  });
  await send('register');
  expect((await post('/auth/register', registration)).statusCode).toBe(409);
  expect(await db.user.count()).toBe(1);
  expect(await db.organization.count()).toBe(1);
});
test('cooldown spans scenes, transport spoofing and client-bound token use are rejected', async () => {
  await send('register');
  const limited = await post('/auth/sms/send', { phone, scene: 'login' });
  expect(limited.statusCode).toBe(429);
  expect(limited.json().code).toBe(4292);
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(
    (await post('/auth/sms/send', { phone, scene: 'login' }, { ...desktop, origin: web.origin }))
      .statusCode,
  ).toBe(403);
  expect((await app.inject({ url: '/api/v1/users/me', headers: web })).statusCode).toBe(401);
});

test('concurrent SMS login consumes the challenge only once and tokens stay bound to the client', async () => {
  await register();
  await send('login');
  const results = await Promise.all([
    post('/auth/sms/login', { phone, code: '095270' }, desktop),
    post('/auth/sms/login', { phone, code: '095270' }, desktop),
  ]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 400]);
  expect(await db.session.count()).toBe(1);
  const tokens = results.find((result) => result.statusCode === 200)!.json().data;
  expect((await post('/auth/refresh', { refreshToken: tokens.refreshToken }, web)).statusCode).toBe(
    401,
  );
  expect(
    (
      await app.inject({
        url: '/api/v1/users/me',
        headers: { ...web, cookie: `tyde_session=${tokens.accessToken}` },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ url: '/api/v1/users/me', headers: bearer(tokens.accessToken) })).statusCode,
  ).toBe(200);
});

test('organization creation and code consumption roll back when user uniqueness fails', async () => {
  await register();
  const otherPhone = '13912345678';
  await send('register', otherPhone);
  const result = await post('/auth/register', {
    ...registration,
    phone: otherPhone,
    accountType: 'ORGANIZATION',
    organization: { name: '应回滚的组织' },
  });
  expect(result.statusCode).toBe(409);
  expect(await db.organization.count()).toBe(0);
  expect(await db.user.count()).toBe(1);
  expect(
    (
      await db.verificationChallenge.findFirstOrThrow({
        where: { phoneE164: `+86${otherPhone}`, purpose: 'register' },
      })
    ).consumedAt,
  ).toBeNull();
  expect(
    (
      await post('/auth/register', {
        ...registration,
        phone: otherPhone,
        email: 'other@example.com',
        nickname: '其他用户',
      })
    ).statusCode,
  ).toBe(200);
});

test('disabled users cannot log in, access profiles or refresh existing sessions', async () => {
  await register();
  const tokens = (await login(desktop)).json().data;
  await db.user.updateMany({ data: { status: 'BANNED' } });
  expect(
    (await post('/auth/login', { account: phone, password: 'Password123' }, desktop)).statusCode,
  ).toBe(403);
  await send('login');
  expect((await post('/auth/sms/login', { phone, code: '095270' }, desktop)).statusCode).toBe(403);
  expect(
    (await app.inject({ url: '/api/v1/users/me', headers: bearer(tokens.accessToken) })).statusCode,
  ).toBe(401);
  expect(
    (await post('/auth/refresh', { refreshToken: tokens.refreshToken }, desktop)).statusCode,
  ).toBe(403);
  expect(await db.session.count()).toBe(1);
});

async function uploaded(
  bizType:
    'BUSINESS_LICENSE' | 'PROJECT_ATTACHMENT' | 'ENTRANCE_EXAM_ATTACHMENT' = 'BUSINESS_LICENSE',
  ownerUid: string | null = null,
) {
  const key = `${bizType === 'BUSINESS_LICENSE' ? 'business-license' : bizType === 'PROJECT_ATTACHMENT' ? 'project-attachment' : 'entrance-exam-attachment'}/2026/10/16/test.png`;
  const content = Buffer.from('test-image');
  await storage.put(key, content, 'image/png');
  return registry.register(
    {
      objectKey: key,
      fileName: 'test.png',
      extension: 'png',
      contentType: 'image/png',
      fileSize: content.length,
      fileHash: 'a'.repeat(64),
    },
    bizType,
    'IMAGE',
    ownerUid,
  );
}
test('organization registration claims anonymous license atomically and returns key without exposing URL/token', async () => {
  const { record, uploadToken } = await uploaded();
  expect(record.claimTokenHash).not.toBe(uploadToken);
  const result = await register({
    accountType: 'ORGANIZATION',
    organization: { name: '组织一', businessLicense: { objectKey: record.objectKey, uploadToken } },
  });
  const user = result.json().data;
  expect(user.organization.businessLicenseUrl).toBe(record.objectKey);
  expect(JSON.stringify(user)).not.toContain(uploadToken);
  expect(await db.uploadedFile.findUniqueOrThrow({ where: { id: record.id } })).toMatchObject({
    status: 'CLAIMED',
    claimedBizId: user.organization.id,
    expiresAt: null,
  });
  await expect(
    db.$transaction((tx) =>
      registry.claimForOrganizationRegistration(
        tx,
        record.objectKey,
        uploadToken,
        user.organization.id,
      ),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
test.each(['token', 'expired', 'missing-object', 'size', 'wrong-biz', 'duplicate-user'])(
  'license %s failure rolls back organization, user, code and file claim',
  async (mode) => {
    const { record, uploadToken } = await uploaded(
      mode === 'wrong-biz' ? 'PROJECT_ATTACHMENT' : 'BUSINESS_LICENSE',
    );
    if (mode === 'expired')
      await db.uploadedFile.update({ where: { id: record.id }, data: { expiresAt: new Date(0) } });
    if (mode === 'missing-object') objects.clear();
    if (mode === 'size') {
      const mismatchedContent = Buffer.alloc(record.fileSize + 1);
      objects.set(record.objectKey, mismatchedContent);
    }
    if (mode === 'duplicate-user')
      await db.user.create({
        data: {
          phoneE164: '+8613912345678',
          phoneRegion: 'CN',
          username: 'existing',
          displayName: '重复',
          email: registration.email,
        },
      });
    await send('register');
    const response = await post('/auth/register', {
      ...registration,
      accountType: 'ORGANIZATION',
      organization: {
        name: '回滚组织',
        businessLicense: {
          objectKey: record.objectKey,
          uploadToken: mode === 'token' ? 'wrong' : uploadToken,
        },
      },
    });
    expect(response.statusCode).toBe(
      mode === 'token' ? 403 : ['expired', 'duplicate-user'].includes(mode) ? 409 : 400,
    );
    expect(await db.organization.count()).toBe(0);
    expect(await db.user.count({ where: { phoneE164: '+86' + phone } })).toBe(0);
    expect((await db.verificationChallenge.findFirstOrThrow()).consumedAt).toBeNull();
    expect((await db.uploadedFile.findUniqueOrThrow({ where: { id: record.id } })).status).toBe(
      'UPLOADED',
    );
  },
);
test('concurrent license replay has exactly one winner', async () => {
  const { record, uploadToken } = await uploaded();
  const org = await db.organization.create({ data: { name: '并发组织', expertiseTags: [] } });
  const result = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      db.$transaction((tx) =>
        registry.claimForOrganizationRegistration(tx, record.objectKey, uploadToken, org.id),
      ),
    ),
  );
  expect(result.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  for (const item of result)
    if (item.status === 'rejected') expect(item.reason).toMatchObject({ status: 409 });
});
test('business claim requires owner, rejects common type and prevents deletion after claim', async () => {
  const { record, uploadToken } = await uploaded('PROJECT_ATTACHMENT', 'owner');
  const id = '00000000-0000-4000-8000-000000000001';
  await expect(
    db.$transaction((tx) =>
      registry.claimForProject(tx, record.objectKey, uploadToken, 'other', id),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(registry.deleteOwnedUnclaimed(record.objectKey, 'other')).rejects.toMatchObject({
    status: 403,
  });
  await db.$transaction((tx) =>
    registry.claimForProject(tx, record.objectKey, uploadToken, 'owner', id),
  );
  await expect(registry.deleteOwnedUnclaimed(record.objectKey, 'owner')).rejects.toMatchObject({
    status: 403,
  });
  await db.$transaction((tx) => registry.releaseProjectAttachment(tx, record.objectKey, id));
  expect((await db.uploadedFile.findUniqueOrThrow({ where: { id: record.id } })).status).toBe(
    'RELEASED',
  );
});
test('cleanup removes expired objects but preserves active and claimed files', async () => {
  const { record } = await uploaded();
  expect(await registry.cleanupExpired()).toEqual({ deleted: 0, failed: 0 });
  await db.uploadedFile.update({ where: { id: record.id }, data: { expiresAt: new Date(0) } });
  expect(await registry.cleanupExpired()).toEqual({ deleted: 1, failed: 0 });
  expect(objects.size).toBe(0);
  expect(await db.uploadedFile.count()).toBe(0);
});
test('delete and claim share row locks so claimed object cannot be deleted', async () => {
  const { record, uploadToken } = await uploaded('PROJECT_ATTACHMENT', 'owner');
  const id = '00000000-0000-4000-8000-000000000001';
  const result = await Promise.allSettled([
    db.$transaction((tx) =>
      registry.claimForProject(tx, record.objectKey, uploadToken, 'owner', id),
    ),
    registry.deleteOwnedUnclaimed(record.objectKey, 'owner'),
  ]);
  expect(result.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const file = await db.uploadedFile.findUniqueOrThrow({ where: { id: record.id } });
  expect(objects.has(record.objectKey)).toBe(file.status === 'CLAIMED');
});

function multipartPayload(
  parts: { name: string; fileName?: string; contentType?: string; content: Buffer | string }[],
) {
  const boundary = 'tyde-file-test-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const filename = part.fileName ? `; filename="${part.fileName}"` : '';
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${filename}\r\n${part.contentType ? `Content-Type: ${part.contentType}\r\n` : ''}\r\n`,
      ),
      Buffer.from(part.content),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const imagePart = (name = 'file') => ({
  name,
  fileName: 'test.png',
  contentType: 'image/png',
  content: png,
});
async function uploadHttp(parts = [imagePart()], headers = {}, batch = false) {
  const form = multipartPayload(parts);
  return app.inject({
    method: 'POST',
    url: `/api/v1/files/upload${batch ? '/batch' : ''}`,
    payload: form.payload,
    headers: { ...form.headers, ...headers },
  });
}
test('HTTP anonymous license upload -> organization registration -> authorized proxy view without a signed URL', async () => {
  const uploaded = await uploadHttp([
    imagePart(),
    { name: 'bizType', content: 'business_license' },
  ]);
  expect(uploaded.statusCode, uploaded.body).toBe(200);
  const file = uploaded.json().data;
  expect(file).toMatchObject({
    url: null,
    sensitive: true,
    extension: 'png',
    contentType: 'image/png',
    size: png.length,
  });
  expect(file.fileHash).toMatch(/^[a-f0-9]{64}$/);
  expect(file.uploadToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect((await app.inject(`/api/v1/files/view?objectKey=${file.objectKey}`)).statusCode).toBe(403);
  await register({
    accountType: 'ORGANIZATION',
    organization: {
      name: '上传闭环组织',
      businessLicense: { objectKey: file.objectKey, uploadToken: file.uploadToken },
    },
  });
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const viewed = await app.inject({
    url: `/api/v1/files/view?objectKey=${file.objectKey}`,
    headers,
  });
  expect(viewed.statusCode).toBe(200);
  expect(viewed.rawPayload.equals(png)).toBe(true);
  expect(viewed.headers).toMatchObject({
    'content-type': 'image/png',
    'content-disposition': 'inline',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store, private',
  });
  expect(
    (await app.inject({ url: `/api/v1/files/access-url?objectKey=${file.objectKey}`, headers }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/files?objectKey=${file.objectKey}`,
        headers,
      })
    ).statusCode,
  ).toBe(403);
});
test('HTTP owned sensitive file denies other user and deletion is once-only', async () => {
  await register();
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const response = await uploadHttp(
    [imagePart(), { name: 'bizType', content: 'ID_CARD' }],
    headers,
  );
  expect(response.statusCode, response.body).toBe(200);
  const key = response.json().data.objectKey;
  await send('register', '13912345678');
  expect(
    (
      await post(
        '/auth/register',
        { ...registration, phone: '13912345678', email: 'other@example.com', nickname: '其他用户' },
        desktop,
      )
    ).statusCode,
  ).toBe(200);
  const otherLogin = await post(
    '/auth/login',
    { account: '13912345678', password: registration.password },
    desktop,
  );
  const other = bearer(otherLogin.json().data.accessToken);
  expect(
    (await app.inject({ url: `/api/v1/files/view?objectKey=${key}`, headers: other })).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/v1/files?objectKey=${key}`, headers: other }))
      .statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ url: `/api/v1/files/view?objectKey=${key}`, headers })).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/v1/files?objectKey=${key}`, headers })).json()
      .data,
  ).toBe(true);
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/v1/files?objectKey=${key}`, headers }))
      .statusCode,
  ).toBe(403);
  expect(objects.has(key)).toBe(false);
});
test('HTTP non-sensitive URL preserves image expiry semantics and rejects sensitive paths', async () => {
  await register();
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const response = await uploadHttp([imagePart()], headers);
  expect(response.statusCode, response.body).toBe(200);
  const key = response.json().data.objectKey;
  expect(response.json().data.url).toContain('https://');
  const access = await app.inject({
    url: `/api/v1/files/access-url?objectKey=${key}&expireSeconds=3600`,
    headers,
  });
  expect(access.statusCode, access.body).toBe(200);
  expect(access.json().data).toBe(`https://storage.example/${key}`);
  for (const seconds of ['abc', '2147483648', '1.5'])
    expect(
      (
        await app.inject({
          url: `/api/v1/files/access-url?objectKey=${key}&expireSeconds=${seconds}`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (
      await app.inject({
        url: '/api/v1/files/access-url?objectKey=business-license/unknown.png',
        headers,
      })
    ).statusCode,
  ).toBe(403);
});
test('HTTP authenticated attachments require owner and claimed business access is explicitly blocked', async () => {
  expect(
    (await uploadHttp([imagePart(), { name: 'bizType', content: 'PROJECT_ATTACHMENT' }]))
      .statusCode,
  ).toBe(401);
  await register();
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const response = await uploadHttp(
    [imagePart(), { name: 'bizType', content: 'PROJECT_ATTACHMENT' }],
    headers,
  );
  expect(response.statusCode, response.body).toBe(200);
  const { objectKey, uploadToken } = response.json().data;
  expect(
    (await app.inject({ url: `/api/v1/files/view?objectKey=${objectKey}`, headers })).statusCode,
  ).toBe(200);
  const user = await db.user.findFirstOrThrow();
  await db.$transaction((tx) =>
    registry.claimForProject(tx, objectKey, uploadToken, user.uid, user.id),
  );
  expect(
    (await app.inject({ url: `/api/v1/files/view?objectKey=${objectKey}`, headers })).statusCode,
  ).toBe(403);
});
test('HTTP batch uses files field, rejects empty/malformed/duplicate fields and does not ignore bad authorization', async () => {
  const response = await uploadHttp([imagePart('files'), imagePart('files')], {}, true);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().data).toHaveLength(2);
  for (const parts of [
    [],
    [imagePart('files')],
    [imagePart(), imagePart()],
    [imagePart(), { name: 'bizType', content: '' }, { name: 'bizType', content: 'COMMON' }],
  ])
    expect((await uploadHttp(parts)).statusCode).toBe(400);
  expect((await uploadHttp([imagePart()], { authorization: 'Bearer invalid' })).statusCode).toBe(
    401,
  );
  expect((await uploadHttp([imagePart()], { origin: 'https://evil.example' })).statusCode).toBe(
    403,
  );
  const broken = await app.inject({
    method: 'POST',
    url: '/api/v1/files/upload',
    headers: { 'content-type': 'multipart/form-data; boundary=broken' },
    payload: '--broken\r\nunfinished',
  });
  expect(broken.statusCode).toBe(400);
});
test('HTTP fixed business policy rejects category bypass, spoofed content and SVG with no stored object', async () => {
  for (const parts of [
    [{ name: 'file', fileName: 'fake.png', contentType: 'image/png', content: 'fake' }],
    [{ name: 'file', fileName: 'a.svg', contentType: 'image/svg+xml', content: '<svg/>' }],
    [
      { name: 'file', fileName: 'a.txt', contentType: 'text/plain', content: 'hello' },
      { name: 'bizType', content: 'BUSINESS_LICENSE' },
      { name: 'category', content: 'ANY' },
    ],
    [imagePart(), { name: 'bizType', content: 'UNKNOWN' }],
  ])
    expect((await uploadHttp(parts)).statusCode).toBe(400);
  expect(objects.size).toBe(0);
  expect(await db.uploadedFile.count()).toBe(0);
});
test('HTTP document proxy forces download and nosniff', async () => {
  await register();
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const response = await uploadHttp(
    [
      { name: 'file', fileName: 'a.txt', contentType: 'text/plain', content: 'hello' },
      { name: 'bizType', content: 'DOCUMENT' },
    ],
    headers,
  );
  expect(response.statusCode, response.body).toBe(200);
  // 模拟存储返回任意客户端元数据，代理仍不允许 SVG/HTML 内联。
  const original = storage.open;
  storage.open = async (key) => ({ ...(await original(key)), contentType: 'text/html' });
  try {
    const viewed = await app.inject({
      url: `/api/v1/files/view?objectKey=${response.json().data.objectKey}`,
      headers,
    });
    expect(viewed.statusCode, viewed.body).toBe(200);
    expect(viewed.headers['content-type']).toBe('application/octet-stream');
    expect(viewed.headers['content-disposition']).toBe('attachment');
    expect(viewed.body).toBe('hello');
  } finally {
    storage.open = original;
  }
});
test('HTTP single file, batch count and complete multipart body limits are enforced', async () => {
  const limitedConfig = {
    ...config,
    files: { ...config.files, maxSize: 16, maxRequestSize: 512, maxBatchCount: 2 },
  };
  const limited = await createApp(limitedConfig, db, undefined, storage);
  try {
    const inject = (parts: Parameters<typeof multipartPayload>[0], batch = false) =>
      limited.inject({
        method: 'POST',
        url: `/api/v1/files/upload${batch ? '/batch' : ''}`,
        ...multipartPayload(parts),
      });
    expect(
      (
        await inject([
          { name: 'file', fileName: 'a.txt', contentType: 'text/plain', content: 'a'.repeat(17) },
        ])
      ).statusCode,
    ).toBe(413);
    expect(
      (await inject([imagePart('files'), imagePart('files'), imagePart('files')], true)).statusCode,
    ).toBe(413);
    const form = multipartPayload([imagePart()]);
    const tooLarge = await limited.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      headers: form.headers,
      payload: Buffer.concat([form.payload, Buffer.alloc(513)]),
    });
    expect(tooLarge.statusCode).toBe(413);
  } finally {
    await limited.close();
  }
});

async function registrationGrant(headers = web) {
  await send('login');
  const result = await post('/auth/sms/login', { phone, code: '095270' }, headers);
  expect(result.statusCode).toBe(200);
  expect(result.json().data.status).toBe('registration_required');
  expect(result.cookies).toHaveLength(0);
  expect(result.json().data.accessToken).toBeUndefined();
  expect(await db.user.count()).toBe(0);
  expect(await db.session.count()).toBe(0);
  return result.json().data.registrationToken as string;
}
function registrationForm(registrationToken: string) {
  const { code: _code, ...form } = registration;
  void _code;
  return { ...form, registrationToken };
}
test('abandoned registration repeats the form; newest grant completes registration without another SMS', async () => {
  const first = await registrationGrant();
  expect((await post('/auth/sms/login', { phone, code: '095270' })).statusCode).toBe(400);
  expect((await app.inject({ url: '/api/v1/users/me', headers: bearer(first) })).statusCode).toBe(
    401,
  );
  const latest = await registrationGrant(desktop);
  expect(latest).not.toBe(first);
  const row = await db.registrationGrant.findUniqueOrThrow({
    where: { tokenDigest: digest(`sms-registration:${latest}`) },
  });
  expect(row.tokenDigest).not.toBe(latest);
  expect((await post('/auth/register', registrationForm(first))).statusCode).toBe(400);
  const created = await post('/auth/register', registrationForm(latest));
  expect(created.statusCode).toBe(200);
  expect(created.json().data.role).toBe('EXPERT');
  expect(created.cookies).toHaveLength(0);
  expect(await db.session.count()).toBe(0);
  expect((await post('/auth/register', registrationForm(latest))).statusCode).toBe(400);
  await send('login');
  const logged = await post('/auth/sms/login', { phone, code: '095270' });
  expect(logged.statusCode).toBe(200);
  expect(logged.json().data.accessToken).toBeTruthy();
  expect(logged.cookies[0]?.httpOnly).toBe(true);
});
test('registration grants reject missing, mixed, forged, mismatched and expired credentials', async () => {
  const token = await registrationGrant();
  const form = registrationForm(token);
  const { registrationToken: _token, ...missing } = form;
  void _token;
  for (const input of [
    missing,
    { ...form, code: '095270' },
    { ...form, registrationToken: 'x'.repeat(43) },
    { ...form, phone: '13912345678' },
  ])
    expect((await post('/auth/register', input)).statusCode).toBe(400);
  await db.registrationGrant.updateMany({ data: { expiresAt: new Date(0) } });
  expect((await post('/auth/register', form)).statusCode).toBe(400);
  expect(await db.user.count()).toBe(0);
});
test('grant registration validates the form and rolls back credential consumption on conflicts', async () => {
  const token = await registrationGrant();
  const form = registrationForm(token);
  expect((await post('/auth/register', { ...form, confirmPassword: 'Wrong123' })).statusCode).toBe(
    400,
  );
  const org = await db.organization.create({ data: { name: '已存在组织', expertiseTags: [] } });
  expect(
    (
      await post('/auth/register', {
        ...form,
        accountType: 'ORGANIZATION',
        organization: { name: org.name },
      })
    ).statusCode,
  ).toBe(409);
  expect((await db.registrationGrant.findFirstOrThrow()).consumedAt).toBeNull();
  expect(await db.user.count()).toBe(0);
  expect((await post('/auth/register', form)).statusCode).toBe(200);
});
test('concurrent new-phone SMS consumption issues only one grant', async () => {
  await send('login');
  const results = await Promise.all([
    post('/auth/sms/login', { phone, code: '095270' }),
    post('/auth/sms/login', { phone, code: '095270' }),
  ]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 400]);
  expect(await db.registrationGrant.count()).toBe(1);
  expect(await db.user.count()).toBe(0);
  expect(await db.session.count()).toBe(0);
});
test('concurrent registration with one grant creates exactly one account', async () => {
  const form = registrationForm(await registrationGrant());
  const results = await Promise.all([post('/auth/register', form), post('/auth/register', form)]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 400]);
  expect(await db.user.count()).toBe(1);
});

test('anonymous nickname check trims, rejects blanks and recommends the first available suffix', async () => {
  await register();
  await db.user.create({
    data: {
      phoneE164: '+8613912345678',
      phoneRegion: 'CN',
      username: 'other',
      displayName: '小明1',
    },
  });
  const check = async (value: string) =>
    app.inject(`/api/v1/users/nickname/check?nickname=${encodeURIComponent(value)}`);
  expect((await check(' 小明 ')).json()).toEqual({
    code: 200,
    message: '操作成功',
    data: {
      nickname: '小明',
      available: false,
      suggestion: '小明2',
      message: '昵称已存在，可使用推荐昵称「小明2」',
    },
  });
  expect((await check(' 新名字 ')).json().data).toMatchObject({
    nickname: '新名字',
    available: true,
    suggestion: '新名字',
  });
  for (const value of ['', '   ', 'a'.repeat(65)])
    expect((await check(value)).statusCode).toBe(400);
  expect((await app.inject('/api/v1/users/nickname/check')).statusCode).toBe(400);
});

test('concurrent registrations with one nickname have one winner and roll back the loser credential', async () => {
  await send('register');
  await send('register', '13912345678');
  const results = await Promise.all([
    post('/auth/register', { ...registration, nickname: '同名' }),
    post('/auth/register', {
      ...registration,
      nickname: '同名',
      phone: '13912345678',
      email: 'other@example.com',
    }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await db.user.count()).toBe(1);
  expect(await db.verificationChallenge.count({ where: { consumedAt: null } })).toBe(1);
});

test('profile persists only own fields, trims values, ignores known roles and supports null/clearing', async () => {
  await register();
  const other = await db.user.create({
    data: {
      phoneE164: '+8613912345678',
      phoneRegion: 'CN',
      username: 'other',
      displayName: '另一人',
      bio: '其他用户原简介',
    },
  });
  const tokens = (await login(desktop)).json().data;
  const headers = bearer(tokens.accessToken);
  const updated = await post(
    '/users/me/update',
    {
      avatarUrl: ' common/avatar.png ',
      bio: ' 专家简介 ',
      idCardNo: '11010119900101001x',
      roles: ['OPS', 'PM'],
    },
    headers,
  );
  expect(updated.statusCode).toBe(200);
  expect(updated.json().data).toMatchObject({
    avatarUrl: 'common/avatar.png',
    bio: '专家简介',
    idCardNo: '110***********001X',
    role: 'EXPERT',
    roles: ['EXPERT'],
    selectedRole: null,
    hasExpertManagementRole: false,
  });
  expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).bio).toBe('其他用户原简介');
  const saved = await db.user.findUniqueOrThrow({ where: { phoneE164: `+86${phone}` } });
  expect(saved.updatedBy).toBe(saved.uid);
  expect(saved.role).toBe('EXPERT');
  expect(saved.idCardNo).toBe('11010119900101001X');
  expect(
    (
      await post(
        '/users/me/update',
        {
          avatarUrl: null,
          bio: null,
          idCardNo: null,
          newPassword: null,
          confirmNewPassword: null,
          roles: null,
        },
        headers,
      )
    ).statusCode,
  ).toBe(200);
  const me = await app.inject({ url: '/api/v1/users/me', headers });
  expect(me.json().data).toMatchObject({
    avatarUrl: 'common/avatar.png',
    bio: '专家简介',
    selectedRole: 'EXPERT',
  });
  const cleared = await post(
    '/users/me/update',
    { avatarUrl: ' ', bio: '', idCardNo: '' },
    headers,
  );
  expect(cleared.json().data).toMatchObject({ avatarUrl: null, bio: null, idCardNo: null });
});

test('profile rejects anonymous, other-user targets, unsupported fields, invalid values and browser origin spoofing', async () => {
  await register();
  const headers = bearer((await login(desktop)).json().data.accessToken);
  expect((await post('/users/me/update', {}, {})).json()).toMatchObject({ code: 401, data: null });
  for (const payload of [
    { userId: 'other' },
    { nickname: '改名' },
    { realName: '改名' },
    { email: 'other@example.com' },
    { idVerified: 1 },
    { idCardNo: 'bad' },
    { bio: 'a'.repeat(1001) },
    { avatarUrl: 'a'.repeat(513) },
    { roles: [] },
    { roles: ['INVALID'] },
    { newPassword: 'onlyletters', confirmNewPassword: 'onlyletters' },
    { newPassword: 'Changed123!' },
    { confirmNewPassword: 'Changed123!' },
    { newPassword: 'Changed123!', confirmNewPassword: 'Wrong123!' },
  ]) {
    const response = await post('/users/me/update', payload, headers);
    expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    expect(response.json()).toMatchObject({ code: 400, data: null });
  }
  const cookie = (await login(web)).cookies[0]!;
  expect(
    (
      await post(
        '/users/me/update',
        { bio: '非法' },
        { origin: 'https://evil.test', cookie: `${cookie.name}=${cookie.value}` },
      )
    ).statusCode,
  ).toBe(403);
  expect((await db.user.findFirstOrThrow()).bio).toBeNull();
});

test('verified identity is immutable and duplicate identity rolls back all profile changes', async () => {
  await register({ idCardNo: '11010119900101001X' });
  const headers = bearer((await login(desktop)).json().data.accessToken);
  await db.user.updateMany({ data: { idVerified: 1 } });
  expect(
    (await post('/users/me/update', { idCardNo: '11010119900101001x' }, headers)).statusCode,
  ).toBe(200);
  for (const idCardNo of ['', '11010119900101002X'])
    expect((await post('/users/me/update', { idCardNo }, headers)).statusCode).toBe(403);
  expect((await app.inject({ url: '/api/v1/users/me', headers })).json().data.idVerified).toBe(1);
  await db.user.updateMany({ data: { idVerified: 0 } });
  await db.user.create({
    data: {
      phoneE164: '+8613912345678',
      phoneRegion: 'CN',
      username: 'other',
      displayName: '其他人',
      idCardNo: '11010119900101002X',
    },
  });
  const conflict = await post(
    '/users/me/update',
    {
      idCardNo: '11010119900101002x',
      bio: '应回滚',
      newPassword: 'Changed123!',
      confirmNewPassword: 'Changed123!',
    },
    headers,
  );
  expect(conflict.statusCode).toBe(409);
  expect((await db.user.findUniqueOrThrow({ where: { phoneE164: `+86${phone}` } })).bio).toBeNull();
  expect((await app.inject({ url: '/api/v1/users/me', headers })).statusCode).toBe(200);
  expect((await login(desktop)).statusCode).toBe(200);
});

test('profile password change clears web cookie and revokes access and refresh tokens on all clients', async () => {
  await register();
  const browser = await login(web);
  const cookie = browser.cookies[0]!;
  const tokens = (await login(desktop)).json().data;
  const changed = await post(
    '/users/me/update',
    { newPassword: 'Changed123!', confirmNewPassword: 'Changed123!' },
    { ...web, cookie: `${cookie.name}=${cookie.value}` },
  );
  expect(changed.statusCode).toBe(200);
  expect(changed.cookies[0]?.value).toBe('');
  expect(await db.session.count({ where: { revokedAt: null } })).toBe(0);
  for (const accessToken of [browser.json().data.accessToken, tokens.accessToken])
    expect(
      (await app.inject({ url: '/api/v1/users/me', headers: bearer(accessToken) })).statusCode,
    ).toBe(401);
  expect(
    (await post('/auth/refresh', { refreshToken: browser.json().data.refreshToken }, web))
      .statusCode,
  ).toBe(401);
  expect(
    (await post('/auth/refresh', { refreshToken: tokens.refreshToken }, desktop)).statusCode,
  ).toBe(401);
  expect(
    (await post('/users/me/update', { bio: 'stale' }, bearer(tokens.accessToken))).statusCode,
  ).toBe(401);
  expect(
    (await post('/auth/login', { account: phone, password: 'Password123' }, desktop)).statusCode,
  ).toBe(401);
  expect((await login(desktop, { password: 'Changed123!' })).statusCode).toBe(200);
});

test('concurrent profile password changes cannot both succeed with a revoked session', async () => {
  await register();
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const results = await Promise.all(
    ['Changed123!', 'Changed456!'].map((newPassword) =>
      post('/users/me/update', { newPassword, confirmNewPassword: newPassword }, headers),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  expect(await db.session.count({ where: { revokedAt: null } })).toBe(0);
});

test('organization registration creates authoritative membership atomically with default owner role', async () => {
  const result = await register({
    accountType: 'ORGANIZATION',
    organization: { name: '主管组织', expertiseTags: ['图像标注'] },
  });
  const user = result.json().data;
  expect(
    await db.userOrgRel.findUniqueOrThrow({
      where: { userId_orgId: { userId: user.id, orgId: user.organization.id } },
    }),
  ).toMatchObject({
    uid: user.uid,
    position: 'OWNER',
    joinStatus: 'ACTIVE',
    versionNo: 0,
    createdBy: user.uid,
  });
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const response = await app.inject({
    url: `/api/v1/organizations?orgId=${user.organization.id}`,
    headers,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toMatchObject({
    id: user.organization.id,
    position: 'OWNER',
    verifyStatus: 'PENDING',
    status: 'ACTIVE',
    expertiseTags: ['图像标注'],
  });
});

test('organization permissions use independent memberships across organizations rather than legacy profile pointers', async () => {
  const user = (await register()).json().data;
  const org = await db.organization.create({ data: { name: '组织A', expertiseTags: [] } });
  const other = await db.organization.create({ data: { name: '组织B', expertiseTags: [] } });
  const rel = await db.userOrgRel.create({
    data: { userId: user.id, uid: user.uid, orgId: org.id, position: 'ADMIN' },
  });
  await db.userOrgRel.create({
    data: { userId: user.id, uid: user.uid, orgId: other.id, position: 'MEMBER' },
  });
  // 兼容字段中的主管身份不能授予组织B权限。
  await db.user.update({
    where: { id: user.id },
    data: { organizationId: other.id, orgPosition: 'OWNER' },
  });
  const headers = bearer((await login(desktop)).json().data.accessToken);
  expect(
    (await app.inject({ url: `/api/v1/organizations?orgId=${org.id}`, headers })).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: `/api/v1/organizations?orgId=${other.id}`, headers })).statusCode,
  ).toBe(403);
  expect(
    (await post('/organizations/update', { orgId: org.id, description: 'denied' }, headers))
      .statusCode,
  ).toBe(403);
  for (const joinStatus of [
    'EXIT_APPROVING',
    'PENDING_LEAVE',
    'LEFT',
    'REMOVED',
    'PENDING',
    'PENDING_ACTIVATION',
  ]) {
    await db.userOrgRel.update({ where: { id: rel.id }, data: { joinStatus } });
    expect(
      (await app.inject({ url: `/api/v1/organizations?orgId=${org.id}`, headers })).statusCode,
    ).toBe(['EXIT_APPROVING', 'PENDING_LEAVE'].includes(joinStatus) ? 200 : 403);
  }
});

test('organization partial updates serialize concurrent writers and preserve null, clearing, audit and deleted scope', async () => {
  const user = (
    await register({
      accountType: 'ORGANIZATION',
      organization: { name: '并发资料组织', description: '初始', logoUrl: 'initial.png' },
    })
  ).json().data;
  const orgId = user.organization.id;
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const responses = await Promise.all([
    post('/organizations/update', { orgId, description: ' 新简介 ' }, headers),
    post('/organizations/update', { orgId, logoUrl: ' new.png ' }, headers),
  ]);
  expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(await db.organization.findUniqueOrThrow({ where: { id: orgId } })).toMatchObject({
    description: '新简介',
    logoUrl: 'new.png',
    updatedBy: user.uid,
  });
  const cleared = await post(
    '/organizations/update',
    { orgId, description: null, logoUrl: '  ' },
    headers,
  );
  expect(cleared.json().data).toMatchObject({ id: orgId, description: '新简介', logoUrl: '' });
  expect(cleared.json().data.updatedAt).toMatch(/Z$/);
  await db.organization.update({ where: { id: orgId }, data: { deleted: true } });
  expect(
    (await app.inject({ url: `/api/v1/organizations?orgId=${orgId}`, headers })).statusCode,
  ).toBe(404);
  expect((await post('/organizations/update', { orgId }, headers)).statusCode).toBe(404);
});

test('organization migration backfill retains existing roles without granting missing roles manager access', async () => {
  await register();
  const user = await db.user.findFirstOrThrow();
  const org = await db.organization.create({ data: { name: '回填组织', expertiseTags: [] } });
  await db.user.update({
    where: { id: user.id },
    data: { organizationId: org.id, orgPosition: 'ADMIN' },
  });
  const sql = readFileSync(
    new URL(
      '../prisma/migrations/20261019020000_organization_memberships/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const backfill = sql.slice(sql.indexOf('INSERT INTO "UserOrgRel"'));
  await db.$executeRawUnsafe(backfill);
  expect(await db.userOrgRel.findFirstOrThrow()).toMatchObject({
    userId: user.id,
    uid: user.uid,
    orgId: org.id,
    position: 'ADMIN',
    joinStatus: 'ACTIVE',
    versionNo: 0,
    joinedAt: user.createdAt,
  });
  await db.userOrgRel.deleteMany();
  await db.user.update({ where: { id: user.id }, data: { orgPosition: null } });
  await db.$executeRawUnsafe(backfill);
  expect((await db.userOrgRel.findFirstOrThrow()).position).toBe('MEMBER');
  await expect(
    db.userOrgRel.create({ data: { userId: user.id, uid: user.uid, orgId: org.id } }),
  ).rejects.toMatchObject({ code: 'P2002' });
  await expect(db.userOrgRel.updateMany({ data: { joinStatus: 'UNKNOWN' } })).rejects.toThrow();
  await expect(db.userOrgRel.updateMany({ data: { versionNo: -1 } })).rejects.toThrow();
});

// 本批成员集成沿用同一串行文件及专用库守卫，避免多个测试文件并发TRUNCATE。
async function memberFixture() {
  const owner = (
    await register({ accountType: 'ORGANIZATION', organization: { name: '成员集成组织' } })
  ).json().data;
  const orgId: string = owner.organization.id;
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const ownerRel = await db.userOrgRel.findUniqueOrThrow({
    where: { userId_orgId: { userId: owner.id, orgId } },
  });
  let sequence = 0;
  async function add(position = 'MEMBER', joinStatus = 'ACTIVE') {
    sequence++;
    const user = await db.user.create({
      data: {
        phoneE164: `+861390000${String(sequence).padStart(4, '0')}`,
        phoneRegion: 'CN',
        username: `member${sequence}`,
        displayName: `昵称${sequence}`,
        realName: `真实姓名${sequence}`,
      },
    });
    const rel = await db.userOrgRel.create({
      data: { userId: user.id, uid: user.uid, orgId, position, joinStatus },
    });
    const accessToken = `m${String(sequence).padStart(42, '0')}`;
    await db.session.create({
      data: {
        userId: user.id,
        tokenDigest: digest(accessToken),
        clientType: 'desktop',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    return { user, rel, headers: bearer(accessToken) };
  }
  return { owner, ownerRel, orgId, headers, add };
}
test('member pagination, full-phone search, enum filters and Shanghai date boundaries never expose full phone', async () => {
  const f = await memberFixture();
  const first = await f.add();
  const last = await f.add('MEMBER', 'LEFT');
  await db.userOrgRel.update({
    where: { id: first.rel.id },
    data: { joinedAt: new Date('2026-09-30T16:00:00Z'), employmentType: 'FULL_TIME' },
  });
  await db.userOrgRel.update({
    where: { id: last.rel.id },
    data: {
      joinedAt: new Date('2026-10-01T15:59:59Z'),
      leftAt: new Date('2026-10-02T00:00:00Z'),
      employmentType: 'PART_TIME',
    },
  });
  const list = await post(
    '/organizations/members',
    { orgId: f.orgId, joinedStartDate: '2026-10-01', joinedEndDate: '2026-10-01', size: 1 },
    f.headers,
  );
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().data).toMatchObject({ total: 2, pages: 2, current: 1, size: 1 });
  expect(list.json().data.records[0]).toMatchObject({
    memberId: last.rel.id,
    joinStatus: 'LEFT',
    activeProjectCount: 0,
    phoneMasked: '139****0002',
    versionNo: 0,
  });
  expect(list.payload).not.toContain('13900000002');
  const second = await post(
    '/organizations/members',
    {
      orgId: f.orgId,
      joinedStartDate: '2026-10-01',
      joinedEndDate: '2026-10-01',
      current: 2,
      size: 1,
    },
    f.headers,
  );
  expect(second.json().data.records[0].memberId).toBe(first.rel.id);
  for (const keyword of ['真实姓名1', first.user.uid, first.user.phoneE164.slice(3)]) {
    const result = await post('/organizations/members', { orgId: f.orgId, keyword }, f.headers);
    expect(result.json().data.records.map((x: { memberId: string }) => x.memberId)).toEqual([
      first.rel.id,
    ]);
  }
  const partialPhone = await post(
    '/organizations/members',
    { orgId: f.orgId, keyword: '1390000' },
    f.headers,
  );
  expect(partialPhone.json().data.total).toBe(0);
  expect(
    (
      await post(
        '/organizations/members',
        {
          orgId: f.orgId,
          employmentType: 'PART_TIME',
          position: 'MEMBER',
          joinStatus: 'LEFT',
          leftStartDate: '2026-10-02',
          leftEndDate: '2026-10-02',
        },
        f.headers,
      )
    ).json().data.total,
  ).toBe(1);
  expect(
    (await post('/organizations/members', { orgId: f.orgId, projectId: f.orgId }, f.headers))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await post(
        '/organizations/members',
        { orgId: f.orgId, joinedStartDate: '2026-02-30' },
        f.headers,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (await post('/organizations/members', { orgId: f.orgId, current: 1000 }, f.headers)).json().data
      .records,
  ).toEqual([]);
});
test('member edit uses conditional versions, concurrent writes have one winner, and scope never crosses organization', async () => {
  const f = await memberFixture();
  const member = await f.add();
  const body = {
    orgId: f.orgId,
    memberId: member.rel.id,
    versionNo: 0,
    employmentType: 'FULL_TIME',
  };
  const results = await Promise.all([
    post('/organizations/members/update', body, f.headers),
    post('/organizations/members/update', { ...body, employmentType: 'PART_TIME' }, f.headers),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const latest = await db.userOrgRel.findUniqueOrThrow({ where: { id: member.rel.id } });
  expect(latest).toMatchObject({ versionNo: 1, updatedBy: f.owner.uid });
  const changed = await post(
    '/organizations/members/update',
    { ...body, versionNo: 1, employmentType: null, joinedAt: '2026-10-01 09:00:00' },
    f.headers,
  );
  expect(changed.json().data).toMatchObject({
    versionNo: 2,
    employmentType: latest.employmentType,
    joinedAt: '2026-10-01T01:00:00.000Z',
  });
  const org = await db.organization.create({ data: { name: '另一组织', expertiseTags: [] } });
  const foreign = await db.userOrgRel.create({
    data: { userId: member.user.id, uid: member.user.uid, orgId: org.id },
  });
  expect(
    (await post('/organizations/members/update', { ...body, memberId: foreign.id }, f.headers))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await post(
        '/organizations/members/update',
        { ...body, versionNo: 2, employmentType: null },
        f.headers,
      )
    ).statusCode,
  ).toBe(400);
  expect((await post('/organizations/members/update', body, member.headers)).statusCode).toBe(403);
});
test('admin can edit and promote normal members or demote self, while other managers are protected', async () => {
  const f = await memberFixture();
  const admin = await f.add('ADMIN');
  const peer = await f.add('ADMIN');
  const member = await f.add();
  const edit = (memberId: string) =>
    post(
      '/organizations/members/update',
      { orgId: f.orgId, memberId, versionNo: 0, employmentType: 'PART_TIME' },
      admin.headers,
    );
  expect((await edit(member.rel.id)).statusCode).toBe(200);
  expect((await edit(admin.rel.id)).statusCode).toBe(200);
  expect((await edit(peer.rel.id)).statusCode).toBe(403);
  expect((await edit(f.ownerRel.id)).statusCode).toBe(403);
  expect(
    (
      await post(
        '/organizations/members/position',
        { orgId: f.orgId, memberId: member.rel.id, position: 'OWNER' },
        admin.headers,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await post(
        '/organizations/members/position',
        { orgId: f.orgId, memberId: member.rel.id, position: 'ADMIN' },
        admin.headers,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await post(
        '/organizations/members/position',
        { orgId: f.orgId, memberId: admin.rel.id, position: 'MEMBER' },
        admin.headers,
      )
    ).statusCode,
  ).toBe(200);
  expect((await post('/organizations/members', { orgId: f.orgId }, admin.headers)).statusCode).toBe(
    403,
  );
});
test('concurrent admin promotions serialize the five-admin cap including pending memberships', async () => {
  const f = await memberFixture();
  for (const status of ['ACTIVE', 'PENDING', 'PENDING_ACTIVATION', 'PENDING_LEAVE'])
    await f.add('ADMIN', status);
  const left = await f.add();
  const right = await f.add();
  const results = await Promise.all(
    [left, right].map((member) =>
      post(
        '/organizations/members/position',
        { orgId: f.orgId, memberId: member.rel.id, position: 'ADMIN' },
        f.headers,
      ),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  expect(await db.userOrgRel.count({ where: { orgId: f.orgId, position: 'ADMIN' } })).toBe(5);
  const promoted = await db.userOrgRel.findFirstOrThrow({
    where: { id: { in: [left.rel.id, right.rel.id] }, position: 'ADMIN' },
  });
  const version = promoted.versionNo;
  const noop = await post(
    '/organizations/members/position',
    { orgId: f.orgId, memberId: promoted.id, position: 'ADMIN' },
    f.headers,
  );
  expect(noop.statusCode).toBe(200);
  expect((await db.userOrgRel.findUniqueOrThrow({ where: { id: promoted.id } })).versionNo).toBe(
    version,
  );
  const remaining = promoted.id === left.rel.id ? right : left;
  expect(
    (
      await post(
        '/organizations/members/position',
        { orgId: f.orgId, memberId: remaining.rel.id, position: 'OWNER' },
        f.headers,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await post(
        '/organizations/members/position',
        { orgId: f.orgId, memberId: promoted.id, position: 'OWNER' },
        f.headers,
      )
    ).statusCode,
  ).toBe(200);
  expect(await db.userOrgRel.count({ where: { orgId: f.orgId, position: 'OWNER' } })).toBe(1);
  expect(await db.userOrgRel.count({ where: { orgId: f.orgId, position: 'ADMIN' } })).toBe(5);
});
test('concurrent owner transfers preserve a single owner, and stale owner cannot perform another transfer', async () => {
  const f = await memberFixture();
  const first = await f.add();
  const second = await f.add();
  const results = await Promise.all(
    [first, second].map((member) =>
      post(
        '/organizations/members/position',
        { orgId: f.orgId, memberId: member.rel.id, position: 'OWNER' },
        f.headers,
      ),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 403]);
  const owner = await db.userOrgRel.findFirstOrThrow({
    where: { orgId: f.orgId, position: 'OWNER' },
  });
  expect(await db.userOrgRel.count({ where: { orgId: f.orgId, position: 'OWNER' } })).toBe(1);
  expect((await db.userOrgRel.findUniqueOrThrow({ where: { id: f.ownerRel.id } })).position).toBe(
    'ADMIN',
  );
  const profile = await app.inject({ url: '/api/v1/users/me', headers: f.headers });
  expect(profile.json().data).toMatchObject({
    hasExpertManagementRole: false,
    organization: { id: f.orgId, position: 'ADMIN' },
  });
  const target = owner.id === first.rel.id ? first : second;
  expect(
    (await app.inject({ url: '/api/v1/users/me', headers: target.headers })).json().data,
  ).toMatchObject({
    hasExpertManagementRole: true,
    organization: { id: f.orgId, position: 'OWNER' },
  });
  // User.orgPosition保留旧OWNER，不能继续授权更新组织资料。
  expect(
    (await post('/organizations/update', { orgId: f.orgId, description: 'stale' }, f.headers))
      .statusCode,
  ).toBe(403);
});
test('profile selects owner then earliest participating membership and ignores legacy pointer and deleted organizations', async () => {
  const f = await memberFixture();
  const other = await db.organization.create({
    data: { name: '第二组织', expertiseTags: [], verifyStatus: 'APPROVED', status: 'FROZEN' },
  });
  await db.userOrgRel.update({
    where: { id: f.ownerRel.id },
    data: { position: 'ADMIN', joinedAt: new Date('2026-01-02T00:00:00Z') },
  });
  const relation = await db.userOrgRel.create({
    data: {
      orgId: other.id,
      userId: f.owner.id,
      uid: f.owner.uid,
      position: 'MEMBER',
      joinStatus: 'EXIT_APPROVING',
      joinedAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  const me = async () =>
    (await app.inject({ url: '/api/v1/users/me', headers: f.headers })).json().data;
  expect((await me()).organization).toMatchObject({
    id: other.id,
    position: 'MEMBER',
    joinStatus: 'EXIT_APPROVING',
    verifyStatus: 'APPROVED',
    status: 'FROZEN',
  });
  await db.userOrgRel.update({ where: { id: f.ownerRel.id }, data: { position: 'OWNER' } });
  expect((await me()).organization.id).toBe(f.orgId);
  await db.userOrgRel.update({ where: { id: f.ownerRel.id }, data: { joinStatus: 'LEFT' } });
  expect((await me()).organization.id).toBe(other.id);
  await db.organization.update({ where: { id: other.id }, data: { deleted: true } });
  expect(await me()).toMatchObject({ organization: null, hasExpertManagementRole: false });
  // 更新资料响应也必须使用实际关系，不能重新读兼容指针。
  expect(
    (await post('/users/me/update', { bio: 'new bio' }, f.headers)).json().data.organization,
  ).toBeNull();
  expect(relation.position).toBe('MEMBER');
});
test('license access follows membership across organizations, demotion and departure instead of legacy pointer', async () => {
  const f = await memberFixture();
  const reader = await f.add('ADMIN');
  const { record, uploadToken } = await uploaded();
  await db.$transaction((tx) =>
    registry.claimForOrganizationRegistration(tx, record.objectKey, uploadToken, f.orgId),
  );
  const read = () =>
    app.inject({
      url: `/api/v1/files/view?objectKey=${record.objectKey}`,
      headers: reader.headers,
    });
  expect(reader.user.organizationId).toBeNull();
  expect((await read()).statusCode).toBe(200);
  await db.userOrgRel.update({
    where: { id: reader.rel.id },
    data: { joinStatus: 'EXIT_APPROVING' },
  });
  expect((await read()).statusCode).toBe(200);
  await db.userOrgRel.update({
    where: { id: reader.rel.id },
    data: { joinStatus: 'PENDING_LEAVE' },
  });
  expect((await read()).statusCode).toBe(200);
  await db.user.update({
    where: { id: reader.user.id },
    data: { organizationId: f.orgId, orgPosition: 'OWNER' },
  });
  await db.userOrgRel.update({ where: { id: reader.rel.id }, data: { joinStatus: 'LEFT' } });
  expect((await read()).statusCode).toBe(403);
  await db.userOrgRel.update({
    where: { id: reader.rel.id },
    data: { joinStatus: 'ACTIVE', position: 'MEMBER' },
  });
  expect((await read()).statusCode).toBe(403);
  await db.userOrgRel.update({ where: { id: reader.rel.id }, data: { position: 'ADMIN' } });
  await db.organization.update({ where: { id: f.orgId }, data: { deleted: true } });
  expect((await read()).statusCode).toBe(403);
});

async function requestSelfExit(
  f: Awaited<ReturnType<typeof memberFixture>>,
  member: Awaited<ReturnType<Awaited<ReturnType<typeof memberFixture>>['add']>>,
  key = 'self-exit',
  day = '2099-01-01',
) {
  return post(
    '/organizations/members/exit-requests',
    { orgId: f.orgId, reason: '个人安排', plannedLeaveDate: day },
    { ...member.headers, 'idempotency-key': key },
  );
}
async function pendingExit(f: Awaited<ReturnType<typeof memberFixture>>) {
  const response = await post('/organizations/approvals/pending', { orgId: f.orgId }, f.headers);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().data.total).toBe(1);
  return response.json().data.records[0];
}
function processing(
  orgId: string,
  node: { flowNo: string; nodeId: string; nodeVersionNo: number; flowVersionNo: number },
  action = 'APPROVE',
) {
  return {
    orgId,
    flowNo: node.flowNo,
    nodeId: node.nodeId,
    nodeVersionNo: node.nodeVersionNo,
    flowVersionNo: node.flowVersionNo,
    action,
    actionComment: action === 'REJECT' ? '  补充说明  ' : null,
  };
}
test('exit request writes one flow, owner node, action and member transition; concurrent replays and payload changes reuse it', async () => {
  const f = await memberFixture(),
    member = await f.add();
  const results = await Promise.all([requestSelfExit(f, member), requestSelfExit(f, member)]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(results[0]!.json()).toEqual(results[1]!.json());
  const data = results[0]!.json().data;
  expect(data).toMatchObject({
    flowStatus: 'PENDING',
    memberId: member.rel.id,
    joinStatus: 'EXIT_APPROVING',
  });
  expect(data.flowNo).toMatch(/^OMX[A-F0-9]{40}$/);
  expect(await db.approvalFlow.count()).toBe(1);
  expect(await db.approvalNode.count()).toBe(1);
  expect(await db.approvalActionLog.count()).toBe(1);
  expect(await db.userOrgRel.findUniqueOrThrow({ where: { id: member.rel.id } })).toMatchObject({
    joinStatus: 'EXIT_APPROVING',
    versionNo: 1,
    plannedLeaveDate: null,
  });
  const replay = await post(
    '/organizations/members/exit-requests',
    {
      orgId: f.orgId,
      memberId: f.ownerRel.id,
      reason: '不同payload',
      plannedLeaveDate: '2099-02-01',
    },
    { ...member.headers, 'idempotency-key': 'self-exit' },
  );
  expect(replay.json().data).toEqual(data);
  expect((await requestSelfExit(f, member, 'another-key')).statusCode).toBe(409);
  const admin = await f.add('ADMIN');
  const pending = await post('/organizations/approvals/pending', { orgId: f.orgId }, admin.headers);
  expect(pending.json().data.total).toBe(0);
  expect(
    (await post('/organizations/approvals/pending', { orgId: f.orgId }, member.headers)).statusCode,
  ).toBe(403);
});
test('missing active owner rolls back flow/node/action/member writes and preserves original state', async () => {
  const f = await memberFixture(),
    member = await f.add();
  await db.userOrgRel.update({ where: { id: f.ownerRel.id }, data: { position: 'ADMIN' } });
  expect((await requestSelfExit(f, member)).statusCode).toBe(500);
  expect(await db.approvalFlow.count()).toBe(0);
  expect(await db.approvalActionLog.count()).toBe(0);
  expect((await db.userOrgRel.findUniqueOrThrow({ where: { id: member.rel.id } })).joinStatus).toBe(
    'ACTIVE',
  );
});
test('direct exits enforce organization roles, today records durable cleanup, and pending departure remains participating', async () => {
  const f = await memberFixture(),
    admin = await f.add('ADMIN'),
    peer = await f.add('ADMIN'),
    member = await f.add(),
    future = await f.add();
  const exit = (
    targetId: string,
    headers = admin.headers,
    key = 'direct',
    plannedLeaveDate = shanghaiDay(new Date()),
  ) =>
    post(
      '/organizations/members/exit-requests',
      { orgId: f.orgId, memberId: targetId, reason: '人员调整', plannedLeaveDate },
      { ...headers, 'idempotency-key': key },
    );
  expect((await exit(f.ownerRel.id)).statusCode).toBe(400);
  expect((await exit(peer.rel.id)).statusCode).toBe(403);
  expect((await exit(member.rel.id, member.headers, 'not-used', '2000-01-01')).statusCode).toBe(
    400,
  );
  const immediate = await exit(member.rel.id);
  expect(immediate.statusCode, immediate.body).toBe(200);
  expect(immediate.json().data).toMatchObject({ flowStatus: 'APPROVED', joinStatus: 'LEFT' });
  expect(await db.approvalNode.count()).toBe(0);
  expect(
    await db.organizationDeparture.findUniqueOrThrow({
      where: { memberId_memberVersion: { memberId: member.rel.id, memberVersion: 1 } },
    }),
  ).toMatchObject({ status: 'PENDING', orgId: f.orgId, userId: member.user.id });
  expect((await exit(member.rel.id)).json()).toEqual(immediate.json());
  expect(
    (await exit(future.rel.id, f.headers, 'future', '2099-01-01')).json().data.joinStatus,
  ).toBe('PENDING_LEAVE');
  expect(
    (await app.inject({ url: '/api/v1/users/me', headers: future.headers })).json().data
      .organization.joinStatus,
  ).toBe('PENDING_LEAVE');
  expect(
    (await post('/organizations/approvals/records', { orgId: f.orgId }, f.headers)).json().data
      .total,
  ).toBe(0);
});
test('approval validates both versions and rejection comment; concurrent decisions have one winner and rollback the loser', async () => {
  const f = await memberFixture(),
    member = await f.add();
  expect((await requestSelfExit(f, member)).statusCode).toBe(200);
  const node = await pendingExit(f),
    input = processing(f.orgId, node);
  for (const change of [{ flowVersionNo: 99 }, { nodeVersionNo: 99 }])
    expect(
      (await post('/organizations/approvals/process', { ...input, ...change }, f.headers))
        .statusCode,
    ).toBe(409);
  expect(
    (
      await post(
        '/organizations/approvals/process',
        { ...input, action: 'REJECT', actionComment: ' ' },
        f.headers,
      )
    ).statusCode,
  ).toBe(400);
  const decisions = await Promise.all([
    post('/organizations/approvals/process', input, f.headers),
    post('/organizations/approvals/process', input, f.headers),
  ]);
  expect(decisions.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(decisions.find((r) => r.statusCode === 200)!.json().data).toMatchObject({
    nodeStatus: 'APPROVED',
    flowStatus: 'APPROVED',
    currentNode: null,
    joinStatus: 'PENDING_LEAVE',
    plannedLeaveDate: '2099-01-01',
  });
  expect(await db.approvalActionLog.count()).toBe(2);
  expect(await db.approvalFlow.findUniqueOrThrow({ where: { flowNo: node.flowNo } })).toMatchObject(
    { status: 'APPROVED', versionNo: 1, currentNode: null },
  );
  expect((await db.approvalNode.findUniqueOrThrow({ where: { id: node.nodeId } })).versionNo).toBe(
    1,
  );
  expect((await db.userOrgRel.findUniqueOrThrow({ where: { id: member.rel.id } })).versionNo).toBe(
    2,
  );
  expect(
    (await post('/organizations/approvals/pending', { orgId: f.orgId }, f.headers)).json().data
      .total,
  ).toBe(0);
});
test('rejection restores member and permits a fresh exit; missing or mismatched node/organization cannot advance flow', async () => {
  const f = await memberFixture(),
    member = await f.add(),
    other = await f.add();
  await requestSelfExit(f, member);
  const node = await pendingExit(f);
  await requestSelfExit(f, other, 'other');
  const otherFlow = await db.approvalFlow.findFirstOrThrow({ where: { businessId: other.rel.id } });
  const wrongNode = await db.approvalNode.findFirstOrThrow({ where: { flowId: otherFlow.id } });
  const input = processing(f.orgId, node, 'REJECT');
  expect(
    (await post('/organizations/approvals/process', { ...input, nodeId: wrongNode.id }, f.headers))
      .statusCode,
  ).toBe(400);
  const wrongOrg = await db.organization.create({ data: { name: '隔离组织', expertiseTags: [] } });
  await db.userOrgRel.create({
    data: { orgId: wrongOrg.id, userId: f.owner.id, uid: f.owner.uid, position: 'OWNER' },
  });
  expect(
    (await post('/organizations/approvals/process', { ...input, orgId: wrongOrg.id }, f.headers))
      .statusCode,
  ).toBe(403);
  expect(
    (await post('/organizations/approvals/pending', { orgId: wrongOrg.id }, f.headers)).json().data
      .total,
  ).toBe(0);
  const rejected = await post('/organizations/approvals/process', input, f.headers);
  expect(rejected.json().data).toMatchObject({
    flowStatus: 'REJECTED',
    nodeStatus: 'REJECTED',
    joinStatus: 'ACTIVE',
    plannedLeaveDate: null,
  });
  expect(await db.userOrgRel.findUniqueOrThrow({ where: { id: member.rel.id } })).toMatchObject({
    joinStatus: 'ACTIVE',
    plannedLeaveDate: null,
  });
  expect((await requestSelfExit(f, member, 'fresh')).statusCode).toBe(200);
});
test('malformed approval snapshots and conflicting member state roll back all attempted decision writes', async () => {
  const f = await memberFixture(),
    member = await f.add();
  await requestSelfExit(f, member);
  const node = await pendingExit(f),
    input = processing(f.orgId, node);
  const flow = await db.approvalFlow.findUniqueOrThrow({ where: { flowNo: node.flowNo } });
  await db.approvalFlow.update({
    where: { id: flow.id },
    data: { formData: { targetMemberId: member.rel.id, plannedLeaveDate: 'bad-date' } },
  });
  expect((await post('/organizations/approvals/process', input, f.headers)).statusCode).toBe(500);
  await db.approvalFlow.update({ where: { id: flow.id }, data: { formData: flow.formData! } });
  await db.userOrgRel.update({ where: { id: member.rel.id }, data: { joinStatus: 'ACTIVE' } });
  expect((await post('/organizations/approvals/process', input, f.headers)).statusCode).toBe(409);
  expect(await db.approvalFlow.findUniqueOrThrow({ where: { id: flow.id } })).toMatchObject({
    status: 'PENDING',
    versionNo: 0,
  });
  expect(await db.approvalNode.findUniqueOrThrow({ where: { id: node.nodeId } })).toMatchObject({
    nodeStatus: 'PENDING',
    versionNo: 0,
    approvedAt: null,
  });
  expect(await db.approvalActionLog.count()).toBe(1);
});
test('approval after planned day finalizes organization departure and records pending project compensation exactly once', async () => {
  const f = await memberFixture(),
    member = await f.add();
  const today = shanghaiDay(new Date());
  await requestSelfExit(f, member, 'today', today);
  const node = await pendingExit(f);
  const result = await post(
    '/organizations/approvals/process',
    processing(f.orgId, node),
    f.headers,
  );
  expect(result.json().data.joinStatus).toBe('LEFT');
  expect(await db.organizationDeparture.count()).toBe(1);
  expect(
    (await app.inject({ url: '/api/v1/users/me', headers: member.headers })).json().data
      .organization,
  ).toBeNull();
  const replay = await requestSelfExit(f, member, 'today', today);
  expect(replay.statusCode).toBe(200);
  // 沿旧Service：流程为当前APPROVED，joinStatus仍为创建时EXIT_APPROVING快照。
  expect(replay.json().data).toMatchObject({
    flowStatus: 'APPROVED',
    joinStatus: 'EXIT_APPROVING',
  });
  expect(await db.organizationDeparture.count()).toBe(1);
});
test('owner transfer does not silently reassign historical approval and requires both current role and node assignee', async () => {
  const f = await memberFixture(),
    member = await f.add(),
    successor = await f.add();
  await requestSelfExit(f, member);
  const node = await pendingExit(f);
  expect(
    (
      await post(
        '/organizations/members/position',
        { orgId: f.orgId, memberId: successor.rel.id, position: 'OWNER' },
        f.headers,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await post('/organizations/approvals/process', processing(f.orgId, node), f.headers))
      .statusCode,
  ).toBe(403);
  expect(
    (await post('/organizations/approvals/process', processing(f.orgId, node), successor.headers))
      .statusCode,
  ).toBe(403);
  expect((await db.approvalNode.findUniqueOrThrow({ where: { id: node.nodeId } })).approverId).toBe(
    f.owner.id,
  );
});
test('approval history pages by nodes, uses live names and last node action, and filters inclusive Shanghai times', async () => {
  const f = await memberFixture(),
    member = await f.add();
  await requestSelfExit(f, member);
  const pending = await pendingExit(f);
  await post('/organizations/approvals/process', processing(f.orgId, pending), f.headers);
  const original = await db.approvalNode.findUniqueOrThrow({ where: { id: pending.nodeId } });
  const second = await db.approvalNode.create({
    data: {
      flowId: original.flowId,
      flowNo: original.flowNo,
      nodeSeq: 2,
      nodeCode: 'EXTRA',
      nodeName: '历史第二节点',
      approverId: f.owner.id,
      approverUid: f.owner.uid,
      approverName: '旧快照',
      approverType: 'USER',
      nodeStatus: 'APPROVED',
      approvedAt: new Date('2026-10-19T01:00:00Z'),
    },
  });
  await db.approvalActionLog.create({
    data: {
      flowId: original.flowId,
      nodeId: second.id,
      actionType: 'APPROVE',
      operatorId: f.owner.id,
      operatorName: '旧快照',
      actionComment: 'first',
    },
  });
  await db.approvalActionLog.create({
    data: {
      flowId: original.flowId,
      nodeId: second.id,
      actionType: 'AUTO_PASS',
      operatorId: null,
      operatorName: 'SYSTEM',
      actionComment: 'latest',
    },
  });
  await db.user.update({
    where: { id: member.user.id },
    data: { displayName: '新昵称', realName: '新姓名' },
  });
  const all = await post(
    '/organizations/approvals/records',
    { orgId: f.orgId, size: 1 },
    f.headers,
  );
  expect(all.json().data).toMatchObject({ total: 2, pages: 2, size: 1 });
  const byTime = await post(
    '/organizations/approvals/records',
    {
      orgId: f.orgId,
      startAt: '2026-10-19 09:00:00',
      endAt: '2026-10-19 09:00:00',
      status: 'APPROVED',
      businessType: ' ORG_MEMBER_EXIT ',
    },
    f.headers,
  );
  expect(byTime.json().data).toMatchObject({
    total: 1,
    records: [
      {
        nodeId: second.id,
        actionType: 'AUTO_PASS',
        operatorName: 'SYSTEM',
        actionComment: 'latest',
        applicantName: '新昵称(新姓名)',
        targetMemberName: '新昵称(新姓名)',
      },
    ],
  });
  expect(
    (
      await post(
        '/organizations/approvals/records',
        { orgId: f.orgId, startAt: '2026-10-20 00:00:00', endAt: '2026-10-19 00:00:00' },
        f.headers,
      )
    ).statusCode,
  ).toBe(400);
});
test('due departure worker handles Shanghai midnight per member and retries idempotently', async () => {
  const f = await memberFixture(),
    due = await f.add('MEMBER', 'PENDING_LEAVE'),
    later = await f.add('MEMBER', 'PENDING_LEAVE');
  await db.userOrgRel.update({
    where: { id: due.rel.id },
    data: { plannedLeaveDate: new Date('2099-01-01T00:00:00Z') },
  });
  await db.userOrgRel.update({
    where: { id: later.rel.id },
    data: { plannedLeaveDate: new Date('2099-01-02T00:00:00Z') },
  });
  const service = new DepartureService(db);
  expect(await service.processDue(new Date('2098-12-31T15:59:59Z'), 1)).toMatchObject({
    processed: 0,
    failed: 0,
  });
  const result = await service.processDue(new Date('2098-12-31T16:00:00Z'), 1);
  expect(result).toEqual({ processed: 1, failed: 0, pendingProjectCleanup: 1 });
  expect(await db.userOrgRel.findUniqueOrThrow({ where: { id: due.rel.id } })).toMatchObject({
    joinStatus: 'LEFT',
    versionNo: 1,
    leftAt: new Date('2098-12-31T16:00:00Z'),
  });
  expect((await db.userOrgRel.findUniqueOrThrow({ where: { id: later.rel.id } })).joinStatus).toBe(
    'PENDING_LEAVE',
  );
  expect(await service.processDue(new Date('2098-12-31T16:00:00Z'), 1)).toEqual({
    processed: 0,
    failed: 0,
    pendingProjectCleanup: 1,
  });
});
test('approval kernel discovers legacy seed configuration and queries flows, nodes and ordered actions', async () => {
  const kernel = new ApprovalService(db);
  const process = await kernel.enabledProcess(' ORG_MEMBER_EXIT ');
  expect(process).toMatchObject({ status: 'ENABLED', version: 1 });
  expect(await kernel.configs(process!.id)).toMatchObject([
    {
      nodeCode: 'EXIT_APPROVAL',
      approverType: 'ROLE',
      approverConfig: { roleCodes: ['OWNER', 'ADMIN'] },
    },
  ]);
  const f = await memberFixture(),
    member = await f.add();
  const result = await requestSelfExit(f, member);
  const flow = await kernel.flow(result.json().data.flowNo);
  expect(await kernel.activeBusiness('ORG_MEMBER_EXIT', member.rel.id)).toMatchObject({
    id: flow!.id,
  });
  expect(await kernel.pendingNodes(f.owner.id)).toHaveLength(1);
  expect(await kernel.nodes(flow!.id, 1)).toMatchObject([
    { approverType: 'ORG_LEADER', approverId: f.owner.id, configId: null },
  ]);
  expect(await kernel.actions(flow!.id)).toMatchObject([{ actionType: 'SUBMIT' }]);
});

async function importHttp(
  orgId: string,
  headers: Record<string, string>,
  text: string,
  key = 'import-key',
) {
  const boundary = 'member-integration-import';
  const payload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="orgId"\r\n\r\n${orgId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="memberText"\r\n\r\n${text}\r\n--${boundary}--\r\n`,
  );
  return app.inject({
    method: 'POST',
    url: '/api/v1/organizations/member-imports/generate',
    headers: {
      ...headers,
      'idempotency-key': key,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}
test('member import creates passwordless EXPERT users and pending memberships atomically, then SMS activates before issuing a session', async () => {
  const f = await memberFixture();
  const imported = await importHttp(f.orgId, f.headers, '张三,13712345678,全职,管理员,2026-10-01');
  expect(imported.statusCode, imported.body).toBe(200);
  expect(imported.json().data).toMatchObject({
    createdCount: 1,
    sourceType: 'TEXT',
    members: [{ joinStatus: 'PENDING_ACTIVATION', position: 'ADMIN', phoneMasked: '137****5678' }],
  });
  const user = await db.user.findUniqueOrThrow({ where: { phoneE164: '+8613712345678' } });
  expect(user).toMatchObject({
    passwordHash: null,
    role: 'EXPERT',
    accountType: 'INDIVIDUAL',
    organizationId: null,
  });
  expect(
    (await post('/auth/login', { account: '13712345678', password: '095270' }, desktop)).statusCode,
  ).toBe(401);
  const before = await db.userOrgRel.findUniqueOrThrow({
    where: { userId_orgId: { userId: user.id, orgId: f.orgId } },
  });
  expect(before.joinedAt).toEqual(new Date('2026-09-30T16:00:00Z'));
  await send('login', '13712345678');
  const logged = await post('/auth/sms/login', { phone: '13712345678', code: '095270' }, desktop);
  expect(logged.statusCode, logged.body).toBe(200);
  expect(await db.userOrgRel.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({
    joinStatus: 'ACTIVE',
    versionNo: 1,
    updatedBy: user.uid,
  });
  expect(
    (
      await app.inject({ url: '/api/v1/users/me', headers: bearer(logged.json().data.accessToken) })
    ).json().data.organization,
  ).toMatchObject({ id: f.orgId, position: 'ADMIN', joinStatus: 'ACTIVE' });
  await send('login', '13712345678');
  expect(
    (await post('/auth/sms/login', { phone: '13712345678', code: '095270' }, desktop)).statusCode,
  ).toBe(200);
  expect((await db.userOrgRel.findUniqueOrThrow({ where: { id: before.id } })).versionNo).toBe(1);
});
test('invalid import reports every bad row without creating users or memberships and caches the validation result', async () => {
  const f = await memberFixture();
  const body =
    '张三,13712345678,全职\n李四,13712345678,兼职,主管,2026-02-30\n坏姓名1,wrong,错误属性';
  const result = await importHttp(f.orgId, f.headers, body);
  expect(result.statusCode, result.body).toBe(400);
  expect(result.json().data).toMatchObject({
    totalCount: 3,
    validCount: 0,
    invalidCount: 3,
    createdCount: 0,
    members: [],
    createdAt: null,
  });
  expect(result.json().data.rowErrors.length).toBeGreaterThan(4);
  expect(result.body).not.toContain('13712345678');
  expect(await db.user.count()).toBe(1);
  expect(await db.userOrgRel.count()).toBe(1);
  expect(await db.memberImportReceipt.count()).toBe(1);
  expect((await importHttp(f.orgId, f.headers, body)).json()).toEqual(result.json());
  expect((await importHttp(f.orgId, f.headers, '张三,13712345678,全职')).statusCode).toBe(409);
});
test('import reuses an unbound existing account and historical membership without overwriting profile, password or version', async () => {
  const f = await memberFixture(),
    existing = await f.add();
  await db.user.update({
    where: { id: existing.user.id },
    data: { bio: 'keep', passwordHash: 'keep-password', accountType: 'ORGANIZATION' },
  });
  await db.userOrgRel.update({
    where: { id: existing.rel.id },
    data: {
      joinStatus: 'LEFT',
      leftAt: new Date(),
      plannedLeaveDate: new Date('2026-10-01T00:00:00Z'),
      versionNo: 7,
    },
  });
  const original = await db.user.findUniqueOrThrow({ where: { id: existing.user.id } });
  const result = await importHttp(
    f.orgId,
    f.headers,
    `另名,${original.phoneE164.slice(3)},兼职,管理员`,
  );
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data.members[0]).toMatchObject({
    memberId: existing.rel.id,
    userId: original.id,
    accountType: 'ORGANIZATION',
    joinStatus: 'ACTIVE',
    position: 'ADMIN',
  });
  expect(await db.user.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  expect(await db.userOrgRel.findUniqueOrThrow({ where: { id: existing.rel.id } })).toMatchObject({
    versionNo: 8,
    leftAt: null,
    plannedLeaveDate: null,
    employmentType: 'PART_TIME',
  });
});
test('import rejects effective memberships in either organization, while unbound registered accounts join directly', async () => {
  const f = await memberFixture(),
    joined = await f.add();
  const other = await db.organization.create({ data: { name: '其他组织', expertiseTags: [] } });
  const foreign = await f.add();
  await db.userOrgRel.update({
    where: { id: foreign.rel.id },
    data: { orgId: other.id, joinStatus: 'PENDING_ACTIVATION' },
  });
  const unbound = await f.add();
  await db.userOrgRel.delete({ where: { id: unbound.rel.id } });
  const invalid = await importHttp(
    f.orgId,
    f.headers,
    `张三,${joined.user.phoneE164.slice(3)},全职\n李四,${foreign.user.phoneE164.slice(3)},兼职\n王五,${unbound.user.phoneE164.slice(3)},全职`,
  );
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().data).toMatchObject({ validCount: 1, invalidCount: 2, createdCount: 0 });
  expect(invalid.json().data.rowErrors.map((e: { errorCode: string }) => e.errorCode)).toEqual([
    'ACCOUNT_REGISTERED',
    'ALREADY_JOINED_OTHER_ORGANIZATION',
  ]);
  expect(await db.userOrgRel.count({ where: { userId: unbound.user.id } })).toBe(0);
  const valid = await importHttp(
    f.orgId,
    f.headers,
    `王五,${unbound.user.phoneE164.slice(3)},全职`,
    'unbound',
  );
  expect(valid.json().data.members[0]).toMatchObject({
    userId: unbound.user.id,
    joinStatus: 'ACTIVE',
  });
});
test('import scopes idempotency by operator and org, rejects concurrent replay or changed payload, expires after 24 hours', async () => {
  const f = await memberFixture();
  const body = '张三,13712345678,全职';
  const results = await Promise.all([
    importHttp(f.orgId, f.headers, body),
    importHttp(f.orgId, f.headers, body),
  ]);
  expect(results.some((r) => r.statusCode === 200)).toBe(true);
  expect(results.every((r) => [200, 409].includes(r.statusCode))).toBe(true);
  expect(await db.user.count()).toBe(2);
  expect(await db.memberImportReceipt.count()).toBe(1);
  const first = results.find((r) => r.statusCode === 200)!;
  expect((await importHttp(f.orgId.toUpperCase(), f.headers, body)).json()).toEqual(first.json());
  expect((await importHttp(f.orgId, f.headers, body)).json()).toEqual(first.json());
  expect((await importHttp(f.orgId, f.headers, '李四,13712345679,兼职')).statusCode).toBe(409);
  const receipt = await db.memberImportReceipt.findFirstOrThrow();
  expect(receipt.expiresAt.getTime() - receipt.createdAt.getTime()).toBeGreaterThanOrEqual(
    86_399_000,
  );
  await db.memberImportReceipt.updateMany({ data: { expiresAt: new Date(0) } });
  const afterExpiry = await importHttp(f.orgId, f.headers, body);
  expect(afterExpiry.statusCode).toBe(400);
  expect(afterExpiry.json().data.rowErrors[0].errorCode).toBe('ACCOUNT_REGISTERED');
});
test('cross-organization concurrent import of one phone has exactly one membership winner', async () => {
  const f = await memberFixture();
  const other = await db.organization.create({ data: { name: '并发导入组织', expertiseTags: [] } });
  await db.userOrgRel.create({
    data: { orgId: other.id, userId: f.owner.id, uid: f.owner.uid, position: 'OWNER' },
  });
  const results = await Promise.all([
    importHttp(f.orgId, f.headers, '张三,13712345678,全职', 'shared'),
    importHttp(other.id, f.headers, '张三,13712345678,全职', 'shared'),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  const user = await db.user.findUniqueOrThrow({ where: { phoneE164: '+8613712345678' } });
  expect(await db.userOrgRel.count({ where: { userId: user.id } })).toBe(1);
  expect(results.find((r) => r.statusCode === 400)!.json().data.rowErrors[0].errorCode).toBe(
    'ALREADY_JOINED_OTHER_ORGANIZATION',
  );
});
test('concurrent imports and role promotions share administrator capacity and count pending activation slots', async () => {
  const f = await memberFixture();
  for (let i = 0; i < 4; i++) await f.add('ADMIN');
  const target = await f.add();
  const results = await Promise.all([
    importHttp(f.orgId, f.headers, '张三,13712345678,全职,管理员'),
    post(
      '/organizations/members/position',
      { orgId: f.orgId, memberId: target.rel.id, position: 'ADMIN' },
      f.headers,
    ),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  expect(await db.userOrgRel.count({ where: { orgId: f.orgId, position: 'ADMIN' } })).toBe(5);
  if (results[0]!.statusCode === 400)
    expect(await db.user.findUnique({ where: { phoneE164: '+8613712345678' } })).toBeNull();
});
test('XLS/XLSX template files and CSV upload prioritize nonempty file and retain full validation results', async () => {
  const f = await memberFixture();
  for (const [index, bookType] of (['xls', 'xlsx'] as const).entries()) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['姓名', '手机号', '人员属性', '组织内角色', '入组时间'],
        ['张三', `1371234567${index}`, '全职', '成员', '2026-10-01'],
      ]),
      'members',
    );
    const boundary = 'excel-import-' + bookType;
    const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType }));
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="csvFile"; filename="members.${bookType}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="memberText"\r\n\r\ninvalid ignored text\r\n--${boundary}--\r\n`,
      ),
    ]);
    const result = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/member-imports/generate?orgId=${f.orgId}`,
      headers: {
        ...f.headers,
        'idempotency-key': bookType,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().data).toMatchObject({
      sourceType: 'EXCEL',
      textIgnored: true,
      createdCount: 1,
    });
  }
  const member = await f.add();
  expect((await importHttp(f.orgId, member.headers, '张三,13712345678,全职')).statusCode).toBe(403);
});
test('password login activates pending memberships in the token transaction after reset, refresh does not increment again', async () => {
  const f = await memberFixture();
  await importHttp(f.orgId, f.headers, '张三,13712345678,全职');
  await send('reset_password', '13712345678');
  expect(
    (
      await post(
        '/auth/password/reset',
        {
          phone: '13712345678',
          code: '095270',
          newPassword: 'Changed123!',
        },
        desktop,
      )
    ).statusCode,
  ).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { phoneE164: '+8613712345678' } });
  expect((await db.userOrgRel.findFirstOrThrow({ where: { userId: user.id } })).joinStatus).toBe(
    'PENDING_ACTIVATION',
  );
  const logged = await post(
    '/auth/login',
    { account: '13712345678', password: 'Changed123!' },
    desktop,
  );
  expect(logged.statusCode, logged.body).toBe(200);
  expect((await db.userOrgRel.findFirstOrThrow({ where: { userId: user.id } })).versionNo).toBe(1);
  expect(
    (await post('/auth/refresh', { refreshToken: logged.json().data.refreshToken }, desktop))
      .statusCode,
  ).toBe(200);
  expect((await db.userOrgRel.findFirstOrThrow({ where: { userId: user.id } })).versionNo).toBe(1);
});
test('injected activation failure rolls back code consumption and relation update and creates no session', async () => {
  const f = await memberFixture();
  await importHttp(f.orgId, f.headers, '张三,13712345678,全职');
  await send('login', '13712345678');
  const before = await db.session.count();
  const failing = new Proxy(db, {
    get(target, key) {
      if (key === '$transaction')
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          db.$transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, property) {
                  if (property === 'userOrgRel')
                    return {
                      ...transaction.userOrgRel,
                      updateMany: async (args: Prisma.UserOrgRelUpdateManyArgs) => {
                        await transaction.userOrgRel.updateMany(args);
                        throw new Error('injected activation failure');
                      },
                    };
                  return Reflect.get(transaction, property);
                },
              }),
            ),
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(
    new AuthService(failing, config).loginBySms(
      { phone: '13712345678', code: '095270' },
      '127.0.0.1',
      'desktop',
    ),
  ).rejects.toThrow('injected activation failure');
  expect(await db.session.count()).toBe(before);
  const user = await db.user.findUniqueOrThrow({ where: { phoneE164: '+8613712345678' } });
  expect(await db.userOrgRel.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
    joinStatus: 'PENDING_ACTIVATION',
    versionNo: 0,
  });
  expect(
    (
      await db.verificationChallenge.findFirstOrThrow({
        where: { phoneE164: '+8613712345678', purpose: 'login' },
      })
    ).consumedAt,
  ).toBeNull();
});
test('failure after first account creation rolls back the whole batch and its idempotency receipt', async () => {
  const f = await memberFixture();
  let creates = 0;
  const failing = new Proxy(db, {
    get(target, key) {
      if (key === '$transaction')
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          db.$transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, property) {
                  if (property === 'user')
                    return {
                      ...transaction.user,
                      create: async (args: Prisma.UserCreateArgs) => {
                        creates++;
                        if (creates === 2) throw new Error('injected batch failure');
                        return transaction.user.create(args);
                      },
                    };
                  return Reflect.get(transaction, property);
                },
              }),
            ),
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const principal = {
    userId: f.owner.id,
    uid: f.owner.uid,
    role: 'EXPERT' as const,
    sessionId: 'test',
    clientType: 'desktop' as const,
  };
  const body = '张三,13712345678,全职\n李四,13712345679,兼职';
  await expect(
    new MemberImportService(failing).generate('rollback', f.orgId, principal, undefined, body),
  ).rejects.toThrow('injected batch failure');
  expect(await db.user.count()).toBe(1);
  expect(await db.userOrgRel.count()).toBe(1);
  expect(await db.memberImportReceipt.count()).toBe(0);
  expect((await importHttp(f.orgId, f.headers, body, 'rollback')).statusCode).toBe(200);
});

test('independent management grants authorize existing EXPERT sessions and revoke without relogin', async () => {
  const created = (await register({ roles: ['NAVIGATOR', 'PM'] })).json().data;
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const get = () => app.inject({ url: '/api/v1/project-categories', headers });
  expect((await get()).statusCode).toBe(403);
  await db.user.update({ where: { id: created.id }, data: { role: 'NAVIGATOR' } });
  expect((await get()).statusCode).toBe(403);
  await db.user.update({ where: { id: created.id }, data: { role: 'EXPERT' } });
  const grants = new ManagementService(db);
  const input = {
    uid: created.uid,
    role: 'NAVIGATOR' as const,
    action: 'GRANT' as const,
    actor: 'integration-operator',
    reason: '独立授权集成验证',
  };
  expect(await grants.change(input)).toEqual({ changed: true });
  expect(await grants.change(input)).toEqual({ changed: false });
  expect((await get()).json()).toEqual({ code: 200, message: '操作成功', data: [] });
  const profile = (await app.inject({ url: '/api/v1/users/me', headers })).json().data;
  expect(profile.role).toBe('EXPERT');
  expect(profile.roles).toEqual(['EXPERT']);
  expect(await grants.change({ ...input, action: 'REVOKE' })).toEqual({ changed: true });
  expect((await get()).statusCode).toBe(403);
  expect(await grants.change({ ...input, action: 'REVOKE' })).toEqual({ changed: false });
  expect(
    await db.managementGrantAudit.findMany({
      where: { userId: created.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    }),
  ).toEqual([{ action: 'GRANT' }, { action: 'REVOKE' }]);
});

test('management grant mutation rolls back when its audit write fails', async () => {
  const user = (await register()).json().data;
  const failing = new Proxy(db, {
    get(target, key) {
      if (key === '$transaction')
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          db.$transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, property) {
                  if (property === 'managementGrantAudit')
                    return {
                      ...transaction.managementGrantAudit,
                      create: async (args: Prisma.ManagementGrantAuditCreateArgs) => {
                        await transaction.managementGrantAudit.create(args);
                        throw new Error('injected management audit failure');
                      },
                    };
                  return Reflect.get(transaction, property);
                },
              }),
            ),
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(
    new ManagementService(failing).change({
      uid: user.uid,
      role: 'NAVIGATOR',
      action: 'GRANT',
      actor: 'integration-operator',
      reason: '事务回滚验证',
    }),
  ).rejects.toThrow('injected management audit failure');
  expect(await db.managementGrant.count({ where: { userId: user.id } })).toBe(0);
  expect(await db.managementGrantAudit.count({ where: { userId: user.id } })).toBe(0);
});

test('project category dictionary filters enabled levels and aliases with deterministic sorting', async () => {
  const user = (await register()).json().data;
  const headers = bearer((await login(desktop)).json().data.accessToken);
  await new ManagementService(db).change({
    uid: user.uid,
    role: 'NAVIGATOR',
    action: 'GRANT',
    actor: 'integration-operator',
    reason: '分类查询验证',
  });
  const base = {
    categoryLevel: 1,
    sortNo: 10,
    createdBy: 'integration-operator',
    updatedBy: 'integration-operator',
  };
  const first = await db.projectCategory.create({
    data: { ...base, categoryCode: 'IMAGE', categoryName: '图片分类', searchKeywords: 'tupian' },
  });
  const second = await db.projectCategory.create({
    data: { ...base, categoryCode: 'TEXT', categoryName: '文本分类' },
  });
  const level2 = await db.projectCategory.create({
    data: { ...base, categoryLevel: 2, categoryCode: 'AUDIO', categoryName: '音频分类' },
  });
  await db.projectCategory.create({
    data: { ...base, categoryCode: 'DISABLED', categoryName: '停用分类', status: 'DISABLED' },
  });
  const get = async (query = '') =>
    (await app.inject({ url: `/api/v1/project-categories${query}`, headers })).json().data;
  expect((await get()).map((row: { id: number }) => row.id)).toEqual([
    first.id,
    second.id,
    level2.id,
  ]);
  expect((await get('?categoryLevel=2')).map((row: { id: number }) => row.id)).toEqual([level2.id]);
  expect(await get('?keyword=%20tupian%20')).toEqual([
    { id: first.id, categoryCode: 'IMAGE', categoryName: '图片分类', categoryLevel: 1, sortNo: 10 },
  ]);
  expect(await get('?keyword=missing')).toEqual([]);
});

test('requester backfill enforces NAVIGATOR, self ownership and actual account type', async () => {
  const user = (await register()).json().data;
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const path = `/api/v1/project-requesters/INDIVIDUAL/${user.id}/backfill`;
  expect((await app.inject({ url: path, headers })).statusCode).toBe(403);
  await new ManagementService(db).change({
    uid: user.uid,
    role: 'NAVIGATOR',
    action: 'GRANT',
    actor: 'integration-operator',
    reason: '本人需求方验证',
  });
  expect((await app.inject({ url: path, headers })).json()).toEqual({
    code: 200,
    message: '操作成功',
    data: {
      requesterType: 'INDIVIDUAL',
      requesterId: user.id,
      requesterName: '小明(小明)',
      orgId: null,
      orgVerifyStatus: null,
    },
  });
  expect(
    (await app.inject({ url: path.replace('INDIVIDUAL', 'ORGANIZATION'), headers })).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        url: '/api/v1/project-requesters/INDIVIDUAL/00000000-0000-4000-8000-000000000099/backfill',
        headers,
      })
    ).statusCode,
  ).toBe(403);
});

test('concurrent grants serialize on the user and preserve one active grant with one audit', async () => {
  const user = (await register()).json().data;
  const service = new ManagementService(db);
  const input = {
    uid: user.uid,
    role: 'PM' as const,
    action: 'GRANT' as const,
    actor: 'integration-operator',
    reason: '并发授权验证',
  };
  const results = await Promise.all([service.change(input), service.change(input)]);
  expect(results.filter((r) => r.changed)).toHaveLength(1);
  expect(
    await db.managementGrant.count({ where: { userId: user.id, role: 'PM', revokedAt: null } }),
  ).toBe(1);
  expect(await db.managementGrantAudit.count({ where: { userId: user.id, role: 'PM' } })).toBe(1);
  const headers = bearer((await login(desktop)).json().data.accessToken);
  expect((await app.inject({ url: '/api/v1/project-categories', headers })).statusCode).toBe(403);
});

test('organization requester backfill uses actual membership and retains organization verification status', async () => {
  const user = (
    await register({ accountType: 'ORGANIZATION', organization: { name: '示例需求方团队' } })
  ).json().data;
  const headers = bearer((await login(desktop)).json().data.accessToken);
  await new ManagementService(db).change({
    uid: user.uid,
    role: 'NAVIGATOR',
    action: 'GRANT',
    actor: 'integration-operator',
    reason: '组织需求方验证',
  });
  const url = `/api/v1/project-requesters/ORGANIZATION/${user.id}/backfill`;
  const response = await app.inject({ url, headers });
  expect(response.json().data).toEqual({
    requesterType: 'ORGANIZATION',
    requesterId: user.id,
    requesterName: '示例需求方团队',
    orgId: user.organization.id,
    orgVerifyStatus: 'PENDING',
  });
  await db.userOrgRel.updateMany({ where: { userId: user.id }, data: { joinStatus: 'LEFT' } });
  expect((await app.inject({ url, headers })).statusCode).toBe(400);
});

async function projectTestAccount(phoneValue: string) {
  const user = await db.user.create({
    data: {
      phoneE164: `+86${phoneValue}`,
      phoneRegion: 'CN',
      username: `other${phoneValue}`,
      displayName: `其他${phoneValue}`,
    },
  });
  const token = 'p'.repeat(43);
  await db.session.create({
    data: {
      userId: user.id,
      tokenDigest: digest(token),
      clientType: 'desktop',
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  return { user, headers: bearer(token) };
}

async function projectCreationFixture() {
  const user = (await register()).json().data;
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const categories = [];
  for (const [index, level] of [1, 2, 3, 3].entries())
    categories.push(
      await db.projectCategory.create({
        data: {
          categoryCode: `PROJECT_${index}`,
          categoryName: `项目分类${index}`,
          categoryLevel: level,
          createdBy: 'test-operator',
          updatedBy: 'test-operator',
        },
      }),
    );
  const payload = {
    operation: 'CREATE_PROJECT',
    projectName: '图片分类项目',
    categoryLevel1Id: categories[0]!.id,
    categoryLevel2Id: categories[1]!.id,
    categoryLevel3Ids: [categories[3]!.id, categories[2]!.id],
    difficultyLevel: 'MEDIUM',
    projectQuantity: 10000.1234,
    quantityUnit: '张',
    deadline: '2099-12-31 18:00:00',
    requiredHeadcount: 20,
    employmentType: 'PART_TIME',
    standardContent: '按照商品主体分类',
    mandatoryRequirement: '遵守作业规范',
  };
  const save = (data: unknown) => post('/projects/create', data, headers);
  const draft = () => app.inject({ url: '/api/v1/projects/draft/current', headers });
  return { user, headers, payload, save, draft, categories };
}

test('EXPERT without management grant saves one isolated draft, clears snapshot fields and preserves education default', async () => {
  expect(await db.project.count()).toBe(0);
  const f = await projectCreationFixture();
  expect((await f.draft()).json().data).toEqual({ hasDraft: false, draft: null });
  const first = await f.save({
    ...f.payload,
    operation: 'SAVE_DRAFT',
    educationRequirement: 'MASTER',
  });
  expect(first.statusCode).toBe(200);
  expect(first.json().data).toMatchObject({
    operation: 'SAVE_DRAFT',
    status: 'DRAFT',
    versionNo: 0,
    currentNodeCode: null,
    publishedAt: null,
  });
  const data = (await f.draft()).json().data.draft;
  expect(data.categoryLevel3Ids).toEqual(f.payload.categoryLevel3Ids);
  expect(data.categoryLevel3Names).toEqual(['项目分类3', '项目分类2']);
  expect(data.projectQuantity).toBe(10000.1234);
  expect(data.attachments).toEqual([]);
  expect(data.creatorName).toBeNull();
  expect(data).not.toHaveProperty('productionRequirements');
  const cleared = await f.save({ operation: 'SAVE_DRAFT', versionNo: data.versionNo });
  expect(cleared.json().data.versionNo).toBe(1);
  const after = (await f.draft()).json().data.draft;
  expect(after).toMatchObject({
    projectName: null,
    projectDescription: null,
    educationRequirement: 'BACHELOR',
    deadline: null,
    categoryLevel1Id: null,
    categoryLevel1Name: null,
    categoryLevel3Ids: [],
    categoryLevel3Names: [],
  });
  expect(await db.project.count({ where: { createdBy: f.user.uid, status: 'DRAFT' } })).toBe(1);
  const outsider = await projectTestAccount('13900000009');
  expect(
    (await app.inject({ url: '/api/v1/projects/draft/current', headers: outsider.headers })).json()
      .data,
  ).toEqual({ hasDraft: false, draft: null });
});

test('concurrent draft creation and version updates have exactly one winner', async () => {
  const f = await projectCreationFixture();
  const created = await Promise.all([
    f.save({ operation: 'SAVE_DRAFT', projectName: '草稿一' }),
    f.save({ operation: 'SAVE_DRAFT', projectName: '草稿二' }),
  ]);
  expect(created.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  expect(await db.project.count()).toBe(1);
  const updated = await Promise.all([
    f.save({ operation: 'SAVE_DRAFT', versionNo: 0, projectName: '更新一' }),
    f.save({ operation: 'SAVE_DRAFT', versionNo: 0, projectName: '更新二' }),
  ]);
  expect(updated.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect((await f.draft()).json().data.draft.versionNo).toBe(1);
});

test('publish requires actual old service fields, advances the node and leaves the next draft independent', async () => {
  const f = await projectCreationFixture();
  expect(
    (
      await f.save({
        ...f.payload,
        standardContent: null,
        standardLink: 'https://example.com/standard',
      })
    ).statusCode,
  ).toBe(400);
  expect((await f.save({ ...f.payload, mandatoryRequirement: null })).statusCode).toBe(400);
  const saved = await f.save({ ...f.payload, operation: 'SAVE_DRAFT' });
  const result = await f.save({ ...f.payload, versionNo: saved.json().data.versionNo });
  expect(result.statusCode).toBe(200);
  expect(result.json().data).toMatchObject({
    id: saved.json().data.id,
    status: 'PUBLISHED',
    currentNodeCode: 'RECRUIT_PROJECT_MANAGER',
    versionNo: 1,
  });
  expect(result.json().data.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect((await f.draft()).json().data).toEqual({ hasDraft: false, draft: null });
  const next = await f.save({ operation: 'SAVE_DRAFT' });
  expect(next.statusCode).toBe(200);
  expect(next.json().data.id).not.toBe(result.json().data.id);
  expect(next.json().data.versionNo).toBe(0);
});

test('concurrent publishing prevents duplicate names and a failed publication preserves its prior draft', async () => {
  const f = await projectCreationFixture();
  const results = await Promise.all([f.save(f.payload), f.save(f.payload)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await db.project.count({ where: { status: 'PUBLISHED' } })).toBe(1);
  const saved = await f.save({ operation: 'SAVE_DRAFT', projectName: '原草稿' });
  const conflict = await f.save({ ...f.payload, versionNo: saved.json().data.versionNo });
  expect(conflict.statusCode).toBe(409);
  expect((await f.draft()).json().data.draft).toMatchObject({
    projectName: '原草稿',
    versionNo: 0,
  });
});

test('category level and status validation preserves original snapshots and selection order', async () => {
  const f = await projectCreationFixture();
  expect((await f.save({ ...f.payload, categoryLevel1Id: f.categories[1]!.id })).statusCode).toBe(
    400,
  );
  expect(
    (await f.save({ ...f.payload, categoryLevel3Ids: [f.categories[2]!.id, f.categories[2]!.id] }))
      .statusCode,
  ).toBe(400);
  await db.projectCategory.update({
    where: { id: f.categories[0]!.id },
    data: { status: 'DISABLED' },
  });
  expect((await f.save(f.payload)).statusCode).toBe(400);
  await db.projectCategory.update({
    where: { id: f.categories[0]!.id },
    data: { status: 'ENABLED' },
  });
  expect((await f.save({ ...f.payload, operation: 'SAVE_DRAFT' })).statusCode).toBe(200);
  await db.projectCategory.update({
    where: { id: f.categories[0]!.id },
    data: { categoryName: '改名分类' },
  });
  expect((await f.draft()).json().data.draft.categoryLevel1Name).toBe('项目分类0');
});

test('draft ownership, invalid dates and nonpositive values cannot write projects', async () => {
  const f = await projectCreationFixture();
  const other = await projectTestAccount('13900000009');
  expect((await f.save({ operation: 'SAVE_DRAFT', requesterId: other.user.id })).statusCode).toBe(
    403,
  );
  for (const extra of [
    { requesterType: 'ORGANIZATION' },
    { projectQuantity: 0 },
    { projectQuantity: -1 },
    { requiredHeadcount: 0 },
    { deadline: '2026-02-30 18:00:00' },
    { deadline: '2000-01-01 00:00:00' },
  ])
    expect((await f.save({ operation: 'SAVE_DRAFT', ...extra })).statusCode).toBe(400);
  expect(await db.project.count()).toBe(0);
});

test('project attachment claim, retain, release and creator grant access share actual business relationships', async () => {
  const f = await projectCreationFixture();
  const upload = await uploaded('PROJECT_ATTACHMENT', f.user.uid);
  const attached = await f.save({
    operation: 'SAVE_DRAFT',
    attachments: [
      {
        attachmentType: 'STANDARD_REFERENCE',
        objectKey: upload.record.objectKey,
        uploadToken: upload.uploadToken,
      },
    ],
  });
  expect(attached.statusCode).toBe(200);
  const version = attached.json().data.versionNo;
  const detail = (await f.draft()).json().data.draft;
  expect(detail.attachments).toHaveLength(1);
  expect(detail.attachments[0]).toMatchObject({
    fileName: 'test.png',
    objectKey: upload.record.objectKey,
    fileSize: 10,
    status: 'ACTIVE',
  });
  expect(JSON.stringify(detail)).not.toContain(upload.uploadToken);
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { id: upload.record.id } })).claimedBizId,
  ).toBe(String(detail.id));
  const url = `/api/v1/files/view?objectKey=${encodeURIComponent(upload.record.objectKey)}`;
  // EXPERT上传者身份不替代旧NAVIGATOR创建人授权。
  expect((await app.inject({ url, headers: f.headers })).statusCode).toBe(403);
  const grants = new ManagementService(db);
  const grant = {
    uid: f.user.uid,
    role: 'NAVIGATOR' as const,
    action: 'GRANT' as const,
    actor: 'test-operator',
    reason: '创建人附件权限验证',
  };
  await grants.change(grant);
  expect((await app.inject({ url, headers: f.headers })).statusCode).toBe(200);
  const other = await projectTestAccount('13900000009');
  await grants.change({ ...grant, uid: other.user.uid });
  expect((await app.inject({ url, headers: other.headers })).statusCode).toBe(403);
  await grants.change({ ...grant, action: 'REVOKE' });
  expect((await app.inject({ url, headers: f.headers })).statusCode).toBe(403);
  const keep = await f.save({
    operation: 'SAVE_DRAFT',
    versionNo: version,
    attachments: [{ id: detail.attachments[0].id, sortNo: 2 }],
  });
  expect(keep.statusCode).toBe(200);
  expect((await f.draft()).json().data.draft.attachments[0].sortNo).toBe(2);
  expect(
    (
      await f.save({
        operation: 'SAVE_DRAFT',
        versionNo: keep.json().data.versionNo,
        attachments: [],
      })
    ).statusCode,
  ).toBe(200);
  expect((await f.draft()).json().data.draft.attachments).toEqual([]);
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { id: upload.record.id } })).status,
  ).toBe('RELEASED');
  expect(
    await db.projectAttachment.findUniqueOrThrow({ where: { id: detail.attachments[0].id } }),
  ).toMatchObject({ status: 'DELETED' });
});

test('invalid attachment token rolls back the new project, category snapshots and claim', async () => {
  const f = await projectCreationFixture();
  const upload = await uploaded('PROJECT_ATTACHMENT', f.user.uid);
  const failed = await f.save({
    ...f.payload,
    attachments: [
      { attachmentType: 'CASE', objectKey: upload.record.objectKey, uploadToken: 'wrong-token' },
    ],
  });
  expect(failed.statusCode).toBe(403);
  expect(await db.project.count()).toBe(0);
  expect(await db.projectCategoryRelation.count()).toBe(0);
  expect(await db.projectAttachment.count()).toBe(0);
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { id: upload.record.id } })).status,
  ).toBe('UPLOADED');
});

test('foreign upload ownership, duplicate attachments and invalid retained IDs cannot partially mutate a draft', async () => {
  const f = await projectCreationFixture();
  const upload = await uploaded('PROJECT_ATTACHMENT', 'other-uid');
  expect(
    (
      await f.save({
        operation: 'SAVE_DRAFT',
        attachments: [
          {
            attachmentType: 'CASE',
            objectKey: upload.record.objectKey,
            uploadToken: upload.uploadToken,
          },
        ],
      })
    ).statusCode,
  ).toBe(403);
  await db.uploadedFile.update({ where: { id: upload.record.id }, data: { ownerUid: f.user.uid } });
  const attachment = {
    attachmentType: 'CASE',
    objectKey: upload.record.objectKey,
    uploadToken: upload.uploadToken,
  };
  expect(
    (await f.save({ operation: 'SAVE_DRAFT', attachments: [attachment, attachment] })).statusCode,
  ).toBe(400);
  expect(await db.project.count()).toBe(0);
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { id: upload.record.id } })).status,
  ).toBe('UPLOADED');
  const saved = await f.save({
    operation: 'SAVE_DRAFT',
    projectName: '原草稿',
    attachments: [attachment],
  });
  expect(saved.statusCode).toBe(200);
  const old = (await f.draft()).json().data.draft;
  const failed = await f.save({
    operation: 'SAVE_DRAFT',
    projectName: '新名称',
    versionNo: 0,
    attachments: [{ id: old.attachments[0].id }, { id: 2147483647 }],
  });
  expect(failed.statusCode).toBe(400);
  expect((await f.draft()).json().data.draft).toMatchObject({
    projectName: '原草稿',
    versionNo: 0,
  });
  expect(await db.projectAttachment.count({ where: { status: 'ACTIVE' } })).toBe(1);
});

test('attachment release failure rolls back project version, attachment removal and file release together', async () => {
  const f = await projectCreationFixture();
  const upload = await uploaded('PROJECT_ATTACHMENT', f.user.uid);
  const saved = await f.save({
    operation: 'SAVE_DRAFT',
    projectName: '原草稿',
    attachments: [
      {
        attachmentType: 'CASE',
        objectKey: upload.record.objectKey,
        uploadToken: upload.uploadToken,
      },
    ],
  });
  expect(saved.statusCode).toBe(200);
  class FailingRegistry extends FileRegistryService {
    override async releaseProjectAttachment(
      tx: Prisma.TransactionClient,
      key: string,
      projectId: string,
    ) {
      await super.releaseProjectAttachment(tx, key, projectId);
      throw new Error('injected project release failure');
    }
  }
  const files = new FailingRegistry(db, storage, config.files);
  await expect(
    new ProjectCreationService(db, files).save(
      { operation: 'SAVE_DRAFT', versionNo: 0, projectName: '新名称', attachments: [] },
      {
        userId: f.user.id,
        uid: f.user.uid,
        sessionId: 'test',
        role: 'EXPERT',
        clientType: 'desktop',
      },
    ),
  ).rejects.toThrow('injected project release failure');
  expect((await f.draft()).json().data.draft).toMatchObject({
    projectName: '原草稿',
    versionNo: 0,
  });
  expect(await db.projectAttachment.count({ where: { status: 'ACTIVE' } })).toBe(1);
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { id: upload.record.id } })).status,
  ).toBe('CLAIMED');
});

test('organization project requester snapshots the selected organization and rejects mismatched self type', async () => {
  const user = (
    await register({ accountType: 'ORGANIZATION', organization: { name: '项目需求方组织' } })
  ).json().data;
  const headers = bearer((await login(desktop)).json().data.accessToken);
  expect(
    (
      await post(
        '/projects/create',
        { operation: 'SAVE_DRAFT', requesterType: 'INDIVIDUAL' },
        headers,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await post(
        '/projects/create',
        { operation: 'SAVE_DRAFT', requesterType: 'ORGANIZATION', requesterId: user.id },
        headers,
      )
    ).statusCode,
  ).toBe(200);
  await db.organization.update({
    where: { id: user.organization.id },
    data: { name: '改名需求方组织' },
  });
  const draft = (await app.inject({ url: '/api/v1/projects/draft/current', headers })).json().data
    .draft;
  expect(draft).toMatchObject({
    requesterType: 'ORGANIZATION',
    requesterId: user.id,
    requesterName: '项目需求方组织',
  });
});

test('business identifier migration preserves UUID claims and supports numeric project claim and release without persisting preview DDL', async () => {
  const license = await uploaded('BUSINESS_LICENSE');
  const project = await uploaded('PROJECT_ATTACHMENT', 'test-owner');
  const organizationId = '00000000-0000-4000-8000-000000000002';
  const columnType = () => db.$queryRaw<{ data_type: string }[]>`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'UploadedFile' AND column_name = 'claimedBizId'`;
  const before = await columnType();
  const migration = readFileSync(
    new URL(
      '../prisma/migrations/20261019070000_file_business_identifiers/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  // 使用新连接执行DDL预演，避免复用主客户端已缓存的UUID返回类型计划。
  const previewDb = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  try {
    await expect(
      previewDb.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "UploadedFile" SET "claimedBizId" = ${organizationId}::uuid, "claimedBizType" = 'ORGANIZATION_BUSINESS_LICENSE', "status" = 'CLAIMED' WHERE "id" = ${license.record.id}::uuid`;
        await tx.$executeRawUnsafe(migration);
        expect(
          (await tx.uploadedFile.findUniqueOrThrow({ where: { id: license.record.id } }))
            .claimedBizId,
        ).toBe(organizationId);
        await registry.claimForProject(
          tx,
          project.record.objectKey,
          project.uploadToken,
          'test-owner',
          '3001',
        );
        expect(
          (await tx.uploadedFile.findUniqueOrThrow({ where: { id: project.record.id } }))
            .claimedBizId,
        ).toBe('3001');
        expect(
          (await registry.releaseProjectAttachment(tx, project.record.objectKey, '3001')).count,
        ).toBe(1);
        expect(
          (await tx.uploadedFile.findUniqueOrThrow({ where: { id: project.record.id } })).status,
        ).toBe('RELEASED');
        throw new Error('rollback migration preview');
      }),
    ).rejects.toThrow('rollback migration preview');
  } finally {
    await previewDb.$disconnect();
  }
  expect(await columnType()).toEqual(before);
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { id: license.record.id } })).claimedBizId,
  ).toBeNull();
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { id: project.record.id } })).status,
  ).toBe('UPLOADED');
});

async function projectManagerAccount(
  sequence: number,
  creditScore: number | null = 100,
  grant = true,
) {
  const user = await db.user.create({
    data: {
      phoneE164: `+86137${String(sequence).padStart(8, '0')}`,
      phoneRegion: 'CN',
      username: `manager${sequence}`,
      displayName: `策略官${sequence}`,
      realName: `姓名${sequence}`,
      creditScore,
    },
  });
  const token = `z${String(sequence).padStart(42, '0')}`;
  await db.session.create({
    data: {
      userId: user.id,
      tokenDigest: digest(token),
      clientType: 'desktop',
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  if (grant)
    await new ManagementService(db).change({
      uid: user.uid,
      role: 'PM',
      action: 'GRANT',
      actor: 'integration-operator',
      reason: '策略官集成验证',
    });
  return { user, headers: bearer(token) };
}
async function projectManagerFixture() {
  const f = await projectCreationFixture();
  await new ManagementService(db).change({
    uid: f.user.uid,
    role: 'NAVIGATOR',
    action: 'GRANT',
    actor: 'integration-operator',
    reason: '项目管理集成验证',
  });
  const published = await f.save(f.payload);
  expect(published.statusCode).toBe(200);
  const projectId: number = published.json().data.id;
  const recruit = (candidateUserId: string) =>
    post('/projects/manager-recruitments', { projectId, candidateUserId }, f.headers);
  const candidates = (keyword = '') =>
    app.inject({
      url: `/api/v1/projects/manager-candidates?projectId=${projectId}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`,
      headers: f.headers,
    });
  return { ...f, projectId, recruit, candidates };
}

test('manager candidate order uses real assigned load then credit and excludes legacy roles without grants', async () => {
  const f = await projectManagerFixture();
  const low = await projectManagerAccount(1, 50),
    high = await projectManagerAccount(2, 90),
    unknown = await projectManagerAccount(3, null);
  const legacy = await projectManagerAccount(4, 100, false);
  await db.user.update({ where: { id: legacy.user.id }, data: { role: 'PM' } });
  expect((await f.candidates()).json().data.map((r: { userId: string }) => r.userId)).toEqual([
    high.user.id,
    low.user.id,
    unknown.user.id,
  ]);
  expect((await f.recruit(low.user.id)).statusCode).toBe(200);
  const nextProject = await f.save({ ...f.payload, projectName: '另一个项目' });
  expect(nextProject.statusCode).toBe(200);
  expect(
    (
      await post(
        '/projects/manager-recruitments',
        { projectId: nextProject.json().data.id, candidateUserId: high.user.id },
        f.headers,
      )
    ).statusCode,
  ).toBe(200);
  const rows = (await f.candidates()).json().data;
  expect(rows.map((r: { userId: string }) => r.userId)).toEqual([
    low.user.id,
    unknown.user.id,
    high.user.id,
  ]);
  expect(rows[0]).toMatchObject({
    status: 'CURRENT',
    currentProjectCount: 1,
    name: '策略官1(姓名1)',
  });
  expect(rows[2].currentProjectCount).toBe(1);
  expect(
    (await f.candidates('策略官2')).json().data.map((r: { userId: string }) => r.userId),
  ).toEqual([high.user.id]);
  expect((await f.candidates('no-match')).json().data).toEqual([]);
  expect(JSON.stringify(rows)).not.toContain('creditScore');
});

test('manager candidates and recruit enforce independent NAVIGATOR plus own published project', async () => {
  const f = await projectManagerFixture(),
    manager = await projectManagerAccount(1);
  const outsider = await projectTestAccount('13900000009');
  await new ManagementService(db).change({
    uid: outsider.user.uid,
    role: 'NAVIGATOR',
    action: 'GRANT',
    actor: 'integration-operator',
    reason: '跨项目拒绝验证',
  });
  expect(
    (
      await post(
        '/projects/manager-recruitments',
        { projectId: f.projectId, candidateUserId: manager.user.id },
        outsider.headers,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        url: `/api/v1/projects/manager-candidates?projectId=${f.projectId}`,
        headers: outsider.headers,
      })
    ).statusCode,
  ).toBe(403);
  const draft = await f.save({ operation: 'SAVE_DRAFT' });
  expect(
    (
      await post(
        '/projects/manager-recruitments',
        { projectId: draft.json().data.id, candidateUserId: manager.user.id },
        f.headers,
      )
    ).statusCode,
  ).toBe(400);
  await new ManagementService(db).change({
    uid: f.user.uid,
    role: 'NAVIGATOR',
    action: 'REVOKE',
    actor: 'integration-operator',
    reason: '撤销管理授权',
  });
  expect((await f.candidates()).statusCode).toBe(403);
  expect((await f.recruit(manager.user.id)).statusCode).toBe(403);
  expect(await db.projectManagerRecruitment.count()).toBe(0);
  expect(await db.projectEventOutbox.count()).toBe(0);
});

test('initial manager assignment advances only the node and commits task rounds and pending event facts', async () => {
  const f = await projectManagerFixture(),
    manager = await projectManagerAccount(1);
  const before = await db.project.findUniqueOrThrow({ where: { id: f.projectId } });
  const result = await f.recruit(manager.user.id);
  expect(result.statusCode).toBe(200);
  expect(result.json().data).toMatchObject({
    projectId: f.projectId,
    recruitmentType: 'INITIAL',
    status: 'ASSIGNED',
    assignmentMode: 'DIRECT',
    currentNodeCode: 'PRODUCTION_PLAN',
    primaryAction: 'CHANGE_PROJECT_MANAGER',
    manager: { userId: manager.user.id, status: 'CURRENT', currentProjectCount: 1 },
  });
  const after = await db.project.findUniqueOrThrow({ where: { id: f.projectId } });
  expect(after).toMatchObject({
    projectName: before.projectName,
    standardContent: before.standardContent,
    requiredHeadcount: before.requiredHeadcount,
    versionNo: before.versionNo,
    currentNodeCode: 'PRODUCTION_PLAN',
  });
  expect(after.projectQuantity?.toString()).toBe(before.projectQuantity?.toString());
  expect(
    await db.projectTaskRound.findMany({
      where: { projectId: f.projectId },
      select: { userId: true, role: true, taskType: true, status: true, participated: true },
    }),
  ).toEqual(
    expect.arrayContaining([
      {
        userId: f.user.id,
        role: 'NAVIGATOR',
        taskType: 'MAIN_RECRUIT_PROJECT_MANAGER',
        status: 'COMPLETED',
        participated: true,
      },
      {
        userId: manager.user.id,
        role: 'PM',
        taskType: 'MAIN_PRODUCTION_PLAN',
        status: 'OPEN',
        participated: false,
      },
    ]),
  );
  const event = await db.projectEventOutbox.findFirstOrThrow({ where: { projectId: f.projectId } });
  expect(event).toMatchObject({
    eventType: 'PROJECT_TASKS_RECONCILED',
    operation: 'project.manager.recruit',
    actorUserId: f.user.id,
    status: 'PENDING',
    attempts: 0,
    deliveredAt: null,
  });
  expect(event.payload).toMatchObject({
    schemaVersion: 1,
    projectId: f.projectId,
    actorUserId: f.user.id,
    projectAudience: expect.arrayContaining([
      { userId: manager.user.id, role: 'PM' },
      { userId: f.user.id, role: 'NAVIGATOR' },
    ]),
  });
});

test('manager replacement preserves later nodes and cancels lost tasks instead of completing the old manager work', async () => {
  const f = await projectManagerFixture(),
    first = await projectManagerAccount(1),
    second = await projectManagerAccount(2);
  expect((await f.recruit(first.user.id)).statusCode).toBe(200);
  await db.project.update({
    where: { id: f.projectId },
    data: { currentNodeCode: 'ENTRANCE_EXAM' },
  });
  const result = await f.recruit(second.user.id);
  expect(result.statusCode).toBe(200);
  expect(result.json().data).toMatchObject({
    recruitmentType: 'REPLACEMENT',
    currentNodeCode: 'ENTRANCE_EXAM',
    nextStage: 'ENTRANCE_EXAM',
    manager: { userId: second.user.id },
  });
  expect(
    await db.projectManagerRecruitment.findFirstOrThrow({
      where: { candidateUserId: first.user.id },
    }),
  ).toMatchObject({ status: 'REPLACED', replacedAt: expect.any(Date) });
  expect(
    await db.projectManagerRecruitment.findFirstOrThrow({ where: { status: 'ASSIGNED' } }),
  ).toMatchObject({ candidateUserId: second.user.id, previousManagerUserId: first.user.id });
  expect(
    await db.projectTaskRound.count({ where: { userId: first.user.id, status: 'OPEN' } }),
  ).toBe(0);
  expect(
    await db.projectTaskRound.count({ where: { userId: first.user.id, status: 'COMPLETED' } }),
  ).toBe(0);
  expect(
    await db.projectTaskRound.count({
      where: { userId: second.user.id, taskType: 'MAIN_ENTRANCE_EXAM', status: 'OPEN' },
    }),
  ).toBe(1);
  const events = await db.projectEventOutbox.findMany({ orderBy: { createdAt: 'asc' } });
  expect(events.at(-1)!.payload).toMatchObject({
    projectAudience: expect.arrayContaining([
      { userId: first.user.id, role: 'PM' },
      { userId: second.user.id, role: 'PM' },
    ]),
    taskChangedRecipients: expect.arrayContaining([
      { userId: first.user.id, role: 'PM' },
      { userId: second.user.id, role: 'PM' },
    ]),
  });
});

test('reselecting the same manager is rejected, distinct concurrent candidates serialize and keep one assigned manager', async () => {
  const f = await projectManagerFixture(),
    first = await projectManagerAccount(1),
    second = await projectManagerAccount(2);
  const parallel = await Promise.all([f.recruit(first.user.id), f.recruit(first.user.id)]);
  expect(parallel.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  expect(await db.projectManagerRecruitment.count()).toBe(1);
  const replacement = await Promise.all([f.recruit(second.user.id), f.recruit(first.user.id)]);
  expect(replacement.every((r) => [200, 400].includes(r.statusCode))).toBe(true);
  expect(
    await db.projectManagerRecruitment.count({
      where: { projectId: f.projectId, status: 'ASSIGNED' },
    }),
  ).toBe(1);
  const assigned = await db.projectManagerRecruitment.findFirstOrThrow({
    where: { projectId: f.projectId, status: 'ASSIGNED' },
  });
  expect(
    await db.projectTaskRound.findMany({
      where: { projectId: f.projectId, role: 'PM', status: 'OPEN' },
      select: { userId: true },
    }),
  ).toEqual([{ userId: assigned.candidateUserId }]);
});

test('revoked or disabled recommended manager is rejected but current manager remains visible under old query semantics', async () => {
  const f = await projectManagerFixture(),
    first = await projectManagerAccount(1),
    second = await projectManagerAccount(2);
  expect((await f.recruit(first.user.id)).statusCode).toBe(200);
  await db.user.update({ where: { id: first.user.id }, data: { status: 'FROZEN' } });
  expect((await f.candidates()).json().data[0]).toMatchObject({
    userId: first.user.id,
    status: 'CURRENT',
  });
  await new ManagementService(db).change({
    uid: second.user.uid,
    role: 'PM',
    action: 'REVOKE',
    actor: 'integration-operator',
    reason: '候选失效验证',
  });
  expect((await f.recruit(second.user.id)).statusCode).toBe(400);
  expect(await db.projectManagerRecruitment.count()).toBe(1);
});

test('first manager assignment with a later node rolls back the new relation and never moves backwards', async () => {
  const f = await projectManagerFixture(),
    manager = await projectManagerAccount(1);
  await db.project.update({
    where: { id: f.projectId },
    data: { currentNodeCode: 'STANDARD_TRAINING' },
  });
  expect((await f.recruit(manager.user.id)).statusCode).toBe(409);
  expect(await db.projectManagerRecruitment.count()).toBe(0);
  expect(await db.projectTaskRound.count()).toBe(0);
  expect(await db.projectEventOutbox.count()).toBe(0);
  expect((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).currentNodeCode).toBe(
    'STANDARD_TRAINING',
  );
});

test('pending event write failure rolls back manager assignment, project node, task rounds and the event itself', async () => {
  const f = await projectManagerFixture(),
    manager = await projectManagerAccount(1);
  const failing = new Proxy(db, {
    get(target, key) {
      if (key === '$transaction')
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          db.$transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, property) {
                  if (property === 'projectEventOutbox')
                    return {
                      ...transaction.projectEventOutbox,
                      create: async (args: Prisma.ProjectEventOutboxCreateArgs) => {
                        await transaction.projectEventOutbox.create(args);
                        throw new Error('injected manager event failure');
                      },
                    };
                  return Reflect.get(transaction, property);
                },
              }),
            ),
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(
    new ProjectManagerService(failing).recruit(
      { projectId: f.projectId, candidateUserId: manager.user.id },
      {
        userId: f.user.id,
        uid: f.user.uid,
        sessionId: 'test',
        role: 'EXPERT',
        clientType: 'desktop',
      },
    ),
  ).rejects.toThrow('injected manager event failure');
  expect(await db.projectManagerRecruitment.count()).toBe(0);
  expect(await db.projectTaskRound.count()).toBe(0);
  expect(await db.projectEventOutbox.count()).toBe(0);
  expect((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).currentNodeCode).toBe(
    'RECRUIT_PROJECT_MANAGER',
  );
});

test('manager replacement leaves uncaptured branch rounds untouched and never reports an event as delivered', async () => {
  const f = await projectManagerFixture(),
    first = await projectManagerAccount(1),
    second = await projectManagerAccount(2);
  expect((await f.recruit(first.user.id)).statusCode).toBe(200);
  const branch = await db.projectTaskRound.create({
    data: {
      projectId: f.projectId,
      userId: first.user.id,
      role: 'PM',
      taskType: 'SUBTASK_ACCEPTANCE',
      status: 'OPEN',
    },
  });
  expect((await f.recruit(second.user.id)).statusCode).toBe(200);
  expect((await db.projectTaskRound.findUniqueOrThrow({ where: { id: branch.id } })).status).toBe(
    'OPEN',
  );
  expect(await db.projectEventOutbox.count({ where: { status: 'DELIVERED' } })).toBe(0);
});

test('project attachment PM and handler access follows current assigned relationship and independent grants', async () => {
  const f = await projectManagerFixture(),
    first = await projectManagerAccount(1),
    second = await projectManagerAccount(2),
    handler = await projectManagerAccount(3);
  const upload = await uploaded('PROJECT_ATTACHMENT', f.user.uid);
  // 第三方材料编辑入口不在本批，测试通过既有草稿/发布事务准备真实附件。
  const next = await f.save({
    ...f.payload,
    projectName: '含附件项目',
    attachments: [
      {
        attachmentType: 'CASE',
        objectKey: upload.record.objectKey,
        uploadToken: upload.uploadToken,
      },
    ],
  });
  expect(next.statusCode).toBe(200);
  const projectId = next.json().data.id;
  const assign = (candidateUserId: string) =>
    post('/projects/manager-recruitments', { projectId, candidateUserId }, f.headers);
  expect((await assign(first.user.id)).statusCode).toBe(200);
  const url = `/api/v1/files/view?objectKey=${encodeURIComponent(upload.record.objectKey)}`;
  expect((await app.inject({ url, headers: first.headers })).statusCode).toBe(200);
  expect((await app.inject({ url, headers: second.headers })).statusCode).toBe(403);
  await db.projectManagerRecruitment.updateMany({
    where: { projectId, status: 'ASSIGNED' },
    data: { expertRecruitmentHandlerUserId: handler.user.id },
  });
  expect((await app.inject({ url, headers: handler.headers })).statusCode).toBe(200);
  expect((await assign(second.user.id)).statusCode).toBe(200);
  expect((await app.inject({ url, headers: first.headers })).statusCode).toBe(403);
  expect((await app.inject({ url, headers: handler.headers })).statusCode).toBe(403);
  expect((await app.inject({ url, headers: second.headers })).statusCode).toBe(200);
  await new ManagementService(db).change({
    uid: second.user.uid,
    role: 'PM',
    action: 'REVOKE',
    actor: 'integration-operator',
    reason: '读取权限撤销',
  });
  expect((await app.inject({ url, headers: second.headers })).statusCode).toBe(403);
});

async function productionPlanFixture() {
  const f = await projectManagerFixture();
  const manager = await projectManagerAccount(1),
    handler = await projectManagerAccount(2);
  expect((await f.recruit(manager.user.id)).statusCode).toBe(200);
  await db.projectManagerRecruitment.updateMany({
    where: { projectId: f.projectId, status: 'ASSIGNED' },
    data: { expertRecruitmentHandlerUserId: handler.user.id },
  });
  const query = (headers = manager.headers) =>
    app.inject({ url: `/api/v1/projects/production-plan?projectId=${f.projectId}`, headers });
  const confirm = (payload: unknown = productionPlanExample, headers = manager.headers) =>
    post(`/projects/production-plan/confirm?projectId=${f.projectId}`, payload, headers);
  return { ...f, manager, handler, query, confirm };
}
test('production plan initial defaults, primary editability, handler read-only and live project references', async () => {
  const f = await productionPlanFixture();
  const initial = await f.query();
  expect(initial.statusCode).toBe(200);
  expect(initial.json().data).toMatchObject({
    hasPlan: false,
    editable: true,
    id: null,
    operatorCpd: null,
    needWrittenExam: true,
    maxActiveExamCount: 1,
    needInterview: false,
    crowds: [{ id: null, sequenceNo: 1, crowdName: null, profileRequirement: null }],
    stages: [
      { sequenceNo: 1, stageName: '爬坡期', workdayCountSource: 'AUTO' },
      { sequenceNo: 2, stageName: '稳定生产期', workdayCountSource: 'AUTO' },
    ],
  });
  expect((await f.query(f.handler.headers)).json().data.editable).toBe(false);
  await db.project.update({ where: { id: f.projectId }, data: { workSummary: '实时新内容' } });
  expect((await f.query()).json().data.projectReference.workSummary).toBe('实时新内容');
  expect(await db.projectProductionPlan.count()).toBe(0);
});
test('production plan confirmation persists ordered details, decimal output and completed main round atomically without a realtime event', async () => {
  const f = await productionPlanFixture();
  const previous = await db.project.findUniqueOrThrow({ where: { id: f.projectId } });
  const events = await db.projectEventOutbox.count();
  const body = {
    ...productionPlanExample,
    operatorCpd: 0.1,
    stages: [
      { stageName: ' 自动 ', startDate: '2099-01-05', endDate: '2099-01-11', operatorHeadcount: 3 },
      {
        stageName: ' 手工 ',
        startDate: '2099-01-05',
        endDate: '2099-01-05',
        operatorHeadcount: 2,
        operatorCpd: 0.2,
        workdayCountSource: 'MANUAL',
        workdayCount: 10,
      },
    ],
  };
  const result = await f.confirm(body);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data).toMatchObject({
    hasPlan: true,
    editable: false,
    operatorCpd: 0.1,
    totalExpectedOutput: 5.5,
    currentNodeCode: 'ENTRANCE_EXAM',
    nextStage: 'ENTRANCE_EXAM',
    confirmedBy: f.manager.user.uid,
    stages: [
      {
        sequenceNo: 1,
        stageName: '自动',
        naturalDayCount: 7,
        workdayCount: 5,
        operatorCpd: 0.1,
        expectedOutput: 1.5,
      },
      { sequenceNo: 2, stageName: '手工', naturalDayCount: 1, workdayCount: 10, expectedOutput: 4 },
    ],
  });
  const plan = await db.projectProductionPlan.findUniqueOrThrow({
    where: { projectId: f.projectId },
    include: { stages: true, crowds: true },
  });
  expect(plan.totalExpectedOutput.toString()).toBe('5.5');
  expect(plan.crowds).toHaveLength(1);
  expect(plan.stages).toHaveLength(2);
  expect(
    await db.projectTaskRound.findFirst({
      where: {
        projectId: f.projectId,
        userId: f.manager.user.id,
        taskType: 'MAIN_PRODUCTION_PLAN',
        status: 'COMPLETED',
      },
    }),
  ).toMatchObject({ participated: true });
  expect(
    await db.projectTaskRound.count({
      where: { projectId: f.projectId, taskType: 'MAIN_ENTRANCE_EXAM', status: 'OPEN' },
    }),
  ).toBe(1);
  expect(await db.projectEventOutbox.count()).toBe(events);
  const after = await db.project.findUniqueOrThrow({ where: { id: f.projectId } });
  expect(after.projectName).toBe(previous.projectName);
  expect(after.versionNo).toBe(previous.versionNo);
  expect(after.mandatoryRequirement).toBe(previous.mandatoryRequirement);
  expect((await f.query()).json().data).toEqual(result.json().data);
  expect((await f.confirm()).statusCode).toBe(400);
});
test('production plan enforces independent PM grant and current primary relationship on every call', async () => {
  const f = await productionPlanFixture();
  const other = await projectManagerAccount(3);
  for (const headers of [f.headers, other.headers]) {
    expect((await f.query(headers)).statusCode).toBe(403);
    expect((await f.confirm(productionPlanExample, headers)).statusCode).toBe(403);
  }
  expect((await f.confirm(productionPlanExample, f.handler.headers)).statusCode).toBe(403);
  await new ManagementService(db).change({
    uid: f.manager.user.uid,
    role: 'PM',
    action: 'REVOKE',
    actor: 'integration-operator',
    reason: '撤销验证',
  });
  expect((await f.query()).statusCode).toBe(403);
  expect((await f.confirm()).statusCode).toBe(403);
  expect(await db.projectProductionPlan.count()).toBe(0);
});
test('production plan rejects invalid numbers, incomplete crowds, dates and supplied output without persisting partial data', async () => {
  const f = await productionPlanFixture();
  for (const patch of [
    { inspectorCpd: null },
    { operatorCpd: 0.00001 },
    { crowds: [] },
    { crowds: [null] },
    { crowds: [{ crowdName: ' ', profileRequirement: '要求' }] },
    { stages: [null] },
    { stages: [{ ...productionPlanExample.stages[0], startDate: '2099-02-30' }] },
    { stages: [{ ...productionPlanExample.stages[0], startDate: '2020-01-01' }] },
    {
      stages: [
        { ...productionPlanExample.stages[0], workdayCountSource: 'MANUAL', workdayCount: null },
      ],
    },
    { stages: [{ ...productionPlanExample.stages[0], accuracyRate: 101 }] },
    { totalExpectedOutput: 1 },
  ]) {
    const result = await f.confirm({ ...productionPlanExample, ...patch });
    expect(result.statusCode, result.body).toBe(400);
    expect(await db.projectProductionPlan.count()).toBe(0);
    expect(await db.projectProductionCrowd.count()).toBe(0);
    expect(await db.projectProductionStage.count()).toBe(0);
  }
  expect((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).currentNodeCode).toBe(
    'PRODUCTION_PLAN',
  );
});
test('concurrent production plan confirmations have one winner and never overwrite confirmed data', async () => {
  const f = await productionPlanFixture();
  const results = await Promise.all([
    f.confirm(),
    f.confirm({ ...productionPlanExample, operatorHeadcount: 99 }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  expect(await db.projectProductionPlan.count()).toBe(1);
  expect(await db.projectProductionStage.count()).toBe(1);
  expect((await f.query()).json().data.operatorHeadcount).toBe(
    results.find((r) => r.statusCode === 200)!.json().data.operatorHeadcount,
  );
});
test('late production plan backfill preserves later project node and records source-less completion, while no-written plan advances to training', async () => {
  const f = await productionPlanFixture();
  await db.project.update({
    where: { id: f.projectId },
    data: { currentNodeCode: 'PRODUCTION_TASK' },
  });
  const result = await f.confirm({ ...productionPlanExample, needWrittenExam: false });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data).toMatchObject({
    currentNodeCode: 'PRODUCTION_TASK',
    nextStage: 'STANDARD_TRAINING',
  });
  expect(
    await db.projectTaskRound.findFirst({
      where: {
        projectId: f.projectId,
        userId: f.manager.user.id,
        taskType: 'MAIN_PRODUCTION_PLAN',
        status: 'COMPLETED',
      },
    }),
  ).toMatchObject({ participated: true });
  const second = await f.save({ ...f.payload, projectName: '免笔试项目' });
  const projectId = second.json().data.id;
  expect(
    (
      await post(
        '/projects/manager-recruitments',
        { projectId, candidateUserId: f.manager.user.id },
        f.headers,
      )
    ).statusCode,
  ).toBe(200);
  const response = await post(
    `/projects/production-plan/confirm?projectId=${projectId}`,
    { ...productionPlanExample, needWrittenExam: false },
    f.manager.headers,
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().data.currentNodeCode).toBe('STANDARD_TRAINING');
});
test('task round failure after nested plan writes rolls back plan, crowds, stages and project node together', async () => {
  const f = await productionPlanFixture();
  const failing = new Proxy(db, {
    get(target, key) {
      if (key === '$transaction')
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          db.$transaction((tx) =>
            callback(
              new Proxy(tx, {
                get(transaction, property) {
                  if (property === 'projectTaskRound')
                    return {
                      ...transaction.projectTaskRound,
                      update: async (args: Prisma.ProjectTaskRoundUpdateArgs) => {
                        await transaction.projectTaskRound.update(args);
                        throw new Error('injected plan round failure');
                      },
                    };
                  return Reflect.get(transaction, property);
                },
              }),
            ),
          );
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(
    new ProjectProductionPlanService(failing).confirm(
      f.projectId,
      productionPlanExample as ProductionPlanInput,
      {
        userId: f.manager.user.id,
        uid: f.manager.user.uid,
        sessionId: 'test',
        role: 'EXPERT',
        clientType: 'desktop',
      },
    ),
  ).rejects.toThrow('injected plan round failure');
  expect(await db.projectProductionPlan.count()).toBe(0);
  expect(await db.projectProductionCrowd.count()).toBe(0);
  expect(await db.projectProductionStage.count()).toBe(0);
  expect((await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).currentNodeCode).toBe(
    'PRODUCTION_PLAN',
  );
  expect(
    await db.projectTaskRound.count({
      where: { projectId: f.projectId, taskType: 'MAIN_PRODUCTION_PLAN', status: 'OPEN' },
    }),
  ).toBe(1);
});
test('production plan access follows manager replacement and rejects missing, draft and deleted projects', async () => {
  const f = await productionPlanFixture();
  const replacement = await projectManagerAccount(3);
  expect((await f.recruit(replacement.user.id)).statusCode).toBe(200);
  expect((await f.query()).statusCode).toBe(403);
  expect((await f.query(f.handler.headers)).statusCode).toBe(403);
  expect((await f.query(replacement.headers)).statusCode).toBe(200);
  await db.project.update({ where: { id: f.projectId }, data: { status: 'DRAFT' } });
  expect((await f.query(replacement.headers)).statusCode).toBe(404);
  expect((await f.confirm(productionPlanExample, replacement.headers)).statusCode).toBe(400);
  await db.project.update({ where: { id: f.projectId }, data: { deleted: true } });
  expect((await f.query(replacement.headers)).statusCode).toBe(404);
  expect((await f.confirm(productionPlanExample, replacement.headers)).statusCode).toBe(404);
  expect(
    (
      await app.inject({
        url: '/api/v1/projects/production-plan?projectId=2147483647',
        headers: replacement.headers,
      })
    ).statusCode,
  ).toBe(404);
});

const projectDetailHttp = (projectId: number, headers: Record<string, string>) =>
  app.inject({ url: `/api/v1/projects/${projectId}`, headers });
test('published detail preserves category snapshots and live personal names while management responses omit production requirements', async () => {
  const f = await projectManagerFixture();
  await db.user.update({
    where: { id: f.user.id },
    data: { displayName: '新昵称', realName: '新姓名' },
  });
  await db.projectCategory.update({
    where: { id: f.categories[0]!.id },
    data: { categoryName: '字典新名' },
  });
  const before = await db.project.findUniqueOrThrow({ where: { id: f.projectId } });
  const result = await projectDetailHttp(f.projectId, f.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data).toMatchObject({
    id: f.projectId,
    status: 'PUBLISHED',
    requesterName: '新昵称(新姓名)',
    creatorName: '新昵称(新姓名)',
    categoryLevel1Name: '项目分类0',
    currentNodeCode: 'RECRUIT_PROJECT_MANAGER',
  });
  expect(result.json().data).not.toHaveProperty('productionRequirements');
  expect(await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).toEqual(before);
  expect(await db.projectTaskRound.count()).toBe(0);
  expect(await db.projectEventOutbox.count()).toBe(0);
  await new ManagementService(db).change({
    uid: f.user.uid,
    role: 'NAVIGATOR',
    action: 'REVOKE',
    actor: 'integration-operator',
    reason: '撤销详情权限',
  });
  expect((await projectDetailHttp(f.projectId, f.headers)).statusCode).toBe(403);
});
test('project detail PM and handler access follows independent authorization, active assignment and replacement', async () => {
  const f = await productionPlanFixture();
  for (const headers of [f.manager.headers, f.handler.headers]) {
    const response = await projectDetailHttp(f.projectId, headers);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).not.toHaveProperty('productionRequirements');
  }
  const other = await projectManagerAccount(3);
  expect((await projectDetailHttp(f.projectId, other.headers)).statusCode).toBe(403);
  expect((await f.recruit(other.user.id)).statusCode).toBe(200);
  expect((await projectDetailHttp(f.projectId, f.manager.headers)).statusCode).toBe(403);
  expect((await projectDetailHttp(f.projectId, f.handler.headers)).statusCode).toBe(403);
  expect((await projectDetailHttp(f.projectId, other.headers)).statusCode).toBe(200);
  await new ManagementService(db).change({
    uid: other.user.uid,
    role: 'PM',
    action: 'REVOKE',
    actor: 'integration-operator',
    reason: '撤销详情PM',
  });
  expect((await projectDetailHttp(f.projectId, other.headers)).statusCode).toBe(403);
});
test('only real ACTIVE MEMBER grants expert project detail access, never organization membership or other project roles and statuses', async () => {
  const f = await projectManagerFixture();
  const expert = await projectManagerAccount(1, 100, false);
  expect((await projectDetailHttp(f.projectId, expert.headers)).statusCode).toBe(403);
  const member = await db.projectMember.create({
    data: {
      projectId: f.projectId,
      userId: expert.user.id,
      projectRole: 'MEMBER',
      status: 'PENDING_CONFIRM',
      createdBy: f.user.uid,
    },
  });
  for (const status of [
    'PENDING_CONFIRM',
    'PENDING_ENTRY',
    'ENTRY_DECLINED',
    'PENDING_EXIT',
    'PENDING_TRANSFER',
    'LEFT',
    'REMOVED',
  ]) {
    await db.projectMember.update({ where: { id: member.id }, data: { status } });
    expect((await projectDetailHttp(f.projectId, expert.headers)).statusCode).toBe(403);
  }
  await db.projectMember.update({
    where: { id: member.id },
    data: { status: 'ACTIVE', projectRole: 'PROJECT_MANAGER' },
  });
  expect((await projectDetailHttp(f.projectId, expert.headers)).statusCode).toBe(403);
  await db.projectMember.update({ where: { id: member.id }, data: { projectRole: 'MEMBER' } });
  const result = await projectDetailHttp(f.projectId, expert.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data.productionRequirements).toEqual({
    hasPlan: false,
    planId: null,
    operatorHeadcount: null,
    operatorCpd: null,
    inspectorHeadcount: null,
    inspectorCpd: null,
    totalExpectedOutput: null,
    crowds: null,
    stages: [],
  });
  expect(
    (
      await app.inject({
        url: `/api/v1/projects/production-plan?projectId=${f.projectId}`,
        headers: expert.headers,
      })
    ).statusCode,
  ).toBe(403);
});
test('expert project details return confirmed totals and ordered stages without administrative fields or assignment-detail crowds', async () => {
  const f = await productionPlanFixture();
  expect((await f.confirm()).statusCode).toBe(200);
  const expert = await projectManagerAccount(3, 100, false);
  await db.projectMember.create({
    data: { projectId: f.projectId, userId: expert.user.id, createdBy: f.user.uid },
  });
  const result = await projectDetailHttp(f.projectId, expert.headers);
  expect(result.statusCode, result.body).toBe(200);
  const requirements = result.json().data.productionRequirements;
  expect(requirements).toMatchObject({
    hasPlan: true,
    operatorHeadcount: 20,
    operatorCpd: 500.25,
    totalExpectedOutput: 50025,
    crowds: null,
    stages: [
      {
        sequenceNo: 1,
        operatorCpd: 500.25,
        expectedOutput: 50025,
        startDate: '2099-01-05',
        endDate: '2099-01-09',
      },
    ],
  });
  for (const key of [
    'extJson',
    'confirmedBy',
    'confirmedAt',
    'needWrittenExam',
    'needInterview',
    'maxActiveExamCount',
  ])
    expect(requirements).not.toHaveProperty(key);
  expect((await projectDetailHttp(f.projectId, f.headers)).json().data).not.toHaveProperty(
    'productionRequirements',
  );
});
test('detail uses management scope first for users with both grants and active membership, then falls back to true expert scope after revocation', async () => {
  const f = await projectManagerFixture();
  await db.projectMember.create({
    data: { projectId: f.projectId, userId: f.user.id, createdBy: f.user.uid },
  });
  expect((await projectDetailHttp(f.projectId, f.headers)).json().data).not.toHaveProperty(
    'productionRequirements',
  );
  await new ManagementService(db).change({
    uid: f.user.uid,
    role: 'NAVIGATOR',
    action: 'REVOKE',
    actor: 'integration-operator',
    reason: '管理与成员范围验证',
  });
  const result = await projectDetailHttp(f.projectId, f.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data).toHaveProperty('productionRequirements');
});
test('published detail rejects missing, draft and deleted projects and validates path IDs with existing transport isolation', async () => {
  const f = await projectCreationFixture();
  const draft = await f.save({ operation: 'SAVE_DRAFT' });
  const id = draft.json().data.id;
  expect((await projectDetailHttp(id, f.headers)).statusCode).toBe(404);
  expect((await projectDetailHttp(2147483647, f.headers)).statusCode).toBe(404);
  const published = await f.save({ ...f.payload, versionNo: 0 });
  expect(published.statusCode).toBe(200);
  await db.project.update({ where: { id }, data: { deleted: true } });
  expect((await projectDetailHttp(id, f.headers)).statusCode).toBe(404);
  for (const value of ['0', '-1', '1.5', '2147483648', 'abc'])
    expect(
      (await app.inject({ url: `/api/v1/projects/${value}`, headers: f.headers })).statusCode,
    ).toBe(400);
  expect((await app.inject({ url: `/api/v1/projects/${id}` })).statusCode).toBe(401);
});
test('expert project attachments require real acceptance and admission while ACTIVE project membership alone never grants access', async () => {
  const f = await projectCreationFixture();
  const expert = await projectManagerAccount(1, 100, false);
  const upload = await uploaded('PROJECT_ATTACHMENT', f.user.uid);
  const published = await f.save({
    ...f.payload,
    attachments: [
      {
        attachmentType: 'STANDARD_REFERENCE',
        objectKey: upload.record.objectKey,
        uploadToken: upload.uploadToken,
      },
    ],
  });
  expect(published.statusCode, published.body).toBe(200);
  const projectId = published.json().data.id;
  await db.projectMember.create({
    data: { projectId, userId: expert.user.id, createdBy: f.user.uid },
  });
  const detail = await projectDetailHttp(projectId, expert.headers);
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().data.attachments).toHaveLength(1);
  const file = await app.inject({
    url: `/api/v1/files/view?objectKey=${encodeURIComponent(upload.record.objectKey)}`,
    headers: expert.headers,
  });
  expect(file.statusCode).toBe(403);
  const getFile = () =>
    app.inject({
      url: `/api/v1/files/view?objectKey=${encodeURIComponent(upload.record.objectKey)}`,
      headers: expert.headers,
    });
  await db.projectExpertAssignment.create({
    data: {
      assignmentNo: 'ATTACHMENT-ACCEPTED',
      projectId,
      subjectType: 'INDIVIDUAL',
      expertUserId: expert.user.id,
      status: 'ACCEPTED',
      createdBy: f.user.uid,
    },
  });
  expect((await getFile()).statusCode).toBe(200); // 无计划免试，已接单即可读。
  await db.projectProductionPlan.create({
    data: {
      projectId,
      operatorHeadcount: 1,
      operatorCpd: 1,
      totalExpectedOutput: 1,
      needWrittenExam: true,
      confirmedBy: f.user.uid,
      confirmedAt: new Date(),
      createdBy: f.user.uid,
      updatedBy: f.user.uid,
    },
  });
  expect((await getFile()).statusCode).toBe(403);
  const exam = await db.projectEntranceExam.create({
    data: { examNo: 'FILE-EXAM', projectId, examName: '附件准入', createdBy: f.user.uid },
  });
  await db.entranceExamAttempt.create({
    data: {
      attemptNo: 'FILE-ATTEMPT',
      examId: exam.id,
      candidateUserId: expert.user.id,
      candidateUid: expert.user.uid,
      candidateName: expert.user.displayName,
      finalResult: 'ADMITTED',
      createdBy: f.user.uid,
    },
  });
  expect((await getFile()).statusCode).toBe(200);
  await db.projectEntranceExam.update({ where: { id: exam.id }, data: { deleted: true } });
  expect((await getFile()).statusCode).toBe(403);
});
test('member foundations preserve history and source idempotency without creating memberships from an authenticated detail query', async () => {
  const f = await projectManagerFixture();
  const expert = await projectManagerAccount(1, 100, false);
  const exam = await db.projectEntranceExam.create({
    data: {
      examNo: 'MEMBER-SOURCE-EXAM',
      projectId: f.projectId,
      examName: '来源考试',
      createdBy: f.user.uid,
    },
  });
  const attempt = await db.entranceExamAttempt.create({
    data: {
      attemptNo: 'MEMBER-SOURCE-ATTEMPT',
      examId: exam.id,
      candidateUserId: expert.user.id,
      candidateUid: expert.user.uid,
      candidateName: expert.user.displayName,
      createdBy: f.user.uid,
    },
  });
  const original = await db.projectMember.create({
    data: {
      projectId: f.projectId,
      userId: expert.user.id,
      admissionAttemptId: attempt.id,
      status: 'LEFT',
      createdBy: f.user.uid,
    },
  });
  const another = await db.projectMember.create({
    data: {
      projectId: f.projectId,
      userId: expert.user.id,
      status: 'ACTIVE',
      createdBy: f.user.uid,
    },
  });
  expect(original.id).not.toBe(another.id);
  await expect(
    db.projectMember.create({
      data: {
        projectId: f.projectId,
        userId: expert.user.id,
        admissionAttemptId: attempt.id,
        createdBy: f.user.uid,
      },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
  const count = await db.projectMember.count();
  const result = await projectDetailHttp(f.projectId, expert.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(await db.projectMember.count()).toBe(count);
  expect((await db.user.findUniqueOrThrow({ where: { id: expert.user.id } })).role).toBe('EXPERT');
});

async function memberCountProject(
  owner: { id: string; uid: string },
  projectNo: string,
  status = 'PUBLISHED',
  deleted = false,
) {
  return db.project.create({
    data: {
      projectNo,
      requesterType: 'ORGANIZATION',
      requesterId: owner.id,
      requesterName: '统计组织快照',
      createdBy: owner.uid,
      updatedBy: owner.uid,
      status,
      deleted,
    },
  });
}
test('organization project counts use exact membership relations, ACTIVE row counts and legacy project/role inclusion', async () => {
  const f = await memberFixture(),
    member = await f.add();
  const first = await memberCountProject(f.owner, 'COUNT_A'),
    second = await memberCountProject(f.owner, 'COUNT_B', 'DRAFT', true);
  const data = {
    projectId: first.id,
    userId: member.user.id,
    userOrgRelId: member.rel.id,
    organizationId: f.orgId,
    createdBy: f.owner.uid,
  };
  await db.projectMember.createMany({
    data: [
      data,
      { ...data, projectRole: 'PROJECT_MANAGER' },
      { ...data, projectId: second.id },
      ...[
        'PENDING_CONFIRM',
        'PENDING_ENTRY',
        'ENTRY_DECLINED',
        'PENDING_EXIT',
        'PENDING_TRANSFER',
        'LEFT',
        'REMOVED',
      ].map((status) => ({ ...data, status })),
    ],
  });
  const foreignOrg = await db.organization.create({
    data: { name: '统计其他组织', expertiseTags: [] },
  });
  const foreign = await db.userOrgRel.create({
    data: { orgId: foreignOrg.id, userId: member.user.id, uid: member.user.uid },
  });
  await db.projectMember.createMany({
    data: [
      { ...data, userOrgRelId: foreign.id, organizationId: foreignOrg.id },
      { ...data, userOrgRelId: null, organizationId: null },
    ],
  });
  const response = await post('/organizations/members', { orgId: f.orgId }, f.headers);
  expect(response.statusCode, response.body).toBe(200);
  expect(
    response.json().data.records.find((r: { memberId: string }) => r.memberId === member.rel.id),
  ).toMatchObject({ activeProjectCount: 3 });
  expect(
    response.json().data.records.find((r: { memberId: string }) => r.memberId === f.ownerRel.id),
  ).toMatchObject({ activeProjectCount: 0 });
  const filtered = await post(
    '/organizations/members',
    { orgId: f.orgId, projectId: first.id },
    f.headers,
  );
  expect(filtered.statusCode, filtered.body).toBe(200);
  expect(filtered.json().data).toMatchObject({
    total: 1,
    pages: 1,
    records: [{ memberId: member.rel.id, activeProjectCount: 3 }],
  });
});
test('project membership filters apply before pagination without row duplication and combine with organization status and keyword filters', async () => {
  const f = await memberFixture(),
    first = await f.add(),
    second = await f.add('MEMBER', 'LEFT'),
    excluded = await f.add();
  const project = await memberCountProject(f.owner, 'FILTER_A'),
    other = await memberCountProject(f.owner, 'FILTER_B');
  for (const [i, member] of [first, second, excluded].entries())
    await db.userOrgRel.update({
      where: { id: member.rel.id },
      data: { joinedAt: new Date(`2026-10-0${i + 1}T00:00:00Z`) },
    });
  const data = { projectId: project.id, createdBy: f.owner.uid };
  await db.projectMember.createMany({
    data: [
      { ...data, userId: first.user.id, userOrgRelId: first.rel.id },
      { ...data, userId: first.user.id, userOrgRelId: first.rel.id },
      { ...data, userId: second.user.id, userOrgRelId: second.rel.id },
      { ...data, projectId: other.id, userId: excluded.user.id, userOrgRelId: excluded.rel.id },
    ],
  });
  const page = await post(
    '/organizations/members',
    { orgId: f.orgId, projectId: project.id, current: 1, size: 1 },
    f.headers,
  );
  expect(page.statusCode, page.body).toBe(200);
  expect(page.json().data).toMatchObject({
    total: 2,
    pages: 2,
    records: [{ memberId: second.rel.id, activeProjectCount: 1 }],
  });
  const next = await post(
    '/organizations/members',
    { orgId: f.orgId, projectId: project.id, current: 2, size: 1 },
    f.headers,
  );
  expect(next.json().data).toMatchObject({
    total: 2,
    records: [{ memberId: first.rel.id, activeProjectCount: 2 }],
  });
  const combined = await post(
    '/organizations/members',
    { orgId: f.orgId, projectId: project.id, joinStatus: 'ACTIVE', keyword: first.user.uid },
    f.headers,
  );
  expect(combined.json().data).toMatchObject({
    total: 1,
    records: [{ memberId: first.rel.id, activeProjectCount: 2 }],
  });
  expect(
    (
      await post(
        '/organizations/members',
        { orgId: f.orgId, projectId: project.id, current: 3, size: 1 },
        f.headers,
      )
    ).json().data.records,
  ).toEqual([]);
});
test('project filtering preserves organization manager scope and ignores the same user personal or other-organization project associations', async () => {
  const f = await memberFixture(),
    member = await f.add();
  const project = await memberCountProject(f.owner, 'SCOPE_A');
  await db.projectMember.create({
    data: { projectId: project.id, userId: member.user.id, createdBy: f.owner.uid },
  });
  const query = { orgId: f.orgId, projectId: project.id };
  expect((await post('/organizations/members', query, f.headers)).json().data.total).toBe(0);
  expect((await post('/organizations/members', query, member.headers)).statusCode).toBe(403);
  const foreignOrg = await db.organization.create({
    data: { name: '筛选其他组织', expertiseTags: [] },
  });
  expect(
    (await post('/organizations/members', { ...query, orgId: foreignOrg.id }, f.headers))
      .statusCode,
  ).toBe(403);
  const rel = await db.userOrgRel.create({
    data: { orgId: foreignOrg.id, userId: member.user.id, uid: member.user.uid },
  });
  await db.projectMember.create({
    data: {
      projectId: project.id,
      userId: member.user.id,
      userOrgRelId: rel.id,
      createdBy: f.owner.uid,
    },
  });
  expect((await post('/organizations/members', query, f.headers)).json().data.total).toBe(0);
});
test('project filter null and missing are equivalent, nonexistent integer IDs return empty pages and invalid encodings reject', async () => {
  const f = await memberFixture();
  await f.add();
  const list = (extra: Record<string, unknown>) =>
    post('/organizations/members', { orgId: f.orgId, ...extra }, f.headers);
  expect((await list({ projectId: null })).json().data).toEqual((await list({})).json().data);
  for (const projectId of [0, -1, 2147483647]) {
    const response = await list({ projectId });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({ total: 0, pages: 0, records: [] });
  }
  for (const projectId of [f.orgId, '1', 1.1, 2147483648, -2147483649])
    expect((await list({ projectId })).statusCode).toBe(400);
});

const projectCardsHttp = (headers: Record<string, string>, manager = false) =>
  app.inject({ url: manager ? '/api/v1/projects/manager/list' : '/api/v1/projects/list', headers });
async function cardSnapshot(
  projectId: number,
  userId: string,
  perspective: string,
  branchNodeCode = 'SUBTASK_ACCEPTANCE',
) {
  return db.projectRoleNodeSnapshot.create({
    data: {
      projectId,
      userId,
      perspective,
      branchNodeCode,
      branchPriority: 80,
      sourceBizType: 'SUBTASK',
      sourceBizId: 1,
      sourceEventAt: new Date(),
      calculatedAt: new Date(),
    },
  });
}
test('navigator cards follow own recruitment or own perspective branch and hide completed, deleted and draft projects', async () => {
  const f = await projectManagerFixture(),
    manager = await projectManagerAccount(1);
  let result = await projectCardsHttp(f.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data).toMatchObject([
    {
      id: f.projectId,
      currentNodeCode: 'RECRUIT_PROJECT_MANAGER',
      branchNodeCode: null,
      currentAction: 'RECRUIT_PROJECT_MANAGER',
    },
  ]);
  expect(result.json().data[0]).not.toHaveProperty('primaryProjectManager');
  expect((await f.recruit(manager.user.id)).statusCode).toBe(200);
  expect((await projectCardsHttp(f.headers)).json().data).toEqual([]);
  const own = await cardSnapshot(f.projectId, f.user.id, 'NAVIGATOR');
  result = await projectCardsHttp(f.headers);
  expect(result.json().data).toMatchObject([
    { id: f.projectId, currentNodeCode: 'PRODUCTION_PLAN', branchNodeCode: 'SUBTASK_ACCEPTANCE' },
  ]);
  for (const patch of [
    { currentNodeCode: 'COMPLETED' },
    { currentNodeCode: 'PRODUCTION_PLAN', deleted: true },
    { deleted: false, status: 'DRAFT' },
  ]) {
    await db.project.update({ where: { id: f.projectId }, data: patch });
    expect((await projectCardsHttp(f.headers)).json().data).toEqual([]);
  }
  await db.projectRoleNodeSnapshot.delete({ where: { id: own.id } });
});
test('manager cards distinguish primary and handler perspectives, recruitment retry and dual-role primary precedence', async () => {
  const f = await productionPlanFixture();
  expect((await projectCardsHttp(f.manager.headers, true)).json().data).toMatchObject([
    {
      id: f.projectId,
      primaryProjectManager: true,
      expertRecruitmentHandler: false,
      currentNodeCode: 'PRODUCTION_PLAN',
    },
  ]);
  expect((await projectCardsHttp(f.handler.headers, true)).json().data).toEqual([]);
  const ignored = await cardSnapshot(
    f.projectId,
    f.handler.user.id,
    'PROJECT_MANAGER',
    'EXPERT_RECRUITMENT_RETRY',
  );
  expect((await projectCardsHttp(f.handler.headers, true)).json().data).toEqual([]);
  const handler = await cardSnapshot(
    f.projectId,
    f.handler.user.id,
    'EXPERT_RECRUITMENT_HANDLER',
    'EXPERT_RECRUITMENT_RETRY',
  );
  expect((await projectCardsHttp(f.handler.headers, true)).json().data).toMatchObject([
    {
      primaryProjectManager: false,
      expertRecruitmentHandler: true,
      currentAction: 'VIEW_DETAIL',
      branchNodeCode: 'EXPERT_RECRUITMENT_RETRY',
    },
  ]);
  await db.projectManagerRecruitment.updateMany({
    where: { projectId: f.projectId, status: 'ASSIGNED' },
    data: { expertRecruitmentHandlerUserId: f.manager.user.id },
  });
  await cardSnapshot(
    f.projectId,
    f.manager.user.id,
    'EXPERT_RECRUITMENT_HANDLER',
    'EXPERT_RECRUITMENT_RETRY',
  );
  const result = await projectCardsHttp(f.manager.headers, true);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data[0]).toMatchObject({
    primaryProjectManager: true,
    expertRecruitmentHandler: true,
    branchNodeCode: null,
  });
  await db.projectRoleNodeSnapshot.deleteMany({ where: { id: { in: [ignored.id, handler.id] } } });
});
test('manager card main visibility and late branch do not replace the shared node, and stale completed snapshots never push', async () => {
  const f = await productionPlanFixture();
  for (const currentNodeCode of [
    'PRODUCTION_PLAN',
    'ENTRANCE_EXAM',
    'STANDARD_TRAINING',
    'RECRUIT_EXECUTION_EXPERT',
  ]) {
    await db.project.update({ where: { id: f.projectId }, data: { currentNodeCode } });
    expect((await projectCardsHttp(f.manager.headers, true)).json().data).toHaveLength(1);
  }
  await db.project.update({
    where: { id: f.projectId },
    data: { currentNodeCode: 'PRODUCTION_TASK' },
  });
  expect((await projectCardsHttp(f.manager.headers, true)).json().data).toEqual([]);
  await cardSnapshot(f.projectId, f.manager.user.id, 'PROJECT_MANAGER', 'OUTPUT_DATA_REVIEW');
  expect((await projectCardsHttp(f.manager.headers, true)).json().data).toMatchObject([
    { currentNodeCode: 'PRODUCTION_TASK', branchNodeCode: 'OUTPUT_DATA_REVIEW' },
  ]);
  await db.project.update({ where: { id: f.projectId }, data: { currentNodeCode: 'COMPLETED' } });
  expect((await projectCardsHttp(f.manager.headers, true)).json().data).toEqual([]);
});
test('list counts all ACTIVE membership rows, preserves category snapshots and live names, and sorts update time then numeric ID', async () => {
  const f = await projectManagerFixture();
  const second = await f.save({ ...f.payload, projectName: '第二项目' });
  const secondId = second.json().data.id;
  const now = new Date('2026-10-21T02:00:00Z');
  await db.project.updateMany({
    where: { id: { in: [f.projectId, secondId] } },
    data: { updatedAt: now },
  });
  await db.user.update({
    where: { id: f.user.id },
    data: { displayName: '实时昵称', realName: '实时姓名' },
  });
  await db.projectCategory.update({
    where: { id: f.categories[0]!.id },
    data: { categoryName: '改名字典' },
  });
  await db.projectMember.createMany({
    data: [
      { projectId: f.projectId, userId: f.user.id, createdBy: f.user.uid },
      {
        projectId: f.projectId,
        userId: f.user.id,
        projectRole: 'PROJECT_MANAGER',
        createdBy: f.user.uid,
      },
      { projectId: f.projectId, userId: f.user.id, status: 'LEFT', createdBy: f.user.uid },
    ],
  });
  const result = await projectCardsHttp(f.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data.map((r: { id: number }) => r.id)).toEqual([secondId, f.projectId]);
  expect(result.json().data[1]).toMatchObject({
    activeExpertCount: 2,
    requesterName: '实时昵称(实时姓名)',
    creatorName: '实时昵称(实时姓名)',
    categoryLevel1Name: '项目分类0',
  });
});
test('list organization owners read accepted assignment relations and only fall back when no owner relation of any status exists', async () => {
  const f = await projectManagerFixture(),
    first = await projectManagerAccount(1),
    legacy = await projectManagerAccount(2);
  const org = await db.organization.create({ data: { name: '卡片负责人组织', expertiseTags: [] } });
  const assignment = await db.projectExpertAssignment.create({
    data: {
      assignmentNo: 'CARD_OWNER_A',
      projectId: f.projectId,
      subjectType: 'ORGANIZATION',
      organizationId: org.id,
      status: 'ACCEPTED',
      projectOwnerUserId: legacy.user.id,
      createdBy: f.user.uid,
    },
  });
  let result = await projectCardsHttp(f.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data[0].projectOwners.map((o: { userId: string }) => o.userId)).toEqual([
    legacy.user.id,
  ]);
  const relation = await db.projectExpertAssignmentOwner.create({
    data: { assignmentId: assignment.id, userId: first.user.id, createdBy: f.user.uid },
  });
  result = await projectCardsHttp(f.headers);
  expect(result.json().data[0].projectOwners.map((o: { userId: string }) => o.userId)).toEqual([
    first.user.id,
  ]);
  expect(result.json().data[0].projectOwners[0]).not.toHaveProperty('assignmentId');
  await db.projectExpertAssignmentOwner.update({
    where: { id: relation.id },
    data: { status: 'REMOVED' },
  });
  expect((await projectCardsHttp(f.headers)).json().data[0].projectOwners).toEqual([]);
  await db.projectExpertAssignmentOwner.delete({ where: { id: relation.id } });
  await db.projectExpertAssignment.update({
    where: { id: assignment.id },
    data: { status: 'PENDING_ACCEPTANCE' },
  });
  expect((await projectCardsHttp(f.headers)).json().data[0].projectOwners).toEqual([]);
});
test('assist grading uses only ACTIVE undeleted exam current-version MANUAL reviewers and never becomes a card visibility grant', async () => {
  const f = await projectManagerFixture(),
    manager = await projectManagerAccount(1);
  const exam = await db.projectEntranceExam.create({
    data: {
      projectId: f.projectId,
      examNo: 'CARD_EXAM',
      examName: '卡片考试',
      currentVersionId: 7001,
      createdBy: f.user.uid,
    },
  });
  const round = await db.entranceExamGradingRound.create({
    data: {
      examVersionId: 7001,
      roundNo: 1,
      gradingMode: 'MANUAL',
      reviewersJson: [{ userId: f.user.id, uid: f.user.uid, name: '阅卷人' }],
      createdBy: f.user.uid,
    },
  });
  const result = await projectCardsHttp(f.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data[0].needAssistGrading).toBe(true);
  for (const patch of [
    { status: 'CLOSED' },
    { status: 'ACTIVE', deleted: true },
    { deleted: false, currentVersionId: 7002 },
  ]) {
    await db.projectEntranceExam.update({ where: { id: exam.id }, data: patch });
    expect((await projectCardsHttp(f.headers)).json().data[0].needAssistGrading).toBe(false);
  }
  await db.projectEntranceExam.update({ where: { id: exam.id }, data: { currentVersionId: 7001 } });
  await db.entranceExamGradingRound.update({
    where: { id: round.id },
    data: { gradingMode: 'AUTO' },
  });
  expect((await projectCardsHttp(f.headers)).json().data[0].needAssistGrading).toBe(false);
  await db.entranceExamGradingRound.update({
    where: { id: round.id },
    data: { gradingMode: 'MANUAL' },
  });
  expect((await f.recruit(manager.user.id)).statusCode).toBe(200);
  expect((await projectCardsHttp(f.headers)).json().data).toEqual([]);
});
test('lists require live independent grants and current relationships, not stale snapshots or fixed EXPERT sessions', async () => {
  const f = await projectManagerFixture(),
    manager = await projectManagerAccount(1),
    other = await projectManagerAccount(2);
  expect((await f.recruit(manager.user.id)).statusCode).toBe(200);
  await cardSnapshot(f.projectId, manager.user.id, 'PROJECT_MANAGER');
  expect((await projectCardsHttp(other.headers, true)).json().data).toEqual([]);
  expect((await f.recruit(other.user.id)).statusCode).toBe(200);
  expect((await projectCardsHttp(manager.headers, true)).json().data).toEqual([]);
  await new ManagementService(db).change({
    uid: other.user.uid,
    role: 'PM',
    action: 'REVOKE',
    actor: 'integration-operator',
    reason: '卡片授权撤销',
  });
  expect((await projectCardsHttp(other.headers, true)).statusCode).toBe(403);
  expect((await projectCardsHttp(other.headers)).statusCode).toBe(403);
  expect((await app.inject('/api/v1/projects/list')).statusCode).toBe(401);
});
test('historical null card nodes fall back without writes, and cross-role snapshots are not selected', async () => {
  const f = await projectManagerFixture();
  await db.project.update({ where: { id: f.projectId }, data: { currentNodeCode: null } });
  let result = await projectCardsHttp(f.headers);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data[0].currentNodeCode).toBe('RECRUIT_PROJECT_MANAGER');
  expect(
    (await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).currentNodeCode,
  ).toBeNull();
  const manager = await projectManagerAccount(1);
  expect((await f.recruit(manager.user.id)).statusCode).toBe(200);
  await db.project.update({ where: { id: f.projectId }, data: { currentNodeCode: null } });
  await cardSnapshot(f.projectId, f.user.id, 'EXPERT_MEMBER', 'PRODUCTION_TASK');
  expect((await projectCardsHttp(f.headers)).json().data).toEqual([]);
  result = await projectCardsHttp(manager.headers, true);
  expect(result.json().data[0].currentNodeCode).toBe('PRODUCTION_PLAN');
  expect(
    (await db.project.findUniqueOrThrow({ where: { id: f.projectId } })).currentNodeCode,
  ).toBeNull();
});

test('avatar upload requires login and profile claim enforces ownership, rollback, replacement and cleanup', async () => {
  const anonymous = await uploadHttp([imagePart(), { name: 'bizType', content: 'AVATAR' }]);
  expect(anonymous.statusCode).toBe(401);
  const f = await memberFixture(),
    member = await f.add();
  const upload = async () => {
    const result = await uploadHttp(
      [imagePart(), { name: 'bizType', content: 'AVATAR' }],
      f.headers,
    );
    expect(result.statusCode, result.body).toBe(200);
    return result.json().data;
  };
  const first = await upload();
  expect(
    (
      await post(
        '/users/me/update',
        { avatarUrl: first.objectKey, avatarUploadToken: first.uploadToken },
        member.headers,
      )
    ).statusCode,
  ).toBe(403);
  // 头像先认领、后证件校验失败，整个事务仍必须回滚。
  expect(
    (
      await post(
        '/users/me/update',
        { avatarUrl: first.objectKey, avatarUploadToken: first.uploadToken, idCardNo: 'invalid' },
        f.headers,
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { objectKey: first.objectKey } })).status,
  ).toBe('UPLOADED');
  const saved = await post(
    '/users/me/update',
    { avatarUrl: first.objectKey, avatarUploadToken: first.uploadToken },
    f.headers,
  );
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().data.avatarUrl).toBe(first.url);
  expect(
    await db.uploadedFile.findUniqueOrThrow({ where: { objectKey: first.objectKey } }),
  ).toMatchObject({
    status: 'CLAIMED',
    claimedBizType: 'USER_AVATAR',
    claimedBizId: f.owner.id,
    expiresAt: null,
  });
  expect((await post('/users/me/update', { avatarUrl: first.url }, f.headers)).statusCode).toBe(
    200,
  );
  expect(
    (await post('/users/me/update', { avatarUrl: first.url }, member.headers)).statusCode,
  ).toBe(409);
  const second = await upload();
  expect(
    (
      await post(
        '/users/me/update',
        { avatarUrl: second.objectKey, avatarUploadToken: second.uploadToken },
        f.headers,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await db.uploadedFile.findUniqueOrThrow({ where: { objectKey: first.objectKey } })).status,
  ).toBe('RELEASED');
  expect(
    (await post('/users/me/update', { avatarUrl: '' }, f.headers)).json().data.avatarUrl,
  ).toBeNull();
  await db.uploadedFile.updateMany({
    where: { claimedBizType: 'USER_AVATAR', status: 'RELEASED' },
    data: { expiresAt: new Date(0) },
  });
  expect(await registry.cleanupExpired()).toMatchObject({ deleted: 2, failed: 0 });
  expect(objects.has(first.objectKey)).toBe(false);
  expect(objects.has(second.objectKey)).toBe(false);
});

test('personal applications list only authenticated applicant with default/all types, states and Shanghai inclusive boundaries', async () => {
  const f = await memberFixture(),
    member = await f.add(),
    other = await f.add();
  const data = {
    processCode: 'TEST',
    processVersion: 1,
    businessType: 'ORG_MEMBER_EXIT',
    businessId: member.rel.id,
    title: '退出申请',
    applicantId: member.user.id,
    applicantName: '成员',
    applicantOrgId: f.orgId,
    applicantOrgName: '组织',
    appliedAt: new Date('2026-09-30T16:00:00Z'),
  };
  await db.approvalFlow.createMany({
    data: [
      {
        ...data,
        flowNo: 'PERSONAL-1',
        formData: {
          targetMemberId: member.rel.id,
          targetMemberName: '历史名字',
          plannedLeaveDate: '2026-11-01',
        },
      },
      {
        ...data,
        flowNo: 'PERSONAL-2',
        businessType: 'ATTENDANCE_LEAVE',
        status: 'REJECTED',
        appliedAt: new Date('2026-10-01T01:00:00Z'),
      },
      { ...data, flowNo: 'OTHER', applicantId: other.user.id },
    ],
  });
  const own = await post('/users/me/applications', {}, member.headers);
  expect(own.statusCode, own.body).toBe(200);
  expect(own.json().data.total).toBe(1);
  expect(own.json().data.records[0]).toMatchObject({
    flowNo: 'PERSONAL-1',
    targetMemberName: `${member.user.displayName}(${member.user.realName})`,
    appliedAt: '2026-10-01 00:00:00',
    flowVersionNo: 0,
  });
  const all = await post(
    '/users/me/applications',
    { businessType: null, current: 1, size: 1 },
    member.headers,
  );
  expect(all.json().data).toMatchObject({
    total: 2,
    pages: 2,
    records: [{ flowNo: 'PERSONAL-2' }],
  });
  const boundary = await post(
    '/users/me/applications',
    { startAt: '2026-10-01 00:00:00', endAt: '2026-10-01 00:00:00' },
    member.headers,
  );
  expect(boundary.json().data.total).toBe(1);
  expect(
    (await post('/users/me/applications', { applicantId: other.user.id }, member.headers))
      .statusCode,
  ).toBe(400);
  expect((await post('/users/me/applications', {}, f.headers)).json().data.total).toBe(0);
});

test('independent batch schedule is atomic, canonical-idempotent under concurrency, versioned and disallowed after joining organization', async () => {
  await register();
  const headers = bearer((await login(desktop)).json().data.accessToken);
  const input = {
    schedules: [
      { scheduleDate: '2020-01-01', dayType: 'WORK', startTime: '09:00', endTime: '18:00' },
    ],
    overwrite: false,
  };
  const put = (body = input, key = 'schedule-one') =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/users/me/schedules/batch',
      payload: body,
      headers: { ...headers, 'idempotency-key': key },
    });
  const results = await Promise.all([put(), put()]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(results[0]!.json().data).toEqual(results[1]!.json().data);
  expect(await db.orgMemberSchedule.count()).toBe(1);
  expect(await db.personalScheduleReceipt.count()).toBe(1);
  expect((await put({ ...input, overwrite: true })).statusCode).toBe(409);
  const skipped = await put(input, 'schedule-two');
  expect(skipped.json().data).toMatchObject({
    createdCount: 0,
    skippedCount: 1,
    conflicts: [{ versionNo: 0 }],
  });
  const replaced = await put({ ...input, overwrite: true }, 'schedule-three');
  expect(replaced.json().data.updatedCount).toBe(1);
  expect((await db.orgMemberSchedule.findFirstOrThrow()).versionNo).toBe(1);
  expect(
    (
      await put(
        {
          ...input,
          schedules: [...input.schedules, { ...input.schedules[0]!, scheduleDate: '2020-02-30' }],
        },
        'bad-date',
      )
    ).statusCode,
  ).toBe(400);
  expect(await db.personalScheduleReceipt.count()).toBe(3);
  const org = await db.organization.create({ data: { name: '新组织', expertiseTags: [] } });
  const user = await db.user.findFirstOrThrow();
  await db.userOrgRel.create({ data: { userId: user.id, uid: user.uid, orgId: org.id } });
  expect((await put(input, 'now-in-org')).statusCode).toBe(403);
  expect(
    (await app.inject({ url: '/api/v1/organizations/attendance?month=2020-01', headers }))
      .statusCode,
  ).toBe(403);
});

test('monthly attendance joins own scope, fills full month and only displays historical absences without creating daily rows', async () => {
  const f = await memberFixture(),
    member = await f.add(),
    other = await f.add();
  await db.orgMemberSchedule.createMany({
    data: [
      {
        scopeKey: f.orgId,
        orgId: f.orgId,
        userOrgRelId: member.rel.id,
        userId: member.user.id,
        scheduleDate: new Date('2020-01-01'),
        dayType: 'WORK',
        shiftStartAt: new Date('2020-01-01T09:00:00Z'),
        shiftEndAt: new Date('2020-01-01T18:00:00Z'),
        createdBy: f.owner.uid,
        updatedBy: f.owner.uid,
      },
      {
        scopeKey: f.orgId,
        orgId: f.orgId,
        userOrgRelId: other.rel.id,
        userId: other.user.id,
        scheduleDate: new Date('2020-01-02'),
        dayType: 'REST',
        createdBy: f.owner.uid,
        updatedBy: f.owner.uid,
      },
    ],
  });
  const response = await app.inject({
    url: `/api/v1/organizations/attendance?month=2020-01&orgId=${f.orgId}`,
    headers: member.headers,
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().data).toMatchObject({
    memberId: member.rel.id,
    summary: { absentCount: 1 },
    permissions: { canBatchSchedule: false, canDirectUpdate: false },
  });
  expect(response.json().data.days).toHaveLength(31);
  expect(response.json().data.days[0]).toMatchObject({
    calendarStatus: 'ABSENT',
    dailyId: null,
    shiftStartAt: '2020-01-01 09:00:00',
  });
  expect(response.json().data.days[1].calendarStatus).toBe('UNSCHEDULED');
  expect(await db.orgAttendanceDaily.count()).toBe(0);
  expect(
    (
      await app.inject({
        url: `/api/v1/organizations/attendance?month=2020-01&orgId=${f.orgId}&userId=${other.user.id}`,
        headers: member.headers,
      })
    ).statusCode,
  ).toBe(400);
});

test('direct attendance correction denies members and future dates, serializes versions and appends a single audit', async () => {
  const f = await memberFixture(),
    member = await f.add();
  const daily = await db.orgAttendanceDaily.create({
    data: {
      scopeKey: f.orgId,
      orgId: f.orgId,
      userOrgRelId: member.rel.id,
      userId: member.user.id,
      attendanceDate: new Date('2020-01-01'),
      autoStatus: 'ABSENT',
      finalStatus: 'ABSENT',
      createdBy: f.owner.uid,
      updatedBy: f.owner.uid,
    },
  });
  const input = {
    orgId: f.orgId,
    dailyId: daily.id,
    finalStatus: 'PRESENT',
    manualRemark: '核实正常',
    versionNo: 0,
  };
  expect((await post('/organizations/attendance/update', input, member.headers)).statusCode).toBe(
    403,
  );
  const concurrent = await Promise.all([
    post('/organizations/attendance/update', input, f.headers),
    post('/organizations/attendance/update', input, f.headers),
  ]);
  expect(concurrent.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await db.orgAttendanceAdjustment.count()).toBe(1);
  expect(await db.orgAttendanceDaily.findUniqueOrThrow({ where: { id: daily.id } })).toMatchObject({
    autoStatus: 'ABSENT',
    finalStatus: 'PRESENT',
    manualOverride: true,
    versionNo: 1,
  });
  await db.orgAttendanceDaily.update({
    where: { id: daily.id },
    data: { attendanceDate: new Date('2099-01-01') },
  });
  expect(
    (await post('/organizations/attendance/update', { ...input, versionNo: 1 }, f.headers))
      .statusCode,
  ).toBe(400);
  expect(await db.orgAttendanceAdjustment.count()).toBe(1);
});

test('my projects require own acceptance, honor organization preference and use actual admission/membership progress', async () => {
  const f = await memberFixture(),
    member = await f.add();
  const project = await memberCountProject(f.owner, 'MY-PROJECT');
  const personal = await db.projectExpertAssignment.create({
    data: {
      assignmentNo: 'MY-PERSONAL',
      projectId: project.id,
      subjectType: 'INDIVIDUAL',
      expertUserId: member.user.id,
      status: 'ACCEPTED',
      createdBy: f.owner.uid,
    },
  });
  const get = () =>
    app.inject({ url: '/api/v1/expert-assignments/my-projects', headers: member.headers });
  const result = await get();
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().data).toMatchObject([
    {
      assignmentId: personal.id,
      admissionStatus: 'NOT_EXAMINED',
      currentNodeCode: 'STANDARD_TRAINING',
    },
  ]);
  const org = await db.projectExpertAssignment.create({
    data: {
      assignmentNo: 'MY-ORG',
      projectId: project.id,
      subjectType: 'ORGANIZATION',
      organizationId: f.orgId,
      status: 'ACCEPTED',
      createdBy: f.owner.uid,
    },
  });
  expect((await get()).json().data).toEqual([]); // 有效组织成员尚未响应，个人身份暂不列出。
  await db.projectExpertAssignmentMember.create({
    data: {
      assignmentId: org.id,
      userId: member.user.id,
      userOrgRelId: member.rel.id,
      status: 'ACCEPTED',
      createdBy: member.user.uid,
    },
  });
  expect((await get()).json().data[0].assignmentId).toBe(org.id);
  await db.projectMember.create({
    data: {
      projectId: project.id,
      userId: member.user.id,
      userOrgRelId: member.rel.id,
      organizationId: f.orgId,
      expertAssignmentId: org.id,
      joinedAt: new Date(),
      standardTrainingConfirmedAt: new Date(),
      createdBy: f.owner.uid,
    },
  });
  expect((await get()).json().data[0].currentNodeCode).toBe('PRODUCTION_TASK');
  await db.projectExpertAssignmentOwner.create({
    data: { assignmentId: org.id, userId: member.user.id, createdBy: f.owner.uid },
  });
  expect((await get()).json().data).toEqual([]); // 负责人不是普通成员口径。
  await db.userOrgRel.update({ where: { id: member.rel.id }, data: { joinStatus: 'LEFT' } });
  expect((await get()).json().data[0].assignmentId).toBe(personal.id);
});

test('expert detail preserves readonly project/production shape and prevents unrelated/ordinary pre-acceptance access', async () => {
  const f = await memberFixture(),
    member = await f.add(),
    other = await f.add();
  const project = await memberCountProject(f.owner, 'ASSIGNMENT-DETAIL');
  const assignment = await db.projectExpertAssignment.create({
    data: {
      assignmentNo: 'DETAIL-ORG',
      projectId: project.id,
      subjectType: 'ORGANIZATION',
      organizationId: f.orgId,
      productionRequirement: 123.5,
      operatorHeadcount: 2,
      inspectorHeadcount: 1,
      createdBy: f.owner.uid,
    },
  });
  const get = (headers: Record<string, string>) =>
    app.inject({ url: `/api/v1/expert-assignments/detail?assignmentId=${assignment.id}`, headers });
  expect((await get(member.headers)).statusCode).toBe(403);
  const ownerDetail = await get(f.headers);
  expect(ownerDetail.statusCode, ownerDetail.body).toBe(200);
  expect(ownerDetail.json().data).toMatchObject({
    assignmentId: assignment.id,
    availableOperations: ['VIEW_DETAIL'],
    productionPlan: {
      hasPlan: false,
      operatorHeadcount: 2,
      inspectorHeadcount: 1,
      totalExpectedOutput: 123.5,
      crowds: [],
      stages: [],
    },
  });
  expect(ownerDetail.json().data.productionPlan).not.toHaveProperty('confirmedBy');
  await db.projectExpertAssignment.update({
    where: { id: assignment.id },
    data: { status: 'ACCEPTED' },
  });
  expect((await get(member.headers)).statusCode).toBe(200);
  await db.userOrgRel.update({ where: { id: other.rel.id }, data: { joinStatus: 'REMOVED' } });
  expect((await get(other.headers)).statusCode).toBe(403);
});

async function attendanceApplicationFixture(date = '2020-01-01', existingDaily = false) {
  const columns = await db.$queryRaw<
    { column_name: string; is_nullable: string }[]
  >`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='OrgAttendanceDaily' AND column_name IN ('autoStatus','finalStatus')`;
  if (columns.length !== 2 || columns.some((column) => column.is_nullable !== 'YES'))
    throw new Error(
      '专用测试库尚未应用第16迁移20261021020000_attendance_applications，请先migrate deploy再运行新增考勤申请集成',
    );
  const f = await memberFixture(),
    member = await f.add();
  const schedule = await db.orgMemberSchedule.create({
    data: {
      scopeKey: f.orgId,
      orgId: f.orgId,
      userOrgRelId: member.rel.id,
      userId: member.user.id,
      scheduleDate: new Date(date),
      dayType: 'WORK',
      shiftStartAt: new Date(`${date}T09:00:00Z`),
      shiftEndAt: new Date(`${date}T18:00:00Z`),
      createdBy: f.owner.uid,
      updatedBy: f.owner.uid,
    },
  });
  const daily = existingDaily
    ? await db.orgAttendanceDaily.create({
        data: {
          scopeKey: f.orgId,
          orgId: f.orgId,
          userOrgRelId: member.rel.id,
          userId: member.user.id,
          attendanceDate: new Date(date),
          scheduleId: schedule.id,
          autoStatus: 'ABSENT',
          finalStatus: 'ABSENT',
          createdBy: f.owner.uid,
          updatedBy: f.owner.uid,
        },
      })
    : null;
  const input = {
    orgId: f.orgId,
    attendanceDate: date,
    applicationType: 'CORRECTION',
    finalStatus: 'PRESENT',
    reason: '补充出勤记录',
    versionNo: daily?.versionNo ?? null,
  };
  const apply = (payload: unknown = input, headers = member.headers) =>
    post('/organizations/attendance/apply', payload, headers);
  const leave = {
    ...input,
    applicationType: 'LEAVE',
    finalStatus: 'LEAVE',
    reason: '个人事务请假',
    leaveStartAt: `${date} 09:00:00`,
    leaveEndAt: `${date} 12:00:00`,
  };
  const processInput = async (applicationId: string, action = 'APPROVE') => {
    const flow = await db.approvalFlow.findUniqueOrThrow({ where: { id: applicationId } });
    const node = await db.approvalNode.findFirstOrThrow({ where: { flowId: flow.id } });
    return {
      orgId: f.orgId,
      flowNo: flow.flowNo,
      nodeId: node.id,
      flowVersionNo: flow.versionNo,
      nodeVersionNo: node.versionNo,
      action,
      actionComment: action === 'REJECT' ? '说明不充分' : '核实通过',
    };
  };
  const month = () =>
    app.inject({
      url: `/api/v1/organizations/attendance?month=${date.slice(0, 7)}&orgId=${f.orgId}`,
      headers: member.headers,
    });
  return { ...f, member, schedule, daily, input, leave, apply, processInput, month };
}
test('attendance correction creates pending owner flow without attendance mutations; approval creates daily and audit atomically', async () => {
  const f = await attendanceApplicationFixture();
  const submitted = await f.apply();
  expect(submitted.statusCode, submitted.body).toBe(200);
  const result = submitted.json().data;
  expect(result).toMatchObject({
    status: 'PENDING',
    businessType: 'ATTENDANCE_CORRECTION',
    versionNo: null,
    flowVersionNo: 0,
  });
  expect(await db.orgAttendanceDaily.count()).toBe(0);
  const list = await post(
    '/users/me/applications',
    { businessType: 'ATTENDANCE_CORRECTION' },
    f.member.headers,
  );
  expect(list.json().data.records).toMatchObject([
    { applicationId: result.applicationId, status: 'PENDING', flowVersionNo: 0 },
  ]);
  const pending = await post(
    '/organizations/approvals/pending',
    { orgId: f.orgId, businessType: 'ATTENDANCE_CORRECTION' },
    f.headers,
  );
  expect(pending.statusCode, pending.body).toBe(200);
  expect(pending.json().data.total).toBe(1);
  expect(pending.json().data.records[0].formData.attendanceDate).toBe('2020-01-01');
  const processed = await post(
    '/organizations/approvals/process',
    await f.processInput(result.applicationId),
    f.headers,
  );
  expect(processed.statusCode, processed.body).toBe(200);
  expect(processed.json().data).toMatchObject({
    applicationId: result.applicationId,
    flowStatus: 'APPROVED',
    flowVersionNo: 1,
    dailyVersionNo: 0,
    finalStatus: 'PRESENT',
    joinStatus: null,
    plannedLeaveDate: null,
  });
  const daily = await db.orgAttendanceDaily.findFirstOrThrow();
  expect(daily).toMatchObject({
    userId: f.member.user.id,
    autoStatus: 'ABSENT',
    finalStatus: 'PRESENT',
    manualOverride: true,
  });
  expect(await db.orgAttendanceAdjustment.count()).toBe(1);
  const flow = await db.approvalFlow.findUniqueOrThrow({ where: { id: result.applicationId } });
  expect(flow).toMatchObject({
    status: 'APPROVED',
    versionNo: 1,
    afterData: { dailyId: daily.id, finalStatus: 'PRESENT' },
  });
  expect((await f.month()).json().data.summary.presentCount).toBe(1);
  const records = await post(
    '/organizations/approvals/records',
    { orgId: f.orgId, businessType: 'ATTENDANCE_CORRECTION' },
    f.headers,
  );
  expect(records.json().data.total).toBe(1);
});
test('future leave requires valid shift period and stays pending until approval; no fabricated auto attendance', async () => {
  const f = await attendanceApplicationFixture('2099-01-01');
  expect((await f.apply()).statusCode).toBe(400); // future CORRECTION
  for (const extra of [
    { leaveStartAt: '2099-01-01 08:00:00' },
    { leaveEndAt: '2099-01-02 12:00:00' },
    { finalStatus: 'PRESENT' },
  ])
    expect((await f.apply({ ...f.leave, ...extra })).statusCode).toBe(400);
  const submitted = await f.apply(f.leave);
  expect(submitted.statusCode, submitted.body).toBe(200);
  const id = submitted.json().data.applicationId;
  let month = (await f.month()).json().data;
  expect(month.days[0]).toMatchObject({
    calendarStatus: 'PENDING_ATTENDANCE',
    application: { applicationId: id, canWithdraw: true },
    permissions: { canApplyLeave: false, canWithdraw: true },
  });
  expect(await db.orgAttendanceDaily.count()).toBe(0);
  const processed = await post(
    '/organizations/approvals/process',
    await f.processInput(id),
    f.headers,
  );
  expect(processed.statusCode, processed.body).toBe(200);
  expect(await db.orgAttendanceDaily.findFirstOrThrow()).toMatchObject({
    finalStatus: 'LEAVE',
    autoStatus: null,
    firstClockInAt: null,
    lastClockOutAt: null,
  });
  expect(await db.orgAttendanceAdjustment.findFirstOrThrow()).toMatchObject({
    beforeStatus: null,
    afterStatus: 'LEAVE',
  });
  month = (await f.month()).json().data;
  expect(month.summary.leaveCount).toBe(1);
  expect(month.days[0]).toMatchObject({
    calendarStatus: 'LEAVE',
    autoStatus: null,
    application: { status: 'APPROVED', canWithdraw: false },
    permissions: { canApplyLeave: false },
  });
  expect((await f.apply({ ...f.leave, versionNo: 0 })).statusCode).toBe(409);
});
test('same-day leave/correction pending applications are mutually exclusive under concurrent submission', async () => {
  const f = await attendanceApplicationFixture();
  const results = await Promise.all([f.apply(), f.apply(f.leave)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await db.approvalFlow.count()).toBe(1);
  expect(await db.approvalNode.count()).toBe(1);
  expect(await db.orgAttendanceDaily.count()).toBe(0);
});
test('withdraw enforces applicant/version/business and cancels node without writing attendance; ended flows reject reuse', async () => {
  const f = await attendanceApplicationFixture();
  const other = await f.add();
  const submitted = await f.apply();
  const { applicationId, flowVersionNo } = submitted.json().data;
  const body = { applicationId, flowVersionNo };
  expect((await post('/organizations/attendance/withdraw', body, other.headers)).statusCode).toBe(
    403,
  );
  expect(
    (
      await post(
        '/organizations/attendance/withdraw',
        { ...body, flowVersionNo: 99 },
        f.member.headers,
      )
    ).statusCode,
  ).toBe(409);
  const response = await post('/organizations/attendance/withdraw', body, f.member.headers);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().data).toMatchObject({ status: 'WITHDRAWN', flowVersionNo: 1 });
  expect(await db.approvalNode.findFirstOrThrow()).toMatchObject({
    nodeStatus: 'CANCELED',
    versionNo: 1,
    approvedAt: null,
  });
  expect(await db.approvalActionLog.count({ where: { actionType: 'WITHDRAW' } })).toBe(1);
  expect(await db.orgAttendanceDaily.count()).toBe(0);
  expect(
    (await post('/organizations/attendance/withdraw', body, f.member.headers)).statusCode,
  ).toBe(409);
  expect((await f.month()).json().data.days[0].permissions.canApplyCorrection).toBe(true);
  expect((await f.apply()).statusCode).toBe(200); // resubmit after withdrawal allowed
});
test('withdraw and owner approval serialize to exactly one outcome with no partial state or double audit', async () => {
  const f = await attendanceApplicationFixture();
  const submitted = await f.apply();
  const { applicationId, flowVersionNo } = submitted.json().data;
  const processInput = await f.processInput(applicationId);
  const results = await Promise.all([
    post('/organizations/approvals/process', processInput, f.headers),
    post('/organizations/attendance/withdraw', { applicationId, flowVersionNo }, f.member.headers),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const flow = await db.approvalFlow.findUniqueOrThrow({ where: { id: applicationId } });
  expect(flow.versionNo).toBe(1);
  expect(await db.orgAttendanceDaily.count()).toBe(flow.status === 'APPROVED' ? 1 : 0);
  expect(await db.orgAttendanceAdjustment.count()).toBe(flow.status === 'APPROVED' ? 1 : 0);
  expect(await db.approvalActionLog.count({ where: { flowId: applicationId } })).toBe(2);
});
test('approval refuses stale day/shift snapshots while rejection remains possible and never writes target attendance', async () => {
  const f = await attendanceApplicationFixture('2020-01-01', true);
  const submitted = await f.apply();
  const id = submitted.json().data.applicationId;
  expect(
    (
      await post(
        '/organizations/attendance/update',
        { orgId: f.orgId, dailyId: f.daily!.id, finalStatus: 'REST', versionNo: 0 },
        f.headers,
      )
    ).statusCode,
  ).toBe(200);
  const processInput = await f.processInput(id);
  expect((await post('/organizations/approvals/process', processInput, f.headers)).statusCode).toBe(
    409,
  );
  expect(await db.approvalFlow.findUniqueOrThrow({ where: { id } })).toMatchObject({
    status: 'PENDING',
    versionNo: 0,
  });
  expect(await db.approvalNode.findFirstOrThrow({ where: { flowId: id } })).toMatchObject({
    nodeStatus: 'PENDING',
    versionNo: 0,
  });
  expect(await db.orgAttendanceAdjustment.count()).toBe(1); // only direct correction, no failed approval audit
  const rejected = await post(
    '/organizations/approvals/process',
    { ...processInput, action: 'REJECT', actionComment: '重新提交当前版本' },
    f.headers,
  );
  expect(rejected.statusCode, rejected.body).toBe(200);
  expect(rejected.json().data).toMatchObject({
    flowStatus: 'REJECTED',
    dailyId: null,
    finalStatus: null,
  });
  expect(
    (await db.orgAttendanceDaily.findUniqueOrThrow({ where: { id: f.daily!.id } })).finalStatus,
  ).toBe('REST');
  const next = await f.apply({ ...f.input, versionNo: 1 });
  expect(next.statusCode).toBe(200);
  await db.orgMemberSchedule.update({
    where: { id: f.schedule.id },
    data: { versionNo: { increment: 1 } },
  });
  expect(
    (
      await post(
        '/organizations/approvals/process',
        await f.processInput(next.json().data.applicationId),
        f.headers,
      )
    ).statusCode,
  ).toBe(409);
});
test('attendance application permission cannot be replaced by target IDs, admin reviewer status, organization exit or another business flow', async () => {
  const f = await attendanceApplicationFixture();
  const admin = await f.add('ADMIN');
  expect((await f.apply(f.input, f.headers)).statusCode).toBe(403); // supervisor self
  expect((await f.apply({ ...f.input, userId: admin.user.id })).statusCode).toBe(400);
  const submitted = await f.apply();
  const id = submitted.json().data.applicationId;
  expect(
    (await post('/organizations/approvals/process', await f.processInput(id), admin.headers))
      .statusCode,
  ).toBe(403);
  await db.userOrgRel.update({ where: { id: f.member.rel.id }, data: { joinStatus: 'LEFT' } });
  expect(
    (await post('/organizations/approvals/process', await f.processInput(id), f.headers))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await post(
        '/organizations/attendance/withdraw',
        { applicationId: id, flowVersionNo: 0 },
        f.member.headers,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (await db.userOrgRel.findUniqueOrThrow({ where: { id: f.member.rel.id } })).joinStatus,
  ).toBe('LEFT');
  const other = await f.add();
  const exit = await post(
    '/organizations/members/exit-requests',
    { orgId: f.orgId, reason: '个人发展', plannedLeaveDate: '2099-01-01' },
    { ...other.headers, 'idempotency-key': 'exit-not-attendance' },
  );
  expect(exit.statusCode).toBe(200);
  const flow = await db.approvalFlow.findUniqueOrThrow({
    where: { flowNo: exit.json().data.flowNo },
  });
  expect(
    (
      await post(
        '/organizations/attendance/withdraw',
        { applicationId: flow.id, flowVersionNo: 0 },
        other.headers,
      )
    ).statusCode,
  ).toBe(400);
});
test('approved existing-day correction increments its version, keeps raw auto status and blocks old workflow snapshots', async () => {
  const f = await attendanceApplicationFixture('2020-01-01', true);
  const response = await f.apply();
  const id = response.json().data.applicationId;
  const processInput = await f.processInput(id);
  const approved = await post('/organizations/approvals/process', processInput, f.headers);
  expect(approved.statusCode, approved.body).toBe(200);
  expect(approved.json().data).toMatchObject({
    dailyId: f.daily!.id,
    dailyVersionNo: 1,
    finalStatus: 'PRESENT',
  });
  expect(
    await db.orgAttendanceDaily.findUniqueOrThrow({ where: { id: f.daily!.id } }),
  ).toMatchObject({
    autoStatus: 'ABSENT',
    finalStatus: 'PRESENT',
    versionNo: 1,
    manualOverride: true,
  });
  expect(await db.orgAttendanceAdjustment.count()).toBe(1);
  expect((await post('/organizations/approvals/process', processInput, f.headers)).statusCode).toBe(
    409,
  );
  expect(await db.orgAttendanceAdjustment.count()).toBe(1);
});
