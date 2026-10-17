// Time-slider band arithmetic (MVP-SPEC §4.11.3, §4.11.17): pure functions in active-clip frames.
import type { Frame } from '@ekza-animator/anim-core';

/** A closed frame range; `start <= end` once normalized. The time-slider band and playback ranges use it. */
export interface FrameRange {
  readonly start: Frame;
  readonly end: Frame;
}

/**
 * Each banded frame owns the cell [f − ½, f + ½): a band covers [start − ½, end + ½) in frames. A 1-frame band is
 * one cell wide, and a key whose tick is drawn inside the band is a key of the band.
 */
export const BAND_HALF_CELL = 0.5;
/** `scaleKeys` refuses smaller factors (§4.11.3). */
export const MIN_SCALE_FACTOR = 0.01;
const EPS = 1e-9;

export function makeBand(a: Frame, b: Frame): FrameRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function sameRange(a: FrameRange | null, b: FrameRange | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end;
}

export function bandContains(band: FrameRange, t: Frame): boolean {
  return t >= band.start - BAND_HALF_CELL - EPS && t < band.end + BAND_HALF_CELL - EPS;
}

/** True when the band spans more than one frame, so its ends can be dragged to scale. */
export function bandHasSpan(band: FrameRange): boolean {
  return band.end - band.start > EPS;
}

export function snapFrame(frame: Frame, snap: boolean): Frame {
  return snap ? Math.round(frame) : frame;
}

/** Frames to move a band dragged from `origin` to `current`; whole frames when snapping, so integer keys stay integer. */
export function bandMoveDelta(origin: Frame, current: Frame, snap: boolean): number {
  const delta = current - origin;
  // `+ 0` turns a rounded −0 into 0 so callers can compare deltas with ===.
  return (snap ? Math.round(delta) : delta) + 0;
}

export function shiftBand(band: FrameRange, delta: number): FrameRange {
  return { start: band.start + delta, end: band.end + delta };
}

export interface BandScale {
  /** The opposite band end; it stays in place. */
  readonly pivot: Frame;
  /** `t' = pivot + (t − pivot) · factor`, never below MIN_SCALE_FACTOR. */
  readonly factor: number;
  /** The band after scaling (the dragged end follows the pointer). */
  readonly band: FrameRange;
}

/**
 * Scaling by dragging one band end to `edge` (frames): the opposite end is the pivot. The dragged end never crosses
 * the pivot; when snapping it lands on a whole frame at least one frame (and at least MIN_SCALE_FACTOR of the span)
 * away from the pivot. Null for a band without span (a 1-frame band only moves).
 */
export function bandScale(band: FrameRange, side: 'start' | 'end', edge: Frame, snap: boolean): BandScale | null {
  if (!bandHasSpan(band)) return null;
  const pivot = side === 'end' ? band.start : band.end;
  const from = side === 'end' ? band.end : band.start;
  const span = from - pivot;
  const direction = Math.sign(span);
  let reach = (snapFrame(edge, snap) - pivot) * direction;
  const minReach = Math.abs(span) * MIN_SCALE_FACTOR;
  if (reach < minReach) reach = minReach;
  if (snap) reach = Math.max(1, Math.ceil(reach - EPS));
  const to = pivot + direction * reach;
  const factor = reach / Math.abs(span);
  return { pivot, factor, band: makeBand(pivot, to) };
}
