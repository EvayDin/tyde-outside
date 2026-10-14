import { writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await access(resolve(root, 'apps/web/dist/index.html'));
const api = new URL(process.env.TYDE_API_BASE_URL ?? 'http://127.0.0.1:3000');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname);
if (api.username || api.password || api.search || api.hash || api.pathname !== '/')
  throw new Error('TYDE_API_BASE_URL 必须为无路径的源地址');
if (api.protocol !== 'https:' && !(local && api.protocol === 'http:'))
  throw new Error('远程试用后端必须使用 HTTPS');
const config = {
  environment: local ? 'development' : 'test',
  apiBaseUrl: api.origin,
  allowLocalHttp: local,
};
await mkdir(resolve(root, 'apps/electron/resources'), { recursive: true });
await writeFile(
  resolve(root, 'apps/electron/resources/runtime.json'),
  JSON.stringify(config, null, 2) + '\n',
);
console.info('安装包后端环境:', config);
if (local)
  console.warn(
    '此包仅连接安装者本机后端，不能作为远程联调包；正式发给测试人员前请设置 TYDE_API_BASE_URL。',
  );
