// Helpers shared by the adapters: JSON calls with error mapping, Retry-After, base64 data URIs, range checks.
import { ApiError } from '../http.ts';
import { type AdapterContext, ProviderError, type Sent } from './types.ts';

export const CREATE_TIMEOUT_MS = 60_000;
export const STATUS_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 120_000;

export type Json = Record<string, unknown>;
export const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Retry-After in ms (seconds or an HTTP date), or null. */
export function retryAfterMs(res: Response, nowMs = Date.now()): number | null {
  const raw = res.headers.get('retry-after');
  if (raw === null) return null;
  const s = Number(raw);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : Math.max(0, t - nowMs);
}

export async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A provider-specific reading of an error body: the job error code and whether a create was refused (not made). */
export type ErrorMapper = (
  status: number,
  body: unknown,
) => { code: ProviderError['code']; message: string; retryable: boolean } | null;

/**
 * Calls the provider API and returns the JSON body of a 2xx answer. Errors become `ProviderError`s: 429 and 401/402/
 * 403/4xx answers are refusals (`sent: 'no'` for a create — nothing was created); 5xx is `yes` (answered, not retried
 * automatically); a timeout or lost connection is `maybe`.
 */
export async function callJson(
  ctx: AdapterContext,
  path: string,
  init: { method: string; body?: string | FormData; headers?: Record<string, string>; timeoutMs: number },
  map: ErrorMapper,
): Promise<{ body: unknown; res: Response }> {
  const res = await ctx.http.api(path, {
    method: init.method,
    headers: { authorization: `Bearer ${ctx.key}`, accept: 'application/json', ...init.headers },
    ...(init.body === undefined ? {} : { body: init.body }),
    timeoutMs: init.timeoutMs,
  });
  const body = await readJsonBody(res);
  if (res.ok) return { body, res };
  const mapped = map(res.status, body);
  const sent: Sent = res.status >= 500 ? 'yes' : 'no';
  const fallback =
    res.status === 401 || res.status === 403
      ? { code: 'auth' as const, message: 'The provider refused the key.', retryable: false }
      : res.status === 402
        ? { code: 'insufficient-credits' as const, message: 'The provider account has no credits left.', retryable: false }
        : res.status === 429
          ? { code: 'rate-limited' as const, message: 'The provider is rate limiting.', retryable: true }
          : res.status === 404
            ? { code: 'expired' as const, message: 'The provider does not know this task (any more).', retryable: false }
            : res.status >= 500
              ? { code: 'provider-failed' as const, message: `The provider failed (${res.status}).`, retryable: true }
              : { code: 'invalid-input' as const, message: `The provider refused the request (${res.status}).`, retryable: false };
  const e = mapped ?? fallback;
  throw new ProviderError(e.code, e.message, {
    status: res.status,
    retryable: e.retryable,
    retryAfterMs: retryAfterMs(res),
    sent,
  });
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + (B64[(n >> 12) & 63] ?? '') + (B64[(n >> 6) & 63] ?? '') + (B64[n & 63] ?? '');
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}

export const dataUri = (mime: string, bytes: Uint8Array): string => `data:${mime};base64,${base64(bytes)}`;

/** Refuses a value outside a provider's range (the panel reads the ranges from the capabilities). */
export function inRange(name: string, value: number | undefined, [min, max]: readonly [number, number]): void {
  if (value !== undefined && (value < min || value > max))
    throw new ApiError('invalid-request', `${name} must be ${min}–${max} for this provider and op.`);
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const HEXB = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** HMAC-SHA256(secret, message) checked against a lowercase hex signature, in constant time (WebCrypto verify). */
export async function hmacSha256Verify(secret: string, message: Uint8Array, hexSig: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(hexSig)) return false;
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return globalThis.crypto.subtle.verify(
    'HMAC',
    key,
    HEXB(hexSig.toLowerCase()) as Uint8Array<ArrayBuffer>,
    message as Uint8Array<ArrayBuffer>,
  );
}

export async function hmacSha256Hex(secret: string, message: Uint8Array): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, message as Uint8Array<ArrayBuffer>));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
