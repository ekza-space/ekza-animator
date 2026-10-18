// Keys and tangent handles (research 09 §4.7): squares 5/7 px (selected yellow), handles as lines with 4 px ends,
// only for keys with a selected part unless prefs.graphHandles is 'all'. One Path2D per state (ADR 0007 §4).
import type { CurveEntry } from '../graph/curveSet';
import { visibleRange } from '../graph/geometry';
import { type GraphScene, handlePositionAt, keyX, type Point } from '../graph/scene';
import { xToFrame } from '../view/transform';
import { GRAPH_METRICS, type GraphTheme } from './theme';

export function paintHandles(
  ctx: CanvasRenderingContext2D,
  scene: GraphScene,
  theme: GraphTheme,
  p: Point,
  include: ((entry: CurveEntry) => boolean) | null = null,
): void {
  const lines = new Path2D();
  const selectedLines = new Path2D();
  const ends = new Path2D();
  const selectedEnds = new Path2D();
  const brokenEnds = new Path2D();
  const r = GRAPH_METRICS.handleRadius;
  const f0 = xToFrame(scene.view, -GRAPH_METRICS.handleLength);
  const f1 = xToFrame(scene.view, scene.width + GRAPH_METRICS.handleLength);
  const all = scene.handles === 'all';
  const { f0: viewF0, v0: viewV0, sx, sy } = scene.view;
  const height = scene.height;
  for (const entry of scene.curves.entries) {
    if (entry.locked || (include !== null && !include(entry))) continue;
    const c = entry.compiled;
    const k = entry.scale;
    const o = entry.offset;
    const [lo, hi] = visibleRange(c, f0, f1);
    for (let i = lo; i <= hi; i++) {
      const key = entry.keys[i];
      if (key === undefined) continue;
      // One selection lookup per key: it decides whether the handles show (handlesShown) and which parts are lit.
      const parts = scene.selection.get(key.id);
      if (!all && parts === undefined) continue;
      // keyX / keyY written out (same operations): this loop runs for every dragged key on every frame (M-1).
      const kx = ((c.t[i] as number) - viewF0) * sx;
      const ky = height - ((c.v[i] as number) * k + o - viewV0) * sy;
      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? 'in' : 'out';
        handlePositionAt(scene, entry, i, side, kx, ky, p);
        const selected = parts?.[side] === true;
        const line = selected ? selectedLines : lines;
        line.moveTo(kx, ky);
        line.lineTo(p.x, p.y);
        if (key.broken && !selected) brokenEnds.rect(p.x - r, p.y - r, 2 * r, 2 * r);
        else dot(selected ? selectedEnds : ends, p.x, p.y);
      }
    }
  }
  // Round ends are round-capped dots (one stroke per state; 2,000 arcs cost about twice as much to record, M-1).
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.tangent;
  ctx.stroke(lines);
  ctx.lineCap = 'round';
  ctx.lineWidth = 2 * r;
  ctx.stroke(ends);
  ctx.lineCap = 'butt';
  ctx.fillStyle = theme.tangentBroken;
  ctx.fill(brokenEnds);
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.tangentSelected;
  ctx.stroke(selectedLines);
  ctx.lineCap = 'round';
  ctx.lineWidth = 2 * (r + 1);
  ctx.stroke(selectedEnds);
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1;
}

/**
 * A round dot centred on (x, y) for a round-capped stroke: a segment of 1/1000 px (a zero-length one draws nothing
 * in Chrome), so the stroke width is the diameter.
 */
function dot(path: Path2D, x: number, y: number): void {
  path.moveTo(x, y);
  path.lineTo(x + 0.001, y);
}

/** Average screen distance between keys below which unselected keys are not drawn (CSS px). */
export const MIN_KEY_SPACING = 3;

/** A diamond (◇ glyph of breakdown keys, M2A-SPEC §5.12) centred on (x, y) with half-diagonal r. */
function diamond(path: Path2D, x: number, y: number, r: number): void {
  path.moveTo(x, y - r);
  path.lineTo(x + r, y);
  path.lineTo(x, y + r);
  path.lineTo(x - r, y);
  path.closePath();
}

export function paintKeys(
  ctx: CanvasRenderingContext2D,
  scene: GraphScene,
  theme: GraphTheme,
  include: ((entry: CurveEntry) => boolean) | null = null,
): void {
  const plain = new Path2D();
  const selected = new Path2D();
  const locked = new Path2D();
  const breakdowns = new Path2D();
  const selectedBreakdowns = new Path2D();
  const half = GRAPH_METRICS.key / 2;
  const halfSelected = GRAPH_METRICS.keySelected / 2;
  // Diamonds of the same area as the squares (half-diagonal = half side · √2).
  const rd = half * Math.SQRT2;
  const rdSelected = halfSelected * Math.SQRT2;
  const f0 = xToFrame(scene.view, -GRAPH_METRICS.keySelected);
  const f1 = xToFrame(scene.view, scene.width + GRAPH_METRICS.keySelected);
  const { f0: viewF0, v0: viewV0, sx, sy } = scene.view;
  const height = scene.height;
  for (const entry of scene.curves.entries) {
    if (include !== null && !include(entry)) continue;
    const c = entry.compiled;
    const k = entry.scale;
    const o = entry.offset;
    const [lo, hi] = visibleRange(c, f0, f1);
    if (hi < lo) continue;
    // Keys closer than MIN_KEY_SPACING px on average would bury the curve: only selected keys are drawn then.
    const spanPx = Math.abs(keyX(scene, entry, hi) - keyX(scene, entry, lo));
    const crowded = hi > lo && spanPx / (hi - lo) < MIN_KEY_SPACING;
    for (let i = lo; i <= hi; i++) {
      const key = entry.keys[i];
      if (key === undefined) continue;
      const isSelected = !entry.locked && scene.selection.get(key.id)?.key === true;
      if (crowded && !isSelected) continue;
      // keyX / keyY written out (same operations), as in paintHandles.
      const x = ((c.t[i] as number) - viewF0) * sx;
      const y = height - ((c.v[i] as number) * k + o - viewV0) * sy;
      if (entry.locked) locked.rect(x - half, y - half, 2 * half, 2 * half);
      else if (key.breakdown === true) {
        if (isSelected) diamond(selectedBreakdowns, x, y, rdSelected);
        else diamond(breakdowns, x, y, rd);
      } else if (isSelected) selected.rect(x - halfSelected, y - halfSelected, 2 * halfSelected, 2 * halfSelected);
      else plain.rect(x - half, y - half, 2 * half, 2 * half);
    }
  }
  ctx.fillStyle = theme.key;
  ctx.globalAlpha = GRAPH_METRICS.inactiveAlpha;
  ctx.fill(locked);
  ctx.globalAlpha = 1;
  ctx.fill(plain);
  ctx.fillStyle = theme.keyBreakdown;
  ctx.fill(breakdowns);
  ctx.fillStyle = theme.keySelected;
  ctx.fill(selected);
  ctx.fill(selectedBreakdowns);
}
