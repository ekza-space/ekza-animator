// Schema v3 part of the conformance suite (M6A-SPEC §4.2, §9 B0a): the seven M6a tables through the public store API
// (writes, partitions, soft delete, undo/redo, snapshot/load, queries), the undo eviction contract (`entries()`,
// `onEvict` with every reason, `evictOldest`, `clearRedo`) and, for replicating stores, convergence of M6a records.
// Mesh `data` stays opaque here (B7 adds the mesh-ref cases in `testing/mesh*`).
import type { AssetId, GroupId, MeshId, PaletteId, SkeletonId, UserId } from '../../ids';
import type { Partition } from '../../records';
import type { ConformanceCaps, DocumentStore, Tx, UndoEntry, UndoEvictReason } from '../../store';
import {
  makeTestGroup,
  makeTestImageAsset,
  makeTestImagePlane,
  makeTestJoint,
  makeTestMesh,
  makeTestPalette,
  makeTestSkeleton,
  makeTestSwatch,
  testHash,
} from '../records-v3';
import { check, docText, equal, read, readRaw, type Scene, type SuiteRunner, seedScene } from './harness';

type Factory = () => DocumentStore;

const REMOTE = { origin: 'remote', label: 'Remote edit', user: 'someone-else' as UserId } as const;

/** Ids of the M6a records `writeModeling` writes on top of a seeded scene. */
interface Modeling {
  readonly palette: PaletteId;
  readonly swatches: readonly [string, string, string];
  readonly group: GroupId;
  readonly meshes: readonly [MeshId, MeshId, MeshId];
  readonly characterMesh: MeshId;
  readonly image: AssetId;
  readonly plane: string;
  readonly skeleton: SkeletonId;
  readonly joints: readonly [string, string];
}

const MODELING: Modeling = {
  palette: 'pal_conformance0001' as PaletteId,
  swatches: ['sw_conformance0001', 'sw_conformance0002', 'sw_conformance0003'],
  group: 'grp_conformance0001' as GroupId,
  meshes: ['msh_conformance0001', 'msh_conformance0002', 'msh_conformance0003'] as unknown as readonly [
    MeshId,
    MeshId,
    MeshId,
  ],
  characterMesh: 'msh_conformance0009' as MeshId,
  image: makeTestImageAsset('front.png').id,
  plane: 'img_conformance0001',
  skeleton: 'skl_conformance0001' as SkeletonId,
  joints: ['jnt_conformance0001', 'jnt_conformance0002'],
};

/** Writes palettes, swatches, a group with two meshes, a root mesh, a character mesh, an image plane and a skeleton. */
function writeModeling(tx: Tx, scene: Scene, m: Modeling = MODELING): void {
  tx.put('palettes', makeTestPalette(m.palette, { name: 'Ekza Default 16' }));
  // Display order b, a, c: swatchesOfPalette is by order, not by slot.
  tx.put('swatches', makeTestSwatch(m.swatches[0], m.palette, 0, { order: 'a1' }));
  tx.put('swatches', makeTestSwatch(m.swatches[1], m.palette, 1, { order: 'a0' }));
  tx.put('swatches', makeTestSwatch(m.swatches[2], m.palette, 2, { order: 'a2' }));
  tx.put('groups', makeTestGroup(m.group, { name: 'Prop', template: { kind: 'prop', params: {} } }));
  tx.put('meshes', makeTestMesh(m.meshes[0], { name: 'Blade', parent: m.group, order: 'a1', palette: m.palette }));
  tx.put('meshes', makeTestMesh(m.meshes[1], { name: 'Guard', parent: m.group, order: 'a0' }));
  tx.put('meshes', makeTestMesh(m.meshes[2], { name: 'Crate', order: 'a5' }));
  tx.put(
    'meshes',
    makeTestMesh(m.characterMesh, {
      name: 'Body',
      owner: { character: scene.character },
      source: { asset: scene.asset, mesh: 0 },
      faceted: false,
      material: { assetSlots: [{ asset: scene.asset, material: 0 }] },
      data: { manifest: testHash('rev-1'), rev: 1, base: null, joints: [] },
    }),
  );
  tx.put('assets', makeTestImageAsset('front.png'));
  tx.put('imagePlanes', makeTestImagePlane(m.plane, m.image, { camera: 'front' }));
  // The joint before its skeleton: the store resolves its partition when the skeleton arrives (same transaction).
  tx.put('joints', makeTestJoint(m.joints[1], m.skeleton, { parent: m.joints[0] as never, order: 'a0' }));
  tx.put('skeletons', makeTestSkeleton(m.skeleton, scene.character));
  tx.put('joints', makeTestJoint(m.joints[0], m.skeleton, { humanBone: 'hips', order: 'a0' }));
}

async function seeded(store: DocumentStore, seed = 1): Promise<Scene> {
  const scene = await seedScene(store, seed);
  store.transact({ label: 'Model' }, (tx) => writeModeling(tx, scene));
  return scene;
}

const ids = (records: readonly { readonly id: string }[]): string[] => records.map((record) => record.id);

export function registerSchemaV3Cases(r: SuiteRunner, factory: Factory): void {
  r.describe('schema v3: the M6a tables', () => {
    r.it(
      'writes, reads and partitions meshes, groups, palettes, swatches, image planes, skeletons and joints',
      async () => {
        const store = factory();
        const scene = await seeded(store);
        const m = MODELING;
        equal(read(store, 'palettes', m.palette)?.name, 'Ekza Default 16', 'palette');
        equal(ids(store.list('swatches')), [...m.swatches].sort(), 'list is by id');
        equal(read(store, 'meshes', m.characterMesh)?.owner, { character: scene.character }, 'character mesh');
        equal(read(store, 'imagePlanes', m.plane)?.camera, 'front', 'image plane');
        equal(read(store, 'joints', m.joints[1])?.skeleton, m.skeleton, 'joint written before its skeleton');
        // Partitions: character meshes, skeletons and joints live in char:<id>; the rest in scene.
        store.close(`char:${scene.character}` as Partition);
        check(read(store, 'meshes', m.characterMesh) === undefined, 'character mesh hidden with its partition');
        check(read(store, 'skeletons', m.skeleton) === undefined, 'skeleton hidden with its partition');
        check(read(store, 'joints', m.joints[0]) === undefined, 'joint hidden with its skeleton’s partition');
        check(read(store, 'joints', m.joints[1]) === undefined, 'early joint resolved to the skeleton’s partition');
        check(read(store, 'meshes', m.meshes[2]) !== undefined, 'scene mesh stays visible');
        check(read(store, 'swatches', m.swatches[0]) !== undefined, 'swatches are in scene');
        await store.open(`char:${scene.character}` as Partition);
        equal(read(store, 'joints', m.joints[0])?.humanBone, 'hips', 'joint visible again');
      },
    );

    r.it('soft delete, patch, undo and redo restore the M6a records; snapshot/load round-trips them', async () => {
      const store = factory();
      await seeded(store);
      const m = MODELING;
      const before = docText(store);
      store.transact({ label: 'Commit' }, (tx) =>
        tx.patch('meshes', m.meshes[2], { data: { manifest: testHash('rev-2'), rev: 1, base: null, joints: [] } }),
      );
      store.transact({ label: 'Delete swatch' }, (tx) => tx.softDelete('swatches', m.swatches[1] as never));
      check(read(store, 'swatches', m.swatches[1]) === undefined, 'soft-deleted swatch hidden');
      check(readRaw(store, 'swatches', m.swatches[1])?.deleted !== null, 'tombstone kept');
      store.undo.undo();
      store.undo.undo();
      equal(docText(store), before, 'two undos restore the document');
      store.undo.redo();
      equal(read(store, 'meshes', m.meshes[2])?.data?.manifest, testHash('rev-2'), 'redo re-applies the ref');
      const copy = factory();
      copy.load(store.snapshot());
      equal(docText(copy), docText(store), 'snapshot/load round trip');
    });

    r.it(
      'queries: meshesOfOwner, childrenOf, swatchesOfPalette, swatchBySlot, imagePlanesOf, jointsOfSkeleton',
      async () => {
        const store = factory();
        const scene = await seeded(store);
        const m = MODELING;
        const q = store.query;
        equal(ids(q.meshesOfOwner('scene')), [m.meshes[1], m.meshes[0], m.meshes[2]], 'scene meshes by order');
        equal(ids(q.meshesOfOwner(scene.character)), [m.characterMesh], 'character meshes');
        equal(ids(q.childrenOf(null, 'scene')), [m.group, m.meshes[2]], 'roots by order (group a0, crate a5)');
        equal(ids(q.childrenOf(m.group, 'scene')), [m.meshes[1], m.meshes[0]], 'children by order');
        equal(ids(q.childrenOf(null, scene.character)), [m.characterMesh], 'character roots');
        equal(ids(q.swatchesOfPalette(m.palette)), [m.swatches[1], m.swatches[0], m.swatches[2]], 'swatches by order');
        equal(q.swatchBySlot(m.palette, 2)?.id, m.swatches[2], 'swatch by slot');
        check(q.swatchBySlot(m.palette, 7) === undefined, 'unknown slot');
        equal(ids(q.imagePlanesOf('front')), [m.plane], 'front planes');
        equal(ids(q.imagePlanesOf('side')), [], 'no side planes');
        equal(ids(q.jointsOfSkeleton(m.skeleton)), [m.joints[0], m.joints[1]], 'parents first');

        // Queries follow writes and soft deletes.
        store.transact({ label: 'Reparent' }, (tx) => tx.patch('meshes', m.meshes[2], { parent: m.group }));
        equal(ids(q.childrenOf(m.group, 'scene')), [m.meshes[1], m.meshes[0], m.meshes[2]], 'reparented');
        store.transact({ label: 'Delete' }, (tx) => tx.softDelete('swatches', m.swatches[2] as never));
        check(q.swatchBySlot(m.palette, 2) === undefined, 'deleted swatch not found by slot');
        store.undo.undo();
        store.undo.undo();
        equal(ids(q.childrenOf(null, 'scene')), [m.group, m.meshes[2]], 'undo restores the roots');

        // Content arriving from elsewhere is never rejected: a duplicate slot, a dangling parent and a cycle.
        store.applyChanges(
          [
            {
              table: 'swatches',
              id: 'sw_conformance0000',
              before: undefined,
              after: makeTestSwatch('sw_conformance0000', m.palette, 2),
            },
            {
              table: 'meshes',
              id: 'msh_conformance0004',
              before: undefined,
              after: makeTestMesh('msh_conformance0004', {
                name: 'Orphan',
                parent: 'grp_missing' as GroupId,
                order: 'a9',
              }),
            },
            {
              table: 'groups',
              id: 'grp_conformance0002',
              before: undefined,
              after: makeTestGroup('grp_conformance0002', { parent: 'grp_conformance0003' as GroupId }),
            },
            {
              table: 'groups',
              id: 'grp_conformance0003',
              before: undefined,
              after: makeTestGroup('grp_conformance0003', { parent: 'grp_conformance0002' as GroupId, order: 'a8' }),
            },
          ] as never,
          REMOTE,
        );
        equal(q.swatchBySlot(m.palette, 2)?.id, 'sw_conformance0000', 'duplicate slot: the smaller SwatchId wins');
        const roots = ids(q.childrenOf(null, 'scene'));
        check(roots.includes('msh_conformance0004'), 'a dangling parent makes a root');
        check(roots.includes('grp_conformance0002'), 'a cycle is broken at its smallest id');
        equal(
          ids(q.childrenOf('grp_conformance0002' as GroupId, 'scene')),
          ['grp_conformance0003'],
          'rest of the cycle',
        );
      },
    );

    r.it('validation rejects a write that introduces a problem (an empty mesh name)', async () => {
      const store = factory();
      await seeded(store);
      let threw = false;
      try {
        store.transact({ label: 'Bad' }, (tx) =>
          tx.put('meshes', { ...makeTestMesh('msh_conformance0005'), name: '' }),
        );
      } catch {
        threw = true;
      }
      check(threw, 'an empty mesh name is rejected on write');
      check(read(store, 'meshes', 'msh_conformance0005') === undefined, 'nothing written');
    });
  });

  r.describe('undo eviction (M6a)', () => {
    const labels = (entries: readonly UndoEntry[]): string[] => entries.map((entry) => entry.label);
    const record = (store: DocumentStore) => {
      const events: { readonly labels: string[]; readonly reason: UndoEvictReason }[] = [];
      const dispose = store.undo.onEvict((entries, reason) => events.push({ labels: labels(entries), reason }));
      return { events, dispose };
    };
    const edit = (store: DocumentStore, scene: Scene, label: string, weight: number): void => {
      store.transact({ label }, (tx) => tx.patch('layers', scene.layer, { weight }));
    };

    r.it(
      'entries() lists undo oldest first and redo from the next redo; views are stable until the next write',
      async () => {
        const store = factory();
        const scene = await seedScene(store);
        edit(store, scene, 'A', 0.1);
        edit(store, scene, 'B', 0.2);
        edit(store, scene, 'C', 0.3);
        store.undo.undo();
        store.undo.undo();
        const entries = store.undo.entries();
        equal(labels(entries.undo), ['Seed', 'A'], 'undo entries, oldest first');
        equal(labels(entries.redo), ['B', 'C'], 'redo entries, next redo first');
        check(store.undo.entries() === entries, 'the same view while nothing is written');
        equal(entries.undo.at(-1), store.undo.peekUndo(), 'last undo entry is peekUndo');
        equal(entries.redo[0], store.undo.peekRedo(), 'first redo entry is peekRedo');
      },
    );

    r.it('reports redo-cleared, budget, clear and load evictions, in eviction order, synchronously', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const log = record(store);
      edit(store, scene, 'A', 0.1);
      edit(store, scene, 'B', 0.2);
      edit(store, scene, 'C', 0.3);
      store.undo.undo();
      store.undo.undo();
      edit(store, scene, 'D', 0.4);
      equal(log.events, [{ labels: ['B', 'C'], reason: 'redo-cleared' }], 'a new transaction clears redo');
      store.undo.evictOldest(2);
      equal(log.events.at(-1), { labels: ['Seed', 'A'], reason: 'budget' }, 'evictOldest drops the oldest');
      equal(labels(store.undo.entries().undo), ['D'], 'what is left');
      store.undo.evictOldest(0);
      equal(log.events.length, 2, 'evictOldest(0) evicts nothing');
      store.undo.undo();
      store.undo.clearRedo();
      equal(log.events.at(-1), { labels: ['D'], reason: 'redo-cleared' }, 'clearRedo');
      check(!store.undo.canRedo(), 'redo emptied');
      store.undo.clearRedo();
      equal(log.events.length, 3, 'clearRedo without redo entries reports nothing');
      edit(store, scene, 'E', 0.5);
      store.undo.clear();
      equal(log.events.at(-1), { labels: ['E'], reason: 'clear' }, 'clear');
      edit(store, scene, 'F', 0.6);
      store.load(store.snapshot());
      equal(log.events.at(-1), { labels: ['F'], reason: 'load' }, 'load');
      log.dispose();
      edit(store, scene, 'G', 0.7);
      store.undo.clear();
      equal(log.events.length, 5, 'disposed listeners hear nothing');
    });

    r.it('reports entries dropped by the limit', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const log = record(store);
      const limit = store.undo.limit;
      for (let i = 0; i < limit; i++) edit(store, scene, `E${i}`, i / limit);
      equal(log.events, [{ labels: ['Seed'], reason: 'limit' }], 'the oldest entry leaves at the limit');
      equal(store.undo.entries().undo.length, limit, 'the stack stays at the limit');
      log.dispose();
    });
  });
}

export function registerSchemaV3ReplicatingCases(r: SuiteRunner, caps: ConformanceCaps): void {
  r.describe('schema v3: replication of the M6a tables', () => {
    r.it('M6a records converge, joints follow their skeleton’s partition and undo stays per user', async () => {
      const harness = caps.harness;
      check(harness !== undefined, 'replicating conformance needs caps.harness');
      const net = harness.create(2, { seed: 601 });
      const [a, b] = net.peers;
      check(a !== undefined && b !== undefined, 'two peers');
      const scene = await seedScene(a, 601);
      for (const partition of scene.partitions) await b.open(partition);
      a.transact({ label: 'Model' }, (tx) => writeModeling(tx, scene));
      net.settle();
      equal(docText(b), docText(a), 'B converged with A');
      equal(read(b, 'joints', MODELING.joints[1])?.parent, MODELING.joints[0], 'joints replicated');
      // Concurrent edits of different fields of one mesh merge per field.
      a.transact({ label: 'Rename' }, (tx) => tx.patch('meshes', MODELING.meshes[2], { name: 'Box' }));
      b.transact({ label: 'Facet' }, (tx) => tx.patch('meshes', MODELING.meshes[2], { faceted: false }));
      net.settle();
      equal(docText(b), docText(a), 'converged after concurrent field edits');
      const mesh = read(a, 'meshes', MODELING.meshes[2]);
      equal([mesh?.name, mesh?.faceted], ['Box', false], 'both fields kept');
      b.undo.undo();
      net.settle();
      equal(read(a, 'meshes', MODELING.meshes[2])?.name, 'Box', 'B’s undo leaves A’s rename');
      equal(read(a, 'meshes', MODELING.meshes[2])?.faceted, true, 'B’s undo reverts its own field');
    });
  });
}
