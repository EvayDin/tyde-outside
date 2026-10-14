import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

test('打包后的桌面从本地资源加载同一 React 页面，安全配置与 API 桥接正常', async () => {
  const executablePath =
    process.platform === 'darwin'
      ? resolve('release/mac-universal/tyde.app/Contents/MacOS/tyde')
      : resolve('release/win-unpacked/tyde.exe');
  if (!existsSync(executablePath))
    throw new Error('请先构建当前系统的安装包。此检查默认需要连接本机后端的试用包。');
  const app = await electron.launch({ executablePath, args: [] });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.wordmark')).toContainText('tyde');
    await expect(page).toHaveURL(/^tyde-app:\/\/app\/index\.html/);
    const health = await page.evaluate(() => window.tydeDesktop!.health());
    expect(health).toEqual({ ok: true, data: { status: 'ready' } });
    const state = await page.evaluate(() => window.tydeDesktop!.getCurrentUser());
    expect(state.ok || state.status === 401).toBe(true);
    expect(JSON.stringify(state)).not.toContain('sessionToken');
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences();
      return {
        contextIsolation: p.contextIsolation,
        sandbox: p.sandbox,
        nodeIntegration: p.nodeIntegration,
      };
    });
    expect(preferences).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false });
    await page.reload();
    await expect(page.locator('.wordmark')).toContainText('tyde');
    await mkdir('artifacts/screenshots', { recursive: true });
    await page.screenshot({ path: 'artifacts/screenshots/packaged-desktop.png' });
  } finally {
    await app.close();
  }
});
