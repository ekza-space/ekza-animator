import { naiveCurveEngine } from '@ekza-studio/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANNEL_COLORS, DEFAULT_GRAPH_THEME } from '../src';
import { frameToX, valueToY } from '../src/view/transform';
import { addCurve, key, type Mounted, mount, selectKeys, WAVE, waveApp } from './support/app';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

const rgb = (hex: string): readonly [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/**
 * How much of `hex` a pixel holds over the canvas background: the projection of (pixel − background) onto
 * (target − background), or 0 when the remainder points elsewhere (another colour, e.g. a grid line or a label).
 * Anti-aliased strokes cover pixels partially, so plain colour equality would miss them.
 */
function coverage(pixel: readonly number[], hex: string): number {
  const target = rgb(hex);
  const bg = rgb(DEFAULT_GRAPH_THEME.background);
  const d = [0, 1, 2].map((i) => (pixel[i] as number) - (bg[i] as number));
  const c = [0, 1, 2].map((i) => (target[i] as number) - (bg[i] as number));
  const cc = c.reduce((sum, v) => sum + v * v, 0);
  const t = d.reduce((sum, v, i) => sum + v * (c[i] as number), 0) / cc;
  const residual = Math.hypot(...d.map((v, i) => v - t * (c[i] as number)));
  return residual <= 0.35 * t * Math.sqrt(cc) + 8 ? t : 0;
}

/** Device pixels around a CSS point that hold at least half of the colour `hex`. */
function matches(canvas: HTMLCanvasElement, dpr: number, x: number, y: number, hex: string, radius: number): number {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  const cx = Math.round(x * dpr);
  const cy = Math.round(y * dpr);
  const r = Math.max(1, Math.round(radius * dpr));
  const data = ctx.getImageData(cx - r, cy - r, 2 * r + 1, 2 * r + 1).data;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (coverage([data[i] as number, data[i + 1] as number, data[i + 2] as number], hex) >= 0.45) count++;
  }
  return count;
}

interface LabelBox {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Records the glyph box of every label the base layer draws during one forced redraw (CSS px). */
function paintedLabels(mounted: Mounted): LabelBox[] {
  const ctx = mounted.base.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  const labels: LabelBox[] = [];
  const fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    const m = ctx.measureText(text);
    labels.push({
      text,
      left: x - m.actualBoundingBoxLeft,
      right: x + m.actualBoundingBoxRight,
      top: y - m.actualBoundingBoxAscent,
      bottom: y + m.actualBoundingBoxDescent,
    });
    fillText(text, x, y, maxWidth);
  };
  try {
    mounted.controller.redraw(true);
  } finally {
    delete (ctx as { fillText?: unknown }).fillText;
  }
  return labels;
}

describe('axis labels (acceptance: "-20" read as "-2" over the frame strip)', () => {
  it('keeps value labels out of the frame-number strip and frame numbers out of the value-label column', async () => {
    mounted = mount(await waveApp());
    const { controller } = mounted;
    const height = 300;
    const sy = 1.6; // value step 20
    let drawnNearStrip = 0;
    // Sweep the −20 grid line from 40 px above the bottom edge down to the edge, one pixel at a time.
    for (let offset = 40; offset >= 0; offset--) {
      controller.setView({ f0: -2, sx: 8, sy, v0: -20 - offset / sy });
      const labels = paintedLabels(mounted);
      const frames = labels.filter((l) => l.bottom > height - 4); // frame numbers sit 2 px above the bottom edge
      const values = labels.filter((l) => l.bottom <= height - 4);
      expect(frames.length).toBeGreaterThan(0);
      const stripTop = Math.min(...frames.map((l) => l.top));
      // The bottom-left corner belongs to neither axis: no frame number there reads as a cut value label.
      const column = Math.max(0, ...values.map((l) => l.right));
      for (const frame of frames) {
        expect({ offset, text: frame.text, clear: frame.left >= column + 2 }).toEqual({
          offset,
          text: frame.text,
          clear: true,
        });
      }
      for (const value of values) {
        // At least 2 px clear of every frame number (the strip spans the canvas width) and inside the canvas.
        expect({ offset, text: value.text, bottom: value.bottom <= stripTop - 2 }).toEqual({
          offset,
          text: value.text,
          bottom: true,
        });
        expect(value.top).toBeGreaterThanOrEqual(0);
      }
      if (values.some((l) => l.text === '-20')) drawnNearStrip = Math.min(drawnNearStrip || offset, offset);
    }
    // The label is only skipped close to the strip: well above it, −20 is labelled.
    expect(drawnNearStrip).toBeGreaterThan(0);
    expect(drawnNearStrip).toBeLessThanOrEqual(24);
  });
});

describe('exact Bézier painting (ADR 0007 §3)', () => {
  for (const dpr of [1, 2]) {
    it(`draws the curve through its exact mid-segment values at DPR ${dpr}`, async () => {
      mounted = mount(await waveApp(), { dpr });
      const { app, base, controller } = mounted;
      expect(base.width).toBe(600 * dpr);
      expect(base.height).toBe(300 * dpr);
      controller.redraw(true);
      const compiled = app.evaluation.compiledCurve(WAVE.curve);
      // Probe points along both segments: the drawn stroke passes within a device pixel of the evaluated value.
      for (const frame of [3.75, 7.5, 11.25, 18.75, 22.5]) {
        const degrees = (naiveCurveEngine.evaluate(compiled, frame) * 180) / Math.PI;
        const x = frameToX(controller.view, frame);
        const y = valueToY(controller.view, 300, degrees);
        expect(matches(base, dpr, x, y, CHANNEL_COLORS.z, 1)).toBeGreaterThan(0);
        // 8 px above and below the value there is no curve colour (the stroke is 1.5 px wide).
        expect(matches(base, dpr, x, y - 8, CHANNEL_COLORS.z, 1)).toBe(0);
        expect(matches(base, dpr, x, y + 8, CHANNEL_COLORS.z, 1)).toBe(0);
      }
      // Keys are drawn as squares in the key colour; the middle key is a −30° extreme at frame 15.
      const k = controller.keyPoint(WAVE.keys[1]);
      expect(k).not.toBeNull();
      expect(matches(base, dpr, k?.x ?? 0, k?.y ?? 0, DEFAULT_GRAPH_THEME.key, 1)).toBeGreaterThan(0);
    });
  }

  it('paints selected keys yellow and the handles of selected keys', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { base, controller } = mounted;
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    controller.redraw(true);
    const k = controller.keyPoint(WAVE.keys[1]);
    const out = controller.handlePoint(WAVE.keys[1], 'out');
    expect(matches(base, 1, k?.x ?? 0, k?.y ?? 0, DEFAULT_GRAPH_THEME.keySelected, 2)).toBeGreaterThan(0);
    expect(matches(base, 1, out?.x ?? 0, out?.y ?? 0, DEFAULT_GRAPH_THEME.tangent, 2)).toBeGreaterThan(0);
  });

  it('draws infinity regions dotted, repeating the key range for cycle modes', async () => {
    const app = await waveApp();
    const cycled = addCurve(app, {
      channel: 'ry',
      keys: [key(0, 0, 'linear'), key(10, 0.1, 'linear')],
      pre: 'constant',
      post: 'cycleOffset',
    });
    mounted = mount(app, { curves: [cycled.curve] });
    const { base, controller } = mounted;
    // Frames −10…50, degrees −9.9…50.1: the constant pre-infinity line (0°) sits on a pixel row centre.
    controller.setView({ f0: -10, v0: -9.9, sx: 10, sy: 5 });
    controller.redraw(true);
    const y = (degrees: number) => valueToY(controller.view, 300, degrees);
    const x = (frame: number) => frameToX(controller.view, frame);
    const green = CHANNEL_COLORS.y;
    const deg = 180 / Math.PI;
    // Post: cycle with offset continues the ramp (0.15 rad at frame 15), never the plain cycle (0.05 rad).
    let onRamp = 0;
    for (let f = 12; f <= 18; f += 0.5) onRamp += matches(base, 1, x(f), y((f / 100) * deg), green, 1);
    expect(onRamp).toBeGreaterThan(0);
    expect(matches(base, 1, x(15), y(0.05 * deg), green, 1)).toBe(0);
    // Pre: constant at the first value; dotted, so not every pixel of the run is coloured.
    let lit = 0;
    let dark = 0;
    for (let px = Math.ceil(x(-9)); px < x(-1); px++) {
      if (matches(base, 1, px, y(0), green, 0) > 0) lit++;
      else dark++;
    }
    expect(lit).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(0);
  });

  it('shades frames outside the clip range', async () => {
    mounted = mount(await waveApp());
    const { base, controller } = mounted;
    controller.setView({ f0: -20, v0: -100, sx: 8, sy: 1 });
    controller.redraw(true);
    const ctx = base.getContext('2d');
    const inside = ctx?.getImageData(Math.round(frameToX(controller.view, 26)), 3, 1, 1).data;
    const outside = ctx?.getImageData(Math.round(frameToX(controller.view, -15)), 3, 1, 1).data;
    expect((outside?.[0] ?? 0) + (outside?.[1] ?? 0)).toBeLessThan((inside?.[0] ?? 0) + (inside?.[1] ?? 0));
  });

  it('falls back to a per-pixel polyline for dense curves and still draws through the key values', async () => {
    const app = await waveApp();
    const keys = Array.from({ length: 2000 }, (_, i) => key(i / 10, Math.sin(i / 40), 'linear'));
    const dense = addCurve(app, { channel: 'tx', keys });
    mounted = mount(app, { curves: [dense.curve], width: 400 });
    const { base, controller } = mounted;
    controller.redraw(true);
    const red = CHANNEL_COLORS.x;
    let hits = 0;
    for (const frame of [10, 50, 100, 150]) {
      hits += matches(
        base,
        1,
        frameToX(controller.view, frame),
        valueToY(controller.view, 300, Math.sin(frame / 4)),
        red,
        1,
      );
    }
    expect(hits).toBeGreaterThanOrEqual(3);
  });
});
