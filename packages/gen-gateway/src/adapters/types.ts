// The provider adapter contract (research 15 §5.4, revised for G-c): adapters are server code, version-pinned and
// capability-described. A job is one or more provider *stages* (Meshy's textured text-to-3D is preview → refine); the
// engine persists the stage and its task id, so a restart resumes polling and never repeats a create request.
import type {
  ArtifactMime,
  GenArtifactRole,
  GenCapabilities,
  GenJobErrorCode,
  GenOp,
  GenProvenance,
  GenRequest,
  GenTerms,
  ImageMime,
  View,
} from '@ekza-studio/gen-core';
import type { Logger } from '../logger.ts';

export type Params = Readonly<Record<string, string | number | boolean>>;

export interface ResolvedImage {
  readonly bytes: Uint8Array;
  readonly mime: ImageMime;
  readonly sha256: string;
  readonly view?: View;
}

export interface ResolvedSource {
  readonly sha256: string;
  readonly bytes: Uint8Array; // a GLB the gateway holds (an earlier job's model or an upload)
  /** The provider's own task that produced it, when the source job ran at this provider (cheaper than re-uploading). */
  readonly taskId: string | null;
}

export interface AdapterInput {
  readonly request: GenRequest;
  readonly images: readonly ResolvedImage[];
  readonly source: ResolvedSource | null;
}

export interface PlanInfo {
  readonly imageMimes: readonly ImageMime[];
  readonly source: null | 'own-task' | 'bytes';
}

export interface Plan {
  readonly model: string; // pinned, never 'latest'
  readonly stages: readonly string[];
  /** What the adapter will send, flattened: provenance `params`, and the only input of later stages. */
  readonly params: Params;
  readonly credits: number;
  readonly items: readonly { readonly label: string; readonly credits: number }[];
  readonly exact: boolean;
  readonly typicalSeconds: number | null;
  readonly digitalSourceType: GenProvenance['digitalSourceType'];
}

export type ProviderState = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'canceled' | 'expired';

export interface ProviderOutput {
  readonly role: GenArtifactRole;
  readonly url: string;
  readonly mime: ArtifactMime;
  readonly fileName: string;
}

export interface ProviderStatus {
  readonly state: ProviderState;
  readonly progress: number | null;
  readonly retryAfterMs: number | null;
  readonly outputs: readonly ProviderOutput[]; // when succeeded
  readonly credits: number | null; // consumed, as the provider reports it
  readonly error: null | {
    readonly code: GenJobErrorCode;
    readonly message: string;
    readonly retryable: boolean;
  };
}

/**
 * Whether a failed request reached the provider: `no` (refused before it was created: connection refused, 429) may be
 * retried; `maybe` (timeout, connection lost after sending) must never be re-sent for a create (ADR 0017 §10).
 */
export type Sent = 'no' | 'maybe' | 'yes';

export class ProviderError extends Error {
  readonly code: GenJobErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly sent: Sent;
  constructor(
    code: GenJobErrorCode,
    message: string,
    opts: { status?: number | null; retryable?: boolean; retryAfterMs?: number | null; sent: Sent },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.sent = opts.sent;
  }
}

/** Outbound HTTP restricted to the adapter's own origins (egress allow-list); downloads are size-capped. */
export interface Egress {
  /** A request to the provider API; `path` is appended to the base URL. No redirects are followed. */
  api(path: string, init: RequestInit & { readonly timeoutMs: number }): Promise<Response>;
  /** A request to an absolute URL the provider handed out (a presigned upload), restricted like downloads. */
  external(url: string, init: RequestInit & { readonly timeoutMs: number }): Promise<Response>;
  /** Downloads a result: https on an allowed host (redirects re-checked), at most `maxBytes`. */
  download(url: string, maxBytes: number): Promise<Uint8Array>;
}

export interface AdapterContext {
  readonly key: string;
  readonly http: Egress;
  readonly log: Logger;
}

/** A task of a job: the op and the params the plan sent (the adapter picks the endpoint from them). */
export interface TaskContext extends AdapterContext {
  readonly op: GenOp;
  readonly params: Params;
}

export interface SubmitContext extends TaskContext {
  /** Stage 0 has the resolved input; later stages work from `params` and the previous task only. */
  readonly input: AdapterInput | null;
  readonly previousTaskId: string | null;
}

export interface WebhookResult {
  readonly taskId: string;
  readonly deliveryId: string | null;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  /** Default API base (origin + path prefix); `GEN_<ID>_BASE_URL` overrides it (the mock provider server). */
  readonly apiBase: string;
  /** Hosts (exact or `.suffix`) results and presigned uploads may come from. */
  readonly downloadHosts: readonly string[];
  readonly keyEnv: string;
  readonly baseUrlEnv: string;
  readonly webhookSecretEnv: string | null;
  readonly usdPerCredit: number;
  readonly capabilities: GenCapabilities;
  readonly terms: GenTerms;
  readonly models: Partial<Record<GenOp, string>>;
  readonly limits: { readonly concurrency: number; readonly pollMs: number; readonly maxWaitMs: number };
  /** Validates the request against the provider and plans it; throws `ApiError` when it cannot be done. */
  plan(req: GenRequest, info: PlanInfo): Plan;
  submit(stage: number, ctx: SubmitContext): Promise<{ readonly taskId: string }>;
  status(stage: number, taskId: string, ctx: TaskContext): Promise<ProviderStatus>;
  readonly cancel?: (
    stage: number,
    taskId: string,
    ctx: TaskContext,
  ) => Promise<'canceled' | 'too-late' | 'unsupported'>;
  /**
   * Verifies a callback. `signed` adapters return null for a bad or replayed-out-of-window signature; unsigned ones
   * (Meshy) return the task id as a hint only — the engine re-fetches the task with the key and never trusts the body.
   */
  readonly webhook?: {
    readonly signed: boolean;
    verify(raw: Uint8Array, headers: Headers, secret: string | null, nowMs: number): Promise<WebhookResult | null>;
  };
}
