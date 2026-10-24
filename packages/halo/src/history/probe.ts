// The History ribbon's probe for the test API (STUDIO-TOUCH-SPEC §20.7; T10): an eager, import-free slot the lazy
// History sheet fills while it is open, so `halo().slices.history` reads its rows without loading the sheet (§20.6).

export interface HistoryProbe {
  /** The rows as shown, newest first: a step (its label, side, folded selections) or an AI group (title, steps). */
  readonly rows: readonly (
    | {
        readonly kind: 'step';
        readonly id: number;
        readonly label: string;
        readonly side: 'undo' | 'redo';
        readonly folded: number;
        readonly ai: boolean;
      }
    | {
        readonly kind: 'ai';
        readonly id: number;
        readonly title: string;
        readonly text: string;
        readonly steps: readonly number[];
      }
  )[];
}

const probes = new WeakMap<object, () => HistoryProbe>();

export function provideHistoryProbe(owner: object, probe: () => HistoryProbe): () => void {
  probes.set(owner, probe);
  return () => {
    if (probes.get(owner) === probe) probes.delete(owner);
  };
}

/** The open History sheet's rows, or null (closed or loading). */
export function historyProbe(owner: object): HistoryProbe | null {
  return probes.get(owner)?.() ?? null;
}
