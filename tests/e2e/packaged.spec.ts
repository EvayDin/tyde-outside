import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

test('打包后的桌面从本地资源加载同一 React 页面，安全配置与页面 API 请求正常', async () => {
  const executablePath =
    process.platform === 'darwin'
      ? resolve('release/mac-universal/tyde.app/Contents/MacOS/tyde')
      : resolve('release/win-unpacked/tyde.exe');
  if (!existsSync(executablePath))
    throw new Error('请先构建当前系统的安装包。此检查默认需要连接本机后端的试用包。');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args: [], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('banner')).toContainText('Tyde');
    await expect(page).toHaveURL(/^tyde-app:\/\/app\/index\.html/);
    const runtime = await page.evaluate(() => window.tydeDesktop!.getRuntimeConfig());
    if (!runtime.ok) throw new Error(runtime.error.message);
    expect(runtime.data.apiBaseUrl).toBe(new URL(runtime.data.apiBaseUrl).origin);
    expect(new URL(runtime.data.apiBaseUrl).protocol).toMatch(/^https?:$/);
    expect(await page.evaluate(() => Object.keys(window.tydeDesktop!))).toEqual([
      'getRuntimeConfig',
    ]);
    const health = await page.evaluate(async (apiBaseUrl) => {
      const response = await fetch(apiBaseUrl + '/api/v1/health/ready', { credentials: 'include' });
      return { status: response.status, data: await response.json() };
    }, runtime.data.apiBaseUrl);
    expect(health).toEqual({ status: 200, data: { status: 'ready' } });
    const state = await page.evaluate(async (apiBaseUrl) => {
      const response = await fetch(apiBaseUrl + '/api/v1/users/me', { credentials: 'include' });
      const payload = await response.json();
      return { status: response.status, data: payload.data };
    }, runtime.data.apiBaseUrl);
    expect([200, 401]).toContain(state.status);
    expect(JSON.stringify(state)).not.toMatch(/accessToken|refreshToken/);
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
    await expect(page.getByRole('banner')).toContainText('Tyde');
    await mkdir('artifacts/screenshots', { recursive: true });
    await page.screenshot({ path: 'artifacts/screenshots/packaged-desktop.png' });
  } finally {
    await app.close();
  }
});
