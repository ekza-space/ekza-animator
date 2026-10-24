// The job engine: idempotent creation, quotes and server spend caps, a per-provider scheduler with a fair per-caller
// queue, provider stages, polling with Retry-After and webhook pokes, immediate download + SHA-256 of every result,
// provenance, cancellation and restart recovery (ADR 0017 §4, §10; research 15 §5.6).
//
// The create rule (ADR 0017 §10): a create request that may have reached the provider (timeout, connection lost) is
// never sent again — the job fails with `timeout` and says so. Only a refusal the provider answered before creating
// anything (429, connection refused) is retried. A row persisted in `submitting` without a task id is treated the same
// way after a restart. Prompt text and input bytes live only in memory until the create request is sent; a restart
// before that fails the job without a charge (nothing reached the provider).
import {
  canonicalRequest,
  canTransition,
  type GenArtifact,
  type GenJob,
  type GenJobError,
  type GenProvenance,
  type GenQuote,
  type GenRequest,
  type ImageMime,
  isTerminal,
  promptSha256,
  sha256Hex,
} from '@ekza-studio/gen-core';
import type {
  AdapterInput,
  ProviderAdapter,
  ProviderStatus,
  ResolvedImage,
  ResolvedSource,
  TaskContext,
} from './adapters/types.ts';
import { ProviderError } from './adapters/types.ts';
import type { GatewayConfig } from './config.ts';
import { createEgress } from './egress.ts';
import { ApiError } from './http.ts';
import { checkGlb, InputError, sniff } from './inputs.ts';
import type { Logger } from './logger.ts';
import type { BlobStore, JobRow, JobStore } from './stores.ts';

export interface EngineDeps {
  readonly config: GatewayConfig;
  readonly adapters: ReadonlyMap<string, ProviderAdapter>;
  readonly store: JobStore;
  readonly blobs: BlobStore;
  readonly log: Logger;
  readonly fetch: typeof fetch;
  readonly now?: () => number;
  /** Multiplies every wait (poll interval, Retry-After, deadline); tests run the provider clocks fast. */
  readonly timeScale?: number;
  /** Multiplies the provider request timeouts (tests: a hanging create request times out quickly). */
  readonly requestTimeoutScale?: number;
}

const THUMBNAIL_MAX = 10 * 1024 * 1024;
const MAX_POLL_MS = 30_000;
const MAX_STATUS_ERRORS = 10;

export const usdOf = (credits: number, usdPerCredit: number): number =>
  Math.ceil(credits * usdPerCredit * 100 - 1e-9) / 100;

const startOfDayUtc = (ms: number): string => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};
const startOfMonthUtc = (ms: number): string => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

interface ProviderQueue {
  active: number;
  readonly byPrincipal: Map<string, string[]>;
  readonly turn: string[];
}

class RateWindow {
  private readonly hits = new Map<string, number[]>();
  take(key: string, perMinute: number, now: number): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= perMinute) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
}

export class Engine {
  private readonly d: EngineDeps;
  private readonly now: () => number;
  private readonly scale: number;
  private readonly inputs = new Map<string, AdapterInput>();
  private readonly byoKeys = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(job: GenJob) => void>>();
  private readonly wakers = new Map<string, () => void>();
  private readonly cancelRequested = new Set<string>();
  private readonly queues = new Map<string, ProviderQueue>();
  private readonly creating = new Map<string, Promise<unknown>>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly rate = new RateWindow();
  private closed = false;

  constructor(deps: EngineDeps) {
    this.d = deps;
    this.now = deps.now ?? (() => Date.now());
    this.scale = deps.timeScale ?? 1;
  }

  // ---------------------------------------------------------------- public API (called by the HTTP handler)

  adapter(id: string): ProviderAdapter {
    const a = this.d.adapters.get(id);
    if (a === undefined) throw new ApiError('unsupported', `Unknown provider '${id}'.`);
    return a;
  }

  hasServerKey(id: string): boolean {
    return (this.d.config.providers.find((p) => p.id === id)?.key ?? null) !== null;
  }

  takeRate(principal: string, kind: 'jobs' | 'uploads'): void {
    const per = kind === 'jobs' ? this.d.config.rate.jobsPerMinute : this.d.config.rate.uploadsPerMinute;
    if (!this.rate.take(`${kind}\0${principal}`, per, this.now()))
      throw new ApiError('rate-limited', 'Too many requests; try again in a minute.', { retryable: true, retryAfterS: 60 });
  }

  async caps(): Promise<GenQuote['caps']> {
    const now = this.now();
    const month = await this.d.store.since(startOfMonthUtc(now));
    const dayStart = startOfDayUtc(now);
    const sum = (rows: readonly JobRow[]): number => rows.reduce((s, r) => s + r.chargeUsd, 0);
    const spentMonth = sum(month);
    const spentDay = sum(month.filter((r) => r.job.createdAt >= dayStart));
    const { dailyUsd, monthlyUsd } = this.d.config.caps;
    const round = (x: number): number => Math.max(0, Math.floor(x * 100 + 1e-9) / 100);
    return {
      dailyUsd,
      monthlyUsd,
      remainingDailyUsd: round(dailyUsd - spentDay),
      remainingMonthlyUsd: round(monthlyUsd - spentMonth),
    };
  }

  async quote(principal: string, req: GenRequest): Promise<GenQuote> {
    const adapter = this.adapter(req.provider);
    const { info } = await this.resolve(principal, adapter, req);
    const plan = adapter.plan(req, info);
    return {
      provider: adapter.id,
      op: req.op,
      model: plan.model,
      credits: plan.credits,
      usd: usdOf(plan.credits, adapter.usdPerCredit),
      exact: plan.exact,
      items: plan.items,
      caps: await this.caps(),
    };
  }

  /** Creates a job, or returns the caller's job with the same idempotency key and request. */
  async create(principal: string, req: GenRequest, byoKey: string | null): Promise<{ job: GenJob; created: boolean }> {
    const lockKey = `${principal}\0${req.idempotencyKey}`;
    const prev = this.creating.get(lockKey);
    if (prev) await prev.catch(() => undefined);
    const p = this.createLocked(principal, req, byoKey);
    this.creating.set(lockKey, p);
    try {
      return await p;
    } finally {
      if (this.creating.get(lockKey) === p) this.creating.delete(lockKey);
    }
  }

  async get(principal: string, id: string): Promise<GenJob> {
    return (await this.owned(principal, id)).job;
  }

  async list(principal: string): Promise<readonly GenJob[]> {
    return (await this.d.store.list(principal)).map((r) => r.job);
  }

  async cancel(principal: string, id: string): Promise<GenJob> {
    const row = await this.owned(principal, id);
    if (isTerminal(row.job.state)) return row.job;
    const adapter = this.adapter(row.job.provider);
    if (row.job.state === 'fetching')
      throw new ApiError('conflict', 'The results are being downloaded; the job can no longer be canceled.');
    if (!row.job.submitted && row.job.state === 'queued') {
      this.dequeue(row);
      this.inputs.delete(id);
      return (await this.finish(id, 'canceled', null, 0)).job;
    }
    if (row.job.state === 'submitting' || row.taskIds.length <= row.stage) {
      this.cancelRequested.add(id);
      return row.job;
    }
    const outcome = adapter.cancel
      ? await adapter.cancel(row.stage, row.taskIds[row.stage] as string, this.taskContext(row, adapter))
      : 'unsupported';
    if (outcome === 'canceled') {
      const done = await this.finish(id, 'canceled', null, usdOf(row.creditsDone, row.usdPerCredit));
      this.wake(id);
      return done.job;
    }
    throw new ApiError(
      'conflict',
      outcome === 'too-late'
        ? 'The provider has started the task; it can no longer be canceled.'
        : 'This provider cannot cancel a task once it has started.',
    );
  }

  subscribe(id: string, fn: (job: GenJob) => void): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  /** A provider callback for a task: the job is re-polled now (the callback body is never trusted). */
  async poke(provider: string, taskId: string): Promise<boolean> {
    const row = await this.d.store.byTask(provider, taskId);
    if (row === null) return false;
    this.wake(row.job.id);
    return true;
  }

  /** Resumes the open jobs of a previous run (see the module comment for what is resumed and what fails). */
  async start(): Promise<void> {
    for (const row of await this.d.store.active()) {
      const id = row.job.id;
      const stageCreated = row.taskIds.length > row.stage;
      if (row.job.state === 'submitting' && !stageCreated) {
        await this.finish(
          id,
          'failed',
          {
            code: 'timeout',
            message:
              'The gateway stopped while a create request was in flight; it was not sent again. Check the provider console before retrying.',
            retryable: false,
          },
          row.job.quoteUsd,
        );
      } else if (row.stage === 0 && !stageCreated) {
        await this.finish(
          id,
          'failed',
          { code: 'gateway', message: 'The gateway restarted before the job was sent; nothing was charged.', retryable: true },
          0,
        );
      } else if (row.keySource === 'byo') {
        await this.finish(
          id,
          'failed',
          {
            code: 'gateway',
            message:
              'The gateway restarted and bring-your-own keys are never stored; the provider may still finish the task.',
            retryable: false,
          },
          row.job.quoteUsd,
        );
      } else {
        this.d.log.log('info', 'job.resume', { job: id, state: row.job.state, stage: row.stage });
        const q = this.queue(row.job.provider);
        q.active++;
        this.spawn(
          this.drive(id).finally(() => {
            q.active--;
            this.pump(row.job.provider);
          }),
        );
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const w of this.wakers.values()) w();
    await Promise.allSettled([...this.tasks]);
  }

  // ---------------------------------------------------------------- creation

  private async createLocked(
    principal: string,
    req: GenRequest,
    byoKey: string | null,
  ): Promise<{ job: GenJob; created: boolean }> {
    const adapter = this.adapter(req.provider);
    const requestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest(req)));
    const existing = await this.d.store.byIdempotency(principal, req.idempotencyKey);
    if (existing !== null) {
      if (existing.requestHash === requestHash) return { job: existing.job, created: false };
      throw new ApiError('conflict', 'This idempotency key was used for a different request.');
    }
    if (this.d.config.paused)
      throw new ApiError('paused', 'The operator has paused generation.', { retryable: true, retryAfterS: 300 });
    let keySource: 'server' | 'byo' = 'server';
    if (byoKey !== null) {
      if (!this.d.config.byoKeys) throw new ApiError('unsupported', 'This gateway does not accept bring-your-own keys.');
      keySource = 'byo';
    } else if (!this.hasServerKey(adapter.id)) {
      throw new ApiError('provider-unavailable', `No ${adapter.label} key is configured on this gateway.`);
    }
    this.takeRate(principal, 'jobs');
    const { input, info } = await this.resolve(principal, adapter, req);
    const plan = adapter.plan(req, info);
    const quoteUsd = usdOf(plan.credits, adapter.usdPerCredit);
    if (quoteUsd > req.maxCostUsd)
      throw new ApiError('over-budget', `The quote ($${quoteUsd.toFixed(2)}) is above the request's limit.`);
    const caps = await this.caps();
    if (quoteUsd > caps.remainingDailyUsd || quoteUsd > caps.remainingMonthlyUsd)
      throw new ApiError(
        'spend-cap',
        quoteUsd > caps.remainingDailyUsd
          ? `The gateway's daily spend cap would be exceeded ($${caps.remainingDailyUsd.toFixed(2)} left today).`
          : `The gateway's monthly spend cap would be exceeded ($${caps.remainingMonthlyUsd.toFixed(2)} left this month).`,
      );

    const now = new Date(this.now()).toISOString();
    const id = `job_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
    const inputSha256 = [...input.images.map((i) => i.sha256), ...(input.source ? [input.source.sha256] : [])];
    const row: JobRow = {
      job: {
        id,
        revision: 1,
        provider: adapter.id,
        op: req.op,
        model: plan.model,
        state: 'queued',
        submitted: false,
        progress: null,
        typicalSeconds: plan.typicalSeconds,
        createdAt: now,
        updatedAt: now,
        quoteUsd,
        costUsd: null,
        error: null,
        artifacts: [],
        provenance: null,
        idempotencyKey: req.idempotencyKey,
      },
      principal,
      requestHash,
      stages: plan.stages,
      stage: 0,
      taskIds: [],
      creditsDone: 0,
      usdPerCredit: adapter.usdPerCredit,
      digitalSourceType: plan.digitalSourceType,
      keySource,
      inputSha256,
      sentParams: plan.params,
      promptSha256: req.prompt === undefined ? null : await promptSha256(req.prompt),
      tier: req.attestation.tier,
      chargeUsd: quoteUsd,
      submitStartedAt: null,
      deadlineAt: new Date(this.now() + adapter.limits.maxWaitMs * this.scale).toISOString(),
      sourceJob: req.source && 'job' in req.source ? req.source.job : null,
    };
    await this.d.store.put(row);
    this.inputs.set(id, input);
    if (byoKey !== null) {
      this.byoKeys.set(id, byoKey);
      this.d.log.addSecret(byoKey);
    }
    this.d.log.log('info', 'job.created', {
      job: id,
      provider: adapter.id,
      op: req.op,
      model: plan.model,
      quoteUsd,
      keySource,
      promptSha256: row.promptSha256,
    });
    this.enqueue(row);
    return { job: row.job, created: true };
  }

  private async resolve(
    principal: string,
    adapter: ProviderAdapter,
    req: GenRequest,
  ): Promise<{ input: AdapterInput; info: { imageMimes: ImageMime[]; source: null | 'own-task' | 'bytes' } }> {
    const images: ResolvedImage[] = [];
    for (const im of req.images ?? []) {
      const up = await this.d.store.getUpload(im.upload);
      if (up === null || up.principal !== principal) throw new ApiError('not-found', `Unknown upload '${im.upload}'.`);
      if (up.mime === 'model/gltf-binary') throw new ApiError('invalid-request', 'An image input must be an image.');
      if (!adapter.capabilities.imageMimes.includes(up.mime))
        throw new ApiError('invalid-request', `${adapter.label} accepts ${adapter.capabilities.imageMimes.join(', ')} images.`);
      const bytes = await this.d.blobs.get(up.sha256);
      if (bytes === null) throw new ApiError('not-found', `Upload '${im.upload}' is no longer stored.`);
      images.push(im.view === undefined ? { bytes, mime: up.mime, sha256: up.sha256 } : { bytes, mime: up.mime, sha256: up.sha256, view: im.view });
    }
    let source: ResolvedSource | null = null;
    if (req.source !== undefined) {
      if ('job' in req.source) {
        const row = await this.d.store.get(req.source.job);
        if (row === null || row.principal !== principal) throw new ApiError('not-found', 'Unknown source job.');
        const art =
          row.job.artifacts.find((a) => a.role === 'rigged') ?? row.job.artifacts.find((a) => a.role === 'model');
        if (row.job.state !== 'succeeded' || art === undefined)
          throw new ApiError('invalid-request', 'The source job has no finished model.');
        const bytes = await this.d.blobs.get(art.sha256);
        if (bytes === null) throw new ApiError('not-found', 'The source model is no longer stored.');
        const own = row.job.provider === adapter.id ? (row.taskIds[row.taskIds.length - 1] ?? null) : null;
        source = { sha256: art.sha256, bytes, taskId: own };
      } else {
        const up = await this.d.store.getUpload(req.source.upload);
        if (up === null || up.principal !== principal) throw new ApiError('not-found', 'Unknown source upload.');
        if (up.mime !== 'model/gltf-binary') throw new ApiError('invalid-request', 'The source must be a GLB.');
        const bytes = await this.d.blobs.get(up.sha256);
        if (bytes === null) throw new ApiError('not-found', 'The source upload is no longer stored.');
        source = { sha256: up.sha256, bytes, taskId: null };
      }
    }
    return {
      input: { request: req, images, source },
      info: {
        imageMimes: images.map((i) => i.mime),
        source: source === null ? null : source.taskId !== null ? 'own-task' : 'bytes',
      },
    };
  }

  private async owned(principal: string, id: string): Promise<JobRow> {
    const row = await this.d.store.get(id);
    if (row === null || row.principal !== principal) throw new ApiError('not-found', 'Unknown job.');
    return row;
  }

  // ---------------------------------------------------------------- scheduler

  private queue(provider: string): ProviderQueue {
    let q = this.queues.get(provider);
    if (!q) {
      q = { active: 0, byPrincipal: new Map(), turn: [] };
      this.queues.set(provider, q);
    }
    return q;
  }

  private enqueue(row: JobRow): void {
    const q = this.queue(row.job.provider);
    const list = q.byPrincipal.get(row.principal);
    if (list) list.push(row.job.id);
    else {
      q.byPrincipal.set(row.principal, [row.job.id]);
      q.turn.push(row.principal);
    }
    this.pump(row.job.provider);
  }

  private dequeue(row: JobRow): void {
    const q = this.queue(row.job.provider);
    const list = q.byPrincipal.get(row.principal);
    if (!list) return;
    const i = list.indexOf(row.job.id);
    if (i >= 0) list.splice(i, 1);
  }

  /** Starts queued jobs up to the provider's concurrency, taking callers in turn (fair queue). */
  private pump(provider: string): void {
    if (this.closed) return;
    const q = this.queue(provider);
    const limit = this.adapter(provider).limits.concurrency;
    while (q.active < limit && q.turn.length > 0) {
      const principal = q.turn.shift() as string;
      const list = q.byPrincipal.get(principal) ?? [];
      const id = list.shift();
      if (list.length > 0) q.turn.push(principal);
      else q.byPrincipal.delete(principal);
      if (id === undefined) continue;
      q.active++;
      this.spawn(
        this.drive(id).finally(() => {
          q.active--;
          this.pump(provider);
        }),
      );
    }
  }

  private spawn(p: Promise<void>): void {
    const t = p.catch((err: unknown) => this.d.log.log('error', 'engine.task', { error: err }));
    this.tasks.add(t);
    void t.finally(() => this.tasks.delete(t));
  }

  // ---------------------------------------------------------------- driving a job

  private async drive(id: string): Promise<void> {
    for (;;) {
      if (this.closed) return;
      const row = await this.d.store.get(id);
      if (row === null || isTerminal(row.job.state)) return;
      const adapter = this.adapter(row.job.provider);
      if (this.cancelRequested.has(id) && row.taskIds.length <= row.stage) {
        await this.finish(id, 'canceled', null, usdOf(row.creditsDone, row.usdPerCredit));
        return;
      }
      if (row.taskIds.length <= row.stage) {
        if (!(await this.submitStage(id, adapter))) return;
        continue;
      }
      const status = await this.track(id, adapter);
      if (status === null) return;
      const after = await this.d.store.get(id);
      if (after === null || isTerminal(after.job.state)) return;
      const credits = status.credits ?? 0;
      if (after.stage + 1 < after.stages.length) {
        await this.mutate(id, (r) => ({
          row: { ...r, stage: r.stage + 1, creditsDone: r.creditsDone + credits },
          job: {},
        }));
        continue;
      }
      await this.fetchOutputs(id, adapter, status);
      return;
    }
  }

  private keyFor(row: JobRow): string | null {
    if (row.keySource === 'byo') return this.byoKeys.get(row.job.id) ?? null;
    return this.d.config.providers.find((p) => p.id === row.job.provider)?.key ?? null;
  }

  private taskContext(row: JobRow, adapter: ProviderAdapter): TaskContext {
    const settings = this.d.config.providers.find((p) => p.id === adapter.id);
    return {
      key: this.keyFor(row) ?? '',
      http: createEgress(
        { apiBase: settings?.baseUrl ?? adapter.apiBase, downloadHosts: adapter.downloadHosts },
        this.d.fetch,
        this.d.requestTimeoutScale ?? 1,
      ),
      log: this.d.log,
      op: row.job.op,
      params: row.sentParams,
    };
  }

  /** Sends the create request of the current stage. False when the job ended. */
  private async submitStage(id: string, adapter: ProviderAdapter): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      const row = await this.mutate(id, () => ({
        row: { submitStartedAt: new Date(this.now()).toISOString() },
        job: { state: 'submitting' },
      }));
      if (row === null || isTerminal(row.job.state)) return false;
      if (this.keyFor(row) === null) {
        await this.finish(id, 'failed', { code: 'auth', message: 'No provider key is available.', retryable: false }, 0);
        return false;
      }
      const ctx = {
        ...this.taskContext(row, adapter),
        input: row.stage === 0 ? (this.inputs.get(id) ?? null) : null,
        previousTaskId: row.stage > 0 ? (row.taskIds[row.stage - 1] ?? null) : null,
      };
      if (row.stage === 0 && ctx.input === null) {
        await this.finish(id, 'failed', { code: 'gateway', message: 'The job input is gone.', retryable: true }, 0);
        return false;
      }
      try {
        const { taskId } = await adapter.submit(row.stage, ctx);
        if (row.stage === 0) this.inputs.delete(id);
        await this.mutate(id, (r) => ({
          row: { taskIds: [...r.taskIds, taskId] },
          job: { state: 'queued', submitted: true, progress: r.job.progress ?? 0 },
        }));
        this.d.log.log('info', 'job.submitted', { job: id, stage: row.stage, task: taskId });
        if (this.cancelRequested.has(id)) await this.cancelSubmitted(id, adapter);
        return true;
      } catch (err) {
        const pe =
          err instanceof ProviderError
            ? err
            : new ProviderError('gateway', String(err), { retryable: false, sent: 'maybe' });
        const charged = usdOf(row.creditsDone, row.usdPerCredit);
        if (pe.sent === 'no' && (pe.code === 'rate-limited' || pe.code === 'provider-failed') && attempt < 5) {
          // Refused before anything was created: safe to send again after a pause.
          await this.mutate(id, () => ({ row: { submitStartedAt: null }, job: { state: 'queued' } }));
          await this.sleep(id, Math.min(pe.retryAfterMs ?? 5_000 * 2 ** attempt, 120_000) * this.scale);
          if (this.closed) return false;
          continue;
        }
        if (pe.sent === 'maybe') {
          await this.finish(
            id,
            'failed',
            {
              code: 'timeout',
              message:
                'The create request did not get an answer; it may have reached the provider and was not sent again. Check the provider console before retrying.',
              retryable: false,
            },
            row.job.quoteUsd,
          );
          return false;
        }
        await this.finish(
          id,
          pe.code === 'moderation' ? 'blocked' : 'failed',
          { code: pe.code, message: pe.message, retryable: pe.retryable },
          charged,
        );
        return false;
      }
    }
  }

  private async cancelSubmitted(id: string, adapter: ProviderAdapter): Promise<void> {
    const row = await this.d.store.get(id);
    if (row === null || isTerminal(row.job.state) || !adapter.cancel) return;
    const outcome = await adapter
      .cancel(row.stage, row.taskIds[row.stage] as string, this.taskContext(row, adapter))
      .catch(() => 'unsupported' as const);
    if (outcome === 'canceled') await this.finish(id, 'canceled', null, usdOf(row.creditsDone, row.usdPerCredit));
    this.cancelRequested.delete(id);
  }

  /** Polls the current stage until the provider ends it; null when the job ended here. */
  private async track(id: string, adapter: ProviderAdapter): Promise<ProviderStatus | null> {
    let delay = 0;
    let errors = 0;
    for (;;) {
      await this.sleep(id, delay);
      if (this.closed) return null;
      const row = await this.d.store.get(id);
      if (row === null || isTerminal(row.job.state)) return null;
      const quoteLeft = row.job.quoteUsd;
      if (row.deadlineAt !== null && this.now() > Date.parse(row.deadlineAt)) {
        await this.finish(
          id,
          'failed',
          {
            code: 'timeout',
            message: `${adapter.label} did not finish in time; the task may still complete in the provider console.`,
            retryable: false,
          },
          quoteLeft,
        );
        return null;
      }
      const taskId = row.taskIds[row.stage] as string;
      let st: ProviderStatus;
      try {
        st = await adapter.status(row.stage, taskId, this.taskContext(row, adapter));
        errors = 0;
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError('gateway', String(err), { sent: 'yes' });
        if (pe.code === 'auth' || pe.code === 'expired' || ++errors >= MAX_STATUS_ERRORS) {
          await this.finish(
            id,
            pe.code === 'expired' ? 'expired' : 'failed',
            { code: pe.code, message: pe.message, retryable: false },
            quoteLeft,
          );
          return null;
        }
        delay = Math.min(Math.max(delay * 2, adapter.limits.pollMs), MAX_POLL_MS) * this.scale;
        continue;
      }
      const n = row.stages.length;
      const overall = (p: number | null): number | null =>
        p === null ? null : Math.round(((row.stage + Math.min(100, Math.max(0, p)) / 100) / n) * 100);
      const credits = row.creditsDone + (st.credits ?? 0);
      switch (st.state) {
        case 'queued':
        case 'running': {
          const progress = overall(st.progress);
          if (row.job.state !== st.state || row.job.progress !== progress)
            await this.mutate(id, () => ({ row: {}, job: { state: st.state, progress } }));
          const jitter = 0.85 + Math.random() * 0.3;
          delay = (st.retryAfterMs ?? adapter.limits.pollMs) * jitter * this.scale;
          continue;
        }
        case 'succeeded':
          return st;
        case 'failed':
        case 'canceled':
          await this.finish(
            id,
            st.state,
            st.state === 'canceled'
              ? null
              : (st.error ?? { code: 'provider-failed', message: `${adapter.label} could not finish the task.`, retryable: true }),
            usdOf(st.credits === null ? row.creditsDone : credits, row.usdPerCredit),
          );
          return null;
        case 'blocked':
          await this.finish(
            id,
            'blocked',
            st.error ?? { code: 'moderation', message: `${adapter.label} blocked the request under its content policy.`, retryable: false },
            st.credits === null ? quoteLeft : usdOf(credits, row.usdPerCredit),
          );
          return null;
        case 'expired':
          await this.finish(
            id,
            'expired',
            st.error ?? { code: 'expired', message: 'The provider no longer has the results.', retryable: false },
            st.credits === null ? quoteLeft : usdOf(credits, row.usdPerCredit),
          );
          return null;
        default: {
          const never: never = st.state;
          throw new Error(`unknown provider state ${String(never)}`);
        }
      }
    }
  }

  /** Downloads every result now (providers keep them 1–7 days), checks, hashes and stores them. */
  private async fetchOutputs(id: string, adapter: ProviderAdapter, st: ProviderStatus): Promise<void> {
    const row = await this.mutate(id, () => ({ row: {}, job: { state: 'fetching', progress: 100 } }));
    if (row === null) return;
    const credits = row.creditsDone + (st.credits ?? 0);
    const charge = st.credits === null ? row.job.quoteUsd : usdOf(credits, row.usdPerCredit);
    const ctx = this.taskContext(row, adapter);
    const artifacts: GenArtifact[] = [];
    const outputs = [...st.outputs].sort((a, b) => (a.role === 'thumbnail' ? 1 : 0) - (b.role === 'thumbnail' ? 1 : 0));
    for (const out of outputs) {
      const thumb = out.role === 'thumbnail';
      let bytes: Uint8Array | null = null;
      for (let attempt = 0; attempt < 3 && bytes === null; attempt++) {
        try {
          bytes = await ctx.http.download(out.url, thumb ? THUMBNAIL_MAX : this.d.config.artifactMaxBytes);
        } catch (err) {
          const pe = err instanceof ProviderError ? err : new ProviderError('provider-failed', String(err), { sent: 'yes' });
          if (thumb) break;
          if (!pe.retryable || attempt === 2) {
            await this.finish(
              id,
              pe.code === 'expired' ? 'expired' : 'failed',
              { code: pe.code === 'expired' ? 'expired' : 'provider-failed', message: pe.message, retryable: false },
              charge,
            );
            return;
          }
          await this.sleep(id, 2_000 * (attempt + 1) * this.scale);
        }
      }
      if (bytes === null) continue;
      if (thumb) {
        const mime = sniff(bytes);
        if (mime === null || mime === 'model/gltf-binary') continue;
        const sha = await this.d.blobs.put(bytes);
        artifacts.push({ role: 'thumbnail', sha256: sha, size: bytes.byteLength, mime, fileName: `${id}-thumbnail.${mime.slice(6)}` });
        continue;
      }
      try {
        checkGlb(bytes);
      } catch (err) {
        const message = err instanceof InputError ? err.message : String(err);
        await this.finish(
          id,
          'failed',
          { code: 'provider-failed', message: `The provider returned an unusable GLB: ${message}`, retryable: true },
          charge,
        );
        return;
      }
      const sha = await this.d.blobs.put(bytes);
      const role = row.job.op === 'rig' ? 'rigged' : 'model';
      artifacts.push({ role, sha256: sha, size: bytes.byteLength, mime: 'model/gltf-binary', fileName: `${id}.glb` });
    }
    const model = artifacts.find((a) => a.role !== 'thumbnail');
    if (model === undefined) {
      await this.finish(
        id,
        'failed',
        { code: 'provider-failed', message: 'The provider reported success without a model.', retryable: true },
        charge,
      );
      return;
    }
    const provenance: GenProvenance = {
      kind: 'ai',
      digitalSourceType: row.digitalSourceType,
      service: adapter.id,
      model: row.job.model,
      op: row.job.op,
      params: row.sentParams,
      inputSha256: row.inputSha256,
      termsSnapshot: { ...adapter.terms },
      rawSha256: model.sha256,
      postSteps: [],
      promptSha256: row.promptSha256,
      prompt: null,
      tier: row.tier,
      taskId: row.taskIds[row.taskIds.length - 1] ?? null,
    };
    await this.mutate(id, () => ({
      row: { chargeUsd: charge },
      job: {
        state: 'succeeded',
        artifacts,
        provenance,
        costUsd: st.credits === null ? null : usdOf(credits, row.usdPerCredit),
      },
    }));
    this.byoKeys.delete(id);
    this.d.log.log('info', 'job.succeeded', { job: id, artifacts: artifacts.map((a) => a.sha256) });
  }

  // ---------------------------------------------------------------- row updates

  private async finish(
    id: string,
    state: 'failed' | 'blocked' | 'canceled' | 'expired',
    error: GenJobError | null,
    chargeUsd: number,
  ): Promise<JobRow> {
    const row = await this.mutate(id, () => ({ row: { chargeUsd }, job: { state, error } }));
    this.byoKeys.delete(id);
    this.inputs.delete(id);
    this.cancelRequested.delete(id);
    this.d.log.log(state === 'canceled' ? 'info' : 'warn', `job.${state}`, { job: id, error: error?.code ?? null });
    if (row === null) throw new Error(`job ${id} vanished`);
    return row;
  }

  /**
   * Applies a change to a job under its lock: the job's revision and time advance, illegal state changes are refused,
   * the row is persisted and listeners (SSE) get the new snapshot. Terminal jobs do not change.
   */
  private async mutate(
    id: string,
    fn: (row: JobRow) => { row: Partial<JobRow>; job: Partial<GenJob> } | null,
  ): Promise<JobRow | null> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let result: JobRow | null = null;
    const next = prev.then(async () => {
      const row = await this.d.store.get(id);
      if (row === null) return;
      if (isTerminal(row.job.state)) {
        result = row;
        return;
      }
      const change = fn(row);
      if (change === null) {
        result = row;
        return;
      }
      const to = change.job.state ?? row.job.state;
      if (to !== row.job.state && !canTransition(row.job.state, to)) {
        this.d.log.log('error', 'job.illegal-transition', { job: id, from: row.job.state, to });
        result = row;
        return;
      }
      const updated: JobRow = {
        ...row,
        ...change.row,
        job: { ...row.job, ...change.job, revision: row.job.revision + 1, updatedAt: new Date(this.now()).toISOString() },
      };
      await this.d.store.put(updated);
      result = updated;
      for (const fnL of this.listeners.get(id) ?? []) fnL(updated.job);
    });
    const settled = next.catch(() => undefined);
    this.locks.set(id, settled);
    await next;
    if (this.locks.get(id) === settled) this.locks.delete(id);
    return result as JobRow | null;
  }

  private sleep(id: string, ms: number): Promise<void> {
    if (ms <= 0 || this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        if (this.wakers.get(id) === done) this.wakers.delete(id);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakers.set(id, done);
    });
  }

  private wake(id: string): void {
    this.wakers.get(id)?.();
  }
}
