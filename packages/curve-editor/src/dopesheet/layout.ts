// Dope Sheet geometry (M2A-SPEC §5.10, research 09 §4.8): the ruler strip at the top, the region-bar strip under
// it, then one row per Dope Sheet row. x = (frame − f0)·sx; row i's top = ROWS_TOP + i·ROW_HEIGHT − scrollY.
import type { Frame } from '@ekza-studio/anim-core';
import type { DopeSheetViewState } from '../types';

/** Height of the ruler strip (frame labels; click/drag scrubs). CSS px. */
export const RULER_HEIGHT = 20;
/** Height of the region-bar strip under the ruler (the selected keys' min…max with end handles). */
export const REGION_HEIGHT = 12;
/** First row's top at scrollY 0. */
export const ROWS_TOP = RULER_HEIGHT + REGION_HEIGHT;
/** Row height (the DOM label column uses the same). */
export const ROW_HEIGHT = 20;
/** Half the glyph's width (a diamond 9 px wide). */
export const GLYPH_RADIUS = 4.5;
/** Hit tolerances (CSS px) for the mouse. */
export const GLYPH_HIT_PX = 6;
export const REGION_HANDLE_PX = 6;
/** Pixels a press travels before it becomes a drag, for the mouse. */
export const DRAG_THRESHOLD_PX = 3;
/**
 * The Dope Sheet's tolerances of the pointer in use: the mouse's until its controller sees a pen or a finger
 * (`setDopeSheetPointer` in `../painters/pointer`, STUDIO-TOUCH-SPEC §5.4).
 */
export const DOPE_TOLERANCE = { glyphPx: GLYPH_HIT_PX, regionHandlePx: REGION_HANDLE_PX, dragPx: DRAG_THRESHOLD_PX };
/** `F` / `A` padding on each side (§4.9 `dopeSheet.frame`: 8 %). */
export const FRAME_PADDING = 0.08;
/** Zoom limits (CSS px per frame). */
export const MIN_SX = 0.05;
export const MAX_SX = 400;

export const DEFAULT_DOPE_VIEW: DopeSheetViewState = { f0: -2, sx: 10, scrollY: 0 };

export function frameToX(view: DopeSheetViewState, frame: Frame): number {
  return (frame - view.f0) * view.sx;
}

export function xToFrame(view: DopeSheetViewState, x: number): Frame {
  return view.f0 + x / view.sx;
}

/** Top of row `index` (CSS px). */
export function rowTop(view: DopeSheetViewState, index: number): number {
  return ROWS_TOP + index * ROW_HEIGHT - view.scrollY;
}

/** Index of the row under y, or -1 above the rows. */
export function rowAt(view: DopeSheetViewState, y: number): number {
  if (y < ROWS_TOP) return -1;
  return Math.floor((y - ROWS_TOP + view.scrollY) / ROW_HEIGHT);
}

/** The view that shows frames `[start, end]` across `width` with `padding` of the span on each side. */
export function fitFrames(
  view: DopeSheetViewState,
  width: number,
  start: Frame,
  end: Frame,
  padding = FRAME_PADDING,
): DopeSheetViewState {
  const span = Math.max(end - start, 1);
  const total = span * (1 + 2 * padding);
  const sx = clampScale(Math.max(width, 1) / total);
  return { ...view, f0: start - span * padding, sx };
}

export function clampScale(sx: number): number {
  return Math.min(Math.max(sx, MIN_SX), MAX_SX);
}

/** Zoom time by `factor` around canvas x. */
export function zoomAt(view: DopeSheetViewState, x: number, factor: number): DopeSheetViewState {
  const frame = xToFrame(view, x);
  const sx = clampScale(view.sx * factor);
  return { ...view, sx, f0: frame - x / sx };
}

/** Scroll rows to `scrollY`, clamped so the last row can reach the top of the rows area. */
export function clampScroll(scrollY: number, rowCount: number, height: number): number {
  const content = rowCount * ROW_HEIGHT;
  const visible = Math.max(height - ROWS_TOP, 0);
  const max = Math.max(content - visible, 0);
  return Math.min(Math.max(scrollY, 0), max);
}

export function sameDopeView(a: DopeSheetViewState, b: DopeSheetViewState): boolean {
  return a.f0 === b.f0 && a.sx === b.sx && a.scrollY === b.scrollY;
}
