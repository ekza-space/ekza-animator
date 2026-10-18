// Background, outside-range shading, grid lines and axis labels of the Graph Editor (research 09 §4.7).
import type { GraphScene } from '../graph/scene';
import { STACK_LANE } from '../graph/viewMode';
import { frameStep, isMajor, stepDecimals, valueStep } from '../view/grid';
import { frameToX, valueToY, xToFrame, yToValue } from '../view/transform';
import { crisp } from './canvas';
import type { GraphTheme } from './theme';

/** Upper bound of grid lines per axis (a guard against degenerate scales). */
const MAX_LINES = 2000;
/** Frame numbers sit this far above the bottom edge; value labels sit this far right of the left edge (CSS px). */
const FRAME_LABEL_INSET = 2;
const VALUE_LABEL_X = 3;
/** Clear space kept between the value labels and the frame-number strip, and right of the value-label column. */
const LABEL_GAP = 3;

export function paintBackground(ctx: CanvasRenderingContext2D, scene: GraphScene, theme: GraphTheme): void {
  const { width, height } = scene;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  const range = scene.range;
  if (range === null) return;
  const x0 = Math.max(0, Math.min(width, frameToX(scene.view, range.start)));
  const x1 = Math.max(0, Math.min(width, frameToX(scene.view, range.end)));
  ctx.fillStyle = theme.rangeOutside;
  if (x0 > 0) ctx.fillRect(0, 0, x0, height);
  if (x1 < width) ctx.fillRect(x1, 0, width - x1, height);
}

export function paintGrid(ctx: CanvasRenderingContext2D, scene: GraphScene, theme: GraphTheme): void {
  const { view, width, height } = scene;
  if (!(width > 0 && height > 0)) return;
  const fStep = frameStep(view.sx);
  const vStep = valueStep(view.sy);
  const fFirst = Math.ceil(xToFrame(view, 0) / fStep);
  const fLast = Math.floor(xToFrame(view, width) / fStep);
  const vFirst = Math.ceil(yToValue(view, height, height) / vStep);
  const vLast = Math.floor(yToValue(view, height, 0) / vStep);

  const minor = new Path2D();
  const major = new Path2D();
  if (fLast - fFirst < MAX_LINES) {
    for (let i = fFirst; i <= fLast; i++) {
      const x = crisp(frameToX(view, i * fStep));
      const path = isMajor(i) ? major : minor;
      path.moveTo(x, 0);
      path.lineTo(x, height);
    }
  }
  const stacked = scene.mode === 'stacked';
  if (!stacked && vLast - vFirst < MAX_LINES) {
    for (let i = vFirst; i <= vLast; i++) {
      const y = crisp(valueToY(view, height, i * vStep));
      const path = isMajor(i) ? major : minor;
      path.moveTo(0, y);
      path.lineTo(width, y);
    }
  }
  if (stacked) laneSeparators(scene, major);
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.gridMinor;
  ctx.stroke(minor);
  ctx.strokeStyle = theme.gridMajor;
  ctx.stroke(major);

  // Labels: values along the left edge, frame numbers in a strip along the bottom edge. Neither axis labels the
  // other's area, so the bottom-left corner stays empty (acceptance: a frame number there read as a cut value label,
  // and a value label next to the strip collided with it).
  ctx.fillStyle = theme.label;
  ctx.font = theme.font;
  ctx.textBaseline = 'bottom';
  // Glyph extent of a label line above and below its 'bottom' baseline, for the current font.
  const digits = ctx.measureText('-0123456789.');
  const ascent = finiteOr(digits.actualBoundingBoxAscent, 10);
  const descent = finiteOr(digits.actualBoundingBoxDescent, 0);
  const stripTop = height - FRAME_LABEL_INSET - ascent;

  ctx.textAlign = 'left';
  let column = 0; // right edge of the value-label column (0: no value label drawn)
  const decimals = stepDecimals(vStep);
  if (stacked) {
    column = laneLabels(ctx, scene, stripTop - LABEL_GAP);
    ctx.fillStyle = theme.label;
  } else if (vLast - vFirst < MAX_LINES) {
    for (let i = vFirst; i <= vLast; i++) {
      const value = i * vStep;
      const baseline = valueToY(view, height, value) - 1;
      if (baseline - ascent < 1 || baseline + descent > stripTop - LABEL_GAP) continue;
      const text = formatValue(value, decimals);
      ctx.fillText(text, VALUE_LABEL_X, baseline);
      column = Math.max(column, VALUE_LABEL_X + ctx.measureText(text).width);
    }
  }
  ctx.textAlign = 'center';
  if (fLast - fFirst < MAX_LINES) {
    let clear = column === 0; // frames run left to right: once one clears the column, the rest do
    for (let i = fFirst; i <= fLast; i++) {
      const frame = i * fStep;
      const x = frameToX(view, frame);
      const text = String(frame);
      if (!clear) {
        if (x - ctx.measureText(text).width / 2 < column + LABEL_GAP) continue;
        clear = true;
      }
      ctx.fillText(text, x, height - FRAME_LABEL_INSET);
    }
  }
}

/** M2a §5.15.2 stacked view: a line between consecutive lanes. */
function laneSeparators(scene: GraphScene, path: Path2D): void {
  const lanes = scene.lanes ?? [];
  for (let lane = 1; lane < lanes.length; lane++) {
    const y = crisp(valueToY(scene.view, scene.height, STACK_LANE / 2 - lane * STACK_LANE));
    if (y < 0 || y > scene.height) continue;
    path.moveTo(0, y);
    path.lineTo(scene.width, y);
  }
}

/**
 * M2a §5.15.2 stacked view: each lane's curve label at its top-left corner, above the frame-number strip. Returns 0:
 * no value-label column for the frame numbers to keep clear of.
 */
function laneLabels(ctx: CanvasRenderingContext2D, scene: GraphScene, bottom: number): number {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  (scene.lanes ?? []).forEach((lane, index) => {
    const top = valueToY(scene.view, scene.height, STACK_LANE / 2 - index * STACK_LANE) + 2;
    if (top < 0 || top > bottom - 10) return;
    ctx.fillStyle = lane.color;
    ctx.fillText(lane.label, VALUE_LABEL_X, top);
  });
  ctx.textBaseline = 'bottom';
  return 0;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function formatValue(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return text === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : text;
}
