// The mock provider server (ADR 0017 §11, research 15 §8): Tripo-like (`/tripo/v3`) and Meshy-like (`/meshy/openapi`)
// state machines on one local port, with scripted faults — 401/402/429 (with and without Retry-After), 5xx, content
// policy blocks, a Meshy step-back, create requests that create the task and then never answer or drop the
// connection, expired, partial and invalid downloads. Paid APIs are never called in CI; point the gateway at this
// server with GEN_TRIPO_BASE_URL / GEN_MESHY_BASE_URL.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeCubeGlb, makePng } from './fixtures.ts';

export type MockProvider = 'tripo' | 'meshy';

export type MockFault = { readonly provider?: MockProvider; readonly times?: number } & (
  | { readonly on: 'create'; readonly kind: 'status'; readonly status: number; readonly code?: number; readonly retryAfterS?: number; readonly message?: string }
  /** The task is created, then the response never comes (the client times out). */
  | { readonly on: 'create'; readonly kind: 'hang' }
  /** The task is created, then the connection is dropped before any response. */
  | { readonly on: 'create'; readonly kind: 'drop' }
  | { readonly on: 'status'; readonly kind: 'status'; readonly status: number; readonly retryAfterS?: number }
  /** Meshy: the next running task steps back to PENDING once. */
  | { readonly on: 'status'; readonly kind: 'step-back' }
  | { readonly on: 'task'; readonly kind: 'outcome'; readonly outcome: 'failed' | 'banned' | 'expired' | 'moderation' }
  | { readonly on: 'download'; readonly kind: 'status'; readonly status: number }
  | { readonly on: 'download'; readonly kind: 'truncate' }
  | { readonly on: 'download'; readonly kind: 'garbage' }
);

export interface MockRequest {
  readonly provider: MockProvider | 'files';
  readonly method: string;
  readonly path: string;
  readonly auth: string | null;
  readonly json: unknown;
}

export interface MockTask {
  readonly id: string;
  readonly provider: MockProvider;
  readonly kind: string; // 'text' | 'image' | 'decimate' | 'rig' | 'preview' | 'refine' | 'remesh' | 'rigging'
  readonly body: Record<string, unknown>;
  polls: number;
  outcome: 'success' | 'failed' | 'banned' | 'expired' | 'moderation' | 'canceled';
  stepBack: boolean;
  readonly credits: number;
}

export interface MockProviderServer {
  readonly origin: string;
  readonly tripoBase: string;
  readonly meshyBase: string;
  readonly keys: { readonly tripo: string; readonly meshy: string };
  readonly requests: readonly MockRequest[];
  readonly tasks: ReadonlyMap<string, MockTask>;
  creates(provider?: MockProvider): number;
  inject(...faults: MockFault[]): void;
  close(): Promise<void>;
}

export interface MockOptions {
  /** The status poll at which a task ends (default 2: queued, running, then the outcome). */
  readonly pollsToFinish?: number;
  /** Status polls a provider's tasks stay queued (default 1). */
  readonly pollsQueued?: Partial<Record<MockProvider, number>>;
  /** The model bytes a finished task serves (default: a cube GLB). */
  readonly modelBytes?: (task: MockTask) => Uint8Array;
  readonly keys?: { readonly tripo?: string; readonly meshy?: string };
}

async function readAll(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

function send(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
}

const TRIPO_CREDITS: Record<string, number> = { text: 40, image: 50, decimate: 35, rig: 25 };

export async function startMockProviders(opts?: MockOptions): Promise<MockProviderServer> {
  const keys = { tripo: opts?.keys?.tripo ?? 'mock-tripo-key-0123456789', meshy: opts?.keys?.meshy ?? 'mock-meshy-key-0123456789' };
  const pollsToFinish = opts?.pollsToFinish ?? 2;
  const faults: (MockFault & { left: number })[] = [];
  const requests: MockRequest[] = [];
  const tasks = new Map<string, MockTask>();
  const tokens = new Set<string>();
  const hanging = new Set<ServerResponse>();
  let origin = '';

  const takeFault = <K extends MockFault['on']>(on: K, provider: MockProvider): (MockFault & { on: K }) | null => {
    const i = faults.findIndex((f) => f.on === on && (f.provider === undefined || f.provider === provider));
    if (i < 0) return null;
    const f = faults[i] as MockFault & { on: K; left: number };
    f.left -= 1;
    if (f.left <= 0) faults.splice(i, 1);
    return f;
  };

  const newTask = (provider: MockProvider, kind: string, body: Record<string, unknown>, credits: number): MockTask => {
    const id = provider === 'tripo' ? `task_${randomUUID().replace(/-/g, '')}` : randomUUID();
    const outcomeFault = takeFault('task', provider);
    const t: MockTask = {
      id,
      provider,
      kind,
      body,
      polls: 0,
      outcome: outcomeFault?.kind === 'outcome' ? outcomeFault.outcome : 'success',
      stepBack: false,
      credits,
    };
    tasks.set(id, t);
    return t;
  };

  /** 'queued' | 'running' | the outcome, advancing one poll. */
  const advance = (t: MockTask): 'queued' | 'running' | MockTask['outcome'] => {
    if (t.outcome === 'canceled') return 'canceled';
    t.polls += 1;
    if (t.stepBack) {
      t.stepBack = false;
      return 'queued';
    }
    if (t.polls <= (opts?.pollsQueued?.[t.provider] ?? 1)) return 'queued';
    if (t.polls <= pollsToFinish) return 'running';
    return t.outcome;
  };

  /** Applies a create fault: true when the response has been handled. */
  const createFault = (res: ServerResponse, provider: MockProvider, create: () => void): boolean => {
    const f = takeFault('create', provider);
    if (f === null) return false;
    if (f.kind === 'hang') {
      create();
      hanging.add(res);
      return true;
    }
    if (f.kind === 'drop') {
      create();
      res.socket?.destroy();
      return true;
    }
    send(
      res,
      f.status,
      provider === 'tripo'
        ? { code: f.code ?? (f.status === 429 ? 2000 : f.status === 401 ? 1001 : 1), status: 'error', message: f.message ?? 'mock fault' }
        : { message: f.message ?? (f.status === 429 ? 'Rate limit exceeded' : 'mock fault') },
      f.retryAfterS === undefined ? undefined : { 'retry-after': String(f.retryAfterS) },
    );
    return true;
  };

  const statusFault = (res: ServerResponse, provider: MockProvider, t: MockTask | undefined): boolean => {
    const f = takeFault('status', provider);
    if (f === null) return false;
    if (f.kind === 'step-back') {
      if (t) t.stepBack = true;
      return false;
    }
    send(res, f.status, { message: 'mock status fault' }, f.retryAfterS === undefined ? undefined : { 'retry-after': String(f.retryAfterS) });
    return true;
  };

  const tripo = async (req: IncomingMessage, res: ServerResponse, path: string, raw: Buffer, json: unknown): Promise<void> => {
    if (req.headers.authorization !== `Bearer ${keys.tripo}`) {
      send(res, 401, { code: 1001, status: 'error', message: 'Authentication required' });
      return;
    }
    const body = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
    if (req.method === 'POST' && path === '/files') {
      if (!raw.includes(Buffer.from('name="file"'))) {
        send(res, 400, { code: 2003, status: 'error', message: 'empty file' });
        return;
      }
      const token = `file_${randomUUID().replace(/-/g, '')}`;
      tokens.add(token);
      send(res, 200, { code: 0, data: { file_token: token } });
      return;
    }
    const creates: Record<string, string> = {
      '/generation/text-to-model': 'text',
      '/generation/image-to-model': 'image',
      '/mesh/decimate': 'decimate',
      '/animations/rig': 'rig',
    };
    const kind = req.method === 'POST' ? creates[path] : undefined;
    if (kind !== undefined) {
      const model = body['model'];
      if (typeof model !== 'string' || model === 'latest' || model === '') {
        send(res, 400, { code: 2002, status: 'error', message: 'model must be pinned' });
        return;
      }
      if (kind === 'text' && typeof body['prompt'] !== 'string') {
        send(res, 400, { code: 2002, status: 'error', message: 'prompt required' });
        return;
      }
      if (kind !== 'text') {
        const input = body['input'];
        if (typeof input !== 'string' || !(tokens.has(input) || tasks.has(input))) {
          send(res, 400, { code: 2002, status: 'error', message: 'unknown input' });
          return;
        }
      }
      if (kind === 'rig' && (body['model'] !== 'v3.0-20260909' || body['spec'] === undefined)) {
        send(res, 400, { code: 2002, status: 'error', message: 'spec needs rig model v3.0' });
        return;
      }
      let task: MockTask | null = null;
      const create = (): void => {
        task = newTask('tripo', kind, body, kind === 'text' && body['texture'] === false ? 30 : (TRIPO_CREDITS[kind] ?? 10));
      };
      if (createFault(res, 'tripo', create)) return;
      create();
      send(res, 200, { code: 0, data: { task_id: (task as MockTask | null)?.id } });
      return;
    }
    const m = /^\/tasks\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && m) {
      const t = tasks.get(m[1] as string);
      if (statusFault(res, 'tripo', t)) return;
      if (t === undefined) {
        send(res, 404, { code: 2001, status: 'error', message: 'task not found' });
        return;
      }
      const st = advance(t);
      const status =
        st === 'success' ? 'success' : st === 'moderation' ? 'banned' : st === 'canceled' ? 'cancelled' : st;
      const data: Record<string, unknown> = {
        task_id: t.id,
        type: t.kind,
        status,
        progress: st === 'queued' ? 0 : st === 'running' ? 50 : 100,
      };
      if (st === 'success') {
        data['output'] = { model_url: `${origin}/files/${t.id}.glb`, rendered_image_url: `${origin}/files/${t.id}.png` };
        data['credits_consumed'] = t.credits;
      }
      if (st === 'failed') {
        data['error_code'] = 1;
        data['error_message'] = 'mock failure';
        data['credits_consumed'] = 0;
      }
      send(res, 200, { code: 0, data });
      return;
    }
    send(res, 404, { code: 404, status: 'error', message: 'not found' });
  };

  const MESHY_COLLECTIONS: Record<string, string> = {
    '/v2/text-to-3d': 'text',
    '/v1/image-to-3d': 'image',
    '/v1/remesh': 'remesh',
    '/v1/rigging': 'rigging',
  };

  const meshy = async (req: IncomingMessage, res: ServerResponse, path: string, json: unknown): Promise<void> => {
    if (req.headers.authorization !== `Bearer ${keys.meshy}`) {
      send(res, 401, { message: 'Invalid API key' });
      return;
    }
    const body = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
    const coll = MESHY_COLLECTIONS[path];
    if (req.method === 'POST' && coll !== undefined) {
      if (body['model_type'] === 'lowpoly') {
        send(res, 400, { message: 'model_type lowpoly is retired' });
        return;
      }
      let kind = coll;
      let credits = 5;
      if (coll === 'text') {
        if (body['mode'] === 'refine') {
          const prev = tasks.get(String(body['preview_task_id']));
          if (prev === undefined || prev.kind !== 'preview') {
            send(res, 400, { message: 'unknown preview_task_id' });
            return;
          }
          kind = 'refine';
          credits = 10;
        } else if (body['mode'] === 'preview' && typeof body['prompt'] === 'string') {
          kind = 'preview';
        } else {
          send(res, 400, { message: 'mode and prompt required' });
          return;
        }
      }
      if (coll === 'image') {
        if (typeof body['image_url'] !== 'string' || !String(body['image_url']).startsWith('data:image/')) {
          send(res, 400, { message: 'image_url must be a URL or data URI' });
          return;
        }
        credits = body['should_texture'] === false ? 5 : 15;
      }
      if ((coll === 'remesh' || coll === 'rigging') && body['input_task_id'] === undefined) {
        if (typeof body['model_url'] !== 'string' || !String(body['model_url']).startsWith('data:application/octet-stream;base64,')) {
          send(res, 400, { message: 'input_task_id or model_url required' });
          return;
        }
      }
      if ((kind === 'preview' || kind === 'image') && body['ai_model'] !== 'meshy-t2.5') {
        send(res, 400, { message: 'mock expects the pinned meshy-t2.5' });
        return;
      }
      let task: MockTask | null = null;
      const create = (): void => {
        task = newTask('meshy', kind, body, credits);
      };
      if (createFault(res, 'meshy', create)) return;
      create();
      send(res, 202, { result: (task as MockTask | null)?.id });
      return;
    }
    const m = /^(\/v[12]\/[a-z0-9-]+)\/([^/]+)$/.exec(path);
    if (m && MESHY_COLLECTIONS[m[1] as string] !== undefined) {
      const t = tasks.get(m[2] as string);
      if (req.method === 'DELETE') {
        if (t === undefined) send(res, 404, { message: 'not found' });
        else if (t.polls <= (opts?.pollsQueued?.meshy ?? 1) && t.outcome !== 'canceled') {
          t.outcome = 'canceled';
          send(res, 200, {});
        } else send(res, 409, { message: 'Task is in progress' });
        return;
      }
      if (req.method === 'GET') {
        if (statusFault(res, 'meshy', t)) return;
        if (t === undefined) {
          send(res, 404, { message: 'Task not found' });
          return;
        }
        const st = advance(t);
        const status = {
          queued: 'PENDING',
          running: 'IN_PROGRESS',
          success: 'SUCCEEDED',
          failed: 'FAILED',
          moderation: 'FAILED',
          banned: 'FAILED',
          expired: 'FAILED',
          canceled: 'CANCELED',
        }[st];
        const task: Record<string, unknown> = {
          id: t.id,
          type: t.kind,
          status,
          progress: st === 'queued' ? 0 : st === 'running' ? 50 : 100,
          consumed_credits: st === 'success' ? t.credits : 0,
        };
        if (st === 'success') {
          if (t.kind === 'rigging') task['result'] = { rigged_character_glb_url: `${origin}/files/${t.id}.glb` };
          else task['model_urls'] = { glb: `${origin}/files/${t.id}.glb` };
          task['thumbnail_url'] = `${origin}/files/${t.id}.png`;
        }
        if (st === 'failed' || st === 'expired') task['task_error'] = { type: 'server_error', message: 'mock failure' };
        if (st === 'moderation' || st === 'banned')
          task['task_error'] = { type: 'invalid_input', message: 'The input was flagged by content moderation.' };
        send(res, 200, task, { 'retry-after': '1' });
        return;
      }
    }
    send(res, 404, { message: 'not found' });
  };

  const files = (res: ServerResponse, path: string): void => {
    const m = /^\/files\/([^/.]+)\.(glb|png)$/.exec(path);
    const t = m ? tasks.get(m[1] as string) : undefined;
    if (!m || t === undefined) {
      res.writeHead(404).end();
      return;
    }
    const f = takeFault('download', t.provider);
    if (f?.kind === 'status') {
      res.writeHead(f.status).end();
      return;
    }
    const bytes =
      m[2] === 'png' ? makePng(64, 64) : f?.kind === 'garbage' ? new TextEncoder().encode('not a glb at all') : (opts?.modelBytes?.(t) ?? makeCubeGlb({ size: 1 + (t.polls % 7) / 10 }));
    if (f?.kind === 'truncate') {
      res.writeHead(200, { 'content-length': String(bytes.length + 100) });
      res.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
      res.socket?.destroy();
      return;
    }
    res.writeHead(200, { 'content-type': m[2] === 'png' ? 'image/png' : 'model/gltf-binary', 'content-length': String(bytes.length) }).end(bytes);
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://mock');
      const raw = await readAll(req);
      let json: unknown = null;
      if ((req.headers['content-type'] ?? '').startsWith('application/json')) {
        try {
          json = JSON.parse(raw.toString('utf8'));
        } catch {
          json = null;
        }
      }
      const provider = url.pathname.startsWith('/tripo/') ? 'tripo' : url.pathname.startsWith('/meshy/') ? 'meshy' : 'files';
      requests.push({ provider, method: req.method ?? 'GET', path: url.pathname, auth: req.headers.authorization ?? null, json });
      if (provider === 'tripo') await tripo(req, res, url.pathname.slice('/tripo/v3'.length), raw, json);
      else if (provider === 'meshy') await meshy(req, res, url.pathname.slice('/meshy/openapi'.length), json);
      else files(res, url.pathname);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    tripoBase: `${origin}/tripo/v3`,
    meshyBase: `${origin}/meshy/openapi`,
    keys,
    requests,
    tasks,
    creates(provider) {
      return [...tasks.values()].filter((t) => provider === undefined || t.provider === provider).length;
    },
    inject(...fs) {
      for (const f of fs) faults.push({ ...f, left: f.times ?? 1 });
    },
    async close() {
      for (const res of hanging) res.socket?.destroy();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
