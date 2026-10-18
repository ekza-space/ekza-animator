// Graph view transform (MVP-SPEC §4.7, ADR 0007): x = (frame − f0)·sx ; y = H − (displayValue − v0)·sy.
// Frames are active-clip frames; display values are degrees for rotation channels and curve units otherwise.
import { RAD2DEG } from '@ekza-animator/anim-core';
import type { ChannelId } from '@ekza-animator/doc';
import type { ChannelUnit } from '@ekza-animator/editor-core';
import type { GraphViewState } from '../types';

/** Zoom limits: px per frame and px per display unit. */
export const VIEW_LIMITS = { minSx: 1e-3, maxSx: 2e4, minSy: 1e-6, maxSy: 1e7 } as const;

/** The view a controller starts with before it has curves to frame: frames 0…60, values −90…90. */
export const DEFAULT_VIEW: GraphViewState = { f0: -2, v0: -100, sx: 8, sy: 1.2 };

/**
 * Display units per curve unit: degrees for angles, 1 otherwise. A given `unit` (M2A-SPEC §4.5: callers that know the
 * control pass `channelUnit(control, channel)`) wins; without it the M1 rule: degrees for `rx`/`ry`/`rz`, 1 for
 * translation, scale and custom channels.
 */
export function channelDisplayScale(channel: ChannelId, unit?: ChannelUnit): number {
  if (unit !== undefined) return unit === 'angle' ? RAD2DEG : 1;
  return channel === 'rx' || channel === 'ry' || channel === 'rz' ? RAD2DEG : 1;
}

export function frameToX(view: GraphViewState, frame: number): number {
  return (frame - view.f0) * view.sx;
}

export function xToFrame(view: GraphViewState, x: number): number {
  return view.f0 + x / view.sx;
}

/** `display` is a display value (degrees for rotations); `height` is the canvas CSS height. */
export function valueToY(view: GraphViewState, height: number, display: number): number {
  return height - (display - view.v0) * view.sy;
}

export function yToValue(view: GraphViewState, height: number, y: number): number {
  return view.v0 + (height - y) / view.sy;
}

const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi);

/** Pans by a pointer delta in CSS px: the content follows the pointer. */
export function panView(view: GraphViewState, dx: number, dy: number): GraphViewState {
  return { f0: view.f0 - dx / view.sx, v0: view.v0 + dy / view.sy, sx: view.sx, sy: view.sy };
}

/**
 * Scales the view by `fx` (time) and `fy` (value) around the anchor point (CSS px): the frame and value under the
 * anchor stay under it. Factors > 1 zoom in. The result respects VIEW_LIMITS.
 */
export function zoomView(
  view: GraphViewState,
  height: number,
  anchorX: number,
  anchorY: number,
  fx: number,
  fy: number,
): GraphViewState {
  const frame = xToFrame(view, anchorX);
  const value = yToValue(view, height, anchorY);
  const sx = clamp(view.sx * fx, VIEW_LIMITS.minSx, VIEW_LIMITS.maxSx);
  const sy = clamp(view.sy * fy, VIEW_LIMITS.minSy, VIEW_LIMITS.maxSy);
  return { f0: frame - anchorX / sx, v0: value - (height - anchorY) / sy, sx, sy };
}

/** Frame and display-value extents (inclusive). */
export interface ViewBounds {
  readonly f0: number;
  readonly f1: number;
  readonly v0: number;
  readonly v1: number;
}

/**
 * The view that shows `bounds` with `padding` (fraction of the extent on each side). A degenerate axis (a single
 * key, a flat curve) keeps the current scale of that axis and centres on the bounds.
 */
export function fitView(
  current: GraphViewState,
  bounds: ViewBounds,
  width: number,
  height: number,
  padding = 0.08,
): GraphViewState {
  const fit = (lo: number, hi: number, px: number, scale: number, min: number, max: number) => {
    const extent = hi - lo;
    if (!(extent > 1e-9) || !(px > 0)) return { start: (lo + hi) / 2 - px / (2 * scale), scale };
    const padded = extent * (1 + 2 * padding);
    const s = clamp(px / padded, min, max);
    return { start: (lo + hi) / 2 - px / (2 * s), scale: s };
  };
  const t = fit(bounds.f0, bounds.f1, width, current.sx, VIEW_LIMITS.minSx, VIEW_LIMITS.maxSx);
  const v = fit(bounds.v0, bounds.v1, height, current.sy, VIEW_LIMITS.minSy, VIEW_LIMITS.maxSy);
  return { f0: t.start, v0: v.start, sx: t.scale, sy: v.scale };
}

/** True when both views are equal within 1e-12 relative tolerance. */
export function sameView(a: GraphViewState, b: GraphViewState): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x), Math.abs(y));
  return near(a.f0, b.f0) && near(a.v0, b.v0) && near(a.sx, b.sx) && near(a.sy, b.sy);
}
