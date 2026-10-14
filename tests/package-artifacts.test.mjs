import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanPackageArtifacts } from '../scripts/lib/package-artifacts.mjs';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'tyde-package-clean-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'release'));
  await mkdir(join(root, 'artifacts'));
  return root;
}

async function files(directory, names) {
  for (const name of names) await writeFile(join(directory, name), name);
}

test('Mac cleanup removes old and renamed packages, test bundles and temporary apps only', async (t) => {
  const root = await workspace(t);
  const release = join(root, 'release');
  const removed = [
    'tyde-outside-0.1.0-mac-universal.dmg',
    'tyde-outside-0.1.0-mac-universal.dmg.blockmap',
    'tyde-0.2.0-beta.1-mac-arm64.zip',
    'SHA256SUMS.txt',
    'TRIAL_MANIFEST.json',
    'builder-debug.yml',
    'latest-mac.yml',
  ];
  const kept = ['tyde-0.1.0-win-x64.exe', 'latest.yml', 'notes.md', 'INSTALL_TRIAL.md'];
  await files(release, [...removed, ...kept]);
  for (const name of ['mac-universal', 'mac-universal-x64-temp', 'tyde-test-0.1.0-mac-universal']) {
    await mkdir(join(release, name));
    await files(join(release, name), ['nested-file']);
    removed.push(name);
  }
  await mkdir(join(release, 'win-unpacked'));
  kept.push('win-unpacked');
  await files(join(root, 'artifacts'), ['mac-test-package-verification.json']);
  assert.deepEqual(await cleanPackageArtifacts('mac', root), removed.sort());
  assert.deepEqual((await readdir(release)).sort(), kept.sort());
  assert.equal(
    await readFile(join(root, 'artifacts', 'mac-test-package-verification.json'), 'utf8'),
    'mac-test-package-verification.json',
  );
  assert.deepEqual(await cleanPackageArtifacts('mac', root), []);
});

test('Windows cleanup preserves Mac installers and removes Windows versions and unpacked app', async (t) => {
  const root = await workspace(t);
  const release = join(root, 'release');
  await files(release, [
    'tyde-outside-0.1.0-win-x64.exe',
    'tyde-0.2.0-win-x64.exe.blockmap',
    'latest.yml',
    'tyde-0.2.0-mac-universal.dmg',
    'latest-mac.yml',
  ]);
  await mkdir(join(release, 'win-unpacked'));
  await cleanPackageArtifacts('win', root);
  assert.deepEqual((await readdir(release)).sort(), [
    'latest-mac.yml',
    'tyde-0.2.0-mac-universal.dmg',
  ]);
});

for (const kind of ['web', 'server']) {
  test(`${kind} cleanup removes all owned versions but preserves other delivery types and reports`, async (t) => {
    const root = await workspace(t);
    const artifacts = join(root, 'artifacts');
    const other = kind === 'web' ? 'server' : 'web';
    await files(artifacts, [
      `tyde-outside-${kind}-0.1.0.tar.gz`,
      `tyde-outside-${kind}-0.1.0.tar.gz.sha256`,
      `tyde-${kind}-0.2.0.tar.gz`,
      `tyde-${other}-0.2.0.tar.gz`,
      'local-verification.json',
      'e2e-results.json',
    ]);
    await mkdir(join(artifacts, `tyde-${kind}-0.2.0`));
    await mkdir(join(artifacts, 'screenshots'));
    await files(join(root, 'release'), ['tyde-0.2.0-mac-universal.dmg']);
    await cleanPackageArtifacts(kind, root);
    assert.deepEqual((await readdir(artifacts)).sort(), [
      'e2e-results.json',
      'local-verification.json',
      'screenshots',
      `tyde-${other}-0.2.0.tar.gz`,
    ]);
    assert.deepEqual(await readdir(join(root, 'release')), ['tyde-0.2.0-mac-universal.dmg']);
  });
}

test('cleanup rejects invalid targets and output-directory symlinks without deleting their contents', async (t) => {
  const root = await workspace(t);
  await assert.rejects(cleanPackageArtifacts('../', root), /打包类型/);
  const external = join(root, 'external');
  await mkdir(external);
  await files(external, ['tyde-0.1.0-mac-universal.dmg']);
  await rm(join(root, 'release'), { recursive: true });
  await symlink(external, join(root, 'release'), 'junction');
  await assert.rejects(cleanPackageArtifacts('mac', root), /拒绝清理/);
  assert.deepEqual(await readdir(external), ['tyde-0.1.0-mac-universal.dmg']);
});

test('a matched symlink is removed without following it; absent output directories are allowed', async (t) => {
  const root = await workspace(t);
  const external = join(root, 'external');
  await mkdir(external);
  await files(external, ['preserved.txt']);
  await symlink(external, join(root, 'release', 'tyde-test-0.1.0-mac-universal'), 'junction');
  await cleanPackageArtifacts('mac', root);
  assert.deepEqual(await readdir(external), ['preserved.txt']);
  await rm(join(root, 'release'), { recursive: true });
  assert.deepEqual(await cleanPackageArtifacts('mac', root), []);
});
