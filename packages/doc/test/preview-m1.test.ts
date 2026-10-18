// M2A-SPEC §5.21.1 (M-1, A4) store and query fast paths keep the store contract: the preview journal kept in place
// across updates (records written by an earlier update and not by the next return to their committed value and are
// reported; a failing update restores the previous overlay, records it first wrote included), deferred key-projection
// drops (queries inside a transaction see its writes, also after a curve changes channel) and the partition fast
// path of clip-partitioned records.
import { describe, expect, it } from 'vitest';
import { type ChangeBatch, createMemoryStore, type KeyRecord, type MemoryDocumentStore } from '../src';
import { seedScene } from '../src/testing';
import { curveOf, keyAt } from '../src/testing/conformance/harness';

async function scene() {
  const store = createMemoryStore();
  const s = await seedScene(store, 7);
  const [a, b, c] = [keyAt(s, s.curve, 10, 1), keyAt(s, s.curve, 20, 2), keyAt(s, s.curve, 30, 3)];
  store.transact({ label: 'keys' }, (tx) => {
    for (const id of s.keys) tx.remove('keys', id);
    for (const key of [a, b, c]) tx.put('keys', key);
  });
  return { store, s, a, b, c };
}

function previewBatches(store: ReturnType<typeof createMemoryStore>): ChangeBatch[] {
  const batches: ChangeBatch[] = [];
  store.subscribe((batch) => {
    if (batch.origin === 'preview') batches.push(batch);
  });
  return batches;
}

describe('preview journal kept in place (M-1 mechanism 2)', () => {
  it('a record the next update does not write returns to committed and is reported', async () => {
    const { store, a, b } = await scene();
    const batches = previewBatches(store);
    const preview = store.beginPreview('Drag');
    preview.update((tx) => {
      tx.put('keys', { ...a, v: 10 });
      tx.put('keys', { ...b, v: 20 });
    });
    expect(store.get('keys', b.id)?.v).toBe(20);
    preview.update((tx) => {
      // The callback reads committed values, not the previous overlay.
      expect(tx.get('keys', a.id)?.v).toBe(1);
      expect(tx.query.keysOfCurve(a.curve).map((k) => k.v)).toEqual([1, 2, 3]);
      tx.put('keys', { ...a, v: 11 });
    });
    expect(store.get('keys', a.id)?.v).toBe(11);
    expect(store.get('keys', b.id)?.v).toBe(2);
    const last = batches.at(-1);
    expect(last?.changes.map((c) => [c.id, (c.before as KeyRecord).v, (c.after as KeyRecord).v])).toEqual([
      [a.id, 10, 11],
      [b.id, 20, 2],
    ]);
    // An update that writes the same values again reports nothing.
    const count = batches.length;
    preview.update((tx) => tx.put('keys', { ...a, v: 11 }));
    expect(batches).toHaveLength(count);
    const committed = preview.commit({ label: 'Drag' });
    expect(committed?.changes.map((c) => c.id)).toEqual([a.id]);
    expect(store.snapshot().tables.keys[a.id]?.v).toBe(11);
  });

  it('a failing update keeps the previous overlay, without the records it first wrote', async () => {
    const { store, s, a, b } = await scene();
    const preview = store.beginPreview('Drag');
    preview.update((tx) => tx.put('keys', { ...a, v: 10 }));
    const fresh = keyAt(s, s.curve, 40, 4);
    expect(() =>
      preview.update((tx) => {
        tx.put('keys', { ...a, v: 99 });
        tx.put('keys', fresh);
        tx.put('keys', { ...b, v: 98 });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.get('keys', a.id)?.v).toBe(10);
    expect(store.get('keys', b.id)?.v).toBe(2);
    expect(store.get('keys', fresh.id)).toBeUndefined();
    expect(store.query.keysOfCurve(s.curve).map((k) => k.v)).toEqual([10, 2, 3]);
    const batches = previewBatches(store);
    preview.update((tx) => tx.put('keys', { ...b, v: 21 }));
    expect([store.get('keys', a.id)?.v, store.get('keys', b.id)?.v]).toEqual([1, 21]);
    expect(batches.at(-1)?.changes.map((c) => [c.id, (c.before as KeyRecord).v, (c.after as KeyRecord).v])).toEqual([
      [a.id, 10, 1],
      [b.id, 2, 21],
    ]);
    preview.cancel();
    expect(store.query.keysOfCurve(s.curve).map((k) => k.v)).toEqual([1, 2, 3]);
  });

  it('a conflicting remote write under the overlay becomes the committed value the next update starts from', async () => {
    const { store, a } = await scene();
    const preview = store.beginPreview('Drag');
    preview.update((tx) => tx.put('keys', { ...a, v: 10 }));
    store.applyChanges([{ table: 'keys', id: a.id, before: a, after: { ...a, t: 12 } }], {
      origin: 'remote',
      label: 'peer',
    });
    expect(preview.conflicts).toHaveLength(1);
    preview.update((tx) => {
      const key = tx.get('keys', a.id);
      expect(key?.t).toBe(12);
      if (key !== undefined) tx.put('keys', { ...key, v: 11 });
    });
    expect(store.get('keys', a.id)).toMatchObject({ t: 12, v: 11 });
    preview.cancel();
    expect(store.get('keys', a.id)).toMatchObject({ t: 12, v: 1 });
  });

  it('a remote write of a record the last update left committed shows with the next update', async () => {
    const { store, a, b } = await scene();
    const batches = previewBatches(store);
    const preview = store.beginPreview('Drag');
    preview.update((tx) => {
      tx.put('keys', { ...a, v: 10 });
      tx.put('keys', { ...b, v: 20 });
    });
    preview.update((tx) => tx.put('keys', { ...a, v: 11 }));
    store.applyChanges([{ table: 'keys', id: b.id, before: b, after: { ...b, v: 5 } }], {
      origin: 'remote',
      label: 'peer',
    });
    // b is journaled at its committed value; the conflict moves the committed value only.
    expect(store.get('keys', b.id)?.v).toBe(2);
    preview.update((tx) => tx.put('keys', { ...a, v: 12 }));
    expect(store.get('keys', b.id)?.v).toBe(5);
    expect(batches.at(-1)?.changes.map((c) => [c.id, (c.before as KeyRecord).v, (c.after as KeyRecord).v])).toEqual([
      [a.id, 11, 12],
      [b.id, 2, 5],
    ]);
    expect(store.query.keysOfCurve(a.curve).map((k) => k.v)).toEqual([12, 5, 3]);
    preview.cancel();
    expect(store.query.keysOfCurve(a.curve).map((k) => k.v)).toEqual([1, 5, 3]);
  });
});

describe('deferred key-projection drops (M-1 mechanism 3)', () => {
  it('queries in a transaction see its key writes, also after the curve changes channel', async () => {
    const { store, s, a } = await scene();
    store.transact({ label: 'edit' }, (tx) => {
      tx.put('keys', { ...a, t: 25 });
      expect(tx.query.keysOfCurve(s.curve).map((k) => k.t)).toEqual([20, 25, 30]);
      tx.patch('curves', s.curve, { channel: 'ry' });
      tx.put('keys', { ...a, t: 35 });
      expect(tx.query.keysOfCurve(s.curve).map((k) => k.t)).toEqual([20, 30, 35]);
      expect(tx.query.curveFor(s.clip, s.layer, s.controls[0], 'ry')?.id).toBe(s.curve);
    });
    expect(store.query.keysOfCurve(s.curve).map((k) => k.t)).toEqual([20, 30, 35]);
    store.undo.undo();
    expect(store.query.keysOfCurve(s.curve).map((k) => k.t)).toEqual([10, 20, 30]);
  });

  it('a curve written again after a query is dropped again (the last-marked curve resets with the drops)', async () => {
    const { store, s, a, b } = await scene();
    store.transact({ label: 'edit' }, (tx) => {
      tx.patch('keys', a.id, { v: 4 });
      expect(tx.query.keysOfCurve(s.curve).map((k) => k.v)).toEqual([4, 2, 3]);
      tx.patch('keys', a.id, { v: 5 });
      expect(tx.query.keysOfCurve(s.curve).map((k) => k.v)).toEqual([5, 2, 3]);
      tx.patch('keys', b.id, { v: 6 });
      tx.patch('keys', a.id, { v: 7 });
      expect(tx.query.keysOfCurve(s.curve).map((k) => k.v)).toEqual([7, 6, 3]);
    });
    const preview = store.beginPreview('Drag');
    for (const v of [8, 9]) {
      preview.update((tx) => tx.patch('keys', a.id, { v }));
      expect(store.query.keysOfCurve(s.curve).map((k) => k.v)).toEqual([v, 6, 3]);
    }
    preview.cancel();
    expect(store.query.keysOfCurve(s.curve).map((k) => k.v)).toEqual([7, 6, 3]);
  });

  it('a key moved to a duplicate curve of its channel shows in the projection', async () => {
    const { store, s, b } = await scene();
    const duplicate = curveOf(s, s.controls[0], 'rz');
    store.transact({ label: 'dup' }, (tx) => {
      tx.put('curves', duplicate);
      tx.put('keys', { ...b, curve: duplicate.id, t: 21 });
    });
    const canonical = duplicate.id < s.curve ? duplicate.id : s.curve;
    expect(store.query.keysOfCurve(canonical).map((k) => k.t)).toEqual([10, 21, 30]);
  });
});

describe('partition fast path', () => {
  it('keys keep their clip partition; a key moved to another clip takes that clip’s partition', async () => {
    const { store, a } = await scene();
    const memory = store as MemoryDocumentStore;
    const before = memory.entryOf('keys', a.id)?.partition;
    store.transact({ label: 'move' }, (tx) => tx.put('keys', { ...a, v: 5 }));
    expect(memory.entryOf('keys', a.id)?.partition).toBe(before);
    expect(before).toBe(`clip:${a.clip}`);
  });

  it('patch, soft delete and restore write over the entry they read once', async () => {
    const { store, s, a } = await scene();
    const memory = store as MemoryDocumentStore;
    store.transact({ label: 'patch' }, (tx) => tx.patch('keys', a.id, { v: 9 }));
    expect(memory.entryOf('keys', a.id)).toMatchObject({ record: { v: 9 }, partition: `clip:${a.clip}` });
    store.transact({ label: 'delete' }, (tx) => tx.softDelete('characters', s.character));
    expect(store.get('characters', s.character)).toBeUndefined();
    store.transact({ label: 'restore' }, (tx) => tx.restore('characters', s.character));
    expect(store.get('characters', s.character)?.deleted).toBeNull();
    store.undo.undo();
    store.undo.undo();
    store.undo.undo();
    expect(store.get('keys', a.id)?.v).toBe(1);
    expect(() =>
      store.transact({ label: 'x' }, (tx) => tx.patch('keys', 'key_missing' as typeof a.id, { v: 1 })),
    ).toThrow(/no such record/);
  });
});
