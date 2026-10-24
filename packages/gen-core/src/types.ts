// @ekza-studio/gen-core — the `ekza-gen/v1` contract (ADR 0017, MODELING-PLAN §3.11, research 15 §5.4–§5.6).
// Isomorphic and dependency-free: the gateway (server) and the editor's GenerationClient (browser) share these types.
// Nothing here names a provider origin or a key variable: provider ids are plain strings the gateway lists.

/** The wire protocol id; the gateway answers it in `GET /v1/providers` and the client refuses any other. */
export const GEN_PROTOCOL = 'ekza-gen/v1';
export type GenProtocol = typeof GEN_PROTOCOL;

/**
 * Operations. `retopology` is the "API remesh/cleanup of an existing mesh" step: its input is a previous job's model
 * or an uploaded GLB (`GenRequest.source`). `rig` rigs a previous job's model or an uploaded GLB.
 */
export type GenOp = 'text-to-model' | 'image-to-model' | 'multiview-to-model' | 'retopology' | 'rig';
export const GEN_OPS: readonly GenOp[] = ['text-to-model', 'image-to-model', 'multiview-to-model', 'retopology', 'rig'];

/**
 * Job states (research 15 §5.6). `queued`: waiting in the gateway's scheduler (`submitted: false`) or in the provider's
 * queue (`submitted: true`); `submitting`: the create request is in flight — a job seen in this state after a restart is
 * never sent again (ADR 0017 §10); `fetching`: the provider finished and the gateway is downloading and hashing the
 * results. The last five are terminal.
 */
export type JobState =
  | 'queued'
  | 'submitting'
  | 'running'
  | 'fetching'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'canceled'
  | 'expired';

export type ImageMime = 'image/png' | 'image/webp' | 'image/jpeg';
export type UploadMime = ImageMime | 'model/gltf-binary';
export type ArtifactMime = 'model/gltf-binary' | 'image/png' | 'image/webp' | 'image/jpeg';

export type TextureMode = 'none' | 'color' | 'pbr';
export type Skeleton = 'vrm' | 'native';
export type RestPose = 't' | 'a';
export type View = 'front' | 'back' | 'left' | 'right';

/** What a provider adapter can do; drives the Generate panel (G-d). */
export interface GenCapabilities {
  readonly ops: readonly GenOp[];
  readonly maxImages: number; // 1 = single image; 4 = multiview
  readonly imageMimes: readonly ImageMime[]; // input image types the provider accepts
  /** Native low-poly or face-limited output: the triangle range, and the quad range when quads are possible. */
  readonly lowPoly: null | {
    readonly native: boolean;
    readonly tris: readonly [number, number];
    readonly quads: readonly [number, number] | null;
  };
  /** The face range of `retopology` (remesh of an existing mesh), null when the op is not offered. */
  readonly retopology: null | {
    readonly tris: readonly [number, number];
    readonly quads: boolean;
    readonly fromUpload: boolean; // accepts an uploaded GLB, not only the provider's own earlier task
  };
  readonly texture: readonly TextureMode[];
  readonly restPose: readonly RestPose[];
  readonly rig: null | {
    readonly skeletons: readonly Skeleton[];
    readonly fromUpload: boolean;
  };
  /** The provider's default facing; the import normalizes to +Z (G-a `mesh.normalize`). */
  readonly forward: '+z' | '+x' | '-z' | 'auto';
  /** Shown in the UI, never used as a timeout. */
  readonly typicalSeconds: Partial<Record<GenOp, number>>;
}

/** The provider's output terms, shown before submit and snapshotted into provenance (ADR 0017 §9). */
export interface GenTerms {
  readonly outputLicense: string; // SPDX id or LicenseRef-*
  readonly termsUrl: string; // the only link in provenance; never a key named `uri` (ADR 0010)
  readonly checkedOn: string; // ISO date the terms were read
  readonly ownership: 'user' | 'provider-cc-by' | 'provider' | 'unclear'; // for a paid-tier output
  readonly freeTierOwnership: 'user' | 'provider-cc-by' | 'provider' | 'unclear';
  readonly trainsOnInputs: boolean | 'unknown';
  readonly retentionDays: number | null;
  readonly attribution: string | null;
  readonly territoryExcluded: readonly string[];
  readonly restrictions: readonly (
    | 'keep-ai-marks'
    | 'no-competing-models'
    | 'no-improve-other-models'
    | 'no-key-transfer'
    | 'no-resale'
    | 'revenue-cap-1m'
    | 'mau-cap-1m'
  )[];
}

/** `GET /v1/providers` entry. */
export interface GenProviderInfo {
  readonly id: string;
  readonly label: string;
  readonly adapterVersion: string;
  /** The pinned model of each op (never `latest`); recorded in provenance. */
  readonly models: Partial<Record<GenOp, string>>;
  readonly capabilities: GenCapabilities;
  readonly terms: GenTerms;
  /** A server key is configured (self-hosted mode). */
  readonly configured: boolean;
  /** The gateway accepts a bring-your-own key for this provider (`X-Gen-Provider-Key`). */
  readonly byoAllowed: boolean;
}

export interface GenProvidersResponse {
  readonly protocol: GenProtocol;
  readonly providers: readonly GenProviderInfo[];
  /** Server caps (USD) and what remains of them now; the client's `maxCostUsd` is applied on top. */
  readonly caps: GenCaps;
}

export interface GenCaps {
  readonly dailyUsd: number;
  readonly monthlyUsd: number;
  readonly remainingDailyUsd: number;
  readonly remainingMonthlyUsd: number;
}

export interface GenParams {
  /** Face (triangle) budget; the adapter clamps to the provider's range and records what it sent. */
  readonly faceLimit?: number;
  /** Prefer the provider's native low-poly model/mode (Tripo P1, Meshy Smart Topology). */
  readonly lowPoly?: boolean;
  readonly quad?: boolean;
  readonly texture?: TextureMode;
  readonly textureSize?: 1024 | 2048 | 4096;
  readonly restPose?: RestPose;
  readonly seed?: number;
  readonly symmetric?: boolean;
  readonly skeleton?: Skeleton;
  readonly heightMeters?: number;
}

/** The user's statements at submit (Q-GEN-9, ADR 0017 §10): the API cannot tell the provider tier. */
export interface GenAttestation {
  readonly tier: 'paid' | 'free' | 'unknown';
  /** The input image shows a real person and the user has the right to use it (Meshy forbids PII without it). */
  readonly realPersonPhoto?: boolean;
}

export type GenSource = { readonly job: string } | { readonly upload: string };

export interface GenRequest {
  readonly provider: string;
  readonly op: GenOp;
  readonly prompt?: string;
  readonly images?: readonly { readonly upload: string; readonly view?: View }[];
  /** `retopology` / `rig` input: a previous job of the caller (its model) or an uploaded GLB. */
  readonly source?: GenSource;
  readonly params: GenParams;
  /** Client-generated, 16–128 of [A-Za-z0-9_-]; a resubmit with the same key returns the same job. */
  readonly idempotencyKey: string;
  /** The job is refused when its quote is above this (the server caps apply too). */
  readonly maxCostUsd: number;
  readonly attestation: GenAttestation;
}

export interface GenQuote {
  readonly provider: string;
  readonly op: GenOp;
  readonly model: string;
  readonly credits: number;
  readonly usd: number;
  /** False when the provider bills by a rule the gateway can only estimate. */
  readonly exact: boolean;
  readonly items: readonly { readonly label: string; readonly credits: number }[];
  readonly caps: GenCaps;
}

export interface GenUpload {
  readonly upload: string;
  readonly sha256: string;
  readonly mime: UploadMime;
  readonly size: number;
  readonly width: number | null; // images only
  readonly height: number | null;
}

export type GenArtifactRole = 'model' | 'rigged' | 'thumbnail';

export interface GenArtifact {
  readonly role: GenArtifactRole;
  readonly sha256: string;
  readonly size: number;
  readonly mime: ArtifactMime;
  readonly fileName: string;
}

export type GenJobErrorCode =
  | 'moderation'
  | 'insufficient-credits'
  | 'rate-limited'
  | 'invalid-input'
  | 'provider-failed'
  | 'auth'
  | 'expired'
  | 'timeout'
  | 'gateway';

export interface GenJobError {
  readonly code: GenJobErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * The generator record a job produces; field for field the document's `GeneratorProvenance` (doc `records.ts`,
 * ADR 0017 §7) with `prompt: null` — the editor fills `prompt` only on the user's opt-in (Q-GEN-5) and appends
 * `postSteps` as the post chain runs.
 */
export interface GenProvenance {
  readonly kind: 'ai';
  readonly digitalSourceType: 'trainedAlgorithmicMedia' | 'compositeWithTrainedAlgorithmicMedia';
  readonly service: string;
  readonly model: string;
  readonly op: string;
  readonly params: Readonly<Record<string, string | number | boolean>>;
  readonly inputSha256: readonly string[];
  readonly termsSnapshot: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
  readonly rawSha256: string;
  readonly postSteps: readonly { readonly op: string; readonly aiMarksMayBeAltered: boolean }[];
  readonly promptSha256: string | null;
  readonly prompt: string | null;
  readonly tier: 'paid' | 'free' | 'unknown';
  readonly taskId: string | null;
}

export interface GenJob {
  readonly id: string;
  readonly revision: number; // +1 on every change; the SSE event id
  readonly provider: string;
  readonly op: GenOp;
  readonly model: string;
  readonly state: JobState;
  readonly submitted: boolean; // the provider has the task
  readonly progress: number | null; // 0–100
  readonly typicalSeconds: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly quoteUsd: number;
  readonly costUsd: number | null; // from the provider's reported consumption
  readonly error: GenJobError | null;
  readonly artifacts: readonly GenArtifact[];
  readonly provenance: GenProvenance | null; // set when the model artifact is stored
  readonly idempotencyKey: string;
}

export interface GenJobsResponse {
  readonly jobs: readonly GenJob[];
}

/** Error codes of the HTTP envelope `{ error: { code, message, retryable } }`. */
export type GenApiErrorCode =
  | 'unauthorized'
  | 'not-found'
  | 'invalid-request'
  | 'unsupported'
  | 'over-budget' // quote above the request's maxCostUsd
  | 'spend-cap' // a server daily/monthly cap would be exceeded
  | 'rate-limited'
  | 'payload-too-large'
  | 'unsupported-media'
  | 'conflict' // idempotency key reused with a different request
  | 'provider-unavailable' // no key configured and no BYO key
  | 'paused' // the operator's kill switch
  | 'internal';

export interface GenApiError {
  readonly code: GenApiErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

/** HTTP header names of the protocol. */
export const GEN_HEADERS = {
  /** Bring-your-own provider key, per request; never stored, redacted from logs (ADR 0017 §3). */
  providerKey: 'x-gen-provider-key',
  idempotencyKey: 'idempotency-key',
} as const;

/** Limits shared by the client's pre-flight checks and the gateway. */
export const GEN_LIMITS = {
  uploadMaxBytes: 20 * 1024 * 1024,
  promptMaxChars: 1000,
  imageMinPx: 64,
  imageMaxPx: 8192,
  maxImages: 4,
} as const;
