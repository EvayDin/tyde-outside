import {
  API_PREFIX,
  ApiError,
  type AuthApi,
  type AuthUser,
  type Authenticated,
  type LoginInput,
  type RegistrationRequired,
  type SmsLoginInput,
  type SmsRegisterInput,
  type SmsSendInput,
} from '@tyde/shared';
import { isSessionTokens, type SessionStore, type SessionTokens } from './session.js';
import { desktopRequest } from './transport.js';

type Store = Pick<SessionStore, 'load' | 'save' | 'clear'>;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function withoutCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCredentials);
  if (!record(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/^(accessToken|refreshToken|sessionToken)$/i.test(key))
      .map(([key, entry]) => [key, withoutCredentials(entry)]),
  );
}
function user(value: unknown): AuthUser {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.uid !== 'string' ||
    typeof value.phone !== 'string' ||
    typeof value.nickname !== 'string' ||
    typeof value.realName !== 'string'
  )
    throw invalidResponse();
  return withoutCredentials(value) as AuthUser;
}
function invalidResponse() {
  return new ApiError(502, { code: 'INVALID_RESPONSE', message: '服务响应异常，请稍后重试' });
}
function changedSession() {
  return new ApiError(401, { code: 'SESSION_CHANGED', message: '登录状态已变化，请重新登录' });
}
export class DesktopAuthClient implements AuthApi {
  private generation = 0;
  private refreshing?: { generation: number; promise: Promise<SessionTokens> };
  constructor(
    private readonly origin: string,
    private readonly store: Store,
    private readonly transport = desktopRequest,
  ) {}
  private ensureCurrent(generation: number): void {
    if (generation !== this.generation) throw changedSession();
  }
  private async request(
    path: string,
    body?: unknown,
    method = 'POST',
    accessToken?: string,
    wrapped = true,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(
        `${this.origin}${API_PREFIX}${path}`,
        method,
        {
          'X-Tyde-Client': 'desktop',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body === undefined ? undefined : JSON.stringify(body),
      );
    } catch {
      throw new ApiError(0, { code: 'NETWORK_ERROR', message: '连接服务失败，请检查网络后重试' });
    }
    const result: unknown = await response.json().catch(() => undefined);
    const retryValue = response.headers.get('Retry-After');
    const retry = retryValue
      ? /^\d+$/.test(retryValue)
        ? Number(retryValue)
        : Math.ceil((Date.parse(retryValue) - Date.now()) / 1000)
      : NaN;
    const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
    if (!response.ok || (wrapped && record(result) && result.code !== 200)) {
      throw new ApiError(
        response.ok ? 502 : response.status,
        {
          code:
            record(result) && (typeof result.code === 'string' || typeof result.code === 'number')
              ? result.code
              : 'SERVICE_UNAVAILABLE',
          message:
            record(result) && typeof result.message === 'string'
              ? result.message
              : '服务暂不可用，请稍后重试',
          ...(record(result) && typeof result.requestId === 'string'
            ? { requestId: result.requestId }
            : {}),
        },
        retryAfter,
      );
    }
    if (!wrapped) return result;
    if (!record(result) || result.code !== 200 || !('data' in result)) throw invalidResponse();
    return result.data;
  }
  private async revoke(tokens: SessionTokens): Promise<void> {
    await this.request('/auth/logout', undefined, 'POST', tokens.accessToken).catch(
      () => undefined,
    );
  }
  private async saveTokens(value: unknown, generation: number): Promise<SessionTokens> {
    if (
      !record(value) ||
      !isSessionTokens(value) ||
      value.tokenType !== 'Bearer' ||
      typeof value.expiresIn !== 'number' ||
      !Number.isFinite(value.expiresIn) ||
      value.expiresIn <= 0
    )
      throw invalidResponse();
    const tokens = { accessToken: value.accessToken, refreshToken: value.refreshToken };
    if (generation !== this.generation) {
      await this.revoke(tokens);
      throw changedSession();
    }
    await this.store.save(tokens);
    if (generation !== this.generation) {
      await this.revoke(tokens);
      throw changedSession();
    }
    return tokens;
  }
  private async expire(generation: number): Promise<never> {
    if (generation === this.generation) {
      this.generation++;
      await this.store.clear();
    }
    throw new ApiError(401, { code: 'SESSION_EXPIRED', message: '登录已过期，请重新登录' });
  }
  private async rotate(failed: SessionTokens, generation: number): Promise<SessionTokens> {
    const current = await this.store.load();
    this.ensureCurrent(generation);
    if (!current) return this.expire(generation);
    if (current.accessToken !== failed.accessToken) return current;
    let result: unknown;
    try {
      result = await this.request('/auth/refresh', { refreshToken: current.refreshToken });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return this.expire(generation);
      throw error;
    }
    return this.saveTokens(result, generation);
  }
  private async refresh(failed: SessionTokens, generation: number): Promise<SessionTokens> {
    this.ensureCurrent(generation);
    if (this.refreshing?.generation === generation) return this.refreshing.promise;
    const flight = { generation, promise: this.rotate(failed, generation) };
    this.refreshing = flight;
    try {
      return await flight.promise;
    } finally {
      if (this.refreshing === flight) this.refreshing = undefined;
    }
  }
  private async authenticated(path: string): Promise<unknown> {
    const generation = this.generation;
    const tokens = await this.store.load();
    this.ensureCurrent(generation);
    let result: unknown;
    try {
      result = await this.request(path, undefined, 'GET', tokens?.accessToken);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (!tokens) return this.expire(generation);
      const renewed = await this.refresh(tokens, generation);
      this.ensureCurrent(generation);
      try {
        result = await this.request(path, undefined, 'GET', renewed.accessToken);
      } catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 401)
          return this.expire(generation);
        throw retryError;
      }
    }
    this.ensureCurrent(generation);
    return result;
  }
  async health(): Promise<{ status: string }> {
    const result = await this.request('/health/ready', undefined, 'GET', undefined, false);
    if (!record(result) || typeof result.status !== 'string') throw invalidResponse();
    return { status: result.status };
  }
  async sendCode(input: SmsSendInput): Promise<string> {
    const result = await this.request('/auth/sms/send', input);
    if (typeof result !== 'string') throw invalidResponse();
    return result;
  }
  async login(input: LoginInput): Promise<void> {
    const generation = ++this.generation;
    await this.store.clear();
    this.ensureCurrent(generation);
    await this.saveTokens(await this.request('/auth/login', input), generation);
  }
  async verifyCode(input: SmsLoginInput): Promise<Authenticated | RegistrationRequired> {
    const generation = ++this.generation;
    await this.store.clear();
    this.ensureCurrent(generation);
    const result = await this.request('/auth/sms/login', input);
    if (record(result) && result.status === 'registration_required') {
      this.ensureCurrent(generation);
      if (
        typeof result.registrationToken !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(result.registrationToken) ||
        typeof result.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(result.expiresAt))
      )
        throw invalidResponse();
      return {
        status: 'registration_required',
        registrationToken: result.registrationToken,
        expiresAt: result.expiresAt,
      };
    }
    await this.saveTokens(result, generation);
    return { status: 'authenticated' };
  }
  async completeRegistration(input: SmsRegisterInput): Promise<AuthUser> {
    return user(await this.request('/auth/register', input));
  }
  async getCurrentUser(): Promise<AuthUser> {
    return user(await this.authenticated('/users/me'));
  }
  async logout(): Promise<void> {
    const generation = ++this.generation;
    const refresh = this.refreshing?.promise;
    const tokens = await this.store.load();
    if (generation === this.generation) await this.store.clear();
    try {
      await this.request('/auth/logout', undefined, 'POST', tokens?.accessToken);
    } finally {
      // 已发出的轮换若晚到，由 saveTokens 撤销新令牌，不能恢复已退出的本地会话。
      await refresh?.catch(() => undefined);
    }
  }
}
