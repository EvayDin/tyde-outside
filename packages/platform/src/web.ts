import { API_PREFIX, ApiError, type AuthApi, type ApiFailure } from '@tyde/shared';

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
      headers: { 'X-Tyde-Client': 'web', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: '连接服务失败，请检查网络后重试' });
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({
      code: 'SERVICE_UNAVAILABLE',
      message: '服务暂不可用，请稍后重试',
    }))) as ApiFailure;
    throw new ApiError(
      response.status,
      failure,
      Number(response.headers.get('Retry-After')) || undefined,
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
export const webAuth: AuthApi = {
  health: () => request('/health/ready', undefined, 'GET'),
  sendCode: (input) => request('/auth/code', input),
  verifyCode: (input) => request('/auth/verify', input),
  completeRegistration: (input) => request('/auth/register', input),
  getCurrentUser: () => request('/auth/me', undefined, 'GET'),
  logout: () => request('/auth/logout'),
};
