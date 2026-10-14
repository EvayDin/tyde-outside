import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'auth.spec.ts',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node --env-file=apps/server/.env.test apps/server/dist/main.js',
      url: 'http://127.0.0.1:3100/api/v1/health/ready',
      env: {
        PORT: '3100',
        HOST: '127.0.0.1',
        WEB_ORIGINS: 'http://127.0.0.1:5175',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @tyde/web exec vite --host 127.0.0.1 --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3100' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
