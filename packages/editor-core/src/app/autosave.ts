// Autosave and crash recovery (M2A-SPEC §5.20, FR-PROJ-05): the scheduler that writes this page's slot of the host's
// `AutosaveStore` and keeps `session.autosave` / `session.recovery` current. The browser host starts it once per page
// (`startAutosave`); headless tests drive it with a fake store and timers. Nothing here runs without a store.
//
// - Start: claim a slot (`store.open`), then housekeeping (orphans older than 14 days removed, at most 5 kept) and
//   the orphan list into `session.recovery`. A missing store or a failed claim turns autosave off with one info toast.
// - Cadence: every committed batch but 'preview' and 'load' marks the document unsaved; the write runs `delayMs` after
//   the last such batch but at most `maxIntervalMs` after the first unsaved one, never while a preview (gesture) is
//   active (it waits for the commit or the cancel), in an idle callback, one write at a time. The idle callback looks
//   again before it writes: a gesture that began meanwhile defers it, a clean end meanwhile drops it.
// - Clean ends: when the document stops being dirty (a save, a new or opened project) the slot's snapshot is removed
//   and pending writes are dropped; a quota error pauses autosave until then, with one warning toast.
import { SCHEMA_VERSION, serializeSnapshot } from '@ekza-animator/doc';
import type { AssetRecord, ChangeBatch } from '@ekza-animator/doc';
import type { AutosaveSlotInfo, AutosaveStatus, AutosaveStore, EditorApp } from '../types';
import { openAllPartitions } from '../workflows/project';
import { EDITOR_VERSION } from '../workflows/samples';

/** Orphans older than this are removed at start (§5.20 housekeeping). */
export const ORPHAN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** At most this many orphans are kept (the oldest beyond it are removed at start). */
export const MAX_ORPHANS = 5;
/** The orphan list is read again this long after start (a reloaded page's lock may outlive the reload briefly). */
export const RECOVERY_RECHECK_MS = 3000;

export const AUTOSAVE_BLOCKED_TOAST = 'Autosave is off: this browser blocks storage.';
export const AUTOSAVE_QUOTA_TOAST =
  "Autosave paused: the browser's storage for this site is full. Save the project to keep your work.";

/** Timer seams (fake timers in tests; the browser's by default). */
export interface AutosaveClock {
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  /** Runs `fn` when the main thread is idle: `requestIdleCallback` where it exists, else a 0 ms timeout. */
  readonly idle: (fn: () => void) => void;
}

export interface AutosaveController {
  /** Resolves once the slot is claimed and the orphans are listed (or autosave turned itself off). */
  readonly ready: Promise<void>;
  /** The host's store (null: autosave is off for good in this page). */
  readonly store: AutosaveStore | null;
  /** Writes the slot now, after a write in flight; null when autosave is off or paused. Resolves after the commit. */
  writeNow(): Promise<{ readonly slot: string; readonly bytes: number } | null>;
  /** Reads the orphan list into `session.recovery` (start, and once more `RECOVERY_RECHECK_MS` later). */
  refreshRecovery(): Promise<readonly AutosaveSlotInfo[]>;
  /** `slot` was recovered into this page: it is removed after this page's first successful write. */
  markRecovered(slot: string): void;
  /** Removes this page's snapshot (best effort; `beforeunload` while not dirty). */
  clean(): Promise<void>;
  dispose(): void;
}

const controllers = new WeakMap<EditorApp, AutosaveController>();

/** The autosave controller started for `app`, or null (Node, or before the host started it). */
export function autosaveOf(app: EditorApp): AutosaveController | null {
  return controllers.get(app) ?? null;
}

function browserClock(): AutosaveClock {
  const idle = (globalThis as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    idle:
      typeof idle === 'function'
        ? (fn) => {
            idle(fn, { timeout: 1000 });
          }
        : (fn) => {
            globalThis.setTimeout(fn, 0);
          },
  };
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Starts autosave for `app` with the host's `services.autosave` (one controller per app; a second call returns the
 * first). Without a store, or when `prefs.autosave.enabled` is false, `session.autosave.enabled` stays false; without
 * a store the user is told once.
 */
export function startAutosave(app: EditorApp, opts?: { readonly clock?: AutosaveClock }): AutosaveController {
  const existing = controllers.get(app);
  if (existing !== undefined) return existing;
  const clock = opts?.clock ?? browserClock();
  const store = app.services.autosave ?? null;
  const prefs = () => app.prefs.getState().autosave;

  let disposed = false;
  let slot: string | null = null;
  /** Off for this page: no store, or the claim failed. */
  let unavailable = store === null;
  let paused = false;
  let firstUnsavedAt: number | null = null;
  let lastBatchAt = 0;
  /** Counts unsaved batches; a write that started at `n` leaves the document saved only if it is still `n`. */
  let unsavedSeq = 0;
  let timer: unknown = null;
  let waitingForCommit = false;
  let chain: Promise<unknown> = Promise.resolve();
  const recovered = new Set<string>();
  const disposers: (() => void)[] = [];

  const setStatus = (patch: Partial<AutosaveStatus>): void => {
    if (disposed) return;
    const current = app.session.getState().autosave;
    const next = { ...current, ...patch };
    if (
      next.enabled === current.enabled &&
      next.slot === current.slot &&
      next.lastSavedAt === current.lastSavedAt &&
      next.pending === current.pending &&
      next.error === current.error
    ) {
      return;
    }
    app.session.setState({ autosave: next });
  };
  const active = (): boolean => !disposed && !unavailable && !paused && slot !== null && prefs().enabled;

  const cancelTimer = (): void => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    cancelTimer();
    if (!active() || firstUnsavedAt === null) return;
    const settings = prefs();
    const due = Math.min(lastBatchAt + settings.delayMs, firstUnsavedAt + settings.maxIntervalMs);
    timer = clock.setTimeout(
      () => {
        timer = null;
        if (app.store.preview !== null) {
          waitingForCommit = true;
          return;
        }
        queueWrite();
      },
      Math.max(0, due - clock.now()),
    );
  };

  /** Queues a cadence write for the next idle moment; it re-checks what held when it was queued (`writeOnce`). */
  const queueWrite = (): void => {
    clock.idle(() => {
      void write(true).catch(() => {});
    });
  };

  const markUnsaved = (): void => {
    const now = clock.now();
    unsavedSeq++;
    lastBatchAt = now;
    firstUnsavedAt ??= now;
    if (!active()) return;
    setStatus({ pending: true });
    schedule();
  };

  const info = (): Omit<AutosaveSlotInfo, 'id' | 'bytes'> => ({
    projectName: app.session.getState().projectName,
    savedAt: clock.now(),
    characters: app.store.list('characters').length,
    clips: app.store.list('clips').length,
    appVersion: EDITOR_VERSION,
    schemaVersion: SCHEMA_VERSION,
  });

  /**
   * One write of the slot. A `queued` write (the cadence's, not `writeNow`) runs an idle callback or a write later
   * than it was asked for: when the document ended cleanly since (saved, new, opened) there is nothing to keep, and
   * when a gesture began since it waits for that gesture's commit or cancel (§5.20: never while a preview is active).
   */
  const writeOnce = async (queued: boolean): Promise<{ readonly slot: string; readonly bytes: number } | null> => {
    if (!active() || store === null || slot === null) return null;
    if (queued) {
      if (firstUnsavedAt === null) return null;
      if (app.store.preview !== null) {
        cancelTimer();
        waitingForCommit = true;
        return null;
      }
    }
    const seq = unsavedSeq;
    cancelTimer();
    await openAllPartitions(app);
    const snapshot = app.store.snapshot();
    const snapshotJson = serializeSnapshot(snapshot);
    // Models the asset store does not have (a project opened from the JSON variant) are left out, as in a save.
    const assets: AssetRecord[] = [];
    for (const record of Object.values(snapshot.tables.assets ?? {})) {
      if (await app.services.assets.has(record.id)) assets.push(record);
    }
    try {
      const { bytes } = await store.write(slot, { snapshotJson, assets, info: info() }, (id) =>
        app.services.assets.get(id),
      );
      if (disposed) return { slot, bytes };
      if (unsavedSeq === seq) {
        firstUnsavedAt = null;
        waitingForCommit = false;
      }
      setStatus({ lastSavedAt: clock.now(), pending: firstUnsavedAt !== null, error: null });
      for (const old of recovered) {
        recovered.delete(old);
        await store.remove(old).catch(() => {});
      }
      if (firstUnsavedAt !== null) schedule();
      return { slot, bytes };
    } catch (error) {
      if (isQuotaError(error)) {
        if (!paused) app.services.notify.toast({ kind: 'warning', text: AUTOSAVE_QUOTA_TOAST });
        paused = true;
        cancelTimer();
        setStatus({ pending: false, error: 'quota' });
      } else {
        console.warn('Ekza Animator: autosave failed', error);
        setStatus({ error: messageOf(error) });
      }
      throw error;
    }
  };

  /** Serialized writes: a write waits for the one in flight. */
  const write = (queued = false): Promise<{ readonly slot: string; readonly bytes: number } | null> => {
    const once = (): Promise<{ readonly slot: string; readonly bytes: number } | null> => writeOnce(queued);
    const run = chain.then(once, once);
    chain = run.catch(() => {});
    return run;
  };

  const removeOwn = async (): Promise<void> => {
    if (store === null || slot === null) return;
    await chain;
    await store.remove(slot).catch(() => {});
  };

  const onBatch = (batch: ChangeBatch): void => {
    if (batch.origin === 'preview') {
      // A cancelled gesture restores committed state: a write that waited for it can run now.
      if (waitingForCommit && app.store.preview === null && active()) {
        waitingForCommit = false;
        queueWrite();
      }
      return;
    }
    if (batch.origin === 'load') return;
    markUnsaved();
    if (waitingForCommit && app.store.preview === null && active()) {
      // The write that came due during the gesture runs at its commit.
      waitingForCommit = false;
      cancelTimer();
      queueWrite();
    }
  };

  const refreshRecovery = async (): Promise<readonly AutosaveSlotInfo[]> => {
    if (store === null || unavailable) return [];
    const orphans = [...(await store.listOrphans())].sort((a, b) => b.savedAt - a.savedAt);
    const now = clock.now();
    const keep: AutosaveSlotInfo[] = [];
    for (const orphan of orphans) {
      if (orphan.id === slot || recovered.has(orphan.id)) continue;
      if (now - orphan.savedAt > ORPHAN_MAX_AGE_MS || keep.length >= MAX_ORPHANS) {
        await store.remove(orphan.id).catch(() => {});
        continue;
      }
      keep.push(orphan);
    }
    if (!disposed) app.session.setState({ recovery: keep });
    return keep;
  };

  const turnOff = (error: string | null): void => {
    unavailable = true;
    cancelTimer();
    setStatus({ enabled: false, slot: null, pending: false, error });
    app.services.notify.toast({ kind: 'info', text: AUTOSAVE_BLOCKED_TOAST });
  };

  const start = async (): Promise<void> => {
    if (store === null) {
      turnOff(null);
      return;
    }
    try {
      slot = await store.open();
    } catch (error) {
      if (!disposed) turnOff(messageOf(error));
      return;
    }
    if (disposed) return;
    setStatus({ enabled: prefs().enabled, slot, error: null });
    if (firstUnsavedAt !== null) {
      setStatus({ pending: active() });
      schedule();
    }
    try {
      await refreshRecovery();
    } catch (error) {
      console.warn('Ekza Animator: could not list recovery points', error);
    }
    // A page that was just reloaded may still hold its lock for a moment: look once more a little later.
    timers.recheck = clock.setTimeout(() => {
      timers.recheck = null;
      if (!disposed) void refreshRecovery().catch(() => {});
    }, RECOVERY_RECHECK_MS);
  };
  const timers: { recheck: unknown } = { recheck: null };

  disposers.push(app.store.subscribe(onBatch));
  disposers.push(
    app.session.subscribe((state, previous) => {
      if (previous.dirty && !state.dirty) {
        // A clean end: saved, new or opened project. Pending work is in the file now; quota pauses lift.
        cancelTimer();
        firstUnsavedAt = null;
        waitingForCommit = false;
        if (paused) {
          paused = false;
          setStatus({ error: null });
        }
        setStatus({ pending: false });
        void removeOwn();
      }
    }),
  );
  disposers.push(
    app.prefs.subscribe((next, previous) => {
      if (next.autosave === previous.autosave) return;
      if (unavailable || slot === null) return;
      setStatus({ enabled: next.autosave.enabled });
      if (next.autosave.enabled) schedule();
      else cancelTimer();
    }),
  );

  const controller: AutosaveController = {
    ready: Promise.resolve().then(start),
    store,
    writeNow: () => (active() ? write() : Promise.resolve(null)),
    refreshRecovery,
    markRecovered(old: string): void {
      recovered.add(old);
      const recovery = app.session.getState().recovery;
      if (recovery.some((entry) => entry.id === old)) {
        app.session.setState({ recovery: recovery.filter((entry) => entry.id !== old) });
      }
      markUnsaved();
    },
    // Unsaved work keeps its recovery point; a write in flight finishes first (removeOwn waits for it).
    clean: () => (app.session.getState().dirty || firstUnsavedAt !== null ? Promise.resolve() : removeOwn()),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelTimer();
      if (timers.recheck !== null) clock.clearTimeout(timers.recheck);
      for (const dispose of disposers.splice(0).reverse()) dispose();
      controllers.delete(app);
    },
  };
  controllers.set(app, controller);
  return controller;
}
