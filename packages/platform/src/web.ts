import {
  API_PREFIX,
  ApiError,
  type AuthApi,
  type ApiFailure,
  type AuthUser,
  type RegistrationRequired,
  type VerifyResult,
} from '@tyde/shared';

let refreshToken: string | undefined;
let generation = 0;
let refreshing: Promise<boolean> | undefined;

function invalidResponse(): never {
  throw new ApiError(502, { code: 'INVALID_RESPONSE', message: '服务响应格式异常，请稍后重试' });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function failure(value: unknown): ApiFailure {
  return {
    code:
      record(value) && (typeof value.code === 'string' || typeof value.code === 'number')
        ? value.code
        : 'SERVICE_UNAVAILABLE',
    message:
      record(value) && typeof value.message === 'string' && value.message
        ? value.message
        : '服务暂不可用，请稍后重试',
    ...(record(value) && typeof value.requestId === 'string' ? { requestId: value.requestId } : {}),
  };
}
function retryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
async function send(path: string, body?: unknown, method = 'POST'): Promise<Response> {
  try {
    return await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'X-Tyde-Client': 'web',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: '连接服务失败，请检查网络后重试' });
  }
}
async function read(response: Response, wrapped = true): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(response.status, failure(payload), retryAfter(response));
  if (!record(payload)) invalidResponse();
  if (!wrapped) return payload;
  if (payload.code !== 200) {
    if (typeof payload.code !== 'number') invalidResponse();
    throw new ApiError(response.status, failure(payload), retryAfter(response));
  }
  if (!Object.hasOwn(payload, 'data')) invalidResponse();
  return payload.data;
}
function remember(value: unknown, expectedGeneration: number): void {
  if (
    !record(value) ||
    typeof value.accessToken !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.accessToken) ||
    typeof value.refreshToken !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.refreshToken) ||
    value.tokenType !== 'Bearer' ||
    typeof value.expiresIn !== 'number' ||
    !Number.isFinite(value.expiresIn) ||
    value.expiresIn <= 0
  )
    invalidResponse();
  if (generation !== expectedGeneration)
    throw new ApiError(409, { code: 'SESSION_CHANGED', message: '登录状态已变化，请重新操作' });
  // Web 使用 HttpOnly Cookie，刷新令牌仅留在适配器内存中。
  refreshToken = value.refreshToken;
}
async function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  if (!refreshToken) return false;
  const token = refreshToken;
  const current = generation;
  const task = (async () => {
    try {
      remember(await read(await send('/auth/refresh', { refreshToken: token })), current);
      return true;
    } catch (error) {
      if (generation === current && error instanceof ApiError && [401, 403].includes(error.status))
        refreshToken = undefined;
      if (error instanceof ApiError && [401, 403, 409].includes(error.status)) return false;
      throw error;
    }
  })();
  refreshing = task;
  try {
    return await task;
  } finally {
    if (refreshing === task) refreshing = undefined;
  }
}
async function request(
  path: string,
  body?: unknown,
  method = 'POST',
  authenticated = false,
): Promise<unknown> {
  const current = generation;
  const originalRefreshToken = refreshToken;
  const response = await send(path, body, method);
  const ensureCurrentSession = () => {
    if (authenticated && current !== generation)
      throw new ApiError(401, { code: 'SESSION_CHANGED', message: '登录状态已变化，请重新登录' });
  };
  ensureCurrentSession();
  if (response.status === 401 && authenticated) {
    // 迟到的旧请求遇到 401 时，直接复用另一请求已经轮换的新 Cookie。
    const refreshedElsewhere = Boolean(refreshToken && refreshToken !== originalRefreshToken);
    if (refreshedElsewhere || (await refresh())) {
      ensureCurrentSession();
      const data = await read(await send(path, body, method));
      ensureCurrentSession();
      return data;
    }
  }
  const data = await read(response);
  ensureCurrentSession();
  return data;
}
function user(value: unknown): AuthUser {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.uid !== 'string' ||
    typeof value.phone !== 'string' ||
    typeof value.realName !== 'string' ||
    typeof value.nickname !== 'string'
  )
    invalidResponse();
  return value as unknown as AuthUser;
}
async function authenticate(path: string, body: unknown): Promise<VerifyResult> {
  const current = ++generation;
  refreshToken = undefined;
  // 等待既有轮换完成，避免旧刷新响应覆盖新登录的 Cookie。
  await refreshing?.catch(() => undefined);
  const data = await request(path, body);
  if (generation !== current)
    throw new ApiError(409, { code: 'SESSION_CHANGED', message: '登录状态已变化，请重新操作' });
  if (record(data) && data.status === 'registration_required') {
    if (
      typeof data.registrationToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(data.registrationToken) ||
      typeof data.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(data.expiresAt))
    )
      invalidResponse();
    return {
      status: 'registration_required',
      registrationToken: data.registrationToken,
      expiresAt: data.expiresAt,
    } satisfies RegistrationRequired;
  }
  remember(data, current);
  return { status: 'authenticated' };
}

export const webAuth: AuthApi = {
  health: async () => {
    const data = await read(await send('/health/ready', undefined, 'GET'), false);
    if (!record(data) || typeof data.status !== 'string') invalidResponse();
    return { status: data.status };
  },
  sendCode: async (input) => {
    const data = await request('/auth/sms/send', input);
    if (typeof data !== 'string') invalidResponse();
    return data;
  },
  login: async (input) => {
    const result = await authenticate('/auth/login', input);
    if (result.status !== 'authenticated') invalidResponse();
  },
  verifyCode: (input) => authenticate('/auth/sms/login', input),
  completeRegistration: async (input) => user(await request('/auth/register', input)),
  getCurrentUser: async () => user(await request('/users/me', undefined, 'GET', true)),
  logout: async () => {
    generation++;
    refreshToken = undefined;
    await refreshing?.catch(() => undefined);
    await request('/auth/logout');
  },
};
