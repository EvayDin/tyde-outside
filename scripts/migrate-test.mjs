import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const server = fileURLToPath(new URL('../apps/server/', import.meta.url));
const testEnv = parseEnv(
  readFileSync(new URL('../apps/server/.env.test', import.meta.url), 'utf8'),
);
if (
  testEnv.APP_ENV !== 'test' ||
  !new URL(testEnv.DATABASE_URL).pathname.endsWith('_test') ||
  testEnv.TEST_DATABASE_RESET !== 'true'
)
  throw new Error('仅可迁移已明确允许重置的专用_test数据库；本命令不清库。');
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../apps/server/node_modules/prisma/build/index.js', import.meta.url)),
    'migrate',
    'deploy',
  ],
  { cwd: server, env: { ...process.env, ...testEnv }, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
