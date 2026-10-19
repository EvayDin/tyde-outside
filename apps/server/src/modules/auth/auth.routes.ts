import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  API_PREFIX,
  smsSendSchema,
  smsLoginSchema,
  smsRegisterSchema,
  loginSchema,
  refreshSchema,
  passwordResetSchema,
  type SmsSendInput,
  type SmsLoginInput,
  type SmsRegisterInput,
  type LoginInput,
  type PasswordResetInput,
  type LoginResponse,
} from '@tyde/shared';
import type { Config } from '../../config/index.js';
import { AuthError } from './auth.error.js';
import { AuthService } from './auth.service.js';
import { SESSION_DAYS, validateTransport, type ClientType } from './security.js';
import {
  authSchema,
  resultSchema,
  userResponse,
  loginResponse,
  smsLoginResponse,
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
  function token(req: FastifyRequest) {
    return client(req) === 'desktop'
      ? req.headers.authorization?.replace(/^Bearer /, '')
      : req.cookies[cookieName];
  }
  const success = <T>(data: T) => ({ code: 200, message: '操作成功', data });
  app.addHook('onRequest', async (req, reply) => {
    if (
      !req.url.startsWith(`${API_PREFIX}/auth/`) &&
      req.url.split('?')[0] !== `${API_PREFIX}/users/me`
    )
      return;
    reply.header('Cache-Control', 'no-store');
    // Ordinary API clients retain the legacy Bearer contract without a custom header.
    if (
      !req.headers['x-tyde-client'] &&
      !req.headers.origin &&
      !req.headers.cookie &&
      !Object.keys(req.headers).some((key) => key.startsWith('sec-fetch-'))
    )
      req.headers['x-tyde-client'] = 'desktop';
    try {
      validateTransport(req.headers, req.method, config.webOrigins);
    } catch (error) {
      throw new AuthError(403, 'ORIGIN_NOT_ALLOWED', (error as Error).message);
    }
  });
  function finish(result: LoginResponse, req: FastifyRequest, reply: FastifyReply) {
    if (client(req) === 'web')
      reply.setCookie(cookieName, result.accessToken, {
        ...cookieOptions,
        maxAge: SESSION_DAYS * 86_400,
      });
    return success(result);
  }
  app.post<{ Body: SmsSendInput }>(
    `${API_PREFIX}/auth/sms/send`,
    {
      schema: {
        ...authSchema(
          'sendCode',
          '发送短信验证码',
          resultSchema({
            type: 'string',
            description: '验证码发送结果提示；开发/测试 mock 不实际发送短信。',
            examples: ['验证码已发送，请注意查收'],
          }),
        ),
        body: smsSendSchema,
      },
    },
    async (req) => success(await service.sendCode(req.body, req.ip)),
  );
  app.post<{ Body: SmsRegisterInput }>(
    `${API_PREFIX}/auth/register`,
    {
      schema: {
        ...authSchema(
          'register',
          '注册（固定为执行专家，无需选择身份）',
          resultSchema(userResponse),
        ),
        body: smsRegisterSchema,
      },
    },
    async (req) => success(await service.register(req.body, req.ip)),
  );
  app.post<{ Body: LoginInput }>(
    `${API_PREFIX}/auth/login`,
    {
      schema: {
        ...authSchema('login', '密码登录（默认执行专家）', resultSchema(loginResponse)),
        body: loginSchema,
      },
    },
    async (req, reply) => finish(await service.login(req.body, req.ip, client(req)), req, reply),
  );
  app.post<{ Body: SmsLoginInput }>(
    `${API_PREFIX}/auth/sms/login`,
    {
      schema: {
        ...authSchema(
          'loginBySms',
          '短信登录或进入注册（默认执行专家）',
          resultSchema(smsLoginResponse),
        ),
        body: smsLoginSchema,
      },
    },
    async (req, reply) => {
      const result = await service.loginBySms(req.body, req.ip, client(req));
      return 'status' in result ? success(result) : finish(result, req, reply);
    },
  );
  app.post<{ Body: { refreshToken: string } }>(
    `${API_PREFIX}/auth/refresh`,
    {
      schema: {
        ...authSchema('refresh', '刷新令牌（旧令牌对失效）', resultSchema(loginResponse)),
        body: refreshSchema,
      },
    },
    async (req, reply) =>
      finish(await service.refresh(req.body.refreshToken, client(req)), req, reply),
  );
  app.post<{ Body: PasswordResetInput }>(
    `${API_PREFIX}/auth/password/reset`,
    {
      schema: {
        ...authSchema(
          'resetPassword',
          '重置密码并撤销所有会话',
          resultSchema({
            type: 'null',
            description: '操作成功，无业务数据，固定为 null。',
            examples: [null],
          }),
        ),
        body: passwordResetSchema,
      },
    },
    async (req) => {
      await service.resetPassword(req.body, req.ip);
      return success(null);
    },
  );
  app.get(
    `${API_PREFIX}/users/me`,
    { schema: authSchema('getCurrentUser', '获取当前用户', resultSchema(userResponse), true) },
    async (req) => success(await service.me(token(req), client(req))),
  );
  app.post(
    `${API_PREFIX}/auth/logout`,
    {
      schema: authSchema(
        'logout',
        '退出当前会话',
        resultSchema({
          type: 'null',
          description: '操作成功，无业务数据，固定为 null。',
          examples: [null],
        }),
      ),
    },
    async (req, reply) => {
      await service.logout(token(req));
      if (client(req) === 'web') reply.clearCookie(cookieName, cookieOptions);
      return success(null);
    },
  );
}
