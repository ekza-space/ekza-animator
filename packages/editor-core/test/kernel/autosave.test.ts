// M2A-SPEC §5.20 (FR-PROJ-05): the autosave scheduler (debounce, max interval, deferred during a preview, serialized
// writes, clean ends, quota pause, storage off), housekeeping and the orphan list, and the operators file.recover,
// file.discardRecovery and file.autosaveNow — on the wave fixture with a manual clock and an in-memory store.
import type { AssetId, AssetRecord, DocSnapshot } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_BLOCKED_TOAST,
  AUTOSAVE_QUOTA_TOAST,
  type AutosaveClock,
  autosaveOf,
  MAX_ORPHANS,
  ORPHAN_MAX_AGE_MS,
  startAutosave,
} from '../../src/app/autosave';
import { createFakeServices, type FakeServices } from '../../src/testing';
import type { AutosaveSlotInfo, AutosaveStore, EditorApp } from '../../src/types';
import { docJson, opsAppWith, runOk, runResult, WAVE, waveDoc } from '../builtin/support';

const DAY = 24 * 60 * 60 * 1000;

/**
 * A manual clock: timers and idle callbacks run when `advance` passes their time. Idle callbacks run `idleMs` after
 * they were requested (0: at once), like a busy main thread that gets idle a little later.
 */
function manualClock(start = 1_000_000, idleMs = 0) {
  let now = start;
  let seq = 0;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  const clock: AutosaveClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      tasks.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout: (handle) => {
      tasks.delete(handle as number);
    },
    idle: (fn) => {
      const id = ++seq;
      tasks.set(id, { at: now + idleMs, fn });
    },
  };
  /** Runs every task due within `ms` in time order (tasks scheduled meanwhile too), then settles promises. */
  const advance = async (ms: number): Promise<void> => {
    const end = now + ms;
    for (;;) {
      await flush();
      const next = [...tasks.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (next === undefined) break;
      tasks.delete(next[0]);
      now = Math.max(now, next[1].at);
      next[1].fn();
    }
    now = end;
    await flush();
  };
  return { clock, advance, pending: () => tasks.size };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

interface MemorySlot {
  info: Omit<AutosaveSlotInfo, 'id'> | null;
  snapshot: string | null;
  assets: AssetId[];
  live: boolean;
}

/** In-memory AutosaveStore: slots and assets in maps, writes that can be held, failed or counted. */
function memoryStore(opts: { readonly openFails?: boolean } = {}) {
  const slots = new Map<string, MemorySlot>();
  const assets = new Map<AssetId, { record: AssetRecord; bytes: Uint8Array }>();
  const writes: { slot: string; snapshotJson: string; info: Omit<AutosaveSlotInfo, 'id' | 'bytes'> }[] = [];
  const removed: string[] = [];
  let next = 0;
  let hold: Promise<void> | null = null;
  let failNext: Error | null = null;
  let started = 0;
  const store: AutosaveStore = {
    open: async () => {
      if (opts.openFails === true) throw new DOMException('blocked', 'SecurityError');
      const id = `as_${String(++next).padStart(16, '0')}`;
      slots.set(id, { info: null, snapshot: null, assets: [], live: true });
      return id;
    },
    write: async (slot, data, readAsset) => {
      started++;
      if (hold !== null) await hold;
      if (failNext !== null) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      let bytes = new TextEncoder().encode(data.snapshotJson).byteLength;
      for (const record of data.assets) {
        if (assets.has(record.id)) continue;
        const asset = await readAsset(record.id);
        bytes += asset.byteLength;
        assets.set(record.id, { record, bytes: asset });
      }
      writes.push({ slot, snapshotJson: data.snapshotJson, info: data.info });
      const row = slots.get(slot) ?? { info: null, snapshot: null, assets: [], live: true };
      slots.set(slot, {
        ...row,
        info: { ...data.info, bytes },
        snapshot: data.snapshotJson,
        assets: data.assets.map((a) => a.id),
      });
      return { bytes };
    },
    listOrphans: async () =>
      [...slots.entries()]
        .filter(([, row]) => !row.live && row.snapshot !== null && row.info !== null)
        .map(([id, row]) => ({ ...(row.info as Omit<AutosaveSlotInfo, 'id'>), id }))
        .sort((a, b) => b.savedAt - a.savedAt),
    read: async (slot) => {
      const row = slots.get(slot);
      if (row === undefined || row.snapshot === null) return null;
      const out = new Map<AssetId, { record: AssetRecord; bytes: Uint8Array }>();
      for (const id of row.assets) {
        const asset = assets.get(id);
        if (asset !== undefined) out.set(id, asset);
      }
      return { snapshot: JSON.parse(row.snapshot) as unknown, assets: out };
    },
    remove: async (slot) => {
      removed.push(slot);
      const row = slots.get(slot);
      if (row?.live === true) slots.set(slot, { ...row, info: null, snapshot: null, assets: [] });
      else slots.delete(slot);
    },
  };
  return {
    store,
    slots,
    writes,
    removed,
    started: () => started,
    /** Holds every write until the returned release runs. */
    hold(): () => void {
      let release: () => void = () => {};
      hold = new Promise<void>((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
      return release;
    },
    failNextWith(error: Error): void {
      failNext = error;
    },
    /** An orphan left by an earlier page (its lock gone). */
    addOrphan(info: Partial<Omit<AutosaveSlotInfo, 'id'>> & { readonly savedAt: number }, snapshot: string): string {
      const id = `as_old${String(++next).padStart(13, '0')}`;
      slots.set(id, {
        info: {
          projectName: 'Old',
          characters: 1,
          clips: 1,
          bytes: snapshot.length,
          appVersion: '0.1.0',
          schemaVersion: 2,
          ...info,
        },
        snapshot,
        assets: [],
        live: false,
      });
      return id;
    },
  };
}

type Memory = ReturnType<typeof memoryStore>;

function setup(
  opts: { readonly memory?: Memory | null; readonly snapshot?: DocSnapshot; readonly idleMs?: number } = {},
) {
  const memory = opts.memory === undefined ? memoryStore() : opts.memory;
  const services: FakeServices & { autosave: AutosaveStore | null } = {
    ...createFakeServices(),
    autosave: memory?.store ?? null,
  };
  const { app } = opsAppWith({ services, ...(opts.snapshot === undefined ? {} : { snapshot: opts.snapshot }) });
  const { clock, advance, pending } = manualClock(undefined, opts.idleMs);
  const controller = startAutosave(app, { clock });
  return { app, services, memory, clock, advance, pending, controller };
}

/** One committed change of the wave clip (a key value). */
function edit(app: EditorApp, value = 0.25): void {
  app.store.transact({ label: 'Edit' }, (tx) => tx.patch('keys', WAVE.keys[0], { v: value }));
}

describe('autosave start', () => {
  it('claims a slot and reports it; lists no orphans on a fresh store', async () => {
    const { app, controller } = setup();
    await controller.ready;
    expect(app.session.getState().autosave).toEqual({
      enabled: true,
      slot: 'as_0000000000000001',
      lastSavedAt: null,
      pending: false,
      error: null,
    });
    expect(app.session.getState().recovery).toEqual([]);
    expect(autosaveOf(app)).toBe(controller);
    expect(startAutosave(app)).toBe(controller);
  });

  it('without a store autosave is off and says so once', async () => {
    const { app, services, controller } = setup({ memory: null });
    await controller.ready;
    expect(app.session.getState().autosave.enabled).toBe(false);
    expect(services.toasts).toEqual([{ kind: 'info', text: AUTOSAVE_BLOCKED_TOAST }]);
    edit(app);
    expect(await controller.writeNow()).toBeNull();
    expect((await runResult(app, 'file.autosaveNow')).status).toBe('cancelled');
  });

  it('a store that refuses the claim (blocked IndexedDB) turns autosave off with the same notice', async () => {
    const { app, services, controller } = setup({ memory: memoryStore({ openFails: true }) });
    await controller.ready;
    expect(app.session.getState().autosave).toMatchObject({ enabled: false, slot: null });
    expect(services.toasts.map((t) => t.text)).toEqual([AUTOSAVE_BLOCKED_TOAST]);
  });

  it('prefs.autosave.enabled false keeps it off silently and on again when re-enabled', async () => {
    const { app, services, controller, memory, advance } = setup();
    app.prefs.setState({ autosave: { ...app.prefs.getState().autosave, enabled: false } });
    await controller.ready;
    expect(app.session.getState().autosave.enabled).toBe(false);
    edit(app);
    await advance(60_000);
    expect(memory?.writes).toHaveLength(0);
    app.prefs.setState({ autosave: { ...app.prefs.getState().autosave, enabled: true } });
    expect(app.session.getState().autosave.enabled).toBe(true);
    await advance(30_000);
    expect(memory?.writes).toHaveLength(1);
    expect(services.toasts).toEqual([]);
  });

  it('housekeeping: orphans older than 14 days go, at most 5 are kept (newest), the list fills session.recovery', async () => {
    const memory = memoryStore();
    const now = 1_000_000;
    const ancient = memory.addOrphan({ savedAt: now - ORPHAN_MAX_AGE_MS - 1 }, '{}');
    const kept = Array.from({ length: 7 }, (_, i) =>
      memory.addOrphan({ savedAt: now - (i + 1) * DAY, projectName: `P${i}` }, '{}'),
    );
    const { app, controller } = setup({ memory });
    await controller.ready;
    const recovery = app.session.getState().recovery;
    expect(recovery.map((slot) => slot.id)).toEqual(kept.slice(0, MAX_ORPHANS));
    expect(recovery.map((slot) => slot.projectName)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4']);
    expect(memory.removed.sort()).toEqual([ancient, ...kept.slice(MAX_ORPHANS)].sort());
  });

  it('looks for orphans once more a few seconds after start (a reloaded page may still hold its lock)', async () => {
    const { app, controller, memory, advance } = setup();
    await controller.ready;
    expect(app.session.getState().recovery).toEqual([]);
    const late = memory?.addOrphan({ savedAt: 999_000 }, '{}') ?? '';
    await advance(3000);
    expect(app.session.getState().recovery.map((slot) => slot.id)).toEqual([late]);
  });
});

describe('autosave cadence', () => {
  it('writes delayMs after the last committed batch (debounce) with the snapshot and slot info', async () => {
    const { app, controller, memory, advance } = setup();
    await controller.ready;
    edit(app, 0.1);
    expect(app.session.getState().autosave.pending).toBe(true);
    await advance(1500);
    edit(app, 0.2);
    await advance(1999);
    expect(memory?.writes).toHaveLength(0);
    await advance(1);
    expect(memory?.writes).toHaveLength(1);
    const written = memory?.writes[0];
    expect(JSON.parse(written?.snapshotJson ?? '')).toEqual(docJson(app));
    expect(written?.info).toMatchObject({ characters: 1, clips: 1, projectName: app.session.getState().projectName });
    expect(app.session.getState().autosave).toMatchObject({ pending: false, lastSavedAt: 1_003_500, error: null });
  });

  it('writes at most maxIntervalMs after the first unsaved batch while edits keep coming', async () => {
    const { app, controller, memory, advance } = setup();
    await controller.ready;
    for (let t = 0; t < 40; t++) {
      edit(app, t / 100);
      await advance(1000);
    }
    expect(memory?.writes.length).toBe(1);
    // the first write came 30 s after the first edit; edits after it start a new interval
    expect(memory?.writes[0]?.info.savedAt).toBe(1_000_000 + 30_000);
  });

  it('never writes during a preview (gesture): the write waits for its commit, or for its cancel', async () => {
    const { app, controller, memory, advance } = setup();
    await controller.ready;
    edit(app);
    const preview = app.store.beginPreview('Drag');
    preview.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.5 }));
    await advance(5000);
    expect(memory?.writes).toHaveLength(0);
    preview.commit({ label: 'Drag' });
    await advance(0);
    expect(memory?.writes).toHaveLength(1);
    // a cancelled gesture lets a waiting write run with the committed state
    edit(app, 0.7);
    const second = app.store.beginPreview('Drag');
    second.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.9 }));
    await advance(5000);
    expect(memory?.writes).toHaveLength(1);
    second.cancel();
    await advance(0);
    expect(memory?.writes).toHaveLength(2);
    expect(JSON.parse(memory?.writes[1]?.snapshotJson ?? '')).toEqual(docJson(app));
  });

  it('a write that came due just before a gesture began waits for the gesture (its idle callback looks again)', async () => {
    const { app, controller, memory, advance } = setup({ idleMs: 50 });
    await controller.ready;
    edit(app);
    await advance(2000); // the debounce is over: the write waits for an idle moment
    expect(memory?.writes).toHaveLength(0);
    const preview = app.store.beginPreview('Drag');
    preview.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.5 }));
    await advance(5000);
    expect(memory?.started()).toBe(0);
    preview.commit({ label: 'Drag' });
    await advance(100);
    expect(memory?.writes).toHaveLength(1);
    expect(JSON.parse(memory?.writes[0]?.snapshotJson ?? '')).toEqual(docJson(app));
    // the same with a cancelled gesture
    edit(app, 0.6);
    await advance(2000);
    const second = app.store.beginPreview('Drag');
    second.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.9 }));
    await advance(5000);
    expect(memory?.started()).toBe(1);
    second.cancel();
    await advance(100);
    expect(memory?.writes).toHaveLength(2);
    expect(JSON.parse(memory?.writes[1]?.snapshotJson ?? '')).toEqual(docJson(app));
  });

  it('a write queued just before a clean end is dropped: a saved document leaves no snapshot behind', async () => {
    const { app, controller, memory, advance } = setup({ idleMs: 50 });
    await controller.ready;
    edit(app);
    await advance(2000); // queued for the next idle moment
    app.session.setState({ dirty: true });
    app.session.setState({ dirty: false }); // the save finished first
    await advance(1000);
    expect(memory?.started()).toBe(0);
    expect(memory?.slots.get('as_0000000000000001')?.snapshot).toBeNull();
    expect(app.session.getState().autosave.pending).toBe(false);
    // the next edit is autosaved as usual
    edit(app, 0.3);
    await advance(2100);
    expect(memory?.writes).toHaveLength(1);
  });

  it('ignores preview and load batches', async () => {
    const { app, controller, memory, advance } = setup();
    await controller.ready;
    const preview = app.store.beginPreview('Drag');
    preview.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.5 }));
    preview.cancel();
    app.store.load(waveDoc());
    await advance(60_000);
    expect(memory?.writes).toHaveLength(0);
    expect(app.session.getState().autosave.pending).toBe(false);
  });

  it('serializes writes: a write requested during another starts after it', async () => {
    const { app, controller, memory } = setup();
    await controller.ready;
    edit(app);
    const release = memory?.hold() ?? (() => {});
    const first = controller.writeNow();
    const second = controller.writeNow();
    await flush();
    expect(memory?.started()).toBe(1);
    release();
    await first;
    await second;
    expect(memory?.started()).toBe(2);
    expect(memory?.writes).toHaveLength(2);
  });

  it('a save, a new project or an opened project ends cleanly: the slot is emptied and pending work dropped', async () => {
    const { app, controller, memory, advance } = setup();
    await controller.ready;
    edit(app);
    await advance(2000);
    expect(memory?.slots.get('as_0000000000000001')?.snapshot).not.toBeNull();
    edit(app, 0.3);
    app.session.setState({ dirty: false }); // what a successful file.save / file.new / openProject does
    await advance(60_000);
    expect(memory?.removed).toContain('as_0000000000000001');
    expect(memory?.slots.get('as_0000000000000001')?.snapshot).toBeNull();
    expect(memory?.writes).toHaveLength(1);
    expect(app.session.getState().autosave.pending).toBe(false);
  });

  it('a quota error pauses autosave with one warning until the next save', async () => {
    const { app, services, controller, memory, advance } = setup();
    await controller.ready;
    memory?.failNextWith(new DOMException('full', 'QuotaExceededError'));
    edit(app);
    await advance(2000);
    expect(app.session.getState().autosave).toMatchObject({ error: 'quota', pending: false });
    expect(services.toasts).toEqual([{ kind: 'warning', text: AUTOSAVE_QUOTA_TOAST }]);
    edit(app, 0.4);
    await advance(60_000);
    expect(memory?.writes).toHaveLength(0);
    expect((await runResult(app, 'file.autosaveNow')).status).toBe('cancelled');
    app.session.setState({ dirty: true });
    app.session.setState({ dirty: false }); // saved
    expect(app.session.getState().autosave.error).toBeNull();
    edit(app, 0.5);
    await advance(2000);
    expect(memory?.writes).toHaveLength(1);
    expect(services.toasts).toHaveLength(1);
  });

  it('clean() on beforeunload removes a clean page snapshot but never unsaved work', async () => {
    const { app, controller, memory } = setup();
    await controller.ready;
    edit(app);
    await controller.writeNow();
    app.session.setState({ dirty: true });
    await controller.clean();
    expect(memory?.removed).toEqual([]);
    app.session.setState({ dirty: false });
    await flush();
    await controller.clean();
    expect(memory?.removed).toContain('as_0000000000000001');
  });

  it('dispose stops scheduling and drops the controller', async () => {
    const { app, controller, memory, advance } = setup();
    await controller.ready;
    edit(app);
    controller.dispose();
    await advance(60_000);
    expect(memory?.writes).toHaveLength(0);
    expect(autosaveOf(app)).toBeNull();
  });
});

describe('file.autosaveNow, file.recover, file.discardRecovery', () => {
  it('file.autosaveNow writes now and returns the slot and bytes', async () => {
    const { app, controller, memory } = setup();
    await controller.ready;
    const written = (await runOk(app, 'file.autosaveNow')) as { slot: string; bytes: number };
    expect(written.slot).toBe('as_0000000000000001');
    expect(written.bytes).toBe(new TextEncoder().encode(memory?.writes[0]?.snapshotJson ?? '').byteLength);
    expect(app.history.canUndo()).toBe(false);
  });

  it('recovers an orphan: its document, dirty, empty history, the toast; the slot goes after the next write', async () => {
    // A page that autosaved an edited wave document, then closed.
    const first = setup();
    await first.controller.ready;
    edit(first.app, 0.42);
    await first.controller.writeNow();
    const saved = docJson(first.app);
    const snapshot = first.memory?.writes[0]?.snapshotJson ?? '';

    const memory = memoryStore();
    const orphan = memory.addOrphan({ savedAt: 999_000, projectName: 'Wave', characters: 1, clips: 1 }, snapshot);
    const { app, services, controller, advance } = setup({
      memory,
      snapshot: { ...waveDoc(), tables: {} } as DocSnapshot,
    });
    await controller.ready;
    expect(app.session.getState().recovery.map((slot) => slot.id)).toEqual([orphan]);
    app.session.setState({ dialog: 'recovery' });
    expect(await runOk(app, 'file.recover', { slot: orphan })).toEqual({ readOnly: false });
    expect(docJson(app)).toEqual(saved);
    expect(app.session.getState()).toMatchObject({ dirty: true, dialog: null, recovery: [] });
    expect(app.history.canUndo()).toBe(false);
    const recoveredToast = services.toasts.find((toast) => toast.text.startsWith('Recovered'));
    expect(recoveredToast).toMatchObject({ kind: 'success' });
    // the document's own project name, the time of the recovery point
    expect(recoveredToast?.text).toMatch(/^Recovered 'Wave \(synthetic\)' from .+\. Save it to keep it\.$/);
    expect(app.session.getState().projectName).toBe('Wave (synthetic)');
    expect(memory.slots.has(orphan)).toBe(true);
    await advance(2000);
    expect(memory.writes).toHaveLength(1);
    expect(memory.slots.has(orphan)).toBe(false);
  });

  it('recover refuses a slot that is gone; discard removes a slot and its row', async () => {
    const memory = memoryStore();
    const a = memory.addOrphan({ savedAt: 999_000 }, JSON.stringify(waveDoc()));
    const b = memory.addOrphan({ savedAt: 998_000 }, JSON.stringify(waveDoc()));
    const { app, controller } = setup({ memory });
    await controller.ready;
    expect((await runResult(app, 'file.recover', { slot: 'as_missing' })).status).toBe('failed');
    await runOk(app, 'file.discardRecovery', { slot: a });
    expect(memory.slots.has(a)).toBe(false);
    expect(app.session.getState().recovery.map((slot) => slot.id)).toEqual([b]);
    expect((await runResult(app, 'file.discardRecovery', {})).status).toBe('cancelled');
  });

  it('without a controller every autosave operator poll-fails "Autosave is off"', async () => {
    const { app } = opsAppWith();
    for (const [id, args] of [
      ['file.recover', { slot: 'as_x' }],
      ['file.discardRecovery', { slot: 'as_x' }],
      ['file.autosaveNow', undefined],
    ] as const) {
      expect(await runResult(app, id, args)).toEqual({ status: 'cancelled', reason: 'Autosave is off in this editor' });
    }
  });
});
