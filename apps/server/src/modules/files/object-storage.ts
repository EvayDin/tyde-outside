import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import type { fetch as nodeFetch, Response } from 'undici-types';
import { AuthError } from '../auth/auth.error.js';
import type { FileConfig } from './file.config.js';

export interface ObjectStorage {
  put(key: string, content: Buffer, contentType: string): Promise<void>;
  head(key: string): Promise<{ size: number } | null>;
  open(key: string): Promise<{ stream: Readable; size: number; contentType: string }>;
  delete(key: string): Promise<void>;
  accessUrl(key: string, seconds: number): string;
}
export function validObjectKey(key: string): string {
  const value = key.trim();
  if (
    !value ||
    value.length > 512 ||
    !/^[a-z0-9-]+\/[a-zA-Z0-9/_.-]+$/.test(value) ||
    value.split('/').some((s) => !s || s === '.' || s === '..')
  )
    throw new AuthError(400, 'BAD_REQUEST', 'objectKey 格式不正确');
  return value;
}
const unavailable = () => new AuthError(503, 'STORAGE_UNAVAILABLE', '文件存储未配置或暂不可用');

/** OSS V1 签名保留旧服务图片最大有效期行为；不读取旧 Apollo 凭证或 bucket。 */
export class OssObjectStorage implements ObjectStorage {
  constructor(
    private readonly config: FileConfig,
    // Node 原生 fetch 基于 Undici；显式类型避免 Vercel 编译时全局 Response 丢失成员。
    private readonly request: typeof nodeFetch = fetch as typeof nodeFetch,
  ) {}
  private url(key: string) {
    validObjectKey(key);
    const url = new URL(this.config.endpoint);
    url.hostname = `${this.config.bucket}.${url.hostname}`;
    url.pathname = '/' + key.split('/').map(encodeURIComponent).join('/');
    return url;
  }
  private sign(method: string, key: string, date: string, contentType = '') {
    return createHmac('sha1', this.config.accessKeySecret)
      .update(`${method}\n\n${contentType}\n${date}\n/${this.config.bucket}/${key}`)
      .digest('base64');
  }
  private async send(method: string, key: string, content?: Buffer, contentType = '') {
    key = validObjectKey(key);
    const date = new Date().toUTCString();
    let result: Response;
    try {
      result = await this.request(this.url(key), {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Date: date,
          Authorization: `OSS ${this.config.accessKeyId}:${this.sign(method, key, date, contentType)}`,
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        ...(content ? { body: new Uint8Array(content) } : {}),
      });
    } catch {
      throw unavailable();
    }
    if (result.status === 404 && (method === 'GET' || method === 'HEAD')) {
      await result.body?.cancel();
      if (method === 'HEAD') return null;
      throw new AuthError(404, 'NOT_FOUND', '文件不存在');
    }
    if (!result.ok) {
      await result.body?.cancel();
      throw unavailable();
    }
    return result;
  }
  async put(key: string, content: Buffer, contentType: string) {
    const response = await this.send('PUT', key, content, contentType);
    await response?.body?.cancel();
  }
  async head(key: string) {
    const response = await this.send('HEAD', key);
    if (!response) return null;
    const length = response.headers.get('content-length');
    const size = length === null ? NaN : Number(length);
    if (!Number.isSafeInteger(size) || size < 0) throw unavailable();
    return { size };
  }
  async open(key: string) {
    const response = await this.send('GET', key);
    if (!response?.body) throw unavailable();
    const length = response.headers.get('content-length');
    const size = length === null ? NaN : Number(length);
    if (!Number.isSafeInteger(size) || size < 0) {
      await response.body.cancel();
      throw unavailable();
    }
    return {
      stream: Readable.fromWeb(response.body),
      size,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }
  async delete(key: string) {
    const response = await this.send('DELETE', key);
    await response?.body?.cancel();
  }
  accessUrl(key: string, seconds: number) {
    key = validObjectKey(key);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 2147483647)
      throw new AuthError(400, 'BAD_REQUEST', '访问链接有效期不正确');
    const expires = String(Math.floor(Date.now() / 1000) + seconds);
    const url = this.url(key);
    url.search = new URLSearchParams({
      OSSAccessKeyId: this.config.accessKeyId,
      Expires: expires,
      Signature: this.sign('GET', key, expires),
    }).toString();
    return url.href;
  }
}

export function createObjectStorage(config: FileConfig): ObjectStorage {
  if (config.provider === 'oss') return new OssObjectStorage(config);
  return {
    async put() {
      throw unavailable();
    },
    async head() {
      throw unavailable();
    },
    async open() {
      throw unavailable();
    },
    async delete() {
      throw unavailable();
    },
    accessUrl() {
      throw unavailable();
    },
  };
}
