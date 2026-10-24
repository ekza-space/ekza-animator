import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GenJob, promptSha256, sha256Hex } from '@ekza-studio/gen-core';
import { checkGlb, type JobRow, MemoryBlobStore, MemoryJobStore, TRIPO_MODELS } from '../src/index.ts';
import { FileBlobStore, FileJobStore, openFileStores } from '../src/node/index.ts';
import { makeCubeGlb, makePng, startMockProviders } from '../src/testing/index.ts';
import { request, setup, TOKEN, untilDone } from './helpers.ts';

const PROMPT = 'a low-poly wooden chair, flat colours';

describe('jobs against the mock providers', () => {
  it('Tripo image → P1 model: upload, quote, submit, SSE, artifact by SHA-256, provenance', async () => {
    const s = await setup();
    try {
      const png = makePng();
      const up = await s.client.upload(png, 'image/png');
      const req = request({
        provider: 'tripo',
        op: 'image-to-model',
        images: [{ upload: up.upload }],
        params: { faceLimit: 3000 },
      });
      const quote = await s.client.quote(req);
      expect(quote).toMatchObject({ model: TRIPO_MODELS.p1, credits: 50, usd: 0.5, exact: true });
      const job = await s.client.submit(req);
      expect(job).toMatchObject({ state: 'queued', submitted: false, quoteUsd: 0.5, model: TRIPO_MODELS.p1 });
      const done = await untilDone(s.client, job.id);
      expect(done.state).toBe('succeeded');
      expect(done.costUsd).toBe(0.5);
      const model = done.artifacts.find((a) => a.role === 'model');
      expect(model?.mime).toBe('model/gltf-binary');
      expect(done.artifacts.some((a) => a.role === 'thumbnail' && a.mime === 'image/png')).toBe(true);
      const bytes = await s.client.artifact(model as NonNullable<typeof model>);
      expect(checkGlb(bytes).meshes).toBe(1);
      expect(done.provenance).toMatchObject({
        kind: 'ai',
        digitalSourceType: 'trainedAlgorithmicMedia',
        service: 'tripo',
        model: TRIPO_MODELS.p1,
        op: 'image-to-model',
        params: { model: TRIPO_MODELS.p1, face_limit: 3000, texture: true, pbr: false },
        inputSha256: [await sha256Hex(png)],
        rawSha256: model?.sha256,
        promptSha256: null,
        prompt: null,
        tier: 'paid',
        postSteps: [],
      });
      expect(done.provenance?.taskId).toMatch(/^task_/);
      expect(done.provenance?.termsSnapshot).toMatchObject({ termsUrl: 'https://developers.tripo3d.ai/en/terms' });
      // The provider saw a pinned model and a file token, never a URL from the client.
      const create = s.mock.requests.find((r) => r.path.endsWith('/generation/image-to-model'));
      expect(create?.json).toMatchObject({ model: 'P1-20260311', face_limit: 3000 });
      expect(JSON.stringify(create?.json)).toMatch(/"input":"file_[0-9a-f]+"/);
      expect((await s.client.jobs()).map((j) => j.id)).toContain(job.id);
    } finally {
      await s.close();
    }
  });

  it('keeps prompt text out of logs and rows; records only its hash', async () => {
    const store = new MemoryJobStore();
    const s = await setup({ store });
    try {
      const job = await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }));
      const done = await untilDone(s.client, job.id);
      expect(done.provenance?.promptSha256).toBe(await promptSha256(PROMPT));
      const row = (await store.get(job.id)) as JobRow;
      expect(JSON.stringify(row)).not.toContain('wooden chair');
      const logs = s.lines.join('\n');
      expect(logs).not.toContain('wooden chair');
      for (const secret of [TOKEN, s.mock.keys.tripo, s.mock.keys.meshy]) expect(logs).not.toContain(secret);
    } finally {
      await s.close();
    }
  });

  it('Meshy textured text-to-3D runs preview then refine and bills both stages', async () => {
    const s = await setup();
    try {
      const job = await s.client.submit(
        request({
          provider: 'meshy',
          op: 'text-to-model',
          prompt: PROMPT,
          params: { faceLimit: 500, texture: 'color', restPose: 'a' },
        }),
      );
      expect(job.quoteUsd).toBe(0.3);
      const done = await untilDone(s.client, job.id);
      expect(done).toMatchObject({ state: 'succeeded', costUsd: 0.3, model: 'meshy-t2.5' });
      const posts = s.mock.requests.filter((r) => r.method === 'POST' && r.provider === 'meshy').map((r) => r.json);
      expect(posts).toMatchObject([
        {
          mode: 'preview',
          model_type: 'smart-topology',
          ai_model: 'meshy-t2.5',
          target_polycount: 500,
          pose_mode: 'a-pose',
          moderation: true,
        },
        { mode: 'refine', enable_pbr: false, texture_resolution: '2k' },
      ]);
      expect(JSON.stringify(posts)).not.toContain('lowpoly');
      // Provenance names the refine task (the one that produced the textured model), not the preview.
      expect(done.provenance?.taskId).not.toBe((posts[1] as { preview_task_id: string }).preview_task_id);
      expect(s.mock.tasks.get(done.provenance?.taskId as string)?.kind).toBe('refine');
    } finally {
      await s.close();
    }
  });

  it('is idempotent per key and refuses a reused key with another request', async () => {
    const s = await setup();
    try {
      const req = request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT });
      const [a, b] = await Promise.all([s.client.submit(req), s.client.submit(req)]);
      expect(a.id).toBe(b.id);
      await untilDone(s.client, a.id);
      expect((await s.client.submit(req)).id).toBe(a.id);
      expect(s.mock.creates('tripo')).toBe(1);
      await expect(s.client.submit({ ...req, prompt: 'something else' })).rejects.toMatchObject({
        code: 'conflict',
        status: 409,
      });
    } finally {
      await s.close();
    }
  });

  it("refuses quotes above the request's maxCostUsd and above the server caps", async () => {
    const s = await setup({ env: { GEN_CAP_DAILY_USD: '0.6', GEN_CAP_MONTHLY_USD: '0.6' } });
    try {
      await expect(
        s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT, maxCostUsd: 0.1 })),
      ).rejects.toMatchObject({ code: 'over-budget', status: 422 });
      const first = await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }));
      await untilDone(s.client, first.id);
      await expect(
        s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT, maxCostUsd: 100 })),
      ).rejects.toMatchObject({ code: 'spend-cap', status: 402 });
      expect((await s.client.providers()).caps.remainingDailyUsd).toBe(0.2);
      expect(s.mock.creates()).toBe(1);
    } finally {
      await s.close();
    }
  });

  it('never re-sends a create that may have reached the provider (dropped connection, timeout)', async () => {
    const s = await setup();
    try {
      s.mock.inject(
        { on: 'create', kind: 'drop', provider: 'tripo' },
        { on: 'create', kind: 'hang', provider: 'meshy' },
      );
      const a = await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }));
      const b = await s.client.submit(
        request({ provider: 'meshy', op: 'text-to-model', prompt: PROMPT, params: { texture: 'none' } }),
      );
      for (const id of [a.id, b.id]) {
        const done = await untilDone(s.client, id);
        expect(done.state).toBe('failed');
        expect(done.error).toMatchObject({ code: 'timeout', retryable: false });
        expect(done.error?.message).toMatch(/not sent again/);
      }
      await new Promise((r) => setTimeout(r, 100));
      expect(s.mock.creates('tripo')).toBe(1);
      expect(s.mock.creates('meshy')).toBe(1);
      // Counted against the caps: the provider may have charged.
      expect((await s.client.providers()).caps.remainingDailyUsd).toBe(5 - 0.4 - 0.1);
    } finally {
      await s.close();
    }
  });

  it('retries a create the provider refused (429 with and without Retry-After) and fails cleanly on 402', async () => {
    const s = await setup();
    try {
      s.mock.inject(
        { on: 'create', kind: 'status', status: 429, retryAfterS: 0, provider: 'tripo' },
        { on: 'create', kind: 'status', status: 429, provider: 'tripo', message: 'NoMorePendingTasks' },
      );
      const ok = await untilDone(
        s.client,
        (await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }))).id,
      );
      expect(ok.state).toBe('succeeded');
      expect(s.mock.creates('tripo')).toBe(1);
      s.mock.inject({ on: 'create', kind: 'status', status: 402, provider: 'meshy' });
      const poor = await untilDone(
        s.client,
        (
          await s.client.submit(
            request({ provider: 'meshy', op: 'text-to-model', prompt: PROMPT, params: { texture: 'none' } }),
          )
        ).id,
      );
      expect(poor).toMatchObject({ state: 'failed', error: { code: 'insufficient-credits', retryable: false } });
      expect((await s.client.providers()).caps.remainingDailyUsd).toBe(4.6);
    } finally {
      await s.close();
    }
  });

  it('rides out status errors and a step back, and maps content-policy blocks', async () => {
    const s = await setup();
    try {
      s.mock.inject(
        { on: 'status', kind: 'status', status: 503, provider: 'meshy', times: 2 },
        { on: 'status', kind: 'step-back', provider: 'meshy' },
      );
      const ok = await untilDone(
        s.client,
        (
          await s.client.submit(
            request({ provider: 'meshy', op: 'text-to-model', prompt: PROMPT, params: { texture: 'none' } }),
          )
        ).id,
      );
      expect(ok.state).toBe('succeeded');
      s.mock.inject({ on: 'task', kind: 'outcome', outcome: 'moderation', provider: 'tripo' });
      s.mock.inject({ on: 'task', kind: 'outcome', outcome: 'moderation', provider: 'meshy' });
      const [t, m] = await Promise.all([
        s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT })),
        s.client.submit(
          request({ provider: 'meshy', op: 'text-to-model', prompt: PROMPT, params: { texture: 'none' } }),
        ),
      ]);
      for (const id of [t.id, m.id])
        expect(await untilDone(s.client, id)).toMatchObject({
          state: 'blocked',
          error: { code: 'moderation', retryable: false },
        });
      s.mock.inject({ on: 'task', kind: 'outcome', outcome: 'failed', provider: 'tripo' });
      const failed = await untilDone(
        s.client,
        (await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }))).id,
      );
      expect(failed).toMatchObject({ state: 'failed', error: { code: 'provider-failed' } });
    } finally {
      await s.close();
    }
  });

  it('downloads at once: retries a truncated body, fails on an invalid GLB, expires on 404', async () => {
    const s = await setup();
    try {
      s.mock.inject({ on: 'download', kind: 'truncate', provider: 'tripo' });
      const ok = await untilDone(
        s.client,
        (await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }))).id,
      );
      expect(ok.state).toBe('succeeded');
      s.mock.inject({ on: 'download', kind: 'garbage', provider: 'tripo' });
      const bad = await untilDone(
        s.client,
        (await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }))).id,
      );
      expect(bad).toMatchObject({ state: 'failed', error: { code: 'provider-failed' } });
      s.mock.inject({ on: 'download', kind: 'status', status: 404, provider: 'meshy' });
      const gone = await untilDone(
        s.client,
        (
          await s.client.submit(
            request({ provider: 'meshy', op: 'text-to-model', prompt: PROMPT, params: { texture: 'none' } }),
          )
        ).id,
      );
      expect(gone.state).toBe('expired');
    } finally {
      await s.close();
    }
  });

  it('remeshes an uploaded GLB at Meshy and rigs a Tripo model by its task id', async () => {
    const s = await setup();
    try {
      const glb = await s.client.upload(makeCubeGlb({ size: 2 }), 'model/gltf-binary');
      const remesh = await untilDone(
        s.client,
        (
          await s.client.submit(
            request({
              provider: 'meshy',
              op: 'retopology',
              source: { upload: glb.upload },
              params: { faceLimit: 2000, quad: true },
            }),
          )
        ).id,
      );
      expect(remesh).toMatchObject({ state: 'succeeded', model: 'remesh-v1', costUsd: 0.1 });
      expect(remesh.provenance).toMatchObject({
        digitalSourceType: 'compositeWithTrainedAlgorithmicMedia',
        inputSha256: [glb.sha256],
      });
      const remeshPost = s.mock.requests.find((r) => r.path.endsWith('/v1/remesh'))?.json as Record<string, unknown>;
      expect(remeshPost).toMatchObject({ topology: 'quad', target_polycount: 2000, target_formats: ['glb'] });
      expect(String(remeshPost['model_url'])).toMatch(/^data:application\/octet-stream;base64,/);

      const base = await untilDone(
        s.client,
        (await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }))).id,
      );
      const rig = await untilDone(
        s.client,
        (
          await s.client.submit(
            request({ provider: 'tripo', op: 'rig', source: { job: base.id }, params: { skeleton: 'vrm' } }),
          )
        ).id,
      );
      expect(rig).toMatchObject({ state: 'succeeded', model: 'v3.0-20260909', costUsd: 0.25 });
      expect(rig.artifacts[0]?.role).toBe('rigged');
      const rigPost = s.mock.requests.find((r) => r.path.endsWith('/animations/rig'))?.json;
      expect(rigPost).toEqual({
        input: base.provenance?.taskId,
        model: 'v3.0-20260909',
        rig_type: 'biped',
        spec: 'vrm',
        out_format: 'glb',
      });
      await expect(
        s.client.submit(
          request({ provider: 'meshy', op: 'rig', source: { job: base.id }, params: { skeleton: 'vrm' } }),
        ),
      ).rejects.toMatchObject({ code: 'unsupported' });
    } finally {
      await s.close();
    }
  });

  it('cancels a pending Meshy task; a started Tripo task cannot be canceled', async () => {
    const mock = await startMockProviders({ pollsToFinish: 50, pollsQueued: { meshy: 1000 } });
    const s = await setup({ mock });
    try {
      const m = await s.client.submit(
        request({ provider: 'meshy', op: 'text-to-model', prompt: PROMPT, params: { texture: 'none' } }),
      );
      let job: GenJob = m;
      for (let i = 0; i < 200 && !job.submitted; i++) {
        await new Promise((r) => setTimeout(r, 2));
        job = await s.client.job(m.id);
      }
      const canceled = await s.client.cancel(m.id);
      expect(canceled.state).toBe('canceled');
      const t = await s.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }));
      for (let i = 0; i < 400; i++) {
        job = await s.client.job(t.id);
        if (job.state === 'running') break;
        await new Promise((r) => setTimeout(r, 2));
      }
      await expect(s.client.cancel(t.id)).rejects.toMatchObject({ code: 'conflict' });
    } finally {
      await s.close();
      await mock.close();
    }
  });

  it('keeps other callers out of jobs and artifacts (session auth)', async () => {
    const s = await setup({
      env: { GEN_GATEWAY_TOKEN: '' },
      authenticate: async (req) => req.headers.get('x-test-user'),
    });
    try {
      const as = (user: string) => (path: string, init?: RequestInit) =>
        s.fetch(path, { ...init, headers: { ...(init?.headers as Record<string, string>), 'x-test-user': user } });
      const up = (await (
        await as('alice')('/api/gen/v1/uploads', {
          method: 'POST',
          headers: { 'content-type': 'image/png' },
          body: makePng() as Uint8Array<ArrayBuffer>,
        })
      ).json()) as { upload: string; sha256: string };
      const job = (await (
        await as('alice')('/api/gen/v1/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request({ provider: 'tripo', op: 'image-to-model', images: [{ upload: up.upload }] })),
        })
      ).json()) as GenJob;
      expect((await as('bob')(`/api/gen/v1/jobs/${job.id}`)).status).toBe(404);
      expect((await as('bob')(`/api/gen/v1/artifacts/${up.sha256}`)).status).toBe(404);
      expect((await as('alice')(`/api/gen/v1/artifacts/${up.sha256}`)).status).toBe(200);
      const bobJob = await as('bob')('/api/gen/v1/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request({ provider: 'tripo', op: 'image-to-model', images: [{ upload: up.upload }] })),
      });
      expect(bobJob.status).toBe(404);
      expect((await s.fetch('/api/gen/v1/jobs')).status).toBe(401);
    } finally {
      await s.close();
    }
  });

  it('accepts a BYO key only when enabled, uses it for that job and never logs it', async () => {
    const byo = 'byo-tripo-key-for-this-request-only';
    const mock = await startMockProviders({ keys: { tripo: byo } });
    const off = await setup({ mock, env: { TRIPO_API_KEY: '' } });
    const req = request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT });
    const post = (s: typeof off) =>
      s.fetch('/api/gen/v1/jobs', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-gen-provider-key': byo },
        body: JSON.stringify(req),
      });
    try {
      expect((await post(off)).status).toBe(400);
      expect(
        (
          await off.fetch('/api/gen/v1/jobs', {
            method: 'POST',
            headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
            body: JSON.stringify(req),
          })
        ).status,
      ).toBe(409);
    } finally {
      await off.close();
    }
    const on = await setup({ mock, env: { TRIPO_API_KEY: '', GEN_BYO_KEYS: '1' } });
    try {
      const res = await post(on);
      expect(res.status).toBe(201);
      const job = (await res.json()) as GenJob;
      expect((await untilDone(on.client, job.id)).state).toBe('succeeded');
      expect(mock.requests.filter((r) => r.provider === 'tripo').every((r) => r.auth === `Bearer ${byo}`)).toBe(true);
      expect(on.lines.join('\n')).not.toContain(byo);
    } finally {
      await on.close();
      await mock.close();
    }
  });
});

describe('restart recovery (file stores)', () => {
  it('resumes polling a created task, and never re-sends a create that was in flight', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'm7gbc-gateway-'));
    const mock = await startMockProviders({ pollsToFinish: 3 });
    try {
      const { store, blobs } = await openFileStores(dir);
      const first = await setup({ mock, store, blobs });
      const job = await first.client.submit(request({ provider: 'tripo', op: 'text-to-model', prompt: PROMPT }));
      for (let i = 0; i < 500; i++) {
        if ((await first.client.job(job.id)).submitted) break;
        await new Promise((r) => setTimeout(r, 2));
      }
      await first.close();
      // A second job left in `submitting` without a task id, as a crash during the create request would leave it.
      const row = (await store.get(job.id)) as JobRow;
      const ghost: JobRow = {
        ...row,
        job: {
          ...row.job,
          id: 'job_ghost',
          state: 'submitting',
          submitted: false,
          idempotencyKey: 'ghost-key-0123456789',
        },
        taskIds: [],
      };
      await store.put(ghost);

      const second = await setup({ mock, store: await FileJobStore.open(dir), blobs: await FileBlobStore.open(dir) });
      try {
        const resumed = await untilDone(second.client, job.id);
        expect(resumed.state).toBe('succeeded');
        expect(await second.client.job('job_ghost')).toMatchObject({
          state: 'failed',
          error: { code: 'timeout', retryable: false },
        });
        expect(mock.creates('tripo')).toBe(1);
        const artifact = resumed.artifacts.find((a) => a.role === 'model');
        expect(await second.client.artifact(artifact as NonNullable<typeof artifact>)).toBeInstanceOf(Uint8Array);
      } finally {
        await second.close();
      }
    } finally {
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails a queued, never-sent job without a charge after a restart (inputs are not persisted)', async () => {
    const store = new MemoryJobStore();
    const blobs = new MemoryBlobStore();
    const s = await setup({ store, blobs, env: { TRIPO_API_KEY: 'x'.repeat(30) } });
    await s.close();
    const now = new Date().toISOString();
    await store.put({
      job: {
        id: 'job_queued',
        revision: 1,
        provider: 'tripo',
        op: 'text-to-model',
        model: TRIPO_MODELS.p1,
        state: 'queued',
        submitted: false,
        progress: null,
        typicalSeconds: 60,
        createdAt: now,
        updatedAt: now,
        quoteUsd: 0.4,
        costUsd: null,
        error: null,
        artifacts: [],
        provenance: null,
        idempotencyKey: 'queued-key-0123456789',
      },
      principal: 'operator',
      requestHash: 'h',
      stages: ['create'],
      stage: 0,
      taskIds: [],
      creditsDone: 0,
      usdPerCredit: 0.01,
      digitalSourceType: 'trainedAlgorithmicMedia',
      keySource: 'server',
      inputSha256: [],
      sentParams: {},
      promptSha256: null,
      tier: 'paid',
      chargeUsd: 0.4,
      submitStartedAt: null,
      deadlineAt: null,
      sourceJob: null,
    });
    const again = await setup({ store, blobs });
    try {
      expect(await again.client.job('job_queued')).toMatchObject({
        state: 'failed',
        error: { code: 'gateway', retryable: true },
      });
      expect((await store.get('job_queued'))?.chargeUsd).toBe(0);
    } finally {
      await again.close();
    }
  });
});
