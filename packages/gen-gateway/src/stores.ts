// Job rows, uploads and blobs. The memory stores serve tests and a Next route without GEN_DATA_DIR; the standalone
// server persists them under GEN_DATA_DIR (`node/fsStores.ts`) so jobs survive a restart (research 15 §5.6).
import { isTerminal, sha256Hex, type GenJob, type UploadMime } from '@ekza-studio/gen-core';

export interface JobRow {
  readonly job: GenJob;
  readonly principal: string;
  /** SHA-256 of the canonical request: an idempotency key reused with another request is a conflict. */
  readonly requestHash: string;
  /** The provider stages of the plan and the task id of each stage created so far (`taskIds.length <= stage + 1`). */
  readonly stages: readonly string[];
  readonly stage: number;
  readonly taskIds: readonly string[];
  /** Credits reported by the finished stages. */
  readonly creditsDone: number;
  readonly usdPerCredit: number;
  readonly digitalSourceType: 'trainedAlgorithmicMedia' | 'compositeWithTrainedAlgorithmicMedia';
  readonly keySource: 'server' | 'byo';
  readonly inputSha256: readonly string[];
  readonly sentParams: Readonly<Record<string, string | number | boolean>>;
  readonly promptSha256: string | null;
  readonly tier: 'paid' | 'free' | 'unknown';
  /** What counts against the spend caps now: the quote while open, the reported cost or 0 (refund) at the end. */
  readonly chargeUsd: number;
  /** Set before the create request goes out; a row with this and no task id is never sent again. */
  readonly submitStartedAt: string | null;
  readonly deadlineAt: string | null;
  readonly sourceJob: string | null;
}

export interface UploadRow {
  readonly id: string;
  readonly principal: string;
  readonly sha256: string;
  readonly mime: UploadMime;
  readonly size: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly createdAt: string;
}

export interface JobStore {
  get(id: string): Promise<JobRow | null>;
  put(row: JobRow): Promise<void>;
  byIdempotency(principal: string, key: string): Promise<JobRow | null>;
  byTask(provider: string, taskId: string): Promise<JobRow | null>;
  list(principal: string): Promise<readonly JobRow[]>;
  active(): Promise<readonly JobRow[]>;
  /** Rows created at or after `iso` (spend windows). */
  since(iso: string): Promise<readonly JobRow[]>;
  putUpload(row: UploadRow): Promise<void>;
  getUpload(id: string): Promise<UploadRow | null>;
  /** True when the principal owns a job artifact or an upload with this hash. */
  owns(principal: string, sha256: string): Promise<boolean>;
}

export interface BlobStore {
  put(bytes: Uint8Array): Promise<string>;
  get(sha256: string): Promise<Uint8Array | null>;
}

export class MemoryJobStore implements JobStore {
  protected readonly rows = new Map<string, JobRow>();
  protected readonly uploads = new Map<string, UploadRow>();

  async get(id: string): Promise<JobRow | null> {
    return this.rows.get(id) ?? null;
  }
  async put(row: JobRow): Promise<void> {
    this.rows.set(row.job.id, row);
  }
  async byIdempotency(principal: string, key: string): Promise<JobRow | null> {
    for (const r of this.rows.values()) if (r.principal === principal && r.job.idempotencyKey === key) return r;
    return null;
  }
  async byTask(provider: string, taskId: string): Promise<JobRow | null> {
    for (const r of this.rows.values()) if (r.job.provider === provider && r.taskIds.includes(taskId)) return r;
    return null;
  }
  async list(principal: string): Promise<readonly JobRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.principal === principal)
      .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
  }
  async active(): Promise<readonly JobRow[]> {
    return [...this.rows.values()].filter((r) => !isTerminal(r.job.state));
  }
  async since(iso: string): Promise<readonly JobRow[]> {
    return [...this.rows.values()].filter((r) => r.job.createdAt >= iso);
  }
  async putUpload(row: UploadRow): Promise<void> {
    this.uploads.set(row.id, row);
  }
  async getUpload(id: string): Promise<UploadRow | null> {
    return this.uploads.get(id) ?? null;
  }
  async owns(principal: string, sha256: string): Promise<boolean> {
    for (const r of this.rows.values())
      if (r.principal === principal && r.job.artifacts.some((a) => a.sha256 === sha256)) return true;
    for (const u of this.uploads.values()) if (u.principal === principal && u.sha256 === sha256) return true;
    return false;
  }
}

export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Uint8Array>();
  async put(bytes: Uint8Array): Promise<string> {
    const sha = await sha256Hex(bytes);
    if (!this.blobs.has(sha)) this.blobs.set(sha, bytes.slice());
    return sha;
  }
  async get(sha256: string): Promise<Uint8Array | null> {
    return this.blobs.get(sha256) ?? null;
  }
}
