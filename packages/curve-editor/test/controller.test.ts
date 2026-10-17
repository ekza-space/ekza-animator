import type { GraphViewState } from '../src';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphEditorController, registerGraphContributions } from '../src';
import { buildCurveSet, updateCurveSet } from '../src/graph/curveSet';
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
  wheel,
} from './support/app';

const RAD = 180 / Math.PI;

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

const at = (point: { readonly x: number; readonly y: number } | null): { x: number; y: number } => {
  if (point === null) throw new Error('point is not on the canvas');
  return { x: point.x, y: point.y };
};

describe('view state, framing and resize', () => {
  it('frames all visible curves with 8 % padding when curves are first shown', async () => {
    mounted = mount(await waveApp());
    const { controller } = mounted;
    // Keys at frames 0…30; the auto tangents are flat at the ±30° extremes, so the values span exactly ±30°.
    expect(frameToX(controller.view, 0)).toBeCloseTo((600 * 0.08) / 1.16, 6);
    expect(frameToX(controller.view, 30)).toBeCloseTo(600 - (600 * 0.08) / 1.16, 6);
    expect(valueToY(controller.view, 300, 30)).toBeCloseTo((300 * 0.08) / 1.16, 6);
    expect(valueToY(controller.view, 300, -30)).toBeCloseTo(300 - (300 * 0.08) / 1.16, 6);
    expect(controller.curves).toEqual([WAVE.curve]);
  });

  it('frames the selected keys (F) and everything again (A)', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [
      [WAVE.keys[1], { key: true }],
      [WAVE.keys[2], { key: true }],
    ]);
    controller.frame('selection');
    expect(xToFrame(controller.view, 0)).toBeCloseTo(15 - 15 * 0.08, 6);
    expect(xToFrame(controller.view, 600)).toBeCloseTo(30 + 15 * 0.08, 6);
    controller.frame('all');
    expect(xToFrame(controller.view, 0)).toBeCloseTo(-30 * 0.08, 6);
  });

  it('defers framing until the canvas has a size, and keeps a view across resizes', async () => {
    const app = await waveApp();
    const base = document.createElement('canvas');
    const overlay = document.createElement('canvas');
    const controller = new GraphEditorController({ app, base, overlay });
    try {
      controller.setCurves([WAVE.curve]);
      const before = controller.view;
      controller.resize(600, 300, 2);
      expect(controller.view).not.toEqual(before);
      expect(base.width).toBe(1200);
      expect(overlay.height).toBe(600);
      expect(frameToX(controller.view, 0)).toBeCloseTo((600 * 0.08) / 1.16, 6);
      const framed = controller.view;
      controller.resize(800, 300, 1);
      expect(controller.view).toEqual(framed);
      expect(base.width).toBe(800);
    } finally {
      controller.dispose();
      app.dispose();
    }
  });

  it('ignores invalid views', async () => {
    mounted = mount(await waveApp());
    const { controller } = mounted;
    const view = controller.view;
    controller.setView({ f0: Number.NaN, v0: 0, sx: 1, sy: 1 });
    controller.setView({ ...view, sx: 0 });
    controller.setView({ ...view, sy: -2 });
    expect(controller.view).toEqual(view);
  });
});

describe('navigation per profile (MVP-SPEC §4.11.18)', () => {
  const anchorKept = (before: GraphViewState, after: GraphViewState, x: number, y: number) => {
    expect(xToFrame(after, x)).toBeCloseTo(xToFrame(before, x), 6);
    expect(yToValue(after, 300, y)).toBeCloseTo(yToValue(before, 300, y), 6);
  };

  it('Maya: the wheel zooms around the cursor; Shift zooms values only, Alt time only', async () => {
    const app = await waveApp();
    app.prefs.setState({ navProfile: 'maya' });
    mounted = mount(app);
    const { controller } = mounted;
    let before = controller.view;
    controller.wheel(wheel({ x: 200, y: 120, deltaY: -100 }));
    let after = controller.view;
    expect(after.sx).toBeGreaterThan(before.sx);
    expect(after.sy / before.sy).toBeCloseTo(after.sx / before.sx, 9);
    anchorKept(before, after, 200, 120);

    before = after;
    controller.wheel(wheel({ x: 300, y: 50, deltaY: 100, shift: true }));
    after = controller.view;
    expect(after.sx).toBe(before.sx);
    expect(after.sy).toBeLessThan(before.sy);
    anchorKept(before, after, 300, 50);

    // Shift+wheel arrives as horizontal deltas on some platforms.
    before = after;
    controller.wheel(wheel({ x: 300, y: 50, deltaX: -100, shift: true }));
    expect(controller.view.sy).toBeGreaterThan(before.sy);

    before = controller.view;
    controller.wheel(wheel({ x: 100, y: 200, deltaY: -50, alt: true }));
    after = controller.view;
    expect(after.sy).toBe(before.sy);
    expect(after.sx).toBeGreaterThan(before.sx);
    anchorKept(before, after, 100, 200);
  });

  it('Trackpad: two-finger scroll pans, pinch (Ctrl+wheel) zooms with Alt/Shift for one axis', async () => {
    const app = await waveApp();
    app.prefs.setState({ navProfile: 'trackpad' });
    mounted = mount(app);
    const { controller } = mounted;
    const before = controller.view;
    controller.wheel(wheel({ x: 200, y: 120, deltaX: 30, deltaY: 20 }));
    const panned = controller.view;
    expect(panned.sx).toBe(before.sx);
    expect(panned.sy).toBe(before.sy);
    expect(panned.f0).toBeCloseTo(before.f0 + 30 / before.sx, 9);
    expect(panned.v0).toBeCloseTo(before.v0 - 20 / before.sy, 9);

    controller.wheel(wheel({ x: 200, y: 120, deltaY: -10, ctrl: true }));
    const pinched = controller.view;
    expect(pinched.sx / panned.sx).toBeCloseTo(Math.exp(0.1), 9);
    expect(pinched.sy / panned.sy).toBeCloseTo(Math.exp(0.1), 9);
    anchorKept(panned, pinched, 200, 120);

    controller.wheel(wheel({ x: 200, y: 120, deltaY: -10, ctrl: true, alt: true }));
    expect(controller.view.sy).toBe(pinched.sy);
    controller.wheel(wheel({ x: 200, y: 120, deltaY: -10, ctrl: true, shift: true }));
    expect(controller.view.sx).toBeCloseTo(pinched.sx * Math.exp(0.1), 9);
  });

  it('Alt+MMB drag pans and Alt+RMB drag zooms around the press point (and Esc restores the view)', async () => {
    mounted = mount(await waveApp());
    const { controller } = mounted;
    const before = controller.view;
    drag(controller, { x: 100, y: 100 }, { x: 160, y: 70 }, { button: 1, alt: true });
    const panned = controller.view;
    expect(frameToX(panned, 10)).toBeCloseTo(frameToX(before, 10) + 60, 6);
    expect(valueToY(panned, 300, 5)).toBeCloseTo(valueToY(before, 300, 5) - 30, 6);

    drag(controller, { x: 200, y: 150 }, { x: 260, y: 150 }, { button: 2, alt: true });
    const zoomed = controller.view;
    expect(zoomed.sx).toBeGreaterThan(panned.sx);
    expect(zoomed.sy / panned.sy).toBeCloseTo(zoomed.sx / panned.sx, 9);
    anchorKept(panned, zoomed, 200, 150);

    controller.pointerDown(pointer({ x: 50, y: 50, button: 1, alt: true }));
    controller.pointerMove(pointer({ x: 150, y: 90, button: 1, alt: true }));
    expect(controller.view).not.toEqual(zoomed);
    expect(controller.key(keyEvent({ code: 'Escape' }))).toBe(true);
    expect(controller.view).toEqual(zoomed);
    expect(controller.busy).toBe(false);
  });

  it('Maya one-button profile: Option+Cmd+LMB pans, Option+Ctrl+LMB zooms', async () => {
    const app = await waveApp({ platform: 'mac' });
    app.prefs.setState({ navProfile: 'mayaOneButton' });
    mounted = mount(app);
    const { controller } = mounted;
    const before = controller.view;
    drag(controller, { x: 100, y: 100 }, { x: 140, y: 100 }, { alt: true, mod: true });
    expect(frameToX(controller.view, 10)).toBeCloseTo(frameToX(before, 10) + 40, 6);
    const panned = controller.view;
    drag(controller, { x: 100, y: 100 }, { x: 140, y: 100 }, { alt: true, ctrl: true });
    expect(controller.view.sx).toBeGreaterThan(panned.sx);
    expect(callsOf(app, 'select.keys')).toEqual([]);
  });
});

describe('selection gestures', () => {
  it('clicks select keys and handles with Maya modifiers through select.keys', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const k0 = at(controller.keyPoint(WAVE.keys[0]));
    controller.pointerDown(pointer(k0));
    controller.pointerUp(pointer({ ...k0, buttons: 0 }));
    controller.pointerDown(pointer({ ...k0, shift: true }));
    controller.pointerUp(pointer({ ...k0, shift: true, buttons: 0 }));
    controller.pointerDown(pointer({ ...k0, mod: true }));
    controller.pointerUp(pointer({ ...k0, mod: true, buttons: 0 }));
    controller.pointerDown(pointer({ ...k0, mod: true, shift: true }));
    controller.pointerUp(pointer({ ...k0, mod: true, shift: true, buttons: 0 }));
    await settle();
    const keyPart = { key: true, in: false, out: false };
    expect(callsOf(app, 'select.keys')).toEqual([
      { items: [{ key: WAVE.keys[0], parts: keyPart }], mode: 'replace' },
      { items: [{ key: WAVE.keys[0], parts: keyPart }], mode: 'toggle' },
      { items: [{ key: WAVE.keys[0], parts: keyPart }], mode: 'remove' },
      { items: [{ key: WAVE.keys[0], parts: keyPart }], mode: 'add' },
    ]);

    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    const out = at(controller.handlePoint(WAVE.keys[1], 'out'));
    controller.pointerDown(pointer(out));
    controller.pointerUp(pointer({ ...out, buttons: 0 }));
    await settle();
    expect(callsOf(app, 'select.keys').at(-1)).toEqual({
      items: [{ key: WAVE.keys[1], parts: { key: false, in: false, out: true } }],
      mode: 'replace',
    });
  });

  it('a click on an already selected key narrows the selection on release, not on press', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [
      [WAVE.keys[0], { key: true }],
      [WAVE.keys[1], { key: true }],
    ]);
    const k0 = at(controller.keyPoint(WAVE.keys[0]));
    controller.pointerDown(pointer(k0));
    await settle();
    expect(callsOf(app, 'select.keys')).toEqual([]);
    controller.pointerUp(pointer({ ...k0, buttons: 0 }));
    await settle();
    expect(callsOf(app, 'select.keys')).toEqual([
      { items: [{ key: WAVE.keys[0], parts: { key: true, in: false, out: false } }], mode: 'replace' },
    ]);
  });

  it('double-click on a curve selects all its keys (select.curveKeys), Shift toggles them as a group', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const dispose = registerGraphContributions(app, () => controller);
    try {
      const mid = at(controller.curvePoint(WAVE.curve, 7.5));
      controller.pointerDown(pointer({ ...mid, detail: 1 }));
      controller.pointerUp(pointer({ ...mid, detail: 1, buttons: 0 }));
      controller.pointerDown(pointer({ ...mid, detail: 2 }));
      controller.pointerUp(pointer({ ...mid, detail: 2, buttons: 0 }));
      await settle();
      expect(callsOf(app, 'select.curveKeys')).toEqual([{ curve: WAVE.curve, mode: 'replace' }]);
      expect([...app.session.getState().selection.keys.keys()]).toEqual([...WAVE.keys]);

      controller.pointerDown(pointer({ ...mid, detail: 2, shift: true }));
      controller.pointerUp(pointer({ ...mid, detail: 2, shift: true, buttons: 0 }));
      await settle();
      expect(app.session.getState().selection.keys.size).toBe(0);

      // A double-click on a key also selects the whole curve.
      const k30 = at(controller.keyPoint(WAVE.keys[2]));
      controller.pointerDown(pointer({ ...k30, detail: 2 }));
      controller.pointerUp(pointer({ ...k30, detail: 2, buttons: 0 }));
      await settle();
      expect(app.session.getState().selection.keys.size).toBe(3);
    } finally {
      dispose();
    }
  });

  it('the Insert tool inserts a key on the curve at the clicked frame, elsewhere it selects', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const dispose = registerGraphContributions(app, () => controller);
    try {
      app.session.setState({ tools: { ...app.session.getState().tools, graph: 'insert' } });
      const p = at(controller.curvePoint(WAVE.curve, 22));
      controller.pointerDown(pointer(p));
      controller.pointerUp(pointer({ ...p, buttons: 0 }));
      await settle();
      const [insert] = callsOf(app, 'graph.key.insert') as { curve: string; frame: number }[];
      expect(insert?.curve).toBe(WAVE.curve);
      expect(insert?.frame).toBeCloseTo(22, 9);
      expect(controller.cursor()).toBe('crosshair');

      controller.pointerDown(pointer({ x: 5, y: 5 }));
      controller.pointerUp(pointer({ x: 5, y: 5, buttons: 0 }));
      await settle();
      expect(callsOf(app, 'graph.key.insert')).toHaveLength(1);
      expect(callsOf(app, 'select.keys')).toEqual([{ items: [], mode: 'replace' }]);
    } finally {
      dispose();
    }
  });

  it('ignores presses while another gesture runs and cancels a press with Esc', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    controller.pointerDown(pointer({ x: 5, y: 5 }));
    expect(controller.busy).toBe(true);
    const view = controller.view;
    // A second button while the first is still down (buttons = LMB | MMB) is ignored.
    controller.pointerDown(pointer({ x: 50, y: 50, button: 1, buttons: 5, alt: true }));
    controller.pointerMove(pointer({ x: 90, y: 50, button: 1, buttons: 5, alt: true }));
    expect(controller.view).toEqual(view);
    expect(controller.key(keyEvent({ code: 'Escape' }))).toBe(true);
    expect(controller.busy).toBe(false);
    controller.pointerUp(pointer({ x: 5, y: 5, buttons: 0 }));
    await settle();
    expect(callsOf(app, 'select.keys')).toEqual([]);
    expect(controller.key(keyEvent({ code: 'Escape' }))).toBe(false);
  });
});

describe('lost releases', () => {
  it('a press whose earlier button is no longer down cancels the stale gesture and starts fresh', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    controller.pointerDown(pointer({ x: 5, y: 5 })); // LMB press whose release never arrives
    const view = controller.view;
    controller.pointerDown(pointer({ x: 50, y: 50, button: 1, buttons: 4, alt: true }));
    controller.pointerMove(pointer({ x: 90, y: 50, button: 1, buttons: 4, alt: true }));
    controller.pointerUp(pointer({ x: 90, y: 50, button: 1, buttons: 0, alt: true }));
    expect(frameToX(controller.view, 10)).toBeCloseTo(frameToX(view, 10) + 40, 6);
    expect(controller.busy).toBe(false);
    await settle();
    expect(callsOf(app, 'select.keys')).toEqual([]);
  });
});

describe('redraw scheduling', () => {
  it('draws only dirty layers and stays idle when nothing changes', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    controller.redraw();
    const idle = controller.stats;
    controller.redraw();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(controller.stats).toEqual(idle);

    // Time changes redraw the overlay (playhead) only.
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 12 } });
    controller.redraw();
    expect(controller.stats.baseRedraws).toBe(idle.baseRedraws);
    expect(controller.stats.overlayRedraws).toBe(idle.overlayRedraws + 1);

    // Document and selection changes redraw the base layer.
    selectKeys(app, [[WAVE.keys[0], { key: true }]]);
    controller.redraw();
    expect(controller.stats.baseRedraws).toBe(idle.baseRedraws + 1);
    addCurve(app, { channel: 'rx', keys: [key(0, 0)] });
    controller.redraw();
    expect(controller.stats.baseRedraws).toBe(idle.baseRedraws + 2);

    // A scheduled frame redraws by itself.
    controller.setView({ ...controller.view, f0: controller.view.f0 + 1 });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(controller.stats.baseRedraws).toBe(idle.baseRedraws + 3);
  });

  it('hover highlights what a click would hit, on the overlay only', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    controller.redraw();
    const before = controller.stats;
    const k0 = at(controller.keyPoint(WAVE.keys[0]));
    controller.pointerMove(pointer({ ...k0, buttons: 0 }));
    controller.redraw();
    expect(controller.stats.baseRedraws).toBe(before.baseRedraws);
    expect(controller.stats.overlayRedraws).toBe(before.overlayRedraws + 1);
    controller.pointerMove(pointer({ ...k0, x: k0.x + 0.5, buttons: 0 })); // same key: nothing to redraw
    controller.redraw();
    expect(controller.stats.overlayRedraws).toBe(before.overlayRedraws + 1);
    controller.pointerLeave();
    controller.redraw();
    expect(controller.stats.overlayRedraws).toBe(before.overlayRedraws + 2);
  });

  it('rebuilds only the curves an edit touched; other changes rebuild the set', async () => {
    const app = await waveApp();
    const rx = addCurve(app, { channel: 'rx', keys: [key(0, 0.1), key(10, 0.2)] });
    const set = buildCurveSet(app, [WAVE.curve, rx.curve]);
    app.store.transact({ label: 'Nudge' }, (tx) => tx.patch('keys', rx.keys[1]!, { v: 0.5 }));
    const next = updateCurveSet(app, set, [WAVE.curve, rx.curve], new Set([rx.curve]));
    expect(next.byCurve.get(WAVE.curve)).toBe(set.byCurve.get(WAVE.curve));
    expect(next.byCurve.get(rx.curve)).not.toBe(set.byCurve.get(rx.curve));
    expect(next.byCurve.get(rx.curve)?.compiled.v[1]).toBe(0.5);
    expect(next.byKey.get(rx.keys[1]!)).toMatchObject({ index: 1, entry: next.byCurve.get(rx.curve) });
    expect(next.byKey.get(WAVE.keys[2])).toMatchObject({ index: 2, entry: set.byCurve.get(WAVE.curve) });
    // Showing fewer curves keeps the remaining entries; a deleted curve leaves the set.
    expect(updateCurveSet(app, next, [rx.curve], new Set()).byCurve.get(rx.curve)).toBe(next.byCurve.get(rx.curve));
    app.store.transact({ label: 'Delete' }, (tx) => {
      for (const id of rx.keys) tx.remove('keys', id);
      tx.softDelete('curves', rx.curve);
    });
    const gone = updateCurveSet(app, next, [WAVE.curve, rx.curve], new Set([rx.curve]));
    expect(gone.entries.map((entry) => entry.id)).toEqual([WAVE.curve]);
    expect(gone.byKey.get(rx.keys[0]!)).toBeUndefined();

    // Through the controller: key edits, curve-list changes and control locks all show up.
    mounted = mount(app);
    const { controller } = mounted;
    const y0 = at(controller.keyPoint(WAVE.keys[1])).y;
    app.store.transact({ label: 'Nudge' }, (tx) => tx.patch('keys', WAVE.keys[1], { v: -0.4 }));
    expect(at(controller.keyPoint(WAVE.keys[1])).y).toBeCloseTo(valueToY(controller.view, 300, -0.4 * RAD), 9);
    expect(at(controller.keyPoint(WAVE.keys[1])).y).not.toBeCloseTo(y0, 3);
    const ry = addCurve(app, { channel: 'ry', keys: [key(3, 0)] });
    controller.setCurves([WAVE.curve, ry.curve]);
    expect(controller.keyPoint(ry.keys[0]!)).not.toBeNull();
    const control = app.store.get('controls', WAVE.control);
    if (control === undefined) throw new Error('no control');
    app.store.transact({ label: 'Lock' }, (tx) =>
      tx.patch('controls', WAVE.control, { locked: { ...control.locked, r: [true, true, true] } }),
    );
    const k = at(controller.keyPoint(WAVE.keys[0]));
    expect(controller.hitTest(k.x, k.y).kind).toBe('none');
  });

  it('stops reacting after dispose', async () => {
    const app = await waveApp();
    const m = mount(app);
    m.controller.dispose();
    m.controller.redraw(true);
    m.controller.pointerDown(pointer({ x: 5, y: 5 }));
    expect(m.controller.busy).toBe(false);
    m.dispose();
  });
});
