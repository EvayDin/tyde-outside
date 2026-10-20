import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { postgresTool } from './lib/postgres-tools.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = resolve(root, 'apps/server');
if (existsSync(resolve(server, '.env')))
  throw new Error(
    '已有 apps/server/.env，保留现有配置。请直接运行 pnpm db:deploy；不自动覆盖账号或密码。',
  );
const psql = postgresTool('psql');
function sql(input) {
  const localSocket = resolve(root, '.local/postgres');
  const connection = existsSync(resolve(localSocket, 'PG_VERSION')) ? ['-h', localSocket] : [];
  const result = spawnSync(
    psql,
    ['-X', ...connection, '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-At'],
    { input, encoding: 'utf8' },
  );
  if (result.error || result.status)
    throw new Error(
      '本地 PostgreSQL 管理连接失败。请检查服务启动、系统账号权限和 Postgres.app 连接授信。未输出密码。',
    );
  return result.stdout.trim();
}
if (sql("SELECT count(*) FROM pg_roles WHERE rolname='tyde_outside_dev';") !== '0')
  throw new Error(
    'tyde_outside_dev 角色已存在，但无项目 .env；为保护现有凭据，请手工配置连接，不自动重置密码。',
  );
const password = randomBytes(24).toString('base64url');
const secret = randomBytes(32).toString('hex');
// password 为随机 base64url，不能由输入注入 SQL；不打印 SQL 或凭据。
sql(`CREATE ROLE tyde_outside_dev LOGIN PASSWORD '${password}';
SELECT 'CREATE DATABASE tyde_outside OWNER tyde_outside_dev' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='tyde_outside')\n\\gexec
SELECT 'CREATE DATABASE tyde_outside_test OWNER tyde_outside_dev' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='tyde_outside_test')\n\\gexec
`);
await mkdir(server, { recursive: true });
const common = `CODE_HMAC_SECRET=${secret}\nSMS_PROVIDER=mock\nWEB_ORIGINS=http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:4173\nDESKTOP_ORIGINS=tyde-app://app,http://127.0.0.1:5174\nCOOKIE_SECURE=false\nTRUST_PROXY=false\n`;
await writeFile(
  resolve(server, '.env'),
  `APP_ENV=development\nHOST=127.0.0.1\nPORT=3000\nDATABASE_URL=postgresql://tyde_outside_dev:${password}@127.0.0.1:5432/tyde_outside\n${common}`,
  { mode: 0o600, flag: 'wx' },
);
if (!existsSync(resolve(server, '.env.test')))
  await writeFile(
    resolve(server, '.env.test'),
    `APP_ENV=test\nDATABASE_URL=postgresql://tyde_outside_dev:${password}@127.0.0.1:5432/tyde_outside_test\nTEST_DATABASE_RESET=true\n${common}`,
    { mode: 0o600, flag: 'wx' },
  );
console.info(
  '开发 / 测试数据库和本地配置已创建；凭据只写入被 git 忽略的 .env 文件。下一步：pnpm db:deploy',
);
