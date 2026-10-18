// TimeSliderController in Vitest browser mode against the shared test kit (MVP-SPEC §7 WP-6t tests): tick
// placement, Shift+click/drag bands, scrub snapping at 24 and 30 fps, hit priorities, menu actions and painting.
import { afterEach, describe, expect, it } from 'vitest';
import { registerTimelineContributions } from '../../src';
import { DEFAULT_TIMELINE_THEME } from '../../src/timeline/theme';
import {
  addCurve,
  callsOf,
  hex,
  type Mounted,
  mount,
  patchClip,
  pixel,
  pointer,
  selectControls,
  settle,
  WAVE,
  waveApp,
} from './fixture';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

async function setUp(opts?: { width?: number; dpr?: number }): Promise<Mounted> {
  mounted = mount(await waveApp(), opts);
  return mounted;
}

const near = (actual: readonly number[], expected: readonly number[], tolerance = 3): boolean =>
  actual.every((value, i) => Math.abs(value - expected[i]!) <= tolerance);

describe('TimeSliderController: frames and ticks', () => {
  it('spans the active clip range in clip frames', async () => {
    const { slider } = await setUp();
    expect(slider.frameToX(0)).toBeGreaterThanOrEqual(12);
    expect(slider.frameToX(30)).toBeCloseTo(620 - slider.frameToX(0), 9);
    for (const frame of [0, 7.5, 15, 29]) expect(slider.xToFrame(slider.frameToX(frame))).toBeCloseTo(frame, 9);
  });

  it('places ticks at the key times of the selected controls, or of all controls when none is selected', async () => {
    const { app, slider } = await setUp();
    const hand = addCurve(app, WAVE.handL, 'rx', [5, 15]);
    const at = (frame: number) => slider.tickPoint(frame);

    // Nothing selected: every control of the active character.
    for (const frame of [0, 5, 15, 30]) expect(at(frame)).toEqual({ x: slider.frameToX(frame), y: 21 });
    expect(at(7)).toBeNull();
    expect(at(15.00001)).toBeNull();
    expect(at(15.0000001)).toEqual({ x: slider.frameToX(15), y: 21 });

    selectControls(app, [WAVE.lowerArmL]);
    expect(at(5)).toBeNull();
    expect(at(30)).not.toBeNull();

    selectControls(app, [WAVE.handL]);
    expect([0, 5, 15, 30].map((frame) => at(frame) !== null)).toEqual([false, true, true, false]);

    selectControls(app, [WAVE.upperArmL]);
    expect(at(15)).toBeNull();

    // Ticks follow document edits, including keys of the clip that arrive later.
    selectControls(app, [WAVE.handL]);
    app.store.transact({ label: 'Retime' }, (tx) => tx.patch('keys', hand.keys[0]!, { t: 9 }));
    expect(at(5)).toBeNull();
    expect(at(9)).toEqual({ x: slider.frameToX(9), y: 21 });
  });

  it('follows the active clip: another clip has its own range and ticks', async () => {
    const { app, slider } = await setUp();
    const xOf15 = slider.frameToX(15);
    patchClip(app, { range: { start: 0, end: 60 } });
    expect(slider.frameToX(15)).toBeLessThan(xOf15);
    app.session.setState({ activeClip: {} });
    expect(slider.tickPoint(15)).toBeNull();
  });
});

describe('TimeSliderController: painting', () => {
  for (const dpr of [1, 2]) {
    it(`draws red key ticks, white selected ticks, the playhead and the auto-key border (DPR ${dpr})`, async () => {
      const { app, canvas, slider } = await setUp({ dpr });
      expect(canvas.width).toBe(620 * dpr);
      expect(canvas.height).toBe(30 * dpr);
      slider.redraw(true);
      const tick = slider.tickPoint(15)!;
      const background = hex(DEFAULT_TIMELINE_THEME.background);
      expect(near(pixel(canvas, tick.x, tick.y, dpr), hex(DEFAULT_TIMELINE_THEME.keyTick))).toBe(true);
      expect(near(pixel(canvas, slider.frameToX(7.5), tick.y, dpr), background)).toBe(true);
      expect(near(pixel(canvas, 300, 1, dpr), background)).toBe(true);

      const state = app.session.getState();
      app.session.setState({
        selection: { ...state.selection, keys: new Map([[WAVE.keys[1], { key: true, in: false, out: false }]]) },
        time: { ...state.time, sceneFrame: 10 },
      });
      app.prefs.setState({ autoKey: true });
      slider.redraw();
      expect(near(pixel(canvas, tick.x, tick.y, dpr), hex(DEFAULT_TIMELINE_THEME.keySelected))).toBe(true);
      expect(near(pixel(canvas, slider.frameToX(10), tick.y, dpr), hex(DEFAULT_TIMELINE_THEME.playhead))).toBe(true);
      expect(near(pixel(canvas, 300, 1, dpr), hex(DEFAULT_TIMELINE_THEME.autoKey))).toBe(true);
    });
  }

  it('draws the playhead at the active clip frame of the scene clock (24 fps clip, 30 fps scene)', async () => {
    const { app, canvas, slider } = await setUp();
    patchClip(app, { fps: { num: 24, den: 1 } });
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 30 } });
    slider.redraw();
    const playhead = hex(DEFAULT_TIMELINE_THEME.playhead);
    expect(near(pixel(canvas, slider.frameToX(24), 25), playhead)).toBe(true);
    expect(near(pixel(canvas, slider.frameToX(30), 25), playhead)).toBe(false);
  });

  it('shades frames outside the playback range and keeps redraw idempotent', async () => {
    const { app, canvas, slider } = await setUp();
    slider.redraw(true);
    const inside = pixel(canvas, slider.frameToX(5) + 3, 25);
    app.session.setState({ time: { ...app.session.getState().time, playbackRange: { start: 10, end: 20 } } });
    slider.redraw();
    const shaded = pixel(canvas, slider.frameToX(5) + 3, 25);
    expect(shaded[0]!).toBeLessThan(inside[0]!);
    expect(near(pixel(canvas, slider.frameToX(15) + 3, 25), inside)).toBe(true);
    slider.redraw();
    expect(pixel(canvas, slider.frameToX(5) + 3, 25)).toEqual(shaded);
  });
});

describe('TimeSliderController: bands', () => {
  it('Shift+click selects the frame under the pointer as a 1-frame band with its keys', async () => {
    const { app, slider } = await setUp();
    slider.pointerDown(pointer(slider.frameToX(15) + 4, { shift: true }));
    slider.pointerUp(pointer(slider.frameToX(15) + 4, { shift: true, buttons: 0 }));
    await settle();
    const state = app.session.getState();
    expect(state.time.band).toEqual({ start: 15, end: 15 });
    expect([...state.selection.keys]).toEqual([[WAVE.keys[1], { key: true, in: false, out: false }]]);
    expect(callsOf(app, 'time.selectBand')).toEqual([{ band: { start: 15, end: 15 }, mode: 'replace' }]);
  });

  it('Shift+drag selects a range band (normalized, whole frames) with the keys of the target controls', async () => {
    const { app, slider } = await setUp();
    const hand = addCurve(app, WAVE.handL, 'rx', [4, 12, 20, 26]);
    slider.pointerDown(pointer(slider.frameToX(20.3), { shift: true }));
    slider.pointerMove(pointer(slider.frameToX(11.6), { shift: true }));
    slider.pointerMove(pointer(slider.frameToX(5.2), { shift: true }));
    slider.pointerUp(pointer(slider.frameToX(5.2), { shift: true, buttons: 0 }));
    await settle();
    let state = app.session.getState();
    expect(state.time.band).toEqual({ start: 5, end: 20 });
    expect(new Set(state.selection.keys.keys())).toEqual(new Set([WAVE.keys[1], hand.keys[1], hand.keys[2]]));

    // Only the selected controls' keys are banded.
    selectControls(app, [WAVE.lowerArmL]);
    slider.pointerDown(pointer(slider.frameToX(0), { shift: true }));
    slider.pointerMove(pointer(slider.frameToX(13), { shift: true }));
    slider.pointerUp(pointer(slider.frameToX(13), { shift: true, buttons: 0 }));
    await settle();
    state = app.session.getState();
    expect(state.time.band).toEqual({ start: 0, end: 13 });
    expect([...state.selection.keys.keys()]).toEqual([WAVE.keys[0]]);
  });

  it('a plain click clears the band and scrubs, inside it as well (no drag: acceptance round 2)', async () => {
    const { app, slider } = await setUp();
    slider.pointerDown(pointer(slider.frameToX(10), { shift: true }));
    slider.pointerMove(pointer(slider.frameToX(20), { shift: true }));
    slider.pointerUp(pointer(slider.frameToX(20), { shift: true, buttons: 0 }));
    await settle();
    expect(app.session.getState().time.band).toEqual({ start: 10, end: 20 });
    slider.pointerDown(pointer(slider.frameToX(14)));
    slider.pointerUp(pointer(slider.frameToX(14), { buttons: 0 }));
    await settle();
    expect(app.session.getState().time.band).toBeNull();
    expect(callsOf(app, 'time.setFrame')).toEqual([{ frame: 14, unit: 'clip' }]);

    slider.pointerDown(pointer(slider.frameToX(15), { shift: true }));
    slider.pointerUp(pointer(slider.frameToX(15), { shift: true, buttons: 0 }));
    await settle();
    expect(app.session.getState().time.band).toEqual({ start: 15, end: 15 });
    slider.pointerDown(pointer(slider.frameToX(25)));
    slider.pointerUp(pointer(slider.frameToX(25), { buttons: 0 }));
    await settle();
    const state = app.session.getState();
    expect(state.time.band).toBeNull();
    expect(state.selection.keys.size).toBe(0);
    expect(callsOf(app, 'time.setFrame')).toEqual([
      { frame: 14, unit: 'clip' },
      { frame: 25, unit: 'clip' },
    ]);
  });

  it('hit-tests band ends before the band middle, the middle before ticks, ticks before the ruler', async () => {
    const { app, slider } = await setUp();
    expect(slider.hitTest(slider.frameToX(15) + 3, 20)).toEqual({ kind: 'tick', frame: 15 });
    expect(slider.hitTest(slider.frameToX(15) + 6, 20)).toEqual({ kind: 'ruler', frame: 15 });
    expect(slider.hitTest(slider.frameToX(17.3), 5)).toEqual({ kind: 'ruler', frame: 17 });

    await app.run('time.selectBand', { band: { start: 10, end: 20 } });
    const left = slider.frameToX(9.5);
    const right = slider.frameToX(20.5);
    expect(slider.hitTest(left - 3, 20)).toEqual({ kind: 'band-start', frame: 10 });
    expect(slider.hitTest(left + 5, 20)).toEqual({ kind: 'band-start', frame: 10 });
    expect(slider.hitTest(right + 3, 20)).toEqual({ kind: 'band-end', frame: 20 });
    expect(slider.hitTest(right - 5, 20)).toEqual({ kind: 'band-end', frame: 20 });
    expect(slider.hitTest(slider.frameToX(15), 20)).toEqual({ kind: 'band-middle', frame: 15 });
    expect(slider.hitTest(slider.frameToX(10), 20)).toEqual({ kind: 'band-middle', frame: 10 });
    expect(slider.hitTest(slider.frameToX(0), 20)).toEqual({ kind: 'tick', frame: 0 });

    // A 1-frame band only moves: its whole cell is the middle.
    await app.run('time.selectBand', { band: { start: 15, end: 15 } });
    expect(slider.hitTest(slider.frameToX(14.6), 20)).toEqual({ kind: 'band-middle', frame: 15 });
    expect(slider.hitTest(slider.frameToX(15.4), 20)).toEqual({ kind: 'band-middle', frame: 15 });
  });

  it('cancel() ends a band selection where it is and ignores later moves', async () => {
    const { app, slider } = await setUp();
    slider.pointerDown(pointer(slider.frameToX(2), { shift: true }));
    slider.pointerMove(pointer(slider.frameToX(8), { shift: true }));
    expect(slider.dragging).toBe(true);
    slider.cancel();
    slider.pointerMove(pointer(slider.frameToX(20), { shift: true }));
    slider.pointerUp(pointer(slider.frameToX(20), { shift: true, buttons: 0 }));
    await settle();
    expect(slider.dragging).toBe(false);
    expect(app.session.getState().time.band).toEqual({ start: 2, end: 8 });
  });
});

describe('TimeSliderController: scrubbing', () => {
  for (const fps of [30, 24]) {
    it(`scrubs whole active-clip frames at ${fps} fps, clamped to the clip range`, async () => {
      const { app, slider } = await setUp();
      if (fps !== 30) patchClip(app, { fps: { num: fps, den: 1 } });
      slider.pointerDown(pointer(slider.frameToX(12.4)));
      slider.pointerMove(pointer(slider.frameToX(12.6)));
      slider.pointerMove(pointer(slider.frameToX(12.8)));
      slider.pointerMove(pointer(slider.frameToX(17.49)));
      slider.pointerMove(pointer(slider.frameToX(45)));
      slider.pointerMove(pointer(-50));
      slider.pointerUp(pointer(-50, { buttons: 0 }));
      expect(callsOf(app, 'time.setFrame')).toEqual([12, 13, 17, 30, 0].map((frame) => ({ frame, unit: 'clip' })));
    });
  }

  it('scrubs sub-frames when snapping to frames is off', async () => {
    const { app, slider } = await setUp();
    app.session.setState({ time: { ...app.session.getState().time, snapToFrames: false } });
    slider.pointerDown(pointer(slider.frameToX(12.25)));
    const [args] = callsOf(app, 'time.setFrame') as [{ frame: number }];
    expect(args.frame).toBeCloseTo(12.25, 9);
  });

  it('ignores RMB and pointer moves without a gesture', async () => {
    const { app, slider } = await setUp();
    slider.pointerDown(pointer(slider.frameToX(5), { button: 2, buttons: 2 }));
    slider.pointerMove(pointer(slider.frameToX(9), { buttons: 0 }));
    expect(app.calls).toEqual([]);
  });

  // M2a §5.9 (FR-TIME-10; literal update of the M1 "ignores MMB" case, M2A-SPEC §3 rule 8): an MMB drag scrubs
  // with carry.
  it('scrubs with carry on an MMB drag', async () => {
    const { app, slider } = await setUp();
    slider.pointerDown(pointer(slider.frameToX(5), { button: 1, buttons: 4 }));
    slider.pointerMove(pointer(slider.frameToX(9), { button: 1, buttons: 4 }));
    slider.pointerUp(pointer(slider.frameToX(9), { button: 1, buttons: 0 }));
    expect(callsOf(app, 'time.setFrame')).toEqual([
      { frame: 5, unit: 'clip', carry: true },
      { frame: 9, unit: 'clip', carry: true },
    ]);
  });
});

describe('TimeSliderController: RMB menu', () => {
  const BAND_MENU = [
    ['Delete Keys', 'graph.keys.delete'],
    ['Copy Keys', 'graph.keys.copy'],
    ['Paste Keys', 'graph.keys.paste'],
    ['Auto', 'graph.tangent.set'],
    ['Spline', 'graph.tangent.set'],
    ['Clamped', 'graph.tangent.set'],
    ['Linear', 'graph.tangent.set'],
    ['Flat', 'graph.tangent.set'],
    ['Stepped', 'graph.tangent.set'],
    ['Select Band Keys in Graph Editor', 'time.selectBand'],
    // M2a (M2A-SPEC §5.9, §7; literal update, §3 rule 8)
    ['Ripple Edit', 'key.toggleRipple'],
    ['Insert Frame', 'time.insertTime'],
    ['Remove Frame', 'time.insertTime'],
    ['Delete Time', 'time.deleteTime'],
  ];
  const selectItem = (items: readonly { readonly op: string; readonly args?: unknown }[]) =>
    items.find((item) => item.op === 'time.selectBand');

  it('offers delete, copy, paste, tangent types and graph selection for the band', async () => {
    const { app, slider } = await setUp();
    await app.run('time.selectBand', { band: { start: 10, end: 20 } });
    const items = slider.contextMenu(100, 20);
    expect(items.map((item) => [item.label, item.op])).toEqual(BAND_MENU);
    expect(items.filter((item) => item.op === 'graph.tangent.set').map((item) => item.args)).toEqual(
      ['auto', 'spline', 'clamped', 'linear', 'flat', 'step'].map((type) => ({ type })),
    );
    expect(selectItem(items)?.args).toEqual({ band: { start: 10, end: 20 }, mode: 'replace' });
    expect(items[0]).not.toHaveProperty('args');
    await settle();
    expect(app.session.getState().time.band).toEqual({ start: 10, end: 20 });
  });

  // Acceptance round 3: without a band the menu offered Paste only (Maya acts on the current frame).
  it('without a band the menu selects the current frame as a 1-frame band and acts on its keys', async () => {
    const { app, slider } = await setUp();
    selectControls(app, [WAVE.lowerArmL]);
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 15 } });
    const items = slider.contextMenu(100, 20);
    expect(items.map((item) => [item.label, item.op])).toEqual(BAND_MENU);
    expect(selectItem(items)?.args).toEqual({ band: { start: 15, end: 15 }, mode: 'replace' });
    await settle();
    expect(app.session.getState().time.band).toEqual({ start: 15, end: 15 });
    expect([...app.session.getState().selection.keys.keys()]).toEqual([WAVE.keys[1]]);
    // The band now exists: opening the menu again keeps it.
    expect(slider.contextMenu(100, 20)).toHaveLength(BAND_MENU.length);
    expect(callsOf(app, 'time.selectBand')).toHaveLength(1);

    // No active clip: no band to select, Paste only (and the M2a time items, which poll-fail without a clip).
    app.session.setState({ activeClip: {}, time: { ...app.session.getState().time, band: null } });
    expect(slider.contextMenu(100, 20).map((item) => item.id)).toEqual([
      'timeline.context.paste',
      'timeline.context.ripple',
      'timeline.context.insert-frame',
      'timeline.context.remove-frame',
      'timeline.context.delete-time',
    ]);
    await settle();
    expect(app.session.getState().time.band).toBeNull();
  });

  it('includes items other packages contribute to timeline.context, after the built-in groups', async () => {
    const { app, slider } = await setUp();
    const dispose = app.contribute({
      kind: 'menu',
      def: { id: 'acme.bake', menu: 'timeline.context', op: 'acme.bakeRange', group: 'acme', order: 1 },
    });
    app.contribute({
      kind: 'operator',
      def: { id: 'acme.bakeRange', label: 'Bake Range', category: 'acme', scope: 'timeline', apply: () => undefined },
    });
    const ids = slider.contextMenu(0, 0).map((item) => [item.id, item.label]);
    expect(ids.at(-1)).toEqual(['acme.bake', 'Bake Range']);
    expect(ids.slice(0, -1).map(([, label]) => label)).toEqual(BAND_MENU.map(([label]) => label));
    dispose();
    expect(slider.contextMenu(0, 0)).toHaveLength(BAND_MENU.length);
  });
});

describe('time.selectBand', () => {
  it('replaces, adds, toggles and removes the band keys and returns their count', async () => {
    const { app } = await setUp();
    const hand = addCurve(app, WAVE.handL, 'rx', [10, 20]);
    const run = (band: { start: number; end: number } | null, mode?: 'replace' | 'add' | 'toggle' | 'remove') =>
      app.run('time.selectBand', mode === undefined ? { band } : { band, mode });
    const selected = () => new Set(app.session.getState().selection.keys.keys());

    expect(await run({ start: 0, end: 10 })).toEqual({ status: 'finished', value: { count: 2 } });
    expect(selected()).toEqual(new Set([WAVE.keys[0], hand.keys[0]]));
    expect(await run({ start: 20, end: 15 }, 'add')).toEqual({ status: 'finished', value: { count: 2 } });
    expect(app.session.getState().time.band).toEqual({ start: 15, end: 20 });
    expect(selected()).toEqual(new Set([WAVE.keys[0], hand.keys[0], WAVE.keys[1], hand.keys[1]]));
    await run({ start: 10, end: 15 }, 'toggle');
    expect(selected()).toEqual(new Set([WAVE.keys[0], hand.keys[1]]));
    await run({ start: 0, end: 30 }, 'remove');
    expect(selected()).toEqual(new Set());

    await run({ start: 0, end: 30 });
    expect(await run(null)).toEqual({ status: 'finished', value: { count: 0 } });
    expect(app.session.getState().time.band).toBeNull();
    expect(selected()).toEqual(new Set());
  });

  it('leaves keys of locked curves out and does not record a history step', async () => {
    const { app } = await setUp();
    const locked = addCurve(app, WAVE.hips, 'ry', [15], { locked: true });
    await app.run('time.selectBand', { band: { start: 15, end: 15 } });
    const keys = app.session.getState().selection.keys;
    expect(keys.has(WAVE.keys[1])).toBe(true);
    expect(keys.has(locked.keys[0]!)).toBe(false);
    expect(app.history.peekUndo()?.label).not.toBe('Select Time Range');
  });

  it('polls: needs a band argument and an active clip to select a band', async () => {
    const { app } = await setUp();
    expect(await app.runUntyped('time.selectBand', {})).toMatchObject({ status: 'cancelled' });
    expect(await app.runUntyped('time.selectBand', { band: { start: 'a', end: 2 } })).toMatchObject({
      status: 'cancelled',
    });
    expect(await app.runUntyped('time.selectBand', { band: null, mode: 'invert' })).toMatchObject({
      status: 'cancelled',
    });
    app.session.setState({ activeClip: {} });
    expect(await app.run('time.selectBand', { band: { start: 1, end: 2 } })).toEqual({
      status: 'cancelled',
      reason: 'no active clip',
    });
    expect(await app.run('time.selectBand', { band: null })).toMatchObject({ status: 'finished' });
  });

  it('is registered by registerTimelineContributions and removed by its disposer', async () => {
    const app = await waveApp();
    const dispose = registerTimelineContributions(app, () => null);
    expect(app.operators.get('time.selectBand')?.scope).toBe('timeline');
    // 10 M1 items + Ripple Edit, Insert Frame, Remove Frame, Delete Time (M2a; literal update, §3 rule 8).
    expect(app.menus.list().filter((item) => item.menu === 'timeline.context')).toHaveLength(14);
    expect(() => registerTimelineContributions(app, () => null)).toThrow('already registered');
    expect(app.menus.list()).toHaveLength(14); // a failed second registration leaves the first intact
    dispose();
    expect(app.operators.get('time.selectBand')).toBeUndefined();
    expect(app.menus.list()).toEqual([]);
    app.dispose();
  });
});

describe('TimeSliderController: lifecycle', () => {
  it('redraws on a scheduled animation frame after state changes and stops after dispose', async () => {
    const { app, canvas, slider } = await setUp();
    slider.redraw(true);
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 20 } });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const playhead = hex(DEFAULT_TIMELINE_THEME.playhead);
    expect(near(pixel(canvas, slider.frameToX(20), 25), playhead)).toBe(true);
    slider.dispose();
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 5 } });
    slider.redraw(true);
    expect(near(pixel(canvas, slider.frameToX(20), 25), playhead)).toBe(true);
  });
});
