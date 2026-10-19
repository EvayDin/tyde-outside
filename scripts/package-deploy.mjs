import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cleanPackageArtifacts } from './lib/package-artifacts.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kind = process.argv[2];
if (!['web', 'server'].includes(kind)) throw new Error('请输入 web 或 server');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const target = resolve(root, `artifacts/tyde-${kind}-${pkg.version}`);
await cleanPackageArtifacts(kind, root);
await mkdir(target, { recursive: true });
async function copy(from, to = from) {
  await cp(resolve(root, from), resolve(target, to), { recursive: true });
}
if (kind === 'web') {
  await copy('apps/web/dist', 'web');
  await copy('deploy/nginx.conf.example', 'nginx.conf.example');
} else {
  try {
    await access(resolve(root, 'pnpm-lock.yaml'));
  } catch {
    throw new Error(
      '缺少真实 pnpm-lock.yaml，请先完成 pnpm install；不能生成未锁定依赖的后端交付包',
    );
  }
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.nvmrc',
    'scripts/install-hooks.mjs',
    'apps/server/package.json',
    'apps/server/dist',
    'apps/server/prisma',
    'apps/server/.env.example',
    'packages/shared/package.json',
    'packages/shared/dist',
    'packages/config/package.json',
    'deploy',
  ])
    await copy(path);
}
await copy('docs/DEPLOY_TEST.md', 'DEPLOY_TEST.md');
await copy('docs/VERIFICATION.md', 'VERIFICATION.md');
await writeFile(
  resolve(target, 'manifest.json'),
  JSON.stringify(
    {
      application: pkg.name,
      version: pkg.version,
      kind,
      builtAt: new Date().toISOString(),
      node: process.version,
      dependencies:
        kind === 'server'
          ? 'Install on target OS and generate Prisma client; node_modules intentionally excluded'
          : 'static assets',
      verification: 'See VERIFICATION.md for actual executed checks',
    },
    null,
    2,
  ),
);
const archive = `${target}.tar.gz`;
const result = spawnSync(
  'tar',
  ['-czf', archive, '-C', dirname(target), target.split(/[\\/]/).at(-1)],
  { stdio: 'inherit' },
);
if (result.error || result.status) throw result.error ?? new Error('压缩失败');
const hash = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(`${archive}.sha256`, `${hash}  ${archive.split(/[\\/]/).at(-1)}\n`);
console.info('交付包:', archive);
