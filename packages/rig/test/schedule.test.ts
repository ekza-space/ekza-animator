import type { Frame } from '@ekza-animator/anim-core';
import { type ChannelId, type ClipId, type ControlId, controlId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import {
  autoRig,
  type ClipSampler,
  compileRig,
  computeStepSchedule,
  type CurveInfo,
  HUMAN_BONE_NAMES,
  type RigProgram,
} from '../src';
import { IDS, syntheticSkeleton } from './helpers';

const id = (key: string): ControlId => controlId(IDS.rig, key);

/** A ClipSampler (rig's own contract) that only reports curve facts. */
function infoSampler(infos: ReadonlyMap<ControlId, readonly CurveInfo[]>): ClipSampler {
  return {
    clip: 'clp_ScheduleTest0001' as ClipId,
    sample: () => undefined,
    value: () => undefined,
    keyTimes: () => [],
    curveInfo: (control) => infos.get(control) ?? [],
    dispose: () => undefined,
  };
}

function info(channel: ChannelId, keyTimes: Frame[], stepped: boolean, extra: Partial<CurveInfo> = {}): CurveInfo {
  return { channel, keyTimes, steppedThroughout: stepped, pre: 'constant', post: 'constant', ...extra };
}

describe('computeStepSchedule (MVP-SPEC §4.11.10 step 3)', () => {
  const skeleton = syntheticSkeleton();
  const program: RigProgram = compileRig(autoRig(skeleton, IDS), skeleton);
  const lowerArm = skeleton.humanoid?.leftLowerArm as number;
  const hand = skeleton.humanoid?.leftHand as number;
  const range = { start: 0, end: 30 };

  it('makes a track STEP when every influencing curve is stepped, at start ∪ key times ∪ end', () => {
    const sampler = infoSampler(new Map([[id('fk.lowerArm.L'), [info('rz', [5, 12], true), info('rx', [8], true)]]]));
    const schedule = computeStepSchedule(program, sampler, range, 'raw');
    expect(schedule.get(`${lowerArm}/rotation`)).toEqual([0, 5, 8, 12, 30]);
    // The hand's local depends on its parent bone's control too.
    expect(schedule.get(`${hand}/rotation`)).toEqual([0, 5, 8, 12, 30]);
    // Tracks without keyed influence are constant (absent); so are unrelated tracks.
    const head = skeleton.humanoid?.head as number;
    expect(schedule.has(`${head}/rotation`)).toBe(false);
  });

  it('keeps tracks with any smooth influencing curve LINEAR (absent from the map)', () => {
    const sampler = infoSampler(
      new Map([
        [id('fk.lowerArm.L'), [info('rz', [5, 12], true)]],
        [id('fk.upperArm.L'), [info('ry', [0, 10], false)]],
      ]),
    );
    const schedule = computeStepSchedule(program, sampler, range, 'raw');
    expect(schedule.has(`${lowerArm}/rotation`)).toBe(false);
    // Control ancestors (cog) influence everything below them.
    const withCog = infoSampler(
      new Map([
        [id('fk.lowerArm.L'), [info('rz', [5, 12], true)]],
        [id('cog'), [info('ty', [0, 3], false)]],
      ]),
    );
    expect(computeStepSchedule(program, withCog, range, 'raw').has(`${lowerArm}/rotation`)).toBe(false);
  });

  it('maps key times through cycle, cycle-offset and oscillate infinities, inside the range only', () => {
    const cycled = infoSampler(new Map([[id('fk.lowerArm.L'), [info('rz', [0, 4, 10], true, { post: 'cycle' })]]]));
    expect(computeStepSchedule(program, cycled, { start: 0, end: 25 }, 'raw').get(`${lowerArm}/rotation`)).toEqual([
      0, 4, 10, 14, 20, 24, 25,
    ]);
    const oscillating = infoSampler(
      new Map([[id('fk.lowerArm.L'), [info('rz', [0, 4, 10], true, { post: 'oscillate', pre: 'cycleOffset' })]]]),
    );
    expect(
      computeStepSchedule(program, oscillating, { start: -10, end: 26 }, 'raw').get(`${lowerArm}/rotation`),
    ).toEqual([-10, -6, 0, 4, 10, 16, 20, 24, 26]);
  });

  it('treats linear extrapolation beyond the keys as smooth', () => {
    const extrapolated = infoSampler(new Map([[id('fk.lowerArm.L'), [info('rz', [5, 12], true, { post: 'linear' })]]]));
    expect(computeStepSchedule(program, extrapolated, range, 'raw').has(`${lowerArm}/rotation`)).toBe(false);
    expect(
      computeStepSchedule(program, extrapolated, { start: 5, end: 12 }, 'raw').get(`${lowerArm}/rotation`),
    ).toEqual([5, 12]);
  });

  it('schedules humanoid tracks by HUMAN_BONE_NAMES index (bone and normalized parent)', () => {
    const sampler = infoSampler(new Map([[id('cog'), [info('ty', [3], true)]]]));
    const schedule = computeStepSchedule(program, sampler, range, 'humanoid');
    expect(schedule.get('0/translation')).toEqual([0, 3, 30]);
    expect(schedule.get('0/rotation')).toEqual([0, 3, 30]);
    const h = HUMAN_BONE_NAMES.indexOf('leftHand');
    expect(schedule.get(`${h}/rotation`)).toEqual([0, 3, 30]);
    expect(schedule.has(`${HUMAN_BONE_NAMES.indexOf('leftEye')}/rotation`)).toBe(false);
    expect([...schedule.keys()].every((key) => !key.endsWith('/scale'))).toBe(true);
  });
});
