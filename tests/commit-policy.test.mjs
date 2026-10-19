import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/check-commit-policy.mjs', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tyde-commit-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  const git = (...args) =>
    execFileSync('git', ['-c', `core.hooksPath=${join(directory, 'hooks')}`, ...args], {
      cwd: repo,
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  git('init', '--quiet');
  const policyFile = join(directory, 'policy.json');
  writeFileSync(policyFile, JSON.stringify({ terms: ['Moonstone'] }));
  const write = (name, value) => {
    const path = join(repo, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
    return path;
  };
  const run = (args = ['staged'], policy = policyFile) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: repo,
      env: { ...env, TYDE_COMMIT_POLICY_FILE: policy },
      encoding: 'utf8',
    });
  return { directory, repo, git, policyFile, write, run };
}

function rejected(result) {
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /moonstone/i);
}

test('检查暂存内容，不被工作区的清理掩盖', (t) => {
  const { git, write, run } = fixture(t);
  write('note.txt', 'MOONSTONE');
  git('add', 'note.txt');
  write('note.txt', 'public content');
  rejected(run());
  assert.equal(git('show', ':note.txt').toString(), 'MOONSTONE');
});

test('仅工作区命中时通过，且不修改工作区或索引', (t) => {
  const { git, write, run } = fixture(t);
  const path = write('note.txt', 'public content');
  git('add', 'note.txt');
  write('note.txt', 'Moonstone');
  const index = git('ls-files', '--stage', '-z');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path, 'utf8'), 'Moonstone');
  assert.deepEqual(git('ls-files', '--stage', '-z'), index);
  assert.equal(git('show', ':note.txt').toString(), 'public content');
});

test('允许删除已有命中内容，不读取旧版本', (t) => {
  const { git, write, run } = fixture(t);
  write('note.txt', 'Moonstone');
  git('add', 'note.txt');
  git(
    '-c',
    'user.name=Policy Test',
    '-c',
    'user.email=policy@example.test',
    'commit',
    '-qm',
    'baseline',
  );
  git('rm', '--quiet', 'note.txt');
  assert.equal(run().status, 0);
});

test('路径匹配不区分大小写，二进制也检查路径', (t) => {
  const { git, write, run } = fixture(t);
  write('MoOnStOnE.bin', Buffer.from([0, 255]));
  git('add', 'MoOnStOnE.bin');
  rejected(run());
});

test('检查提交说明，拒绝命中且不泄露术语', (t) => {
  const { directory, run } = fixture(t);
  const message = join(directory, 'message');
  writeFileSync(message, 'chore: MoOnStOnE');
  rejected(run(['commit-msg', message]));
  writeFileSync(message, 'chore: public update');
  assert.equal(run(['commit-msg', message]).status, 0);
});

test('缺失、损坏和空规则配置均阻止检查', (t) => {
  const { directory, policyFile, run } = fixture(t);
  rejected(run(['staged'], join(directory, 'missing.json')));
  for (const value of [
    '{"terms":["Moonstone"]',
    '{"terms":[]}',
    '{"terms":[""]}',
    '{"terms":[" "]}',
  ]) {
    writeFileSync(policyFile, value);
    rejected(run());
  }
});

test('拒绝放在仓库内部的策略配置', (t) => {
  const { write, run } = fixture(t);
  const policy = write('policy.json', JSON.stringify({ terms: ['Moonstone'] }));
  rejected(run(['staged'], policy));
});

test('二进制正文仅提示人工检查，带 BOM 的文本仍检查内容', (t) => {
  const { git, write, run } = fixture(t);
  write('image.bin', Buffer.from([0, 255, 1]));
  git('add', 'image.bin');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /人工 OCR、元数据与来源核验/);
  write('wide.txt', Buffer.concat([Buffer.from([255, 254]), Buffer.from('Moonstone', 'utf16le')]));
  git('add', 'wide.txt');
  rejected(run());
});
