// Overlay layer (ADR 0007 §2): playhead, hover highlight, marquee and drag readout. Redrawn on pointer moves and
// playback without touching the base layer.
import { type RegionBox, regionHandlePointOf } from '../graph/region';
import type { GraphScene } from '../graph/scene';
import { frameToX } from '../view/transform';
import { crisp } from './canvas';
import { GRAPH_METRICS, type GraphTheme } from './theme';

export interface OverlayState {
  /** Hovered key, handle or curve point in CSS px. */
  readonly hover: { readonly kind: 'key' | 'handle' | 'curve'; readonly x: number; readonly y: number } | null;
  readonly marquee: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
  /** Short text next to the pointer during a drag (e.g. the frame and value offsets). */
  readonly readout: { readonly text: string; readonly x: number; readonly y: number } | null;
}

export function paintOverlay(
  ctx: CanvasRenderingContext2D,
  scene: GraphScene,
  state: OverlayState,
  theme: GraphTheme,
): void {
  if (scene.playhead !== null) {
    const x = crisp(frameToX(scene.view, scene.playhead));
    if (x >= -1 && x <= scene.width + 1) {
      ctx.strokeStyle = theme.playhead;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scene.height);
      ctx.stroke();
    }
  }
  const region = scene.region;
  if (region !== null) paintRegion(ctx, region, theme);
  const hover = state.hover;
  if (hover !== null) {
    ctx.strokeStyle = theme.hover;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const r = hover.kind === 'key' ? GRAPH_METRICS.keySelected / 2 + 2 : GRAPH_METRICS.handleRadius + 3;
    if (hover.kind === 'key') ctx.rect(hover.x - r, hover.y - r, 2 * r, 2 * r);
    else ctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const marquee = state.marquee;
  if (marquee !== null) {
    const x = Math.min(marquee.x0, marquee.x1);
    const y = Math.min(marquee.y0, marquee.y1);
    const w = Math.abs(marquee.x1 - marquee.x0);
    const h = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillStyle = theme.marqueeFill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = theme.marqueeStroke;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(crisp(x), crisp(y), Math.round(w), Math.round(h));
    ctx.setLineDash([]);
  }
  const readout = state.readout;
  if (readout !== null) {
    ctx.font = theme.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = theme.hover;
    ctx.fillText(readout.text, readout.x + 12, readout.y - 6);
  }
}

/** Handle squares of the region box (CSS px). */
const REGION_HANDLE = 6;

/** M2a §5.15.3: the scale tool's region box with its edge and corner handles. */
function paintRegion(ctx: CanvasRenderingContext2D, region: RegionBox, theme: GraphTheme): void {
  // A box of a single key time or value still shows: at least 2 px wide and tall.
  const x = Math.min(region.x0, (region.x0 + region.x1) / 2 - 1);
  const y = Math.min(region.y0, (region.y0 + region.y1) / 2 - 1);
  const w = Math.max(region.x1 - region.x0, 2);
  const h = Math.max(region.y1 - region.y0, 2);
  ctx.strokeStyle = theme.marqueeStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(crisp(x), crisp(y), Math.round(w), Math.round(h));
  ctx.setLineDash([]);
  ctx.fillStyle = theme.keySelected;
  const r = REGION_HANDLE / 2;
  for (const handle of ['left', 'right', 'top', 'bottom', 'tl', 'tr', 'bl', 'br'] as const) {
    const p = regionHandlePointOf(region, handle);
    ctx.fillRect(Math.round(p.x - r), Math.round(p.y - r), REGION_HANDLE, REGION_HANDLE);
  }
}
