// Schema v4 part of the conformance suite (M6B-SPEC §4.1, §9 C0): the v4 fields through the public store API (writes
// and their per-record checks, snapshot/load, undo), the three v4 queries (`skeletonOfCharacter`, `constraintsOfRig`,
// `meshesBoundTo`) and, for replicating stores, convergence of v4 records.
import type { ConstraintId, MeshId, SkeletonId } from '../../ids';
import type { ConstraintRecord, Partition } from '../../records';
import type { ConformanceCaps, DocumentStore } from '../../store';
import { makeTestJoint, makeTestMesh, makeTestSkeleton } from '../records-v3';
import { makeTestThumbnailAsset, makeTestVrmMeta } from '../records-v4';
import { check, docText, equal, read, type SuiteRunner, seedScene, throwsCode } from './harness';

type Factory = () => DocumentStore;

const SKELETONS = ['skl_v4conformance1', 'skl_v4conformance2'] as unknown as readonly [SkeletonId, SkeletonId];
const MESHES = ['msh_v4conformance1', 'msh_v4conformance2', 'msh_v4conformance3'] as unknown as readonly [
  MeshId,
  MeshId,
  MeshId,
];
const CONSTRAINTS = ['cns_v4conformance2', 'cns_v4conformance1'] as unknown as readonly [ConstraintId, ConstraintId];

function constraint(id: ConstraintId, rig: string, control: string): ConstraintRecord {
  return {
    id,
    rig: rig as never,
    type: 'parent',
    driven: { control: control as never },
    targets: {},
    maintainOffset: true,
    params: {},
    enabled: true,
    deleted: null,
  };
}

const ids = (records: readonly { readonly id: string }[]): string[] => records.map((record) => record.id);

export function registerSchemaV4Cases(r: SuiteRunner, factory: Factory): void {
  r.describe('schema v4: the M6b fields and queries', () => {
    r.it(
      'writes and round-trips VRM meta, joint roles and keys, edited shapes, test clips and thumbnails',
      async () => {
        const store = factory();
        const scene = await seedScene(store, 41);
        const thumbnail = makeTestThumbnailAsset('thumb.png');
        store.transact({ label: 'Rig' }, (tx) => {
          tx.put('assets', thumbnail);
          tx.patch('characters', scene.character, {
            vrm: makeTestVrmMeta('Lad', { authors: ['Tester'], licensePreset: 'cc0', thumbnail: thumbnail.id }),
          });
          tx.put('skeletons', makeTestSkeleton(SKELETONS[0], scene.character));
          tx.put('joints', makeTestJoint('jnt_v4conformance1', SKELETONS[0], { role: 'helper', key: 'root' }));
          const control = read(tx, 'controls', scene.controls[0]);
          check(control !== undefined, 'seeded control');
          tx.patch('controls', scene.controls[0], { shape: { ...control.shape, edited: ['size', 'color'] } });
          tx.patch('clips', scene.clip, { source: { kind: 'test', generator: 'rom', version: 1 } });
        });
        equal(read(store, 'characters', scene.character)?.vrm?.licensePreset, 'cc0', 'vrm meta written');
        equal(read(store, 'joints', 'jnt_v4conformance1')?.role, 'helper', 'joint role');
        equal(read(store, 'controls', scene.controls[0])?.shape.edited, ['size', 'color'], 'edited shape fields');
        equal(read(store, 'clips', scene.clip)?.source, { kind: 'test', generator: 'rom', version: 1 }, 'test clip');
        const saved = store.snapshot();
        equal([saved.schemaVersion, saved.minWriterVersion], [4, 4], 'a skeleton requires writer version 4');
        const copy = factory();
        copy.load(saved);
        equal(docText(copy), docText(store), 'snapshot/load round trip');
        store.undo.undo();
        equal(read(store, 'characters', scene.character)?.vrm, null, 'undo restores vrm: null');
        check(read(store, 'skeletons', SKELETONS[0]) === undefined, 'undo removes the skeleton');
      },
    );

    r.it('local writes check the v4 fields of one record', async () => {
      const store = factory();
      const scene = await seedScene(store, 42);
      const joint = makeTestJoint('jnt_v4conformance2', SKELETONS[0]);
      const { role: _role, ...noRole } = joint;
      throwsCode(
        () => store.transact({ label: 'Joint' }, (tx) => tx.put('joints', noRole as never)),
        'invalid-record',
        'a joint without role',
      );
      throwsCode(
        () => store.transact({ label: 'Joint' }, (tx) => tx.put('joints', { ...joint, key: '' })),
        'invalid-record',
        'a joint with an empty key',
      );
      throwsCode(
        () =>
          store.transact({ label: 'Meta' }, (tx) =>
            tx.patch('characters', scene.character, {
              vrm: { ...makeTestVrmMeta('X'), creditNotation: 'maybe' } as never,
            }),
          ),
        'invalid-record',
        'an unknown VRM meta enum',
      );
      throwsCode(
        () =>
          store.transact({ label: 'Clip' }, (tx) =>
            tx.patch('clips', scene.clip, { source: { kind: 'test', generator: 'walk', version: 1 } as never }),
          ),
        'invalid-record',
        'an unknown test clip generator',
      );
    });

    r.it('queries: skeletonOfCharacter, constraintsOfRig, meshesBoundTo', async () => {
      const store = factory();
      const scene = await seedScene(store, 43);
      store.transact({ label: 'Rig' }, (tx) => {
        tx.put('skeletons', makeTestSkeleton(SKELETONS[0], scene.character));
        for (const id of CONSTRAINTS) tx.put('constraints', constraint(id, scene.rig, scene.controls[1]));
        const skin = { skeleton: SKELETONS[0], bind: null };
        const owner = { character: scene.character };
        tx.put('meshes', makeTestMesh(MESHES[0], { name: 'Body', owner, order: 'a2', skin }));
        tx.put('meshes', makeTestMesh(MESHES[1], { name: 'Head', owner, order: 'a1', skin }));
        tx.put('meshes', makeTestMesh(MESHES[2], { name: 'Hat', owner, order: 'a0' }));
      });
      const q = store.query;
      equal(q.skeletonOfCharacter(scene.character)?.id, SKELETONS[0], 'the only skeleton');
      store.transact({ label: 'Second' }, (tx) => tx.put('skeletons', makeTestSkeleton(SKELETONS[1], scene.character)));
      equal(q.skeletonOfCharacter(scene.character)?.id, SKELETONS[1], 'on a conflict the newest (greatest) id');
      store.transact({ label: 'Delete' }, (tx) => tx.softDelete('skeletons', SKELETONS[1]));
      equal(q.skeletonOfCharacter(scene.character)?.id, SKELETONS[0], 'soft-deleted skeletons are not live');
      equal(ids(q.constraintsOfRig(scene.rig)), [...CONSTRAINTS].sort(), 'constraints by id');
      store.transact({ label: 'Delete' }, (tx) => tx.softDelete('constraints', CONSTRAINTS[1]));
      equal(ids(q.constraintsOfRig(scene.rig)), [CONSTRAINTS[0]], 'soft-deleted constraints are not live');
      equal(ids(q.meshesBoundTo(SKELETONS[0])), [MESHES[1], MESHES[0]], 'bound meshes by order');
      store.transact({ label: 'Unbind' }, (tx) => tx.patch('meshes', MESHES[1], { skin: null }));
      equal(ids(q.meshesBoundTo(SKELETONS[0])), [MESHES[0]], 'an unbound mesh leaves');
      store.transact({ label: 'Bind' }, (tx) =>
        tx.patch('meshes', MESHES[2], { skin: { skeleton: SKELETONS[0], bind: null } }),
      );
      equal(ids(q.meshesBoundTo(SKELETONS[0])), [MESHES[2], MESHES[0]], 'a newly bound mesh joins');
      store.close(`char:${scene.character}` as Partition);
      check(q.skeletonOfCharacter(scene.character) === undefined, 'closed partition: no skeleton');
      equal(ids(q.meshesBoundTo(SKELETONS[0])), [], 'closed partition: no bound mesh');
      equal(ids(q.constraintsOfRig(scene.rig)), [], 'closed partition: no constraint');
    });
  });
}

export function registerSchemaV4ReplicatingCases(r: SuiteRunner, caps: ConformanceCaps): void {
  r.describe('schema v4: replication of the M6b fields', () => {
    r.it('VRM meta and joint keys converge; concurrent edits of other fields merge', async () => {
      const harness = caps.harness;
      check(harness !== undefined, 'replicating conformance needs caps.harness');
      const net = harness.create(2, { seed: 604 });
      const [a, b] = net.peers;
      check(a !== undefined && b !== undefined, 'two peers');
      const scene = await seedScene(a, 604);
      for (const partition of scene.partitions) await b.open(partition);
      a.transact({ label: 'Rig' }, (tx) => {
        tx.put('skeletons', makeTestSkeleton(SKELETONS[0], scene.character));
        tx.put('joints', makeTestJoint('jnt_v4replica1', SKELETONS[0], { key: 'hips', humanBone: 'hips' }));
      });
      net.settle();
      equal(docText(b), docText(a), 'B converged with A');
      a.transact({ label: 'Meta' }, (tx) => tx.patch('characters', scene.character, { vrm: makeTestVrmMeta('Lad') }));
      b.transact({ label: 'Rename' }, (tx) => tx.patch('characters', scene.character, { name: 'Renamed' }));
      net.settle();
      equal(docText(b), docText(a), 'converged after concurrent field edits');
      const character = read(a, 'characters', scene.character);
      equal([character?.name, character?.vrm?.name], ['Renamed', 'Lad'], 'both fields kept');
      equal(read(b, 'joints', 'jnt_v4replica1')?.key, 'hips', 'joint key replicated');
    });
  });
}
