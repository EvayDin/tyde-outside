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
    'TRUNCATE "MemberImportReceipt", "ApprovalActionLog", "ApprovalNode", "ApprovalFlow", "OrganizationDeparture", "UploadedFile", "AuthRateLimit", "Session", "RegistrationGrant", "VerificationChallenge", "User", "Organization" CASCADE',
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
    activeProjectCount: null,
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
  ).toBe(503);
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
