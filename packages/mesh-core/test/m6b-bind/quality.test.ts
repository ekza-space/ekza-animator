// P-S7 (M6B-SPEC §5.26, §9.0 C4 DoD) with the thresholds of C4's calibration spike (docs/wp-notes/m6b-auto-skin.md):
// Polybot without weights bound with `auto-lowpoly` on its own skeleton — dominant joint within one joint of the
// artist's on ≥ 98 % of the points and exact on ≥ 70 % (the spike's measure: 74 %; nearest-centroid rigid binding,
// the upper bound of island rules, reaches 79.5 %); no weight on a helper; the generated body (smooth and segmented):
// no weight on `root`, no forearm point dominated by a spine joint, every arm and leg island of the segmented body
// single-influence; the Cube Lad: every limb box (upper arm, forearm, thigh, shin) and the torso, pelvis, neck and head
// boxes single-influence, each forearm on its lower arm, no weight on `root`.
import { describe, expect, it } from 'vitest';
import { bindSkin, type SkinSkeleton, type SkinWeights, skinGeometryOf, skinIslands } from '../../src';
import { body, bodySkeletonRows, cubeLad, cubeLadRows, skeletonOf } from './fixtures';
import { cubeLadTruth, DEFAULT_ARGS } from './goldens';
import { polybot } from './polybot';

function keysOf(skin: SkinWeights, v: number): string[] {
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    if ((skin.weights[4 * v + k] as number) > 0)
      out.push(skin.palette[skin.joints[4 * v + k] as number]?.key as string);
  }
  return out;
}

function noHelperWeight(skin: SkinWeights, skeleton: SkinSkeleton): void {
  for (const entry of skin.palette) expect(skeleton.deform[skeleton.keys.indexOf(entry.key)]).toBe(1);
}

describe('P-S7 bind quality', () => {
  for (const pose of ['tpose', 'apose'] as const) {
    it(`Polybot (${pose}): within one joint of the artist on ≥ 98 %, exact on ≥ 70 %, no helper weight`, () => {
      const pb = polybot(pose);
      const geom = skinGeometryOf(pb.mesh, pb.skeleton.height);
      // Polybot is not mirror-exact (paired < 0.9): the operator resolves symmetrize to false.
      expect(geom.paired).toBeLessThan(0.9);
      const { skin } = bindSkin(geom, pb.skeleton, { ...DEFAULT_ARGS, symmetrize: false }, null);
      let exact = 0;
      let within = 0;
      const parent = pb.skeleton.parent;
      for (let v = 0; v < skin.points; v++) {
        const ours = pb.skeleton.keys.indexOf(keysOf(skin, v)[0] as string);
        const artist = pb.dominant[v] as number;
        expect(artist).toBeGreaterThanOrEqual(0);
        if (ours === artist) exact++;
        if (ours === artist || parent[ours] === artist || parent[artist] === ours) within++;
      }
      expect(within / skin.points).toBeGreaterThanOrEqual(0.98);
      expect(exact / skin.points).toBeGreaterThanOrEqual(0.7);
      noHelperWeight(skin, pb.skeleton);
    });
  }

  it('the generated body: no root weight; no forearm point dominated by a spine joint; segmented limbs rigid', () => {
    const skeleton = skeletonOf(bodySkeletonRows());
    const spine = new Set(['hips', 'spine', 'chest', 'neck', 'head']);
    for (const style of ['smooth', 'segmented'] as const) {
      const mesh = body(style);
      const geom = skinGeometryOf(mesh, skeleton.height);
      for (const method of ['auto-lowpoly', 'heat'] as const) {
        const { skin } = bindSkin(geom, skeleton, { ...DEFAULT_ARGS, method }, null);
        noHelperWeight(skin, skeleton);
        // forearm: between the elbow (0.475) and the wrist (0.7)
        const forearm = [...Array(skin.points).keys()].filter((v) => {
          const x = Math.abs(geom.positions[3 * v] as number);
          return x > 0.5 && x < 0.68 && (geom.positions[3 * v + 1] as number) > 1.1;
        });
        expect(forearm.length).toBeGreaterThan(0);
        expect(forearm.filter((v) => spine.has(keysOf(skin, v)[0] as string))).toEqual([]);
        if (style !== 'segmented' || method !== 'auto-lowpoly') continue;
        const islands = skinIslands(geom);
        let limbs = 0;
        for (let i = 0; i < islands.count; i++) {
          const pts = Array.from(islands.points.subarray(islands.start[i] as number, islands.start[i + 1] as number));
          const sets = new Set(pts.map((v) => keysOf(skin, v).join('+')));
          const only = [...sets][0] as string;
          if (!/UpperArm|LowerArm|UpperLeg|LowerLeg/.test(only)) continue;
          limbs++;
          expect(sets.size).toBe(1);
          expect(only.includes('+')).toBe(false);
        }
        expect(limbs).toBe(8);
      }
    }
  });

  it('the Cube Lad: limb, torso, pelvis, neck and head boxes single-influence; forearms on the lower arm; no root', () => {
    const truth = cubeLadTruth();
    const lad = cubeLad(truth);
    const skeleton = skeletonOf(cubeLadRows(truth));
    const { skin } = bindSkin(skinGeometryOf(lad.mesh, truth.height), skeleton, DEFAULT_ARGS, null);
    noHelperWeight(skin, skeleton);
    const expected: Readonly<Record<string, string>> = {
      'upperArm.R': 'rightUpperArm',
      'upperArm.L': 'leftUpperArm',
      'forearm.R': 'rightLowerArm',
      'forearm.L': 'leftLowerArm',
      'thigh.R': 'rightUpperLeg',
      'thigh.L': 'leftUpperLeg',
      'shin.R': 'rightLowerLeg',
      'shin.L': 'leftLowerLeg',
    };
    const single = new Set(['torso', 'pelvis', 'neck', 'head', ...Object.keys(expected)]);
    const points = [...Array(skin.points).keys()];
    const blended = points.filter((v) => single.has(lad.boxOf[v] as string) && keysOf(skin, v).length !== 1);
    expect(blended).toEqual([]);
    const limb = points.filter((v) => expected[lad.boxOf[v] as string] !== undefined);
    expect(limb.length).toBe(64);
    expect(limb.map((v) => keysOf(skin, v))).toEqual(limb.map((v) => [expected[lad.boxOf[v] as string]]));
  });
});
