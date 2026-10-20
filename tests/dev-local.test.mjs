import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const database =
  'postgresql://fixture:fixture-password@database.invalid:5432/tyde_dev?schema=public';
const worker = String.raw`
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
const [job, owner] = process.argv.slice(2);
const record = (event, extra = {}) => appendFileSync(process.env.FIXTURE_EVENTS,
  JSON.stringify({ event, pid: process.pid, ...extra }) + '\n');
if (job === 'migrate') {
  record('migrate', { database: process.env.DATABASE_URL, host: process.env.HOST,
    port: process.env.PORT });
} else if (job === 'leaf') {
  process.once('SIGTERM', () => { record(owner + ':leaf-stop'); process.exit(0); });
  record(owner + ':leaf');
  setInterval(() => {}, 1000);
} else if (job === 'electron') {
  record('electron:start', { api: process.env.TYDE_API_BASE_URL,
    proxy: process.env.API_PROXY_TARGET });
  if (process.env.FIXTURE_ELECTRON_EXIT === '0') process.exit(0);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'leaf', 'electron'],
    { stdio: 'inherit', detached: process.platform !== 'win32' });
  process.once('SIGTERM', () => {
    record('electron:stop');
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  });
  child.once('exit', () => process.exit(0));
} else if (job === 'server') {
  record('server:start', { database: process.env.DATABASE_URL, host: process.env.HOST,
    port: process.env.PORT, webOrigins: process.env.WEB_ORIGINS,
    desktopOrigins: process.env.DESKTOP_ORIGINS, cookieSecure: process.env.COOKIE_SECURE });
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'leaf', 'server'],
    { stdio: 'inherit' });
  let ready = false;
  const server = createServer((request, response) => {
    if (request.url.endsWith('/live')) {
      response.writeHead(200).end(JSON.stringify({ status: 'ok', application: 'tyde' }));
    } else {
      response.writeHead(ready ? 200 : 503).end(JSON.stringify({
        status: ready ? 'ready' : 'unavailable' }));
    }
  });
  server.listen(Number(process.env.PORT), process.env.HOST, () => {
    setTimeout(() => { record('server:ready'); ready = true; }, 150);
  });
  process.once('SIGTERM', () => {
    record('server:stop');
    server.close(() => process.exit(0));
  });
}
`;

async function waitFor(check, message, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(30);
  }
  throw new Error(message);
}

async function listen(server) {
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  return server.address().port;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tyde-dev-local-'));
  const eventsFile = join(root, 'events.jsonl');
  const running = new Set();
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'apps/server'), { recursive: true });
  await copyFile(join(project, 'scripts/dev-local.mjs'), join(root, 'scripts/dev-local.mjs'));
  await writeFile(join(root, 'scripts/fixture-worker.mjs'), worker);
  await writeFile(
    join(root, 'scripts/postgres-local.mjs'),
    `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FIXTURE_EVENTS, JSON.stringify({ event: 'db:' + process.argv[2] }) + '\\n');
`,
  );
  await writeFile(
    join(root, 'scripts/setup-local.mjs'),
    `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FIXTURE_EVENTS, JSON.stringify({ event: 'setup' }) + '\\n');
`,
  );
  await writeFile(
    join(root, 'scripts/dev-electron.mjs'),
    `process.argv.splice(2, 0, 'electron'); await import('./fixture-worker.mjs');\n`,
  );
  await writeFile(
    join(root, 'apps/server/package.json'),
    JSON.stringify({
      private: true,
      scripts: {
        'db:deploy': 'node ../../scripts/fixture-worker.mjs migrate',
        dev: 'node ../../scripts/fixture-worker.mjs server',
      },
    }),
  );
  await writeFile(eventsFile, '');
  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise((accept) => portProbe.close(accept));
  const configure = (url = database, apiPort = port) =>
    writeFile(join(root, 'apps/server/.env'), `DATABASE_URL=${url}\nPORT=${apiPort}\n`);
  await configure();
  const events = async () =>
    (await readFile(eventsFile, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const launch = (extraEnv = {}) => {
    const child = spawn(process.execPath, ['scripts/dev-local.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        FIXTURE_EVENTS: eventsFile,
        DATABASE_URL: 'postgresql://shell:secret@127.0.0.1:5432/old_local',
        TYDE_API_BASE_URL: 'https://remote.invalid',
        API_PROXY_TARGET: 'https://remote.invalid',
        HOST: '0.0.0.0',
        PORT: '9999',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.add(child);
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const done = new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        running.delete(child);
        accept({ code, signal, output });
      });
    });
    const finish = async () => {
      let timer;
      try {
        return await Promise.race([
          done,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('本地启动脚本未退出：' + output)), 10_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    return { child, finish, output: () => output };
  };
  t.after(async () => {
    for (const child of running) child.kill('SIGTERM');
    await waitFor(() => running.size === 0, '清理本地启动测试进程超时', 5000).catch(() => {});
    for (const row of await events()) {
      if (!row.pid) continue;
      try {
        process.kill(row.pid, 'SIGKILL');
      } catch {
        /* fixture process already stopped */
      }
    }
    for (const child of running) child.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  });
  return { root, port, configure, events, eventsFile, launch };
}

test('local launcher requires a valid non-test database in .env before running commands', async (t) => {
  const local = await fixture(t);
  for (const url of [
    '',
    'invalid-database-url',
    'https://fixture:do-not-print@database.invalid/tyde_dev',
    'postgresql:///tyde_dev',
    'postgresql://fixture:do-not-print@database.invalid/',
    'postgresql://fixture:do-not-print@database.invalid/tyde_test',
    'postgresql://fixture:do-not-print@database.invalid/tyde_%74est',
  ]) {
    await local.configure(url);
    const result = await local.launch().finish();
    assert.equal(result.code, 1, result.output);
    assert.doesNotMatch(result.output, /do-not-print|postgresql:\/\//);
    assert.deepEqual(await local.events(), []);
  }
  await rm(join(local.root, 'apps/server/.env'));
  const missing = await local.launch().finish();
  assert.equal(missing.code, 1, missing.output);
  assert.match(missing.output, /apps\/server\/\.env/);
  assert.deepEqual(await local.events(), []);
});

test('local launcher uses the remote .env, skips database changes and cleans owned processes', async (t) => {
  const local = await fixture(t);
  const run = local.launch();
  await waitFor(async () => {
    const names = (await local.events()).map((row) => row.event);
    return ['server:leaf', 'electron:leaf'].every((name) => names.includes(name));
  }, 'Electron 未启动：' + run.output());
  const rows = await local.events();
  const names = rows.map((row) => row.event);
  for (const [before, after] of [
    ['server:start', 'server:ready'],
    ['server:ready', 'electron:start'],
  ])
    assert.ok(names.indexOf(before) < names.indexOf(after), names.join(', '));
  assert.ok(!names.some((name) => /^(db:|migrate$|setup$)/.test(name)), names.join(', '));
  const backend = rows.find((row) => row.event === 'server:start');
  assert.equal(backend.database, database);
  assert.equal(backend.host, '127.0.0.1');
  assert.equal(backend.port, String(local.port));
  assert.ok(backend.webOrigins.split(',').includes('http://localhost:3001'));
  assert.ok(backend.desktopOrigins.split(',').includes('http://127.0.0.1:5174'));
  assert.equal(backend.cookieSecure, 'false');
  assert.doesNotMatch(run.output(), /fixture-password|shell:secret|postgresql:\/\//);
  const electron = rows.find((row) => row.event === 'electron:start');
  assert.equal(electron.api, `http://127.0.0.1:${local.port}`);
  assert.equal(electron.proxy, electron.api);

  run.child.kill('SIGTERM');
  const result = await run.finish();
  assert.equal(result.code, 0, result.output);
  assert.ok(!(await local.events()).some((row) => row.event === 'db:stop'));
  for (const row of rows.filter((item) => /^(server|electron):(start|leaf)$/.test(item.event)))
    await waitFor(() => {
      try {
        process.kill(row.pid, 0);
        return false;
      } catch {
        return true;
      }
    }, `测试进程 ${row.pid} 未退出`);
});

test('a normal desktop exit preserves the owned backend until the launcher is stopped', async (t) => {
  const local = await fixture(t);
  const run = local.launch({ FIXTURE_ELECTRON_EXIT: '0' });
  await waitFor(
    async () =>
      run.output().includes('Electron 已退出或已在运行') &&
      (await local.events()).some((row) => row.event === 'server:leaf'),
    'Electron 正常退出后未保留后端：' + run.output(),
  );
  assert.equal(run.child.exitCode, null);
  const ready = await fetch(`http://127.0.0.1:${local.port}/api/v1/health/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
  const owned = (await local.events()).filter((row) => /^server:(start|leaf)$/.test(row.event));
  assert.equal(owned.length, 2);
  run.child.kill('SIGTERM');
  const result = await run.finish();
  assert.equal(result.code, 0, result.output);
  await waitFor(
    () =>
      owned.every((row) => {
        try {
          process.kill(row.pid, 0);
          return false;
        } catch {
          return true;
        }
      }),
    'Electron 已退出时，Ctrl+C 未清理本次后端及其子进程',
  );
  assert.ok(!(await local.events()).some((row) => row.event === 'db:stop'));
});

test('local launcher rejects every occupied backend port without changing the existing service', async (t) => {
  const local = await fixture(t);
  let identity = true;
  const server = createServer((request, response) => {
    response.end(
      JSON.stringify(
        request.url.endsWith('/live')
          ? { status: 'ok', application: identity ? 'tyde' : 'other' }
          : { status: 'ready' },
      ),
    );
  });
  const port = await listen(server);
  t.after(() => new Promise((accept) => server.close(accept)));
  await local.configure(database, port);
  for (identity of [true, false]) {
    const failure = await local.launch().finish();
    assert.equal(failure.code, 1, failure.output);
    assert.match(failure.output, /占用/);
    assert.match(failure.output, /停止/);
    assert.deepEqual(await local.events(), []);
    assert.ok((await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).ok);
  }
});
