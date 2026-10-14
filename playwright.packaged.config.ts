import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'packaged.spec.ts',
  workers: 1,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: 'artifacts/packaged-results.json' }]],
  webServer: {
    command: 'node --env-file=apps/server/.env apps/server/dist/main.js',
    url: 'http://127.0.0.1:3000/api/v1/health/ready',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
