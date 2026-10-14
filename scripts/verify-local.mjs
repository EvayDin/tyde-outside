import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rows = [];
await mkdir(resolve(root, 'artifacts'), { recursive: true });
function run(label, command, args, cwd = root) {
  console.info(`\n[验证] ${label}`);
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  rows.push({
    label,
    status: result.status === 0 ? 'passed' : 'failed',
    durationMs: Date.now() - start,
  });
  return result.status === 0;
}
let ok = true;
const steps = [
  ['安装锁定依赖', 'pnpm', ['install', '--frozen-lockfile']],
  ['核心安全测试', 'pnpm', ['test:core']],
  ['全量类型检查', 'pnpm', ['typecheck']],
  ['Lint', 'pnpm', ['lint']],
  ['格式检查', 'pnpm', ['format:check']],
  ['单元测试', 'pnpm', ['test']],
  ['开发数据库迁移', 'pnpm', ['db:deploy']],
  [
    '测试数据库迁移',
    process.execPath,
    ['--env-file=.env.test', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    resolve(root, 'apps/server'),
  ],
  ['PostgreSQL 集成测试', 'pnpm', ['test:integration']],
  ['后端构建', 'pnpm', ['build:server']],
  ['共享前端与 Electron 构建', 'pnpm', ['build:electron']],
  ['浏览器与 Electron 自动化', 'pnpm', ['test:e2e']],
  ['Web 部署包', 'pnpm', ['package:web']],
  ['后端部署包', 'pnpm', ['package:server']],
];
let startAt = 0;
if (process.argv.includes('--resume')) {
  try {
    const previous = JSON.parse(
      await readFile(resolve(root, 'artifacts/local-verification.json'), 'utf8'),
    );
    const failed = previous.checks.findIndex((row) => row.status === 'failed');
    if (failed >= 0 && steps[failed]?.[0] === previous.checks[failed].label) {
      startAt = failed;
      rows.push(...previous.checks.slice(0, failed));
      console.info('从上次失败步骤继续，之前通过项沿用原记录。');
    }
  } catch {
    /* first run */
  }
}
for (const [label, command, args, cwd] of steps.slice(startAt)) {
  if (!run(label, command, args, cwd)) {
    ok = false;
    break;
  }
}
await writeFile(
  resolve(root, 'artifacts/local-verification.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      result: ok ? 'passed' : 'failed',
      checks: rows,
    },
    null,
    2,
  ),
);
console.info('\n结果已写入 artifacts/local-verification.json；实际安装包验收与远程部署另行执行。');
process.exitCode = ok ? 0 : 1;
