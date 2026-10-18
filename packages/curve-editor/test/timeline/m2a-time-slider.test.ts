// M2A-SPEC §5.9, §5.11 (A3) on the time slider: Mod+drag copies the band's keys, ripple band moves and scales over
// one global region (the band), the MMB drag carries the pose, breakdown ticks, the band grab points and key ticks
// of the test API, and the Ripple/Insert/Remove/Delete Time menu items.
import { registerBuiltinOperators } from '@ekza-animator/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TIMELINE_THEME } from '../../src/timeline/theme';
import {
  addCurve,
  hex,
  keyTimes,
  type Mounted,
  mount,
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

async function setUp(): Promise<Mounted> {
  mounted = mount(await waveApp());
  return mounted;
}

const near = (actual: readonly number[], expected: readonly number[], tolerance = 3): boolean =>
  actual.every((value, i) => Math.abs(value - expected[i]!) <= tolerance);

/** Drags with the left button from frame `from` to frame `to` (through `via`). */
function drag(m: Mounted, from: number, to: number, opts: { mod?: boolean; via?: readonly number[] } = {}): void {
  const { slider } = m;
  const mod = opts.mod === true;
  slider.pointerDown(pointer(slider.frameToX(from), { mod }));
  for (const frame of opts.via ?? []) slider.pointerMove(pointer(slider.frameToX(frame), { mod }));
  slider.pointerMove(pointer(slider.frameToX(to), { mod }));
  slider.pointerUp(pointer(slider.frameToX(to), { mod, buttons: 0 }));
}

/** Drags a band end (canvas x of its grab point) to frame `to`. */
function dragBandEnd(m: Mounted, part: 'start' | 'end', to: number): void {
  const { slider } = m;
  const grab = slider.bandPoint(part)!;
  slider.pointerDown(pointer(grab.x));
  slider.pointerMove(pointer(slider.frameToX(to)));
  slider.pointerUp(pointer(slider.frameToX(to), { buttons: 0 }));
}

async function band(m: Mounted, start: number, end: number): Promise<void> {
  await m.app.run('time.selectBand', { band: { start, end } });
}

function ripple(m: Mounted, on: boolean): void {
  const state = m.app.session.getState();
  m.app.session.setState({ tools: { ...state.tools, ripple: on } });
}

/** E2E-M2A-08's keys: the three arm controls keyed at 0/10/20 (the wave curve keeps 0/15/30). */
function armKeys(m: Mounted) {
  const curves = [
    addCurve(m.app, WAVE.upperArmL, 'rz', [0, 10, 20]),
    addCurve(m.app, WAVE.lowerArmL, 'rx', [0, 10, 20]),
    addCurve(m.app, WAVE.handL, 'rz', [0, 10, 20]),
  ];
  selectControls(m.app, [WAVE.upperArmL, WAVE.lowerArmL, WAVE.handL]);
  return curves;
}

describe('Mod+drag copies the band’s keys (§5.9)', () => {
  it('copies at t + Δ with the values of the originals, moves the band to the copies; one step "Copy Keys"', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    const before = m.app.store.snapshot();
    await band(m, 10, 10);
    drag(m, 10, 14, { mod: true, via: [11, 12.6] });
    await settle();
    for (const { curve } of curves) {
      expect(keyTimes(m.app, curve)).toEqual([0, 10, 14, 20]);
      const keys = m.app.store.query.keysOfCurve(curve);
      expect(keys[2]?.v).toBe(keys[1]?.v);
    }
    // The wave curve (fk.lowerArm.L rz) is a target too: it has no key in the band.
    expect(keyTimes(m.app, WAVE.curve)).toEqual([0, 15, 30]);
    expect(m.app.session.getState().time.band).toEqual({ start: 14, end: 14 });
    const selected = [...m.app.session.getState().selection.keys.keys()].map((id) => m.app.store.get('keys', id)?.t);
    expect(selected).toEqual([14, 14, 14]);
    expect(m.app.history.peekUndo()?.label).toBe('Copy Keys');
    m.app.history.undo();
    expect(m.app.store.snapshot()).toEqual(before);
  });

  it('a copy landing on a non-copied key replaces it; ripple does not apply to copies', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    ripple(m, true);
    await band(m, 10, 10);
    drag(m, 10, 20, { mod: true });
    await settle();
    for (const { curve } of curves) {
      expect(keyTimes(m.app, curve)).toEqual([0, 10, 20]);
      const keys = m.app.store.query.keysOfCurve(curve);
      expect(keys[2]?.v).toBe(keys[1]?.v);
    }
  });
});

describe('ripple band edits (§5.11): one global region, the band', () => {
  it('a band move shifts every target key at or after the band start (10 → 12, 20 → 22)', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    ripple(m, true);
    const before = m.app.store.snapshot();
    await band(m, 10, 10);
    drag(m, 10, 12);
    await settle();
    for (const { curve } of curves) expect(keyTimes(m.app, curve)).toEqual([0, 12, 22]);
    expect(m.app.session.getState().time.band).toEqual({ start: 12, end: 12 });
    m.app.history.undo();
    expect(m.app.store.snapshot()).toEqual(before);
  });

  it('a band scale shifts the keys after the band by one amount on every curve (E2E-M2A-08: +5, not +3)', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    const shoulder = addCurve(m.app, WAVE.hips, 'rz', [0, 6, 16]);
    selectControls(m.app, [WAVE.upperArmL, WAVE.lowerArmL, WAVE.handL, WAVE.hips]);
    ripple(m, true);
    const before = m.app.store.snapshot();
    await band(m, 0, 10);
    dragBandEnd(m, 'end', 15);
    await settle();
    for (const { curve } of curves) expect(keyTimes(m.app, curve)).toEqual([0, 15, 25]);
    expect(keyTimes(m.app, shoulder.curve)).toEqual([0, 9, 21]);
    expect(m.app.session.getState().time.band).toEqual({ start: 0, end: 15 });
    expect(m.app.history.peekUndo()?.label).toBe('Scale Keys');
    m.app.history.undo();
    expect(m.app.store.snapshot()).toEqual(before);
  });

  it('a band moved back stops once before the latest target key before it; the band follows the keys', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    ripple(m, true);
    await band(m, 20, 20);
    drag(m, 20, 4);
    await settle();
    // The wave curve's key at 15 (fk.lowerArm.L is a target) stops the block: it starts on 16, on every curve.
    for (const { curve } of curves) expect(keyTimes(m.app, curve)).toEqual([0, 10, 16]);
    expect(keyTimes(m.app, WAVE.curve)).toEqual([0, 15, 26]);
    expect(m.app.session.getState().time.band).toEqual({ start: 16, end: 16 });
  });

  it('without ripple the M1 band move leaves later keys alone', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    await band(m, 10, 10);
    drag(m, 10, 12);
    await settle();
    for (const { curve } of curves) expect(keyTimes(m.app, curve)).toEqual([0, 12, 20]);
  });
});

describe('MMB carry (§5.9, FR-TIME-10)', () => {
  it('an MMB drag scrubs carrying the pose: one "Carry Pose" step at the release frame', async () => {
    const m = await setUp();
    registerBuiltinOperators(m.app);
    selectControls(m.app, [WAVE.lowerArmL]);
    const at0 = m.app.evaluation.channelValues(WAVE.lowerArmL).rz;
    const { slider } = m;
    slider.pointerDown(pointer(slider.frameToX(0), { button: 1, buttons: 4 }));
    for (const frame of [3, 7, 10]) slider.pointerMove(pointer(slider.frameToX(frame), { button: 1, buttons: 4 }));
    slider.pointerUp(pointer(slider.frameToX(10), { button: 1, buttons: 0 }));
    await settle();
    expect(m.app.evaluation.clipFrame(WAVE.character)).toBe(10);
    expect(m.app.evaluation.channelValues(WAVE.lowerArmL).rz).toBeCloseTo(at0, 12);
    expect(m.app.session.getState().overrides.has(WAVE.lowerArmL)).toBe(true);
    expect(m.app.history.peekUndo()?.label).toBe('Carry Pose');
    m.app.history.undo();
    expect(m.app.history.canUndo()).toBe(false);
    expect(m.app.evaluation.clipFrame(WAVE.character)).toBe(10);
    expect(m.app.session.getState().overrides.size).toBe(0);
  });
});

describe('ticks, band points and the menu (§4.8, §5.9)', () => {
  it('reports key ticks with breakdown and selection flags; breakdown ticks are green, mixed ones red', async () => {
    const m = await setUp();
    const hand = addCurve(m.app, WAVE.handL, 'rx', [5, 15]);
    m.app.store.transact({ label: 'Breakdowns', undoable: false }, (tx) => {
      for (const id of [hand.keys[0], hand.keys[1]]) tx.patch('keys', id!, { breakdown: true });
    });
    const state = m.app.session.getState();
    m.app.session.setState({
      selection: { ...state.selection, keys: new Map([[WAVE.keys[2], { key: true, in: false, out: false }]]) },
    });
    expect(m.slider.keyTicks()).toEqual([
      { frame: 0, breakdown: false, selected: false },
      { frame: 5, breakdown: true, selected: false },
      { frame: 15, breakdown: false, selected: false },
      { frame: 30, breakdown: false, selected: true },
    ]);
    m.slider.redraw(true);
    const at = (frame: number) => pixel(m.canvas, m.slider.tickPoint(frame)!.x, m.slider.tickPoint(frame)!.y);
    expect(near(at(5), hex(DEFAULT_TIMELINE_THEME.keyBreakdown))).toBe(true);
    expect(near(at(15), hex(DEFAULT_TIMELINE_THEME.keyTick))).toBe(true);
    expect(near(at(30), hex(DEFAULT_TIMELINE_THEME.keySelected))).toBe(true);
  });

  it('merges fractional key times within 1e-6; a mixed tick is a key; any selected key there selects it', async () => {
    const m = await setUp();
    const hand = addCurve(m.app, WAVE.handL, 'rx', [2.5, 7.25, 15]);
    const upper = addCurve(m.app, WAVE.upperArmL, 'rx', [2.5000001, 7.25, 15.5]);
    m.app.store.transact({ label: 'Breakdowns', undoable: false }, (tx) => {
      for (const id of [hand.keys[0], upper.keys[0], hand.keys[1]]) tx.patch('keys', id!, { breakdown: true });
    });
    const state = m.app.session.getState();
    m.app.session.setState({
      selection: { ...state.selection, keys: new Map([[upper.keys[0]!, { key: true, in: false, out: false }]]) },
    });
    expect(m.slider.keyTicks()).toEqual([
      { frame: 0, breakdown: false, selected: false },
      { frame: 2.5, breakdown: true, selected: true },
      { frame: 7.25, breakdown: false, selected: false },
      { frame: 15, breakdown: false, selected: false },
      { frame: 15.5, breakdown: false, selected: false },
      { frame: 30, breakdown: false, selected: false },
    ]);
    // A key move refreshes the ticks (whole frames again: the dense path).
    m.app.store.transact({ label: 'Whole', undoable: false }, (tx) => {
      tx.patch('keys', hand.keys[0]!, { t: 3 });
      tx.patch('keys', upper.keys[0]!, { t: 3 });
      tx.patch('keys', hand.keys[1]!, { t: 7 });
      tx.patch('keys', upper.keys[1]!, { t: 7 });
      tx.patch('keys', upper.keys[2]!, { t: 16 });
    });
    expect(m.slider.keyTicks()).toEqual([
      { frame: 0, breakdown: false, selected: false },
      { frame: 3, breakdown: true, selected: true },
      { frame: 7, breakdown: false, selected: false },
      { frame: 15, breakdown: false, selected: false },
      { frame: 16, breakdown: false, selected: false },
      { frame: 30, breakdown: false, selected: false },
    ]);
  });

  it('band points hit the band handles; a 1-frame band has a middle only', async () => {
    const m = await setUp();
    expect(m.slider.bandPoint('middle')).toBeNull();
    await band(m, 5, 20);
    const kinds = (['start', 'middle', 'end'] as const).map((part) => {
      const point = m.slider.bandPoint(part)!;
      return m.slider.hitTest(point.x, point.y).kind;
    });
    expect(kinds).toEqual(['band-start', 'band-middle', 'band-end']);
    await band(m, 8, 8);
    expect(m.slider.bandPoint('start')).toBeNull();
    expect(m.slider.hitTest(m.slider.bandPoint('middle')!.x, 20).kind).toBe('band-middle');
  });

  it('the menu shows Ripple Edit checked while ripple is on', async () => {
    const m = await setUp();
    await band(m, 0, 10);
    const ripple = (): unknown => m.slider.contextMenu(0, 0).find((item) => item.op === 'key.toggleRipple');
    expect(ripple()).toMatchObject({ id: 'timeline.context.ripple', label: 'Ripple Edit', checked: false });
    const state = m.app.session.getState();
    m.app.session.setState({ tools: { ...state.tools, ripple: true } });
    expect(ripple()).toMatchObject({ checked: true });
    const time = m.slider.contextMenu(0, 0).filter((item) => item.op.startsWith('time.'));
    expect(time.map((item) => [item.label, item.args])).toEqual([
      ['Select Band Keys in Graph Editor', { band: { start: 0, end: 10 }, mode: 'replace' }],
      ['Insert Frame', { frames: 1 }],
      ['Remove Frame', { frames: -1 }],
      ['Delete Time', undefined],
    ]);
  });
});
