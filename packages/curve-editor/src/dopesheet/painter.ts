// Canvas2D painter of the Dope Sheet (M2A-SPEC §5.10, research 09 §4.8): rows with glyphs (◆ key, ◇ breakdown,
// yellow when selected, a yellow outline when partly selected), hold bars, stepped hatching, the ruler, the region
// bar, the playhead, playback-range shading and the marquee. Only visible rows and visible frames are drawn; glyphs
// of one style share one path (of rects in a rotated frame, see `diamond`).
import type { Frame } from '@ekza-animator/anim-core';
import { rulerSteps } from '../timeline/layout';
import type { DopeSheetRow, DopeSheetViewState } from '../types';
import type { DopeSheetData, RowGlyphs } from './data';
import { frameToX, GLYPH_RADIUS, REGION_HEIGHT, ROW_HEIGHT, ROWS_TOP, RULER_HEIGHT, rowTop, xToFrame } from './layout';
import type { DopeSheetTheme } from './theme';

const HOLD_HEIGHT = 4;
const LABEL_FONT_PX = 10;
const PLAYHEAD_WIDTH = 2;
const HANDLE_WIDTH = 4;

export interface DopeSheetScene {
  readonly width: number;
  readonly height: number;
  readonly view: DopeSheetViewState;
  readonly rows: readonly DopeSheetRow[];
  readonly data: DopeSheetData;
  /** Frames outside it are shaded (clip frames); null without a clip. */
  readonly playback: { readonly start: Frame; readonly end: Frame } | null;
  readonly playhead: Frame | null;
  /** The region bar (the selected keys' min…max), or null without selected keys. */
  readonly region: { readonly start: Frame; readonly end: Frame } | null;
  /** Marquee rectangle in canvas CSS px, or null. */
  readonly marquee: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
}

/** The first and last visible row index (inclusive; last < first when none is visible). */
export function visibleRows(scene: Pick<DopeSheetScene, 'height' | 'view' | 'rows'>): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scene.view.scrollY / ROW_HEIGHT));
  const last = Math.min(
    scene.rows.length - 1,
    Math.floor((scene.view.scrollY + Math.max(scene.height - ROWS_TOP, 0)) / ROW_HEIGHT),
  );
  return { first, last };
}

/** Index of the first time ≥ `frame` in ascending `times`. */
function lowerBound(times: Float64Array, frame: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((times[mid] as number) < frame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Adds a diamond of radius `r` (corner distance) centred on (x, y) to a glyph path. Glyph paths are built in a frame
 * rotated by −45° and drawn with `GLYPH_FRAME`, so each diamond is one `rect`: Chrome builds a few thousand rects in
 * well under a millisecond, while the same diamonds as four-line polygons took ~5 µs each (§5.22 redraw budget).
 */
function diamond(path: Path2D, x: number, y: number, r: number): void {
  const half = r * Math.SQRT1_2;
  path.rect((x + y) * Math.SQRT1_2 - half, (y - x) * Math.SQRT1_2 - half, 2 * half, 2 * half);
}

/** Sets the transform glyph paths are drawn with: CSS px at `dpr`, rotated by 45° (see `diamond`). */
function glyphFrame(ctx: CanvasRenderingContext2D, dpr: number): void {
  const c = dpr * Math.SQRT1_2;
  ctx.setTransform(c, c, -c, c, 0, 0);
}

export function paintDopeSheet(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  scene: DopeSheetScene,
  theme: DopeSheetTheme,
): void {
  const { width, height, view } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  const snap = (v: number): number => Math.round(v * dpr) / dpr;

  // Rows (clipped below the strips).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, ROWS_TOP, width, Math.max(height - ROWS_TOP, 0));
  ctx.clip();
  const { first, last } = visibleRows(scene);
  const frameFrom = xToFrame(view, -GLYPH_RADIUS * 2);
  const frameTo = xToFrame(view, width + GLYPH_RADIUS * 2);
  const keyFill = new Path2D();
  const selectedFill = new Path2D();
  const breakdownStroke = new Path2D();
  const breakdownSelected = new Path2D();
  const partial = new Path2D();
  const holds = new Path2D();
  const hatch = new Path2D();
  for (let i = first; i <= last; i++) {
    const row = scene.rows[i] as DopeSheetRow;
    const top = rowTop(view, i);
    if (row.kind === 'summary') {
      ctx.fillStyle = theme.summaryRow;
      ctx.fillRect(0, top, width, ROW_HEIGHT);
    } else if (i % 2 === 1) {
      ctx.fillStyle = theme.rowAlt;
      ctx.fillRect(0, top, width, ROW_HEIGHT);
    }
    const cy = top + ROW_HEIGHT / 2;
    for (const [t0, t1] of scene.data.holds(row)) {
      if (t1 < frameFrom || t0 > frameTo) continue;
      const x0 = frameToX(view, t0) + GLYPH_RADIUS;
      const x1 = frameToX(view, t1) - GLYPH_RADIUS;
      if (x1 > x0) holds.rect(x0, cy - HOLD_HEIGHT / 2, x1 - x0, HOLD_HEIGHT);
    }
    for (const [t0, t1] of scene.data.stepped(row)) {
      if (t1 < frameFrom || t0 > frameTo) continue;
      const x0 = Math.max(frameToX(view, t0) + GLYPH_RADIUS, 0);
      const x1 = Math.min(frameToX(view, t1) - GLYPH_RADIUS, width);
      for (let x = Math.ceil(x0 / 6) * 6; x < x1; x += 6) {
        hatch.moveTo(x, cy + 3);
        hatch.lineTo(Math.min(x + 4, x1), cy - 3);
      }
    }
    const glyphs: RowGlyphs = scene.data.glyphs(row);
    const r = row.dimmed ? GLYPH_RADIUS - 1 : GLYPH_RADIUS;
    for (let k = lowerBound(glyphs.times, frameFrom); k < glyphs.times.length; k++) {
      const t = glyphs.times[k] as number;
      if (t > frameTo) break;
      const x = snap(frameToX(view, t));
      const total = glyphs.total[k] as number;
      const breakdown = (glyphs.breakdowns[k] as number) === total;
      const selected = glyphs.selected[k] as number;
      const all = selected === total;
      if (breakdown) diamond(all ? breakdownSelected : breakdownStroke, x, cy, r - 0.75);
      else diamond(all ? selectedFill : keyFill, x, cy, r);
      if (selected > 0 && !all) diamond(partial, x, cy, r + 1.5);
    }
  }
  ctx.fillStyle = theme.hold;
  ctx.globalAlpha = 0.7;
  ctx.fill(holds);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.hatch;
  ctx.lineWidth = 1;
  ctx.stroke(hatch);
  glyphFrame(ctx, dpr);
  ctx.fillStyle = theme.key;
  ctx.fill(keyFill);
  ctx.fillStyle = theme.keySelected;
  ctx.fill(selectedFill);
  ctx.lineWidth = 1.5;
  ctx.fillStyle = theme.background;
  ctx.fill(breakdownStroke);
  ctx.strokeStyle = theme.keyBreakdown;
  ctx.stroke(breakdownStroke);
  ctx.fillStyle = theme.keyBreakdown;
  ctx.fill(breakdownSelected);
  ctx.strokeStyle = theme.keySelected;
  ctx.stroke(breakdownSelected);
  ctx.lineWidth = 1;
  ctx.stroke(partial);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Rows that are dimmed (controls hidden by the IK/FK rule) get a veil.
  for (let i = first; i <= last; i++) {
    if (!(scene.rows[i] as DopeSheetRow).dimmed) continue;
    ctx.fillStyle = 'rgba(23,24,27,0.45)';
    ctx.fillRect(0, rowTop(view, i), width, ROW_HEIGHT);
  }
  ctx.restore();

  // Playback range shading (rows and strips).
  if (scene.playback !== null) {
    const a = frameToX(view, scene.playback.start);
    const b = frameToX(view, scene.playback.end);
    ctx.fillStyle = theme.outside;
    if (a > 0) ctx.fillRect(0, RULER_HEIGHT, Math.min(a, width), height - RULER_HEIGHT);
    if (b < width) ctx.fillRect(Math.max(b, 0), RULER_HEIGHT, width - Math.max(b, 0), height - RULER_HEIGHT);
  }

  // Ruler.
  ctx.fillStyle = theme.ruler;
  ctx.fillRect(0, 0, width, RULER_HEIGHT);
  const steps = rulerSteps(view.sx);
  const firstLabel = Math.ceil(xToFrame(view, 0) / steps.label) * steps.label;
  const lastFrame = xToFrame(view, width);
  ctx.fillStyle = theme.rulerTick;
  ctx.beginPath();
  if (steps.minor !== null) {
    for (let f = Math.ceil(xToFrame(view, 0) / steps.minor) * steps.minor; f <= lastFrame; f += steps.minor) {
      ctx.rect(snap(frameToX(view, f)), RULER_HEIGHT - 4, 1 / dpr, 4);
    }
  }
  for (let f = firstLabel; f <= lastFrame; f += steps.label)
    ctx.rect(snap(frameToX(view, f)), RULER_HEIGHT - 9, 1 / dpr, 9);
  ctx.fill();
  ctx.fillStyle = theme.label;
  ctx.font = `${LABEL_FONT_PX}px ${theme.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (let f = firstLabel; f <= lastFrame; f += steps.label) ctx.fillText(String(f), snap(frameToX(view, f)) + 3, 11);

  // Region strip and bar.
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, RULER_HEIGHT, width, REGION_HEIGHT);
  ctx.fillStyle = theme.line;
  ctx.fillRect(0, ROWS_TOP - 1 / dpr, width, 1 / dpr);
  if (scene.region !== null) {
    const x0 = snap(frameToX(view, scene.region.start));
    const x1 = snap(frameToX(view, scene.region.end));
    ctx.fillStyle = theme.region;
    ctx.fillRect(x0, RULER_HEIGHT + 2, Math.max(x1 - x0, 1), REGION_HEIGHT - 4);
    ctx.fillStyle = theme.regionEdge;
    ctx.fillRect(x0 - HANDLE_WIDTH / 2, RULER_HEIGHT + 1, HANDLE_WIDTH, REGION_HEIGHT - 2);
    ctx.fillRect(x1 - HANDLE_WIDTH / 2, RULER_HEIGHT + 1, HANDLE_WIDTH, REGION_HEIGHT - 2);
  }

  // Playhead.
  if (scene.playhead !== null) {
    const x = frameToX(view, scene.playhead);
    if (x >= -PLAYHEAD_WIDTH && x <= width + PLAYHEAD_WIDTH) {
      ctx.fillStyle = theme.playhead;
      ctx.fillRect(snap(x - PLAYHEAD_WIDTH / 2), 0, PLAYHEAD_WIDTH, height);
    }
  }

  // Marquee.
  if (scene.marquee !== null) {
    const { x0, y0, x1, y1 } = scene.marquee;
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    ctx.fillStyle = theme.marqueeFill;
    ctx.fillRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeStyle = theme.marqueeStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
}
