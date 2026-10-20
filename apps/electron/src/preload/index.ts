import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@tyde/shared/ipc';
import type { DesktopBridge } from '@tyde/shared';

const bridge: DesktopBridge = {
  getRuntimeConfig: () => ipcRenderer.invoke(IPC.runtime),
};
contextBridge.exposeInMainWorld('tydeDesktop', Object.freeze(bridge));
