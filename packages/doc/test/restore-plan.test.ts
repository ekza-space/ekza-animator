// MCP-SPEC §4.2 / §9.2 doc gate (D0): `planRestore` plans exactly the writes and skips `PatchUndoManager.undo()` and
// `redo()` perform, over the conformance suite's fuzzed edit sequences (with foreign writes mixed in, so skips and
// kept dependants occur); `applyRestorePlan` reproduces the undo result through a transaction on a `strictPut`
// store; `planSnapshotRestore` round-trips a snapshot byte for byte and its transaction undoes in one step.
import { describe, expect, it } from 'vitest';
import {
  type AnyChange,
  applyRestorePlan,
  createMemoryStore,
  diffFields,
  type DocRow,
  type DocumentStore,
  MemoryDocumentStore,
  mergeUnitOf,
  planRestore,
  planSnapshotRestore,
  type RestoreHost,
  type RestorePlan,
  restoreHostOf,
  serializeSnapshot,
  type Tx,
} from '../src';
import { randomLocalEdit } from '../src/testing/conformance/core';
import { docText, keyAt, type Scene, seedScene } from '../src/testing/conformance/harness';
import { Rng } from '../src/testing/random';

const ABORT = new Error('abort the planning transaction');

/** Runs `fn` inside a transaction that is rolled back (nothing is written, the stacks stay as they are). */
function inRolledBackTx<T>(store: DocumentStore, fn: (tx: Tx) => T): T {
  let out: { value: T } | null = null;
  try {
    store.transact({ label: 'plan', undoable: false }, (tx) => {
      out = { value: fn(tx) };
      throw ABORT;
    });
  } catch (error) {
    if (error !== ABORT) throw error;
  }
  if (out === null) throw new Error('the planning transaction did not run');
  return (out as { value: T }).value;
}

/** Every stored record (soft-deleted ones included) as canonical text. */
function rawText(store: DocumentStore): string {
  const host = (store as MemoryDocumentStore).restoreHost();
  const tables: Record<string, Record<string, DocRow>> = {};
  for (const table of [...host.tables()].sort()) {
    const rows: Record<string, DocRow> = {};
    for (const id of [...host.ids(table)].sort()) {
      const record = host.current(table, id);
      if (record !== undefined) rows[id] = record;
    }
    tables[table] = rows;
  }
  return JSON.stringify(tables, (_key, value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  );
}

function change(table: string, id: string, before: DocRow | undefined, after: DocRow | undefined): AnyChange {
  const fields =
    before !== undefined && after !== undefined && mergeUnitOf(table) === 'field'
      ? { fields: diffFields(before, after) }
      : {};
  return { table, id, before, after, ...fields } as unknown as AnyChange;
}

/** A write by "another writer" (a remote batch: never on the undo stack), so undo meets changed records. */
function foreignEdit(store: DocumentStore, scene: Scene, rng: Rng, step: number): void {
  const keys = store.list('keys');
  const roll = rng.int(4);
  if (roll === 0 && keys.length > 0) {
    const key = rng.pick(keys);
    store.applyChanges([change('keys', key.id, key as never, { ...key, v: key.v + 1 })], {
      origin: 'remote',
      label: 'Remote nudge',
    });
  } else if (roll === 1) {
    const id = rng.pick(scene.controls);
    const control = store.get('controls', id);
    if (control !== undefined) {
      store.applyChanges([change('controls', id, control as never, { ...control, name: `r${step}` })], {
        origin: 'remote',
        label: 'Remote rename',
      });
    }
  } else if (roll === 2) {
    // A key on the scene curve: the curve now has a dependant the undo manager must keep alive.
    const key = keyAt(scene, scene.curve, 100 + step, rng.next());
    if (store.getIncludingDeleted('curves', scene.curve) !== undefined) {
      store.applyChanges([change('keys', key.id, undefined, key as never)], { origin: 'remote', label: 'Remote key' });
    }
  } else {
    const clip = store.get('clips', scene.clip);
    if (clip !== undefined) {
      store.applyChanges([change('clips', scene.clip, clip as never, { ...clip, sceneStart: step * 3 })], {
        origin: 'remote',
        label: 'Remote clip',
      });
    }
  }
}

async function editedStore(seed: number, foreign: boolean): Promise<{ store: DocumentStore; scene: Scene }> {
  const store = createMemoryStore();
  const scene = await seedScene(store, seed);
  store.undo.clear();
  const rng = new Rng(seed * 7919);
  const steps = 5 + rng.int(25);
  for (let step = 0; step < steps; step++) {
    randomLocalEdit(store, scene, rng, step);
    if (foreign && rng.int(3) === 0) foreignEdit(store, scene, rng, step);
  }
  return { store, scene };
}

function expectPlanMatches(store: DocumentStore, plan: RestorePlan, direction: 'undo' | 'redo', label: string): void {
  const result = direction === 'undo' ? store.undo.undo() : store.undo.redo();
  if (result === null) throw new Error(`${label}: nothing to ${direction}`);
  expect([`${label}: applied`, plan.writes.length]).toEqual([`${label}: applied`, result.applied]);
  expect([`${label}: skipped`, plan.skipped]).toEqual([`${label}: skipped`, result.skipped]);
  const host = (store as MemoryDocumentStore).restoreHost();
  for (const write of plan.writes) {
    expect([`${label}: ${write.table}/${write.id}`, host.current(write.table, write.id)]).toEqual([
      `${label}: ${write.table}/${write.id}`,
      write.after,
    ]);
  }
}

describe('planRestore (MCP-SPEC §4.2)', () => {
  it('plans exactly the writes and skips of undo() and redo() over the conformance fuzz sequences', async () => {
    let skips = 0;
    let deletesKept = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { store } = await editedStore(seed, seed % 2 === 0);
      let n = 0;
      for (let entry = store.undo.peekUndo(); entry !== null; entry = store.undo.peekUndo(), n++) {
        const changes = entry.changes;
        const plan = inRolledBackTx(store, (tx) => planRestore(restoreHostOf(tx), changes, 'undo'));
        skips += plan.skipped.length;
        deletesKept += plan.skipped.filter((skip) => skip.change.before === undefined).length;
        expectPlanMatches(store, plan, 'undo', `seed ${seed} undo ${n}`);
      }
      n = 0;
      for (let entry = store.undo.peekRedo(); entry !== null; entry = store.undo.peekRedo(), n++) {
        const changes = entry.changes;
        const plan = inRolledBackTx(store, (tx) => planRestore(restoreHostOf(tx), changes, 'redo'));
        expectPlanMatches(store, plan, 'redo', `seed ${seed} redo ${n}`);
      }
    }
    // The foreign writes make the comparison meaningful: some changes are skipped.
    expect(skips).toBeGreaterThan(0);
    // …and a hard delete of a record another writer keyed into is kept (its creation undone without it).
    expect(deletesKept).toBeGreaterThan(0);
  });

  it('applyRestorePlan in a transaction reaches the state undo() reaches (strictPut store)', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { store } = await editedStore(seed, true);
      const entry = store.undo.peekUndo();
      if (entry === null) continue;
      const changes = entry.changes;
      // Forward revert: one new transaction applying the plan.
      const applied = store.transact({ label: 'Revert' }, (tx) =>
        applyRestorePlan(tx, planRestore(restoreHostOf(tx), changes, 'undo')),
      );
      const reverted = rawText(store);
      // Back to before the revert, then the real undo of the same entry.
      store.undo.undo();
      const undone = store.undo.undo();
      expect([`seed ${seed}`, rawText(store)]).toEqual([`seed ${seed}`, reverted]);
      expect([`seed ${seed}: writes`, applied]).toEqual([`seed ${seed}: writes`, undone?.applied]);
    }
  });

  it('plans nothing for an entry whose records all changed since, and reports every skip', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store, 3);
    store.undo.clear();
    const key = scene.keys[0];
    store.transact({ label: 'Nudge' }, (tx) => tx.patch('keys', key, { v: 2 }));
    const before = store.get('keys', key);
    if (before === undefined) throw new Error('no key');
    store.applyChanges([change('keys', key, before as never, { ...before, v: 3 })], {
      origin: 'remote',
      label: 'Remote',
    });
    const entry = store.undo.peekUndo();
    if (entry === null) throw new Error('no entry');
    const plan = inRolledBackTx(store, (tx) => planRestore(restoreHostOf(tx), entry.changes, 'undo'));
    expect(plan.writes).toEqual([]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(['changed-by-other']);
  });

  it('works through the public read API for stores without the restore hook', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store, 5);
    store.undo.clear();
    store.transact({ label: 'Rename' }, (tx) => tx.patch('controls', scene.controls[1], { name: 'Arm' }));
    const entry = store.undo.peekUndo();
    if (entry === null) throw new Error('no entry');
    const exact = inRolledBackTx(store, (tx) => planRestore(restoreHostOf(tx), entry.changes, 'undo'));
    const generic = inRolledBackTx(store, (tx) => {
      const plain: Tx = new Proxy(tx, {
        get: (target, prop) => {
          if (typeof prop === 'symbol') return undefined;
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
      const host: RestoreHost = restoreHostOf(plain);
      return planRestore(host, entry.changes, 'undo');
    });
    expect(generic).toEqual(exact);
  });
});

describe('planSnapshotRestore (MCP-SPEC §4.2)', () => {
  it('round-trips a snapshot byte for byte after random edits, and undoes in one step', async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const store = createMemoryStore();
      const scene = await seedScene(store, seed);
      store.undo.clear();
      const snapshot = store.snapshot();
      const original = serializeSnapshot(snapshot);
      const rng = new Rng(seed * 104_729);
      const steps = 5 + rng.int(25);
      for (let step = 0; step < steps; step++) {
        randomLocalEdit(store, scene, rng, step);
        if (rng.int(3) === 0) foreignEdit(store, scene, rng, step);
        if (rng.int(4) === 0) {
          // Records created since the snapshot: a new curve with keys on another control.
          store.transact({ label: 'New curve' }, (tx) => {
            const curve = {
              ...(tx.getIncludingDeleted('curves', scene.curve) as object),
              id: `${scene.curve}-${step}`,
              control: scene.controls[2],
              deleted: null,
            };
            tx.put('curves', curve as never);
            tx.put('keys', keyAt(scene, curve.id as never, step, rng.next()));
          });
        }
      }
      const edited = docText(store);
      const raw = rawText(store);
      const writes = store.transact({ label: 'Restore' }, (tx) =>
        applyRestorePlan(tx, planSnapshotRestore(restoreHostOf(tx), snapshot)),
      );
      expect([`seed ${seed}`, serializeSnapshot(store.snapshot())]).toEqual([`seed ${seed}`, original]);
      // The restore is one undoable step (none when nothing differed: then the edits cancelled out).
      if (writes > 0) store.undo.undo();
      expect([`seed ${seed}: undo`, docText(store)]).toEqual([`seed ${seed}: undo`, edited]);
      expect([`seed ${seed}: undo (raw)`, writes > 0 ? rawText(store) : raw]).toEqual([
        `seed ${seed}: undo (raw)`,
        raw,
      ]);
    }
  });

  it('plans nothing when the document equals the snapshot', async () => {
    const store = createMemoryStore();
    await seedScene(store, 2);
    const snapshot = store.snapshot();
    const plan = inRolledBackTx(store, (tx) => planSnapshotRestore(restoreHostOf(tx), snapshot));
    expect(plan).toEqual({ writes: [], skipped: [] });
  });

  it('is a MemoryDocumentStore feature reached through the transaction', () => {
    const store = createMemoryStore();
    expect(store).toBeInstanceOf(MemoryDocumentStore);
  });
});
