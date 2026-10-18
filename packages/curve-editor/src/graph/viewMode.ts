// Normalized and stacked Graph Editor views (M2A-SPEC §5.15.2): each curve is drawn as y' = 2·(v − m)/(M − m) − 1,
// [m, M] being the curve's min and max over its key range (keys plus the extrema of each span's Bézier); a flat curve
// draws at 0. Stacked views give every curve its own lane. The data never changes: the mapping is an affine
// `drawn = v · scale + offset` per curve (`CurveEntry.scale`/`offset`), so painting, hit-testing, framing and drag
// conversions all go through it.
import { Segment } from '@ekza-animator/anim-core';
import type { GraphViewMode, GraphViewState } from '../types';
import { VIEW_LIMITS } from '../view/transform';
import type { CurveEntry } from './curveSet';
import { segmentBezier, segmentKind } from './geometry';

/** Value units per stacked lane: a normalized curve spans 2 of them, the rest is margin. */
export const STACK_LANE = 3;
/** Smallest lane height (CSS px); more lanes than fit scroll vertically. */
export const STACK_MIN_LANE_PX = 40;
/** A curve whose range is below this (in its absolute display units) is flat and draws at 0. */
export const FLAT_RANGE = 1e-9;

/** Min and max of a curve's values over its key range, in curve units. */
export interface CurveRange {
  readonly min: number;
  readonly max: number;
}

/** Extrema of the cubic p0…p3 on u ∈ (0, 1) added to `acc` (roots of the derivative). */
function bezierExtrema(p0: number, p1: number, p2: number, p3: number, acc: { min: number; max: number }): void {
  // B'(u)/3 = a·u² + b·u + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const visit = (u: number): void => {
    if (!(u > 0 && u < 1)) return;
    const w = 1 - u;
    const value = w * w * w * p0 + 3 * w * w * u * p1 + 3 * w * u * u * p2 + u * u * u * p3;
    if (value < acc.min) acc.min = value;
    if (value > acc.max) acc.max = value;
  };
  if (Math.abs(a) < 1e-15) {
    if (Math.abs(b) > 1e-15) visit(-c / b);
    return;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return;
  const root = Math.sqrt(disc);
  visit((-b + root) / (2 * a));
  visit((-b - root) / (2 * a));
}

/** The curve's value range over its key range (keys and Bézier extrema); null without keys. */
export function curveRange(entry: CurveEntry, scratch: Float64Array): CurveRange | null {
  const c = entry.compiled;
  if (c.keyCount === 0) return null;
  const acc = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
  for (let i = 0; i < c.keyCount; i++) {
    const v = c.v[i] as number;
    if (v < acc.min) acc.min = v;
    if (v > acc.max) acc.max = v;
    if (i + 1 >= c.keyCount) continue;
    const kind = segmentKind(c, i);
    if (kind !== Segment.Hermite && kind !== Segment.Bezier) continue;
    segmentBezier(c, i, scratch);
    bezierExtrema(scratch[1] as number, scratch[3] as number, scratch[5] as number, scratch[7] as number, acc);
  }
  return Number.isFinite(acc.min) && Number.isFinite(acc.max) ? { min: acc.min, max: acc.max } : null;
}

/**
 * Sets each entry's drawn mapping for `mode`: absolute = its display units; normalized = −1…1 from its range;
 * stacked = normalized and shifted down by one lane per curve (lane 0 at the top, centred on 0).
 */
export function applyViewMapping(
  entries: readonly CurveEntry[],
  mode: GraphViewMode,
  rangeOf: (entry: CurveEntry) => CurveRange | null,
): void {
  entries.forEach((entry, lane) => {
    const k = entry.unitScale;
    if (mode === 'absolute') {
      entry.scale = k;
      entry.offset = 0;
      return;
    }
    const range = rangeOf(entry);
    const min = (range?.min ?? 0) * k;
    const span = ((range?.max ?? 0) - (range?.min ?? 0)) * k;
    if (span < FLAT_RANGE) {
      // Flat: drawn at 0, edited in its own display units.
      entry.scale = k;
      entry.offset = -min;
    } else {
      entry.scale = (2 * k) / span;
      entry.offset = (-2 * min) / span - 1;
    }
    if (mode === 'stacked') entry.offset -= lane * STACK_LANE;
  });
}

/** The vertical part of a stacked view: lanes fill the height (at least STACK_MIN_LANE_PX each), lane 0 at the top. */
export function stackedVertical(lanes: number, height: number): { readonly v0: number; readonly sy: number } {
  const count = Math.max(1, lanes);
  const fill = height > 0 ? height / (count * STACK_LANE) : STACK_MIN_LANE_PX / STACK_LANE;
  const sy = Math.min(Math.max(fill, STACK_MIN_LANE_PX / STACK_LANE, VIEW_LIMITS.minSy), VIEW_LIMITS.maxSy);
  // y = H − (d − v0)·sy; the top edge (y = 0) shows the top of lane 0: d = STACK_LANE / 2.
  return { v0: STACK_LANE / 2 - height / sy, sy };
}

/** The value range of a lane: its centre is −lane · STACK_LANE. */
export function laneOfValue(value: number): number {
  return Math.floor((STACK_LANE / 2 - value) / STACK_LANE);
}

/** Keeps a stacked view's vertical scroll inside the lanes. */
export function clampStackedScroll(view: GraphViewState, lanes: number, height: number): GraphViewState {
  const top = STACK_LANE / 2 - height / view.sy; // v0 with lane 0 at the top
  const contentPx = Math.max(1, lanes) * STACK_LANE * view.sy;
  if (contentPx <= height) return { ...view, v0: top };
  const lowest = top - (contentPx - height) / view.sy;
  return { ...view, v0: Math.min(Math.max(view.v0, lowest), top) };
}
