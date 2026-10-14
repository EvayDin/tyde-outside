import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// Node/Electron 的 fetch 也会添加 Sec-Fetch-Mode。使用原生 HTTP 客户端，明确不携带浏览器元数据或 Cookie。
// 只由 main 的固定 API 路由调用，不向 renderer 暴露 URL、请求头或此函数。
export function desktopRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = request(
      parsed,
      { method, headers, timeout: 15_000, maxHeaderSize: 16_384 },
      (incoming) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 128 * 1024) {
            incoming.destroy(new Error('服务响应过大'));
            return;
          }
          chunks.push(chunk);
        });
        incoming.once('error', reject);
        incoming.once('end', () => {
          const status = incoming.statusCode ?? 502;
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value !== undefined)
              responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          try {
            resolve(
              new Response(status === 204 ? null : Buffer.concat(chunks).toString('utf8'), {
                status,
                headers: responseHeaders,
              }),
            );
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    outgoing.once('timeout', () => outgoing.destroy(new Error('请求超时')));
    outgoing.once('error', reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}
