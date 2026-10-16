import { PrismaClient } from '@prisma/client';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/application.js';
import { readConfig } from '../src/config/index.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
afterEach(() => vi.restoreAllMocks());
test('OpenAPI preserves legacy auth names, request fields, Result and token response', async () => {
  const config = readConfig({
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/unused_test',
    CODE_HMAC_SECRET: 'x'.repeat(32),
    SMS_PROVIDER: 'mock',
    WEB_ORIGINS: 'http://127.0.0.1:3000',
    LOG_LEVEL: 'silent',
  });
  const app = await createApp(config, new PrismaClient());
  try {
    expect((await app.inject('/api/v1/docs/')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/docs/yaml')).statusCode).toBe(200);
    const spec = (await app.inject('/api/v1/docs/json')).json();
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/logout',
      '/api/v1/auth/password/reset',
      '/api/v1/auth/refresh',
      '/api/v1/auth/register',
      '/api/v1/auth/sms/login',
      '/api/v1/auth/sms/send',
      '/api/v1/health/live',
      '/api/v1/health/ready',
      '/api/v1/users/me',
    ]);
    const registration =
      spec.paths['/api/v1/auth/register'].post.requestBody.content['application/json'].schema;
    expect(Object.keys(registration.properties).sort()).toEqual(
      [
        'accountType',
        'roles',
        'password',
        'confirmPassword',
        'nickname',
        'realName',
        'idCardNo',
        'orgPosition',
        'phone',
        'code',
        'email',
        'organization',
      ].sort(),
    );
    expect(registration.required).not.toContain('roles');
    expect(
      spec.paths['/api/v1/auth/login'].post.requestBody.content['application/json'].schema.required,
    ).toEqual(['account', 'password']);
    const tokens = {
      accessToken: 'a'.repeat(43),
      refreshToken: 'b'.repeat(43),
      tokenType: 'Bearer' as const,
      expiresIn: 2592000,
    };
    vi.spyOn(AuthService.prototype, 'login').mockResolvedValue(tokens);
    const login = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers,
        payload: { account: '13812345678', password: 'Password123' },
      });
    const web = await login({ origin: config.webOrigins[0]! });
    expect(web.json()).toEqual({ code: 200, message: '操作成功', data: tokens });
    expect(web.cookies[0]?.httpOnly).toBe(true);
    const api = await login({});
    expect(api.json().data).toEqual(tokens);
    expect(api.cookies).toHaveLength(0);
    expect((await login({ origin: 'https://evil.test' })).json()).toMatchObject({
      code: 403,
      data: null,
    });
    vi.spyOn(AuthService.prototype, 'logout').mockResolvedValue(undefined);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: { origin: config.webOrigins[0]! },
        })
      ).json(),
    ).toEqual({ code: 200, message: '操作成功', data: null });
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: {} });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 400, data: null });
  } finally {
    await app.close();
  }
});
