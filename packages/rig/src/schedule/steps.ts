import type { Frame } from '@ekza-animator/anim-core';
import type { ControlRecord } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES } from '../humanoid/bones';
import { internalsOf, type RigInternals } from '../kernel/internals';
import type { ClipSampler, CurveInfo, RigProgram, TrackKey } from '../types';

/** Slots of a control and all its control ancestors. */
function controlChain(internals: RigInternals, slot: number, out: Set<number>): void {
  for (let current = slot; current !== -1; current = internals.controlParent[current] as number) {
    if (out.has(current)) return;
    out.add(current);
  }
}

/** The driving control of `node` or of its nearest driven ancestor (−1 when none). */
function drivingSlot(internals: RigInternals, node: number): number {
  for (let current = node; current !== -1; current = internals.nodeParent[current] as number) {
    const slot = internals.driver[current] as number;
    if (slot !== -1) return slot;
  }
  return -1;
}

/** Key times of a curve after infinity mapping, inside [start, end]. */
function mappedKeyTimes(info: CurveInfo, start: Frame, end: Frame, out: Set<Frame>): void {
  const keys = info.keyTimes;
  const n = keys.length;
  if (n === 0) return;
  const first = keys[0] as Frame;
  const last = keys[n - 1] as Frame;
  for (const t of keys) if (t >= start && t <= end) out.add(t);
  const span = last - first;
  if (!(span > 0)) return;
  const repeats = (mode: CurveInfo['pre'], direction: 1 | -1): void => {
    if (mode !== 'cycle' && mode !== 'cycleOffset' && mode !== 'oscillate') return;
    for (let cycle = direction; ; cycle += direction) {
      const base = first + cycle * span;
      if (direction > 0 ? base > end : base + span < start) break;
      const mirrored = mode === 'oscillate' && Math.abs(cycle) % 2 === 1;
      for (const t of keys) {
        const mapped = mirrored ? base + (last - t) : base + (t - first);
        if (mapped >= start && mapped <= end) out.add(mapped);
      }
    }
  };
  repeats(info.post, 1);
  repeats(info.pre, -1);
}

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
 * §4.11.10 step 3): the track's driving control and its control ancestors, plus the parent bone's driving control
 * and its ancestors (humanoid tracks: the bone's and its normalized parent's). Times are
 * `{start} ∪ influencing key times (after infinity mapping, inside the range) ∪ {end}`. Tracks with a smooth
 * influence (LINEAR) or no keyed influence at all (constant) are absent from the map.
 */
export function computeStepSchedule(
  program: RigProgram,
  sampler: ClipSampler,
  range: { readonly start: Frame; readonly end: Frame },
  target: 'raw' | 'humanoid',
): ReadonlyMap<TrackKey, readonly Frame[]> {
  const internals = internalsOf(program);
  const { start, end } = range;
  const infos = new Map<number, readonly CurveInfo[]>();
  const curveInfo = (slot: number): readonly CurveInfo[] => {
    let cached = infos.get(slot);
    if (cached === undefined) {
      cached = sampler.curveInfo((internals.controls[slot] as ControlRecord).id).filter((i) => i.keyTimes.length > 0);
      infos.set(slot, cached);
    }
    return cached;
  };
  const schedule = (slots: ReadonlySet<number>): Frame[] | null => {
    const keyed: CurveInfo[] = [];
    for (const slot of [...slots].sort((a, b) => a - b)) keyed.push(...curveInfo(slot));
    if (keyed.length === 0) return null;
    if (!keyed.every((info) => steppedOver(info, start, end))) return null;
    const times = new Set<Frame>([start, end]);
    for (const info of keyed) mappedKeyTimes(info, start, end, times);
    return [...times].sort((a, b) => a - b);
  };

  const result = new Map<TrackKey, readonly Frame[]>();
  if (target === 'raw') {
    for (let node = 0; node < internals.nodeCount; node++) {
      const slot = internals.driver[node] as number;
      if (slot === -1) continue;
      const slots = new Set<number>();
      controlChain(internals, slot, slots);
      const parent = internals.nodeParent[node] as number;
      if (parent !== -1) {
        const parentSlot = drivingSlot(internals, parent);
        if (parentSlot !== -1) controlChain(internals, parentSlot, slots);
      }
      const times = schedule(slots);
      if (times === null) continue;
      result.set(`${node}/rotation`, times);
      result.set(`${node}/translation`, times);
      result.set(`${node}/scale`, times);
    }
    return result;
  }
  HUMAN_BONE_NAMES.forEach((name, h) => {
    const node = internals.humanNode[h] as number;
    if (node === -1 || name === 'leftEye' || name === 'rightEye') return;
    const slots = new Set<number>();
    const own = drivingSlot(internals, node);
    if (own !== -1) controlChain(internals, own, slots);
    const parentH = internals.humanParent[h] as number;
    if (parentH !== -1) {
      const parentSlot = drivingSlot(internals, internals.humanNode[parentH] as number);
      if (parentSlot !== -1) controlChain(internals, parentSlot, slots);
    }
    const times = schedule(slots);
    if (times === null) return;
    result.set(`${h}/rotation`, times);
    if (h === 0) result.set(`${h}/translation`, times);
  });
  return result;
}
