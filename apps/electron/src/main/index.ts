import { app, protocol, net, dialog, BrowserWindow } from 'electron';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRuntime } from './config.js';
import { registerIpc } from './ipc/index.js';
import { createWindow, iconPath } from './windows.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'tyde-app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
// 保留改名前的用户数据目录，升级后继续读取已有会话和浏览器数据。
if (app.isPackaged) app.setPath('userData', resolve(app.getPath('appData'), 'tyde-outside'));
if (!app.isPackaged && process.env.TYDE_TEST_USER_DATA)
  app.setPath('userData', process.env.TYDE_TEST_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('app.tydeoutside.desktop');
      if (!app.isPackaged) app.dock?.setIcon(iconPath);
      protocol.handle('tyde-app', async (request) => {
        try {
          const url = new URL(request.url);
          if (url.host !== 'app' || request.method !== 'GET')
            return new Response('Forbidden', { status: 403 });
          const root = resolve(process.resourcesPath, 'web');
          const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
          const rel = relative(root, path);
          if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
            return new Response('Forbidden', { status: 403 });
          const response = await net.fetch(pathToFileURL(path).toString());
          const headers = new Headers(response.headers);
          headers.set(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'",
          );
          return new Response(response.body, { status: response.status, headers });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      registerIpc(await loadRuntime());
      await createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow();
      });
    })
    .catch(() => {
      dialog.showErrorBox('tyde 启动失败', '请检查安装资源、运行配置和系统权限。');
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
