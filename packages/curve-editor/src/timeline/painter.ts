// Canvas2D painters of the time slider (ADR 0007 §7, research 09 §4.9). Drawing happens in CSS px under a
// `setTransform(dpr, …)`; vertical bars are snapped to device pixels so ticks stay crisp at DPR 1 and 2.
import type { Frame } from '@ekza-animator/anim-core';
import { BAND_HALF_CELL, bandHasSpan, type FrameRange } from './band';
import type { TickSet } from './keys';
import { LABEL_STRIP, layoutFrameToX, type RulerSteps, rulerSteps, type SliderLayout } from './layout';
import type { TimelineTheme } from './theme';

/** Key ticks are 2 CSS px wide (research 09 §4.9). */
export const TICK_WIDTH = 2;
const PLAYHEAD_WIDTH = 2;
const AUTO_KEY_BORDER = 2;
const MIN_BAND_WIDTH = 4;
const LABEL_FONT_PX = 10;

export interface BaseScene {
  readonly layout: SliderLayout;
  /** Playback range (clip frames); frames outside it are shaded. */
  readonly playback: FrameRange;
  /** True when a playback range is set (draws its end markers). */
  readonly playbackMarkers: boolean;
  readonly ticks: TickSet;
  readonly band: FrameRange | null;
  readonly autoKey: boolean;
}

/** Left and right x (CSS px) of a band: its frames' cells, at least MIN_BAND_WIDTH px wide. */
export function bandExtent(layout: SliderLayout, band: FrameRange): { readonly left: number; readonly right: number } {
  let left = layoutFrameToX(layout, band.start - BAND_HALF_CELL);
  let right = layoutFrameToX(layout, band.end + BAND_HALF_CELL);
  if (right - left < MIN_BAND_WIDTH) {
    const centre = (left + right) / 2;
    left = centre - MIN_BAND_WIDTH / 2;
    right = centre + MIN_BAND_WIDTH / 2;
  }
  return { left, right };
}

/** Device-pixel snapping in CSS px. */
function snapper(dpr: number): (v: number) => number {
  return (v) => Math.round(v * dpr) / dpr;
}

/** Background, out-of-range shading, ruler, band, key ticks and the auto-key border. */
export function paintBase(ctx: CanvasRenderingContext2D, dpr: number, scene: BaseScene, theme: TimelineTheme): void {
  const { layout } = scene;
  const { width, height } = layout;
  const snap = snapper(dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  // Outside the playback range (including the side padding).
  const playStart = snap(layoutFrameToX(layout, scene.playback.start));
  const playEnd = snap(layoutFrameToX(layout, scene.playback.end));
  ctx.fillStyle = theme.outside;
  if (playStart > 0) ctx.fillRect(0, 0, Math.min(playStart, width), height);
  if (playEnd < width) ctx.fillRect(Math.max(playEnd, 0), 0, width - Math.max(playEnd, 0), height);

  paintRuler(ctx, dpr, layout, rulerSteps(layout.scale), theme);
  if (scene.playbackMarkers) paintRangeMarkers(ctx, dpr, layout, playStart, playEnd, theme);
  if (scene.band !== null) paintBand(ctx, dpr, layout, scene.band, theme);
  paintTicks(ctx, dpr, layout, scene.ticks, theme);

  if (scene.autoKey) {
    ctx.strokeStyle = theme.autoKey;
    ctx.lineWidth = AUTO_KEY_BORDER;
    ctx.strokeRect(AUTO_KEY_BORDER / 2, AUTO_KEY_BORDER / 2, width - AUTO_KEY_BORDER, height - AUTO_KEY_BORDER);
  }
}

function paintRuler(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  layout: SliderLayout,
  steps: RulerSteps,
  theme: TimelineTheme,
): void {
  const snap = snapper(dpr);
  const line = 1 / dpr;
  const { height } = layout;
  const first = layout.start;
  const last = layout.end;
  if (steps.minor !== null) {
    ctx.fillStyle = theme.rulerMinor;
    ctx.beginPath();
    for (let f = Math.ceil(first / steps.minor) * steps.minor; f <= last; f += steps.minor) {
      if (f % steps.label === 0) continue;
      ctx.rect(snap(layoutFrameToX(layout, f)), height - 4, line, 4);
    }
    ctx.fill();
  }
  ctx.fillStyle = theme.rulerMajor;
  ctx.beginPath();
  for (let f = Math.ceil(first / steps.label) * steps.label; f <= last; f += steps.label) {
    ctx.rect(snap(layoutFrameToX(layout, f)), height - 9, line, 9);
  }
  ctx.fill();
  ctx.fillStyle = theme.label;
  ctx.font = `${LABEL_FONT_PX}px ${theme.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (let f = Math.ceil(first / steps.label) * steps.label; f <= last; f += steps.label) {
    ctx.fillText(String(f), snap(layoutFrameToX(layout, f)) + 3, LABEL_FONT_PX);
  }
}

/** Brackets at the playback range ends (the range itself is edited in the range slider). */
function paintRangeMarkers(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  layout: SliderLayout,
  startX: number,
  endX: number,
  theme: TimelineTheme,
): void {
  const line = 1 / dpr;
  const { height } = layout;
  ctx.fillStyle = theme.rangeMarker;
  ctx.beginPath();
  ctx.rect(startX, LABEL_STRIP, line, height - LABEL_STRIP);
  ctx.rect(startX, height - 2, 4, 2);
  ctx.rect(endX, LABEL_STRIP, line, height - LABEL_STRIP);
  ctx.rect(endX - 4 + line, height - 2, 4, 2);
  ctx.fill();
}

function paintBand(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  layout: SliderLayout,
  band: FrameRange,
  theme: TimelineTheme,
): void {
  const snap = snapper(dpr);
  const { left, right } = bandExtent(layout, band);
  const x0 = snap(left);
  const x1 = snap(right);
  ctx.fillStyle = theme.band;
  ctx.fillRect(x0, 0, x1 - x0, layout.height);
  // Draggable ends are 2 px wide; a 1-frame band (move only) gets hairlines.
  const edge = bandHasSpan(band) ? 2 : 1 / dpr;
  ctx.fillStyle = theme.bandEdge;
  ctx.fillRect(x0, 0, edge, layout.height);
  ctx.fillRect(x1 - edge, 0, edge, layout.height);
}

function paintTicks(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  layout: SliderLayout,
  ticks: TickSet,
  theme: TimelineTheme,
): void {
  const snap = snapper(dpr);
  const top = Math.min(LABEL_STRIP, layout.height);
  const tall = layout.height - top;
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0 ? theme.keyTick : theme.keySelected;
    ctx.beginPath();
    for (let i = 0; i < ticks.times.length; i++) {
      if (ticks.selected[i] !== pass) continue;
      const x = layoutFrameToX(layout, ticks.times[i]!);
      if (x < -TICK_WIDTH || x > layout.width + TICK_WIDTH) continue;
      ctx.rect(snap(x - TICK_WIDTH / 2), top, TICK_WIDTH, tall);
    }
    ctx.fill();
  }
}

/** Label of a frame: whole frames as integers, otherwise two decimals. */
export function formatFrame(frame: Frame): string {
  const whole = Math.round(frame);
  return Math.abs(frame - whole) < 1e-6 ? String(whole) : frame.toFixed(2);
}

/** The playhead's frame label, measured once per frame value (the playhead is drawn every playback frame). */
export interface PlayheadBadge {
  frame: Frame;
  text: string;
  /** Badge width in CSS px (text + padding). */
  width: number;
  font: string;
}

export function badgeFont(theme: TimelineTheme): string {
  return `600 ${LABEL_FONT_PX}px ${theme.font}`;
}

/** Updates `badge` for `frame` in `font`; measures only when the text or the font changed. */
export function updateBadge(ctx: CanvasRenderingContext2D, badge: PlayheadBadge, frame: Frame, font: string): void {
  if (badge.frame === frame && badge.font === font) return;
  const text = formatFrame(frame);
  badge.frame = frame;
  if (text === badge.text && badge.font === font) return;
  badge.text = text;
  badge.font = font;
  ctx.font = font;
  badge.width = Math.ceil(ctx.measureText(text).width) + 6;
}

/** The playhead line and its frame badge in the label strip. Allocation-free (runs every playback frame). */
export function paintPlayhead(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  layout: SliderLayout,
  frame: Frame,
  badge: PlayheadBadge,
  theme: TimelineTheme,
): void {
  const x = layoutFrameToX(layout, frame);
  if (x < -40 || x > layout.width + 40) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.playhead;
  ctx.fillRect(Math.round((x - PLAYHEAD_WIDTH / 2) * dpr) / dpr, 0, PLAYHEAD_WIDTH, layout.height);
  const bx =
    Math.round(Math.min(Math.max(x - badge.width / 2, 0), Math.max(layout.width - badge.width, 0)) * dpr) / dpr;
  ctx.fillRect(bx, 0, badge.width, Math.min(LABEL_STRIP, layout.height));
  ctx.font = badge.font;
  ctx.fillStyle = theme.playheadText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(badge.text, bx + badge.width / 2, LABEL_FONT_PX);
}
