import { createHmac } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { readFileConfig } from '../src/modules/files/file.config.js';
import {
  createObjectStorage,
  OssObjectStorage,
  validObjectKey,
} from '../src/modules/files/object-storage.js';
const config = readFileConfig({
  FILE_STORAGE_PROVIDER: 'oss',
  OSS_ENDPOINT: 'https://oss-cn-hangzhou.aliyuncs.com',
  OSS_BUCKET: 'tyde-test-bucket',
  OSS_ACCESS_KEY_ID: 'test-key',
  OSS_ACCESS_KEY_SECRET: 'test-secret',
});
test('storage is explicitly disabled by default and does not use legacy configuration', async () => {
  const disabled = createObjectStorage(readFileConfig({}));
  await expect(
    disabled.put('common/test.txt', Buffer.from('data'), 'text/plain'),
  ).rejects.toMatchObject({ status: 503 });
  expect(() => disabled.accessUrl('common/test.txt', 100)).toThrow();
});
test.each([
  '../secret',
  'common/../secret',
  'common//secret',
  'https://example.org/a',
  'common/a?x=1',
  'common/%2fsecret',
  'business-license/..',
])('invalid object key %s is rejected', (key) => {
  expect(() => validObjectKey(key)).toThrow();
});
test.each([
  { FILE_STORAGE_PROVIDER: 'local' },
  { TYDE_FILE_MAX_SIZE: '0' },
  { TYDE_FILE_MAX_BATCH: '1.5' },
  {
    ...{ FILE_STORAGE_PROVIDER: 'oss' },
    OSS_ENDPOINT: 'http://storage.example',
    OSS_BUCKET: 'test-bucket',
    OSS_ACCESS_KEY_ID: 'a',
    OSS_ACCESS_KEY_SECRET: 'b',
  },
])('invalid storage configuration is rejected', (source) => {
  expect(() => readFileConfig(source)).toThrow();
});
test('OSS sends authenticated PUT/HEAD/GET/DELETE and streams without returning credentials', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': '3' } });
    if (init?.method === 'GET')
      return new Response('abc', {
        headers: { 'content-length': '3', 'content-type': 'image/png' },
      });
    return new Response(null);
  });
  const storage = new OssObjectStorage(config, request);
  const key = 'business-license/2026/10/16/test.png';
  await storage.put(key, Buffer.from('abc'), 'image/png');
  const [url, options] = request.mock.calls[0]!;
  expect(String(url)).toBe(`https://tyde-test-bucket.oss-cn-hangzhou.aliyuncs.com/${key}`);
  expect(options?.redirect).toBe('error');
  expect(options?.headers).toMatchObject({ 'Content-Type': 'image/png' });
  const headers = options!.headers as Record<string, string>;
  const signature = createHmac('sha1', 'test-secret')
    .update(`PUT\n\nimage/png\n${headers.Date}\n/tyde-test-bucket/${key}`)
    .digest('base64');
  expect(headers.Authorization).toBe(`OSS test-key:${signature}`);
  expect(await storage.head(key)).toEqual({ size: 3 });
  const opened = await storage.open(key);
  const chunks = [];
  for await (const chunk of opened.stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('abc');
  expect(opened.contentType).toBe('image/png');
  await storage.delete(key);
  expect(request.mock.calls.map(([, init]) => init?.method)).toEqual([
    'PUT',
    'HEAD',
    'GET',
    'DELETE',
  ]);
});
test('signed download URLs use expected bucket and expiry without embedding secret', () => {
  const url = new URL(new OssObjectStorage(config).accessUrl('avatar/test.png', 2147483647));
  expect(url.protocol).toBe('https:');
  expect(url.searchParams.get('OSSAccessKeyId')).toBe('test-key');
  expect(Number(url.searchParams.get('Expires')) - Math.floor(Date.now() / 1000)).toBe(2147483647);
  expect(url.searchParams.get('Signature')).toBeTruthy();
  expect(url.href).not.toContain('test-secret');
});
test('missing objects are distinguished from storage failures and errors do not expose upstream secrets', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
  const storage = new OssObjectStorage(config, request);
  expect(await storage.head('common/missing.txt')).toBeNull();
  await expect(storage.open('common/missing.txt')).rejects.toMatchObject({ status: 404 });
  request.mockRejectedValue(new Error('test-secret upstream URL'));
  await expect(storage.put('common/a.txt', Buffer.from('a'), 'text/plain')).rejects.toMatchObject({
    status: 503,
    message: '文件存储未配置或暂不可用',
  });
  request.mockResolvedValue(new Response('secret error', { status: 403 }));
  await expect(storage.delete('common/a.txt')).rejects.toMatchObject({ status: 503 });
});
