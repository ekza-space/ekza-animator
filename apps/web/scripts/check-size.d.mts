// Types of check-size.mjs for the app's tests (the script itself is plain ESM run by Node).
export interface LazyGroup {
  readonly id: number;
  readonly label: string;
  readonly boundary: string | null;
  readonly files: readonly string[];
  readonly bytes: number;
}
export interface SizeReport {
  readonly e2eBuild: boolean;
  /** Eager scripts: every visit loads them. */
  readonly initial: readonly { readonly file: string; readonly bytes: number }[];
  /** gzip -9 total of `initial`. */
  readonly eager: number;
  /** Lazy groups a first visit (fresh profile) loads before the empty state: the First-run dialog. */
  readonly firstVisit: readonly LazyGroup[];
  /** The measured initial route of a first visit: `eager` plus `firstVisit` (gated, compared to the target). */
  readonly total: number;
  readonly gate: number;
  readonly target: number;
  readonly lazy: readonly LazyGroup[];
  readonly violations: readonly string[];
  readonly present: readonly string[];
  /** M6a (§5.27): the route against the recorded baseline and the allowance; null without a baseline file. */
  readonly eagerDelta: EagerDelta | null;
  /** M6a (§5.27): the lazy groups entering Model loads. */
  readonly modelChunk: ModelChunk;
  /** Per-package attribution of the eager scripts (builds with source maps), else null. */
  readonly attribution: {
    readonly packages: readonly {
      readonly pkg: string;
      readonly gzip: number;
      readonly raw: number;
      readonly modules: number;
    }[];
    readonly unmappedChunks: number;
    readonly total: number;
  } | null;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
  readonly ok: boolean;
}
export interface SizeBaseline {
  readonly baseline: { readonly total: number; readonly label?: string; readonly recorded?: string };
  readonly eagerDelta: {
    /** The gate's name in messages (default "Eager delta"). */
    readonly label?: string;
    readonly allowance: number;
    readonly enforce: boolean;
    readonly pending?: string;
    readonly gate?: string;
    /** M6B-SPEC §0.4.9: the per-package eager allowances inside the gate (bytes). */
    readonly packages?: Readonly<Record<string, number>>;
  };
  readonly modelChunk?: { readonly warnBytes?: number; readonly boundaries?: readonly string[] };
  /** The record this baseline replaced (kept for the history; never compared). */
  readonly previous?: Readonly<Record<string, unknown>>;
}
export interface EagerDelta {
  readonly baseline: number;
  readonly allowance: number;
  readonly limit: number;
  readonly delta: number;
  readonly over: boolean;
  readonly label: string;
  readonly enforced: boolean;
  readonly comparable: boolean;
  readonly pending: string | null;
  readonly packages: Readonly<Record<string, number>> | null;
}
export interface ModelChunk {
  readonly bytes: number;
  readonly warnBytes: number;
  readonly over: boolean;
  readonly groups: readonly string[];
}
export declare const GATE_BYTES: number;
export declare const TARGET_BYTES: number;
export declare const FIRST_VISIT: readonly string[];
export declare const BOUNDARIES: readonly {
  readonly id: string;
  readonly label: string;
  readonly markers: readonly string[];
}[];
export declare const BASELINE_FILE: string;
export declare const M6B_CHUNK_WARN_BYTES: Readonly<Record<string, number>>;
export declare function readBaseline(file?: string): SizeBaseline | null;
export declare function eagerDelta(total: number, baseline: SizeBaseline | null, e2eBuild: boolean): EagerDelta | null;
export declare function modelChunk(lazy: readonly LazyGroup[], baseline: SizeBaseline | null): ModelChunk;
export declare function checkSize(
  nextDir: string,
  opts?: {
    readonly gate?: number;
    readonly target?: number;
    readonly route?: string;
    /** The baseline (default: size-baseline.json; null: none). */
    readonly baseline?: SizeBaseline | null;
    /** Attribute the eager scripts when they have source maps (default true). */
    readonly attribute?: boolean;
  },
): SizeReport;
