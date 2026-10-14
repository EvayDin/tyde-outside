import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export interface RuntimeConfig {
  environment: 'development' | 'test';
  apiBaseUrl: string;
  allowLocalHttp: boolean;
}
export async function loadRuntime(): Promise<RuntimeConfig> {
  const config: RuntimeConfig = app.isPackaged
    ? (JSON.parse(
        await readFile(resolve(process.resourcesPath, 'runtime.json'), 'utf8'),
      ) as RuntimeConfig)
    : {
        environment: 'development',
        apiBaseUrl: process.env.TYDE_API_BASE_URL ?? 'http://127.0.0.1:3000',
        allowLocalHttp: true,
      };
  const url = new URL(config.apiBaseUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('API base URL 必须是无路径的服务源地址');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      local &&
      config.allowLocalHttp &&
      config.environment === 'development'
    )
  )
    throw new Error('远程 API 必须使用 HTTPS，本地 HTTP 仅限 development 回环地址');
  return { ...config, apiBaseUrl: url.origin };
}
