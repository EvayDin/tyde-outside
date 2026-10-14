import { lstat, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const version = String.raw`\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?`;
const product = String.raw`tyde(?:-outside)?(?:-test)?`;
const desktopMetadata = new Set([
  'SHA256SUMS.txt',
  'TRIAL_MANIFEST.json',
  'builder-debug.yml',
  'builder-effective-config.yaml',
]);

function matches(kind, name) {
  if (kind === 'web' || kind === 'server')
    return new RegExp(
      String.raw`^tyde(?:-outside)?-${kind}-${version}(?:\.tar\.gz(?:\.sha256)?)?$`,
    ).test(name);

  if (desktopMetadata.has(name)) return true;
  if (kind === 'mac')
    return (
      new RegExp(
        String.raw`^${product}-${version}-mac-(?:universal|arm64|x64)(?:\.(?:dmg|zip)(?:\.blockmap)?)?$`,
      ).test(name) ||
      /^mac(?:-(?:universal|arm64|x64)(?:-(?:arm64|x64)-temp)?)?$/.test(name) ||
      name === 'latest-mac.yml'
    );

  return (
    new RegExp(
      String.raw`^${product}-${version}-win-(?:x64|arm64|ia32)(?:\.(?:exe|zip)(?:\.blockmap)?)?$`,
    ).test(name) ||
    /^win(?:-(?:x64|arm64|ia32))?-unpacked$/.test(name) ||
    name === 'latest.yml'
  );
}

// Only known generated names in the selected output directory are eligible.
// Never recursively clear release/ or artifacts/: both contain other deliverables.
export async function cleanPackageArtifacts(kind, projectRoot) {
  if (!['mac', 'win', 'web', 'server'].includes(kind))
    throw new Error('打包类型必须为 mac、win、web 或 server');
  const directory = resolve(
    projectRoot,
    kind === 'mac' || kind === 'win' ? 'release' : 'artifacts',
  );
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`拒绝清理非普通目录：${directory}`);

  const names = (await readdir(directory)).filter((name) => matches(kind, name)).sort();
  for (const name of names) await rm(resolve(directory, name), { recursive: true, force: true });
  console.info(`已清理 ${kind} 旧打包产物：${names.length} 项`);
  return names;
}
