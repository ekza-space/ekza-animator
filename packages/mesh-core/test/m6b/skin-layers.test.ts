// M6B-SPEC §4.2 (C0 working baselines): readSkin / withSkin / readSkinReview over the M6a skin layers — the round trip
// keeps the revision manifest (P8: manifests unchanged when the skin is unchanged), withSkin shares every other array,
// removes and replaces the skin and review layers, and reads work on MeshData and EditMesh alike.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYERS,
  editMeshFrom,
  type MeshData,
  primitive,
  readSkin,
  readSkinReview,
  SKIN_REVIEW_LAYER,
  type SkinWeights,
  withSkin,
  writeRevision,
} from '../../src';

const cube = (): MeshData => primitive('cube', {});

/** A skinned cube as M6a writes it: palette meta `{ joints: [{ id, parent }] }` without mirror keys. */
function skinnedCube(): MeshData {
  const data = cube();
  const points = data.counts.points;
  const joints = new Uint16Array(4 * points);
  const weights = new Float32Array(4 * points);
  for (let p = 0; p < points; p++) {
    joints.set([p % 2, 1 - (p % 2), 0, 0], 4 * p);
    weights.set([0.75, 0.25, 0, 0], 4 * p);
  }
  const layers = new Map(data.layers);
  layers.set('skin.joints', {
    def: {
      ...BUILTIN_LAYERS.skinJoints,
      meta: {
        joints: [
          { id: 'jnt_hips', parent: null },
          { id: 'jnt_spine', parent: 'jnt_hips' },
        ],
      },
    },
    data: joints,
  });
  layers.set('skin.weights', { def: BUILTIN_LAYERS.skinWeights, data: weights });
  return { ...data, layers };
}

const manifestOf = (data: MeshData): string => writeRevision(data).manifestId;

describe('readSkin / withSkin (C0 baselines)', () => {
  it('reads nothing from an unskinned mesh', () => {
    expect(readSkin(cube())).toBeNull();
    expect(readSkinReview(cube())).toBeNull();
  });

  it('reads the palette and the arrays (copies) from MeshData and EditMesh alike', () => {
    const data = skinnedCube();
    const skin = readSkin(data) as SkinWeights;
    expect(skin.points).toBe(data.counts.points);
    expect(skin.palette).toEqual([
      { key: 'jnt_hips', parent: null, mirror: null },
      { key: 'jnt_spine', parent: 'jnt_hips', mirror: null },
    ]);
    expect(Array.from(skin.weights.subarray(0, 4))).toEqual([0.75, 0.25, 0, 0]);
    expect(skin.joints).not.toBe(data.layers.get('skin.joints')?.data);
    expect(readSkin(editMeshFrom(data))).toEqual(skin);
  });

  it('round-trips with the same manifest (P8) and shares every other array', () => {
    const data = skinnedCube();
    const back = withSkin(data, readSkin(data));
    expect(manifestOf(back)).toBe(manifestOf(data));
    expect(back.position).toBe(data.position);
    expect(back.cornerVert).toBe(data.cornerVert);
    expect(back.layers.get('paint')).toBe(data.layers.get('paint'));
    expect([...back.layers.keys()]).toEqual([...data.layers.keys()]);
  });

  it('writes mirror keys only when known, removes the skin with null, and refuses a wrong point count', () => {
    const data = skinnedCube();
    const skin = readSkin(data) as SkinWeights;
    const mirrored = withSkin(data, {
      ...skin,
      palette: [
        { key: 'jnt_hips', parent: null, mirror: null },
        { key: 'jnt_spine', parent: 'jnt_hips', mirror: 'jnt_spine' },
      ],
    });
    expect(mirrored.layers.get('skin.joints')?.def.meta).toEqual({
      joints: [
        { id: 'jnt_hips', parent: null },
        { id: 'jnt_spine', parent: 'jnt_hips', mirror: 'jnt_spine' },
      ],
    });
    expect(readSkin(mirrored)?.palette[1]?.mirror).toBe('jnt_spine');
    const bare = withSkin(data, null);
    expect(bare.layers.has('skin.joints') || bare.layers.has('skin.weights')).toBe(false);
    expect(readSkin(bare)).toBeNull();
    expect(manifestOf(withSkin(bare, skin))).toBe(manifestOf(data));
    expect(() => withSkin(data, { ...skin, points: skin.points + 1 })).toThrow(/points/);
  });

  it('writes, keeps and removes the review layer', () => {
    const data = skinnedCube();
    const review = { reason: 'transferred', source: 'abc', points: Uint32Array.of(1, 3) } as const;
    const reviewed = withSkin(data, readSkin(data), review);
    expect(reviewed.layers.get(SKIN_REVIEW_LAYER)?.def).toMatchObject({
      domain: 'point',
      type: 'u8',
      interp: 'or',
      mirror: 'none',
    });
    expect(readSkinReview(reviewed)).toEqual(review);
    expect(readSkinReview(editMeshFrom(reviewed))).toEqual(review);
    expect(readSkinReview(withSkin(reviewed, readSkin(reviewed)))).toEqual(review);
    expect(readSkinReview(withSkin(reviewed, readSkin(reviewed), null))).toBeNull();
    expect(
      readSkinReview(withSkin(data, readSkin(data), { reason: 'filled', source: null, points: new Uint32Array(0) })),
    ).toBeNull();
  });
});
