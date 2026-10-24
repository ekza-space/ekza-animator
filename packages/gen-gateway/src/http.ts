// HTTP plumbing of the Fetch handler: JSON and error responses, size-capped body reads, the gateway's own security
// headers. The gateway is an API: every response is `no-store`, `nosniff` and carries a deny-all CSP.
import type { GenApiError, GenApiErrorCode } from '@ekza-studio/gen-core';

const STATUS: Readonly<Record<GenApiErrorCode, number>> = {
  unauthorized: 401,
  'not-found': 404,
  'invalid-request': 400,
  unsupported: 400,
  'over-budget': 422,
  'spend-cap': 402,
  'rate-limited': 429,
  'payload-too-large': 413,
  'unsupported-media': 415,
  conflict: 409,
  'provider-unavailable': 409,
  paused: 503,
  internal: 500,
};

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

export class ApiError extends Error {
  readonly code: GenApiErrorCode;
  readonly retryable: boolean;
  readonly retryAfterS: number | null;
  constructor(code: GenApiErrorCode, message: string, opts?: { retryable?: boolean; retryAfterS?: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    this.retryAfterS = opts?.retryAfterS ?? null;
  }
}

export function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

export function errorResponse(e: ApiError): Response {
  const body: { error: GenApiError } = { error: { code: e.code, message: e.message, retryable: e.retryable } };
  return json(body, STATUS[e.code], e.retryAfterS === null ? undefined : { 'retry-after': String(e.retryAfterS) });
}

/** Plain 404, the same whether the gateway is disabled or the path is unknown (nothing reveals a gateway). */
export function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** Reads the body up to `limit` bytes; refuses a larger declared or actual length without buffering it. */
export async function readBody(req: Request, limit: number): Promise<Uint8Array> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > limit)
    throw new ApiError('payload-too-large', `The body is larger than ${limit} bytes.`);
  if (req.body === null) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError('payload-too-large', `The body is larger than ${limit} bytes.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function readJson(req: Request, limit = 64 * 1024): Promise<unknown> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json'))
    throw new ApiError('unsupported-media', 'Expected application/json.');
  const bytes = await readBody(req, limit);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ApiError('invalid-request', 'The body is not valid JSON.');
  }
}
