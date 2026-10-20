// M6A-SPEC §9 B7 (manifest reader rules): the dangling-joint fold for `skin.skeleton` meshes only (a peer undoes
// "add joint" after another wrote weights on it: the weights fold to the nearest live ancestor from the manifest,
// `skin.dangling-joint`; an imported skin with `data.joints: []` never folds), morph names from the manifest only,
// unknown layers surviving commits, undo and the revision codec, and `MeshRef.joints` copied from the manifest.
import type { JointId, MeshRecord, SkeletonId } from '@ekza-animator/doc';
import { makeTestCharacter, makeTestJoint, makeTestSkeleton } from '@ekza-animator/doc/testing';
import {
  BUILTIN_LAYERS,
  editMeshFrom,
  type LayerDef,
  type MeshData,
  morphLayer,
  parseManifest,
  primitive,
  readRevision,
  writeRevision,
} from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import { morphNamesOf, readSkin, refJointsOf } from '../../src';
import { createMesh, meshTestApp, offsetOp, testOperator } from './support';

const SKELETON = 'skl_Rig000000000001' as SkeletonId;
const HIPS = `${SKELETON}:hips` as JointId;
const SPINE = `${SKELETON}:spine` as JointId;
const EXTRA = 'jnt_Extra00000000001' as JointId;

/** A cube with a skin palette [hips, spine, extra] and every vertex weighted 0.25 hips / 0.25 spine / 0.5 extra. */
function skinnedCube(extra: Record<string, unknown> = {}): MeshData {
  const m = editMeshFrom(primitive('cube', {}));
  m.begin('skin');
  const palette = [
    { id: HIPS, parent: null },
    { id: SPINE, parent: HIPS },
    { id: EXTRA, parent: SPINE },
  ];
  const joints = m.addLayer({ ...BUILTIN_LAYERS.skinJoints, meta: { joints: palette } });
  const weights = m.addLayer(BUILTIN_LAYERS.skinWeights);
  for (let v = 0; v < m.counts.points; v++) {
    joints.set(v, 0, 0);
    joints.set(v, 1, 1);
    joints.set(v, 2, 2);
    weights.set(v, 0, 0.25);
    weights.set(v, 1, 0.25);
    weights.set(v, 2, 0.5);
    weights.set(v, 3, 0);
  }
  for (const [name, def] of Object.entries(extra)) m.addLayer({ ...(def as LayerDef), name });
  m.end();
  return m.snapshot();
}

const skinned = (skin: MeshRecord['skin']): Pick<MeshRecord, 'skin'> => ({ skin });

describe('the dangling-joint fold (skin.skeleton meshes only)', () => {
  it('folds the weights of a joint a peer removed onto its nearest live ancestor from the manifest', async () => {
    const t = await meshTestApp();
    const character = makeTestCharacter({
      id: 'chr_Hero0000000001' as never,
      asset: 'a'.repeat(64) as never,
      rig: 'rig_Hero0000000001' as never,
      name: 'Hero',
      order: 'a0',
    });
    t.app.store.transact({ label: 'Character' }, (tx) => tx.put('characters', character));
    await t.app.store.open(`char:${character.id}`);
    t.app.store.transact({ label: 'Rig' }, (tx) => {
      tx.put('skeletons', makeTestSkeleton(SKELETON, character.id));
      tx.put('joints', makeTestJoint(HIPS, SKELETON));
      tx.put('joints', makeTestJoint(SPINE, SKELETON, { parent: HIPS }));
    });
    // Peer A adds the joint; peer B writes weights on it (the revision below); peer A undoes "add joint".
    t.app.store.transact({ label: 'Add joint' }, (tx) =>
      tx.put('joints', makeTestJoint(EXTRA, SKELETON, { parent: SPINE })),
    );
    const data = skinnedCube();
    const record = skinned({ skeleton: SKELETON, bind: null });
    const live = (id: string): boolean => t.app.store.get('joints', id as JointId) !== undefined;
    expect(readSkin(record, data, live).warnings).toEqual([]);
    t.app.history.undo();
    expect(live(EXTRA)).toBe(false);
    const read = readSkin(record, data, live);
    expect(read.warnings).toEqual([expect.objectContaining({ code: 'skin.dangling-joint', count: 1 })]);
    expect([...read.fold]).toEqual([0, 1, 1]);
    // Vertex 0: hips 0.25, spine 0.25 + 0.5 → spine 0.75 first, hips 0.25; sums to 1.
    expect(Array.from(read.joints ?? []).slice(0, 4)).toEqual([1, 0, 0, 0]);
    expect(Array.from(read.weights ?? []).slice(0, 4)).toEqual([0.75, 0.25, 0, 0]);
    for (let v = 0; v < 8; v++) {
      const w = Array.from(read.weights ?? []).slice(4 * v, 4 * v + 4);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    // The stored revision is untouched (a reader rule).
    expect(data.layers.get('skin.weights')?.data[2]).toBe(0.5);
  });

  it('never folds an imported skin (joints are glTF indices, data.joints is [])', () => {
    const data = skinnedCube();
    const read = readSkin(skinned({ asset: 'a'.repeat(64) as never, skin: 0 }), data, () => false);
    expect(read.warnings).toEqual([]);
    expect([...read.fold]).toEqual([0, 1, 2]);
    expect(Array.from(read.weights ?? []).slice(0, 4)).toEqual([0.25, 0.25, 0.5, 0]);
    expect(refJointsOf(skinned({ asset: 'a'.repeat(64) as never, skin: 0 }), data)).toEqual([]);
  });

  it('copies the palette into MeshRef.joints on every commit of a skin.skeleton mesh', async () => {
    const t = await meshTestApp();
    const id = createMesh(t, 'msh_Skinned', skinnedCube(), { skin: { skeleton: SKELETON, bind: null } });
    expect(refJointsOf({ skin: { skeleton: SKELETON, bind: null } }, skinnedCube())).toEqual([HIPS, SPINE, EXTRA]);
    t.app.operators.register(testOperator(offsetOp()));
    await t.app.runUntyped('mesh.test.offset', { meshes: [id], dy: 0.1 });
    expect(t.app.store.get('meshes', id)?.data?.joints).toEqual([HIPS, SPINE, EXTRA]);
  });
});

describe('manifest-only names and unknown layers', () => {
  it('reads morph names from the manifest only, in manifest order', () => {
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('morphs');
    m.addLayer(morphLayer('Smile'));
    m.addLayer(morphLayer('Blink'));
    m.addLayer(BUILTIN_LAYERS.paint);
    m.end();
    const data = m.snapshot();
    expect(morphNamesOf(data)).toEqual(['Smile', 'Blink']);
    const out = writeRevision(data);
    const back = readRevision(parseManifest(out.manifestBytes), (id) => out.newChunks.get(id) as Uint8Array);
    expect(morphNamesOf(back)).toEqual(['Smile', 'Blink']);
  });

  it('keeps unknown layers through commits, undo and redo', async () => {
    const vendor: LayerDef = {
      name: 'vendor.extra',
      domain: 'point',
      type: 'f32',
      comps: 2,
      interp: 'linear',
      mirror: 'none',
      default: [0, 0],
      meta: { origin: 'tool-x', version: 3 },
    };
    const t = await meshTestApp();
    const m = editMeshFrom(primitive('cube', {}));
    m.begin('vendor');
    const layer = m.addLayer(vendor);
    for (let v = 0; v < m.counts.points; v++) layer.set(v, 1, v / 10);
    m.end();
    const id = createMesh(t, 'msh_Vendor', m.snapshot());
    t.app.operators.register(testOperator(offsetOp()));
    await t.app.runUntyped('mesh.test.offset', { meshes: [id], dy: 0.2 });
    const values = (): number[] => [...(t.app.meshes.get(id)?.data()?.layers.get('vendor.extra')?.data ?? [])];
    const def = (): unknown => t.app.meshes.get(id)?.data()?.layers.get('vendor.extra')?.def;
    const expected = Array.from({ length: 16 }, (_, i) => (i % 2 === 1 ? Math.fround((i - 1) / 20) : 0));
    expect(values()).toEqual(expected);
    expect(def()).toMatchObject({ name: 'vendor.extra', meta: { origin: 'tool-x', version: 3 } });
    t.app.history.undo();
    expect(values()).toEqual(expected);
    t.app.history.redo();
    expect(values()).toEqual(expected);
  });
});
