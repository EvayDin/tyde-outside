import { app, protocol, net, dialog, BrowserWindow, session } from 'electron';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRuntime } from './config.js';
import { registerIpc } from './ipc/index.js';
import { createWindow, iconPath } from './windows.js';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tyde-app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
// 保留改名前的用户数据目录，升级后继续读取已有会话和浏览器数据。
if (app.isPackaged) app.setPath('userData', resolve(app.getPath('appData'), 'tyde-outside'));
if (!app.isPackaged && process.env.TYDE_TEST_USER_DATA)
  app.setPath('userData', process.env.TYDE_TEST_USER_DATA);
function startupFailed() {
  dialog.showErrorBox('tyde 启动失败', '请检查安装资源、运行配置和系统权限。');
  app.quit();
}
if (!app.requestSingleInstanceLock()) {
  console.info('tyde 已在运行，已请求打开现有窗口。');
  app.quit();
} else {
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('app.tydeoutside.desktop');
      if (!app.isPackaged) app.dock?.setIcon(iconPath);
      const config = await loadRuntime();
      const partition = `persist:tyde-${createHash('sha256').update(config.apiBaseUrl).digest('hex').slice(0, 16)}`;
      const browserSession = session.fromPartition(partition);
      browserSession.protocol.handle('tyde-app', async (request) => {
        try {
          const url = new URL(request.url);
          if (url.host !== 'app' || url.username || url.password || request.method !== 'GET')
            return new Response('Forbidden', { status: 403 });
          const root = app.isPackaged
            ? resolve(process.resourcesPath, 'web')
            : resolve(import.meta.dirname, '../../../web/dist');
          const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
          const rel = relative(root, path);
          if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
            return new Response('Forbidden', { status: 403 });
          const response = await net.fetch(pathToFileURL(path).toString());
          const headers = new Headers(response.headers);
          headers.set(
            'Content-Security-Policy',
            `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${config.apiBaseUrl}; object-src 'none'; base-uri 'none'; frame-src 'none'`,
          );
          return new Response(response.body, { status: response.status, headers });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      registerIpc(config);
      let creatingWindow: Promise<BrowserWindow> | undefined;
      async function showMainWindow() {
        let window = BrowserWindow.getAllWindows()[0];
        if (creatingWindow || !window) {
          creatingWindow ??= createWindow(browserSession).finally(() => {
            creatingWindow = undefined;
          });
          window = await creatingWindow;
        }
        if (window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        if (process.platform === 'darwin') app.focus({ steal: true });
      }
      const openMainWindow = () => void showMainWindow().catch(startupFailed);
      app.on('second-instance', openMainWindow);
      app.on('activate', openMainWindow);
      await showMainWindow();
    })
    .catch(startupFailed);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
