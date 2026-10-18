import { EkzaError } from '@ekza-animator/anim-core';
import {
  type ChangeBatch,
  type ClipRecord,
  type DocSnapshot,
  type DocumentStore,
  type KeyId,
  type KeyRecord,
  SCHEMA_VERSION,
  solverId,
} from '@ekza-animator/doc';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNaiveStore } from '../../src/testing';
import { WAVE, waveDoc } from './fixtures';

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof EkzaError ? error.code : 'not-an-EkzaError';
  }
}

function newKey(id: string, t: number, v: number): KeyRecord {
  return {
    id: id as KeyId,
    clip: WAVE.clip,
    curve: WAVE.curve,
    t,
    v,
    inType: 'auto',
    outType: 'auto',
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
  };
}

const keyTimes = (store: DocumentStore): number[] => store.query.keysOfCurve(WAVE.curve).map((key) => key.t);

describe('naive DocumentStore (test kit)', () => {
  let store: DocumentStore;
  let batches: ChangeBatch[];
  let original: DocSnapshot;

  beforeEach(() => {
    store = createNaiveStore();
    store.load(waveDoc());
    original = store.snapshot();
    batches = [];
    store.subscribe((batch) => batches.push(batch));
  });

  it('loads the wave document and answers queries', () => {
    expect(store.list('characters').map((c) => c.name)).toEqual(['Synthetic Humanoid']);
    expect(keyTimes(store)).toEqual([0, 15, 30]);
    expect(store.query.clipsOfCharacter(WAVE.character).map((c) => c.name)).toEqual(['wave']);
    expect(store.query.baseLayer(WAVE.clip)?.name).toBe('Base');
    const controls = store.query.controlsOfRig(WAVE.rig);
    expect(controls[0]?.key).toBe('root');
    // Parents come before children.
    const position = new Map(controls.map((control, i) => [control.id, i]));
    const misordered = controls.filter((c, i) => c.parent !== null && (position.get(c.parent) ?? Infinity) >= i);
    expect(misordered).toEqual([]);
    expect(store.query.controlByKey(WAVE.rig, 'fk.lowerArm.L')?.id).toBe(WAVE.lowerArmL);
    expect(store.undo.canUndo()).toBe(false);
  });

  it('commits a transaction as one batch and one undo entry, with read-your-writes', () => {
    const version = store.version;
    store.transact({ label: 'Edit' }, (tx) => {
      tx.patch('keys', WAVE.keys[1], { v: 0.25 });
      expect(tx.get('keys', WAVE.keys[1])?.v).toBe(0.25);
      expect(store.get('keys', WAVE.keys[1])?.v).not.toBe(0.25); // not committed yet
      tx.put('keys', newKey('k_SynthWave004', 20, 0.1));
      expect(tx.query.keysOfCurve(WAVE.curve).map((k) => k.t)).toEqual([0, 15, 20, 30]);
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.origin).toBe('local');
    expect(batches[0]?.changes.map((c) => [c.table, c.id])).toEqual([
      ['keys', WAVE.keys[1]],
      ['keys', 'k_SynthWave004'],
    ]);
    expect(store.version).toBe(version + 1);
    expect(store.undo.peekUndo()?.label).toBe('Edit');
    expect(keyTimes(store)).toEqual([0, 15, 20, 30]);
  });

  it('rolls a transaction back completely when fn throws', () => {
    const version = store.version;
    expect(() =>
      store.transact({ label: 'Broken' }, (tx) => {
        tx.patch('clips', WAVE.clip, { name: 'renamed' });
        tx.remove('keys', WAVE.keys[0]);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(batches).toEqual([]);
    expect(store.version).toBe(version);
    expect(store.undo.canUndo()).toBe(false);
    expect(store.snapshot()).toEqual(original);
  });

  it('joins a nested transact into the outer one (outer meta wins, annotate adjusts it)', () => {
    store.transact({ label: 'Outer' }, (tx) => {
      tx.patch('clips', WAVE.clip, { name: 'one' });
      store.transact({ label: 'Inner' }, (inner) => {
        expect(inner.get('clips', WAVE.clip)?.name).toBe('one');
        inner.patch('clips', WAVE.clip, { loop: false });
        inner.annotate({ label: 'Annotated', selectionAfter: { picked: 1 } });
      });
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.label).toBe('Annotated');
    expect(batches[0]?.changes[0]?.fields).toEqual(['loop', 'name']);
    expect(store.undo.peekUndo()).toMatchObject({ label: 'Annotated', selectionAfter: { picked: 1 } });
    expect(store.undo.undo()?.applied).toBe(1);
    expect(store.snapshot()).toEqual(original);
  });

  it('refuses put over an existing field-merge record (strictPut) but replaces whole keys', () => {
    const clip = store.get('clips', WAVE.clip) as ClipRecord;
    expect(codeOf(() => store.transact({ label: 'Put' }, (tx) => tx.put('clips', { ...clip, name: 'x' })))).toBe(
      'use-patch',
    );
    store.transact({ label: 'Key' }, (tx) => tx.put('keys', { ...newKey(WAVE.keys[0], 0, 1) }));
    expect(store.get('keys', WAVE.keys[0])?.v).toBe(1);
    const lax = createNaiveStore({ strictPut: false });
    lax.load(waveDoc());
    lax.transact({ label: 'Put' }, (tx) => tx.put('clips', { ...clip, name: 'x' }));
    expect(lax.get('clips', WAVE.clip)?.name).toBe('x');
  });

  it('refuses hard deletes of records that still have dependants', () => {
    expect(codeOf(() => store.transact({ label: 'Rm' }, (tx) => tx.remove('curves', WAVE.curve)))).toBe(
      'invalid-record',
    );
    store.transact({ label: 'Rm keys' }, (tx) => {
      for (const key of WAVE.keys) tx.remove('keys', key);
      tx.remove('curves', WAVE.curve);
    });
    expect(store.get('curves', WAVE.curve)).toBeUndefined();
  });

  it('hides soft-deleted records from reads and snapshots, and restores them', () => {
    store.transact({ label: 'Delete clip' }, (tx) => tx.softDelete('clips', WAVE.clip));
    expect(store.get('clips', WAVE.clip)).toBeUndefined();
    expect(store.getIncludingDeleted('clips', WAVE.clip)?.deleted).toMatchObject({ by: 'local' });
    expect(Object.keys(store.snapshot().tables.clips)).toEqual([]);
    store.transact({ label: 'Restore clip' }, (tx) => tx.restore('clips', WAVE.clip));
    expect(store.snapshot()).toEqual(original);
  });

  describe('preview sessions', () => {
    it('overlay updates emit preview batches; commit is exactly one undo step', () => {
      const preview = store.beginPreview('Drag');
      expect(store.preview).toBe(preview);
      preview.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.1 }));
      preview.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.2, t: 16 }));
      expect(store.get('keys', WAVE.keys[1])).toMatchObject({ v: 0.2, t: 16 });
      expect(batches.map((b) => b.origin)).toEqual(['preview', 'preview']);
      expect(store.undo.canUndo()).toBe(false);
      expect(codeOf(() => store.transact({ label: 'x' }, () => undefined))).toBe('preview-active');
      expect(codeOf(() => store.beginPreview('again'))).toBe('preview-active');

      const batch = preview.commit({ label: 'Move Key' });
      expect(batch?.origin).toBe('local');
      expect(store.preview).toBeNull();
      expect(preview.active).toBe(false);
      expect(store.undo.peekUndo()?.label).toBe('Move Key');
      expect(store.undo.peekUndo()?.changes).toHaveLength(1);

      const result = store.undo.undo();
      expect(result).toMatchObject({ label: 'Move Key', applied: 1, skipped: [] });
      expect(store.undo.canUndo()).toBe(false);
      expect(store.snapshot()).toEqual(original);
      store.undo.redo();
      expect(store.get('keys', WAVE.keys[1])).toMatchObject({ v: 0.2, t: 16 });
    });

    it('a transaction inside preview.update throws preview-active instead of joining the overlay', () => {
      const preview = store.beginPreview('Drag');
      preview.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.1 }));
      const inner = (): void =>
        preview.update(() =>
          store.transact({ label: 'inner' }, (tx) => tx.patch('clips', WAVE.clip, { name: 'smuggled' })),
        );
      expect(codeOf(inner)).toBe('preview-active');
      expect(codeOf(() => preview.update(() => store.beginPreview('nested')))).toBe('preview-active');
      // The failed updates left the previous overlay in place.
      expect(store.get('clips', WAVE.clip)?.name).toBe('wave');
      expect(store.get('keys', WAVE.keys[1])?.v).toBe(0.1);
      preview.commit();
      expect(store.get('clips', WAVE.clip)?.name).toBe('wave');
      expect(store.undo.peekUndo()?.changes.map((change) => change.table)).toEqual(['keys']);
      // The store is usable again once the preview has ended.
      store.transact({ label: 'after' }, (tx) => tx.patch('clips', WAVE.clip, { name: 'after' }));
      expect(store.get('clips', WAVE.clip)?.name).toBe('after');
    });

    it('a second update discards the previous overlay', () => {
      const preview = store.beginPreview('Drag');
      preview.update((tx) => tx.patch('clips', WAVE.clip, { name: 'first' }));
      preview.update((tx) => tx.patch('keys', WAVE.keys[0], { v: 0 }));
      expect(store.get('clips', WAVE.clip)?.name).toBe('wave');
      expect(
        batches
          .at(-1)
          ?.changes.map((c) => c.table)
          .sort(),
      ).toEqual(['clips', 'keys']);
      preview.commit();
      expect(store.get('clips', WAVE.clip)?.name).toBe('wave');
      expect(store.get('keys', WAVE.keys[0])?.v).toBe(0);
    });

    it('cancel restores committed values and records nothing', () => {
      const preview = store.beginPreview('Drag');
      preview.update((tx) => tx.patch('keys', WAVE.keys[1], { v: 0.1 }));
      preview.cancel();
      expect(batches.map((b) => b.origin)).toEqual(['preview', 'preview']);
      expect(batches[1]?.changes[0]?.after).toMatchObject({ v: -Math.PI / 6 });
      expect(store.undo.canUndo()).toBe(false);
      expect(store.snapshot()).toEqual(original);
      store.transact({ label: 'after' }, (tx) => tx.patch('clips', WAVE.clip, { loop: false }));
    });

    it('commit with undoable: false writes without an undo entry; an empty overlay commits nothing', () => {
      const camera = store.beginPreview('Navigate');
      camera.update((tx) => tx.patch('project', 'project', { name: 'moved' }));
      expect(camera.commit({ undoable: false })?.origin).toBe('local');
      expect(store.get('project', 'project')?.name).toBe('moved');
      expect(store.undo.canUndo()).toBe(false);
      expect(store.beginPreview('Nothing').commit()).toBeNull();
    });
  });

  describe('undo', () => {
    it('undo/redo is exact over a sequence of edits on the wave document', () => {
      const states: DocSnapshot[] = [original];
      const edits: ((store: DocumentStore) => void)[] = [
        (s) => s.transact({ label: 'Retime' }, (tx) => tx.patch('keys', WAVE.keys[1], { t: 12, v: -0.4 })),
        (s) => s.transact({ label: 'Insert' }, (tx) => tx.put('keys', newKey('k_SynthWave004', 24, 0.3))),
        (s) => s.transact({ label: 'Delete' }, (tx) => tx.remove('keys', WAVE.keys[0])),
        (s) =>
          s.transact({ label: 'Clip settings' }, (tx) =>
            tx.patch('clips', WAVE.clip, { name: 'wave2', range: { start: 0, end: 24 } }),
          ),
        (s) => s.transact({ label: 'Hide control' }, (tx) => tx.softDelete('controls', WAVE.handL)),
      ];
      for (const edit of edits) {
        edit(store);
        states.push(store.snapshot());
      }
      for (let i = edits.length; i > 0; i--) {
        expect(store.undo.undo()?.skipped).toEqual([]);
        expect(store.snapshot()).toEqual(states[i - 1]);
      }
      expect(store.undo.canUndo()).toBe(false);
      for (let i = 1; i <= edits.length; i++) {
        expect(store.undo.redo()?.skipped).toEqual([]);
        expect(store.snapshot()).toEqual(states[i]);
      }
      expect(batches.slice(-edits.length).every((b) => b.origin === 'redo')).toBe(true);
    });

    it('restores selection snapshots and clears redo on a new edit', () => {
      store.transact({ label: 'A', selectionBefore: 'before-A', selectionAfter: 'after-A' }, (tx) =>
        tx.patch('clips', WAVE.clip, { loop: false }),
      );
      expect(store.undo.undo()?.selection).toBe('before-A');
      expect(store.undo.redo()?.selection).toBe('after-A');
      store.undo.undo();
      store.transact({ label: 'B' }, (tx) => tx.patch('clips', WAVE.clip, { name: 'b' }));
      expect(store.undo.canRedo()).toBe(false);
    });

    it('compares before restoring: a field changed by someone else is skipped, the rest is reverted', () => {
      store.transact({ label: 'Settings' }, (tx) => tx.patch('clips', WAVE.clip, { name: 'mine', loop: false }));
      const clip = store.get('clips', WAVE.clip) as ClipRecord;
      store.applyChanges(
        [{ table: 'clips', id: WAVE.clip, before: clip, after: { ...clip, name: 'theirs' }, fields: ['name'] }],
        { origin: 'remote', label: 'Remote rename' },
      );
      const result = store.undo.undo();
      expect(result?.applied).toBe(1);
      expect(result?.skipped).toEqual([expect.objectContaining({ fields: ['name'], reason: 'changed-by-other' })]);
      expect(store.get('clips', WAVE.clip)).toMatchObject({ name: 'theirs', loop: true });
      // The undo batch names only the field it reverted.
      expect(batches.at(-1)).toMatchObject({ origin: 'undo', changes: [{ table: 'clips', fields: ['loop'] }] });
    });

    it('undo and redo batches carry `fields` for field-merge updates and none for whole-record tables', () => {
      store.transact({ label: 'Settings' }, (tx) => {
        tx.patch('clips', WAVE.clip, { name: 'mine', loop: false });
        tx.patch('keys', WAVE.keys[0], { v: 1 });
      });
      const fieldsOf = (batch: ChangeBatch | undefined): Record<string, readonly string[] | null> =>
        Object.fromEntries((batch?.changes ?? []).map((change) => [change.table, change.fields ?? null]));
      const expected = { clips: ['loop', 'name'], keys: null };
      expect(fieldsOf(batches.at(-1))).toEqual(expected);
      store.undo.undo();
      expect(batches.at(-1)?.origin).toBe('undo');
      expect(fieldsOf(batches.at(-1))).toEqual(expected);
      store.undo.redo();
      expect(batches.at(-1)?.origin).toBe('redo');
      expect(fieldsOf(batches.at(-1))).toEqual(expected);
      // Undoing an insert is a whole-record delete.
      store.transact({ label: 'Insert clip' }, (tx) =>
        tx.put('clips', {
          ...(store.get('clips', WAVE.clip) as ClipRecord),
          id: 'clp_SyntheticCopy001' as ClipRecord['id'],
        }),
      );
      store.undo.undo();
      expect(batches.at(-1)?.changes.map((change) => 'fields' in change)).toEqual([false]);
    });

    it('skips a whole key change when the key no longer matches', () => {
      store.transact({ label: 'Edit key' }, (tx) => tx.patch('keys', WAVE.keys[0], { v: 1 }));
      const key = store.get('keys', WAVE.keys[0]) as KeyRecord;
      store.applyChanges([{ table: 'keys', id: key.id, before: key, after: { ...key, v: 2 } }], {
        origin: 'remote',
        label: 'Remote',
      });
      expect(store.undo.undo()).toMatchObject({ applied: 0, skipped: [{ fields: null, reason: 'changed-by-other' }] });
      expect(store.get('keys', WAVE.keys[0])?.v).toBe(2);
    });

    it('coalesces transactions with the same key inside the window; stopCapturing splits', () => {
      let now = 1_000;
      const clocked = createNaiveStore({ now: () => now });
      clocked.load(waveDoc());
      const nudge = (v: number): void =>
        clocked.transact({ label: 'Nudge', coalesceKey: 'nudge', coalesceMs: 500 }, (tx) =>
          tx.patch('keys', WAVE.keys[0], { v }),
        );
      nudge(1);
      now += 100;
      nudge(2);
      now += 100;
      nudge(3);
      expect(clocked.undo.peekUndo()?.changes).toHaveLength(1);
      clocked.undo.stopCapturing();
      nudge(4);
      now += 1_000;
      nudge(5);
      clocked.undo.undo();
      expect(clocked.get('keys', WAVE.keys[0])?.v).toBe(4);
      clocked.undo.undo();
      expect(clocked.get('keys', WAVE.keys[0])?.v).toBe(3);
      clocked.undo.undo();
      expect(clocked.get('keys', WAVE.keys[0])?.v).toBeCloseTo(Math.PI / 6, 15);
      expect(clocked.undo.canUndo()).toBe(false);
    });

    it('does not coalesce without a window, and drops an entry whose edits cancel out', () => {
      let now = 0;
      const clocked = createNaiveStore({ now: () => now });
      clocked.load(waveDoc());
      const original = clocked.get('keys', WAVE.keys[0])?.v as number;
      const set = (v: number, coalesceMs?: number): void =>
        clocked.transact(
          { label: 'Set', coalesceKey: 'k', ...(coalesceMs === undefined ? {} : { coalesceMs }) },
          (tx) => tx.patch('keys', WAVE.keys[0], { v }),
        );
      set(1);
      set(2);
      clocked.undo.undo();
      expect(clocked.get('keys', WAVE.keys[0])?.v).toBe(1);
      clocked.undo.undo();
      expect(clocked.undo.canUndo()).toBe(false);
      set(5, 500);
      now += 10;
      set(original, 500);
      expect(clocked.undo.canUndo()).toBe(false);
    });

    it('never records remote, import or undoable: false writes', () => {
      store.transact({ label: 'Hidden', undoable: false }, (tx) => tx.patch('clips', WAVE.clip, { loop: false }));
      const clip = store.get('clips', WAVE.clip) as ClipRecord;
      store.applyChanges(
        [{ table: 'clips', id: clip.id, before: clip, after: { ...clip, tags: [] }, fields: ['tags'] }],
        {
          origin: 'import',
          label: 'Import',
        },
      );
      expect(store.undo.canUndo()).toBe(false);
      expect(batches.map((b) => b.origin)).toEqual(['local', 'import']);
    });
  });

  it('updates the undo stacks before listeners see the batch', () => {
    const seen: (string | null)[] = [];
    store.subscribe(() => seen.push(store.undo.peekUndo()?.label ?? null));
    store.transact({ label: 'First' }, (tx) => tx.patch('clips', WAVE.clip, { loop: false }));
    const preview = store.beginPreview('Drag');
    preview.update((tx) => tx.patch('clips', WAVE.clip, { name: 'dragged' }));
    preview.commit();
    store.undo.undo();
    expect(seen).toEqual(['First', 'First', 'Drag', 'First']);
  });

  it('projects duplicate key times: the greatest KeyId wins, the others are hidden', () => {
    store.transact({ label: 'Dup' }, (tx) => tx.put('keys', newKey('k_SynthWave999', 15, 9)));
    expect(store.query.keysOfCurve(WAVE.curve).map((k) => k.id)).toEqual([
      WAVE.keys[0],
      'k_SynthWave999',
      WAVE.keys[2],
    ]);
    expect(store.query.hiddenKeys(WAVE.curve).map((k) => k.id)).toEqual([WAVE.keys[1]]);
  });

  it('reads records of a closed partition as absent until it is opened again', async () => {
    const partition = `clip:${WAVE.clip}` as const;
    expect(store.isOpen(partition)).toBe(true);
    store.close(partition);
    expect(store.get('keys', WAVE.keys[0])).toBeUndefined();
    expect(store.snapshot().tables.keys).toEqual({});
    await store.open(partition);
    expect(store.get('keys', WAVE.keys[0])).toBeDefined();
  });

  it('read-only stores refuse writes', () => {
    const readOnly = createNaiveStore();
    readOnly.load(waveDoc(), { readOnly: true });
    expect(readOnly.readOnly).toBe(true);
    expect(codeOf(() => readOnly.transact({ label: 'x' }, () => undefined))).toBe('read-only');
  });

  it('writes minWriterVersion by the M2A-SPEC §4.2 snapshot rule', () => {
    expect(createNaiveStore().snapshot().minWriterVersion).toBe(1);
    expect(store.snapshot().minWriterVersion).toBe(1);
    const solver = {
      id: solverId(WAVE.rig, 'ik2.leg.L'),
      rig: WAVE.rig,
      type: 'ik2' as const,
      params: { v: 1 },
      enabled: true,
      deleted: null,
    };
    store.transact({ label: 'Add Limb IK' }, (tx) => tx.put('solvers', solver));
    expect(store.snapshot().minWriterVersion).toBe(2);
    store.transact({ label: 'Disable' }, (tx) => tx.patch('solvers', solver.id, { enabled: false }));
    expect(store.snapshot().minWriterVersion).toBe(1);
    const future = createNaiveStore();
    future.load({ ...waveDoc(), minWriterVersion: SCHEMA_VERSION + 1 });
    expect(future.snapshot().minWriterVersion).toBe(SCHEMA_VERSION + 1);
    const current = createNaiveStore();
    current.load({ ...waveDoc(), minWriterVersion: 2 });
    expect(current.snapshot().minWriterVersion).toBe(1);
    expect(current.snapshot().schemaVersion).toBe(SCHEMA_VERSION);
  });
});
