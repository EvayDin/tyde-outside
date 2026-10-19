import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeDigest,
  digest,
  matchesDigest,
  MOCK_CODE,
  newToken,
  normalizeProfile,
  validateTransport,
} from '../apps/server/src/modules/auth/security.ts';
import { readConfig } from '../apps/server/src/config/index.ts';
test('mock code retains leading zero and cannot authenticate a different challenge/phone', () => {
  assert.equal(MOCK_CODE, '095270');
  const hash = codeDigest('a'.repeat(32), 'one', '+8613812345678', MOCK_CODE);
  assert.ok(matchesDigest(hash, codeDigest('a'.repeat(32), 'one', '+8613812345678', MOCK_CODE)));
  assert.ok(!matchesDigest(hash, codeDigest('a'.repeat(32), 'two', '+8613812345678', MOCK_CODE)));
  assert.ok(!matchesDigest(hash, codeDigest('a'.repeat(32), 'one', '+8613912345678', MOCK_CODE)));
  assert.ok(!matchesDigest(hash, codeDigest('b'.repeat(32), 'one', '+8613812345678', MOCK_CODE)));
});
test('session tokens are random 256-bit values; digests are non-reversible identifiers', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => newToken()));
  assert.equal(tokens.size, 100);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(digest(token).length, 64);
  }
});
test('profile normalizes username, accepts multilingual names, rejects dangerous/invalid input', () => {
  assert.deepEqual(normalizeProfile(' Alex_Ding ', ' 王小明 '), {
    username: 'alex_ding',
    displayName: '王小明',
  });
  assert.equal(normalizeProfile('eve', 'مرحبا 世界').displayName, 'مرحبا 世界');
  assert.throws(() => normalizeProfile('12bob', 'Bob'));
  assert.throws(() => normalizeProfile('中文名', 'Bob'));
  assert.throws(() => normalizeProfile('alex', '  '));
  assert.throws(() => normalizeProfile('alex', 'a\u0000b'));
  assert.throws(() => normalizeProfile('alex', '😀'.repeat(81)));
  assert.equal([...normalizeProfile('alex', '😀'.repeat(80)).displayName].length, 80);
});
test('browser cannot claim desktop transport to extract tokens', () => {
  const origins = ['http://127.0.0.1:3001'];
  assert.equal(
    validateTransport({ origin: origins[0], 'x-tyde-client': 'web' }, 'POST', origins),
    'web',
  );
  assert.throws(() => validateTransport({}, 'POST', origins));
  assert.throws(() => validateTransport({ origin: 'https://evil.test' }, 'POST', origins));
  assert.throws(() =>
    validateTransport({ origin: origins[0], 'x-tyde-client': 'desktop' }, 'POST', origins),
  );
  assert.throws(() =>
    validateTransport(
      { 'sec-fetch-site': 'same-origin', 'x-tyde-client': 'desktop' },
      'POST',
      origins,
    ),
  );
  assert.throws(() =>
    validateTransport({ cookie: 'a=b', 'x-tyde-client': 'desktop' }, 'GET', origins),
  );
  assert.throws(() =>
    validateTransport({ cookie: 'a=b', authorization: 'Bearer x' }, 'GET', origins),
  );
  assert.equal(validateTransport({ 'x-tyde-client': 'desktop' }, 'POST', origins), 'desktop');
});
test('config blocks mock production and unsafe remote cookies', () => {
  const config = {
    APP_ENV: 'development',
    DATABASE_URL: 'postgresql://test:pwd@127.0.0.1/tyde',
    CODE_HMAC_SECRET: 'a'.repeat(32),
    SMS_PROVIDER: 'mock',
    WEB_ORIGINS: 'http://127.0.0.1:3001',
    COOKIE_SECURE: 'false',
  };
  assert.equal(readConfig(config).port, 3000);
  assert.throws(() => readConfig({ ...config, APP_ENV: 'production' }));
  assert.throws(() => readConfig({ ...config, WEB_ORIGINS: 'http://test.example.com' }));
  assert.throws(() => readConfig({ ...config, TRUST_PROXY: 'true' }));
  assert.throws(() => readConfig({ ...config, CODE_HMAC_SECRET: 'short' }));
  assert.equal(
    readConfig({
      ...config,
      APP_ENV: 'test',
      COOKIE_SECURE: 'true',
      WEB_ORIGINS: 'https://test.example.com',
    }).cookieSecure,
    true,
  );
});
