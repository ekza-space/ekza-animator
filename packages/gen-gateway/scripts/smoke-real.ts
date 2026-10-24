#!/usr/bin/env node
// Manual smoke test against the REAL providers (ADR 0017 §11): never run in CI, never without an explicit spend
// confirmation. It runs the gateway in-process (memory stores, the real adapters, server caps fixed at $5 a day and a
// month whatever the environment says), prints every quote first and refuses to start when the plan could cost more
// than the cap.
//
//   TRIPO_API_KEY=… MESHY_API_KEY=… node packages/gen-gateway/scripts/smoke-real.ts --confirm-spend [--full]
//     [--out <dir>] [--record <dir>]
//
// Default plan (≈ $0.40): Meshy Smart Topology text→3D mesh only, Tripo P1 text→3D without texture.
// --full adds (≈ +$1.10): Tripo image→3D (P1, textured) from a generated PNG, a VRM-named Tripo rig of the text model,
//   and a Meshy quad remesh of the Tripo model uploaded as a GLB.
// --out writes the artifacts (GLB, thumbnails) to a directory; --record writes the provider exchanges, with keys,
//   signed URL queries and bodies over 4 kB redacted, in the format of test/recorded/*.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createGenerationClient, type GenJob, type GenRequest, isTerminal } from '@ekza-studio/gen-core';
import {
  createGateway,
  createRedactingLogger,
  defaultAdapters,
  loadGatewayConfig,
  providerEnvs,
} from '../src/index.ts';
import { makePng } from '../src/testing/index.ts';

const HARD_CAP_USD = 5;
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};

if (!flag('--confirm-spend')) {
  console.error('smoke-real: this calls paid provider APIs. Re-run with --confirm-spend (hard cap $5).');
  process.exit(2);
}
const tripoKey = (process.env['TRIPO_API_KEY'] ?? '').trim();
const meshyKey = (process.env['MESHY_API_KEY'] ?? '').trim();
if (tripoKey === '' && meshyKey === '') {
  console.error('smoke-real: set TRIPO_API_KEY and/or MESHY_API_KEY.');
  process.exit(2);
}

const outDir = option('--out');
const recordDir = option('--record');
const recorded: {
  provider: string;
  method: string;
  path: string;
  status: number;
  request: unknown;
  response: unknown;
}[] = [];

const redact = (text: string): string => {
  let out = text.replace(/\?[^"\s]*/g, '?…');
  for (const k of [tripoKey, meshyKey]) if (k !== '') out = out.split(k).join('[redacted]');
  return out.length > 4096 ? `${out.slice(0, 4096)}…[truncated]` : out;
};

/** Records provider API exchanges (not downloads) when --record is given. */
const recordingFetch: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init);
  if (recordDir === null) return res;
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  // API calls only (downloads and presigned uploads go to other hosts).
  const provider = url.hostname === 'openapi.tripo3d.ai' ? 'tripo' : url.hostname === 'api.meshy.ai' ? 'meshy' : null;
  if (provider === null) return res;
  const body = typeof init?.body === 'string' ? init.body : init?.body instanceof FormData ? '[multipart]' : null;
  const copy = res.clone();
  const text = await copy.text();
  recorded.push({
    provider,
    method: (init?.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    status: res.status,
    request: body === null ? null : redact(body),
    response: redact(text),
  });
  return res;
};

const env = {
  GEN_GATEWAY_ENABLED: '1',
  GEN_GATEWAY_TOKEN: `smoke-${crypto.randomUUID()}-${crypto.randomUUID()}`,
  GEN_CAP_DAILY_USD: String(HARD_CAP_USD),
  GEN_CAP_MONTHLY_USD: String(HARD_CAP_USD),
  TRIPO_API_KEY: tripoKey,
  MESHY_API_KEY: meshyKey,
};
const adapters = defaultAdapters();
const config = loadGatewayConfig(env, 'standalone', providerEnvs(adapters));
const gateway = createGateway({
  config,
  adapters,
  fetch: recordingFetch,
  log: createRedactingLogger((line) => console.error(line), [tripoKey, meshyKey, env.GEN_GATEWAY_TOKEN]),
});
const token = env.GEN_GATEWAY_TOKEN;
const client = createGenerationClient({
  baseUrl: 'http://gateway.local',
  token: () => token,
  pollMs: 5_000,
  fetch: (input, init) =>
    gateway.handle(
      new Request(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init),
    ),
});

let seq = 0;
const req = (r: Omit<GenRequest, 'idempotencyKey' | 'maxCostUsd' | 'attestation'>): GenRequest => ({
  ...r,
  idempotencyKey: `smoke-${Date.now()}-${++seq}`.padEnd(16, '0'),
  maxCostUsd: 2,
  attestation: { tier: 'paid' },
});

function wait(id: string): Promise<GenJob> {
  return new Promise((resolveJob, reject) => {
    const w = client.watch(
      id,
      (job) => {
        console.error(`  ${id} ${job.state}${job.progress === null ? '' : ` ${job.progress}%`}`);
        if (isTerminal(job.state)) {
          w.close();
          resolveJob(job);
        }
      },
      reject,
    );
  });
}

async function save(job: GenJob, label: string): Promise<void> {
  if (outDir === null) return;
  mkdirSync(resolve(outDir), { recursive: true });
  for (const a of job.artifacts) {
    const bytes = await client.artifact(a);
    writeFileSync(
      join(
        resolve(outDir),
        `${label}-${a.role}-${a.sha256.slice(0, 12)}.${a.mime.split('/')[1] === 'gltf-binary' ? 'glb' : a.mime.split('/')[1]}`,
      ),
      bytes,
    );
  }
}

const plan: { label: string; make: () => Promise<GenRequest> }[] = [];
const prompt = 'a small low-poly wooden stool, flat colours';
if (meshyKey !== '')
  plan.push({
    label: 'meshy-text',
    make: async () =>
      req({ provider: 'meshy', op: 'text-to-model', prompt, params: { faceLimit: 500, texture: 'none' } }),
  });
if (tripoKey !== '')
  plan.push({
    label: 'tripo-text',
    make: async () =>
      req({ provider: 'tripo', op: 'text-to-model', prompt, params: { faceLimit: 500, texture: 'none' } }),
  });
if (tripoKey !== '' && flag('--full'))
  plan.push({
    label: 'tripo-image',
    make: async () => {
      const up = await client.upload(makePng(512, 512), 'image/png');
      return req({
        provider: 'tripo',
        op: 'image-to-model',
        images: [{ upload: up.upload }],
        params: { faceLimit: 1000 },
      });
    },
  });

try {
  const providers = await client.providers();
  console.error(
    `smoke-real: ${providers.providers.map((p) => `${p.id}=${p.configured ? 'key' : 'none'}`).join(', ')}; cap $${HARD_CAP_USD}`,
  );
  const requests: { label: string; request: GenRequest; usd: number }[] = [];
  for (const step of plan) {
    const request = await step.make();
    const q = await client.quote(request);
    console.error(`  quote ${step.label}: ${q.credits} credits ≈ $${q.usd.toFixed(2)} (${q.model})`);
    requests.push({ label: step.label, request, usd: q.usd });
  }
  const followUps = flag('--full') && tripoKey !== '' ? 0.25 + (meshyKey !== '' ? 0.1 : 0) : 0;
  const total = requests.reduce((s, r) => s + r.usd, 0) + followUps;
  if (total > HARD_CAP_USD) throw new Error(`the plan could cost $${total.toFixed(2)}, above the $${HARD_CAP_USD} cap`);
  console.error(`smoke-real: planned ≈ $${total.toFixed(2)}`);
  const results = new Map<string, GenJob>();
  for (const r of requests) {
    const job = await wait((await client.submit(r.request)).id);
    results.set(r.label, job);
    console.error(
      `  ${r.label}: ${job.state} cost ${job.costUsd ?? '?'}${job.error ? ` — ${job.error.code}: ${job.error.message}` : ''}`,
    );
    await save(job, r.label);
  }
  const tripoText = results.get('tripo-text');
  if (flag('--full') && tripoText?.state === 'succeeded') {
    const rig = await wait(
      (
        await client.submit(
          req({ provider: 'tripo', op: 'rig', source: { job: tripoText.id }, params: { skeleton: 'vrm' } }),
        )
      ).id,
    );
    console.error(`  tripo-rig: ${rig.state} cost ${rig.costUsd ?? '?'}`);
    await save(rig, 'tripo-rig');
    if (meshyKey !== '') {
      const model = tripoText.artifacts.find((a) => a.role === 'model');
      if (model) {
        const up = await client.upload(await client.artifact(model), 'model/gltf-binary');
        const remesh = await wait(
          (
            await client.submit(
              req({
                provider: 'meshy',
                op: 'retopology',
                source: { upload: up.upload },
                params: { faceLimit: 800, quad: true },
              }),
            )
          ).id,
        );
        console.error(`  meshy-remesh: ${remesh.state} cost ${remesh.costUsd ?? '?'}`);
        await save(remesh, 'meshy-remesh');
      }
    }
  }
  const caps = (await client.providers()).caps;
  console.error(
    `smoke-real: spent ≈ $${(caps.dailyUsd - caps.remainingDailyUsd).toFixed(2)} of the $${HARD_CAP_USD} cap`,
  );
} finally {
  if (recordDir !== null) {
    mkdirSync(resolve(recordDir), { recursive: true });
    writeFileSync(
      join(resolve(recordDir), `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      `${JSON.stringify(recorded, null, 2)}\n`,
    );
  }
  await gateway.close();
}
