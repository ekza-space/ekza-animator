import type { Frame } from '@ekza-animator/anim-core';
import type { ControlRecord } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES } from '../humanoid/bones';
import { internalsOf, type RigInternals, type ScheduledRigOp } from '../kernel/internals';
import type { ClipSampler, CurveInfo, RigProgram, TrackKey } from '../types';

// Influencing curves of bake tracks (M2A-SPEC §5.8, one definition for `computeStepSchedule`,
// `computeInfluenceKeyTimes`, the export keep set and `rig.ikFk.matchRange` with 'keys'): the curves that influence a
// node are the M1 set — its driving control's curves and those of its control ancestors — plus, for every op that
// writes the node, the curves of every control the op reads (with their control ancestors; attribute curves are
// curves of their control) and, recursively, the curves influencing every node the op reads (for ik2 the upper
// bone's parent: `cog`, `fk.hips` and the spine keys count for the leg tracks). A track adds its parent node's set.
//
// An op writes nothing in a clip where it is inactive throughout (an ik2 limb whose `ikFk` is ≤ 0 over the whole
// clip: `run` returns false), so its reads do not influence that clip's tracks: an M1 rig upgraded with
// `rig.addLimbIk` (ikFk 0) keeps the M1 sets, and its exports stay byte-identical (§5.7) until a limb is switched.

/** Slots of a control and all its control ancestors. */
export function controlChain(internals: RigInternals, slot: number, out: Set<number>): void {
  for (let current = slot; current !== -1; current = internals.controlParent[current] as number) {
    if (out.has(current)) return;
    out.add(current);
  }
}

/** The driving control of `node` or of its nearest driven ancestor (−1 when none). */
export function drivingSlot(internals: RigInternals, node: number): number {
  for (let current = node; current !== -1; current = internals.nodeParent[current] as number) {
    const slot = internals.driver[current] as number;
    if (slot !== -1) return slot;
  }
  return -1;
}

/** Whether an op may write in the clip being scheduled (default: every op that is not skipped). */
export type OpActivity = (op: ScheduledRigOp) => boolean;

/**
 * Activity of the ops in one clip: an ik2 limb is inactive when its `ikFk` stays ≤ 0 over the whole clip — no keyed
 * `@ikFk` curve and a static value (or the attribute default) ≤ 0, or a stepped curve that never extrapolates
 * linearly and whose every key value is ≤ 0. Every other op (and any ikFk curve that may rise above 0) is active.
 */
export function clipOpActivity(program: RigProgram, sampler: ClipSampler): OpActivity {
  const internals = internalsOf(program);
  const inactive = new Set<string>();
  for (const limb of program.limbs) {
    const slot = limb.attrSlots.ikFk;
    if (slot < 0) continue;
    const control = limb.params.ikControl;
    const curve = sampler.curveInfo(control).find((info) => info.channel === '@ikFk');
    const def = program.attrSlots[slot]?.def;
    let atMostZero: boolean;
    if (curve === undefined || curve.keyTimes.length === 0) {
      const value = sampler.value(control, '@ikFk', 0) ?? def?.default ?? 0;
      atMostZero = !(value > 0);
    } else {
      atMostZero =
        curve.steppedThroughout &&
        curve.pre !== 'linear' &&
        curve.post !== 'linear' &&
        curve.keyTimes.every((t) => !((sampler.value(control, '@ikFk', t) ?? 0) > 0));
    }
    if (atMostZero) inactive.add(limb.solver);
  }
  return (op) => !op.skipped && !inactive.has(op.record.id);
}

/** Op-related influence of nodes (§5.8): memoized per program. */
class OpInfluence {
  private readonly writers: ScheduledRigOp[][];
  private readonly extraMemo = new Map<number, ReadonlySet<number>>();
  private readonly worldMemo = new Map<number, ReadonlySet<number>>();
  readonly hasOps: boolean;

  constructor(
    private readonly internals: RigInternals,
    active: OpActivity,
  ) {
    this.writers = Array.from({ length: internals.nodeCount }, () => []);
    let any = false;
    for (const op of internals.customOps) {
      if (!active(op)) continue;
      any = true;
      for (const node of op.writesNodes) this.writers[node]?.push(op);
    }
    this.hasOps = any;
  }

  /** Slots influencing `node` through the ops that write it (empty without such ops). */
  extra(node: number): ReadonlySet<number> {
    const cached = this.extraMemo.get(node);
    if (cached !== undefined) return cached;
    const out = new Set<number>();
    this.extraMemo.set(node, out);
    for (const op of this.writers[node] ?? []) {
      for (const slot of op.readsControls) controlChain(this.internals, slot, out);
      for (const read of op.readsNodes) for (const slot of this.world(read)) out.add(slot);
    }
    return out;
  }

  /** Slots influencing the world of a node an op reads: its driving chain, op influence and its ancestors'. */
  private world(node: number): ReadonlySet<number> {
    const cached = this.worldMemo.get(node);
    if (cached !== undefined) return cached;
    const out = new Set<number>();
    this.worldMemo.set(node, out);
    const slot = drivingSlot(this.internals, node);
    if (slot !== -1) controlChain(this.internals, slot, out);
    for (const extra of this.extra(node)) out.add(extra);
    const parent = this.internals.nodeParent[node] as number;
    if (parent !== -1) for (const inherited of this.world(parent)) out.add(inherited);
    return out;
  }
}

/**
 * Influencing control slots per bake track (§5.8): raw targets every driven node (rotation, translation, scale);
 * humanoid targets every present humanoid bone except the eyes (rotation) and the hips (translation). Programs
 * without active custom ops give exactly the M1 sets; `active` (default: every op not skipped) leaves out the ops
 * that write nothing in the clip (`clipOpActivity`).
 */
export function trackInfluence(
  program: RigProgram,
  target: 'raw' | 'humanoid',
  active: OpActivity = (op) => !op.skipped,
): ReadonlyMap<TrackKey, ReadonlySet<number>> {
  const internals = internalsOf(program);
  const ops = new OpInfluence(internals, active);
  const withOps = (slots: Set<number>, nodes: readonly number[]): Set<number> => {
    if (!ops.hasOps) return slots;
    for (const node of nodes) if (node !== -1) for (const slot of ops.extra(node)) slots.add(slot);
    return slots;
  };
  const result = new Map<TrackKey, ReadonlySet<number>>();
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
      withOps(slots, [node, parent]);
      result.set(`${node}/rotation`, slots);
      result.set(`${node}/translation`, slots);
      result.set(`${node}/scale`, slots);
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
    const parentNode = parentH === -1 ? -1 : (internals.humanNode[parentH] as number);
    if (parentNode !== -1) {
      const parentSlot = drivingSlot(internals, parentNode);
      if (parentSlot !== -1) controlChain(internals, parentSlot, slots);
    }
    withOps(slots, [node, parentNode]);
    result.set(`${h}/rotation`, slots);
    if (h === 0) result.set(`${h}/translation`, slots);
  });
  return result;
}

/** Key times of a curve after infinity mapping, inside [start, end]. */
export function mappedKeyTimes(info: CurveInfo, start: Frame, end: Frame, out: Set<Frame>): void {
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

/** Keyed curve facts per control slot (curves without keys are skipped), cached for one computation. */
export function keyedCurves(internals: RigInternals, sampler: ClipSampler): (slot: number) => readonly CurveInfo[] {
  const infos = new Map<number, readonly CurveInfo[]>();
  return (slot: number): readonly CurveInfo[] => {
    let cached = infos.get(slot);
    if (cached === undefined) {
      cached = sampler.curveInfo((internals.controls[slot] as ControlRecord).id).filter((i) => i.keyTimes.length > 0);
      infos.set(slot, cached);
    }
    return cached;
  };
}

/**
 * Key times of every bake track's influencing curves (§5.8) inside `range`, after infinity mapping (cyclic curves
 * repeat their keys), sorted and unique; a track without keyed influence maps to []. Tracks are those of
 * `trackInfluence` (raw: every driven node's rotation, translation and scale; humanoid: the bones' rotations and the
 * hips translation). Ops inactive throughout the clip do not count (`clipOpActivity`). The export keep set (§5.16)
 * and `rig.ikFk.matchRange {step: 'keys'}` use it.
 */
export function computeInfluenceKeyTimes(
  program: RigProgram,
  sampler: ClipSampler,
  range: { readonly start: Frame; readonly end: Frame },
  target: 'raw' | 'humanoid',
): ReadonlyMap<TrackKey, readonly Frame[]> {
  const internals = internalsOf(program);
  const curves = keyedCurves(internals, sampler);
  const bySet = new Map<ReadonlySet<number>, readonly Frame[]>();
  const result = new Map<TrackKey, readonly Frame[]>();
  for (const [track, slots] of trackInfluence(program, target, clipOpActivity(program, sampler))) {
    let times = bySet.get(slots);
    if (times === undefined) {
      const set = new Set<Frame>();
      for (const slot of [...slots].sort((a, b) => a - b)) {
        for (const info of curves(slot)) mappedKeyTimes(info, range.start, range.end, set);
      }
      times = [...set].sort((a, b) => a - b);
      bySet.set(slots, times);
    }
    result.set(track, times);
  }
  return result;
}
