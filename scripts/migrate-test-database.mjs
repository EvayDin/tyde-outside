import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// 只迁移已有本机专用测试库，不清表、不创建数据库、不读取开发库连接。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = parseEnv(readFileSync(resolve(root, 'apps/server/.env.test'), 'utf8'));
const url = new URL(env.DATABASE_URL);
if (
  env.APP_ENV !== 'test' ||
  env.TEST_DATABASE_RESET !== 'true' ||
  !['postgresql:', 'postgres:'].includes(url.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
  !decodeURIComponent(url.pathname).endsWith('_test')
)
  throw new Error('仅允许 .env.test 指定且允许清空的本机 _test 数据库');
console.info('迁移已有本机专用测试库；不会清表。昵称重复时迁移停止，须先人工核对。');
const result = spawnSync('pnpm', ['--filter', '@tyde/server', 'db:deploy'], {
  cwd: root,
  env: { ...process.env, ...env },
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  .replaceAll(env.DATABASE_URL, '[TEST_DATABASE_URL]')
  .replaceAll(decodeURIComponent(url.password) || '\0', '[REDACTED]');
process.stdout.write(output);
if (result.error) throw new Error(`无法运行迁移命令（${result.error.code}）`);
process.exitCode = result.status ?? 1;
