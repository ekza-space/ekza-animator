// When the workspace tabs re-read their status glyphs (M6A-SPEC §4.6: `status?(app)` is read on human-speed changes
// only; B9). A committed change (a document batch, a mesh rebuilt or committed) schedules one re-read at most
// STATUS_SETTLE_MS later, however many changes arrive meanwhile. Preview frames (a drag writes one per frame: key
// drags, the Scale tool, tool previews) schedule nothing while they keep coming: the statuses are re-read once the
// previews have been quiet for STATUS_SETTLE_MS (a cancelled drag leaves no committed batch behind) or as soon as a
// committed change arrives. While a drag runs this arms one timer per STATUS_SETTLE_MS and reads no status.

/** How long the tabs wait before they re-read the statuses, ms. */
export const STATUS_SETTLE_MS = 250;

export interface StatusTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface StatusSchedule {
  /** A committed change: the statuses are re-read within STATUS_SETTLE_MS. */
  committed(): void;
  /** A preview frame: the statuses are re-read once previews have been quiet for STATUS_SETTLE_MS. */
  preview(): void;
  dispose(): void;
}

const DEFAULT_TIMERS: StatusTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createStatusSchedule(reread: () => void, timers: StatusTimers = DEFAULT_TIMERS): StatusSchedule {
  let handle: unknown = null;
  let disposed = false;
  let committed = false;
  let previewed = false;
  const arm = (): void => {
    if (handle === null && !disposed) handle = timers.set(fire, STATUS_SETTLE_MS);
  };
  function fire(): void {
    handle = null;
    if (!committed && previewed) {
      // Previews came in the last window: wait for a quiet one.
      previewed = false;
      arm();
      return;
    }
    committed = false;
    previewed = false;
    reread();
  }
  return {
    committed() {
      committed = true;
      arm();
    },
    preview() {
      previewed = true;
      arm();
    },
    dispose() {
      disposed = true;
      if (handle !== null) timers.clear(handle);
      handle = null;
    },
  };
}
