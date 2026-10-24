// The `ekza-gen/v1` Fetch handler (research 15 §5.5): `handle(Request) → Response`, mounted under a base path by a
// Next route (`/api/gen`) or the standalone Node server (`/`). Disabled, every path is a plain 404.
import {
  GEN_HEADERS,
  GEN_PROTOCOL,
  type GenProvidersResponse,
  type GenUpload,
  isTerminal,
  parseGenRequest,
  SHA256_HEX,
  SSE_COMMENT,
  formatSseEvent,
  type UploadMime,
} from '@ekza-studio/gen-core';
import type { ProviderAdapter } from './adapters/types.ts';
import { type ConfigResult, configSecrets, type GatewayConfig, isLoopbackHost } from './config.ts';
import { Engine } from './engine.ts';
import { ApiError, errorResponse, json, notFound, readBody, readJson, SECURITY_HEADERS } from './http.ts';
import { checkGlb, checkImage, InputError, sniff } from './inputs.ts';
import { createRedactingLogger, type Logger } from './logger.ts';
import { type BlobStore, type JobStore, MemoryBlobStore, MemoryJobStore } from './stores.ts';

/** Present in every gateway build; the client-bundle check fails when it appears in a browser chunk. */
export const GATEWAY_MARKER = 'ekza-gen-gateway:server-only';

export interface RequestInfo {
  /** The socket's peer address (standalone server); unknown inside a web framework route. */
  readonly remoteAddress?: string | null;
}

export interface GatewayOptions {
  readonly config: ConfigResult;
  readonly adapters: readonly ProviderAdapter[];
  readonly store?: JobStore;
  readonly blobs?: BlobStore;
  readonly log?: Logger;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeScale?: number;
  readonly requestTimeoutScale?: number;
  /** The path the handler is mounted under, e.g. '/api/gen'; '' for the standalone server. */
  readonly basePath?: string;
  /** Session auth (Ekza accounts, M4b): the caller's id, or null. Used when GEN_GATEWAY_TOKEN is not set. */
  readonly authenticate?: (req: Request) => Promise<string | null>;
  /** SSE heartbeat interval (default 15 s). */
  readonly heartbeatMs?: number;
}

export interface Gateway {
  readonly enabled: boolean;
  readonly marker: string;
  handle(req: Request, info?: RequestInfo): Promise<Response>;
  /** Resumes the jobs of a previous run (persistent stores). */
  start(): Promise<void>;
  close(): Promise<void>;
}

const FORWARD_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host'];
const UPLOAD_MIMES: readonly UploadMime[] = ['image/png', 'image/webp', 'image/jpeg', 'model/gltf-binary'];
const ALLOW_HEADERS = [
  'authorization',
  'content-type',
  GEN_HEADERS.idempotencyKey,
  GEN_HEADERS.providerKey,
  'last-event-id',
];
const DELIVERY_TTL_MS = 10 * 60_000;

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Constant-time comparison of two secrets (over their SHA-256, so lengths do not leak). */
export async function secretEquals(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const hostOnly = (host: string): string => host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');

export function createGateway(opts: GatewayOptions): Gateway {
  if (!opts.config.enabled)
    return {
      enabled: false,
      marker: GATEWAY_MARKER,
      handle: async () => notFound(),
      start: async () => undefined,
      close: async () => undefined,
    };
  const config: GatewayConfig = opts.config;
  const log = opts.log ?? createRedactingLogger((line) => console.error(line), configSecrets(config), config.logLevel);
  for (const s of configSecrets(config)) log.addSecret(s);
  const store = opts.store ?? new MemoryJobStore();
  const blobs = opts.blobs ?? new MemoryBlobStore();
  const adapters = new Map(opts.adapters.map((a) => [a.id, a]));
  const engine = new Engine({
    config,
    adapters,
    store,
    blobs,
    log,
    fetch: opts.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.timeScale === undefined ? {} : { timeScale: opts.timeScale }),
    ...(opts.requestTimeoutScale === undefined ? {} : { requestTimeoutScale: opts.requestTimeoutScale }),
  });
  const base = (opts.basePath ?? '').replace(/\/+$/, '');
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const deliveries = new Map<string, number>();
  const now = opts.now ?? (() => Date.now());

  const corsHeaders = (req: Request): Record<string, string> => {
    const origin = req.headers.get('origin');
    if (origin === null || !config.allowedOrigins.includes(origin)) return {};
    return {
      'access-control-allow-origin': origin,
      'access-control-expose-headers': 'retry-after',
      vary: 'Origin',
    };
  };

  /** The caller, or null. Loopback mode also refuses proxied requests and non-loopback Host headers (DNS rebinding). */
  const principalOf = async (req: Request, info: RequestInfo | undefined): Promise<string | null> => {
    switch (config.auth.kind) {
      case 'token': {
        const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
        return m !== null && (await secretEquals(m[1] as string, config.auth.token)) ? 'operator' : null;
      }
      case 'loopback': {
        const remote = info?.remoteAddress ?? null;
        if (remote === null || !isLoopbackHost(remote.replace(/^::ffff:/, ''))) return null;
        if (FORWARD_HEADERS.some((h) => req.headers.has(h))) return null;
        if (!isLoopbackHost(hostOnly(req.headers.get('host') ?? new URL(req.url).host))) return null;
        return 'local';
      }
      case 'session': {
        const id = opts.authenticate ? await opts.authenticate(req) : null;
        return id === null ? null : `user:${id}`;
      }
      default: {
        const never: never = config.auth;
        throw new Error(`unknown auth ${String(never)}`);
      }
    }
  };

  const providersBody = async (): Promise<GenProvidersResponse> => ({
    protocol: GEN_PROTOCOL,
    providers: [...adapters.values()].map((a) => ({
      id: a.id,
      label: a.label,
      adapterVersion: a.version,
      models: a.models,
      capabilities: a.capabilities,
      terms: a.terms,
      configured: engine.hasServerKey(a.id),
      byoAllowed: config.byoKeys,
    })),
    caps: await engine.caps(),
  });

  const upload = async (req: Request, principal: string): Promise<Response> => {
    const declared = (req.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!UPLOAD_MIMES.includes(declared as UploadMime))
      throw new ApiError('unsupported-media', 'Upload a PNG, WebP or JPEG image, or a GLB.');
    engine.takeRate(principal, 'uploads');
    const bytes = await readBody(req, config.uploadMaxBytes);
    if (bytes.byteLength === 0) throw new ApiError('invalid-request', 'The upload is empty.');
    let width: number | null = null;
    let height: number | null = null;
    try {
      if (declared === 'model/gltf-binary') {
        if (sniff(bytes) !== 'model/gltf-binary') throw new InputError('type', 'Not a GLB.');
        checkGlb(bytes);
      } else {
        const info = checkImage(bytes, declared);
        width = info.width;
        height = info.height;
      }
    } catch (err) {
      if (err instanceof InputError)
        throw new ApiError(err.kind === 'type' ? 'unsupported-media' : 'invalid-request', err.message);
      throw err;
    }
    const sha256 = await blobs.put(bytes);
    const row = {
      id: `up_${globalThis.crypto.randomUUID().replace(/-/g, '')}`,
      principal,
      sha256,
      mime: declared as UploadMime,
      size: bytes.byteLength,
      width,
      height,
      createdAt: new Date(now()).toISOString(),
    };
    await store.putUpload(row);
    const body: GenUpload = { upload: row.id, sha256, mime: row.mime, size: row.size, width, height };
    return json(body, 201);
  };

  const events = async (req: Request, principal: string, id: string): Promise<Response> => {
    const first = await engine.get(principal, id);
    const enc = new TextEncoder();
    let cleanup = (): void => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const send = (text: string): void => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(text));
          } catch {
            cleanup();
          }
        };
        const unsubscribe = engine.subscribe(id, (job) => {
          send(formatSseEvent('job', JSON.stringify(job), job.revision));
          if (isTerminal(job.state)) {
            cleanup();
          }
        });
        const beat = setInterval(() => send(SSE_COMMENT), heartbeatMs);
        cleanup = () => {
          if (!open) return;
          open = false;
          clearInterval(beat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed by the reader
          }
        };
        req.signal.addEventListener('abort', cleanup);
        send('retry: 3000\n\n');
        send(formatSseEvent('job', JSON.stringify(first), first.revision));
        if (isTerminal(first.state)) cleanup();
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        ...corsHeaders(req),
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
      },
    });
  };

  const artifact = async (principal: string, sha: string): Promise<Response> => {
    if (!SHA256_HEX.test(sha) || !(await store.owns(principal, sha)))
      throw new ApiError('not-found', 'Unknown artifact.');
    const bytes = await blobs.get(sha);
    if (bytes === null) throw new ApiError('not-found', 'The artifact is no longer stored.');
    const mime = sniff(bytes) ?? 'application/octet-stream';
    const ext = mime === 'model/gltf-binary' ? 'glb' : mime.startsWith('image/') ? mime.slice(6) : 'bin';
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'cache-control': 'private, max-age=31536000, immutable',
        'content-type': mime,
        'content-length': String(bytes.byteLength),
        'content-disposition': `attachment; filename="${sha}.${ext}"`,
      },
    });
  };

  const hook = async (req: Request, providerId: string): Promise<Response> => {
    const adapter = adapters.get(providerId);
    const settings = config.providers.find((p) => p.id === providerId);
    if (config.publicUrl === null || adapter?.webhook === undefined) return notFound();
    const secret = settings?.webhookSecret ?? null;
    if (adapter.webhook.signed && secret === null) return notFound();
    const raw = await readBody(req, 1024 * 1024);
    const result = await adapter.webhook.verify(raw, req.headers, secret, now());
    if (result === null) {
      log.log('warn', 'webhook.rejected', { provider: providerId });
      return json({ error: { code: 'unauthorized', message: 'Bad signature.', retryable: false } }, 401);
    }
    const t = now();
    for (const [k, exp] of deliveries) if (exp < t) deliveries.delete(k);
    if (result.deliveryId !== null) {
      const key = `${providerId}\0${result.deliveryId}`;
      if (deliveries.has(key)) return json({ ok: true, duplicate: true });
      deliveries.set(key, t + DELIVERY_TTL_MS);
    }
    const known = await engine.poke(providerId, result.taskId);
    log.log('info', 'webhook.accepted', { provider: providerId, task: result.taskId, known });
    return json({ ok: true });
  };

  const route = async (req: Request, info: RequestInfo | undefined, path: string): Promise<Response> => {
    const method = req.method.toUpperCase();
    const parts = path.split('/').filter(Boolean); // ['v1', …]
    if (parts[0] !== 'v1') return notFound();
    if (parts[1] === 'hooks' && parts.length === 3 && method === 'POST') return hook(req, parts[2] as string);

    // Unsafe methods from a browser origin that is neither this one nor allowed are refused (session cookies, M4b).
    const origin = req.headers.get('origin');
    if (
      origin !== null &&
      method !== 'GET' &&
      origin !== new URL(req.url).origin &&
      !config.allowedOrigins.includes(origin)
    )
      throw new ApiError('unauthorized', 'This origin may not use the gateway.');
    const principal = await principalOf(req, info);
    if (principal === null) throw new ApiError('unauthorized', 'Authentication required.');

    const [, a, b, c] = parts;
    if (a === 'providers' && b === undefined && method === 'GET') return json(await providersBody());
    if (a === 'uploads' && b === undefined && method === 'POST') return upload(req, principal);
    if (a === 'quote' && b === undefined && method === 'POST') {
      const parsed = parseGenRequest(await readJson(req));
      if (!parsed.ok) throw new ApiError('invalid-request', parsed.errors.join('; '));
      return json(await engine.quote(principal, parsed.value));
    }
    if (a === 'jobs' && b === undefined && method === 'POST') {
      const parsed = parseGenRequest(await readJson(req));
      if (!parsed.ok) throw new ApiError('invalid-request', parsed.errors.join('; '));
      const header = req.headers.get(GEN_HEADERS.idempotencyKey);
      if (header !== null && header !== parsed.value.idempotencyKey)
        throw new ApiError('invalid-request', 'The Idempotency-Key header and the body disagree.');
      const byo = req.headers.get(GEN_HEADERS.providerKey);
      if (byo !== null) log.addSecret(byo);
      const { job, created } = await engine.create(principal, parsed.value, byo);
      return json(job, created ? 201 : 200);
    }
    if (a === 'jobs' && b === undefined && method === 'GET') return json({ jobs: await engine.list(principal) });
    if (a === 'jobs' && b !== undefined && c === undefined && method === 'GET')
      return json(await engine.get(principal, b));
    if (a === 'jobs' && b !== undefined && c === undefined && method === 'DELETE')
      return json(await engine.cancel(principal, b));
    if (a === 'jobs' && b !== undefined && c === 'events' && parts.length === 4 && method === 'GET')
      return events(req, principal, b);
    if (a === 'artifacts' && b !== undefined && c === undefined && method === 'GET') return artifact(principal, b);
    return notFound();
  };

  return {
    enabled: true,
    marker: GATEWAY_MARKER,
    async handle(req, info) {
      const url = new URL(req.url);
      if (base !== '' && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return notFound();
      const path = url.pathname.slice(base.length) || '/';
      if (req.method.toUpperCase() === 'OPTIONS') {
        const cors = corsHeaders(req);
        if (Object.keys(cors).length === 0) return notFound();
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
            'access-control-allow-headers': ALLOW_HEADERS.join(', '),
            'access-control-max-age': '600',
          },
        });
      }
      try {
        const res = await route(req, info, path);
        for (const [k, v] of Object.entries(corsHeaders(req))) if (!res.headers.has(k)) res.headers.set(k, v);
        return res;
      } catch (err) {
        if (err instanceof ApiError) {
          const res = errorResponse(err);
          for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
          return res;
        }
        log.log('error', 'gateway.error', { path, error: err });
        return errorResponse(new ApiError('internal', 'The gateway failed.', { retryable: true }));
      }
    },
    start: () => engine.start(),
    close: () => engine.close(),
  };
}
