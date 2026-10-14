import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { createApp } from '../src/application.js';
import { readConfig } from '../src/config/index.js';
import { digest } from '../src/modules/auth/security.js';
// Prisma 可能在导入时加载 .env。测试配置必须显式解析，不能依赖不覆盖已有值的 loadEnvFile。
const testEnv = parseEnv(readFileSync(new URL('../.env.test', import.meta.url), 'utf8'));
const config = readConfig(testEnv);
const url = new URL(config.databaseUrl);
if (
  config.env !== 'test' ||
  !url.pathname.endsWith('_test') ||
  testEnv.TEST_DATABASE_RESET !== 'true'
)
  throw new Error(
    '集成测试要求 APP_ENV=test、数据库名以 _test 结尾且 TEST_DATABASE_RESET=true；仅使用专用测试库',
  );
const db = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
const app = await createApp(config, db);
const web = { origin: config.webOrigins[0]!, 'x-tyde-client': 'web' };
const desktop = { 'x-tyde-client': 'desktop' };
beforeAll(async () => {
  await app.ready();
});
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "AuthRateLimit", "Session", "RegistrationGrant", "VerificationChallenge", "User" CASCADE',
  );
});
afterAll(async () => {
  await app.close();
});
async function code(phone = '13812345678') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/code',
    headers: web,
    payload: { region: 'CN', phone },
  });
  expect(response.statusCode).toBe(200);
  return response.json().challengeId as string;
}
async function verify(phone: string, challengeId: string, headers = web, value = '095270') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify',
    headers,
    payload: { region: 'CN', phone, challengeId, code: value },
  });
}
async function register(
  phone = '13812345678',
  username = 'alex',
  headers: Record<string, string> = web,
) {
  const challengeId = await code(phone);
  const verified = await verify(phone, challengeId, headers);
  expect(verified.statusCode).toBe(200);
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers,
    payload: {
      registrationToken: verified.json().registrationToken,
      username,
      displayName: '小明 世界',
    },
  });
  expect(result.statusCode).toBe(201);
  return result;
}
test('new Web user completes profile, persists, restores session and logs out', async () => {
  const created = await register();
  expect(created.json().sessionToken).toBeUndefined();
  expect(created.json().user.username).toBe('alex');
  const cookie = created.cookies[0]!;
  expect(cookie.httpOnly).toBe(true);
  const headers = { ...web, cookie: `${cookie.name}=${cookie.value}` };
  expect((await app.inject({ url: '/api/v1/auth/me', headers })).statusCode).toBe(200);
  expect(await db.user.count()).toBe(1);
  expect(
    (await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers })).statusCode,
  ).toBe(204);
  expect((await app.inject({ url: '/api/v1/auth/me', headers })).statusCode).toBe(401);
});
test('same account logs in on desktop; logout revokes only desktop session', async () => {
  const created = await register();
  const cookie = created.cookies[0]!;
  const challenge = await db.verificationChallenge.findFirstOrThrow();
  await db.verificationChallenge.update({
    where: { id: challenge.id },
    data: { createdAt: new Date(Date.now() - 61_000) },
  });
  const desktopResult = await verify('13812345678', await code(), desktop);
  expect(desktopResult.json().status).toBe('authenticated');
  expect(desktopResult.json().user.id).toBe(created.json().user.id);
  const token = desktopResult.json().sessionToken as string;
  expect(await db.session.findUnique({ where: { tokenDigest: digest(token) } })).not.toBeNull();
  const headers = { ...desktop, authorization: `Bearer ${token}` };
  expect((await app.inject({ url: '/api/v1/auth/me', headers })).statusCode).toBe(200);
  await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers });
  expect((await app.inject({ url: '/api/v1/auth/me', headers })).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        url: '/api/v1/auth/me',
        headers: { ...web, cookie: `${cookie.name}=${cookie.value}` },
      })
    ).statusCode,
  ).toBe(200);
});
test('wrong attempts commit and lock the challenge; consumed code cannot replay', async () => {
  const id = await code();
  for (let i = 0; i < 5; i++)
    expect((await verify('13812345678', id, web, '000000')).statusCode).toBe(400);
  expect((await verify('13812345678', id)).statusCode).toBe(429);
  expect((await db.verificationChallenge.findUniqueOrThrow({ where: { id } })).failedAttempts).toBe(
    5,
  );
});
test('expired, mismatched and replayed challenges fail', async () => {
  const id = await code();
  expect((await verify('13912345678', id)).statusCode).toBe(400);
  expect((await verify('13812345678', id)).statusCode).toBe(200);
  expect((await verify('13812345678', id)).statusCode).toBe(410);
  const other = await code('13912345678');
  await db.verificationChallenge.update({ where: { id: other }, data: { expiresAt: new Date(0) } });
  expect((await verify('13912345678', other)).statusCode).toBe(410);
});
test('username collision leaves registration grant reusable for corrected profile', async () => {
  await register();
  const verified = await verify('13912345678', await code('13912345678'));
  const registrationToken = verified.json().registrationToken as string;
  const payload = { registrationToken, username: 'ALEX', displayName: 'Alex' };
  expect(
    (await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: web, payload }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: web,
        payload: { ...payload, username: 'alex2' },
      })
    ).statusCode,
  ).toBe(201);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: web,
        payload: { ...payload, username: 'alex3' },
      })
    ).statusCode,
  ).toBe(410);
});
test('concurrent verification produces only one valid registration grant', async () => {
  const id = await code();
  const results = await Promise.all([verify('13812345678', id), verify('13812345678', id)]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 410]);
  expect(await db.registrationGrant.count()).toBe(1);
});
test('resend cooldown and browser transport spoofing are enforced server-side', async () => {
  await code();
  const resend = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/code',
    headers: web,
    payload: { region: 'CN', phone: '13812345678' },
  });
  expect(resend.statusCode).toBe(429);
  expect(Number(resend.headers['retry-after'])).toBeGreaterThan(0);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/code',
        headers: { ...desktop, origin: web.origin },
        payload: { region: 'CN', phone: '13912345678' },
      })
    ).statusCode,
  ).toBe(403);
  expect((await app.inject({ url: '/api/v1/auth/me', headers: web })).statusCode).toBe(401);
});
