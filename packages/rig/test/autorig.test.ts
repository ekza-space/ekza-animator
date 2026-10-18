import { EkzaError, quatRotateVec3 } from '@ekza-animator/anim-core';
import { type ControlRecord, controlId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { AUTORIG_VERSION, autoRig, compileRig, type RigDefinition, type SkeletonDesc } from '../src';
import { genericSkeleton, IDS, richHumanoid, syntheticSkeleton } from './helpers';

function byKey(def: RigDefinition): Map<string, ControlRecord> {
  return new Map(def.controls.map((control) => [control.key, control]));
}

function parentKey(def: RigDefinition, key: string): string | null {
  const controls = byKey(def);
  const parent = controls.get(key)?.parent ?? null;
  return parent === null ? null : (def.controls.find((c) => c.id === parent)?.key ?? 'missing');
}

describe('autoRig: humanoid template (MVP-SPEC §4.11.15)', () => {
  const skeleton = richHumanoid();
  const def = autoRig(skeleton, IDS);
  const controls = byKey(def);

  it('writes the rig record with the humanoid generator and the skeleton identity', () => {
    expect(def.rig).toEqual({
      id: IDS.rig,
      character: IDS.character,
      format: 'ekza.rig',
      version: 1,
      generator: { name: 'ekza-autorig-humanoid', version: AUTORIG_VERSION },
      skeleton: { format: 'vrm1', fingerprint: skeleton.fingerprint, facing: skeleton.facing },
      deleted: null,
    });
    expect(AUTORIG_VERSION).toBe('0.2.0');
    expect(def.constraints).toEqual([]);
    expect(def.solvers).toEqual([]);
  });

  it('builds root → cog → fk.hips / fk.spine with legs under fk.hips', () => {
    expect(parentKey(def, 'root')).toBeNull();
    expect(parentKey(def, 'cog')).toBe('root');
    expect(parentKey(def, 'fk.hips')).toBe('cog');
    expect(parentKey(def, 'fk.spine')).toBe('cog');
    expect(parentKey(def, 'fk.chest')).toBe('fk.spine');
    expect(parentKey(def, 'fk.upperChest')).toBe('fk.chest');
    expect(parentKey(def, 'fk.neck')).toBe('fk.upperChest');
    expect(parentKey(def, 'fk.head')).toBe('fk.neck');
    expect(parentKey(def, 'fk.jaw')).toBe('fk.head');
    expect(parentKey(def, 'fk.shoulder.L')).toBe('fk.upperChest');
    expect(parentKey(def, 'fk.upperArm.R')).toBe('fk.shoulder.R');
    expect(parentKey(def, 'fk.hand.L')).toBe('fk.lowerArm.L');
    expect(parentKey(def, 'fk.thumbMetacarpal.L')).toBe('fk.hand.L');
    expect(parentKey(def, 'fk.thumbProximal.L')).toBe('fk.thumbMetacarpal.L');
    expect(parentKey(def, 'fk.littleDistal.R')).toBe('fk.littleIntermediate.R');
    expect(parentKey(def, 'fk.upperLeg.L')).toBe('fk.hips');
    expect(parentKey(def, 'fk.toes.R')).toBe('fk.foot.R');
  });

  it('uses deterministic ids, display names, sides, groups and sibling order keys', () => {
    for (const control of def.controls) expect(control.id).toBe(controlId(IDS.rig, control.key));
    expect(controls.get('root')?.name).toBe('Root');
    expect(controls.get('cog')?.name).toBe('COG');
    expect(controls.get('fk.hips')?.name).toBe('Hips');
    expect(controls.get('fk.upperArm.L')?.name).toBe('L Upper Arm');
    expect(controls.get('fk.upperChest')?.name).toBe('Upper Chest');
    expect(controls.get('fk.thumbMetacarpal.R')?.name).toBe('R Thumb Metacarpal');
    expect(controls.get('fk.upperArm.L')?.side).toBe('L');
    expect(controls.get('fk.foot.R')?.side).toBe('R');
    expect(controls.get('fk.neck')?.side).toBe('C');
    expect(controls.get('fk.indexDistal.L')?.group).toBe('fingers');
    expect(controls.get('fk.jaw')?.group).toBe('face');
    expect(controls.get('fk.spine')?.group).toBe('body');
    // Siblings are ordered as generated; keys sort as strings.
    const siblings = def.controls.filter((c) => c.parent === controlId(IDS.rig, 'cog'));
    expect(siblings.map((c) => [c.key, c.order])).toEqual([
      ['fk.hips', 'a0'],
      ['fk.spine', 'a1'],
    ]);
  });

  it('binds FK controls with rotate, the pelvis with translateRotate and keeps root/cog pure spaces', () => {
    expect(controls.get('root')?.drives).toBeNull();
    expect(controls.get('cog')?.drives).toBeNull();
    expect(controls.get('fk.hips')?.drives).toEqual({ bone: { humanoid: 'hips' }, mode: 'translateRotate' });
    expect(controls.get('fk.lowerArm.L')?.drives).toEqual({ bone: { humanoid: 'leftLowerArm' }, mode: 'rotate' });
    const tr = { t: [true, true, true], r: [true, true, true], s: [false, false, false] };
    const r = { t: [false, false, false], r: [true, true, true], s: [false, false, false] };
    expect(controls.get('root')?.keyable).toEqual(tr);
    expect(controls.get('cog')?.keyable).toEqual(tr);
    expect(controls.get('fk.hips')?.keyable).toEqual(r);
    expect(controls.get('fk.middleProximal.L')?.keyable).toEqual(r);
  });

  it('places controls world-aligned at the bones (root on the floor, cog at the hips)', () => {
    const hips = skeleton.humanoid?.hips as number;
    expect(controls.get('cog')?.restWorld.t).toEqual([0, 0.95, 0]);
    expect(controls.get('root')?.restWorld.t).toEqual([0, 0, 0]);
    expect(controls.get('fk.hips')?.restWorld.t[1]).toBeCloseTo(0.95, 12);
    for (const control of def.controls.filter((c) => c.group !== 'secondary')) {
      expect(control.restWorld.q).toEqual([0, 0, 0, 1]);
      expect(control.restWorld.s).toEqual([1, 1, 1]);
    }
    expect(hips).toBeGreaterThan(0);
  });

  it('does not rig eyes or node-constraint destinations; pairs left/right controls', () => {
    expect(controls.has('fk.eye.L')).toBe(false);
    expect(controls.has('fk.eye.R')).toBe(false);
    expect(controls.get('fk.upperArm.L')?.mirror).toBe(controlId(IDS.rig, 'fk.upperArm.R'));
    expect(controls.get('fk.toes.R')?.mirror).toBe(controlId(IDS.rig, 'fk.toes.L'));
    expect(controls.get('fk.spine')?.mirror).toBeNull();

    const constrained: SkeletonDesc = { ...skeleton, constrainedNodes: [skeleton.humanoid?.jaw as number] };
    expect(byKey(autoRig(constrained, IDS)).has('fk.jaw')).toBe(false);
  });

  it('collapses missing optional bones to the nearest present ancestor and leaves unpaired controls unmirrored', () => {
    const noToes = autoRig(richHumanoid({ leftToes: false }), IDS);
    expect(byKey(noToes).has('fk.toes.L')).toBe(false);
    expect(byKey(noToes).get('fk.toes.R')?.mirror).toBeNull();
    // The synthetic fixture has no thumbs and only index proximals.
    const synthetic = autoRig(syntheticSkeleton(), IDS);
    expect(parentKey(synthetic, 'fk.indexProximal.L')).toBe('fk.hand.L');
    expect(byKey(synthetic).has('fk.thumbMetacarpal.L')).toBe(false);
  });

  it('applies the rotate orders of ADR 0004', () => {
    const expected: Record<string, string> = {
      root: 'zxy',
      cog: 'zxy',
      'fk.hips': 'zxy',
      'fk.chest': 'zxy',
      'fk.neck': 'zxy',
      'fk.shoulder.L': 'yxz',
      'fk.upperArm.L': 'yxz',
      'fk.lowerArm.R': 'xzy',
      'fk.hand.R': 'xyz',
      'fk.thumbDistal.L': 'xyz',
      'fk.upperLeg.R': 'yzx',
      'fk.lowerLeg.L': 'yzx',
      'fk.foot.L': 'yzx',
      'fk.toes.L': 'yzx',
    };
    for (const [key, order] of Object.entries(expected)) {
      expect({ key, order: controls.get(key)?.rotateOrder }).toEqual({ key, order });
    }
  });

  it('sizes shapes from bone radii with per-group clamps and offsets', () => {
    const H = skeleton.height;
    const shape = (key: string): ControlRecord['shape'] => controls.get(key)?.shape as ControlRecord['shape'];
    expect(shape('root')).toMatchObject({ kind: 'custom', size: 0.35 * H, color: 'side', lineWidth: null });
    expect(shape('cog')).toMatchObject({ kind: 'star', size: 0.18 * H, custom: null });
    // Root: arrow4 + circle — a unit circle and four closed arrows reaching 1.5 units out along ±X / ±Y.
    const root = shape('root').custom;
    expect(root?.splines).toHaveLength(5);
    const ring = root?.splines[0]?.points ?? [];
    expect(ring).toHaveLength(48);
    for (const p of ring) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 10);
    const tips = (root?.splines.slice(1) ?? []).map((arrow) =>
      arrow.points.reduce((far, p) => (Math.hypot(...p) > Math.hypot(...far) ? p : far)),
    );
    expect(tips.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])).toEqual([
      [1.5, 0],
      [0, 1.5],
      [-1.5, 0],
      [0, -1.5],
    ]);
    // Floor shapes: normal +Z rotated onto +Y.
    for (const key of ['root', 'cog']) expect(quatRotateVec3(shape(key).offset.q, [0, 0, 1])[1]).toBeCloseTo(1, 12);
    // Torso: radius 0.14 inside [0.05, 0.25]·H; circle centred half way up the bone (spine → chest is 0.12 m).
    expect(shape('fk.spine')).toMatchObject({ kind: 'circle', size: 0.13 });
    expect(shape('fk.spine').offset.t[1]).toBeCloseTo(0.06, 12);
    // Shoulder: half circle; arms/legs: circle 0.25·ℓ down the bone; hands/feet: 0.4·ℓ.
    expect(shape('fk.shoulder.L').kind).toBe('halfCircle');
    expect(shape('fk.upperArm.L').offset.t[0]).toBeCloseTo(0.25 * 0.26, 12);
    expect(shape('fk.upperArm.R').offset.t[0]).toBeCloseTo(-0.25 * 0.26, 12);
    // Hair radius unknown → generic fallback max(0.15·ℓ, 0.02·H), clamped at ≥ 0.01·H.
    expect(controls.get('sec.hair_L')?.shape.size).toBeCloseTo(0.02 * H, 12);
    // Every control respects its group minimum.
    const minimum: Record<string, number> = {
      torso: 0.05,
      shoulder: 0.025,
      limb: 0.025,
      extremity: 0.03,
      finger: 0.006,
    };
    const groupOf = (key: string): string | null => {
      if (/^fk\.(hips|spine|chest|upperChest|neck|head)$/.test(key)) return 'torso';
      if (key.startsWith('fk.shoulder.')) return 'shoulder';
      if (/^fk\.(upperArm|lowerArm|upperLeg|lowerLeg)\./.test(key)) return 'limb';
      if (/^fk\.(hand|foot|toes)\./.test(key)) return 'extremity';
      if (/^fk\.(thumb|index|middle|ring|little)/.test(key)) return 'finger';
      return null;
    };
    const sized = def.controls.flatMap((control) => {
      const group = groupOf(control.key);
      return group === null
        ? []
        : [{ key: control.key, size: control.shape.size, min: (minimum[group] as number) * H }];
    });
    expect(sized.length).toBeGreaterThan(0);
    for (const { size, min } of sized) expect(size).toBeGreaterThanOrEqual(min - 1e-12);
  });

  it('draws fingers as lollipops along the dorsal normal with per-joint stick lengths', () => {
    const H = skeleton.height;
    const sticks = ['fk.indexProximal.L', 'fk.indexIntermediate.L', 'fk.indexDistal.L'].map((key) => {
      const shape = controls.get(key)?.shape as ControlRecord['shape'];
      expect(shape.kind).toBe('custom');
      // Bone radius 0.008 m is below the finger minimum 0.006·H.
      expect(shape.size).toBeCloseTo(0.006 * H, 12);
      const stick = shape.custom?.splines[0];
      const head = shape.custom?.splines[1];
      expect(stick?.closed).toBe(false);
      expect(head?.closed).toBe(true);
      // Local +Y of the shape is the dorsal normal (+Y for palms-down T-pose hands).
      const up = quatRotateVec3(shape.offset.q, [0, 1, 0]);
      expect(up[1]).toBeGreaterThan(0.99);
      // The head faces along the finger (+X for a left T-pose hand): its plane normal, local ±Z, is the finger axis.
      const normal = quatRotateVec3(shape.offset.q, [0, 0, 1]);
      expect(Math.abs(normal[0])).toBeGreaterThan(0.99);
      return ((stick?.points[1]?.[1] as number) * shape.size) / H;
    });
    expect(sticks[0]).toBeCloseTo(0.02, 9);
    expect(sticks[1]).toBeCloseTo(0.028, 9);
    expect(sticks[2]).toBeCloseTo(0.036, 9);
  });
});

describe('autoRig: secondary controls (MVP-SPEC §4.11.9)', () => {
  const skeleton = richHumanoid();
  const def = autoRig(skeleton, IDS);
  const controls = byKey(def);

  it('adds hidden rotate-only controls for non-humanoid skin joints except springs', () => {
    const secondary = def.controls.filter((c) => c.group === 'secondary').map((c) => c.key);
    expect(secondary.sort()).toEqual(
      ['sec.hair_L', 'sec.hair_R', 'sec.leftForeArmTwist', 'sec.rightForeArmTwist', 'sec.skirt_front'].sort(),
    );
    const twist = controls.get('sec.leftForeArmTwist') as ControlRecord;
    expect(twist.hiddenByDefault).toBe(true);
    expect(twist.keyable).toEqual({ t: [false, false, false], r: [true, true, true], s: [false, false, false] });
    expect(twist.drives).toEqual({ bone: { name: 'leftForeArmTwist', parentName: 'leftLowerArm' }, mode: 'rotate' });
    // Parent: the control driving the nearest driven ancestor bone.
    expect(parentKey(def, 'sec.leftForeArmTwist')).toBe('fk.lowerArm.L');
    expect(parentKey(def, 'sec.hair_L')).toBe('fk.head');
    expect(parentKey(def, 'sec.skirt_front')).toBe('fk.hips');
    // Humanoid children of a secondary joint keep their FK parents.
    expect(parentKey(def, 'fk.hand.L')).toBe('fk.lowerArm.L');
    // Bone-aligned frames and name-based sides and pairs.
    expect(controls.get('sec.hair_L')?.side).toBe('L');
    expect(controls.get('sec.hair_L')?.mirror).toBe(controlId(IDS.rig, 'sec.hair_R'));
    expect(controls.get('sec.skirt_front')?.side).toBe('C');
  });

  it('can be switched off', () => {
    const none = autoRig(skeleton, IDS, { secondary: false });
    expect(none.controls.some((c) => c.group === 'secondary')).toBe(false);
  });
});

describe('autoRig: generic 1:1 FK rig', () => {
  const skeleton = genericSkeleton();
  const def = autoRig(skeleton, IDS);
  const controls = byKey(def);

  it('creates one bone-aligned full-binding control per joint with fk.<name>[#n] keys', () => {
    expect(def.rig.generator.name).toBe('ekza-autorig-generic');
    expect(def.controls.map((c) => c.key)).toEqual([
      'fk.root',
      'fk.spine',
      'fk.neck',
      'fk.upperarm_l',
      'fk.lowerarm_l',
      'fk.upperarm_r',
      'fk.lowerarm_r',
      'fk.tail',
      'fk.tail#1',
      'fk.acc',
      'fk.acc#1',
    ]);
    const spine = controls.get('fk.spine') as ControlRecord;
    expect(spine.name).toBe('fk.spine');
    expect(spine.drives).toEqual({ bone: { name: 'spine', parentName: 'root' }, mode: 'full' });
    expect(spine.keyable).toEqual({ t: [true, true, true], r: [true, true, true], s: [true, true, true] });
    expect(spine.rotateOrder).toBe('xyz');
    expect(parentKey(def, 'fk.root')).toBeNull();
    expect(parentKey(def, 'fk.tail#1')).toBe('fk.tail');
    expect(controls.get('fk.acc#1')?.drives?.bone).toEqual({ name: 'acc', parentName: 'spine', occurrence: 1 });
    // Sides and pairs from names (`_l` / `_r`).
    expect(controls.get('fk.upperarm_l')?.side).toBe('L');
    expect(controls.get('fk.upperarm_l')?.mirror).toBe(controlId(IDS.rig, 'fk.upperarm_r'));
    expect(controls.get('fk.root')?.side).toBe('C');
    expect(def.controls.every((c) => c.hiddenByDefault === false)).toBe(true);
  });

  it('is chosen automatically without the 15 VRM-required bones and can be forced on humanoids', () => {
    const humanoid = richHumanoid();
    expect(autoRig(humanoid, IDS, { kind: 'generic' }).rig.generator.name).toBe('ekza-autorig-generic');
    const partial: SkeletonDesc = { ...humanoid, humanoid: { hips: humanoid.humanoid?.hips as number } };
    expect(autoRig(partial, IDS).rig.generator.name).toBe('ekza-autorig-generic');
    let error: unknown;
    try {
      autoRig(partial, IDS, { kind: 'humanoid' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EkzaError);
    expect((error as EkzaError).code).toBe('unsupported');
  });

  it('compiles without warnings beyond unpaired sided controls', () => {
    const program = compileRig(def, skeleton);
    expect(program.warnings).toEqual([]);
  });
});

describe('autoRig: determinism', () => {
  it('produces identical definitions for identical skeletons', () => {
    expect(autoRig(richHumanoid(), IDS)).toEqual(autoRig(richHumanoid(), IDS));
    expect(JSON.stringify(autoRig(richHumanoid({ vrm0: true }), IDS))).toBe(
      JSON.stringify(autoRig(richHumanoid({ vrm0: true }), IDS)),
    );
  });

  it('gives VRM 0.x and VRM 1.0 skeletons of the same body the same controls', () => {
    const a = autoRig(richHumanoid(), IDS).controls;
    const b = autoRig(richHumanoid({ vrm0: true }), IDS).controls;
    expect(b.map((c) => c.key)).toEqual(a.map((c) => c.key));
    a.forEach((control, i) => {
      const other = b[i] as ControlRecord;
      for (let k = 0; k < 3; k++) expect(other.restWorld.t[k]).toBeCloseTo(control.restWorld.t[k] as number, 12);
    });
  });
});
