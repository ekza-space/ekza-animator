// Types of check-size.mjs for the app's tests (the script itself is plain ESM run by Node).
export interface SizeReport {
  readonly e2eBuild: boolean;
  readonly initial: readonly { readonly file: string; readonly bytes: number }[];
  readonly total: number;
  readonly gate: number;
  readonly target: number;
  readonly lazy: readonly {
    readonly id: number;
    readonly label: string;
    readonly boundary: string | null;
    readonly files: readonly string[];
    readonly bytes: number;
  }[];
  readonly violations: readonly string[];
  readonly present: readonly string[];
  readonly problems: readonly string[];
  readonly ok: boolean;
}
export declare const GATE_BYTES: number;
export declare const TARGET_BYTES: number;
export declare const BOUNDARIES: readonly {
  readonly id: string;
  readonly label: string;
  readonly markers: readonly string[];
}[];
export declare function checkSize(
  nextDir: string,
  opts?: { readonly gate?: number; readonly target?: number; readonly route?: string },
): SizeReport;
