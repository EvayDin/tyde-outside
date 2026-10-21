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
      ({ method, credentials, headers }) =>
        credentials === 'same-origin' &&
        headers['X-Tyde-Client'] === (method === 'GET' ? undefined : 'web'),
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

test('Cookie mutations preserve late login, logout and subsequent failed login order', async (t) => {
  const started = deferred();
  const release = deferred();
  let cookie;
  let logins = 0;
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/login')) {
      if (++logins === 1) {
        started.resolve();
        await release.promise;
        // Model the browser applying Set-Cookie before JS receives the response.
        cookie = firstTokens.accessToken;
        return result(firstTokens);
      }
      return result(null, 401);
    }
    if (path.endsWith('/logout')) {
      cookie = undefined;
      return result(null);
    }
    return result(cookie ? user : null, cookie ? 200 : 401);
  });
  const first = assert.rejects(
    api.login({ account: phone, password: 'first' }),
    (error) => error.code === 'SESSION_CHANGED',
  );
  await started.promise;
  const logout = api.logout();
  const next = assert.rejects(
    api.login({ account: phone, password: 'wrong' }),
    (error) => error.status === 401,
  );
  await Promise.resolve();
  assert.equal(calls.length, 1);
  release.resolve();
  await Promise.all([first, logout, next]);
  assert.deepEqual(
    calls.map(({ path }) => path),
    ['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/logout', '/api/v1/auth/login'],
  );
  assert.equal(cookie, undefined);
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
});

test('An older successful login cannot overwrite a newer Cookie session', async (t) => {
  const started = deferred();
  const release = deferred();
  let cookie;
  let logins = 0;
  const { api } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/logout')) {
      cookie = undefined;
      return result(null);
    }
    if (++logins === 1) {
      started.resolve();
      await release.promise;
      cookie = firstTokens.accessToken;
      return result(firstTokens);
    }
    cookie = nextTokens.accessToken;
    return result(nextTokens);
  });
  const first = assert.rejects(
    api.login({ account: phone, password: 'old' }),
    (error) => error.code === 'SESSION_CHANGED',
  );
  await started.promise;
  const next = api.login({ account: phone, password: 'new' });
  release.resolve();
  await Promise.all([first, next]);
  assert.equal(cookie, nextTokens.accessToken);
});

test('Desktop sends business HTTP through renderer fetch and reads only public configuration from IPC', async (t) => {
  const originalWindow = globalThis.window;
  let configurationReads = 0;
  globalThis.window = {
    tydeDesktop: {
      getRuntimeConfig: async () => {
        configurationReads++;
        return { ok: true, data: { apiBaseUrl: 'https://api.example.test' } };
      },
    },
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  const { calls } = await adapter(t, ({ path }) => {
    if (path.endsWith('/sms/send')) return result('后端发码结果');
    if (path.endsWith('/login')) return result(firstTokens);
    if (path.endsWith('/logout')) return result(null);
    if (path.includes('/organizations?')) return result(organization);
    return result(user);
  });
  const { platform } = await import(`../packages/platform/src/index.ts?case=${++sequence}`);
  assert.equal(platform.isElectron, true);
  assert.deepEqual(platform.capabilities, {});
  assert.equal(await platform.auth.sendCode({ phone, scene: 'login' }), '后端发码结果');
  assert.equal(await platform.auth.login({ account: phone, password: 'Password123!' }), undefined);
  assert.deepEqual(await platform.auth.getCurrentUser(), user);
  assert.deepEqual(await platform.auth.updateProfile({ bio: '真实资料' }), user);
  assert.deepEqual(await platform.auth.getOrganization(organization.id), organization);
  await platform.auth.changePassword('Changed123!', 'Changed123!');
  await platform.auth.logout();
  assert.equal(configurationReads, 1);
  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      'https://api.example.test/api/v1/auth/sms/send',
      'https://api.example.test/api/v1/auth/login',
      'https://api.example.test/api/v1/users/me',
      'https://api.example.test/api/v1/users/me/update',
      'https://api.example.test/api/v1/organizations?orgId=' + organization.id,
      'https://api.example.test/api/v1/users/me/update',
      'https://api.example.test/api/v1/auth/logout',
    ],
  );
  assert.ok(
    calls.every(
      ({ method, credentials, headers }) =>
        credentials === 'include' &&
        headers['X-Tyde-Client'] === (method === 'GET' ? undefined : 'web') &&
        headers.Authorization === undefined &&
        headers.Cookie === undefined,
    ),
  );
});

test('Desktop configuration denial is preserved and prevents business fetch', async (t) => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    tydeDesktop: {
      getRuntimeConfig: async () => ({
        ok: false,
        status: 403,
        error: { code: 'IPC_FORBIDDEN', message: '请求来源不可信' },
      }),
    },
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  const { calls } = await adapter(t, () => {
    throw new Error('unexpected business request');
  });
  const { platform } = await import(`../packages/platform/src/index.ts?case=${++sequence}`);
  await assert.rejects(
    platform.auth.getCurrentUser(),
    (error) => error.status === 403 && error.code === 'IPC_FORBIDDEN',
  );
  assert.equal(calls.length, 0);
});

test('Desktop retries a failed runtime lookup and caches the successful configuration', async (t) => {
  const originalWindow = globalThis.window;
  let configurationReads = 0;
  globalThis.window = {
    tydeDesktop: {
      getRuntimeConfig: async () => {
        if (++configurationReads === 1) throw new Error('temporary IPC failure');
        return { ok: true, data: { apiBaseUrl: 'https://api.example.test' } };
      },
    },
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  const { calls } = await adapter(t, () => result(user));
  const { platform } = await import(`../packages/platform/src/index.ts?case=${++sequence}`);
  await assert.rejects(platform.auth.getCurrentUser(), (error) => error.code === 'NETWORK_ERROR');
  assert.equal(calls.length, 0);
  assert.deepEqual(await platform.auth.getCurrentUser(), user);
  assert.deepEqual(await platform.auth.getCurrentUser(), user);
  assert.equal(configurationReads, 2);
  assert.equal(calls.length, 2);
});

test('A superseded successful login is revoked before a newer failed login', async (t) => {
  const started = deferred();
  const release = deferred();
  let cookie;
  let logins = 0;
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/login')) {
      if (++logins === 1) {
        started.resolve();
        await release.promise;
        cookie = firstTokens.accessToken;
        return result(firstTokens);
      }
      return result(null, 401);
    }
    if (path.endsWith('/logout')) {
      cookie = undefined;
      return result(null);
    }
    return result(cookie ? user : null, cookie ? 200 : 401);
  });
  const first = assert.rejects(
    api.login({ account: phone, password: 'old' }),
    (error) => error.code === 'SESSION_CHANGED',
  );
  await started.promise;
  const next = assert.rejects(
    api.login({ account: phone, password: 'wrong' }),
    (error) => error.status === 401,
  );
  release.resolve();
  await Promise.all([first, next]);
  assert.equal(cookie, undefined);
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  assert.deepEqual(
    calls.map(({ path }) => path),
    ['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/login', '/api/v1/users/me'],
  );
});

test('A failed superseded-login cleanup surfaces its error without retrying the write', async (t) => {
  const started = deferred();
  const release = deferred();
  let logins = 0;
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/logout')) return result(null, 503);
    if (++logins === 1) {
      started.resolve();
      await release.promise;
      return result(firstTokens);
    }
    return result(null, 401);
  });
  const first = assert.rejects(
    api.login({ account: phone, password: 'old' }),
    (error) =>
      error.code === 'SESSION_CLEANUP_FAILED' &&
      error.status === 503 &&
      error.message.includes('旧会话清理失败'),
  );
  await started.promise;
  const next = assert.rejects(
    api.login({ account: phone, password: 'wrong' }),
    (error) => error.status === 401,
  );
  release.resolve();
  await Promise.all([first, next]);
  assert.equal(calls.filter(({ path }) => path.endsWith('/logout')).length, 1);
});

test('A superseded registration grant does not trigger session cleanup', async (t) => {
  const started = deferred();
  const release = deferred();
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/sms/login')) {
      started.resolve();
      await release.promise;
      return result({
        status: 'registration_required',
        registrationToken: 'g'.repeat(43),
        expiresAt: '2099-01-01T00:00:00Z',
      });
    }
    return result(null, 401);
  });
  const first = assert.rejects(
    api.verifyCode({ phone, code: '731846' }),
    (error) => error.code === 'SESSION_CHANGED',
  );
  await started.promise;
  const next = assert.rejects(
    api.login({ account: phone, password: 'wrong' }),
    (error) => error.status === 401,
  );
  release.resolve();
  await Promise.all([first, next]);
  assert.deepEqual(
    calls.map(({ path }) => path),
    ['/api/v1/auth/sms/login', '/api/v1/auth/login'],
  );
});

const organization = {
  id: '00000000-0000-4000-8000-000000000002',
  name: '测试组织',
  unifiedCreditCode: null,
  description: '组织简介',
  businessLicenseUrl: null,
  logoUrl: null,
  expertiseTags: ['图像标注'],
  verifyStatus: 'PENDING',
  status: 'ACTIVE',
  position: 'OWNER',
  createdAt: '2026-10-19T00:00:00.000Z',
};

test('Profile updates and organization reads use the existing routes and response values', async (t) => {
  const input = { bio: '', idCardNo: '11010119900101001X', avatarUrl: 'https://example.com/a.png' };
  const updated = { ...user, ...input };
  const { api, calls } = await adapter(t, ({ path }) =>
    result(path.startsWith('/api/v1/organizations?') ? organization : updated),
  );
  assert.deepEqual(await api.updateProfile(input), updated);
  assert.deepEqual(await api.getOrganization(organization.id), organization);
  assert.deepEqual(calls, [
    {
      path: '/api/v1/users/me/update',
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Tyde-Client': 'web', 'Content-Type': 'application/json' },
      body: input,
    },
    {
      path: '/api/v1/organizations?orgId=' + organization.id,
      method: 'GET',
      credentials: 'same-origin',
      headers: {},
      body: undefined,
    },
  ]);
});

test('Profile writes and organization queries share a single bounded authentication refresh', async (t) => {
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  let refreshed = false;
  const input = { bio: '服务端保存的简介' };
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/auth/login')) return result(firstTokens);
    if (path.endsWith('/refresh')) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
      refreshed = true;
      return result(nextTokens);
    }
    if (!refreshed) return result(null, 401);
    return result(path.startsWith('/api/v1/organizations?') ? organization : { ...user, ...input });
  });
  await api.login({ account: phone, password: 'Password123!' });
  const pending = Promise.all([api.updateProfile(input), api.getOrganization(organization.id)]);
  await refreshStarted.promise;
  releaseRefresh.resolve();
  assert.deepEqual(await pending, [{ ...user, ...input }, organization]);
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 1);
  const updates = calls.filter(({ path }) => path.endsWith('/users/me/update'));
  assert.equal(updates.length, 2);
  assert.ok(updates.every(({ body }) => JSON.stringify(body) === JSON.stringify(input)));
  assert.ok(
    calls
      .filter(({ method }) => method === 'GET')
      .every(({ headers }) => !Object.keys(headers).length),
  );
});

test('Profile failures and malformed organization data never become local success or replay writes', async (t) => {
  let mode = 'service';
  const { api, calls } = await adapter(t, () => {
    if (mode === 'network') throw new Error('fixture offline');
    if (mode === 'service') return result(null, 503);
    return result(mode === 'profile' ? {} : { ...organization, position: 'unknown' });
  });
  await assert.rejects(api.updateProfile({ bio: '草稿' }), (error) => error.status === 503);
  assert.equal(calls.length, 1);
  mode = 'network';
  await assert.rejects(
    api.updateProfile({ bio: '草稿' }),
    (error) => error.code === 'NETWORK_ERROR',
  );
  assert.equal(calls.length, 2);
  mode = 'profile';
  await assert.rejects(
    api.updateProfile({ bio: '草稿' }),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  mode = 'organization';
  await assert.rejects(
    api.getOrganization(organization.id),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 0);
});

test('Password changes send only the existing password fields and clear refresh credentials on success', async (t) => {
  const { api, calls } = await adapter(t, ({ path }) => {
    if (path.endsWith('/auth/login')) return result(firstTokens);
    if (path.endsWith('/users/me/update')) return result(user);
    return result(null, 401);
  });
  await api.login({ account: phone, password: 'Password123!' });
  assert.equal(await api.changePassword('Changed123!', 'Changed123!'), undefined);
  assert.deepEqual(calls.find(({ path }) => path.endsWith('/users/me/update')).body, {
    newPassword: 'Changed123!',
    confirmNewPassword: 'Changed123!',
  });
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 0);
});

test('A rejected password change preserves the current session refresh capability', async (t) => {
  let refreshed = false;
  const { api, calls } = await adapter(t, ({ path }) => {
    if (path.endsWith('/auth/login')) return result(firstTokens);
    if (path.endsWith('/users/me/update')) return result(null, 400);
    if (path.endsWith('/refresh')) {
      refreshed = true;
      return result(nextTokens);
    }
    return refreshed ? result(user) : result(null, 401);
  });
  await api.login({ account: phone, password: 'Password123!' });
  await assert.rejects(
    api.changePassword('Changed123!', 'different'),
    (error) => error.status === 400,
  );
  assert.deepEqual(await api.getCurrentUser(), user);
  assert.equal(calls.filter(({ path }) => path.endsWith('/users/me/update')).length, 1);
  assert.deepEqual(calls.find(({ path }) => path.endsWith('/refresh')).body, {
    refreshToken: firstTokens.refreshToken,
  });
});

test('A refresh started during password change cannot restore credentials or an older user response', async (t) => {
  const changeStarted = deferred();
  const releaseChange = deferred();
  const refreshStarted = deferred();
  const releaseRefresh = deferred();
  const { api, calls } = await adapter(t, async ({ path }) => {
    if (path.endsWith('/auth/login')) return result(firstTokens);
    if (path.endsWith('/users/me/update')) {
      changeStarted.resolve();
      await releaseChange.promise;
      return result(user);
    }
    if (path.endsWith('/refresh')) {
      refreshStarted.resolve();
      await releaseRefresh.promise;
      return result(nextTokens);
    }
    return result(null, 401);
  });
  await api.login({ account: phone, password: 'Password123!' });
  const password = api.changePassword('Changed123!', 'Changed123!');
  await changeStarted.promise;
  const oldUser = assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  await refreshStarted.promise;
  releaseChange.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  releaseRefresh.resolve();
  await Promise.all([password, oldUser]);
  await assert.rejects(api.getCurrentUser(), (error) => error.status === 401);
  assert.equal(calls.filter(({ path }) => path.endsWith('/refresh')).length, 1);
});
