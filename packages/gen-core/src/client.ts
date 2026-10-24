// The typed client of `ekza-gen/v1` — the contract the editor side (G-d) builds on, and the only generation code that
// may enter a browser bundle. It talks to one gateway base URL (same origin, or the origin fixed in the build config);
// it never holds provider origins, and a provider key reaches it only as a bring-your-own value the panel passes in.
import { SHA256_HEX, sha256Hex } from './hash.ts';
import { SseReader } from './sse.ts';
import { isTerminal } from './state.ts';
import {
  GEN_HEADERS,
  GEN_LIMITS,
  GEN_PROTOCOL,
  type GenApiError,
  type GenApiErrorCode,
  type GenArtifact,
  type GenJob,
  type GenJobsResponse,
  type GenProtocol,
  type GenProvidersResponse,
  type GenQuote,
  type GenRequest,
  type GenUpload,
  type UploadMime,
} from './types.ts';
import { parseGenRequest } from './validate.ts';

export type GenClientErrorCode = GenApiErrorCode | 'network' | 'protocol' | 'integrity' | 'aborted';

export class GenClientError extends Error {
  readonly code: GenClientErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(code: GenClientErrorCode, message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'GenClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface GenerationClientOptions {
  /** The gateway base: '/api/gen' for the route of a server build, or the build-time gateway URL of a static export. */
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** The shared bearer token of a self-hosted gateway (the panel keeps it in memory), or null. */
  readonly token?: () => string | null;
  /** A bring-your-own provider key for this provider, or null; sent only with quotes and submits. */
  readonly providerKey?: (provider: string) => string | null;
  /** Polling interval when the event stream is unavailable (default 3,000 ms). */
  readonly pollMs?: number;
}

export interface GenWatch {
  close(): void;
}

export interface GenerationClient {
  readonly protocol: GenProtocol;
  readonly baseUrl: string;
  /** Adapters, their capabilities and terms, and the server caps. Fails with `protocol` on another protocol. */
  providers(signal?: AbortSignal): Promise<GenProvidersResponse>;
  /** Uploads an input image (re-encoded by the caller: PNG/WebP, no EXIF/XMP) or a GLB for retopology/rig. */
  upload(bytes: Uint8Array, mime: UploadMime, signal?: AbortSignal): Promise<GenUpload>;
  quote(req: GenRequest, signal?: AbortSignal): Promise<GenQuote>;
  /** Creates a job, or returns the existing one for the same idempotency key. */
  submit(req: GenRequest, signal?: AbortSignal): Promise<GenJob>;
  job(id: string, signal?: AbortSignal): Promise<GenJob>;
  /** The caller's jobs, newest first — a reloaded editor resumes from them. */
  jobs(signal?: AbortSignal): Promise<readonly GenJob[]>;
  cancel(id: string, signal?: AbortSignal): Promise<GenJob>;
  /** Streams job snapshots (SSE, polling as the fallback) until a terminal state or `close()`. */
  watch(id: string, onJob: (job: GenJob) => void, onError?: (error: GenClientError) => void): GenWatch;
  /** An artifact's bytes, verified against its SHA-256 (they are still untrusted: import them through `io`). */
  artifact(artifact: GenArtifact | string, signal?: AbortSignal): Promise<Uint8Array>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function apiError(status: number, body: unknown): GenClientError {
  const e = isObj(body) && isObj(body['error']) ? (body['error'] as Partial<GenApiError>) : null;
  if (e && typeof e.code === 'string' && typeof e.message === 'string')
    return new GenClientError(e.code, e.message, status, e.retryable === true);
  if (status === 404) return new GenClientError('not-found', 'The generation gateway is not available.', 404, false);
  return new GenClientError('internal', `The gateway answered ${status}.`, status, status >= 500);
}

export function createGenerationClient(opts: GenerationClientOptions): GenerationClient {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const pollMs = opts.pollMs ?? 3_000;

  const headers = (extra?: Record<string, string>, provider?: string): Headers => {
    const h = new Headers(extra);
    const token = opts.token?.() ?? null;
    if (token) h.set('authorization', `Bearer ${token}`);
    if (provider !== undefined) {
      const key = opts.providerKey?.(provider) ?? null;
      if (key) h.set(GEN_HEADERS.providerKey, key);
    }
    return h;
  };

  const send = async (path: string, init: RequestInit): Promise<Response> => {
    try {
      return await doFetch(`${base}${path}`, { ...init, cache: 'no-store' });
    } catch (err) {
      if (init.signal?.aborted) throw new GenClientError('aborted', 'Aborted.', null, false);
      throw new GenClientError('network', `The gateway could not be reached (${String(err)}).`, null, true);
    }
  };

  const json = async <T>(path: string, init: RequestInit): Promise<T> => {
    const res = await send(path, init);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) throw apiError(res.status, body);
    return body as T;
  };

  const checkRequest = (req: GenRequest): void => {
    const parsed = parseGenRequest(req);
    if (!parsed.ok) throw new GenClientError('invalid-request', parsed.errors.join('; '), null, false);
  };

  const job = (id: string, signal?: AbortSignal): Promise<GenJob> =>
    json<GenJob>(`/v1/jobs/${encodeURIComponent(id)}`, { method: 'GET', headers: headers(), signal: signal ?? null });

  const watch = (id: string, onJob: (j: GenJob) => void, onError?: (e: GenClientError) => void): GenWatch => {
    const ctrl = new AbortController();
    let closed = false;
    let lastRevision = -1;
    const deliver = (j: GenJob): boolean => {
      if (j.revision > lastRevision) {
        lastRevision = j.revision;
        onJob(j);
      }
      return isTerminal(j.state);
    };
    const fail = (e: GenClientError): void => {
      if (!closed) onError?.(e);
      closed = true;
    };
    const poll = async (): Promise<void> => {
      while (!closed) {
        try {
          if (deliver(await job(id, ctrl.signal))) return;
        } catch (e) {
          const err = e instanceof GenClientError ? e : new GenClientError('network', String(e), null, true);
          if (err.code === 'aborted') return;
          if (!err.retryable) return fail(err);
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
    };
    const stream = async (): Promise<boolean> => {
      const res = await send(`/v1/jobs/${encodeURIComponent(id)}/events`, {
        method: 'GET',
        headers: headers({ accept: 'text/event-stream' }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        const err = apiError(res.status, body);
        if (!err.retryable && res.status < 500) {
          fail(err);
          return true;
        }
        return false;
      }
      if (res.body === null) return false;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const sse = new SseReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return false;
        for (const ev of sse.push(value)) {
          if (ev.event !== 'job') continue;
          if (deliver(JSON.parse(ev.data) as GenJob)) {
            await reader.cancel().catch(() => undefined);
            return true;
          }
        }
      }
    };
    void (async () => {
      for (let attempt = 0; attempt < 2 && !closed; attempt++) {
        try {
          if (await stream()) return;
        } catch {
          if (closed) return;
        }
      }
      await poll();
    })();
    return {
      close: () => {
        closed = true;
        ctrl.abort();
      },
    };
  };

  return {
    protocol: GEN_PROTOCOL,
    baseUrl: base,
    async providers(signal) {
      const res = await json<GenProvidersResponse>('/v1/providers', {
        method: 'GET',
        headers: headers(),
        signal: signal ?? null,
      });
      if (res.protocol !== GEN_PROTOCOL)
        throw new GenClientError('protocol', `The gateway speaks ${String(res.protocol)}.`, null, false);
      return res;
    },
    upload(bytes, mime, signal) {
      if (bytes.byteLength > GEN_LIMITS.uploadMaxBytes)
        return Promise.reject(new GenClientError('payload-too-large', 'The file is larger than 20 MB.', null, false));
      return json<GenUpload>('/v1/uploads', {
        method: 'POST',
        headers: headers({ 'content-type': mime }),
        body: bytes as Uint8Array<ArrayBuffer>,
        signal: signal ?? null,
      });
    },
    async quote(req, signal) {
      checkRequest(req);
      return json<GenQuote>('/v1/quote', {
        method: 'POST',
        headers: headers({ 'content-type': 'application/json' }, req.provider),
        body: JSON.stringify(req),
        signal: signal ?? null,
      });
    },
    async submit(req, signal) {
      checkRequest(req);
      return json<GenJob>('/v1/jobs', {
        method: 'POST',
        headers: headers(
          { 'content-type': 'application/json', [GEN_HEADERS.idempotencyKey]: req.idempotencyKey },
          req.provider,
        ),
        body: JSON.stringify(req),
        signal: signal ?? null,
      });
    },
    job,
    async jobs(signal) {
      const res = await json<GenJobsResponse>('/v1/jobs', {
        method: 'GET',
        headers: headers(),
        signal: signal ?? null,
      });
      return res.jobs;
    },
    cancel(id, signal) {
      return json<GenJob>(`/v1/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: headers(),
        signal: signal ?? null,
      });
    },
    watch,
    async artifact(artifact, signal) {
      const sha = typeof artifact === 'string' ? artifact : artifact.sha256;
      if (!SHA256_HEX.test(sha)) throw new GenClientError('invalid-request', 'Not a SHA-256 id.', null, false);
      const res = await send(`/v1/artifacts/${sha}`, { method: 'GET', headers: headers(), signal: signal ?? null });
      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        throw apiError(res.status, body);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if ((await sha256Hex(bytes)) !== sha)
        throw new GenClientError('integrity', 'The artifact does not match its SHA-256.', res.status, true);
      return bytes;
    },
  };
}
