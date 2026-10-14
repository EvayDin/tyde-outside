import { readdir, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const dir = resolve(process.argv[2] ?? 'release');
const names = (await readdir(dir)).filter((x) => /\.(dmg|exe|zip|tar\.gz)$/.test(x)).sort();
if (!names.length) throw new Error('没有找到交付包');
const rows = [];
for (const name of names)
  rows.push(
    `${createHash('sha256')
      .update(await readFile(resolve(dir, name)))
      .digest('hex')}  ${name}`,
  );
await writeFile(resolve(dir, 'SHA256SUMS.txt'), rows.join('\n') + '\n');
await cp(new URL('../docs/INSTALL_TRIAL.md', import.meta.url), resolve(dir, 'INSTALL_TRIAL.md'));
const packages = [];
for (const name of names) {
  const runtimePath = name.includes('-mac-')
    ? 'mac-universal/tyde-outside.app/Contents/Resources/runtime.json'
    : name.includes('-win-')
      ? 'win-unpacked/resources/runtime.json'
      : undefined;
  let runtime;
  if (runtimePath) {
    try {
      runtime = JSON.parse(await readFile(resolve(dir, runtimePath), 'utf8'));
    } catch {
      /* unpacked build not available */
    }
  }
  packages.push({ file: name, ...(runtime ? { runtime } : {}) });
}
await writeFile(
  resolve(dir, 'TRIAL_MANIFEST.json'),
  JSON.stringify(
    {
      application: 'tyde-outside',
      packages,
      note: 'development + loopback API means local trial only; remote testers need a reachable backend and a test-environment build',
      verification:
        'See source docs/VERIFICATION.md; Windows and Mac Intel device installation remains a separate check',
    },
    null,
    2,
  ) + '\n',
);
console.info(rows.join('\n'));
