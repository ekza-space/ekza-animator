// Background, outside-range shading, grid lines and axis labels of the Graph Editor (research 09 §4.7).
import type { GraphScene } from '../graph/scene';
import { frameStep, isMajor, stepDecimals, valueStep } from '../view/grid';
import { frameToX, valueToY, xToFrame, yToValue } from '../view/transform';
import { crisp } from './canvas';
import type { GraphTheme } from './theme';

/** Upper bound of grid lines per axis (a guard against degenerate scales). */
const MAX_LINES = 2000;

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

  ctx.fillStyle = theme.label;
  ctx.font = theme.font;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  if (fLast - fFirst < MAX_LINES) {
    for (let i = fFirst; i <= fLast; i++) {
      const frame = i * fStep;
      ctx.fillText(String(frame), frameToX(view, frame), height - 2);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  const decimals = stepDecimals(vStep);
  if (vLast - vFirst < MAX_LINES) {
    for (let i = vFirst; i <= vLast; i++) {
      const value = i * vStep;
      const y = valueToY(view, height, value);
      if (y < 12 || y > height - 12) continue;
      ctx.fillText(formatValue(value, decimals), 3, y - 1);
    }
  }
}

function formatValue(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return text === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : text;
}
