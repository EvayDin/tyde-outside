import { randomBytes } from 'node:crypto';
import { ApiError, type BridgeResult } from '@tyde/shared';

type Ticket = {
  path: string;
  method: 'GET' | 'POST';
  body: string;
  origin: string;
  expiresAt: number;
  allowed: () => boolean;
  operation: () => Promise<BridgeResult<unknown>>;
};

function allowed(ticket: Ticket): boolean {
  try {
    return ticket.allowed();
  } catch {
    return false;
  }
}

function matchesOrigin(request: Request, origin: string): boolean {
  const supplied = request.headers.get('Origin');
  if (supplied !== null) return supplied === origin;
  // Electron custom-protocol requests can omit Origin; the ticket and frame guard remain required.
  try {
    return new URL(request.referrer).origin === origin;
  } catch {
    return false;
  }
}

function response(result: BridgeResult<unknown>, origin?: string): Response {
  const status = result.ok
    ? 200
    : result.status === 0
      ? 502
      : result.status >= 400 && result.status <= 599
        ? result.status
        : 500;
  return new Response(JSON.stringify(result), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    },
  });
}

function failure(status: number, origin?: string): Response {
  return response(
    {
      ok: false,
      status,
      error: { code: 'DEVELOPMENT_NETWORK_ERROR', message: '开发调试请求无效，请重试' },
    },
    origin,
  );
}

export class DevelopmentNetwork {
  private readonly pending = new Map<string, Ticket>();

  issue(
    route: { path: string; method: 'GET' | 'POST' },
    input: unknown,
    origin: string,
    allowed: () => boolean,
    operation: () => Promise<BridgeResult<unknown>>,
  ): { networkRequestId: string } {
    const now = Date.now();
    for (const [id, ticket] of this.pending) if (ticket.expiresAt <= now) this.pending.delete(id);
    if (this.pending.size >= 128)
      throw new ApiError(429, {
        code: 'DEVELOPMENT_NETWORK_BUSY',
        message: '开发调试请求过多，请稍后重试',
      });
    const networkRequestId = randomBytes(32).toString('hex');
    this.pending.set(networkRequestId, {
      ...route,
      body: route.method === 'POST' ? (JSON.stringify(input) ?? '') : '',
      origin,
      expiresAt: now + 30_000,
      allowed,
      operation,
    });
    return { networkRequestId };
  }

  async respond(request: Request): Promise<Response> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return failure(400);
    }
    if (
      url.protocol !== 'tyde-debug:' ||
      url.host !== 'desktop' ||
      url.username ||
      url.password ||
      request.url.includes('#')
    )
      return failure(400);
    const id = /^\?request=([a-f0-9]{64})$/.exec(url.search)?.[1];
    if (!id) return failure(400);
    const ticket = this.pending.get(id);
    if (!ticket) return failure(404);
    if (ticket.expiresAt <= Date.now() || !allowed(ticket)) {
      this.pending.delete(id);
      return failure(403, ticket.origin);
    }
    if (
      url.pathname !== ticket.path ||
      request.method !== ticket.method ||
      !matchesOrigin(request, ticket.origin)
    )
      return failure(403, ticket.origin);
    let body: string;
    try {
      body = await request.text();
    } catch {
      return failure(400, ticket.origin);
    }
    if (body !== ticket.body) return failure(403, ticket.origin);
    if (this.pending.get(id) !== ticket || ticket.expiresAt <= Date.now() || !allowed(ticket)) {
      this.pending.delete(id);
      return failure(403, ticket.origin);
    }
    // Claim before awaiting the operation so concurrent requests cannot replay it.
    this.pending.delete(id);
    try {
      return response(await ticket.operation(), ticket.origin);
    } catch {
      return failure(500, ticket.origin);
    }
  }
}
