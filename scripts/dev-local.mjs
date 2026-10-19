import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, 'apps/server/.env');
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === 'win32')
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else {
      try {
        // Electron 的 wrapper 收到信号后负责清理其独立的页面和桌面进程组。
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* process already exited */
      }
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());

function start(command, args, env = process.env, watch = false) {
  if (stopping) return;
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32' && command === 'npm',
  });
  children.add(child);
  child.once('error', () => {
    children.delete(child);
    if (watch && !stopping) {
      console.error('开发进程启动失败，请检查 Node.js、npm 和依赖安装。');
      stop(1);
    }
  });
  child.once('exit', (code) => {
    children.delete(child);
    if (watch && !stopping) {
      if (watch === 'desktop' && code === 0)
        console.info('[本地启动] Electron 已退出或已在运行；本次后端保留，Ctrl+C 停止。');
      else stop(code ?? 1);
    }
  });
  return child;
}

async function run(command, args, env) {
  if (stopping) throw new Error('启动已取消');
  await new Promise((accept, reject) => {
    const child = start(command, args, env);
    child.once('error', () => reject(new Error('启动命令不可用，请检查开发环境。')));
    child.once('exit', (code) =>
      code === 0 ? accept() : reject(new Error('启动步骤失败，请查看上方错误。')),
    );
  });
}

function localConfig() {
  const config = parseEnv(readFileSync(envFile, 'utf8'));
  let database;
  try {
    database = new URL(config.DATABASE_URL);
  } catch {
    throw new Error('请在 apps/server/.env 配置本地 DATABASE_URL。');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
    (database.port && database.port !== '5432') ||
    !database.pathname.slice(1) ||
    /_test$/i.test(decodeURIComponent(database.pathname)) ||
    [...database.searchParams.keys()].some((key) => key !== 'schema') ||
    database.hash
  )
    throw new Error(
      'dev:local 仅使用本机 5432 开发库；请检查 apps/server/.env，勿使用远程或测试库。',
    );
  const port = Number(config.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('apps/server/.env 的 PORT 必须是有效端口。');
  return {
    ...process.env,
    ...config,
    APP_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(port),
    WEB_ORIGINS: 'http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:4173',
    COOKIE_SECURE: 'false',
  };
}

async function apiReady(api) {
  let live;
  try {
    live = await fetch(`${api}/api/v1/health/live`, { signal: AbortSignal.timeout(1500) });
  } catch {
    return false;
  }
  const identity = await live.json().catch(() => null);
  if (!live.ok || identity?.application !== 'tyde' || identity.status !== 'ok')
    throw new Error('后端端口被其他服务占用，请释放 apps/server/.env 的 PORT 后重试。');
  const ready = await fetch(`${api}/api/v1/health/ready`, {
    signal: AbortSignal.timeout(1500),
  }).catch(() => null);
  return ready?.ok && (await ready.json().catch(() => null))?.status === 'ready';
}

async function requireFreePort(port) {
  await new Promise((accept, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(new Error('本地后端端口已占用且服务未就绪，请先检查已有进程。')),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(accept));
  });
}

try {
  // 在任何迁移或服务启动前拒绝已有的远程数据库配置。
  let env = existsSync(envFile) ? localConfig() : null;
  console.info('[本地启动] 启动或复用项目数据库');
  await run(process.execPath, ['scripts/postgres-local.mjs', 'start']);
  if (!env) {
    console.info('[本地启动] 首次初始化本地配置和数据库');
    await run(process.execPath, ['scripts/setup-local.mjs']);
    env = localConfig();
  }
  console.info('[本地启动] 应用开发数据库迁移');
  await run('npm', ['--prefix', 'apps/server', 'run', 'db:deploy'], env);
  const api = `http://127.0.0.1:${env.PORT}`;
  if (!(await apiReady(api))) {
    await requireFreePort(Number(env.PORT));
    console.info(`[本地启动] 启动后端 ${api}`);
    start('npm', ['--prefix', 'apps/server', 'run', 'dev'], env, 'server');
    const deadline = Date.now() + 90_000;
    while (!stopping && !(await apiReady(api))) {
      if (Date.now() > deadline) throw new Error('等待本地后端就绪超时，请检查上方日志。');
      await delay(400);
    }
  } else console.info(`[本地启动] 复用已就绪的后端 ${api}`);
  if (!stopping) {
    console.info('[本地启动] 后端就绪，启动 Electron；Ctrl+C 停止本次开发进程，数据库保留。');
    start(
      process.execPath,
      ['scripts/dev-electron.mjs'],
      { ...process.env, TYDE_API_BASE_URL: api, API_PROXY_TARGET: api },
      'desktop',
    );
  }
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    stop(1);
  }
}
