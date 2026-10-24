// Outbound HTTP of an adapter, restricted to its own API base and download hosts (research 15 §5.7: clients never
// send URLs, so the gateway only ever fetches what a provider handed it, and only from that provider's hosts).
import { isLoopbackHost } from './config.ts';
import { ProviderError, type Egress } from './adapters/types.ts';

export interface EgressRules {
  readonly apiBase: string; // the effective base (default or override)
  readonly downloadHosts: readonly string[]; // exact host or `.suffix`
}

const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'CERT_HAS_EXPIRED']);

function causeCode(err: unknown): string | null {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === 'string' ? cause.code : null;
}

/** Maps a thrown fetch error: refused before sending (`no`) or possibly delivered (`maybe`). */
export function networkError(err: unknown, what: string): ProviderError {
  const code = causeCode(err);
  const name = (err as { name?: unknown } | null)?.name;
  if (code !== null && NOT_SENT.has(code))
    return new ProviderError('provider-failed', `${what}: connection failed (${code}).`, {
      retryable: true,
      sent: 'no',
    });
  const timeout = name === 'TimeoutError' || name === 'AbortError';
  return new ProviderError('timeout', `${what}: ${timeout ? 'timed out' : 'connection lost'}.`, {
    retryable: true,
    sent: 'maybe',
  });
}

export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => (a.startsWith('.') ? h.endsWith(a) && h.length > a.length : h === a));
}

export function createEgress(rules: EgressRules, baseFetch: typeof fetch, timeoutScale = 1): Egress {
  const base = new URL(rules.apiBase);
  const baseHref = rules.apiBase.replace(/\/+$/, '');
  const httpOk = (u: URL): boolean =>
    u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname.replace(/^\[|\]$/g, '')));
  // An overridden (mock) base adds its own host for results and uploads.
  const hosts = [...rules.downloadHosts, base.hostname];
  const checkExternal = (raw: string): URL => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new ProviderError('provider-failed', 'The provider returned an invalid URL.', { sent: 'no' });
    }
    if (!httpOk(u) || !hostAllowed(u.hostname, hosts) || u.username !== '' || u.password !== '')
      throw new ProviderError('provider-failed', `The provider returned a URL outside its allowed hosts (${u.host}).`, {
        sent: 'no',
      });
    return u;
  };
  const call = async (url: URL, init: RequestInit & { timeoutMs: number }, what: string): Promise<Response> => {
    const { timeoutMs, ...rest } = init;
    try {
      return await baseFetch(url, {
        ...rest,
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(1, timeoutMs * timeoutScale)),
      });
    } catch (err) {
      throw networkError(err, what);
    }
  };
  return {
    api(path, init) {
      const url = new URL(`${baseHref}${path}`);
      if (url.origin !== base.origin)
        throw new ProviderError('gateway', 'An adapter path left its API origin.', { sent: 'no' });
      return call(url, init, `${init.method ?? 'GET'} ${base.host}`);
    },
    external(raw, init) {
      return call(checkExternal(raw), init, `${init.method ?? 'GET'} upload`);
    },
    async download(raw, maxBytes) {
      let url = checkExternal(raw);
      for (let hop = 0; hop < 4; hop++) {
        const res = await call(url, { method: 'GET', timeoutMs: 120_000 }, 'download');
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          await res.body?.cancel().catch(() => undefined);
          if (loc === null) break;
          url = checkExternal(new URL(loc, url).href);
          continue;
        }
        if (res.status === 403 || res.status === 404 || res.status === 410)
          throw new ProviderError('expired', `The result is no longer available (${res.status}).`, { sent: 'yes' });
        if (!res.ok)
          throw new ProviderError('provider-failed', `The download failed (${res.status}).`, {
            retryable: true,
            sent: 'yes',
          });
        const declared = Number(res.headers.get('content-length') ?? '0');
        if (declared > maxBytes)
          throw new ProviderError('provider-failed', `The result is larger than ${maxBytes} bytes.`, { sent: 'yes' });
        if (res.body === null) return new Uint8Array(0);
        const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
        const parts: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new ProviderError('provider-failed', `The result is larger than ${maxBytes} bytes.`, { sent: 'yes' });
          }
          parts.push(value);
        }
        const out = new Uint8Array(size);
        let at = 0;
        for (const p of parts) {
          out.set(p, at);
          at += p.byteLength;
        }
        return out;
      }
      throw new ProviderError('provider-failed', 'Too many redirects.', { sent: 'yes' });
    },
  };
}
