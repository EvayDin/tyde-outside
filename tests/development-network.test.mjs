import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentNetwork } from '../apps/electron/src/main/development-network.ts';

const origin = 'http://127.0.0.1:5174';
const payload = { phone: '13812345678', scene: 'login' };
const path = '/api/v1/auth/sms/send';

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

function fixture({ method = 'POST', input = payload, allowed = () => true, operation } = {}) {
  const network = new DevelopmentNetwork();
  let calls = 0;
  const ticket = network.issue({ path, method }, input, origin, allowed, async () => {
    calls++;
    return operation ? operation() : { ok: true, data: '验证码已发送' };
  });
  const url = `tyde-debug://desktop${path}?request=${ticket.networkRequestId}`;
  return {
    network,
    ticket,
    url,
    calls: () => calls,
    request({ url: requestUrl = url, ...init } = {}) {
      return new Request(requestUrl, {
        method,
        headers: { Origin: origin },
        ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
        ...init,
      });
    },
  };
}

test('issuing tickets does not call the backend; claims are private, random and single-use', async () => {
  const f = fixture();
  const second = fixture();
  assert.match(f.ticket.networkRequestId, /^[a-f0-9]{64}$/);
  assert.notEqual(f.ticket.networkRequestId, second.ticket.networkRequestId);
  assert.deepEqual(Object.keys(f.ticket), ['networkRequestId']);
  assert.equal(f.calls(), 0);
  const result = await f.network.respond(f.request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, data: '验证码已发送' });
  assert.equal(result.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(result.headers.get('Vary'), 'Origin');
  assert.equal(f.calls(), 1);
  assert.equal((await f.network.respond(f.request())).status, 404);
  assert.equal(f.calls(), 1);
});

test('path, method, body and exact origin must match the validated IPC invocation', async () => {
  const f = fixture();
  for (const change of [
    { url: f.url.replace(path, '/api/v1/auth/login') },
    { method: 'PUT' },
    { body: JSON.stringify({ ...payload, phone: '13800000000' }) },
    { body: '' },
    { body: `${JSON.stringify(payload)} ` },
    { headers: { Origin: 'http://127.0.0.1:5175' } },
    { headers: { Origin: 'null' } },
    { headers: {} },
  ]) {
    const result = await f.network.respond(f.request(change));
    assert.equal(result.status, 403);
    const body = await result.text();
    assert.doesNotMatch(body, /13812345678|13800000000/);
  }
  assert.equal(f.calls(), 0);
  assert.equal((await f.network.respond(f.request())).status, 200);
  assert.equal(f.calls(), 1);
});

test('Electron GET and POST requests without Origin require a matching page referrer', async () => {
  for (const method of ['GET', 'POST']) {
    const f = fixture({ method });
    const request = f.request({ headers: {}, referrer: `${origin}/#/auth` });
    assert.equal(request.headers.get('Origin'), null);
    assert.equal((await f.network.respond(request)).status, 200);
    assert.equal(f.calls(), 1);
    assert.equal((await f.network.respond(request)).status, 404);
  }
});

test('referrer fallback never overrides an explicit Origin or accepts an absent or foreign page', async () => {
  const f = fixture();
  for (const supplied of ['', 'null', 'http://127.0.0.1:5175'])
    assert.equal(
      (
        await f.network.respond(
          f.request({ headers: { Origin: supplied }, referrer: `${origin}/` }),
        )
      ).status,
      403,
    );
  for (const referrer of ['', 'about:client', 'http://127.0.0.1:5175/', 'invalid url']) {
    const request = f.request({ headers: {} });
    Object.defineProperty(request, 'referrer', { value: referrer });
    assert.equal((await f.network.respond(request)).status, 403);
  }
  assert.equal(f.calls(), 0);
  assert.equal(
    (await f.network.respond(f.request({ headers: {}, referrer: `${origin}/` }))).status,
    200,
  );
  assert.equal(f.calls(), 1);
});

test('only the fixed scheme, host and one unencoded request id are accepted', async () => {
  const f = fixture();
  for (const url of [
    f.url.replace('tyde-debug:', 'https:'),
    f.url.replace('desktop', 'other'),
    f.url.replace('desktop', 'desktop:1234'),
    `${f.url}#fragment`,
    `${f.url}&extra=1`,
    `${f.url}&request=${f.ticket.networkRequestId}`,
    f.url.replace('?request=', '?%72equest='),
    f.url.replace('request=', 'ticket='),
    f.url.replace(f.ticket.networkRequestId, 'invalid'),
  ])
    assert.equal((await f.network.respond(f.request({ url }))).status, 400);
  for (const url of ['tyde-debug://name:secret@desktop/api/v1/auth/sms/send', 'invalid url']) {
    const request = f.request();
    Object.defineProperty(request, 'url', { value: url });
    assert.equal((await f.network.respond(request)).status, 400);
  }
  assert.equal(
    (
      await f.network.respond(
        f.request({ url: f.url.replace(f.ticket.networkRequestId, '0'.repeat(64)) }),
      )
    ).status,
    404,
  );
  assert.equal(f.calls(), 0);
});

test('GET requests require an empty body and allow only the issued method', async () => {
  const f = fixture({ method: 'GET', input: undefined });
  assert.equal((await f.network.respond(f.request({ method: 'POST', body: '' }))).status, 403);
  const nonempty = f.request();
  Object.defineProperty(nonempty, 'text', { value: async () => '{}' });
  assert.equal((await f.network.respond(nonempty)).status, 403);
  assert.equal(f.calls(), 0);
  assert.equal((await f.network.respond(f.request())).status, 200);
  assert.equal(f.calls(), 1);
});

test('concurrent claims execute a ticket operation only once', async () => {
  const done = deferred();
  const f = fixture({ operation: () => done.promise });
  const first = f.network.respond(f.request());
  const second = f.network.respond(f.request());
  done.resolve({ ok: true, data: 'done' });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 403]);
  assert.equal(f.calls(), 1);
});

test('expiry and a lost or throwing source guard invalidate tickets without backend calls', async (t) => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const expired = fixture();
  now += 30_000;
  assert.equal((await expired.network.respond(expired.request())).status, 403);
  assert.equal(expired.calls(), 0);
  assert.equal((await expired.network.respond(expired.request())).status, 404);
  for (const guard of [
    () => false,
    () => {
      throw new Error('private fixture error');
    },
  ]) {
    let allowed = guard;
    const f = fixture({ allowed: () => allowed() });
    assert.equal((await f.network.respond(f.request())).status, 403);
    allowed = () => true;
    assert.equal((await f.network.respond(f.request())).status, 404);
    assert.equal(f.calls(), 0);
  }
});

test('source and expiry are checked again after reading an asynchronous body', async (t) => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  for (const invalidate of ['source', 'expiry']) {
    let allowed = true;
    const body = deferred();
    const f = fixture({ allowed: () => allowed });
    const request = f.request();
    Object.defineProperty(request, 'text', { value: () => body.promise });
    const pending = f.network.respond(request);
    if (invalidate === 'source') allowed = false;
    else now += 30_000;
    body.resolve(JSON.stringify(payload));
    assert.equal((await pending).status, 403);
    assert.equal(f.calls(), 0);
  }
});

test('pending tickets are capped and expired tickets release capacity', async (t) => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const network = new DevelopmentNetwork();
  const issue = () =>
    network.issue(
      { path, method: 'POST' },
      payload,
      origin,
      () => true,
      async () => {
        assert.fail('unclaimed ticket must not execute');
      },
    );
  for (let i = 0; i < 128; i++) issue();
  assert.throws(issue, { code: 'DEVELOPMENT_NETWORK_BUSY', status: 429 });
  now += 30_000;
  assert.match(issue().networkRequestId, /^[a-f0-9]{64}$/);
});

test('backend bridge failures are preserved; transport status zero maps to HTTP 502', async () => {
  for (const status of [0, 401, 429, 503]) {
    const result = {
      ok: false,
      status,
      error: { code: 'FIXTURE_FAILURE', message: 'fixture failure' },
      retryAfter: 30,
    };
    const f = fixture({ operation: async () => result });
    const response = await f.network.respond(f.request());
    assert.equal(response.status, status || 502);
    assert.deepEqual(await response.json(), result);
  }
  const f = fixture({
    operation: async () => {
      throw new Error('private fixture error');
    },
  });
  const response = await f.network.respond(f.request());
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /private fixture error/);
  assert.equal((await f.network.respond(f.request())).status, 404);
  assert.equal(f.calls(), 1);
});
