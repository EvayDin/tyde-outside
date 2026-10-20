import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@tyde/shared/ipc';
import type { BridgeResult } from '@tyde/shared';
import type { RuntimeConfig } from '../config.js';
import { trustedPage } from '../windows.js';

export function registerIpc(config: RuntimeConfig): void {
  ipcMain.handle(IPC.runtime, (event, input: unknown): BridgeResult<{ apiBaseUrl: string }> => {
    const sender = event.sender;
    const frame = event.senderFrame;
    try {
      if (
        !frame ||
        !BrowserWindow.fromWebContents(sender) ||
        frame !== sender.mainFrame ||
        !trustedPage(frame.url)
      )
        return {
          ok: false,
          status: 403,
          error: { code: 'IPC_FORBIDDEN', message: '请求来源不可信' },
        };
    } catch {
      return {
        ok: false,
        status: 403,
        error: { code: 'IPC_FORBIDDEN', message: '请求来源不可信' },
      };
    }
    if (input !== undefined)
      return {
        ok: false,
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: '请求参数无效' },
      };
    return { ok: true, data: { apiBaseUrl: config.apiBaseUrl } };
  });
}
