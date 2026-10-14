import { BrowserWindow, app } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export function trustedPage(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (app.isPackaged)
      return (
        url.protocol === 'tyde-app:' &&
        url.host === 'app' &&
        url.pathname === '/index.html' &&
        !url.search
      );
    const expected = new URL(process.env.TYDE_WEB_URL ?? 'http://127.0.0.1:5173');
    return (
      expected.hostname === '127.0.0.1' &&
      expected.protocol === 'http:' &&
      url.origin === expected.origin &&
      url.pathname === '/' &&
      !url.search
    );
  } catch {
    return false;
  }
}
export async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 420,
    minHeight: 640,
    title: 'tyde',
    backgroundColor: '#f6f7fb',
    show: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!trustedPage(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  const url = app.isPackaged
    ? 'tyde-app://app/index.html'
    : (process.env.TYDE_WEB_URL ?? 'http://127.0.0.1:5173/');
  if (!trustedPage(url)) throw new Error('拒绝加载不可信前端地址');
  await window.loadURL(url);
  return window;
}
