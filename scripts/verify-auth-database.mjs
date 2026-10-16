import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// 在本机终端执行；只创建新的独立测试库，保留该库用于检查测试结果。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = resolve(root, 'apps/server');
const testFile = resolve(server, '.env.test');
if (existsSync(testFile)) {
  throw new Error(
    '已有 apps/server/.env.test，拒绝覆盖。请检查现有专用测试库配置后按认证文档执行。',
  );
}
const source = parseEnv(readFileSync(resolve(server, '.env'), 'utf8'));
const sourceUrl = new URL(source.DATABASE_URL);
if (sourceUrl.protocol !== 'postgresql:' && sourceUrl.protocol !== 'postgres:')
  throw new Error('DATABASE_URL 必须是 PostgreSQL 地址');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(sourceUrl.hostname)) {
  throw new Error('此脚本只允许连接本机 PostgreSQL');
}
const testName = `tyde_auth_${Date.now()}_${randomBytes(4).toString('hex')}_test`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${testName}`;
const pgBin = process.env.PG_BIN ?? '/Applications/Postgres.app/Contents/Versions/latest/bin';
const pgEnv = {
  ...process.env,
  PGHOST: sourceUrl.hostname.replace(/^\[|\]$/g, ''),
  PGPORT: sourceUrl.port || '5432',
  PGUSER: decodeURIComponent(sourceUrl.username),
  PGPASSWORD: decodeURIComponent(sourceUrl.password),
  // 建测试库只依赖维护库；开发库可能尚未创建。
  PGDATABASE: 'postgres',
  PGCONNECT_TIMEOUT: '5',
};
function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .replaceAll(source.DATABASE_URL, '[DATABASE_URL]')
    .replaceAll(testUrl.href, '[TEST_DATABASE_URL]')
    .replaceAll(decodeURIComponent(sourceUrl.password) || '\0', '[REDACTED]');
  process.stdout.write(output);
  if (result.error) throw new Error(`无法运行 ${command}（${result.error.code}）`);
  if (result.status !== 0) throw new Error(`命令失败，退出码 ${result.status}；停止后续步骤`);
}
console.info(`准备创建独立测试库：${testName}（账号需要 CREATEDB 权限）`);
run(
  resolve(pgBin, 'psql'),
  ['-X', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${testName}";`],
  root,
  pgEnv,
);
const testEnv = {
  APP_ENV: 'test',
  DATABASE_URL: testUrl.href,
  CODE_HMAC_SECRET: randomBytes(32).toString('hex'),
  SMS_PROVIDER: 'mock',
  WEB_ORIGINS: 'http://127.0.0.1:5173',
  COOKIE_SECURE: 'false',
  LOG_LEVEL: 'silent',
  TEST_DATABASE_RESET: 'true',
};
writeFileSync(
  testFile,
  Object.entries(testEnv)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n',
  { mode: 0o600, flag: 'wx' },
);
console.info('已生成 apps/server/.env.test；后续清表仅针对刚创建的独立测试库。');
run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], server, { ...process.env, ...testEnv });
run('pnpm', ['test:integration'], root, { ...process.env, ...testEnv });
console.info(`认证数据库验证通过；已保留测试库 ${testName}。`);
