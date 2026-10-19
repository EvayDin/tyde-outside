import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  DESKTOP_NETWORK_SCHEME,
  DESKTOP_REQUEST_ROUTES,
  type DesktopNetworkTicket,
} from '@tyde/shared/ipc';
import type { BridgeResult, DesktopBridge } from '@tyde/shared';

async function invoke<T>(
  channel: keyof typeof DESKTOP_REQUEST_ROUTES,
  input?: unknown,
): Promise<BridgeResult<T>> {
  const result: BridgeResult<T> | DesktopNetworkTicket = await ipcRenderer.invoke(channel, input);
  if (!('networkRequestId' in result)) return result;
  const route = DESKTOP_REQUEST_ROUTES[channel];
  try {
    const response = await fetch(
      `${DESKTOP_NETWORK_SCHEME}://desktop${route.path}?request=${result.networkRequestId}`,
      {
        method: route.method,
        body: input === undefined ? undefined : JSON.stringify(input),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      },
    );
    const value = (await response.json()) as BridgeResult<T>;
    return value.ok ? { ok: true, data: value.data } : value;
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'DESKTOP_NETWORK_ERROR', message: '桌面请求失败，请重试或重启客户端' },
    };
  }
}

const bridge: DesktopBridge = {
  sendCode: (input) => invoke(IPC.sendCode, input),
  login: (input) => invoke(IPC.login, input),
  verifyCode: (input) => invoke(IPC.verifyCode, input),
  completeRegistration: (input) => invoke(IPC.register, input),
  getCurrentUser: () => invoke(IPC.me),
  logout: () => invoke(IPC.logout),
  health: () => invoke(IPC.health),
};
contextBridge.exposeInMainWorld('tydeDesktop', Object.freeze(bridge));
