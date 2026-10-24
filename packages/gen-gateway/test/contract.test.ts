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
  ProviderError,
  silentLogger,
} from '../src/index.ts';
import { makeCubeGlb, makePng } from '../src/testing/index.ts';

type Matcher = unknown;
interface Exchange {
  request: { method: string; path: string; json?: Record<string, Matcher>; multipart?: boolean };
  response: { status: number; headers?: Record<string, string>; json: unknown };
}
interface Case {
  name: string;
  call:
    | {
        kind: 'submit';
        stage: number;
        request: Omit<GenRequest, 'idempotencyKey' | 'maxCostUsd' | 'attestation'>;
        images?: ImageMime[];
        source?: { taskId: string } | { bytes: 'cube' };
        previousTaskId?: string;
      }
    | { kind: 'status' | 'cancel'; op: GenRequest['op']; stage: number; taskId: string };
  exchanges: Exchange[];
  expect: Record<string, unknown>;
}
interface Recording {
  provider: string;
  source: string;
  cases: Case[];
}

const KEY = 'recorded-key-0123456789';

function matches(actual: unknown, expected: Matcher, path: string): void {
  if (expected !== null && typeof expected === 'object' && '$startsWith' in (expected as object)) {
    expect(typeof actual, path).toBe('string');
    expect(String(actual).startsWith(String((expected as { $startsWith: string }).$startsWith)), path).toBe(true);
    return;
  }
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    expect(actual !== null && typeof actual === 'object', path).toBe(true);
    const a = actual as Record<string, unknown>;
    expect(Object.keys(a).sort(), `${path} keys`).toEqual(Object.keys(expected as object).sort());
    for (const [k, v] of Object.entries(expected as object)) matches(a[k], v, `${path}.${k}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}

function fakeNetwork(adapter: ProviderAdapter, exchanges: Exchange[]): typeof fetch {
  const queue = [...exchanges];
  const base = new URL(adapter.apiBase);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected request');
    const url = new URL(String(input));
    expect(url.origin).toBe(base.origin);
    expect(url.pathname).toBe(`${base.pathname}${next.request.path}`);
    expect((init?.method ?? 'GET').toUpperCase()).toBe(next.request.method);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    if (next.request.multipart) expect(init?.body).toBeInstanceOf(FormData);
    if (next.request.json !== undefined) matches(JSON.parse(String(init?.body)), next.request.json, 'body');
    return new Response(JSON.stringify(next.response.json), {
      status: next.response.status,
      headers: { 'content-type': 'application/json', ...next.response.headers },
    });
  }) as typeof fetch;
}

const recordings: [ProviderAdapter, Recording][] = [
  [createTripoAdapter(), JSON.parse(readFileSync(join(__dirname, 'recorded/tripo-v3.json'), 'utf8')) as Recording],
  [createMeshyAdapter(), JSON.parse(readFileSync(join(__dirname, 'recorded/meshy-openapi.json'), 'utf8')) as Recording],
];

for (const [adapter, rec] of recordings) {
  describe(`${rec.provider} recorded exchanges`, () => {
    it('documents where the recording comes from', () => {
      expect(rec.provider).toBe(adapter.id);
      expect(rec.source).toMatch(/2026-10-24/);
    });
    for (const c of rec.cases) {
      it(c.name, async () => {
        const http = createEgress({ apiBase: adapter.apiBase, downloadHosts: adapter.downloadHosts }, fakeNetwork(adapter, c.exchanges));
        const base = { key: KEY, http, log: silentLogger };
        if (c.call.kind === 'submit') {
          const request: GenRequest = {
            ...c.call.request,
            idempotencyKey: 'recorded-0123456789',
            maxCostUsd: 5,
            attestation: { tier: 'paid' },
          };
          const images = (c.call.images ?? []).map((mime) => ({ bytes: makePng(), mime, sha256: '0'.repeat(64) }));
          const src = c.call.source;
          const source =
            src === undefined
              ? null
              : 'taskId' in src
                ? { sha256: '1'.repeat(64), bytes: makeCubeGlb(), taskId: src.taskId }
                : { sha256: '1'.repeat(64), bytes: makeCubeGlb(), taskId: null };
          const plan = adapter.plan(request, {
            imageMimes: images.map((i) => i.mime),
            source: source === null ? null : source.taskId !== null ? 'own-task' : 'bytes',
          });
          const run = adapter.submit(c.call.stage, {
            ...base,
            op: request.op,
            params: plan.params,
            input: c.call.stage === 0 ? { request, images, source } : null,
            previousTaskId: c.call.previousTaskId ?? null,
          });
          if ('error' in c.expect) {
            const err = await run.then(
              () => null,
              (e: unknown) => e,
            );
            expect(err).toBeInstanceOf(ProviderError);
            expect(err).toMatchObject(c.expect['error'] as object);
          } else {
            expect(await run).toEqual({ taskId: c.expect['taskId'] });
          }
        } else if (c.call.kind === 'status') {
          const st = await adapter.status(c.call.stage, c.call.taskId, { ...base, op: c.call.op, params: {} });
          const { outputs, ...rest } = c.expect as { outputs?: { role: string; url: string }[] };
          expect(st).toMatchObject(rest);
          if (outputs !== undefined) expect(st.outputs.map((o) => ({ role: o.role, url: o.url }))).toEqual(outputs);
        } else {
          expect(adapter.cancel).toBeDefined();
          expect(await adapter.cancel?.(c.call.stage, c.call.taskId, { ...base, op: c.call.op, params: {} })).toBe(c.expect['cancel']);
        }
      });
    }
  });
}

describe('adapter invariants', () => {
  it('pins model versions and never sends the retired Meshy low-poly mode', () => {
    for (const a of [createTripoAdapter(), createMeshyAdapter()]) {
      for (const model of Object.values(a.models)) {
        expect(model).not.toMatch(/latest/i);
        expect(model).not.toBe('');
      }
      expect(JSON.stringify(a)).not.toContain('lowpoly');
    }
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
    expect(tripo.plan(req({ params: { lowPoly: false } }), none)).toMatchObject({ model: 'v3.1-20260211', credits: 20 });
    expect(tripo.plan(req({ params: { quad: true } }), none)).toMatchObject({ model: 'P2-20260801', credits: 110 });
    expect(() => tripo.plan(req({ params: { faceLimit: 30_000 } }), none)).toThrow(/50–20000/);
    expect(meshy.plan(req({ params: { texture: 'pbr' } }), none)).toMatchObject({ stages: ['preview', 'refine'], credits: 15 });
    expect(() => meshy.plan(req({ params: { quad: true } }), none)).toThrow(/triangles/);
    expect(() => meshy.plan(req({ prompt: 'x'.repeat(801) }), none)).toThrow(/800/);
    expect(tripo.usdPerCredit).toBe(0.01);
    expect(meshy.usdPerCredit).toBe(0.02);
  });
});
