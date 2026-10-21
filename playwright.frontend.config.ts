import { defineConfig } from '@playwright/test';

/** 认证页回归使用 Web 路由拦截与隔离桌面接口，不依赖业务后端或数据库。 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['frontend.spec.ts', 'profile.spec.ts'],
  workers: 1,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: 'artifacts/frontend-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command:
        'pnpm --filter @tyde/web exec vite preview --host 127.0.0.1 --port 5176 --strictPort',
      url: 'http://127.0.0.1:5176',
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @tyde/web exec vite --host 127.0.0.1 --port 5177 --strictPort',
      url: 'http://127.0.0.1:5177',
      reuseExistingServer: false,
    },
  ],
});
