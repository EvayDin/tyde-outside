import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DesktopAuthClient } from '../apps/electron/src/main/auth-client.ts';
import { SessionStore } from '../apps/electron/src/main/session.ts';
import { checkIpcInput } from '../apps/electron/src/main/ipc/validation.ts';
import {
  smsSendSchema,
  smsLoginSchema,
  smsRegisterSchema,
  loginSchema,
} from '../packages/shared/src/auth.ts';
import { createRequire } from 'node:module';

const { Type } = createRequire(new URL('../apps/electron/package.json', import.meta.url))(
  '@sinclair/typebox',
);

const origin = 'https://api.example.invalid';
const first = { accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43) };
const second = { accessToken: 'b'.repeat(43), refreshToken: 's'.repeat(43) };
const person = {
  id: 'fixture-user',
  uid: 'fixture-uid',
  realName: 'Fixture User',
  nickname: 'Fixture',
  phone: '138****5678',
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
function store(initial) {
  let value = initial;
  return {
    async load() {
      return value;
    },
    async save(tokens) {
      value = tokens;
    },
    async clear() {
      value = undefined;
    },
  };
}
function response(data, status = 200, headers) {
  return new Response(
    JSON.stringify({ code: status, message: status === 200 ? '操作成功' : 'fixture error', data }),
    { status, headers },
  );
}
function login(tokens = first) {
  return response({ ...tokens, tokenType: 'Bearer', expiresIn: 2592000 });
}
function fixture(initial, serve) {
  const calls = [];
  const storage = store(initial);
  const client = new DesktopAuthClient(origin, storage, async (url, method, headers, body) => {
    assert.equal(headers['X-Tyde-Client'], 'desktop');
    assert.equal(headers.Cookie, undefined);
    assert.equal(headers.Origin, undefined);
    const call = { path: new URL(url).pathname, method, headers, body: body && JSON.parse(body) };
    calls.push(call);
    return serve(call);
  });
  return { client, storage, calls };
}

test('real IPC schemas enforce string enums, object boundaries and password patterns', () => {
  for (const scene of ['login', 'register', 'reset_password'])
    assert.equal(checkIpcInput(smsSendSchema, { phone: '13812345678', scene }), true);
  for (const scene of ['invalid', '', null, 1, ['login']])
    assert.equal(checkIpcInput(smsSendSchema, { phone: '13812345678', scene }), false);
  assert.equal(
    checkIpcInput(smsSendSchema, { phone: '13812345678', scene: 'login', extra: true }),
    false,
  );
  assert.equal(checkIpcInput(smsSendSchema, { phone: '123', scene: 'login' }), false);
  assert.equal(checkIpcInput(undefined, undefined), true);
  assert.equal(checkIpcInput(undefined, {}), false);

  const registration = {
    accountType: 'INDIVIDUAL',
    phone: '13812345678',
    code: '123456',
    password: 'Example123!',
    confirmPassword: 'Example123!',
    realName: 'Fixture',
  };
  assert.equal(checkIpcInput(smsRegisterSchema, registration), true);
  for (const accountType of ['INDIVIDUAL', 'ORGANIZATION'])
    assert.equal(checkIpcInput(smsRegisterSchema, { ...registration, accountType }), true);
  for (const role of ['NAVIGATOR', 'PM', 'EXPERT', 'OPS']) {
    assert.equal(
      checkIpcInput(smsLoginSchema, { phone: '13812345678', code: '123456', role }),
      true,
    );
    assert.equal(
      checkIpcInput(loginSchema, { account: 'fixture', password: 'Example123!', role }),
      true,
    );
    assert.equal(checkIpcInput(smsRegisterSchema, { ...registration, roles: [role] }), true);
  }
  assert.equal(
    checkIpcInput(smsLoginSchema, { phone: '13812345678', code: '123456', role: 'UNKNOWN' }),
    false,
  );
  assert.equal(
    checkIpcInput(loginSchema, { account: 'fixture', password: 'Example123!', role: 'UNKNOWN' }),
    false,
  );
  for (const orgPosition of ['OWNER', 'ADMIN', 'MEMBER'])
    assert.equal(checkIpcInput(smsRegisterSchema, { ...registration, orgPosition }), true);
  for (const invalid of [
    { accountType: 'TEAM' },
    { roles: ['UNKNOWN'] },
    { roles: ['EXPERT', 'UNKNOWN'] },
    { orgPosition: 'UNKNOWN' },
    { password: 'lettersOnly' },
    { password: '12345678' },
    { password: 'Short1' },
    { password: 'Example123 ' },
    { extra: true },
    { organization: { name: 'Fixture', extra: true } },
  ])
    assert.equal(checkIpcInput(smsRegisterSchema, { ...registration, ...invalid }), false);

  assert.equal(checkIpcInput(Type.Unsafe({ type: 'number', enum: [1] }), 1), false);
  assert.equal(
    checkIpcInput(Type.Unsafe({ type: 'string', enum: ['x'], minLength: 2 }), 'x'),
    false,
  );
  assert.equal(checkIpcInput(Type.Unsafe({ type: 'string' }), 'anything'), false);
});

test('desktop contracts unwrap responses and keep login credentials out of renderer results', async () => {
  const { client, storage, calls } = fixture(undefined, ({ path }) => {
    if (path === '/api/v1/auth/sms/send') return response('验证码已发送');
    if (path === '/api/v1/auth/login' || path === '/api/v1/auth/sms/login') return login();
    if (path === '/api/v1/users/me' || path === '/api/v1/auth/register')
      return response({
        ...person,
        accessToken: first.accessToken,
        organization: { refreshToken: first.refreshToken },
      });
    if (path === '/api/v1/auth/logout') return response(null);
    throw new Error('unexpected fixture route');
  });
  assert.equal(await client.sendCode({ phone: '13812345678', scene: 'login' }), '验证码已发送');
  assert.equal(await client.login({ account: '13812345678', password: 'Example123!' }), undefined);
  assert.deepEqual(await storage.load(), first);
  assert.deepEqual(await client.verifyCode({ phone: '13812345678', code: '123456' }), {
    status: 'authenticated',
  });
  const profile = await client.getCurrentUser();
  assert.deepEqual(profile, { ...person, organization: {} });
  assert.equal(calls.at(-1).headers.Authorization, `Bearer ${first.accessToken}`);
  assert.doesNotMatch(JSON.stringify(profile), /accessToken|refreshToken|sessionToken/);
  await client.logout();
  assert.equal(await storage.load(), undefined);
  const registered = await client.completeRegistration({
    accountType: 'INDIVIDUAL',
    phone: '13812345678',
    registrationToken: 'g'.repeat(43),
    password: 'Example123!',
    confirmPassword: 'Example123!',
    realName: 'Fixture User',
  });
  assert.equal(registered.id, person.id);
  assert.equal(await storage.load(), undefined, 'registration does not establish a session');
  assert.deepEqual(calls[0].body, { phone: '13812345678', scene: 'login' });
});

test('unregistered SMS login only returns the short-lived registration grant', async () => {
  const grant = {
    status: 'registration_required',
    registrationToken: 'g'.repeat(43),
    expiresAt: '2026-12-01T00:00:00.000Z',
  };
  const { client, storage } = fixture(first, () =>
    response({ ...grant, accessToken: first.accessToken }),
  );
  assert.deepEqual(await client.verifyCode({ phone: '13812345678', code: '123456' }), grant);
  assert.equal(await storage.load(), undefined);
});

test('concurrent unauthorized requests rotate once and retry with the new access token', async () => {
  const refreshStarted = deferred(),
    finishRefresh = deferred();
  const { client, storage, calls } = fixture(first, async ({ path, headers, body }) => {
    if (path === '/api/v1/auth/refresh') {
      assert.deepEqual(body, { refreshToken: first.refreshToken });
      assert.equal(headers.Authorization, undefined);
      refreshStarted.resolve();
      await finishRefresh.promise;
      return login(second);
    }
    assert.equal(path, '/api/v1/users/me');
    return headers.Authorization === `Bearer ${first.accessToken}`
      ? response(null, 401)
      : response(person);
  });
  const requests = [client.getCurrentUser(), client.getCurrentUser()];
  await refreshStarted.promise;
  finishRefresh.resolve();
  assert.deepEqual(await Promise.all(requests), [person, person]);
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 1);
  assert.deepEqual(await storage.load(), second);
});

test('a delayed old 401 reuses already rotated credentials without a second refresh', async () => {
  const lateRequest = deferred(),
    finishLateRequest = deferred();
  let oldRequests = 0;
  const { client, calls } = fixture(first, async ({ path, headers }) => {
    if (path.endsWith('/refresh')) return login(second);
    if (headers.Authorization === `Bearer ${first.accessToken}`) {
      if (++oldRequests === 2) {
        lateRequest.resolve();
        await finishLateRequest.promise;
      }
      return response(null, 401);
    }
    return response(person);
  });
  const earlier = client.getCurrentUser(),
    later = client.getCurrentUser();
  await lateRequest.promise;
  await earlier;
  finishLateRequest.resolve();
  await later;
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 1);
});

test('refresh rejection clears the session and exposes a recognizable expiration error', async () => {
  const { client, storage, calls } = fixture(first, () => response(null, 401));
  await assert.rejects(client.getCurrentUser(), { status: 401, code: 'SESSION_EXPIRED' });
  assert.equal(await storage.load(), undefined);
  assert.equal(calls.length, 2);
});

test('retry is bounded and network refresh failures retain credentials for later recovery', async () => {
  const rejected = fixture(first, ({ path }) =>
    path.endsWith('/refresh') ? login(second) : response(null, 401),
  );
  await assert.rejects(rejected.client.getCurrentUser(), { status: 401, code: 'SESSION_EXPIRED' });
  assert.equal(rejected.calls.length, 3);
  assert.equal(await rejected.storage.load(), undefined);
  const offline = fixture(first, ({ path }) => {
    if (path.endsWith('/refresh')) throw new Error('fixture offline');
    return response(null, 401);
  });
  await assert.rejects(offline.client.getCurrentUser(), { status: 0, code: 'NETWORK_ERROR' });
  assert.deepEqual(await offline.storage.load(), first);
});

test('logout cannot be undone by an in-flight token rotation', async () => {
  const refreshStarted = deferred(),
    finishRefresh = deferred(),
    logoutStarted = deferred();
  const { client, storage, calls } = fixture(first, async ({ path }) => {
    if (path.endsWith('/refresh')) {
      refreshStarted.resolve();
      await finishRefresh.promise;
      return login(second);
    }
    if (path.endsWith('/logout')) {
      logoutStarted.resolve();
      return response(null);
    }
    return response(null, 401);
  });
  const me = client.getCurrentUser();
  const meRejected = assert.rejects(me, { status: 401, code: 'SESSION_CHANGED' });
  await refreshStarted.promise;
  const logout = client.logout();
  await logoutStarted.promise;
  assert.equal(await storage.load(), undefined);
  finishRefresh.resolve();
  await Promise.all([logout, meRejected]);
  assert.equal(await storage.load(), undefined);
  assert.ok(
    calls.some(
      ({ path, headers }) =>
        path.endsWith('/logout') && headers.Authorization === `Bearer ${second.accessToken}`,
    ),
  );
});

test('a login response arriving after logout is discarded and revoked', async () => {
  const loginStarted = deferred(),
    finishLogin = deferred();
  const { client, storage, calls } = fixture(undefined, async ({ path }) => {
    if (path.endsWith('/login')) {
      loginStarted.resolve();
      await finishLogin.promise;
      return login();
    }
    return response(null);
  });
  const signingIn = client.login({ account: '13812345678', password: 'Example123!' });
  const rejected = assert.rejects(signingIn, { status: 401, code: 'SESSION_CHANGED' });
  await loginStarted.promise;
  await client.logout();
  finishLogin.resolve();
  await rejected;
  assert.equal(await storage.load(), undefined);
  assert.ok(
    calls.some(
      ({ path, headers }) =>
        path.endsWith('/logout') && headers.Authorization === `Bearer ${first.accessToken}`,
    ),
  );
});

test('rate limits preserve numeric business codes and Retry-After without exposing response extras', async () => {
  const { client } = fixture(
    undefined,
    () =>
      new Response(
        JSON.stringify({
          code: 4292,
          message: '请稍后重试',
          data: { accessToken: first.accessToken },
        }),
        { status: 429, headers: { 'Retry-After': '17' } },
      ),
  );
  await assert.rejects(client.sendCode({ phone: '13812345678', scene: 'login' }), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, 4292);
    assert.equal(error.retryAfter, 17);
    assert.doesNotMatch(JSON.stringify(error), /accessToken/);
    return true;
  });
});

test('session persistence is encrypted, isolated by origin and serialized against logout', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tyde-session-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(
        'utf8',
      );
    },
  };
  const session = new SessionStore(origin, directory, encryption);
  await session.save(first);
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const file = join(directory, files[0]);
  const bytes = await readFile(file);
  assert.equal(bytes.includes(Buffer.from(first.accessToken)), false);
  assert.equal(bytes.includes(Buffer.from(first.refreshToken)), false);
  assert.deepEqual(await new SessionStore(origin + '/', directory, encryption).load(), first);
  assert.equal(
    await new SessionStore('https://other.example.invalid', directory, encryption).load(),
    undefined,
  );
  await Promise.all([session.save(second), session.clear()]);
  assert.equal(await session.load(), undefined);
  await writeFile(file, encryption.encryptString(first.accessToken));
  assert.equal(await session.load(), undefined, 'legacy single-token files safely expire');
  assert.deepEqual(await readdir(directory), []);
  await assert.rejects(
    new SessionStore(origin, directory, { ...encryption, isEncryptionAvailable: () => false }).save(
      first,
    ),
    /安全存储/,
  );
});
