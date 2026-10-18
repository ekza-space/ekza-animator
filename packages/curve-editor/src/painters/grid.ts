// Background, outside-range shading, grid lines and axis labels of the Graph Editor (research 09 §4.7).
import type { GraphScene } from '../graph/scene';
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
  if (vLast - vFirst < MAX_LINES) {
    for (let i = vFirst; i <= vLast; i++) {
      const y = crisp(valueToY(view, height, i * vStep));
      const path = isMajor(i) ? major : minor;
      path.moveTo(0, y);
      path.lineTo(width, y);
    }
  }
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
  if (vLast - vFirst < MAX_LINES) {
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

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function formatValue(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return text === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : text;
}
