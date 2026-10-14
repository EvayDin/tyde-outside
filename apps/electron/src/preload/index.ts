import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@tyde-outside/shared/ipc';
import type { DesktopBridge } from '@tyde-outside/shared';
const bridge: DesktopBridge = {
  sendCode: (input) => ipcRenderer.invoke(IPC.sendCode, input),
  verifyCode: (input) => ipcRenderer.invoke(IPC.verifyCode, input),
  completeRegistration: (input) => ipcRenderer.invoke(IPC.register, input),
  getCurrentUser: () => ipcRenderer.invoke(IPC.me),
  logout: () => ipcRenderer.invoke(IPC.logout),
  health: () => ipcRenderer.invoke(IPC.health),
};
contextBridge.exposeInMainWorld('tydeDesktop', Object.freeze(bridge));
