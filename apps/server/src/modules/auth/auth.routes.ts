import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  API_PREFIX,
  phoneSchema,
  registerSchema,
  verifySchema,
  type PhoneInput,
  type RegisterInput,
  type VerifyInput,
} from '@tyde-outside/shared';
import type { Config } from '../../config/index.js';
import { AuthError } from './auth.error.js';
import { AuthService, type ServerAuthResult } from './auth.service.js';
import { SESSION_DAYS, validateTransport, type ClientType } from './security.js';
import {
  authSchema,
  authFailure,
  codeResponse,
  verifyResponse,
  authenticatedResponse,
  sessionResponse,
} from './auth.schema.js';

export async function authRoutes(app: FastifyInstance, service: AuthService, config: Config) {
  const cookieName = config.cookieSecure ? '__Host-tyde_session' : 'tyde_session';
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
  };
  function client(req: FastifyRequest): ClientType {
    return req.headers['x-tyde-client'] === 'desktop' ? 'desktop' : 'web';
  }
  function token(req: FastifyRequest): string | undefined {
    if (client(req) === 'desktop') {
      const header = req.headers.authorization;
      return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    }
    return req.cookies[cookieName];
  }
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith(`${API_PREFIX}/auth/`)) return;
    reply.header('Cache-Control', 'no-store');
    try {
      validateTransport(req.headers, req.method, config.webOrigins);
    } catch (error) {
      throw new AuthError(403, 'ORIGIN_NOT_ALLOWED', (error as Error).message);
    }
  });
  function finish(result: ServerAuthResult, req: FastifyRequest, reply: FastifyReply) {
    if (result.status !== 'authenticated') return result;
    const { sessionToken, ...publicResult } = result;
    if (client(req) === 'desktop') return { ...publicResult, sessionToken };
    reply.setCookie(cookieName, sessionToken!, { ...cookieOptions, maxAge: SESSION_DAYS * 86_400 });
    return publicResult;
  }
  app.post<{ Body: PhoneInput }>(
    `${API_PREFIX}/auth/code`,
    {
      schema: { ...authSchema('sendCode', '发送验证码', { 200: codeResponse }), body: phoneSchema },
    },
    async (req) => service.sendCode(req.body, req.ip),
  );
  app.post<{ Body: VerifyInput }>(
    `${API_PREFIX}/auth/verify`,
    {
      schema: {
        ...authSchema('verifyCode', '验证并登录或获取注册凭证', {
          200: verifyResponse,
          410: authFailure,
        }),
        body: verifySchema,
      },
    },
    async (req, reply) => finish(await service.verify(req.body, req.ip, client(req)), req, reply),
  );
  app.post<{ Body: RegisterInput }>(
    `${API_PREFIX}/auth/register`,
    {
      schema: {
        ...authSchema('completeRegistration', '补充资料并注册', {
          201: authenticatedResponse,
          409: authFailure,
          410: authFailure,
        }),
        body: registerSchema,
      },
    },
    async (req, reply) => {
      const result = await service.register(req.body, client(req));
      reply.code(201);
      return finish(result, req, reply);
    },
  );
  app.get(
    `${API_PREFIX}/auth/me`,
    {
      schema: authSchema(
        'getCurrentUser',
        '获取当前会话',
        { 200: sessionResponse, 401: authFailure },
        true,
      ),
    },
    async (req) => service.me(token(req), client(req)),
  );
  app.post(
    `${API_PREFIX}/auth/logout`,
    {
      schema: authSchema('logout', '撤销当前会话（无会话也成功）', {
        204: { type: 'null', description: '退出成功，无响应体' },
      }),
    },
    async (req, reply) => {
      await service.logout(token(req));
      if (client(req) === 'web') reply.clearCookie(cookieName, cookieOptions);
      return reply.code(204).send();
    },
  );
}
