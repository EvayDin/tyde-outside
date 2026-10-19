import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'tyde-git-hooks-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'repository');
  await mkdir(root);
  const policy = join(root, 'commit-policy.json');
  await writeFile(policy, JSON.stringify({ terms: ['fixture-block-token'] }));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
  );
  delete env.CI;
  delete env.NODE_ENV;
  delete env.HUSKY;
  delete env.TYDE_COMMIT_POLICY_FILE;
  Object.assign(env, {
    PATH: dirname(process.execPath) + delimiter + (env.PATH ?? ''),
    XDG_CONFIG_HOME: join(temporary, 'config'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(temporary, 'gitconfig'),
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
    PNPM_CONFIG_PM_ON_FAIL: 'ignore',
  });
  const run = (command, args, extraEnv = {}) => {
    const result = spawnSync(command, args, {
      cwd: root,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
      timeout: 60_000,
      shell: process.platform === 'win32' && command === 'pnpm',
    });
    assert.ifError(result.error);
    return { ...result, output: result.stdout + result.stderr };
  };
  const pass = (result) => {
    assert.equal(result.status, 0, result.output);
    return result.stdout.trim();
  };
  const git = (...args) => run('git', args);
  pass(git('init', '--initial-branch=main'));
  pass(git('config', 'user.name', 'Hook Fixture'));
  pass(git('config', 'user.email', 'fixture@example.invalid'));
  pass(git('config', 'commit.gpgSign', 'false'));
  const copy = async (file) => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(project, file), join(root, file));
  };
  const write = (file, content) => writeFile(join(root, file), content);
  const read = (file) => readFile(join(root, file), 'utf8');
  const staged = (file) => {
    const result = git('show', ':' + file);
    pass(result);
    return result.stdout;
  };
  return { root, run, pass, git, copy, write, read, staged };
}

test('real Husky hooks check staged content without changing partial staging and reject messages', async (t) => {
  const { root, run, pass, git, copy, write, read, staged } = await fixture(t);
  for (const file of [
    'package.json',
    'pnpm-workspace.yaml',
    '.gitignore',
    '.prettierrc.json',
    '.prettierignore',
    'eslint.config.mjs',
    'packages/config/eslint/index.mjs',
    'scripts/install-hooks.mjs',
    'scripts/check-commit-policy.mjs',
    '.husky/pre-commit',
    '.husky/commit-msg',
  ]) {
    await copy(file);
  }
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'), 'junction');
  pass(run('pnpm', ['run', 'prepare']));
  assert.equal(pass(git('config', '--local', '--get', 'core.hooksPath')), '.husky/_');
  assert.equal(pass(git('check-ignore', '--', 'commit-policy.json')), 'commit-policy.json');
  assert.equal(pass(git('ls-files', '--', 'commit-policy.json')), '');

  const code = 'sample file.js';
  const initial = 'export const count = 1;\n';
  await write(code, initial);
  pass(git('add', '--', code));
  pass(git('commit', '-m', 'test: valid fixture'));
  const initialHead = pass(git('rev-parse', 'HEAD'));

  const bad = 'export const count = missingValue;\n';
  const workingGood = 'export const count = 2;\n';
  await write(code, bad);
  pass(git('add', '--', code));
  await write(code, workingGood);
  const badCode = git('commit', '-m', 'test: reject staged error');
  assert.notEqual(badCode.status, 0, badCode.output);
  assert.match(badCode.output, /no-undef/);
  assert.equal(pass(git('rev-parse', 'HEAD')), initialHead);
  assert.equal(staged(code), bad);
  assert.equal(await read(code), workingGood);

  const stagedGood = 'export const count = 3;\n';
  await write(code, stagedGood);
  pass(git('add', '--', code));
  await write(code, bad);
  pass(git('commit', '-m', 'test: staged content only'));
  assert.equal(git('show', 'HEAD:' + code).stdout, stagedGood);
  assert.equal(staged(code), stagedGood);
  assert.equal(await read(code), bad);
  const checkedHead = pass(git('rev-parse', 'HEAD'));

  const document = 'notes with spaces.md';
  const unformatted = '# Fixture\n\n-   item\n';
  await write(document, unformatted);
  pass(git('add', '--', document));
  const badFormat = git('commit', '-m', 'test: reject unformatted document');
  assert.notEqual(badFormat.status, 0, badFormat.output);
  assert.match(badFormat.output, /prettier|formatting/i);
  assert.equal(pass(git('rev-parse', 'HEAD')), checkedHead);
  assert.equal(staged(document), unformatted);
  assert.equal(await read(document), unformatted);
  assert.equal(staged(code), stagedGood);
  assert.equal(await read(code), bad);

  const formatted = '# Fixture\n\n- item\n';
  await write(document, formatted);
  pass(git('add', '--', document));
  const badMessage = git('commit', '-m', 'test: FIXTURE-BLOCK-TOKEN');
  assert.notEqual(badMessage.status, 0, badMessage.output);
  assert.match(badMessage.output, /提交说明包含受限内容/);
  assert.equal(pass(git('rev-parse', 'HEAD')), checkedHead);
  assert.equal(staged(document), formatted);
  assert.equal(await read(document), formatted);
  assert.equal(await read(code), bad);
  pass(git('commit', '-m', 'test: formatted document with spaces'));
  assert.equal(git('show', 'HEAD:' + document).stdout, formatted);
  assert.equal(staged(code), stagedGood);
  assert.equal(await read(code), bad);

  await rm(join(root, 'commit-policy.json'));
  const withoutPolicy = '# Fixture\n\n- local rules are optional\n';
  await write(document, withoutPolicy);
  pass(git('add', '--', document));
  pass(git('commit', '-m', 'test: FIXTURE-BLOCK-TOKEN without local policy'));
  assert.equal(git('show', 'HEAD:' + document).stdout, withoutPolicy);
  assert.equal(staged(code), stagedGood);
  assert.equal(await read(code), bad);
});

test('hook installer skips CI and production without development dependencies', async (t) => {
  const { run, pass, git, copy } = await fixture(t);
  await copy('scripts/install-hooks.mjs');
  for (const extraEnv of [{ CI: 'true' }, { NODE_ENV: 'production' }]) {
    pass(run(process.execPath, ['scripts/install-hooks.mjs'], extraEnv));
    assert.equal(git('config', '--local', '--get', 'core.hooksPath').status, 1);
  }
});
