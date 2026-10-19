import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export function postgresTool(name) {
  const setting =
    name === 'psql' && process.env.PSQL_BIN !== undefined
      ? 'PSQL_BIN'
      : process.env.PG_BIN !== undefined
        ? 'PG_BIN'
        : undefined;
  const value = setting ? process.env[setting] : undefined;
  const invalid = () => new Error(`${setting} 配置无效，无法运行 ${name}。`);
  if (setting && !value.trim()) throw invalid();
  const candidates = setting
    ? [setting === 'PG_BIN' ? join(value, name) : value]
    : [
        join('/Applications/Postgres.app/Contents/Versions/latest/bin', name),
        join('/opt/homebrew/opt/postgresql@18/bin', name),
        join('/usr/local/opt/postgresql@18/bin', name),
        name,
      ];
  for (const command of candidates) {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
    if (!result.error && result.status === 0) return command;
  }
  if (setting) throw invalid();
  throw new Error(`未找到 ${name}，请安装 PostgreSQL 或设置 PG_BIN / PSQL_BIN。`);
}
