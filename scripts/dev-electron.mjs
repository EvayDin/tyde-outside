import { spawn } from 'node:child_process';
const url = 'http://127.0.0.1:5173/';
const children = new Set();
let stopping = false;
function start(args) {
  const child = spawn('pnpm', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    env: { ...process.env, TYDE_WEB_URL: url },
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
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
      throw new Error('5173 端口已被其他服务占用，请先释放端口');
    return true;
  } catch (error) {
    if (error.message.includes('其他服务')) throw error;
    return false;
  }
}
try {
  if (!(await probe())) start(['dev:web']);
  const deadline = Date.now() + 90_000;
  while (!stopping && !(await probe())) {
    if (Date.now() > deadline) throw new Error('等待 Web 开发服务超时');
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!stopping) start(['--filter', '@tyde/electron', 'dev']);
} catch (error) {
  console.error(error.message);
  stop(1);
}
