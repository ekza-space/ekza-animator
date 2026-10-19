// Value adjustment of keys (MCP-SPEC §4.10 `key.adjust`, P1): on every key of a curve inside a range (or at given
// frames) the value becomes `pivot + factor·(v − pivot) + offset`, faded linearly over `falloffFrames` outside the
// range. Tangent handles keep their shape: the stored handle slopes scale with the factor (offsets leave them),
// tangent types, weights and broken flags stay. Pure planning over keys; the operator writes the result.
import type { CompiledAnimCurve, CurveEngine, Frame } from '@ekza-animator/anim-core';
import type { ChannelId, ControlRecord, KeyRecord } from '@ekza-animator/doc';
import { channelDefaultOf, channelUnit } from '../edit/channelMeta';
import { SAME_FRAME_EPS } from '../edit/context';
import type { AdjustPivot } from '../operators/args';

/** The offset group of a channel: rotations and angle attributes, translations, scales, other attributes. */
export type AdjustKind = 'rotate' | 'translate' | 'scale' | 'attr';

export interface AdjustOffsets {
  readonly rotate?: number;
  readonly translate?: number;
  readonly scale?: number;
  readonly attr?: number;
}

/** Which offset of `key.adjust` applies to a channel (stored units: radians, metres, factor, attribute units). */
export function adjustKindOf(control: ControlRecord | null, channel: ChannelId): AdjustKind {
  if (channel === 'tx' || channel === 'ty' || channel === 'tz') return 'translate';
  if (channel === 'sx' || channel === 'sy' || channel === 'sz') return 'scale';
  return channelUnit(control, channel) === 'angle' ? 'rotate' : 'attr';
}

/** Where the change applies: a range with a falloff outside it, or exact frames. */
export type AdjustWhere =
  | { readonly kind: 'range'; readonly start: Frame; readonly end: Frame; readonly falloffFrames: number }
  | { readonly kind: 'frames'; readonly frames: readonly Frame[] };

/** The weight of the change at a key time: 1 inside the range (or at a frame), fading to 0 over the falloff. */
export function adjustWeight(t: Frame, where: AdjustWhere): number {
  if (where.kind === 'frames') return where.frames.some((frame) => Math.abs(frame - t) < SAME_FRAME_EPS) ? 1 : 0;
  if (t >= where.start - SAME_FRAME_EPS && t <= where.end + SAME_FRAME_EPS) return 1;
  const falloff = where.falloffFrames;
  if (!(falloff > 0)) return 0;
  const distance = t < where.start ? where.start - t : t - where.end;
  return distance >= falloff ? 0 : 1 - distance / falloff;
}

/** Integer frames of a range (the `mean` pivot samples per frame). */
export function rangeFrames(start: Frame, end: Frame): Frame[] {
  const out: Frame[] = [];
  for (let frame = Math.ceil(start - 1e-9) + 0; frame <= end + 1e-9; frame++) out.push(frame);
  return out.length > 0 ? out : [start];
}

/** The pivot value of one curve (§4.10): rest, mean over the range, value at the range start or a frame, a value. */
export function pivotValueOf(
  pivot: AdjustPivot,
  engine: CurveEngine,
  compiled: CompiledAnimCurve,
  control: ControlRecord | null,
  channel: ChannelId,
  range: { readonly start: Frame; readonly end: Frame },
): number {
  switch (pivot.kind) {
    case 'rest':
      return channelDefaultOf(control, channel);
    case 'value':
      return pivot.value;
    case 'rangeStart':
      return engine.evaluate(compiled, range.start);
    case 'frame':
      return engine.evaluate(compiled, pivot.frame);
    case 'mean': {
      const frames = rangeFrames(range.start, range.end);
      let sum = 0;
      for (const frame of frames) sum += engine.evaluate(compiled, frame);
      return sum / frames.length;
    }
  }
}

/**
 * The adjusted key, or null when it does not change: `v' = v + w·(pivot + factor·(v − pivot) + offset − v)` and the
 * handle slopes times `1 + w·(factor − 1)`.
 */
export function adjustedKey(
  key: KeyRecord,
  opts: { readonly pivot: number; readonly factor: number; readonly offset: number; readonly weight: number },
): KeyRecord | null {
  const { pivot, factor, offset, weight } = opts;
  if (weight <= 0) return null;
  const target = pivot + factor * (key.v - pivot) + offset;
  const v = key.v + weight * (target - key.v);
  const slope = 1 + weight * (factor - 1);
  if (v === key.v && slope === 1) return null;
  return {
    ...key,
    v,
    inHandle: slope === 1 ? key.inHandle : { dt: key.inHandle.dt, dv: key.inHandle.dv * slope + 0 },
    outHandle: slope === 1 ? key.outHandle : { dt: key.outHandle.dt, dv: key.outHandle.dv * slope + 0 },
  };
}

/** The offset of a channel's kind (0 when the call gives none). */
export function offsetFor(offsets: AdjustOffsets | undefined, kind: AdjustKind): number {
  return offsets?.[kind] ?? 0;
}
