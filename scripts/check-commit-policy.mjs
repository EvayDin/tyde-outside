import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function decode(buffer) {
  try {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(buffer);
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return new TextDecoder('utf-16be', { fatal: true }).decode(buffer);
    }
    if (buffer.includes(0)) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

try {
  const args = process.argv.slice(2);
  const [mode, messageFile] = args;
  if (!((mode === 'staged' && args.length === 1) || (mode === 'commit-msg' && args.length === 2))) {
    fail('提交策略命令无效，请使用 staged 或 commit-msg 加提交说明文件。');
  }

  let root;
  const git = (...parameters) =>
    execFileSync('git', parameters, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  root = realpathSync(git('rev-parse', '--show-toplevel').toString().trimEnd());
  const policyFile = realpathSync(
    process.env.TYDE_COMMIT_POLICY_FILE ?? join(homedir(), '.config', 'tyde', 'commit-policy.json'),
  );
  const location = relative(root, policyFile);
  if (!isAbsolute(location) && location !== '..' && !location.startsWith(`..${sep}`)) {
    fail('提交策略配置必须位于仓库外部，已阻止提交。');
  }
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  if (
    !policy ||
    typeof policy !== 'object' ||
    Object.keys(policy).length !== 1 ||
    !Array.isArray(policy.terms) ||
    policy.terms.length === 0 ||
    policy.terms.some((term) => typeof term !== 'string' || !term.trim())
  ) {
    fail('提交策略配置无效，需要非空字符串规则列表，已阻止提交。');
  }
  const normalize = (text) => text.normalize('NFKC').toLowerCase();
  const terms = policy.terms.map((term) => normalize(term.trim()));
  const matches = (text) => terms.some((term) => normalize(text).includes(term));

  if (mode === 'commit-msg') {
    const message = decode(readFileSync(messageFile));
    if (message === null) fail('提交说明无法作为文本读取，已阻止提交。');
    if (matches(message)) fail('提交说明包含受限内容，已阻止提交。');
  } else {
    let binary = false;
    const entries = git('ls-files', '--stage', '-z').toString('utf8').split('\0').filter(Boolean);
    for (const entry of entries) {
      const tab = entry.indexOf('\t');
      const [mode, oid, stage] = entry.slice(0, tab).split(' ');
      if (stage !== '0' || !['100644', '100755', '120000'].includes(mode)) {
        fail('暂存区存在未合并文件或不支持的条目，已阻止提交。');
      }
      if (matches(entry.slice(tab + 1))) fail('暂存路径包含受限内容，已阻止提交。');
      const text = decode(git('cat-file', 'blob', oid));
      if (text === null) binary = true;
      else if (matches(text)) fail('暂存文本包含受限内容，已阻止提交。');
    }
    if (binary) {
      console.warn(
        '存在二进制暂存文件：仅自动检查其路径，正文仍需人工 OCR、元数据与来源核验，未完成自动全文检查。',
      );
    }
  }
} catch {
  fail('无法完成提交策略检查，请检查仓库状态及本机规则配置，已阻止提交。');
}
