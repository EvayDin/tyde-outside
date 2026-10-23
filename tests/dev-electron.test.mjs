import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const worker = String.raw`
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
const job = process.argv[2];
const record = (event) => appendFileSync(process.env.FIXTURE_EVENTS,
  JSON.stringify({ event, pid: process.pid, memory: process.env.TYDE_MEMORY_DIAGNOSTICS }) + '\n');
if (job === 'electron') {
  record('electron:start');
  process.exit(Number(process.env.FIXTURE_ELECTRON_EXIT));
} else {
  const server = createServer((request, response) => {
    response.setHeader('X-Tyde-Dev-Server', 'web');
    response.end('fixture web');
  });
  server.listen(Number(process.env.FIXTURE_WEB_PORT), '127.0.0.1', () => record('web:start'));
  process.once('SIGTERM', () => {
    record('web:stop');
    server.close(() => process.exit(0));
  });
}
`;

async function waitFor(check, message) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
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

async function expectOwnedWebStopped(local) {
  const web = (await local.events()).find((row) => row.event === 'web:start');
  assert.ok(web, '未启动本次页面服务');
  await waitFor(() => {
    try {
      process.kill(web.pid, 0);
      return false;
    } catch {
      return true;
    }
  }, '未清理本次页面进程');
  await assert.rejects(fetch(local.url));
}

async function fixture(t, external) {
  const root = await mkdtemp(join(tmpdir(), 'tyde-dev-electron-'));
  const eventsFile = join(root, 'events.jsonl');
  const portProbe = external ?? createServer();
  const port = await listen(portProbe);
  if (!external) await new Promise((accept) => portProbe.close(accept));
  const url = `http://127.0.0.1:${port}/`;
  await mkdir(join(root, 'scripts'));
  for (const app of ['web', 'electron']) {
    await mkdir(join(root, 'apps', app), { recursive: true });
    await writeFile(
      join(root, 'apps', app, 'package.json'),
      JSON.stringify({
        private: true,
        scripts: { dev: `node ../../scripts/fixture-worker.mjs ${app}` },
      }),
    );
  }
  await symlink(
    join(project, 'apps/web/node_modules'),
    join(root, 'apps/web/node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await writeFile(
    join(root, 'scripts/dev-electron.mjs'),
    (await readFile(join(project, 'scripts/dev-electron.mjs'), 'utf8')).replace(
      'http://127.0.0.1:5174/',
      url,
    ),
  );
  await writeFile(join(root, 'scripts/fixture-worker.mjs'), worker);
  await writeFile(eventsFile, '');
  let child;
  let done;
  let output = '';
  const events = async () =>
    (await readFile(eventsFile, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  t.after(async () => {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (done) await done;
    for (const row of await events()) {
      try {
        process.kill(row.pid, 'SIGKILL');
      } catch {
        /* fixture process already stopped */
      }
    }
    if (external) await new Promise((accept) => external.close(accept));
    await rm(root, { recursive: true, force: true });
  });
  return {
    url,
    events,
    launch(exitCode, args = []) {
      child = spawn(process.execPath, ['scripts/dev-electron.mjs', ...args], {
        cwd: root,
        env: {
          ...process.env,
          FIXTURE_EVENTS: eventsFile,
          FIXTURE_WEB_PORT: String(port),
          FIXTURE_ELECTRON_EXIT: String(exitCode),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      done = new Promise((accept, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => accept({ code, signal, output }));
      });
      return {
        child,
        output: () => output,
        async finish() {
          await waitFor(
            () => child.exitCode !== null || child.signalCode !== null,
            'Electron 启动脚本未退出：' + output,
          );
          return done;
        },
      };
    },
  };
}

test('a normal desktop exit keeps its web service until the launcher is stopped', async (t) => {
  const local = await fixture(t);
  const run = local.launch(0);
  await waitFor(
    () => run.output().includes('Electron 已退出或已在运行'),
    'Electron 正常退出后未保留页面服务',
  );
  assert.equal(run.child.exitCode, null);
  assert.equal(await (await fetch(local.url)).text(), 'fixture web');
  run.child.kill('SIGINT');
  const result = await run.finish();
  assert.equal(result.code, 0, result.output);
  await expectOwnedWebStopped(local);
});

test('a failed desktop start stops its owned web service', async (t) => {
  const local = await fixture(t);
  const result = await local.launch(1).finish();
  assert.equal(result.code, 1, result.output);
  await expectOwnedWebStopped(local);
});

test('reusing a web service leaves it running after the second desktop exits', async (t) => {
  const external = createServer((request, response) => {
    response.setHeader('X-Tyde-Dev-Server', 'web');
    response.end('existing web');
  });
  const local = await fixture(t, external);
  const result = await local.launch(0).finish();
  assert.equal(result.code, 0, result.output);
  assert.equal(await (await fetch(local.url)).text(), 'existing web');
  assert.deepEqual(
    (await local.events()).map((row) => row.event),
    ['electron:start'],
  );
});

test('the memory flag reaches the desktop process without enabling inspector', async (t) => {
  const external = createServer((request, response) => {
    response.setHeader('X-Tyde-Dev-Server', 'web');
    response.end('existing web');
  });
  const local = await fixture(t, external);
  const result = await local.launch(0, ['--memory']).finish();
  assert.equal(result.code, 0, result.output);
  const desktop = (await local.events()).find((row) => row.event === 'electron:start');
  assert.equal(desktop?.memory, '1');
});
