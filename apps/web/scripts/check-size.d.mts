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
  readonly problems: readonly string[];
  readonly ok: boolean;
}
export declare const GATE_BYTES: number;
export declare const TARGET_BYTES: number;
export declare const FIRST_VISIT: readonly string[];
export declare const BOUNDARIES: readonly {
  readonly id: string;
  readonly label: string;
  readonly markers: readonly string[];
}[];
export declare function checkSize(
  nextDir: string,
  opts?: { readonly gate?: number; readonly target?: number; readonly route?: string },
): SizeReport;
