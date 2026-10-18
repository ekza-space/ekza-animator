// A1 (M2A-SPEC §5.8 influencing curves): the step schedule and the influence key times of tracks written by the ik2
// op include the IK control, pole and attribute curves and the curves moving the upper bone's parent (cog, fk.hips;
// the spine chain for arms). Programs without IK and upgraded rigs without IK keys keep the M1 sets.
import type { Frame } from '@ekza-animator/anim-core';
import type { ChannelId, ClipId, ControlId } from '@ekza-animator/doc';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  autoRig,
  type ClipSampler,
  compileRig,
  computeInfluenceKeyTimes,
  computeStepSchedule,
  type CurveInfo,
  HUMAN_BONE_NAMES,
  limbIkRecords,
  type RigProgram,
  registerBuiltinRigOps,
  type SkeletonDesc,
} from '../src';
import { IDS, richHumanoid } from './helpers';
import { id, ikRig, nodeOf } from './limb-helpers';

let dispose: () => void = () => undefined;
beforeAll(() => {
  dispose = registerBuiltinRigOps();
});
afterAll(() => dispose());

/**
 * A ClipSampler that reports curve facts and, for `value`, the given constant per `control/channel` (the arms of a
 * new IK rig default to ikFk 0, so the tests turn them on with a static `@ikFk` 1 unless they say otherwise).
 */
function infoSampler(
  infos: ReadonlyMap<ControlId, readonly CurveInfo[]>,
  values: ReadonlyMap<string, number> = new Map([
    [`${id('ik.arm.L')}/@ikFk`, 1],
    [`${id('ik.arm.R')}/@ikFk`, 1],
  ]),
): ClipSampler {
  return {
    clip: 'clp_LimbInfluence001' as ClipId,
    sample: () => undefined,
    value: (control, channel) => values.get(`${control}/${channel}`),
    keyTimes: () => [],
    curveInfo: (control) => infos.get(control) ?? [],
    dispose: () => undefined,
  };
}

function info(channel: ChannelId, keyTimes: Frame[], stepped: boolean): CurveInfo {
  return { channel, keyTimes, steppedThroughout: stepped, pre: 'constant', post: 'constant' };
}

const range = { start: 0, end: 40 };

describe('influencing curves of IK limbs (M2A-SPEC §5.8)', () => {
  const skeleton: SkeletonDesc = richHumanoid();
  // Compiled after registerBuiltinRigOps (beforeAll): an unregistered ik2 op would compile as unsupported.
  let program: RigProgram;
  let m1: RigProgram;
  beforeAll(() => {
    program = ikRig(skeleton);
    m1 = compileRig(autoRig(skeleton, IDS), skeleton);
  });
  const upperLeg = nodeOf(skeleton, 'leftUpperLeg');
  const lowerLeg = nodeOf(skeleton, 'leftLowerLeg');
  const foot = nodeOf(skeleton, 'leftFoot');
  const toes = nodeOf(skeleton, 'leftToes');
  const hand = nodeOf(skeleton, 'leftHand');
  const finger = nodeOf(skeleton, 'leftIndexProximal');
  const head = nodeOf(skeleton, 'head');

  it('adds the IK control, pole and attribute keys to every track the op writes', () => {
    const sampler = infoSampler(
      new Map([
        [id('ik.leg.L'), [info('tz', [4, 20], false), info('@roll' as ChannelId, [8], false)]],
        [id('pole.leg.L'), [info('tx', [12], false)]],
        [id('ik.arm.L'), [info('@twist' as ChannelId, [6], false)]],
      ]),
    );
    const times = computeInfluenceKeyTimes(program, sampler, range, 'raw');
    for (const node of [upperLeg, lowerLeg, foot, toes]) {
      for (const path of ['rotation', 'translation', 'scale'] as const) {
        expect([node, path, times.get(`${node}/${path}`)]).toEqual([node, path, [4, 8, 12, 20]]);
      }
    }
    expect(times.get(`${hand}/rotation`)).toEqual([6]);
    // Fingers below the IK hand follow it (follow rule), so the hand's IK curves influence them too.
    expect(times.get(`${finger}/rotation`)).toEqual([6]);
    expect(times.get(`${head}/rotation`)).toEqual([]);
    // The M1 rig has no such controls: nothing influences those tracks.
    const m1Times = computeInfluenceKeyTimes(m1, sampler, range, 'raw');
    expect(m1Times.get(`${foot}/rotation`)).toEqual([]);
  });

  it('counts cog and fk.hips keys for the leg tracks and the spine chain for the arm tracks', () => {
    const sampler = infoSampler(
      new Map([
        [id('cog'), [info('ty', [3], true)]],
        [id('fk.hips'), [info('rx', [5], true)]],
        [id('fk.spine'), [info('rx', [7], true)]],
      ]),
    );
    const times = computeInfluenceKeyTimes(program, sampler, range, 'raw');
    expect(times.get(`${foot}/rotation`)).toEqual([3, 5]);
    expect(times.get(`${toes}/rotation`)).toEqual([3, 5]);
    // The arm op reads the shoulder's world, which the spine chain moves, and the spine bone hangs from the hips bone
    // (fk.hips turns the pelvis without swinging the spine, but the spine's position follows the hips).
    expect(times.get(`${hand}/rotation`)).toEqual([3, 5, 7]);
    // Humanoid targets use the same definition.
    const humanoid = computeInfluenceKeyTimes(program, sampler, range, 'humanoid');
    expect(humanoid.get(`${HUMAN_BONE_NAMES.indexOf('leftFoot')}/rotation`)).toEqual([3, 5]);
    expect(humanoid.get(`${HUMAN_BONE_NAMES.indexOf('leftHand')}/rotation`)).toEqual([3, 5, 7]);
    // An FK arm (ikFk 0 over the clip) keeps the M1 set: its own chain and the parent bone's controls.
    const fkArms = infoSampler(
      new Map([
        [id('cog'), [info('ty', [3], true)]],
        [id('fk.hips'), [info('rx', [5], true)]],
        [id('fk.spine'), [info('rx', [7], true)]],
      ]),
      new Map(),
    );
    expect(computeInfluenceKeyTimes(program, fkArms, range, 'raw').get(`${hand}/rotation`)).toEqual([3, 7]);
  });

  it('makes a STEP key on cog a step of the IK leg tracks; smooth IK keys keep them LINEAR', () => {
    // Only cog is keyed (stepped): the IK foot holds while the hips jump, so the leg's locals jump at 10 too.
    const cogOnly = infoSampler(new Map([[id('cog'), [info('ty', [10], true)]]]));
    const stepped = computeStepSchedule(program, cogOnly, range, 'raw');
    for (const node of [upperLeg, lowerLeg, foot, toes]) {
      expect(stepped.get(`${node}/rotation`)).toEqual([0, 10, 40]);
    }
    // Stepped IK and attribute keys keep the schedule STEP and add their times.
    const allStepped = infoSampler(
      new Map([
        [id('cog'), [info('ty', [10], true)]],
        [id('ik.leg.L'), [info('ty', [15], true), info('@bank' as ChannelId, [25], true)]],
      ]),
    );
    expect(computeStepSchedule(program, allStepped, range, 'raw').get(`${foot}/rotation`)).toEqual([0, 10, 15, 25, 40]);
    // A smooth IK control curve makes the leg tracks LINEAR (absent); the right leg stays STEP on the cog key.
    const smoothIk = infoSampler(
      new Map([
        [id('cog'), [info('ty', [10], true)]],
        [id('ik.leg.L'), [info('ty', [15, 30], false)]],
      ]),
    );
    const schedule = computeStepSchedule(program, smoothIk, range, 'raw');
    expect(schedule.has(`${foot}/rotation`)).toBe(false);
    expect(schedule.get(`${nodeOf(skeleton, 'rightFoot')}/rotation`)).toEqual([0, 10, 40]);
    // A smooth attribute curve (roll) does the same.
    const smoothRoll = infoSampler(
      new Map([
        [id('cog'), [info('ty', [10], true)]],
        [id('ik.leg.L'), [info('@roll' as ChannelId, [5, 30], false)]],
      ]),
    );
    expect(computeStepSchedule(program, smoothRoll, range, 'raw').has(`${toes}/rotation`)).toBe(false);
  });

  it('gives an upgraded M1 rig without IK keys exactly the M1 schedule and key times', () => {
    const def = autoRig(skeleton, IDS);
    const records = limbIkRecords(def, skeleton, {
      limbs: ['leg.L', 'leg.R', 'arm.L', 'arm.R'],
      ikFkDefault: 0,
    });
    const upgraded = compileRig(
      { ...def, controls: [...def.controls, ...records.controls], solvers: [...def.solvers, ...records.solvers] },
      skeleton,
    );
    expect(upgraded.limbs).toHaveLength(4);
    const sampler = infoSampler(
      new Map([
        [id('cog'), [info('ty', [3, 9], true)]],
        [id('fk.upperLeg.L'), [info('rx', [0, 12], true)]],
        [id('fk.lowerArm.R'), [info('rz', [6, 18], false)]],
        [id('fk.indexProximal.L'), [info('rz', [2], true)]],
      ]),
      // Every added limb at its ikFk default 0.
      new Map(),
    );
    for (const target of ['raw', 'humanoid'] as const) {
      expect(computeStepSchedule(upgraded, sampler, range, target)).toEqual(
        computeStepSchedule(m1, sampler, range, target),
      );
      expect(computeInfluenceKeyTimes(upgraded, sampler, range, target)).toEqual(
        computeInfluenceKeyTimes(m1, sampler, range, target),
      );
    }
  });

  it('counts an ikFk curve that may rise above 0 and ignores one that is stepped at 0 throughout', () => {
    // A smooth pole curve: it counts for the upper leg track only while the leg's op may write.
    const base = new Map([
      [id('fk.upperLeg.L'), [info('rx', [0, 12], true)]],
      [id('fk.lowerLeg.L'), [info('rx', [6], false)]],
      [id('pole.leg.L'), [info('tx', [6], false)]],
    ]);
    const upperLegTrack = `${upperLeg}/rotation` as const;
    // leg.L at a static ikFk 0 (an FK clip): the upper leg's own stepped chain decides (STEP).
    const fkClip = infoSampler(base, new Map([[`${id('ik.leg.L')}/@ikFk`, 0]]));
    expect(computeStepSchedule(program, fkClip, range, 'raw').get(upperLegTrack)).toEqual([0, 12, 40]);
    // The import's FK fallback: one stepped @ikFk key 0 at the clip start.
    const fallback = infoSampler(
      new Map([...base, [id('ik.leg.L'), [info('@ikFk' as ChannelId, [0], true)]]]),
      new Map([[`${id('ik.leg.L')}/@ikFk`, 0]]),
    );
    expect(computeStepSchedule(program, fallback, range, 'raw').get(upperLegTrack)).toEqual([0, 12, 40]);
    // A key switching to IK at 20: the op reads the pole (smooth), so the upper leg track is LINEAR.
    const switching = infoSampler(
      new Map([...base, [id('ik.leg.L'), [info('@ikFk' as ChannelId, [0, 20], true)]]]),
      new Map([[`${id('ik.leg.L')}/@ikFk`, 1]]),
    );
    expect(computeStepSchedule(program, switching, range, 'raw').has(upperLegTrack)).toBe(false);
    // The default (1 for legs) without a curve: IK.
    expect(computeStepSchedule(program, infoSampler(base, new Map()), range, 'raw').has(upperLegTrack)).toBe(false);
  });

  it('does not count the FK chain below a track: the op reads the IK side and the upper bone parent only', () => {
    // §5.3 declarations: fk.lowerLeg and fk.foot move the shin and the foot, not the thigh, so a smooth fk.foot curve
    // leaves an IK leg's stepped thigh track STEP (and adds no key times to it).
    const sampler = infoSampler(
      new Map([
        [id('fk.upperLeg.L'), [info('rx', [0, 12], true)]],
        [id('fk.lowerLeg.L'), [info('rx', [6, 30], false)]],
        [id('fk.foot.L'), [info('rx', [9, 33], false)]],
        [id('ik.leg.L'), [info('@ikFk' as ChannelId, [0, 20], true)]],
      ]),
      new Map([[`${id('ik.leg.L')}/@ikFk`, 1]]),
    );
    expect(computeStepSchedule(program, sampler, range, 'raw').get(`${upperLeg}/rotation`)).toEqual([0, 12, 20, 40]);
    expect(computeInfluenceKeyTimes(program, sampler, range, 'raw').get(`${upperLeg}/rotation`)).toEqual([0, 12, 20]);
    // The shin and the foot keep their own FK chains (M1 set): smooth, so LINEAR.
    const schedule = computeStepSchedule(program, sampler, range, 'raw');
    expect(schedule.has(`${lowerLeg}/rotation`)).toBe(false);
    expect(schedule.has(`${foot}/rotation`)).toBe(false);
  });

  it('counts a stepped ikFk curve whose cycleOffset infinity rises above 0 in another cycle', () => {
    const upperLegTrack = `${upperLeg}/rotation` as const;
    // Keys −1 at 0 and 0 at 20: with cycleOffset after the last key the next cycle plays 0 … +1 (IK).
    const sampler = (pre: CurveInfo['pre'], post: CurveInfo['post'], first: number, last: number): ClipSampler => ({
      ...infoSampler(new Map()),
      value: (control, channel, t) =>
        control === id('ik.leg.L') && channel === '@ikFk' ? (t === 0 ? first : t === 20 ? last : undefined) : undefined,
      curveInfo: (control) =>
        control === id('ik.leg.L')
          ? [{ channel: '@ikFk' as ChannelId, keyTimes: [0, 20], steppedThroughout: true, pre, post }]
          : control === id('pole.leg.L')
            ? [info('tx', [6], false)]
            : control === id('fk.upperLeg.L')
              ? [info('rx', [0, 12], true)]
              : [],
    });
    const linear = (s: ClipSampler): boolean => !computeStepSchedule(program, s, range, 'raw').has(upperLegTrack);
    expect(linear(sampler('constant', 'cycleOffset', -1, 0))).toBe(true);
    expect(linear(sampler('cycleOffset', 'constant', 0, -1))).toBe(true);
    // A cycleOffset that falls in the cycles it reaches stays ≤ 0; plain cycles repeat the keys.
    expect(linear(sampler('constant', 'cycleOffset', 0, -1))).toBe(false);
    expect(linear(sampler('cycleOffset', 'constant', -1, 0))).toBe(false);
    expect(linear(sampler('cycle', 'cycle', -1, 0))).toBe(false);
    expect(linear(sampler('constant', 'linear', -1, 0))).toBe(true);
  });
});
