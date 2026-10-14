import type { FastifySchema } from 'fastify';

const dateTime = { type: 'string', format: 'date-time' };
const user = {
  type: 'object',
  required: ['id', 'phoneE164', 'phoneRegion', 'username', 'displayName', 'createdAt'],
  properties: {
    id: { type: 'string' },
    phoneE164: { type: 'string' },
    phoneRegion: { type: 'string' },
    username: { type: 'string' },
    displayName: { type: 'string' },
    createdAt: dateTime,
  },
};
export const sessionResponse = {
  type: 'object',
  required: ['user', 'sessionExpiresAt'],
  properties: { user, sessionExpiresAt: dateTime },
};
export const authenticatedResponse = {
  ...sessionResponse,
  required: [...sessionResponse.required, 'status'],
  properties: {
    ...sessionResponse.properties,
    status: { type: 'string', enum: ['authenticated'] },
    sessionToken: {
      type: 'string',
      description: '仅桌面 main 响应包含；Web 通过 Set-Cookie 建立会话。',
    },
  },
};
export const verifyResponse = {
  anyOf: [
    authenticatedResponse,
    {
      type: 'object',
      required: ['status', 'registrationToken', 'expiresAt'],
      properties: {
        status: { type: 'string', enum: ['registration_required'] },
        registrationToken: { type: 'string' },
        expiresAt: dateTime,
      },
    },
  ],
};
export const codeResponse = {
  type: 'object',
  required: ['challengeId', 'expiresAt', 'resendAfterSeconds', 'mode'],
  properties: {
    challengeId: { type: 'string', format: 'uuid' },
    expiresAt: dateTime,
    resendAfterSeconds: { type: 'integer' },
    mode: { type: 'string', enum: ['mock', 'sms'] },
  },
};
const failure = {
  type: 'object',
  required: ['code', 'message', 'requestId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    requestId: { type: 'string' },
  },
};
export function authSchema(
  operationId: string,
  summary: string,
  response: Record<string, unknown>,
  protectedRoute = false,
): FastifySchema {
  return {
    operationId,
    summary,
    tags: ['Auth'],
    description:
      'Web 请求默认使用 Cookie；POST 的 Origin 必须在 WEB_ORIGINS 内。桌面请求需 X-Tyde-Client: desktop 且不能带 Origin、Cookie 或 sec-fetch-* 头。429 响应包含 Retry-After（秒）。',
    security: protectedRoute ? [{ webSession: [] }, { desktopSession: [] }] : [],
    headers: {
      type: 'object',
      properties: {
        'x-tyde-client': { type: 'string', enum: ['web', 'desktop'], default: 'web' },
      },
    },
    response: {
      400: failure,
      403: failure,
      413: failure,
      429: failure,
      500: failure,
      503: failure,
      ...response,
    },
  };
}
export const authFailure = failure;
