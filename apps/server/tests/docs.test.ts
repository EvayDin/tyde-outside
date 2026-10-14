import { PrismaClient } from '@prisma/client';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/application.js';
import { readConfig } from '../src/config/index.js';
import { AuthService } from '../src/modules/auth/auth.service.js';

afterEach(() => vi.restoreAllMocks());

test('Swagger UI and OpenAPI include every business route and authentication contracts', async () => {
  const config = readConfig({
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/unused_test',
    CODE_HMAC_SECRET: 'x'.repeat(32),
    SMS_PROVIDER: 'mock',
    WEB_ORIGINS: 'http://127.0.0.1:3000',
    LOG_LEVEL: 'silent',
  });
  const db = new PrismaClient();
  vi.spyOn(db, '$queryRaw').mockRejectedValue(new Error('offline'));
  const app = await createApp(config, db);
  try {
    const ui = await app.inject('/api/v1/docs/');
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ui.headers['content-security-policy']).toBeDefined();
    expect((await app.inject('/api/v1/docs/static/swagger-ui-bundle.js')).statusCode).toBe(200);
    const spec = (await app.inject('/api/v1/docs/json')).json();
    expect(spec.openapi).toBe('3.0.3');
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/v1/auth/code',
      '/api/v1/auth/logout',
      '/api/v1/auth/me',
      '/api/v1/auth/register',
      '/api/v1/auth/verify',
      '/api/v1/health/live',
      '/api/v1/health/ready',
    ]);
    expect(spec.paths['/api/v1/auth/me'].get.security).toEqual([
      { webSession: [] },
      { desktopSession: [] },
    ]);
    expect(spec.components.securitySchemes.webSession.name).toBe('tyde_session');
    expect(spec.paths['/api/v1/auth/register'].post.responses['201']).toBeDefined();
    expect(spec.paths['/api/v1/auth/verify'].post.responses['410']).toBeDefined();
    expect((await app.inject('/api/v1/docs/yaml')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/health/live')).json()).toEqual({
      status: 'ok',
      application: 'tyde-outside',
    });
    const ready = await app.inject('/api/v1/health/ready');
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'unavailable' });

    const authenticated = {
      status: 'authenticated' as const,
      sessionToken: 'test-session-token',
      sessionExpiresAt: '2026-11-01T00:00:00.000Z',
      user: {
        id: 'user-1',
        phoneE164: '+8613800138000',
        phoneRegion: 'CN',
        username: 'tester',
        displayName: '测试',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    };
    vi.spyOn(AuthService.prototype, 'verify').mockResolvedValue(authenticated);
    const payload = {
      region: 'CN',
      phone: '13800138000',
      challengeId: '00000000-0000-4000-8000-000000000001',
      code: '095270',
    };
    const web = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      headers: { origin: config.webOrigins[0] },
      payload,
    });
    expect(web.statusCode).toBe(200);
    expect(web.json().sessionToken).toBeUndefined();
    expect(web.headers['set-cookie']).toContain('tyde_session=test-session-token');
    const desktop = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      headers: { 'x-tyde-client': 'desktop' },
      payload,
    });
    expect(desktop.json()).toEqual(authenticated);
    const registration = {
      status: 'registration_required' as const,
      registrationToken: 'grant',
      expiresAt: '2026-10-15T00:00:00.000Z',
    };
    vi.spyOn(AuthService.prototype, 'verify').mockResolvedValue(registration);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/verify',
          headers: { origin: config.webOrigins[0] },
          payload,
        })
      ).json(),
    ).toEqual(registration);
    vi.spyOn(AuthService.prototype, 'logout').mockResolvedValue(undefined);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: config.webOrigins[0] },
    });
    expect(logout.statusCode).toBe(204);
    expect(logout.body).toBe('');
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/code',
      headers: { origin: config.webOrigins[0] },
      payload: {},
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      requestId: expect.any(String),
    });
  } finally {
    await app.close();
  }
});
