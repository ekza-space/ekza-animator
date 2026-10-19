// Mesh-ref conformance cases (M6A-SPEC §9 B7, §4.2 `MeshRef`, ADR 0015): `meshes.data` is one opaque merge unit for
// every DocumentStore — unknown fields inside it and on the record survive writes, undo/redo, snapshot/load and
// remote batches; undo compares before restoring (a ref another user changed is skipped); and two peers that commit
// offline on the same revision produce refs with the same `base`, which `meshRefForks` reports (M3 fork detection;
// M6a writes `base` correctly on every commit and only detects).
import type { MeshId, UserId } from '../ids';
import type { MeshRecord, MeshRef } from '../records';
import type { ChangeBatch, ConformanceCaps, DocumentStore } from '../store';
import { check, equal, read, readRaw, type SuiteRunner } from './conformance/harness';
import { makeTestMesh, testHash } from './records-v3';

/** One observed write of a mesh's `data` ref. */
export interface ObservedRef {
  readonly mesh: string;
  readonly ref: MeshRef;
}

/** A fork: refs of one mesh that were committed on the same base revision (concurrent commits). */
export interface MeshRefFork {
  readonly mesh: string;
  readonly base: string;
  /** The distinct manifests committed on `base`, sorted. */
  readonly manifests: readonly string[];
}

/** Groups observed refs by mesh and `base`; every base with two or more distinct manifests is a fork. */
export function meshRefForks(observed: Iterable<ObservedRef>): readonly MeshRefFork[] {
  const byBase = new Map<string, { mesh: string; base: string; manifests: Set<string> }>();
  for (const { mesh, ref } of observed) {
    if (ref.base === null) continue;
    const key = `${mesh}\u0000${ref.base}`;
    let entry = byBase.get(key);
    if (entry === undefined) {
      entry = { mesh, base: ref.base, manifests: new Set() };
      byBase.set(key, entry);
    }
    entry.manifests.add(ref.manifest);
  }
  const out: MeshRefFork[] = [];
  for (const { mesh, base, manifests } of byBase.values()) {
    if (manifests.size < 2) continue;
    out.push({ mesh, base, manifests: [...manifests].sort() });
  }
  return out.sort((a, b) => (a.mesh < b.mesh ? -1 : a.mesh > b.mesh ? 1 : a.base < b.base ? -1 : 1));
}

/** Every `meshes.data` value a batch writes (inserts and updates of the field). */
export function refsOfBatch(batch: ChangeBatch): readonly ObservedRef[] {
  const out: ObservedRef[] = [];
  for (const change of batch.changes) {
    if (change.table !== 'meshes') continue;
    const after = change.after?.data;
    if (after === null || after === undefined) continue;
    if (change.before?.data?.manifest === after.manifest) continue;
    out.push({ mesh: change.id, ref: after });
  }
  return out;
}

const MESH = 'msh_meshrefs000001' as MeshId;
const REMOTE = { origin: 'remote', label: 'Remote edit', user: 'someone-else' as UserId } as const;

function ref(label: string, rev: number, base: string | null): MeshRef {
  return { manifest: testHash(label), rev, base, joints: [] };
}

export function registerMeshRefCases(r: SuiteRunner, factory: () => DocumentStore): void {
  r.describe('mesh refs (meshes.data opaque)', () => {
    r.it(
      'keeps unknown fields of the ref and of the record through writes, undo/redo, snapshot/load and remote',
      () => {
        const store = factory();
        const future = {
          ...ref('rev-1', 1, null),
          lod: { levels: [1, 2] },
          codec: 'ekza-mesh-2',
        } as unknown as MeshRef;
        const record = {
          ...makeTestMesh(MESH, { name: 'Crate', data: future }),
          vendorField: { keep: true },
        } as MeshRecord;
        store.transact({ label: 'Create' }, (tx) => tx.put('meshes', record));
        equal(read(store, 'meshes', MESH)?.data, future, 'unknown ref fields written');
        equal(
          (read(store, 'meshes', MESH) as unknown as Record<string, unknown>)['vendorField'],
          { keep: true },
          'record field',
        );
        const next = { ...future, manifest: testHash('rev-2'), rev: 2, base: testHash('rev-1') } as MeshRef;
        store.transact({ label: 'Commit' }, (tx) => tx.patch('meshes', MESH, { data: next }));
        store.undo.undo();
        equal(read(store, 'meshes', MESH)?.data, future, 'undo restores the whole ref');
        store.undo.redo();
        equal(read(store, 'meshes', MESH)?.data, next, 'redo re-applies the whole ref');
        const copy = factory();
        copy.load(store.snapshot());
        equal(read(copy, 'meshes', MESH)?.data, next, 'snapshot/load keeps the ref');
        equal(
          (read(copy, 'meshes', MESH) as unknown as Record<string, unknown>)['vendorField'],
          { keep: true },
          'and the record field',
        );
        const remote = { ...next, manifest: testHash('rev-3'), rev: 3, base: next.manifest, extra: [1] } as MeshRef;
        const before = readRaw(store, 'meshes', MESH);
        check(before !== undefined, 'mesh present');
        store.applyChanges(
          [{ table: 'meshes', id: MESH, before, after: { ...before, data: remote }, fields: ['data'] }] as never,
          REMOTE,
        );
        equal(read(store, 'meshes', MESH)?.data, remote, 'a remote ref arrives whole');
      },
    );

    r.it('undo compares before restoring: a ref another user changed meanwhile is skipped', () => {
      const store = factory();
      const r1 = ref('rev-1', 1, null);
      store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh(MESH, { data: r1 })));
      const r2 = ref('rev-2', 2, r1.manifest);
      store.transact({ label: 'Commit' }, (tx) => tx.patch('meshes', MESH, { data: r2 }));
      const remote = ref('rev-remote', 3, r2.manifest);
      const before = readRaw(store, 'meshes', MESH);
      check(before !== undefined, 'mesh present');
      store.applyChanges(
        [{ table: 'meshes', id: MESH, before, after: { ...before, data: remote }, fields: ['data'] }] as never,
        REMOTE,
      );
      const result = store.undo.undo();
      check(result !== null, 'an undo entry');
      equal(read(store, 'meshes', MESH)?.data, remote, 'the other user’s ref stays');
      check(
        result.skipped.some((s) => s.change.table === 'meshes' && s.reason === 'changed-by-other'),
        'the ref change is reported as skipped (changed-by-other)',
      );
    });
  });
}

export function registerMeshRefReplicatingCases(r: SuiteRunner, caps: ConformanceCaps): void {
  r.describe('mesh refs: replication and fork detection', () => {
    r.it('two peers commit offline on the same base: both refs carry it, the helper reports the fork', async () => {
      const harness = caps.harness;
      check(harness !== undefined, 'replicating conformance needs caps.harness');
      const net = harness.create(2, { seed: 702 });
      const [a, b] = net.peers;
      check(a !== undefined && b !== undefined, 'two peers');
      await a.open('scene');
      await b.open('scene');
      const observed: ObservedRef[] = [];
      for (const peer of [a, b]) peer.subscribe((batch) => observed.push(...refsOfBatch(batch)));
      const r1 = ref('rev-1', 1, null);
      a.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh(MESH, { data: r1 })));
      net.settle();
      equal(read(b, 'meshes', MESH)?.data, r1, 'B has the first revision');
      equal(meshRefForks(observed), [], 'no fork yet');
      // Offline: both commit on rev-1 before anything is delivered.
      const ra = ref('rev-2a', 2, r1.manifest);
      const rb = ref('rev-2b', 2, r1.manifest);
      a.transact({ label: 'Commit A' }, (tx) => tx.patch('meshes', MESH, { data: ra }));
      b.transact({ label: 'Commit B' }, (tx) => tx.patch('meshes', MESH, { data: rb }));
      net.settle();
      const winner = read(a, 'meshes', MESH)?.data;
      equal(read(b, 'meshes', MESH)?.data, winner, 'the peers converge on one ref (field LWW)');
      check(winner?.manifest === ra.manifest || winner?.manifest === rb.manifest, 'the winner is one of the commits');
      equal(winner?.base, r1.manifest, 'both commits carry the base');
      equal(
        meshRefForks(observed),
        [{ mesh: MESH, base: r1.manifest, manifests: [ra.manifest, rb.manifest].sort() }],
        'the fork on rev-1 is reported',
      );
    });
  });
}
