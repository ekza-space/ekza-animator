import type { Frame } from '@ekza-animator/anim-core';
import { internalsOf } from '../kernel/internals';
import type { ClipSampler, CurveInfo, RigProgram, TrackKey } from '../types';
import { keyedCurves, mappedKeyTimes, trackInfluence } from './influence';

/** Whether a curve holds its value between key times over the whole range (MVP-SPEC §4.11.10 step 3). */
function steppedOver(info: CurveInfo, start: Frame, end: Frame): boolean {
  if (!info.steppedThroughout) return false;
  const first = info.keyTimes[0] as Frame;
  const last = info.keyTimes[info.keyTimes.length - 1] as Frame;
  // Linear extrapolation may slope outside the keys; treat it as smooth when the range reaches there.
  if (info.pre === 'linear' && start < first) return false;
  if (info.post === 'linear' && end > last) return false;
  return true;
}

/**
 * STEP sampler times for bake tracks whose every influencing curve is stepped throughout the range (MVP-SPEC
 * §4.11.10 step 3) — the influencing curves of M2A-SPEC §5.8: the track's driving control and its control ancestors,
 * plus the parent bone's (humanoid tracks: the bone's and its normalized parent's), plus, for nodes written by rig
 * ops (limb IK), every control the op reads and the influence of the nodes it reads (a STEP key on `cog` is a step
 * of the IK leg tracks too). Times are `{start} ∪ influencing key times (after infinity mapping, inside the range)
 * ∪ {end}`. Tracks with a smooth influence (LINEAR) or no keyed influence at all (constant) are absent from the map.
 */
export function computeStepSchedule(
  program: RigProgram,
  sampler: ClipSampler,
  range: { readonly start: Frame; readonly end: Frame },
  target: 'raw' | 'humanoid',
): ReadonlyMap<TrackKey, readonly Frame[]> {
  const internals = internalsOf(program);
  const { start, end } = range;
  const curves = keyedCurves(internals, sampler);
  const bySet = new Map<ReadonlySet<number>, readonly Frame[] | null>();
  const schedule = (slots: ReadonlySet<number>): readonly Frame[] | null => {
    const cached = bySet.get(slots);
    if (cached !== undefined) return cached;
    const keyed: CurveInfo[] = [];
    for (const slot of [...slots].sort((a, b) => a - b)) keyed.push(...curves(slot));
    let result: readonly Frame[] | null = null;
    if (keyed.length > 0 && keyed.every((info) => steppedOver(info, start, end))) {
      const times = new Set<Frame>([start, end]);
      for (const info of keyed) mappedKeyTimes(info, start, end, times);
      result = [...times].sort((a, b) => a - b);
    }
    bySet.set(slots, result);
    return result;
  };
  const result = new Map<TrackKey, readonly Frame[]>();
  for (const [track, slots] of trackInfluence(program, target)) {
    const times = schedule(slots);
    if (times !== null) result.set(track, times);
  }
  return result;
}
