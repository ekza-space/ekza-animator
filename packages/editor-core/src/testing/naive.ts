// Naive stand-ins for the sibling-package functions the kernel calls (the `KernelDeps` seam), so the fake app runs
// the real kernel before — and independently of — WP-1/WP-2/WP-3/WP-4: scene clock (doc), curve cache and clip
// sampler (rig), shape-preserving insert consistent with the naive curve engine (anim-core), rig definition and
// program (rig). Linear scans throughout; exact only where the naive engine is (see `curves.ts`).
import {
  type AnimCurve,
  type CompiledAnimCurve,
  EkzaError,
  type Fps,
  type Frame,
  type KeyData,
  Segment,
  type SegmentKind,
} from '@ekza-animator/anim-core';
import type {
  ChannelId,
  ChannelValues,
  ClipId,
  ClipRecord,
  ControlId,
  CurveId,
  CurveRecord,
  DocumentStore,
  ReadView,
  RigId,
} from '@ekza-animator/doc';
import {
  CHANNELS_PER_CONTROL,
  type ChannelBuffer,
  type ClipSampler,
  type CurveCache,
  type CurveInfo,
  type RigDefinition,
  type RigProgram,
} from '@ekza-animator/rig';
import { compileNaiveCurve, evaluateNaiveCurve } from './curves';
import { channelDefault, channelSlot } from './rig';
import { compareStrings } from './store/rows';

// ---------- scene clock (doc §4.11.8) ----------

export function naiveSceneToClipFrame(
  sceneFps: Fps,
  clip: Pick<ClipRecord, 'fps' | 'sceneStart'>,
  sceneFrame: Frame,
): Frame {
  return ((sceneFrame - clip.sceneStart) * (clip.fps.num * sceneFps.den)) / (clip.fps.den * sceneFps.num);
}

export function naiveClipToSceneFrame(
  sceneFps: Fps,
  clip: Pick<ClipRecord, 'fps' | 'sceneStart'>,
  clipFrame: Frame,
): Frame {
  return clip.sceneStart + (clipFrame * (clip.fps.den * sceneFps.num)) / (clip.fps.num * sceneFps.den);
}

/** Inside the range as is; outside, loop wraps into [start, end) and once clamps. */
export function naiveWrapClipFrame(clip: Pick<ClipRecord, 'range' | 'loop'>, frame: Frame): Frame {
  const { start, end } = clip.range;
  if (frame >= start && frame <= end) return frame;
  if (!clip.loop) return Math.min(Math.max(frame, start), end);
  const span = end - start;
  return span <= 0 ? start : start + ((((frame - start) % span) + span) % span);
}

// ---------- curve cache and clip sampler (rig) ----------

/** Compiled curves per CurveId; a batch drops the curves it touches (curves, their keys), a load drops all. */
export function createNaiveCurveCache(store: DocumentStore): CurveCache {
  const compiled = new Map<CurveId, CompiledAnimCurve>();
  let version = 0;
  const unsubscribe = store.subscribe((batch) => {
    if (batch.origin === 'load') {
      compiled.clear();
      version++;
      return;
    }
    let touched = false;
    for (const change of batch.changes) {
      if (change.table === 'curves') compiled.delete(change.id);
      else if (change.table === 'keys') {
        const row = change.after ?? change.before;
        if (row !== undefined) compiled.delete(row.curve);
      } else continue;
      touched = true;
    }
    if (touched) version++;
  });
  return {
    get(curve: CurveId): CompiledAnimCurve {
      const cached = compiled.get(curve);
      if (cached !== undefined) return cached;
      const record = store.get('curves', curve);
      if (record === undefined) throw new EkzaError('invalid-record', `Curve ${curve} does not exist`);
      const result = compileNaiveCurve({
        keys: store.query.keysOfCurve(curve),
        weighted: record.weighted,
        pre: record.pre,
        post: record.post,
      });
      compiled.set(curve, result);
      return result;
    },
    get version() {
      return version;
    },
    dispose: unsubscribe,
  };
}

function naiveCurveValue(cache: CurveCache, curve: CurveRecord, frame: Frame): number {
  const compiled = cache.get(curve.id);
  return compiled.keyCount > 0
    ? evaluateNaiveCurve(compiled, frame)
    : (curve.staticValue ?? channelDefault(curve.channel));
}

export function createNaiveClipSampler(
  store: DocumentStore,
  cache: CurveCache,
  clip: ClipId,
  program: RigProgram,
): ClipSampler {
  const baseCurves = (): CurveRecord[] => {
    const base = store.query.baseLayer(clip);
    return base === undefined ? [] : store.query.curvesOfClip(clip).filter((curve) => curve.layer === base.id);
  };
  return {
    clip,
    sample(frame: Frame, out: ChannelBuffer): void {
      program.resetChannels(out);
      for (const curve of baseCurves()) {
        const index = program.controlIndex.get(curve.control);
        const slot = channelSlot(curve.channel);
        if (index === undefined || slot === -1) continue;
        out.values[index * CHANNELS_PER_CONTROL + slot] = naiveCurveValue(cache, curve, frame);
      }
    },
    value(control: ControlId, channel: ChannelId, frame: Frame): number | undefined {
      const curve = baseCurves().find((c) => c.control === control && c.channel === channel);
      return curve === undefined ? undefined : naiveCurveValue(cache, curve, frame);
    },
    keyTimes(controls: readonly ControlId[] | null): readonly Frame[] {
      const wanted = controls === null ? null : new Set(controls);
      const times = new Set<number>();
      for (const curve of baseCurves()) {
        if (wanted !== null && !wanted.has(curve.control)) continue;
        for (const key of store.query.keysOfCurve(curve.id)) times.add(key.t);
      }
      return [...times].sort((a, b) => a - b);
    },
    curveInfo(control: ControlId): readonly CurveInfo[] {
      return baseCurves()
        .filter((curve) => curve.control === control)
        .sort((a, b) => compareStrings(a.channel, b.channel))
        .map((curve) => {
          const keys = store.query.keysOfCurve(curve.id);
          return {
            channel: curve.channel,
            keyTimes: keys.map((key) => key.t),
            steppedThroughout: keys.length > 0 && keys.every((key) => key.outType === 'step'),
            pre: curve.pre,
            post: curve.post,
          };
        });
    },
    dispose(): void {},
  };
}

export function naiveApplyOverrides(
  program: RigProgram,
  ch: ChannelBuffer,
  overrides: ReadonlyMap<ControlId, ChannelValues>,
): void {
  for (const [control, values] of overrides) {
    const index = program.controlIndex.get(control);
    if (index === undefined) continue;
    for (const [channel, value] of Object.entries(values)) {
      const slot = channelSlot(channel);
      if (slot !== -1 && value !== undefined) ch.values[index * CHANNELS_PER_CONTROL + slot] = value;
    }
  }
}

export function naiveReadRigDefinition(view: ReadView, rig: RigId): RigDefinition | undefined {
  const record = view.get('rigs', rig);
  if (record === undefined) return undefined;
  return {
    rig: record,
    controls: view.query.controlsOfRig(rig),
    constraints: view.list('constraints').filter((c) => c.rig === rig),
    solvers: view.list('solvers').filter((s) => s.rig === rig),
  };
}

// ---------- shape-preserving insert (anim-core §4.11.4), for the naive engine ----------

/** Slope (value per frame) of the naive curve at a frame inside its key range. */
function naiveSlope(c: CompiledAnimCurve, frame: Frame): number {
  const n = c.keyCount;
  let lo = 0;
  while (lo < n - 2 && (c.t[lo + 1] as number) <= frame) lo++;
  const hi = lo + 1;
  const t0 = c.t[lo] as number;
  const h = (c.t[hi] as number) - t0;
  const v0 = c.v[lo] as number;
  const v1 = c.v[hi] as number;
  switch (c.segment[lo] as SegmentKind) {
    case Segment.Step:
    case Segment.StepNext:
      return 0;
    case Segment.Linear:
      return (v1 - v0) / h;
    case Segment.Hermite:
    case Segment.Bezier: {
      const s = (frame - t0) / h;
      const m0 = (c.outSlope[lo] as number) * h;
      const m1 = (c.inSlope[hi] as number) * h;
      return (
        ((6 * s * s - 6 * s) * v0 +
          (3 * s * s - 4 * s + 1) * m0 +
          (6 * s - 6 * s * s) * v1 +
          (3 * s * s - 2 * s) * m1) /
        h
      );
    }
  }
}

/** Slope of a key side in the naive engine (fixed sides: the handle direction). */
function sideSlope(c: CompiledAnimCurve, i: number, side: 'in' | 'out'): number {
  return (side === 'in' ? c.inSlope[i] : c.outSlope[i]) as number;
}

const COMPUTED = new Set(['auto', 'autoEase', 'autoMix', 'spline', 'clamped', 'plateau', 'linear', 'flat']);

/**
 * §4.11.4 insert rule over the naive engine: inside a step / stepNext / linear span the new key takes that span's
 * shape; inside a Hermite span it gets the curve's value and slope as fixed handles; every computed neighbour side
 * whose slope the insert would change is frozen as `fixed` with its slope before the insert.
 */
export function naiveInsertKeyPreservingShape(
  curve: AnimCurve,
  frame: Frame,
): { readonly keys: KeyData[]; readonly index: number; readonly frozen: readonly number[] } {
  const keys = curve.keys;
  const before = compileNaiveCurve(curve);
  let index = keys.findIndex((key) => key.t > frame);
  if (index === -1) index = keys.length;
  const value = evaluateNaiveCurve(before, frame);
  const inside = index > 0 && index < keys.length;
  const base = { t: frame, v: value, broken: false, weightLocked: true } as const;
  let inserted: KeyData;
  const kind = inside ? (before.segment[index - 1] as SegmentKind) : null;
  if (kind === Segment.Step) {
    inserted = { ...base, inType: 'flat', outType: 'step', inHandle: ZERO, outHandle: ZERO };
  } else if (kind === Segment.StepNext) {
    inserted = { ...base, inType: 'flat', outType: 'stepNext', inHandle: ZERO, outHandle: ZERO };
  } else if (kind === Segment.Linear) {
    inserted = { ...base, inType: 'linear', outType: 'linear', inHandle: ZERO, outHandle: ZERO };
  } else {
    const slope = inside ? naiveSlope(before, frame) : 0;
    const left = inside ? (frame - (keys[index - 1] as KeyData).t) / 3 : 1;
    const right = inside ? ((keys[index] as KeyData).t - frame) / 3 : 1;
    inserted = {
      ...base,
      inType: 'fixed',
      outType: 'fixed',
      inHandle: { dt: -left, dv: -slope * left },
      outHandle: { dt: right, dv: slope * right },
    };
  }
  const next: KeyData[] = [...keys.slice(0, index), inserted, ...keys.slice(index)];
  const after = compileNaiveCurve({ ...curve, keys: next });
  const frozen: number[] = [];
  for (let i = 0; i < next.length; i++) {
    if (i === index) continue;
    const old = i < index ? i : i - 1;
    let key = next[i] as KeyData;
    for (const side of ['in', 'out'] as const) {
      const type = side === 'in' ? key.inType : key.outType;
      if (!COMPUTED.has(type)) continue;
      const was = sideSlope(before, old, side);
      if (Math.abs(sideSlope(after, i, side) - was) <= 1e-12) continue;
      const dt = (side === 'in' ? before.inDt[old] : before.outDt[old]) as number;
      const handle = { dt, dv: was * dt };
      key =
        side === 'in' ? { ...key, inType: 'fixed', inHandle: handle } : { ...key, outType: 'fixed', outHandle: handle };
    }
    if (key !== next[i]) {
      next[i] = key;
      frozen.push(i);
    }
  }
  return { keys: next, index, frozen };
}

const ZERO = { dt: 0, dv: 0 } as const;
