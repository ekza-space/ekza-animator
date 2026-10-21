// A1 (M2A-SPEC §5.8, §5.1 rule 4): the pose clipboard carries the IK controls' attribute values except the
// `keyAll: false` ones (ikFk, soft), locally and mirrored (AttrDef.mirror: twists negate, roll and bank copy).
import type { ChannelValues, ControlId } from '@ekza-studio/doc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPoseClipboard, makePoseClipboard, registerBuiltinRigOps } from '../src';
import { richHumanoid } from './helpers';
import { DEG, id, ikDef, ikRig } from './limb-helpers';

let dispose: () => void = () => undefined;
beforeAll(() => {
  dispose = registerBuiltinRigOps();
});
afterAll(() => dispose());

describe('pose clipboard with limb attributes (§5.8)', () => {
  const values = new Map<ControlId, ChannelValues>([
    [
      id('ik.leg.L'),
      {
        tx: 0.05,
        ty: 0.1,
        rx: 0.2,
        '@roll': 20 * DEG,
        '@bank': -5 * DEG,
        '@twist': 0.3,
        '@heelTwist': 0.1,
        '@ikFk': 0.25,
        '@soft': 0.1,
      },
    ],
    [id('ik.arm.R'), { tz: 0.04, '@twist': -0.2, '@ikFk': 1 }],
  ]);

  it('copies the pose attributes and leaves ikFk and soft out', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const clip = makePoseClipboard(program, ikDef(skeleton).rig, values);
    expect(clip.controls['ik.leg.L']?.values).toEqual({
      tx: 0.05,
      ty: 0.1,
      rx: 0.2,
      '@roll': 20 * DEG,
      '@bank': -5 * DEG,
      '@twist': 0.3,
      '@heelTwist': 0.1,
    });
    expect(clip.controls['ik.arm.R']?.values).toEqual({ tz: 0.04, '@twist': -0.2 });
    // A JSON round trip (the system clipboard) keeps them.
    const json = JSON.parse(JSON.stringify(clip)) as typeof clip;
    const local = applyPoseClipboard(json, program, 'local');
    expect(local.get(id('ik.leg.L'))).toMatchObject({ '@roll': 20 * DEG, '@bank': -5 * DEG, '@twist': 0.3 });
    expect(Object.keys(local.get(id('ik.leg.L')) ?? {})).not.toContain('@ikFk');
    expect(Object.keys(local.get(id('ik.leg.L')) ?? {})).not.toContain('@soft');
  });

  it('pastes mirrored attributes by AttrDef.mirror onto the counterpart', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const clip = makePoseClipboard(program, ikDef(skeleton).rig, values);
    const mirrored = applyPoseClipboard(clip, program, 'mirrored');
    const right = mirrored.get(id('ik.leg.R'));
    expect(right).toMatchObject({ tx: -0.05, ty: 0.1, rx: 0.2, '@roll': 20 * DEG, '@bank': -5 * DEG });
    expect(right?.['@twist']).toBeCloseTo(-0.3, 15);
    expect(right?.['@heelTwist']).toBeCloseTo(-0.1, 15);
    expect(Object.keys(right ?? {})).not.toContain('@ikFk');
    expect(Object.keys(right ?? {})).not.toContain('@soft');
    expect(mirrored.get(id('ik.arm.L'))?.['@twist']).toBeCloseTo(0.2, 15);
  });
});
