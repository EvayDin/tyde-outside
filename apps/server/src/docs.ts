import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { API_PREFIX } from '@tyde-outside/shared';
import type { Config } from './config/index.js';

export async function registerDocs(app: FastifyInstance, config: Config) {
  // 必须在业务路由之前注册，动态收集路由 schema。
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'tyde-outside API',
        version: '0.1.0',
        description: '大陆手机号认证 API。开发/测试短信验证码为字符串 095270。',
      },
      tags: [
        { name: 'Auth', description: '验证码、注册与会话' },
        { name: 'Health', description: '存活与数据库就绪检查' },
      ],
      components: {
        securitySchemes: {
          webSession: {
            type: 'apiKey',
            in: 'cookie',
            name: config.cookieSecure ? '__Host-tyde_session' : 'tyde_session',
            description: 'Web 登录自动设置 HttpOnly Cookie，浏览器自动携带。',
          },
          desktopSession: {
            type: 'http',
            scheme: 'bearer',
            description: '仅桌面 main 使用，须传 X-Tyde-Client: desktop，不能带浏览器头或 Cookie。',
          },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: `${API_PREFIX}/docs`,
    staticCSP: true,
    uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: false },
  });
}
