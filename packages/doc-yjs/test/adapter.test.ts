// Adapter-level tests of the Yjs store: the CRDT encoding (research 06 R2/R3), the outgoing/receive mechanics and
// the rules the conformance suite cannot reach from the public API.
import {
  type AnyChange,
  type ChangeBatch,
  type DocSnapshot,
  type KeyRecord,
  makeKey,
  type Partition,
  type ReplicatingStore,
  serializeSnapshot,
  type UserId,
} from '@ekza-animator/doc';
import { makeTestDocument, newScene, seedScene, writeScene } from '@ekza-animator/doc/testing';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsStore, isYjsStore, YjsDocumentStore, yjsHarness } from '../src';

function yjs(store: ReplicatingStore): YjsDocumentStore {
  if (!isYjsStore(store)) throw new Error('not a Yjs store');
  return store;
}

function sync(from: ReplicatingStore, to: ReplicatingStore): number {
  const updates = from.drainOutgoing();
  for (const { partition, update } of updates) to.receive(partition, update);
  return updates.length;
}

describe('encoding', () => {
  it('field-merge records are nested Y.Maps of fields; keys are plain values', async () => {
    const store = yjs(createYjsStore({ replicaId: 'enc' }));
    const scene = await seedScene(store);
    const charDoc = store.documentOf(`char:${scene.character}`);
    const control = charDoc?.getMap('controls').get(scene.controls[0]);
    expect(control).toBeInstanceOf(Y.Map);
    expect((control as Y.Map<unknown>).get('name')).toBe('root');
    const clipDoc = store.documentOf(`clip:${scene.clip}`);
    const key: unknown = clipDoc?.getMap('keys').get(scene.keys[0]);
    expect(key).not.toBeInstanceOf(Y.Map);
    expect(key).toEqual(store.get('keys', scene.keys[0]));
    expect(store.documentOf('scene')?.getMap('characters').get(scene.character)).toBeInstanceOf(Y.Map);
  });

  it('a patch sets only the changed fields (concurrent edits of other fields survive)', async () => {
    const store = yjs(createYjsStore({ replicaId: 'patch' }));
    const scene = await seedScene(store);
    store.drainOutgoing();
    const nested = store
      .documentOf(`char:${scene.character}`)
      ?.getMap('controls')
      .get(scene.controls[1]) as Y.Map<unknown>;
    const writes: string[] = [];
    nested.observe((event) => writes.push(...event.keysChanged));
    store.transact({ label: 'Rename' }, (tx) => tx.patch('controls', scene.controls[1], { name: 'Left' }));
    expect(writes).toEqual(['name']);
    expect(store.drainOutgoing().map((u) => u.partition)).toEqual([`char:${scene.character}`]);
  });

  it('records moving partitions leave their old document', async () => {
    const store = yjs(createYjsStore({ replicaId: 'move' }));
    const scene = await seedScene(store);
    const other = newScene(2);
    for (const partition of other.partitions) await store.open(partition);
    store.transact({ label: 'Other' }, (tx) => writeScene(tx, other, { withProject: false }));
    store.transact({ label: 'Move key' }, (tx) =>
      tx.patch('keys', scene.keys[0], { clip: other.clip, curve: other.curve }),
    );
    expect(store.documentOf(`clip:${scene.clip}`)?.getMap('keys').has(scene.keys[0])).toBe(false);
    expect(store.documentOf(`clip:${other.clip}`)?.getMap('keys').has(scene.keys[0])).toBe(true);
  });
});

describe('outgoing and receive', () => {
  it('drains one merged update per partition, nothing for previews, nothing twice', async () => {
    const store = createYjsStore({ replicaId: 'out' });
    const scene = await seedScene(store);
    expect(store.drainOutgoing().map((u) => u.partition)).toEqual([
      `char:${scene.character}`,
      `clip:${scene.clip}`,
      'scene',
    ]);
    expect(store.drainOutgoing()).toEqual([]);
    store.transact({ label: 'One' }, (tx) => tx.patch('keys', scene.keys[0], { v: 1 }));
    store.transact({ label: 'Two' }, (tx) => tx.patch('keys', scene.keys[1], { v: 2 }));
    const drained = store.drainOutgoing();
    expect(drained).toHaveLength(1);
    const preview = store.beginPreview('Drag');
    preview.update((tx) => tx.patch('keys', scene.keys[0], { v: 3 }));
    expect(store.drainOutgoing()).toEqual([]);
    preview.cancel();
    expect(store.drainOutgoing()).toEqual([]);
  });

  it('receive is idempotent and never echoes', async () => {
    const a = createYjsStore({ replicaId: 'a', user: 'alice' as UserId });
    const b = createYjsStore({ replicaId: 'b', user: 'bob' as UserId });
    const scene = await seedScene(a);
    for (const partition of scene.partitions) await b.open(partition);
    const updates = a.drainOutgoing();
    const batches: ChangeBatch[] = [];
    b.subscribe((batch) => batches.push(batch));
    for (const { partition, update } of updates) b.receive(partition, update);
    const count = batches.length;
    expect(batches.every((batch) => batch.origin === 'remote' && batch.user === 'remote')).toBe(true);
    for (const { partition, update } of updates) b.receive(partition, update);
    expect(batches).toHaveLength(count);
    expect(b.drainOutgoing()).toEqual([]);
    expect(serializeSnapshot(b.snapshot())).toBe(serializeSnapshot(a.snapshot()));
  });

  it('derives the Yjs client id from the replica id', () => {
    const first = yjs(createYjsStore({ replicaId: 'r0' }));
    expect(yjs(createYjsStore({ replicaId: 'r0' })).yjsClientId).toBe(first.yjsClientId);
    expect(yjs(createYjsStore({ replicaId: 'r1' })).yjsClientId).not.toBe(first.yjsClientId);
    expect(() => createYjsStore({ replicaId: '' })).toThrow();
  });

  it('a record present in two partition documents resolves to the smallest partition name', async () => {
    const store = yjs(createYjsStore({ replicaId: 'dup' }));
    const scene = await seedScene(store);
    const key = store.get('keys', scene.keys[0]) as KeyRecord;
    const stale = (partition: Partition, v: number): Uint8Array => {
      const doc = new Y.Doc();
      doc.clientID = 4242 + v;
      doc.getMap('keys').set(key.id, { ...key, v });
      return Y.encodeStateAsUpdateV2(doc);
    };
    store.receive('clip:zzz' as Partition, stale('clip:zzz' as Partition, 7));
    expect(store.get('keys', key.id)?.v).toBe(key.v); // `clip:<scene clip>` sorts before `clip:zzz`
    await store.open('clip:000' as Partition);
    store.receive('clip:000' as Partition, stale('clip:000' as Partition, 9));
    expect(store.get('keys', key.id)?.v).toBe(9); // clip:000 sorts first: its copy wins on every replica
    store.close('clip:000' as Partition);
    expect(store.get('keys', key.id)).toBeUndefined(); // the record now lives in clip:000
  });

  it('load replicates, unknown tables included', async () => {
    const net = yjsHarness().create(2, { seed: 3 });
    const [a, b] = net.peers as [ReplicatingStore, ReplicatingStore];
    const doc = makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 2 });
    const snapshot = {
      ...doc,
      tableVersions: { ...doc.tableVersions, 'acme.notes': 2 },
      tables: { ...doc.tables, 'acme.notes': { n1: { id: 'n1', text: 'hi' } } },
    } as unknown as DocSnapshot;
    a.load(snapshot);
    for (const partition of a.openPartitions()) await b.open(partition);
    net.settle();
    const notes = (b.snapshot().tables as unknown as Record<string, unknown>)['acme.notes'];
    expect(notes).toEqual({ n1: { id: 'n1', text: 'hi' } });
    expect(serializeSnapshot({ ...b.snapshot(), tableVersions: a.snapshot().tableVersions })).toBe(
      serializeSnapshot(a.snapshot()),
    );
  });

  it('caller-supplied applyChanges writes replicate', async () => {
    const net = yjsHarness().create(2, { seed: 4 });
    const [a, b] = net.peers as [ReplicatingStore, ReplicatingStore];
    const scene = await seedScene(a);
    for (const partition of scene.partitions) await b.open(partition);
    net.settle();
    const key = makeKey({ id: 'k_importedKey1' as never, clip: scene.clip, curve: scene.curve, t: 40, v: 1 });
    a.applyChanges([{ table: 'keys', id: key.id, before: undefined, after: key } as AnyChange], {
      origin: 'import',
      label: 'Import',
    });
    net.settle();
    expect(b.get('keys', key.id)).toEqual(key);
    expect(sync(a, b)).toBe(0);
  });
});
