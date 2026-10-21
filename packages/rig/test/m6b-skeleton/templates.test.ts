// Skeleton templates (M6B-SPEC §5.2; C2 DoD "template counts and positions"): Lite 17, Core 21, Standard 33 and
// Full 52 humanoid bones plus the helper `root`; the §5.2 table at the height (standard and bigHead), the finger
// table, the rest flexion, the hierarchy (shoulders under the topmost chest bone), the record identities (ids
// `<skeleton>:<bone>`, keys, sides, mirror links both ways, `root` a helper) and the in-place refit.
import type { HumanBoneName, JointRecord, SkeletonId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLEXION,
  HUMAN_BONE_PARENT,
  PRESET_BONES,
  placeTemplate,
  refitTemplateJoints,
  SKELETON_PRESETS,
  skeletonTemplate,
  type TemplateJoint,
  templateJointRecords,
  VRM_REQUIRED_BONES,
} from '../../src';

const H = 1.7;
const make = (preset: (typeof SKELETON_PRESETS)[number], proportions: 'standard' | 'bigHead' = 'standard') =>
  skeletonTemplate(preset, { height: H, proportions, flexion: DEFAULT_FLEXION });
const at = (t: readonly TemplateJoint[], key: string) => {
  const joint = t.find((j) => j.key === key);
  if (joint === undefined) throw new Error(key);
  return joint;
};
const tailOf = (j: TemplateJoint): readonly number[] => {
  if (j.tail === null) throw new Error(`${j.key} has no tail`);
  return j.tail;
};
/** The largest coordinate difference of two points. */
const gap = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...[0, 1, 2].map((i) => Math.abs((a[i] as number) - (b[i] as number))));

describe('presets', () => {
  it('17 / 21 / 33 / 52 humanoid bones plus root; every preset holds the 15 VRM-required bones', () => {
    const counts = SKELETON_PRESETS.map((preset) => make(preset).length - 1);
    expect(counts).toEqual([17, 21, 33, 52]);
    for (const preset of SKELETON_PRESETS) {
      const keys = make(preset).map((j) => j.key);
      expect(keys[0]).toBe('root');
      expect(VRM_REQUIRED_BONES.filter((bone) => !keys.includes(bone))).toEqual([]);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(PRESET_BONES.lite17).toContain('chest');
    expect(PRESET_BONES.lite17).toContain('neck');
    expect(PRESET_BONES.core21).toContain('leftShoulder');
    expect(PRESET_BONES.core21).toContain('rightToes');
    expect(PRESET_BONES.standard33).toContain('leftThumbMetacarpal');
    expect(PRESET_BONES.standard33).toContain('rightMiddleDistal');
    expect(PRESET_BONES.standard33).not.toContain('leftIndexProximal');
    expect(PRESET_BONES.full52).toContain('upperChest');
    expect(PRESET_BONES.full52).toContain('leftLittleDistal');
  });

  it('hierarchy: root → hips → the VRM parent map resolved to the present bones; parents come first', () => {
    for (const preset of SKELETON_PRESETS) {
      const t = make(preset);
      const keys = new Set(t.map((j) => j.key));
      const seen = new Set<string>();
      const wrong: string[] = [];
      for (const joint of t) {
        if (joint.parent !== null && !seen.has(joint.parent)) wrong.push(`${preset} ${joint.key}: parent after child`);
        seen.add(joint.key);
        let expected: string | null = joint.key === 'root' ? null : 'root';
        if (joint.key !== 'root' && joint.key !== 'hips') {
          let parent = HUMAN_BONE_PARENT[joint.key as HumanBoneName];
          while (parent !== null && !keys.has(parent)) parent = HUMAN_BONE_PARENT[parent];
          expected = parent;
        }
        if (joint.parent !== expected) wrong.push(`${preset} ${joint.key}: ${joint.parent} ≠ ${expected}`);
      }
      expect(wrong).toEqual([]);
    }
    expect(at(make('core21'), 'leftShoulder').parent).toBe('chest');
    expect(at(make('full52'), 'leftShoulder').parent).toBe('upperChest');
    expect(at(make('full52'), 'neck').parent).toBe('upperChest');
    expect(at(make('lite17'), 'leftUpperArm').parent).toBe('chest');
  });

  it('positions: the §5.2 standard column × H, left = +X, right mirrored, bigHead column', () => {
    const t = make('full52');
    expect(gap(at(t, 'root').position, [0, 0, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'hips').position, [0, 0.5 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'spine').position, [0, 0.59 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'chest').position, [0, 0.67 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'upperChest').position, [0, 0.74 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'neck').position, [0, 0.815 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'head').position, [0, 0.845 * H, 0])).toBeLessThan(1e-12);
    expect(gap(tailOf(at(t, 'head')), [0, H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'leftShoulder').position, [0.03 * H, 0.8 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'leftUpperArm').position, [0.09 * H, 0.78 * H, 0])).toBeLessThan(1e-12);
    expect(at(t, 'leftLowerArm').position[0]).toBeCloseTo(0.25 * H, 12);
    expect(gap(at(t, 'leftHand').position, [0.39 * H, 0.78 * H, 0])).toBeLessThan(1e-12);
    expect(gap(tailOf(at(t, 'leftHand')), [0.47 * H, 0.78 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'leftUpperLeg').position, [0.056 * H, 0.49 * H, 0])).toBeLessThan(1e-12);
    expect(at(t, 'leftLowerLeg').position[1]).toBeCloseTo(0.29 * H, 12);
    expect(gap(at(t, 'leftFoot').position, [0.056 * H, 0.048 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(t, 'leftToes').position, [0.056 * H, 0.01 * H, 0.09 * H])).toBeLessThan(1e-12);
    expect(gap(tailOf(at(t, 'leftToes')), [0.056 * H, 0.01 * H, 0.13 * H])).toBeLessThan(1e-12);
    for (const joint of t) {
      if (!joint.key.startsWith('left')) continue;
      const right = at(t, `right${joint.key.slice(4)}`);
      expect(right.position).toEqual([-joint.position[0], joint.position[1], joint.position[2]]);
    }
    const big = make('standard33', 'bigHead');
    expect(gap(at(big, 'hips').position, [0, 0.38 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(big, 'neck').position, [0, 0.6 * H, 0])).toBeLessThan(1e-12);
    expect(gap(at(big, 'leftHand').position, [0.36 * H, 0.585 * H, 0])).toBeLessThan(1e-12);
    expect(gap(tailOf(at(big, 'leftToes')), [0.05 * H, 0.01 * H, 0.1 * H])).toBeLessThan(1e-12);
  });

  it('fingers: the §5.2 table on the hand length h (Middle on the axis, Index/Ring/Little offsets, thumb at 45°)', () => {
    const t = make('full52');
    const p = at(t, 'leftHand').position;
    const h = 0.08 * H;
    expect(gap(at(t, 'leftMiddleProximal').position, [p[0] + 0.55 * h, p[1], p[2]])).toBeLessThan(1e-12);
    expect(gap(at(t, 'leftMiddleIntermediate').position, [p[0] + 0.72 * h, p[1], p[2]])).toBeLessThan(1e-12);
    expect(gap(at(t, 'leftMiddleDistal').position, [p[0] + 0.85 * h, p[1], p[2]])).toBeLessThan(1e-12);
    expect(gap(tailOf(at(t, 'leftMiddleDistal')), [p[0] + 0.95 * h, p[1], p[2]])).toBeLessThan(1e-12);
    expect(gap(at(t, 'leftIndexProximal').position, [p[0] + 0.55 * h, p[1], p[2] + 0.15 * h])).toBeLessThan(1e-12);
    expect(
      gap(at(t, 'leftRingIntermediate').position, [p[0] + (0.55 + 0.17 * 0.95) * h, p[1], p[2] - 0.12 * h]),
    ).toBeLessThan(1e-12);
    expect(
      gap(at(t, 'leftLittleDistal').position, [p[0] + (0.55 + 0.3 * 0.8) * h, p[1], p[2] - 0.24 * h]),
    ).toBeLessThan(1e-12);
    const m: [number, number, number] = [p[0] + 0.15 * h, p[1] - 0.05 * h, p[2] + 0.2 * h];
    expect(gap(at(t, 'leftThumbMetacarpal').position, m)).toBeLessThan(1e-12);
    const c = Math.SQRT1_2;
    expect(gap(at(t, 'leftThumbProximal').position, [m[0] + 0.25 * h * c, m[1], m[2] + 0.25 * h * c])).toBeLessThan(
      1e-12,
    );
    expect(gap(tailOf(at(t, 'leftThumbDistal')), [m[0] + 0.6 * h * c, m[1], m[2] + 0.6 * h * c])).toBeLessThan(1e-12);
  });

  it('rest flexion: elbows bend back and knees forward by θ·a·b/(a + b), a bend of θ on the hinge side', () => {
    for (const theta of [(1 * Math.PI) / 180, DEFAULT_FLEXION, (3 * Math.PI) / 180]) {
      const t = skeletonTemplate('standard33', { height: H, proportions: 'standard', flexion: theta });
      const a = 0.16 * H;
      const b = 0.14 * H;
      expect(at(t, 'leftLowerArm').position[2]).toBeCloseTo((-theta * a * b) / (a + b), 15);
      const la = 0.2 * H;
      const lb = 0.242 * H;
      expect(at(t, 'rightLowerLeg').position[2]).toBeCloseTo((theta * la * lb) / (la + lb), 15);
      // The angle between the segments is θ to first order.
      const A = at(t, 'leftUpperArm').position;
      const B = at(t, 'leftLowerArm').position;
      const C = at(t, 'leftHand').position;
      const u: [number, number, number] = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const v: [number, number, number] = [C[0] - B[0], C[1] - B[1], C[2] - B[2]];
      const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
      expect(Math.abs(Math.acos(cos) - theta)).toBeLessThan(1e-3 * theta);
    }
  });

  it('placeTemplate translates positions and tails; x = 0 stays +0', () => {
    const t = placeTemplate(make('lite17'), [0, 0.25, 0.1]);
    expect(Object.is(at(t, 'hips').position[0], 0)).toBe(true);
    expect(gap(at(t, 'hips').position, [0, 0.5 * H + 0.25, 0.1])).toBeLessThan(1e-12);
    expect(gap(tailOf(at(t, 'head')), [0, H + 0.25, 0.1])).toBeLessThan(1e-12);
  });
});

describe('template records (§5.2 identities)', () => {
  const skeleton = 'skl_test' as SkeletonId;
  const records = templateJointRecords(make('standard33'), skeleton);
  const byKey = new Map(records.map((r) => [r.key, r]));

  it('ids, names, keys, roles, sides, mirror links both ways, identity rests, parents', () => {
    expect(records).toHaveLength(34);
    const root = byKey.get('root') as JointRecord;
    expect(root).toMatchObject({ id: 'skl_test:root', role: 'helper', humanBone: null, side: 'C', parent: null });
    const hand = byKey.get('leftHand') as JointRecord;
    expect(hand).toMatchObject({
      id: 'skl_test:leftHand',
      name: 'leftHand',
      key: 'leftHand',
      humanBone: 'leftHand',
      side: 'L',
      role: 'bone',
      mirror: 'skl_test:rightHand',
      parent: 'skl_test:leftLowerArm',
      restRotation: [0, 0, 0, 1],
    });
    expect(byKey.get('rightHand')?.mirror).toBe('skl_test:leftHand');
    expect(byKey.get('hips')?.parent).toBe('skl_test:root');
    expect(byKey.get('spine')?.mirror).toBeNull();
    const orders = records.map((r) => r.order);
    expect([...orders].sort()).toEqual(orders);
  });

  it('refit moves the joints in place (same ids, names, keys) and upserts only changed ones', () => {
    const moved = placeTemplate(make('standard33'), [0, 0.1, 0]);
    const edit = refitTemplateJoints(records, moved);
    expect(edit.upserts).toHaveLength(34);
    for (const record of edit.upserts) {
      const before = byKey.get(record.key) as JointRecord;
      expect(record.id).toBe(before.id);
      expect(record.name).toBe(before.name);
      expect(record.parent).toBe(before.parent);
      expect(record.restPosition[1]).toBeCloseTo(before.restPosition[1] + 0.1, 12);
    }
    expect(refitTemplateJoints(records, make('standard33')).upserts).toEqual([]);
  });
});
