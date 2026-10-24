// Contract tests on recorded exchanges (G-c): each case drives one adapter call through a fake network that checks
// the exact request the adapter sends (method, path, auth header, JSON body) and answers the recorded response.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GenRequest, ImageMime } from '@ekza-studio/gen-core';
import {
  createEgress,
  createMeshyAdapter,
  createTripoAdapter,
  type ProviderAdapter,
  type ProviderStatus,
  silentLogger,
} from '../src/index.ts';
import { makeCubeGlb, makePng } from '../src/testing/index.ts';

interface Exchange {
  request: { method: string; path: string; json?: Record<string, unknown>; multipart?: boolean };
  response: { status: number; headers?: Record<string, string>; json: unknown };
}
interface SubmitCall {
  kind: 'submit';
  stage: number;
  request: Omit<GenRequest, 'idempotencyKey' | 'maxCostUsd' | 'attestation'>;
  images?: ImageMime[];
  source?: { taskId: string } | { bytes: 'cube' };
  previousTaskId?: string;
}
interface TaskCall {
  kind: 'status' | 'cancel';
  op: GenRequest['op'];
  stage: number;
  taskId: string;
}
interface Case {
  name: string;
  call: SubmitCall | TaskCall;
  exchanges: Exchange[];
  expect: Record<string, unknown>;
}
interface Recording {
  provider: string;
  source: string;
  cases: Case[];
}

const KEY = 'recorded-key-0123456789';

const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** Differences between an actual JSON value and the recorded one (`{ $startsWith }` matches a prefix). */
function diff(actual: unknown, expected: unknown, path: string, out: string[]): void {
  if (typeof expected === 'object' && expected !== null && '$startsWith' in expected) {
    const prefix = String(expected.$startsWith);
    if (typeof actual !== 'string' || !actual.startsWith(prefix)) out.push(`${path}: does not start with ${prefix}`);
    return;
  }
  if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
      out.push(`${path}: expected an object`);
      return;
    }
    const a = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(expected)]);
    for (const k of keys) {
      if (!(k in expected)) out.push(`${path}.${k}: unexpected field`);
      else diff(a[k], (expected as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
    return;
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    out.push(`${path}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
}

/** A network that answers the recorded responses in order and records every mismatch of the requests. */
function fakeNetwork(adapter: ProviderAdapter, exchanges: Exchange[], problems: string[]): typeof fetch {
  const queue = [...exchanges];
  const base = new URL(adapter.apiBase);
  return async (input: string | URL | Request, init?: RequestInit) => {
    const next = queue.shift();
    if (next === undefined) {
      problems.push('unexpected extra request');
      return new Response('{}', { status: 500 });
    }
    const url = new URL(urlOf(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.origin !== base.origin) problems.push(`origin ${url.origin}`);
    if (url.pathname !== `${base.pathname}${next.request.path}`) problems.push(`path ${url.pathname}`);
    if (method !== next.request.method) problems.push(`method ${method}`);
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${KEY}`) problems.push('authorization header');
    if (next.request.multipart === true && !(init?.body instanceof FormData)) problems.push('expected multipart');
    if (next.request.json !== undefined) diff(JSON.parse(init?.body as string), next.request.json, 'body', problems);
    return new Response(JSON.stringify(next.response.json), {
      status: next.response.status,
      headers: { 'content-type': 'application/json', ...next.response.headers },
    });
  };
}

function load(file: string): Recording {
  return JSON.parse(readFileSync(join(__dirname, 'recorded', file), 'utf8')) as Recording;
}

function context(adapter: ProviderAdapter, c: Case, problems: string[]) {
  const http = createEgress(
    { apiBase: adapter.apiBase, downloadHosts: adapter.downloadHosts },
    fakeNetwork(adapter, c.exchanges, problems),
  );
  return { key: KEY, http, log: silentLogger };
}

/** Plans and submits a recorded create; resolves to `{ taskId }` or the thrown error. */
async function runSubmit(adapter: ProviderAdapter, c: Case, call: SubmitCall, problems: string[]): Promise<unknown> {
  const request: GenRequest = {
    ...call.request,
    idempotencyKey: 'recorded-0123456789',
    maxCostUsd: 5,
    attestation: { tier: 'paid' },
  };
  const images = (call.images ?? []).map((mime) => ({ bytes: makePng(), mime, sha256: '0'.repeat(64) }));
  const src = call.source;
  const source =
    src === undefined
      ? null
      : { sha256: '1'.repeat(64), bytes: makeCubeGlb(), taskId: 'taskId' in src ? src.taskId : null };
  const plan = adapter.plan(request, {
    imageMimes: images.map((i) => i.mime),
    source: source === null ? null : source.taskId !== null ? 'own-task' : 'bytes',
  });
  return adapter
    .submit(call.stage, {
      ...context(adapter, c, problems),
      op: request.op,
      params: plan.params,
      input: call.stage === 0 ? { request, images, source } : null,
      previousTaskId: call.previousTaskId ?? null,
    })
    .then(
      (r) => r,
      (e: unknown) => e,
    );
}

const pairs = (outputs: ProviderStatus['outputs']): { role: string; url: string }[] =>
  outputs.map((o) => ({ role: o.role, url: o.url }));

function suite(adapter: ProviderAdapter, rec: Recording): void {
  it('documents where the recording comes from', () => {
    expect(rec.provider).toBe(adapter.id);
    expect(rec.source).toMatch(/2026-10-24/);
  });
  const submits = rec.cases.filter((c): c is Case & { call: SubmitCall } => c.call.kind === 'submit');
  it.each(submits.filter((x) => !('error' in x.expect)))('$name', async (c) => {
    const problems: string[] = [];
    const result = await runSubmit(adapter, c, c.call, problems);
    expect(problems).toEqual([]);
    expect(result).toEqual({ taskId: c.expect['taskId'] });
  });
  it.each(submits.filter((x) => 'error' in x.expect))('$name', async (c) => {
    const problems: string[] = [];
    const result = await runSubmit(adapter, c, c.call, problems);
    expect(problems).toEqual([]);
    expect(result).toMatchObject({ name: 'ProviderError', ...(c.expect['error'] as object) });
  });
  const tasks = rec.cases.filter((c): c is Case & { call: TaskCall } => c.call.kind !== 'submit');
  it.each(tasks.filter((x) => x.call.kind === 'status'))('$name', async (c) => {
    const problems: string[] = [];
    const st = await adapter.status(c.call.stage, c.call.taskId, {
      ...context(adapter, c, problems),
      op: c.call.op,
      params: {},
    });
    const { outputs, ...rest } = c.expect as { outputs?: { role: string; url: string }[] };
    expect(problems).toEqual([]);
    expect(st).toMatchObject(rest);
    expect(pairs(st.outputs)).toEqual(outputs ?? pairs(st.outputs));
  });
  it.each(tasks.filter((x) => x.call.kind === 'cancel'))('$name', async (c) => {
    const problems: string[] = [];
    const outcome = await (adapter.cancel ?? (async () => 'unsupported' as const))(c.call.stage, c.call.taskId, {
      ...context(adapter, c, problems),
      op: c.call.op,
      params: {},
    });
    expect(problems).toEqual([]);
    expect(outcome).toBe(c.expect['cancel']);
  });
}

describe('Tripo recorded exchanges', () => {
  suite(createTripoAdapter(), load('tripo-v3.json'));
});

describe('Meshy recorded exchanges', () => {
  suite(createMeshyAdapter(), load('meshy-openapi.json'));
});

describe('adapter invariants', () => {
  it('pins model versions and never sends the retired Meshy low-poly mode', () => {
    const models = [createTripoAdapter(), createMeshyAdapter()].flatMap((a) => Object.values(a.models));
    expect(models.filter((m) => m === '' || /latest/i.test(m))).toEqual([]);
    expect(JSON.stringify(createMeshyAdapter())).not.toContain('lowpoly');
  });

  it('quotes in credits at the provider rate and refuses out-of-range budgets', () => {
    const tripo = createTripoAdapter();
    const meshy = createMeshyAdapter();
    const req = (over: Partial<GenRequest>): GenRequest => ({
      provider: 'x',
      op: 'text-to-model',
      prompt: 'p',
      params: {},
      idempotencyKey: 'k'.repeat(16),
      maxCostUsd: 1,
      attestation: { tier: 'paid' },
      ...over,
    });
    const none = { imageMimes: [], source: null } as const;
    expect(tripo.plan(req({ params: { texture: 'none' } }), none).credits).toBe(30);
    expect(tripo.plan(req({ params: { lowPoly: false } }), none)).toMatchObject({
      model: 'v3.1-20260211',
      credits: 20,
    });
    expect(tripo.plan(req({ params: { quad: true } }), none)).toMatchObject({ model: 'P2-20260801', credits: 110 });
    expect(() => tripo.plan(req({ params: { faceLimit: 30_000 } }), none)).toThrow(/50–20000/);
    expect(meshy.plan(req({ params: { texture: 'pbr' } }), none)).toMatchObject({
      stages: ['preview', 'refine'],
      credits: 15,
    });
    expect(() => meshy.plan(req({ params: { quad: true } }), none)).toThrow(/triangles/);
    expect(() => meshy.plan(req({ prompt: 'x'.repeat(801) }), none)).toThrow(/800/);
    expect(tripo.usdPerCredit).toBe(0.01);
    expect(meshy.usdPerCredit).toBe(0.02);
  });
});
