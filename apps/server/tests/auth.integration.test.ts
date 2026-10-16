import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { PrismaClient } from '@prisma/client';
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
    'TRUNCATE "UploadedFile", "AuthRateLimit", "Session", "RegistrationGrant", "VerificationChallenge", "User", "Organization" CASCADE',
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
    401,
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
        { ...registration, phone: '13912345678', email: 'other@example.com' },
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
