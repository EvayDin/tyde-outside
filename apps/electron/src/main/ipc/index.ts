import {
  app,
  safeStorage,
  ipcMain,
  type WebContents,
  type WebFrameMain,
  BrowserWindow,
  protocol,
} from 'electron';
import type { TSchema } from '@sinclair/typebox';
import {
  IPC,
  ApiError,
  smsSendSchema,
  smsLoginSchema,
  smsRegisterSchema,
  loginSchema,
  type BridgeResult,
} from '@tyde/shared';
import {
  DESKTOP_NETWORK_SCHEME,
  DESKTOP_REQUEST_ROUTES,
  type DesktopNetworkTicket,
} from '@tyde/shared/ipc';
import type { RuntimeConfig } from '../config.js';
import { SessionStore } from '../session.js';
import { DesktopAuthClient } from '../auth-client.js';
import { trustedPage } from '../windows.js';
import { checkIpcInput } from './validation.js';
import { DevelopmentNetwork } from '../development-network.js';

export function registerIpc(config: RuntimeConfig): void {
  const auth = new DesktopAuthClient(
    config.apiBaseUrl,
    new SessionStore(config.apiBaseUrl, app.getPath('userData'), safeStorage),
  );
  const network = app.isPackaged ? undefined : new DevelopmentNetwork();
  if (network) protocol.handle(DESKTOP_NETWORK_SCHEME, (request) => network.respond(request));
  const documents = new WeakMap<WebContents, { version: number }>();
  function document(sender: WebContents): { version: number } {
    let state = documents.get(sender);
    if (!state) {
      const current = { version: 0 };
      sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) current.version++;
      });
      documents.set(sender, current);
      state = current;
    }
    return state;
  }
  function allowed(sender: WebContents, frame: WebFrameMain): boolean {
    try {
      const window = BrowserWindow.fromWebContents(sender);
      return Boolean(window && frame === sender.mainFrame && trustedPage(frame.url));
    } catch {
      return false;
    }
  }
  function failed(error: unknown): BridgeResult<never> {
    if (error instanceof ApiError)
      return {
        ok: false,
        status: error.status,
        error: {
          code: error.code,
          message: error.message,
          ...(error.requestId ? { requestId: error.requestId } : {}),
        },
        retryAfter: error.retryAfter,
      };
    return {
      ok: false,
      status: 500,
      error: { code: 'DESKTOP_STORAGE_ERROR', message: '桌面安全存储或服务响应异常，请重试' },
    };
  }
  function handle<T>(
    channel: keyof typeof DESKTOP_REQUEST_ROUTES,
    schema: TSchema | undefined,
    operation: (input: unknown) => Promise<T>,
  ) {
    ipcMain.handle(
      channel,
      async (event, input: unknown): Promise<BridgeResult<T> | DesktopNetworkTicket> => {
        const sender = event.sender;
        const frame = event.senderFrame;
        if (!frame || !allowed(sender, frame))
          return {
            ok: false,
            status: 403,
            error: { code: 'IPC_FORBIDDEN', message: '请求来源不可信' },
          };
        if (!checkIpcInput(schema, input))
          return {
            ok: false,
            status: 400,
            error: { code: 'VALIDATION_ERROR', message: '请求参数无效' },
          };
        const execute = async (): Promise<BridgeResult<T>> => {
          try {
            return { ok: true, data: await operation(input) };
          } catch (error) {
            return failed(error);
          }
        };
        try {
          if (!network) return await execute();
          const pageUrl = frame.url;
          const state = document(sender);
          const version = state.version;
          return network.issue(
            DESKTOP_REQUEST_ROUTES[channel],
            input,
            new URL(pageUrl).origin,
            () => state.version === version && allowed(sender, frame),
            execute,
          );
        } catch (error) {
          return failed(error);
        }
      },
    );
  }
  handle(IPC.sendCode, smsSendSchema, (input) =>
    auth.sendCode(input as Parameters<typeof auth.sendCode>[0]),
  );
  handle(IPC.login, loginSchema, (input) => auth.login(input as Parameters<typeof auth.login>[0]));
  handle(IPC.verifyCode, smsLoginSchema, (input) =>
    auth.verifyCode(input as Parameters<typeof auth.verifyCode>[0]),
  );
  handle(IPC.register, smsRegisterSchema, (input) =>
    auth.completeRegistration(input as Parameters<typeof auth.completeRegistration>[0]),
  );
  handle(IPC.me, undefined, () => auth.getCurrentUser());
  handle(IPC.logout, undefined, () => auth.logout());
  handle(IPC.health, undefined, () => auth.health());
}
