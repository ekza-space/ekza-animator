// The mounted Curves layer's probe for the test API (STUDIO-TOUCH-SPEC §20.7; T10): an eager, import-free slot the lazy
// layer fills while it is mounted, so the `animate` slice reads it without loading the curve editor (§20.6).

/** What the Curves layer reports (plain JSON; page CSS px). */
export interface CurvesProbe {
  /** The graph canvas in page px, and its shown size ÷ the controller's. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly scale: number;
  readonly view: { readonly f0: number; readonly v0: number; readonly sx: number; readonly sy: number };
  readonly tool: string;
  readonly axis: string;
  readonly compare: boolean;
  /** The controls listed, the channel chips (plain label, chosen) and the curves drawn. */
  readonly controls: readonly string[];
  readonly chips: readonly { readonly channel: string; readonly label: string; readonly chosen: boolean }[];
  readonly curves: readonly string[];
  /** The drawn keys of the shown curves (page px), at most 400. */
  readonly keys: readonly {
    readonly id: string;
    readonly curve: string;
    readonly frame: number;
    readonly value: number;
    readonly x: number;
    readonly y: number;
    readonly selected: boolean;
  }[];
  /** A page point on empty graph space (no key, handle or curve under it), or null. */
  readonly empty: { readonly x: number; readonly y: number } | null;
  /** The time axis as drawn: its numbers (text, frame), its unit. */
  readonly axisLabels: readonly { readonly frame: number; readonly text: string }[];
  readonly units: string;
  /** The selected keys' numbers (null: they differ). */
  readonly fields: Record<string, number | null | boolean | string>;
  /** Curves with a buffer (the *⇆ Before* snapshot). */
  readonly buffered: readonly string[];
}

const probes = new WeakMap<object, () => CurvesProbe | null>();

export function provideCurvesProbe(owner: object, probe: () => CurvesProbe | null): () => void {
  probes.set(owner, probe);
  return () => {
    if (probes.get(owner) === probe) probes.delete(owner);
  };
}

/** The mounted Curves layer's state, or null (layer closed or still loading). */
export function curvesProbe(owner: object): CurvesProbe | null {
  return probes.get(owner)?.() ?? null;
}
