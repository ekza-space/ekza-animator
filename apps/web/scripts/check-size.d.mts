// Types of check-size.mjs for the app's tests (the script itself is plain ESM run by Node).
export interface LazyGroup {
  readonly id: number;
  readonly label: string;
  readonly boundary: string | null;
  readonly files: readonly string[];
  readonly bytes: number;
}
export interface SizeReport {
  /** AUTORIG-SPEC §7.2: the measured route ('editor', 'autorig', 'app') and its app-paths segment. */
  readonly route: string;
  readonly segment: string;
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
  /** False while a route's gate is reported only (`/autorig` until D1 records its baseline). */
  readonly gateEnforced: boolean;
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
  /** AUTORIG-SPEC §7.2: per-route records of the routes other than `/editor` (D1 records `/autorig`'s). */
  readonly routes?: Readonly<
    Record<
      string,
      {
        readonly gate?: number;
        readonly target?: number;
        readonly enforce?: boolean;
        readonly total?: number | null;
        readonly pending?: string;
      }
    >
  >;
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
export declare const ROUTES: readonly string[];
export declare const AUTORIG_GATE_BYTES: number;
export declare const AUTORIG_TARGET_BYTES: number;
/** STUDIO-TOUCH-SPEC §20.6 (T2): `/app`'s gate and target. */
export declare const HALO_GATE_BYTES: number;
export declare const HALO_TARGET_BYTES: number;
export declare const ROUTE_BOUNDARIES: Readonly<
  Record<string, readonly { readonly id: string; readonly label: string; readonly markers: readonly string[] }[]>
>;
export declare const ROUTE_LIMITS: Readonly<
  Record<string, { readonly gate: number; readonly target: number; readonly firstVisit: readonly string[] }>
>;
export declare function boundariesFor(
  route: string,
): readonly { readonly id: string; readonly label: string; readonly markers: readonly string[] }[];
export declare function hasRoute(nextDir: string, route: string): boolean;
export declare function hasSourcePage(appDir: string, route: string): boolean;
export declare function checkRoutes(
  nextDir: string,
  opts?: {
    readonly routes?: readonly string[];
    /** The app source (`<appDir>/app`): routes with a page there are required in the build. */
    readonly appDir?: string;
    readonly baseline?: SizeBaseline | null;
    readonly attribute?: boolean;
  },
): { readonly reports: Readonly<Record<string, SizeReport>>; readonly ok: boolean };
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
