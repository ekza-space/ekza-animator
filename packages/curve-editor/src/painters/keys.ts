// Keys and tangent handles (research 09 §4.7): squares 5/7 px (selected yellow), handles as lines with 4 px ends,
// only for keys with a selected part unless prefs.graphHandles is 'all'. One Path2D per state (ADR 0007 §4).
import { visibleRange } from '../graph/geometry';
import { type GraphScene, handlePosition, handlesShown, keyX, keyY, type Point } from '../graph/scene';
import { xToFrame } from '../view/transform';
import { GRAPH_METRICS, type GraphTheme } from './theme';

export function paintHandles(ctx: CanvasRenderingContext2D, scene: GraphScene, theme: GraphTheme, p: Point): void {
  const lines = new Path2D();
  const selectedLines = new Path2D();
  const ends = new Path2D();
  const selectedEnds = new Path2D();
  const brokenEnds = new Path2D();
  const r = GRAPH_METRICS.handleRadius;
  const f0 = xToFrame(scene.view, -GRAPH_METRICS.handleLength);
  const f1 = xToFrame(scene.view, scene.width + GRAPH_METRICS.handleLength);
  for (const entry of scene.curves.entries) {
    if (entry.locked) continue;
    const [lo, hi] = visibleRange(entry.compiled, f0, f1);
    for (let i = lo; i <= hi; i++) {
      if (!handlesShown(scene, entry, i)) continue;
      const key = entry.keys[i];
      if (key === undefined) continue;
      const parts = scene.selection.get(key.id);
      const kx = keyX(scene, entry, i);
      const ky = keyY(scene, entry, i);
      for (const side of ['in', 'out'] as const) {
        handlePosition(scene, entry, i, side, p);
        const selected = parts?.[side] === true;
        const line = selected ? selectedLines : lines;
        line.moveTo(kx, ky);
        line.lineTo(p.x, p.y);
        if (selected) {
          selectedEnds.moveTo(p.x + r + 1, p.y);
          selectedEnds.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
        } else if (key.broken) {
          brokenEnds.rect(p.x - r, p.y - r, 2 * r, 2 * r);
        } else {
          ends.moveTo(p.x + r, p.y);
          ends.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
      }
    }
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.tangent;
  ctx.stroke(lines);
  ctx.fillStyle = theme.tangent;
  ctx.fill(ends);
  ctx.fillStyle = theme.tangentBroken;
  ctx.fill(brokenEnds);
  ctx.strokeStyle = theme.tangentSelected;
  ctx.stroke(selectedLines);
  ctx.fillStyle = theme.tangentSelected;
  ctx.fill(selectedEnds);
}

/** Average screen distance between keys below which unselected keys are not drawn (CSS px). */
export const MIN_KEY_SPACING = 3;

export function paintKeys(ctx: CanvasRenderingContext2D, scene: GraphScene, theme: GraphTheme): void {
  const plain = new Path2D();
  const selected = new Path2D();
  const locked = new Path2D();
  const half = GRAPH_METRICS.key / 2;
  const halfSelected = GRAPH_METRICS.keySelected / 2;
  const f0 = xToFrame(scene.view, -GRAPH_METRICS.keySelected);
  const f1 = xToFrame(scene.view, scene.width + GRAPH_METRICS.keySelected);
  for (const entry of scene.curves.entries) {
    const c = entry.compiled;
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
      const x = keyX(scene, entry, i);
      const y = keyY(scene, entry, i);
      if (entry.locked) locked.rect(x - half, y - half, 2 * half, 2 * half);
      else if (isSelected) selected.rect(x - halfSelected, y - halfSelected, 2 * halfSelected, 2 * halfSelected);
      else plain.rect(x - half, y - half, 2 * half, 2 * half);
    }
  }
  ctx.fillStyle = theme.key;
  ctx.globalAlpha = GRAPH_METRICS.inactiveAlpha;
  ctx.fill(locked);
  ctx.globalAlpha = 1;
  ctx.fill(plain);
  ctx.fillStyle = theme.keySelected;
  ctx.fill(selected);
}
