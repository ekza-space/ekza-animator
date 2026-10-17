import type { Vec3 } from '@ekza-animator/anim-core';
import { type ChannelValues, type ControlId, controlId } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyPoseClipboard,
  autoRig,
  compileRig,
  makePoseClipboard,
  mirrorPose,
  type RigProgram,
  type SkeletonDesc,
  writeControlChannels,
} from '../src';
import { genericSkeleton, IDS, maxAbsDiff, quatAngleBetween, richHumanoid, syntheticSkeleton, vecAt } from './helpers';

const id = (key: string): ControlId => controlId(IDS.rig, key);

function rig(skeleton: SkeletonDesc): RigProgram {
  return compileRig(autoRig(skeleton, IDS), skeleton);
}

const angle = fc.double({ min: -2, max: 2, noNaN: true });
const offset = fc.double({ min: -0.2, max: 0.2, noNaN: true });

/** Random keyable channel values for every control. */
function poseArbitrary(program: RigProgram): fc.Arbitrary<Map<ControlId, ChannelValues>> {
  return fc
    .array(fc.tuple(angle, angle, angle, offset, offset, offset), {
      minLength: program.controls.length,
      maxLength: program.controls.length,
    })
    .map((rows) => {
      const values = new Map<ControlId, ChannelValues>();
      program.controls.forEach((control, i) => {
        const [rx, ry, rz, tx, ty, tz] = rows[i] as [number, number, number, number, number, number];
        const v: ChannelValues = {};
        if (control.keyable.r[0]) v.rx = rx;
        if (control.keyable.r[1]) v.ry = ry;
        if (control.keyable.r[2]) v.rz = rz;
        if (control.keyable.t[0]) v.tx = tx;
        if (control.keyable.t[1]) v.ty = ty;
        if (control.keyable.t[2]) v.tz = tz;
        values.set(control.id, v);
      });
      return values;
    });
}

function merged(base: ReadonlyMap<ControlId, ChannelValues>, update: ReadonlyMap<ControlId, ChannelValues>) {
  const out = new Map(base);
  for (const [control, values] of update) out.set(control, { ...out.get(control), ...values });
  return out;
}

function evaluate(program: RigProgram, values: ReadonlyMap<ControlId, ChannelValues>): Float64Array {
  const ch = program.allocChannels();
  for (const [control, v] of values) writeControlChannels(program, ch, control, v);
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  return pose.boneWorld;
}

describe('mirrorPose (MVP-SPEC §4.11.20)', () => {
  const skeleton = richHumanoid();
  const program = rig(skeleton);

  it('flips world-aligned pairs with (rx, −ry, −rz; −tx, ty, tz) and mirrors centre controls in place', () => {
    const values = new Map<ControlId, ChannelValues>([
      [id('fk.upperArm.L'), { rx: 0.1, ry: 0.2, rz: 0.3 }],
      [id('fk.upperArm.R'), { rx: -0.4, ry: 0.5, rz: 0.6 }],
      [id('cog'), { tx: 0.1, ty: 0.2, tz: 0.3, rx: 0.4, ry: 0.5, rz: 0.6 }],
    ]);
    const { values: out, warnings } = mirrorPose(program, values, 'flip', null);
    expect(out.get(id('fk.upperArm.R'))).toEqual({ rx: 0.1, ry: -0.2, rz: -0.3 });
    expect(out.get(id('fk.upperArm.L'))).toEqual({ rx: -0.4, ry: -0.5, rz: -0.6 });
    expect(out.get(id('cog'))).toEqual({ tx: -0.1, ty: 0.2, tz: 0.3, rx: 0.4, ry: -0.5, rz: -0.6 });
    // Controls without values mirror their defaults.
    expect(out.get(id('fk.head'))).toEqual({ rx: 0, ry: 0, rz: 0 });
    expect(warnings).toEqual([]);
  });

  it('is an involution: mirror(mirror(P)) = P (property, humanoid and generic rigs)', () => {
    for (const p of [program, rig(genericSkeleton())]) {
      fc.assert(
        fc.property(poseArbitrary(p), (pose) => {
          const once = merged(pose, mirrorPose(p, pose, 'flip', null).values);
          const twice = merged(once, mirrorPose(p, once, 'flip', null).values);
          for (const [control, values] of pose) {
            const back = twice.get(control) ?? {};
            for (const [channel, value] of Object.entries(values)) {
              expect(Math.abs((back[channel as 'rx'] as number) - (value as number))).toBeLessThan(1e-9);
            }
          }
        }),
        { numRuns: 20, seed: 9 },
      );
    }
  });

  it('produces the geometric mirror image of the pose (bone positions reflected in x)', () => {
    fc.assert(
      fc.property(poseArbitrary(program), (pose) => {
        // Pair-complete full flip of a symmetric rig mirrors every bone position.
        const flipped = merged(pose, mirrorPose(program, pose, 'flip', null).values);
        const before = evaluate(program, pose);
        const after = evaluate(program, flipped);
        const nodes = skeleton.nodes;
        nodes.forEach((node, i) => {
          if (node.name.includes('ponytail')) return; // spring joints follow the head without a control
          const counterpart = mirrorNode(skeleton, i);
          const p = vecAt(before, i * 16 + 12);
          const q = vecAt(after, counterpart * 16 + 12);
          expect(maxAbsDiff([-p[0], p[1], p[2]], q)).toBeLessThan(1e-9);
        });
      }),
      { numRuns: 10, seed: 2 },
    );
  });

  it('expands the scope to mirror pairs: R_after = mirror(L_before), L_after = mirror(R_before)', () => {
    const values = new Map<ControlId, ChannelValues>([
      [id('fk.upperArm.L'), { rx: 0.3, ry: -0.2, rz: 0.9 }],
      [id('fk.upperArm.R'), { rx: 0.1, ry: 0.4, rz: -0.2 }],
      [id('fk.head'), { rx: 0.5, ry: 0.5, rz: 0.5 }],
    ]);
    const { values: out } = mirrorPose(program, values, 'flip', new Set([id('fk.upperArm.L')]));
    expect([...out.keys()].sort()).toEqual([id('fk.upperArm.L'), id('fk.upperArm.R')].sort());
    expect(out.get(id('fk.upperArm.R'))).toEqual({ rx: 0.3, ry: 0.2, rz: -0.9 });
    expect(out.get(id('fk.upperArm.L'))).toEqual({ rx: 0.1, ry: -0.4, rz: 0.2 });
  });

  it('copies one side onto the other with leftToRight / rightToLeft', () => {
    const values = new Map<ControlId, ChannelValues>([
      [id('fk.hand.L'), { rx: 0.3, ry: -0.2, rz: 0.9 }],
      [id('fk.hand.R'), { rx: 0.1, ry: 0.4, rz: -0.2 }],
      [id('cog'), { ry: 0.7 }],
    ]);
    const ltr = mirrorPose(program, values, 'leftToRight', null).values;
    expect(ltr.get(id('fk.hand.R'))).toEqual({ rx: 0.3, ry: 0.2, rz: -0.9 });
    expect(ltr.has(id('fk.hand.L'))).toBe(false);
    expect(ltr.has(id('cog'))).toBe(false);
    const rtl = mirrorPose(program, values, 'rightToLeft', new Set([id('fk.hand.R')])).values;
    expect([...rtl.keys()]).toEqual([id('fk.hand.L')]);
    expect(rtl.get(id('fk.hand.L'))).toEqual({ rx: 0.1, ry: -0.4, rz: 0.2 });
  });

  it('leaves unpaired sided controls unchanged with a warning (Polybot-like right toes only)', () => {
    const p = rig(richHumanoid({ leftToes: false }));
    const values = new Map<ControlId, ChannelValues>([[id('fk.toes.R'), { rx: 0.4 }]]);
    const { values: out, warnings } = mirrorPose(p, values, 'flip', null);
    expect(out.has(id('fk.toes.R'))).toBe(false);
    expect(warnings).toEqual(['R Toes has no mirror counterpart and was left unchanged']);
  });
});

describe('pose clipboard (research 07 §17)', () => {
  const skeleton = richHumanoid();
  const program = rig(skeleton);
  const def = autoRig(skeleton, IDS);
  const values = new Map<ControlId, ChannelValues>([
    [id('fk.upperArm.L'), { rx: 0.3, ry: -0.2, rz: 0.9 }],
    [id('cog'), { tx: 0.1, ty: -0.05, ry: 0.4 }],
    [id('fk.toes.R'), { rx: 0.2 }],
  ]);

  it('round-trips local pastes by template key', () => {
    const clip = makePoseClipboard(program, def.rig, values);
    expect(clip.kind).toBe('ekza.pose');
    expect(clip.version).toBe(1);
    expect(clip.rig).toEqual({ id: IDS.rig, fingerprint: skeleton.fingerprint, generator: 'ekza-autorig-humanoid' });
    expect(clip.controls['fk.upperArm.L']).toEqual({ values: { rx: 0.3, ry: -0.2, rz: 0.9 }, order: 'yxz' });
    const json = JSON.parse(JSON.stringify(clip)) as typeof clip;
    const pasted = applyPoseClipboard(json, program, 'local');
    expect(pasted.get(id('fk.upperArm.L'))).toEqual({ rx: 0.3, ry: -0.2, rz: 0.9 });
    expect(pasted.get(id('cog'))).toEqual({ tx: 0.1, ty: -0.05, ry: 0.4 });
  });

  it('pastes mirrored onto the counterparts (same as mirrorPose)', () => {
    const clip = makePoseClipboard(program, def.rig, values);
    const pasted = applyPoseClipboard(clip, program, 'mirrored');
    expect(pasted.get(id('fk.upperArm.R'))).toEqual({ rx: 0.3, ry: 0.2, rz: -0.9 });
    expect(pasted.get(id('fk.toes.L'))).toEqual({ rx: 0.2, ry: 0, rz: 0 });
    expect(pasted.get(id('cog'))).toEqual({ tx: -0.1, ty: -0.05, tz: 0, rx: 0, ry: -0.4, rz: 0 });
  });

  it('pastes across humanoid characters and converts differing rotate orders', () => {
    const synthetic = syntheticSkeleton();
    const other = compileRig(
      autoRig(synthetic, { character: IDS.character, rig: 'rig_OtherRigRecord001' as never }),
      synthetic,
    );
    const clip = makePoseClipboard(program, def.rig, values);
    const pasted = applyPoseClipboard(clip, other, 'local');
    expect(pasted.get(controlId('rig_OtherRigRecord001' as never, 'fk.upperArm.L'))).toEqual({
      rx: 0.3,
      ry: -0.2,
      rz: 0.9,
    });
    // A clipboard written in another order is converted to the same rotation.
    const foreign = {
      ...clip,
      controls: { 'fk.head': { values: { rx: 0.3, ry: 0.2, rz: -0.1 }, order: 'xyz' as const } },
    };
    const converted = applyPoseClipboard(foreign, program, 'local').get(id('fk.head')) as Required<
      Pick<ChannelValues, 'rx' | 'ry' | 'rz'>
    >;
    const a = rotationOf([0.3, 0.2, -0.1], 'xyz');
    const b = rotationOf([converted.rx, converted.ry, converted.rz], 'zxy');
    expect(quatAngleBetween(a as never, b as never)).toBeLessThan(1e-12);
  });

  it('ignores malformed payloads and unknown controls', () => {
    expect(applyPoseClipboard({ kind: 'nope' } as never, program, 'local').size).toBe(0);
    const clip = makePoseClipboard(program, def.rig, values);
    const extra = { ...clip, controls: { ...clip.controls, 'fk.tail': { values: { rx: 1 }, order: 'xyz' as const } } };
    expect(applyPoseClipboard(extra, program, 'local').size).toBe(3);
  });
});

function mirrorNode(skeleton: SkeletonDesc, node: number): number {
  const name = skeleton.nodes[node]?.name ?? '';
  const swapped = name.startsWith('left')
    ? `right${name.slice(4)}`
    : name.startsWith('right')
      ? `left${name.slice(5)}`
      : name.endsWith('_L')
        ? `${name.slice(0, -2)}_R`
        : name.endsWith('_R')
          ? `${name.slice(0, -2)}_L`
          : name;
  return skeleton.nodes.findIndex((n) => n.name === swapped);
}

function rotationOf(e: Vec3, order: 'xyz' | 'zxy'): number[] {
  const q = (axis: 0 | 1 | 2, a: number): number[] => {
    const out = [0, 0, 0, Math.cos(a / 2)];
    out[axis] = Math.sin(a / 2);
    return out;
  };
  const mul = (a: number[], b: number[]): number[] => [
    (a[3] as number) * (b[0] as number) +
      (a[0] as number) * (b[3] as number) +
      (a[1] as number) * (b[2] as number) -
      (a[2] as number) * (b[1] as number),
    (a[3] as number) * (b[1] as number) -
      (a[0] as number) * (b[2] as number) +
      (a[1] as number) * (b[3] as number) +
      (a[2] as number) * (b[0] as number),
    (a[3] as number) * (b[2] as number) +
      (a[0] as number) * (b[1] as number) -
      (a[1] as number) * (b[0] as number) +
      (a[2] as number) * (b[3] as number),
    (a[3] as number) * (b[3] as number) -
      (a[0] as number) * (b[0] as number) -
      (a[1] as number) * (b[1] as number) -
      (a[2] as number) * (b[2] as number),
  ];
  const axes: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] = order === 'xyz' ? [0, 1, 2] : [2, 0, 1];
  // DCC order: the first letter is applied first.
  return mul(q(axes[2], e[axes[2]]), mul(q(axes[1], e[axes[1]]), q(axes[0], e[axes[0]])));
}
