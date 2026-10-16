import type { FastifySchema } from 'fastify';
const string = { type: 'string' };
const nullableString = { type: 'string', nullable: true };
export const userResponse = {
  type: 'object',
  properties: {
    id: string,
    uid: string,
    accountType: string,
    phone: string,
    nickname: string,
    realName: string,
    idCardNo: nullableString,
    idVerified: { type: 'integer' },
    avatarUrl: nullableString,
    bio: nullableString,
    role: { type: 'string', enum: ['EXPERT'] },
    roles: { type: 'array', items: { type: 'string', enum: ['EXPERT'] } },
    selectedRole: nullableString,
    hasExpertManagementRole: { type: 'boolean' },
    status: string,
    creditScore: { type: 'integer' },
    lastLoginAt: nullableString,
    lastLoginIp: nullableString,
    organization: { type: 'object', nullable: true, additionalProperties: true },
    createdAt: string,
    updatedAt: string,
  },
};
export const loginResponse = {
  type: 'object',
  required: ['accessToken', 'refreshToken', 'tokenType', 'expiresIn'],
  properties: {
    accessToken: string,
    refreshToken: string,
    tokenType: { type: 'string', enum: ['Bearer'] },
    expiresIn: { type: 'integer' },
  },
};
export function resultSchema(data: unknown) {
  return {
    type: 'object',
    required: ['code', 'message', 'data'],
    properties: { code: { type: 'integer' }, message: string, data },
  };
}
export function authSchema(
  operationId: string,
  summary: string,
  response: unknown,
  protectedRoute = false,
): FastifySchema {
  const failure = resultSchema({ type: 'null' });
  return {
    operationId,
    summary,
    tags: ['Auth'],
    description:
      '沿用 tyde-core 字段与 Result 包装。role/roles 可省略；即使传入其他角色仍固定 EXPERT。Web 使用 Cookie 与 Origin 校验；桌面使用 X-Tyde-Client: desktop 和 Bearer 令牌。',
    security: protectedRoute ? [{ webSession: [] }, { desktopSession: [] }] : [],
    response: {
      200: response,
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 413, 429, 500, 503].map((status) => [status, failure]),
      ),
    },
  };
}
