// The loader of the lazy scale chunk (M6A-SPEC §4.7, §5.27; B9): eager and tiny. The Scale tool and the
// ViewportManager share one load; until it resolves the tool does nothing and no scale manipulator shows.
import type * as ScaleKitModule from './kit';

export type ScaleKit = typeof ScaleKitModule;

let kit: ScaleKit | null = null;
let loading: Promise<ScaleKit> | null = null;

/** Loads the scale chunk once (later calls share the promise; a failed load is retried by the next call). */
export function loadScaleKit(): Promise<ScaleKit> {
  loading ??= import('./kit').then(
    (loaded) => {
      kit = loaded;
      return loaded;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The scale chunk once loaded, else null. */
export function scaleKit(): ScaleKit | null {
  return kit;
}
