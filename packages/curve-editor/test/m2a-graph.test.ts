// M2A-SPEC §5.15 (A4) in the Graph Editor controller: normalized and stacked views (mapping round trip, ranges
// frozen during a drag, edits convert per curve, data unchanged by a mode switch), the view-mode operator, buffer
// curves and breakdown glyphs on the canvas, the Scale tool's region box (edges, corners, inside, outside), and the
// M-1 drag path (coalesced updates applied before a redraw, the cached static layer).
import { DEG2RAD, RAD2DEG } from '@ekza-animator/anim-core';
import type { KeyId } from '@ekza-animator/doc';
import { registerBuiltinOperators } from '@ekza-animator/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_THEME, nextViewMode, registerGraphContributions } from '../src';
import { STACK_LANE, STACK_MIN_LANE_PX } from '../src/graph/viewMode';
import { frameToX, valueToY, xToFrame, yToValue } from '../src/view/transform';
import {
  addCurve,
  callsOf,
  drag,
  key,
  keyEvent,
  type Mounted,
  mount,
  pointer,
  selectKeys,
  settle,
  WAVE,
  waveApp,
} from './support/app';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

const at = (point: { readonly x: number; readonly y: number } | null): { x: number; y: number } => {
  if (point === null) throw new Error('point is not on the canvas');
  return { x: point.x, y: point.y };
};

/** The wave curve (rz 30°/−30°/30° at 0/15/30) plus a translation curve with another range. */
async function twoCurves(opts?: { readonly height?: number }) {
  const app = await waveApp();
  const ty = addCurve(app, {
    channel: 'ty',
    keys: [key(0, 0.1, 'linear'), key(10, 0.5, 'linear'), key(30, 0.3, 'linear')],
  });
  mounted = mount(app, { curves: [WAVE.curve, ty.curve], width: 600, height: opts?.height ?? 300 });
  return { app, ty, controller: mounted.controller };
}

describe('normalized and stacked views (§5.15.2)', () => {
  it('normalized: every curve spans −1…1; display → data → display round trip 1e-12; the document is unchanged', async () => {
    const { app, ty, controller } = await twoCurves();
    const before = JSON.stringify(app.store.snapshot());
    controller.setViewMode('normalized');
    expect(controller.viewMode).toBe('normalized');
    const { view } = controller;
    const drawnOfKey = (id: KeyId) => yToValue(view, 300, at(controller.keyPoint(id)).y);
    // rz: min −30°, max 30° (auto tangents flat at the extremes) → −1…1; ty: linear 0.1…0.5.
    expect(drawnOfKey(WAVE.keys[0])).toBeCloseTo(1, 9);
    expect(drawnOfKey(WAVE.keys[1])).toBeCloseTo(-1, 9);
    expect(drawnOfKey(ty.keys[0] as KeyId)).toBeCloseTo(-1, 9);
    expect(drawnOfKey(ty.keys[1] as KeyId)).toBeCloseTo(1, 9);
    expect(drawnOfKey(ty.keys[2] as KeyId)).toBeCloseTo(0, 9);
    // Round trip at the mapping level: data 0.3 → drawn 0 → data 0.3.
    const point = at(controller.keyPoint(ty.keys[2] as KeyId));
    const drawn = yToValue(view, 300, point.y);
    const data = (drawn - -1) * ((0.5 - 0.1) / 2) + 0.1;
    expect(Math.abs(data - 0.3)).toBeLessThan(1e-12);
    // F frames time and −1…1.
    controller.frame('all');
    expect(valueToY(controller.view, 300, 1)).toBeCloseTo((300 * 0.08) / 1.16, 6);
    controller.setViewMode('stacked');
    controller.setViewMode('absolute');
    expect(JSON.stringify(app.store.snapshot())).toBe(before);
  });

  it('a flat curve draws at 0 in the normalized view', async () => {
    const app = await waveApp();
    const flat = addCurve(app, { channel: 'rx', keys: [key(0, 0.4), key(10, 0.4)] });
    mounted = mount(app, { curves: [flat.curve] });
    mounted.controller.setViewMode('normalized');
    const y = at(mounted.controller.keyPoint(flat.keys[0] as KeyId)).y;
    expect(yToValue(mounted.controller.view, 300, y)).toBeCloseTo(0, 9);
  });

  it('stacked: one lane per curve, each key inside its lane and the canvas; lanes at least 40 px; time-only zoom', async () => {
    const { ty, controller } = await twoCurves();
    controller.setViewMode('stacked');
    const { view } = controller;
    expect(STACK_LANE * view.sy).toBeGreaterThanOrEqual(STACK_MIN_LANE_PX);
    for (const id of [...WAVE.keys, ...(ty.keys as KeyId[])]) {
      const p = at(controller.keyPoint(id));
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(300);
    }
    // Lane 0 (rz) above lane 1 (ty): every rz key is higher on screen than every ty key.
    const rzLowest = Math.max(...WAVE.keys.map((id) => at(controller.keyPoint(id)).y));
    const tyHighest = Math.min(...(ty.keys as KeyId[]).map((id) => at(controller.keyPoint(id)).y));
    expect(rzLowest).toBeLessThan(tyHighest);
    // The wheel zooms time only (lane height kept).
    controller.wheel({
      panel: 'graph',
      paneId: null,
      x: 300,
      y: 150,
      deltaX: 0,
      deltaY: -100,
      shift: false,
      alt: false,
      mod: false,
      ctrl: false,
    });
    expect(controller.view.sy).toBe(view.sy);
    expect(controller.view.sx).not.toBe(view.sx);
  });

  it('stacked with many curves scrolls vertically, clamped to the lanes', async () => {
    const app = await waveApp();
    const curves = [WAVE.curve];
    for (const channel of ['rx', 'ry', 'tx', 'ty', 'tz', 'sx', 'sy', 'sz'] as const) {
      curves.push(addCurve(app, { channel, keys: [key(0, 0), key(10, 1)] }).curve);
    }
    mounted = mount(app, { curves, height: 200 });
    const { controller } = mounted;
    controller.setViewMode('stacked');
    expect(STACK_LANE * controller.view.sy).toBeCloseTo(STACK_MIN_LANE_PX, 9);
    const top = controller.view.v0;
    controller.setView({ ...controller.view, v0: top + 100 });
    expect(controller.view.v0).toBe(top); // already at the top
    controller.setView({ ...controller.view, v0: top - 1000 });
    const lowest = top - (9 * STACK_LANE * controller.view.sy - 200) / controller.view.sy;
    expect(controller.view.v0).toBeCloseTo(lowest, 9);
  });

  it('a value drag in the normalized view changes only the dragged curve, by Δv = Δy′·(M − m)/2', async () => {
    const { app, ty, controller } = await twoCurves();
    controller.setViewMode('normalized');
    const start = at(controller.keyPoint(ty.keys[1] as KeyId));
    const rzBefore = app.store.query.keysOfCurve(WAVE.curve).map((k) => k.v);
    const dyPx = -30;
    drag(controller, start, { x: start.x, y: start.y + dyPx });
    const dDrawn = -dyPx / controller.view.sy;
    const moved = app.store.get('keys', ty.keys[1] as KeyId);
    expect(moved?.v ?? 0).toBeCloseTo(0.5 + (dDrawn * (0.5 - 0.1)) / 2, 9);
    expect(app.store.query.keysOfCurve(WAVE.curve).map((k) => k.v)).toEqual(rzBefore);
    expect(app.history.peekUndo()?.label).toBe('Move Keys');
  });

  it('ranges stay frozen during a drag and are recomputed on commit', async () => {
    const { app, ty, controller } = await twoCurves();
    controller.setViewMode('normalized');
    const start = at(controller.keyPoint(ty.keys[1] as KeyId));
    controller.pointerDown(pointer(start));
    controller.pointerMove(pointer({ x: start.x, y: start.y + 20 }));
    controller.pointerMove(pointer({ x: start.x, y: start.y + 40 }));
    // Frozen range: the key follows the pointer exactly (with a recomputed range it would stay at drawn 1).
    expect(at(controller.keyPoint(ty.keys[1] as KeyId)).y).toBeCloseTo(start.y + 40, 6);
    controller.pointerUp(pointer({ x: start.x, y: start.y + 40, buttons: 0 }));
    expect(app.store.preview).toBeNull();
    // Recomputed: the dragged key is the curve's maximum again → drawn 1.
    const y = at(controller.keyPoint(ty.keys[1] as KeyId)).y;
    expect(yToValue(controller.view, 300, y)).toBeCloseTo(1, 9);
  });

  it('graph.view.setMode toggles on the focused Graph Editor', async () => {
    const { app, controller } = await twoCurves();
    const dispose = registerGraphContributions(app, () => controller);
    expect(nextViewMode('absolute', 'toggleNormalized')).toBe('normalized');
    expect(nextViewMode('normalized', 'toggleNormalized')).toBe('absolute');
    expect(nextViewMode('stacked', 'toggleNormalized')).toBe('normalized');
    expect(nextViewMode('normalized', 'toggleStacked')).toBe('stacked');
    expect(nextViewMode('stacked', 'toggleStacked')).toBe('absolute');
    const modes: string[] = [];
    const off = controller.onViewModeChange((mode) => modes.push(mode));
    await app.run('graph.view.setMode', { mode: 'toggleNormalized' });
    await app.run('graph.view.setMode', { mode: 'toggleStacked' });
    await app.run('graph.view.setMode', { mode: 'absolute' });
    expect(modes).toEqual(['normalized', 'stacked', 'absolute']);
    expect((await app.runUntyped('graph.view.setMode', { mode: 'sideways' })).status).toBe('cancelled');
    off();
    dispose();
  });
});

describe('buffer curves and breakdown glyphs on the canvas (§5.15.1, §5.12)', () => {
  const rgb = (hex: string): readonly number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  /**
   * Device pixels near a CSS point holding at least 40 % of `hex` over the background (anti-aliased strokes cover
   * pixels partially): the projection of pixel − background onto colour − background, with a small residual.
   */
  function near(canvas: HTMLCanvasElement, x: number, y: number, hex: string, radius = 3): number {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    const target = rgb(hex);
    const bg = rgb(DEFAULT_GRAPH_THEME.background);
    const c = [0, 1, 2].map((i) => (target[i] as number) - (bg[i] as number));
    const cc = c.reduce((sum, v) => sum + v * v, 0);
    const data = ctx.getImageData(Math.round(x) - radius, Math.round(y) - radius, 2 * radius + 1, 2 * radius + 1).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const d = [0, 1, 2].map((k) => (data[i + k] as number) - (bg[k] as number));
      const t = d.reduce((sum, v, k) => sum + v * (c[k] as number), 0) / cc;
      const residual = Math.hypot(...d.map((v, k) => v - t * (c[k] as number)));
      if (t >= 0.4 && residual <= 0.35 * t * Math.sqrt(cc) + 8) count++;
    }
    return count;
  }

  it('draws a curve’s buffer dashed in --curve-buffer where it differs from the curve', async () => {
    const app = await waveApp();
    registerBuiltinOperators(app);
    mounted = mount(app);
    const { controller, base } = mounted;
    controller.frame('all'); // the view stays on −30…30 after the edit
    await app.run('graph.buffer.snapshot', { curves: [WAVE.curve] });
    // Move the middle key up 40°: the buffer keeps the old −30° at frame 15.
    app.store.transact({ label: 'edit' }, (tx) => {
      const k = tx.get('keys', WAVE.keys[1]);
      if (k !== undefined) tx.put('keys', { ...k, v: 10 * DEG2RAD });
    });
    controller.redraw(true);
    const x = frameToX(controller.view, 15);
    const y = valueToY(controller.view, 300, -30);
    expect(near(base, x, y, DEFAULT_GRAPH_THEME.curveBuffer, 6)).toBeGreaterThan(0);
    await app.run('graph.buffer.clear');
    controller.redraw(true);
    expect(near(base, x, y, DEFAULT_GRAPH_THEME.curveBuffer, 6)).toBe(0);
  });

  it('draws breakdown keys as green diamonds, selected ones in the selection colour', async () => {
    const app = await waveApp();
    app.store.transact({ label: 'breakdown' }, (tx) => {
      const k = tx.get('keys', WAVE.keys[1]);
      if (k !== undefined) tx.put('keys', { ...k, breakdown: true });
    });
    mounted = mount(app);
    const { controller, base } = mounted;
    controller.redraw(true);
    const p = at(controller.keyPoint(WAVE.keys[1]));
    expect(near(base, p.x, p.y, DEFAULT_GRAPH_THEME.keyBreakdown, 1)).toBeGreaterThan(0);
    const plain = at(controller.keyPoint(WAVE.keys[0]));
    expect(near(base, plain.x, plain.y, DEFAULT_GRAPH_THEME.keyBreakdown, 1)).toBe(0);
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    controller.redraw(true);
    expect(near(base, p.x, p.y, DEFAULT_GRAPH_THEME.keySelected, 1)).toBeGreaterThan(0);
  });
});

describe('the Scale tool and its region box (§5.15.3)', () => {
  async function scaleSetup() {
    const app = await waveApp();
    const dispose = registerGraphContributions(app, () => mounted?.controller ?? null);
    mounted = mount(app, { width: 800, height: 400 });
    const { controller } = mounted;
    selectKeys(
      app,
      WAVE.keys.map((id) => [id, { key: true }] as const),
    );
    app.session.setState({ tools: { ...app.session.getState().tools, graph: 'scale' } });
    controller.redraw(true);
    return { app, controller, dispose };
  }

  const times = (app: Awaited<ReturnType<typeof scaleSetup>>['app']) =>
    app.store.query.keysOfCurve(WAVE.curve).map((k) => k.t);
  const degrees = (app: Awaited<ReturnType<typeof scaleSetup>>['app']) =>
    app.store.query.keysOfCurve(WAVE.curve).map((k) => k.v * RAD2DEG);

  it('handle points exist only with the tool and selected keys', async () => {
    const { app, controller, dispose } = await scaleSetup();
    const right = at(controller.regionHandlePoint('right'));
    expect(xToFrame(controller.view, right.x)).toBeCloseTo(30, 9);
    expect(yToValue(controller.view, 400, at(controller.regionHandlePoint('top')).y)).toBeCloseTo(30, 9);
    expect(yToValue(controller.view, 400, at(controller.regionHandlePoint('bottom')).y)).toBeCloseTo(-30, 9);
    selectKeys(app, []);
    expect(controller.regionHandlePoint('right')).toBeNull();
    app.session.setState({ tools: { ...app.session.getState().tools, graph: 'select' } });
    selectKeys(app, [[WAVE.keys[0], { key: true }]]);
    expect(controller.regionHandlePoint('left')).toBeNull();
    dispose();
  });

  it('E2E-M2A-17: the right edge to frame 60 doubles the times; the top edge down half the box halves the values', async () => {
    const { app, controller, dispose } = await scaleSetup();
    const right = at(controller.regionHandlePoint('right'));
    drag(controller, right, { x: frameToX(controller.view, 60), y: right.y });
    expect(times(app)).toEqual([0, 30, 60]);
    expect(degrees(app).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([30, -30, 30]);
    expect(app.history.peekUndo()?.label).toBe('Scale Keys');
    controller.redraw(true);
    const top = at(controller.regionHandlePoint('top'));
    const bottom = at(controller.regionHandlePoint('bottom'));
    const release = top.y + (bottom.y - top.y) / 2;
    drag(controller, top, { x: top.x, y: release });
    const factor = (bottom.y - release) / (bottom.y - top.y);
    expect(times(app)).toEqual([0, 30, 60]);
    const expected = [30, -30, 30].map((v) => -30 + (v + 30) * factor);
    degrees(app).forEach((v, i) => expect(v).toBeCloseTo(expected[i] as number, 9));
    expect(degrees(app)[0]).toBeCloseTo(0, 9);
    expect(app.history.peekUndo()?.label).toBe('Scale Keys');
    dispose();
  });

  it('the left edge scales around the right edge; a corner scales both axes; inside moves', async () => {
    const { app, controller, dispose } = await scaleSetup();
    const left = at(controller.regionHandlePoint('left'));
    drag(controller, left, { x: frameToX(controller.view, 15), y: left.y });
    expect(times(app)).toEqual([15, 23, 30]); // around 30, ×0.5 → 15, 22.5 (snapped to 23), 30
    controller.redraw(true);
    const br = at(controller.regionHandlePoint('br'));
    const tl = at(controller.regionHandlePoint('tl'));
    // Bottom-right corner to the top-left/bottom-right midpoint: both axes ×0.5 around the top-left corner.
    drag(controller, br, { x: (br.x + tl.x) / 2, y: (br.y + tl.y) / 2 });
    expect(times(app)).toEqual([15, 19, 23]);
    degrees(app).forEach((v, i) => expect(v).toBeCloseTo([30, 0, 30][i] as number, 6));
    controller.redraw(true);
    const inside = at(controller.regionHandlePoint('inside'));
    // Inside, off the keys: a move (one frame per sx px).
    const press = { x: inside.x + 3, y: inside.y + 25 };
    drag(controller, press, { x: press.x + 2 * controller.view.sx, y: press.y });
    expect(times(app)).toEqual([17, 21, 25]);
    expect(app.history.peekUndo()?.label).toBe('Move Keys');
    dispose();
  });

  it('outside the box: a drag scales around the press point; a click clears the selection', async () => {
    const { app, controller, dispose } = await scaleSetup();
    // Press at frame 0's x well below the box; drag right by 100 px: time ×2 around frame 0 (value axis locked).
    const press = { x: frameToX(controller.view, 0), y: 395 };
    drag(controller, press, { x: press.x + 100, y: press.y }, { shift: true });
    expect(times(app)).toEqual([0, 30, 60]);
    degrees(app).forEach((v, i) => expect(v).toBeCloseTo([30, -30, 30][i] as number, 9));
    controller.pointerDown(pointer({ x: 790, y: 395 }));
    controller.pointerUp(pointer({ x: 790, y: 395, buttons: 0 }));
    await settle();
    expect(callsOf(app, 'select.keys').at(-1)).toEqual({ items: [], mode: 'replace' });
    dispose();
  });

  it('Esc cancels a region drag without a trace', async () => {
    const { app, controller, dispose } = await scaleSetup();
    const before = JSON.stringify(app.store.snapshot());
    const right = at(controller.regionHandlePoint('right'));
    controller.pointerDown(pointer(right));
    controller.pointerMove(pointer({ x: right.x + 80, y: right.y }));
    expect(controller.key(keyEvent({ code: 'Escape' }))).toBe(true);
    expect(JSON.stringify(app.store.snapshot())).toBe(before);
    expect(app.store.preview).toBeNull();
    dispose();
  });
});

describe('M-1: coalesced drag updates and the cached static layer (§5.21.1)', () => {
  it('with a frame requester, pointer moves apply at the next redraw (one preview update per frame)', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    app.setFrameRequester(() => {});
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    controller.redraw(true);
    const start = at(controller.keyPoint(WAVE.keys[1]));
    let previews = 0;
    const off = app.store.subscribe((batch) => {
      if (batch.origin === 'preview') previews++;
    });
    controller.pointerDown(pointer(start));
    for (let i = 1; i <= 5; i++) controller.pointerMove(pointer({ x: start.x, y: start.y - 4 * i }));
    expect(previews).toBe(0);
    controller.redraw();
    expect(previews).toBe(1);
    expect(at(controller.keyPoint(WAVE.keys[1])).y).toBeCloseTo(start.y - 20, 6);
    controller.pointerUp(pointer({ x: start.x, y: start.y - 20, buttons: 0 }));
    expect(app.history.peekUndo()?.label).toBe('Move Keys');
    off();
  });

  it('a drag of one curve’s keys paints the other curves once into the static layer', async () => {
    const app = await waveApp();
    const other = addCurve(app, { channel: 'rx', keys: [key(0, 0), key(20, 0.5)] });
    mounted = mount(app, { curves: [WAVE.curve, other.curve] });
    const { controller } = mounted;
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    controller.redraw(true);
    const before = controller.staticRenders;
    const start = at(controller.keyPoint(WAVE.keys[1]));
    controller.pointerDown(pointer(start));
    for (let i = 1; i <= 6; i++) {
      controller.pointerMove(pointer({ x: start.x, y: start.y - 5 * i }));
      controller.redraw();
    }
    expect(controller.staticRenders - before).toBe(1);
    controller.pointerUp(pointer({ x: start.x, y: start.y - 30, buttons: 0 }));
    controller.redraw();
    expect(controller.staticRenders - before).toBe(1); // the frame after the drag is a full redraw
    expect(app.store.get('keys', WAVE.keys[1])?.v ?? 0).not.toBe(-30 * DEG2RAD);
  });
});
