import { test } from 'node:test';
import assert from 'node:assert/strict';

const phone = '13812345678';
const firstTokens = {
  accessToken: 'a'.repeat(43),
  refreshToken: 'r'.repeat(43),
  tokenType: 'Bearer',
  expiresIn: 1800,
};
const nextTokens = { ...firstTokens, accessToken: 'b'.repeat(43), refreshToken: 's'.repeat(43) };
const user = {
  id: 'fixture-user',
  uid: 'TYDE10001',
  phone,
  realName: '测试小明',
  nickname: '潮汐测试员',
};
const result = (data, status = 200, headers = {}) =>
  new Response(
    JSON.stringify({
      code: status === 429 ? 4292 : status,
      message: status === 200 ? '操作成功' : '服务端错误',
      data,
    }),
    { status, headers: { 'Content-Type': 'application/json', ...headers } },
  );
let sequence = 0;
async function adapter(t, responder) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, options) => {
    const call = {
      path,
      method: options.method,
      credentials: options.credentials,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    calls.push(call);
    return responder(call);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const { webAuth } = await import(`../packages/platform/src/web.ts?case=${++sequence}`);
  return { api: webAuth, calls };
}
function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test('Web adapter uses wrapped SMS/password/registration contracts and keeps tokens out of results', async (t) => {
  const grant = {
    status: 'registration_required',
    registrationToken: 'g'.repeat(43),
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const { api, calls } = await adapter(t, ({ path }) => {
    if (path.endsWith('/sms/send')) return result('服务端原始短信结果 A7');
    if (path.endsWith('/sms/login')) return result(grant);
    if (path.endsWith('/register')) return result(user);
    if (path.endsWith('/login')) return result(firstTokens);
    if (path.endsWith('/users/me')) return result(user);
    if (path.endsWith('/logout')) return result(null);
    throw new Error('unexpected request');
  });
  assert.equal(await api.sendCode({ phone, scene: 'login' }), '服务端原始短信结果 A7');
  assert.deepEqual(await api.verifyCode({ phone, code: '731846' }), grant);
  const registration = {
    accountType: 'INDIVIDUAL',
    phone,
    registrationToken: grant.registrationToken,
    password: 'Password123!',
    confirmPassword: 'Password123!',
    realName: user.realName,
  };
  assert.deepEqual(await api.completeRegistration(registration), user);
  assert.equal(await api.login({ account: phone, password: 'Password123!' }), undefined);
  assert.deepEqual(await api.getCurrentUser(), user);
  assert.equal(await api.logout(), undefined);
  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      '/api/v1/auth/sms/send',
      '/api/v1/auth/sms/login',
      '/api/v1/auth/register',
      '/api/v1/auth/login',
      '/api/v1/users/me',
      '/api/v1/auth/logout',
    ],
  );
  assert.deepEqual(calls[0].body, { phone, scene: 'login' });
  assert.deepEqual(calls[1].body, { phone, code: '731846' });
  assert.deepEqual(calls[2].body, registration);
  assert.ok(
    calls.every(
      ({ credentials, headers }) =>
        credentials === 'same-origin' && headers['X-Tyde-Client'] === 'web',
    ),
  );
});

test('Web adapter propagates Retry-After, 503 and network errors without local SMS success', async (t) => {
  let mode = 'rate';
  const { api } = await adapter(t, () => {
    if (mode === 'rate') return result(null, 429, { 'Retry-After': '60' });
    if (mode === 'unavailable') return result(null, 503);
    throw new Error('fixture offline');
  });
  await assert.rejects(
    api.sendCode({ phone, scene: 'login' }),
    (error) => error.status === 429 && error.retryAfter === 60 && error.code === 4292,
  );
  mode = 'unavailable';
  await assert.rejects(api.sendCode({ phone, scene: 'login' }), (error) => error.status === 503);
  mode = 'network';
  await assert.rejects(
    api.sendCode({ phone, scene: 'login' }),
    (error) => error.status === 0 && error.code === 'NETWORK_ERROR',
  );
});

test('Web adapter rejects legacy or malformed successful responses and never refreshes an anonymous session', async (t) => {
  let response = result({ challengeId: 'legacy', mode: 'mock' });
  const { api, calls } = await adapter(t, () => response.clone());
  await assert.rejects(api.sendCode({ phone, scene: 'login' }), (error) => error.status === 502);
  response = result(null, 401);
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 0);
  response = result({ ...firstTokens, accessToken: 'invalid' });
  await assert.rejects(
    api.login({ account: phone, password: 'Password123!' }),
    (error) => error.status === 502,
  );
});

test('Web adapter shares one refresh across concurrent 401s and rotates the refresh token', async (t) => {
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  let authenticated = false;
  let refreshes = 0;
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/login')) return result(firstTokens);
    if (path.endsWith('/refresh')) {
      refreshes++;
      refreshStarted.resolve();
      await releaseRefresh.promise;
      authenticated = true;
      return result(nextTokens);
    }
    if (path.endsWith('/users/me')) return authenticated ? result(user) : result(null, 401);
    throw new Error('unexpected request');
  });
  await api.login({ account: phone, password: 'Password123!' });
  const pending = Promise.all([api.getCurrentUser(), api.getCurrentUser()]);
  await refreshStarted.promise;
  releaseRefresh.resolve();
  assert.deepEqual(await pending, [user, user]);
  assert.equal(refreshes, 1);
  assert.deepEqual(calls.find(({ path }) => path.endsWith('/refresh')).body, {
    refreshToken: firstTokens.refreshToken,
  });
  authenticated = false;
  await api.getCurrentUser();
  assert.equal(refreshes, 2);
  assert.deepEqual(calls.filter(({ path }) => path.endsWith('/refresh')).at(-1).body, {
    refreshToken: nextTokens.refreshToken,
  });
});

test('Web adapter clears rejected refresh tokens and retries an unauthorized protected request at most once', async (t) => {
  let refreshStatus = 401;
  const { api, calls } = await adapter(t, ({ path }) => {
    if (path.endsWith('/login')) return result(firstTokens);
    if (path.endsWith('/refresh'))
      return result(refreshStatus === 200 ? nextTokens : null, refreshStatus);
    return result(null, 401);
  });
  await api.login({ account: phone, password: 'Password123!' });
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 1);
  refreshStatus = 200;
  await api.login({ account: phone, password: 'Password123!' });
  const before = calls.filter(({ path }) => path.endsWith('/users/me')).length;
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  assert.equal(calls.filter(({ path }) => path.endsWith('/users/me')).length - before, 2);
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 2);
});

test('Web adapter surfaces refresh service outages and orders logout after an in-flight refresh', async (t) => {
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  let mode = 'unavailable';
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/login')) return result(firstTokens);
    if (path.endsWith('/refresh')) {
      if (mode === 'unavailable') return result(null, 503);
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return result(nextTokens);
    }
    if (path.endsWith('/logout')) return result(null);
    return result(null, 401);
  });
  await api.login({ account: phone, password: 'Password123!' });
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 503);
  mode = 'pending';
  const pending = assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  await refreshStarted.promise;
  const logout = api.logout();
  await Promise.resolve();
  assert.equal(calls.filter(({ path }) => path.endsWith('/logout')).length, 0);
  releaseRefresh.resolve();
  await Promise.all([pending, logout]);
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  assert.deepEqual(
    calls.slice(-2).map(({ path }) => path),
    ['/api/v1/auth/logout', '/api/v1/users/me'],
  );
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 2);
});

test('Web adapter reuses a completed rotation when an earlier unauthorized request arrives late', async (t) => {
  const lateRequestStarted = deferred();
  const releaseLateResponse = deferred();
  let currentRequests = 0;
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/login')) return result(firstTokens);
    if (path.endsWith('/refresh')) return result(nextTokens);
    currentRequests++;
    if (currentRequests === 1) return result(null, 401);
    if (currentRequests === 2) {
      lateRequestStarted.resolve();
      await releaseLateResponse.promise;
      return result(null, 401);
    }
    return result(user);
  });
  await api.login({ account: phone, password: 'Password123!' });
  const first = api.getCurrentUser();
  const late = api.getCurrentUser();
  await lateRequestStarted.promise;
  assert.deepEqual(await first, user);
  releaseLateResponse.resolve();
  assert.deepEqual(await late, user);
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 1);
});

test('Web adapter rejects a successful user response that arrives after logout', async (t) => {
  const userRequestStarted = deferred();
  const releaseUser = deferred();
  const { api } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/login')) return result(firstTokens);
    if (path.endsWith('/logout')) return result(null);
    userRequestStarted.resolve();
    await releaseUser.promise;
    return result(user);
  });
  await api.login({ account: phone, password: 'Password123!' });
  const pending = assert.rejects(
    api.getCurrentUser(),
    (error) => error.status === 401 && error.code === 'SESSION_CHANGED',
  );
  await userRequestStarted.promise;
  await api.logout();
  releaseUser.resolve();
  await pending;
});
