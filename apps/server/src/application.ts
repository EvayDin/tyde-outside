import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { Prisma, PrismaClient } from '@prisma/client';
import { API_PREFIX } from '@tyde/shared';
import { readConfig, type Config } from './config/index.js';
import { AuthError } from './modules/auth/auth.error.js';
import { AuthService } from './modules/auth/auth.service.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { registerDocs } from './docs.js';

export function fastifyOptions(config: Config): FastifyServerOptions {
  return {
    logger: {
      level: config.logLevel,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.code',
        '*.registrationToken',
        '*.sessionToken',
      ],
    },
    genReqId: () => randomUUID(),
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  };
}

export async function createApp(
  config: Config = readConfig(),
  db = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } }),
  app = Fastify(fastifyOptions(config)),
) {
  await app.register(cookie);
  await registerDocs(app, config);
  app.addHook('onClose', async () => {
    await db.$disconnect();
  });
  app.setErrorHandler<FastifyError>((error, req, reply) => {
    if (error instanceof AuthError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message, requestId: req.id });
    }
    if (error.validation || error.statusCode === 400 || error.statusCode === 413)
      return reply
        .code(error.statusCode === 413 ? 413 : 400)
        .send({ code: 'VALIDATION_ERROR', message: '请求字段或格式不正确', requestId: req.id });
    const unavailable =
      error instanceof Prisma.PrismaClientInitializationError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code));
    // 不记录错误 message / SQL / 请求体，避免其中夹带验证码和数据库连接串。
    req.log.error(
      { errorType: error.name, errorCode: 'code' in error ? error.code : undefined },
      'request failed',
    );
    return reply.code(unavailable ? 503 : 500).send({
      code: unavailable ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
      message: unavailable ? '服务暂不可用，请稍后重试' : '操作失败，请稍后重试',
      requestId: req.id,
    });
  });
  await authRoutes(app, new AuthService(db, config), config);
  app.get(
    `${API_PREFIX}/health/live`,
    {
      schema: {
        operationId: 'healthLive',
        tags: ['Health'],
        summary: '存活检查',
        response: {
          200: {
            type: 'object',
            required: ['status', 'application'],
            properties: {
              status: { type: 'string', enum: ['ok'] },
              application: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({ status: 'ok', application: 'tyde' }),
  );
  app.get(
    `${API_PREFIX}/health/ready`,
    {
      schema: {
        operationId: 'healthReady',
        tags: ['Health'],
        summary: '数据库就绪检查',
        response: Object.fromEntries(
          [
            [200, 'ready'],
            [503, 'unavailable'],
          ].map(([code, status]) => [
            code,
            {
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string', enum: [status] } },
            },
          ]),
        ),
      },
    },
    async (_req, reply) => {
      try {
        await db.$queryRaw`SELECT 1`;
        return { status: 'ready' };
      } catch {
        return reply.code(503).send({ status: 'unavailable' });
      }
    },
  );
  return app;
}
