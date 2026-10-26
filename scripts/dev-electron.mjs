import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { loadEnv } = createRequire(new URL('../apps/web/package.json', import.meta.url))('vite');
const webEnv = loadEnv(
  'development',
  fileURLToPath(new URL('../apps/web', import.meta.url)),
  'API_PROXY_TARGET',
);
const apiBaseUrl =
  process.env.TYDE_API_BASE_URL ??
  process.env.API_PROXY_TARGET ??
  webEnv.API_PROXY_TARGET ??
  'http://127.0.0.1:3000';
// 桌面页面直接请求可信后端，独立 HTTP 页面服务不承担 API 代理。
const url = 'http://127.0.0.1:5174/';
const children = new Set();
let stopping = false;
function start(args, env = {}, desktop = false) {
  if (stopping) return;
  const child = spawn('npm', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    env: { ...process.env, TYDE_WEB_URL: url, ...env },
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      if (desktop && code === 0)
        console.info('[桌面开发] Electron 已退出或已在运行；页面服务保留，Ctrl+C 停止。');
      else stop(code ?? 1);
    }
    children.delete(child);
  });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === 'win32')
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* process already exited */
      }
    }
  }
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
async function probe() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (response.headers.get('X-Tyde-Dev-Server') !== 'web')
      throw new Error('5174 端口已被其他服务占用，请先释放端口');
    return true;
  } catch (error) {
    if (error.message.includes('其他服务')) throw error;
    return false;
  }
}
try {
  if (!(await probe()))
    start(['--prefix', 'apps/web', 'run', 'dev', '--', '--port', '5174', '--host', '127.0.0.1'], {
      API_PROXY_TARGET: 'http://127.0.0.1:3000',
    });
  const deadline = Date.now() + 90_000;
  while (!stopping && !(await probe())) {
    if (Date.now() > deadline) throw new Error('等待 Web 开发服务超时');
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const devScript = process.argv.includes('--inspect') ? 'dev:inspect' : 'dev';
  if (!stopping)
    start(
      ['--prefix', 'apps/electron', 'run', devScript],
      {
        TYDE_API_BASE_URL: apiBaseUrl,
        ...(process.argv.includes('--memory') ? { TYDE_MEMORY_DIAGNOSTICS: '1' } : {}),
      },
      true,
    );
} catch (error) {
  console.error(error.message);
  stop(1);
}
