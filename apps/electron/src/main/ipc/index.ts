import { ipcMain, type IpcMainInvokeEvent, BrowserWindow } from 'electron';
import { Value } from '@sinclair/typebox/value';
import { FormatRegistry, type TSchema } from '@sinclair/typebox';
import {
  API_PREFIX,
  IPC,
  phoneSchema,
  verifySchema,
  registerSchema,
  type ApiFailure,
  type BridgeResult,
} from '@tyde-outside/shared';
import type { RuntimeConfig } from '../config.js';
import { SessionStore } from '../session.js';
import { trustedPage } from '../windows.js';
import { desktopRequest } from '../transport.js';

export function registerIpc(config: RuntimeConfig): void {
  FormatRegistry.Set('uuid', (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  );
  const store = new SessionStore(config.apiBaseUrl);
  async function request(path: string, body: unknown, method: string, authenticated: boolean) {
    const token = authenticated ? await store.load() : undefined;
    let response: Response;
    try {
      response = await desktopRequest(
        `${config.apiBaseUrl}${API_PREFIX}${path}`,
        method,
        {
          'X-Tyde-Client': 'desktop',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body ? JSON.stringify(body) : undefined,
      );
    } catch {
      return {
        ok: false,
        status: 0,
        error: { code: 'NETWORK_ERROR', message: '连接服务失败，请检查网络后重试' },
      } satisfies BridgeResult<never>;
    }
    if (!response.ok) {
      if (response.status === 401) await store.clear();
      const error = (await response
        .json()
        .catch(() => ({ code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用' }))) as ApiFailure;
      return {
        ok: false,
        status: response.status,
        error,
        retryAfter: Number(response.headers.get('Retry-After')) || undefined,
      } satisfies BridgeResult<never>;
    }
    if (response.status === 204) {
      await store.clear();
      return { ok: true, data: undefined } satisfies BridgeResult<void>;
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.sessionToken === 'string') {
      const { sessionToken, ...safeData } = data;
      if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) throw new Error('服务返回了无效会话');
      await store.save(sessionToken);
      return { ok: true, data: safeData };
    }
    return { ok: true, data };
  }
  function allowed(event: IpcMainInvokeEvent): boolean {
    const window = BrowserWindow.fromWebContents(event.sender);
    return Boolean(
      window && event.senderFrame === event.sender.mainFrame && trustedPage(event.senderFrame.url),
    );
  }
  function handle(
    channel: string,
    path: string,
    schema: TSchema | undefined,
    method = 'POST',
    authenticated = false,
  ) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (!allowed(event))
        return {
          ok: false,
          status: 403,
          error: { code: 'IPC_FORBIDDEN', message: '请求来源不可信' },
        };
      if ((schema && !Value.Check(schema, input)) || (!schema && input !== undefined))
        return {
          ok: false,
          status: 400,
          error: { code: 'VALIDATION_ERROR', message: '请求参数无效' },
        };
      try {
        return await request(path, input, method, authenticated);
      } catch {
        return {
          ok: false,
          status: 500,
          error: { code: 'DESKTOP_STORAGE_ERROR', message: '桌面安全存储或服务响应异常，请重试' },
        };
      }
    });
  }
  handle(IPC.sendCode, '/auth/code', phoneSchema);
  handle(IPC.verifyCode, '/auth/verify', verifySchema);
  handle(IPC.register, '/auth/register', registerSchema);
  handle(IPC.me, '/auth/me', undefined, 'GET', true);
  handle(IPC.logout, '/auth/logout', undefined, 'POST', true);
  handle(IPC.health, '/health/ready', undefined, 'GET');
}
