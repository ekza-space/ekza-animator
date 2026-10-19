// DopeSheetController interactions (M2A-SPEC §5.10, §5.11, A3): hit-testing and probe points, glyph clicks with
// modifiers, empty clicks, marquee, key drags as one history step (Select/Move tools, MMB), region-bar move and
// scale, the Scale tool, ripple over the shown controls, Esc, Mod+A, ruler scrub, wheel per profile, framing,
// `dopeSheet.frame` and the tools, and painting at DPR 1 and 2.
import { DOPE_TOOL } from '@ekza-animator/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DOPE_THEME } from '../../src/dopesheet/theme';
import {
  CONTROLS,
  dopeApp,
  dragPoints,
  hex,
  keyCurve,
  type MountedSheet,
  mountSheet,
  pixel,
  pointer,
  selectControls,
  selectedKeys,
  setKeySelection,
  settle,
  times,
  WAVE,
  wheel,
  xOf,
} from './fixture';

let mounted: MountedSheet | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

const DEG = Math.PI / 180;

async function setUp(opts: { width?: number; height?: number; dpr?: number } = {}): Promise<MountedSheet> {
  mounted = mountSheet(await dopeApp(), opts);
  // Only the keys a test sets animate (the wave curve's keys go).
  keyCurve(mounted.app, CONTROLS.lowerArmL, 'rz', []);
  mounted.sheet.redraw(true); // frames the clip range
  return mounted;
}

/** E2E-M2A-10: the three arm controls' rz at 0/10/20, selected. */
function armKeys(m: MountedSheet) {
  const points = [
    [0, 0],
    [10, 30 * DEG],
    [20, 60 * DEG],
  ] as const;
  const curves = [
    keyCurve(m.app, CONTROLS.upperArmL, 'rz', points),
    keyCurve(m.app, CONTROLS.lowerArmL, 'rz', points),
    keyCurve(m.app, CONTROLS.handL, 'rz', points),
  ];
  selectControls(m.app, [CONTROLS.upperArmL, CONTROLS.lowerArmL, CONTROLS.handL]);
  return curves;
}

const glyph = (m: MountedSheet, row: string, frame: number) => {
  const point = m.sheet.glyphPoint(row, frame);
  if (point === null) throw new Error(`no glyph of ${row} at ${frame}`);
  return point;
};

describe('probes and hit-testing', () => {
  it('glyph points hit their glyphs; the ruler and empty rows hit as such', async () => {
    const m = await setUp();
    armKeys(m);
    const at10 = glyph(m, 'summary', 10);
    expect(m.sheet.hitTest(at10.x + 3, at10.y + 2)).toEqual({ kind: 'glyph', row: 'summary', frame: 10 });
    expect(m.sheet.glyphPoint('summary', 11)).toBeNull();
    expect(m.sheet.glyphPoint('nope', 10)).toBeNull();
    const empty = m.sheet.hitTest(xOf(m.sheet, 15), at10.y);
    expect(empty).toMatchObject({ kind: 'none', row: 'summary' });
    expect(m.sheet.hitTest(xOf(m.sheet, 7.4), 5)).toEqual({ kind: 'ruler', frame: 7 });
    expect(m.sheet.hitTest(10, 290)).toMatchObject({ kind: 'none', row: null });
  });

  it('the region bar spans the selected keys; its points hit start, middle and end', async () => {
    const m = await setUp();
    const [upper] = armKeys(m);
    expect(m.sheet.regionPoint('middle')).toBeNull();
    setKeySelection(m.app, [upper!.keys[0]!, upper!.keys[2]!]);
    const kinds = (['start', 'middle', 'end'] as const).map((part) => {
      const point = m.sheet.regionPoint(part)!;
      return m.sheet.hitTest(point.x, point.y).kind;
    });
    expect(kinds).toEqual(['region-start', 'region-middle', 'region-end']);
    setKeySelection(m.app, [upper!.keys[1]!]);
    expect(m.sheet.regionPoint('start')).toBeNull();
    expect(m.sheet.hitTest(m.sheet.regionPoint('middle')!.x, 26).kind).toBe('region-middle');
  });
});

describe('the region bar when narrow', () => {
  it('keeps its middle grabbable: the handles reach a quarter of the bar inside (the time slider’s band rule)', async () => {
    const m = await setUp();
    const [upper] = armKeys(m);
    setKeySelection(m.app, [upper!.keys[0]!, upper!.keys[1]!]); // 0…10
    m.sheet.setView({ ...m.sheet.view, f0: -5, sx: 0.4 }); // the bar is 4 px wide
    const x0 = xOf(m.sheet, 0);
    const x1 = xOf(m.sheet, 10);
    const y = m.sheet.regionPoint('middle')!.y;
    expect(m.sheet.hitTest((x0 + x1) / 2, y).kind).toBe('region-middle');
    expect(m.sheet.hitTest(x0 - 5, y).kind).toBe('region-start');
    expect(m.sheet.hitTest(x0 + 0.5, y).kind).toBe('region-start');
    expect(m.sheet.hitTest(x1 + 5, y).kind).toBe('region-end');
    expect(m.sheet.hitTest(x1 - 0.5, y).kind).toBe('region-end');
    expect(m.sheet.hitTest(x1 + 8, y).kind).toBe('none');
  });
});

describe('selection (§5.10)', () => {
  it('a glyph click selects every key under the row there; Shift toggles, Mod removes, Mod+Shift adds', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    const at = (frame: number) => glyph(m, 'summary', frame);
    const click = (frame: number, mods: { shift?: boolean; mod?: boolean } = {}) => {
      m.sheet.pointerDown(pointer(at(frame).x, at(frame).y, mods));
      m.sheet.pointerUp(pointer(at(frame).x, at(frame).y, { ...mods, buttons: 0 }));
    };
    const keysAt = (index: number) => curves.map((curve) => curve.keys[index]!);
    click(10);
    expect(new Set(selectedKeys(m.app))).toEqual(new Set(keysAt(1)));
    click(0, { shift: true });
    expect(new Set(selectedKeys(m.app))).toEqual(new Set([...keysAt(1), ...keysAt(0)]));
    click(0, { shift: true });
    expect(new Set(selectedKeys(m.app))).toEqual(new Set(keysAt(1)));
    click(20, { shift: true, mod: true });
    click(20, { shift: true, mod: true });
    expect(new Set(selectedKeys(m.app))).toEqual(new Set([...keysAt(1), ...keysAt(2)]));
    click(10, { mod: true });
    expect(new Set(selectedKeys(m.app))).toEqual(new Set(keysAt(2)));
    // A click on a selected glyph narrows the selection to it on release.
    click(0, { shift: true, mod: true });
    click(20);
    expect(new Set(selectedKeys(m.app))).toEqual(new Set(keysAt(2)));
    // A click on empty canvas clears the key selection.
    m.sheet.pointerDown(pointer(xOf(m.sheet, 15), at(10).y));
    m.sheet.pointerUp(pointer(xOf(m.sheet, 15), at(10).y, { buttons: 0 }));
    expect(selectedKeys(m.app)).toEqual([]);
  });

  it('a marquee selects the keys of the rows it crosses between its frames', async () => {
    const m = await setUp();
    const [upper, lower, hand] = armKeys(m);
    const upperRow = glyph(m, CONTROLS.upperArmL, 10);
    const lowerRow = glyph(m, CONTROLS.lowerArmL, 10);
    dragPoints(m.sheet, { x: xOf(m.sheet, 5), y: upperRow.y - 4 }, { x: xOf(m.sheet, 25), y: lowerRow.y + 4 });
    expect(new Set(selectedKeys(m.app))).toEqual(
      new Set([upper!.keys[1]!, upper!.keys[2]!, lower!.keys[1]!, lower!.keys[2]!]),
    );
    expect(selectedKeys(m.app)).not.toContain(hand!.keys[1]);
  });

  it('Mod+A selects every shown key; Esc and other keys are not consumed when idle', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    expect(
      m.sheet.key({ type: 'down', code: 'KeyA', mod: true, shift: false, alt: false, ctrl: false, repeat: false }),
    ).toBe(true);
    expect(new Set(selectedKeys(m.app))).toEqual(new Set(curves.flatMap((curve) => curve.keys)));
    expect(
      m.sheet.key({ type: 'down', code: 'Escape', mod: false, shift: false, alt: false, ctrl: false, repeat: false }),
    ).toBe(false);
    expect(
      m.sheet.key({ type: 'down', code: 'KeyS', mod: false, shift: false, alt: false, ctrl: false, repeat: false }),
    ).toBe(false);
  });

  it('a double-click on a row label selects all its keys (selectRowKeys)', async () => {
    const m = await setUp();
    const [upper, , hand] = armKeys(m);
    m.sheet.selectRowKeys(CONTROLS.handL, 'replace');
    expect(new Set(selectedKeys(m.app))).toEqual(new Set(hand!.keys));
    m.sheet.selectRowKeys(CONTROLS.upperArmL, 'add');
    expect(new Set(selectedKeys(m.app))).toEqual(new Set([...hand!.keys, ...upper!.keys]));
  });
});

describe('key drags (§5.10): one history step each', () => {
  it('dragging a summary glyph moves the keys under it (E2E-M2A-10: 10 → 13); undo restores', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    const before = m.app.store.snapshot();
    const at10 = glyph(m, 'summary', 10);
    dragPoints(m.sheet, at10, { x: xOf(m.sheet, 13), y: at10.y });
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([0, 13, 20]);
    expect(m.app.history.peekUndo()?.label).toBe('Move Keys');
    expect(m.app.store.preview).toBeNull();
    m.app.history.undo();
    expect(m.app.store.snapshot()).toEqual(before);
  });

  it('dragging the region end scales around its start (E2E-M2A-10: 0…20 → 0…40)', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    m.sheet.selectAll();
    m.sheet.setView({ ...m.sheet.view, f0: -2, sx: 10 });
    const end = m.sheet.regionPoint('end')!;
    dragPoints(m.sheet, end, { x: xOf(m.sheet, 40), y: end.y });
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([0, 20, 40]);
    expect(m.app.history.peekUndo()?.label).toBe('Scale Keys');
  });

  it('the region middle and an MMB drag anywhere move the selected keys', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    m.sheet.selectRowKeys('summary', 'replace');
    const middle = m.sheet.regionPoint('middle')!;
    dragPoints(m.sheet, middle, { x: middle.x + 2 * m.sheet.view.sx, y: middle.y });
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([2, 12, 22]);
    const anywhere = { x: xOf(m.sheet, 5), y: 120 };
    dragPoints(m.sheet, anywhere, { x: anywhere.x - 2 * m.sheet.view.sx, y: 140 }, { button: 1, buttons: 4 });
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([0, 10, 20]);
    expect(m.app.history.peekUndo()?.label).toBe('Move Keys');
  });

  it('the Move tool drags the selection from anywhere; the Scale tool scales around the press frame', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    m.app.session.setState({ tools: { ...m.app.session.getState().tools, dopeSheet: DOPE_TOOL.move } });
    m.sheet.selectRowKeys('summary', 'replace');
    const from = { x: xOf(m.sheet, 25), y: 120 };
    dragPoints(m.sheet, from, { x: xOf(m.sheet, 26), y: 120 });
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([1, 11, 21]);
    m.app.session.setState({ tools: { ...m.app.session.getState().tools, dopeSheet: DOPE_TOOL.scale } });
    // Press at frame 1 (the pivot); the far end (21) follows the pointer: 21 → 41, factor 2.
    const pivot = { x: xOf(m.sheet, 1), y: 120 };
    dragPoints(m.sheet, pivot, { x: xOf(m.sheet, 21), y: 120 });
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([1, 21, 41]);
    expect(m.app.history.peekUndo()?.label).toBe('Scale Keys');
  });

  it('Esc cancels a drag without a trace; Alt disables snapping', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    const at10 = glyph(m, 'summary', 10);
    m.sheet.pointerDown(pointer(at10.x, at10.y));
    m.sheet.pointerMove(pointer(at10.x + 3 * m.sheet.view.sx, at10.y));
    expect(m.sheet.dragging).toBe(true);
    expect(
      m.sheet.key({ type: 'down', code: 'Escape', mod: false, shift: false, alt: false, ctrl: false, repeat: false }),
    ).toBe(true);
    m.sheet.pointerUp(pointer(at10.x + 3 * m.sheet.view.sx, at10.y, { buttons: 0 }));
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([0, 10, 20]);
    expect(m.app.history.canUndo()).toBe(false);
    dragPoints(m.sheet, at10, { x: at10.x + 2.5 * m.sheet.view.sx, y: at10.y }, { alt: true });
    for (const { curve } of curves) expect(times(m.app, curve)[1]).toBeCloseTo(12.5, 6);
  });
});

describe('ripple in the Dope Sheet (§5.11, E2E-M2A-11)', () => {
  it('moves and scales every later key of the shown controls by one amount', async () => {
    const m = await setUp();
    const curves = armKeys(m);
    const shoulder = keyCurve(m.app, CONTROLS.shoulderL, 'rz', [
      [0, 0],
      [6, 10 * DEG],
      [16, 0],
    ]);
    selectControls(m.app, [CONTROLS.shoulderL, CONTROLS.upperArmL, CONTROLS.lowerArmL, CONTROLS.handL]);
    m.app.session.setState({ tools: { ...m.app.session.getState().tools, ripple: true } });
    const before = m.app.store.snapshot();
    const at10 = glyph(m, 'summary', 10);
    dragPoints(m.sheet, at10, { x: xOf(m.sheet, 15), y: at10.y });
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([0, 15, 25]);
    expect(times(m.app, shoulder.curve)).toEqual([0, 6, 21]);
    m.app.history.undo();
    expect(m.app.store.snapshot()).toEqual(before);

    // Select the summary glyphs at 0, 6 and 10, scale the region 0…10 by 2 around 0: every later key +10.
    for (const [frame, shift] of [
      [0, false],
      [6, true],
      [10, true],
    ] as const) {
      const p = glyph(m, 'summary', frame);
      m.sheet.pointerDown(pointer(p.x, p.y, { shift }));
      m.sheet.pointerUp(pointer(p.x, p.y, { shift, buttons: 0 }));
    }
    const end = m.sheet.regionPoint('end')!;
    dragPoints(m.sheet, end, { x: xOf(m.sheet, 20), y: end.y });
    for (const { curve } of curves) expect(times(m.app, curve)).toEqual([0, 20, 30]);
    expect(times(m.app, shoulder.curve)).toEqual([0, 12, 26]);
    m.app.history.undo();
    expect(m.app.store.snapshot()).toEqual(before);
  });
});

describe('view, scrub and framing', () => {
  it('scrubs from the ruler (time.setFrame in clip frames)', async () => {
    const m = await setUp();
    dragPoints(m.sheet, { x: xOf(m.sheet, 4), y: 6 }, { x: xOf(m.sheet, 9), y: 6 });
    await settle();
    expect(m.app.evaluation.clipFrame(WAVE.character)).toBe(9);
  });

  it('Maya profile: wheel zooms time around the cursor, Shift+wheel scrolls rows; trackpad: scroll pans', async () => {
    const m = await setUp({ height: 120 });
    m.sheet.setShow('character');
    for (const control of [CONTROLS.cog, CONTROLS.hips, CONTROLS.upperArmL, CONTROLS.handL, CONTROLS.upperLegL]) {
      keyCurve(m.app, control, 'rz', [[0, 1]]);
    }
    for (const id of m.sheet
      .rows()
      .filter((row) => row.kind === 'control')
      .map((row) => row.id)) {
      m.sheet.setExpanded(id, false);
    }
    const frameUnder = m.sheet.view.f0 + 200 / m.sheet.view.sx;
    m.sheet.wheel(wheel(200, 50, { deltaY: -100 }));
    expect(m.sheet.view.sx).toBeGreaterThan(10);
    expect(m.sheet.view.f0 + 200 / m.sheet.view.sx).toBeCloseTo(frameUnder, 9);
    m.sheet.wheel(wheel(200, 50, { deltaY: 40, shift: true }));
    expect(m.sheet.view.scrollY).toBe(40);
    m.sheet.wheel(wheel(200, 50, { deltaY: 10_000, shift: true }));
    // Clamped: the last row can reach the top of the rows area.
    expect(m.sheet.view.scrollY).toBe(m.sheet.rows().length * 20 - (120 - 32));
    m.app.prefs.setState({ navProfile: 'trackpad' });
    const { f0, sx } = m.sheet.view;
    m.sheet.wheel(wheel(200, 50, { deltaX: 30, deltaY: -10_000 }));
    expect(m.sheet.view).toEqual({ f0: f0 + 30 / sx, sx, scrollY: 0 });
    m.sheet.wheel(wheel(200, 50, { deltaY: -50, ctrl: true }));
    expect(m.sheet.view.sx).toBeGreaterThan(sx);
  });

  it('Alt+MMB pans and Alt+RMB zooms time (Maya profile)', async () => {
    const m = await setUp();
    const { f0, sx } = m.sheet.view;
    dragPoints(m.sheet, { x: 300, y: 100 }, { x: 250, y: 100 }, { button: 1, buttons: 4, alt: true });
    expect(m.sheet.view.f0).toBeCloseTo(f0 + 50 / sx, 9);
    dragPoints(m.sheet, { x: 300, y: 100 }, { x: 350, y: 100 }, { button: 2, buttons: 2, alt: true });
    expect(m.sheet.view.sx).toBeGreaterThan(sx);
  });

  it('frames the selection or every key with 8 % padding; dopeSheet.frame acts on the focused controller', async () => {
    const m = await setUp();
    const [upper] = armKeys(m);
    setKeySelection(m.app, [upper!.keys[1]!, upper!.keys[2]!]);
    m.sheet.frame('selection');
    expect(m.sheet.view.f0).toBeCloseTo(10 - 0.8, 9);
    expect(m.sheet.view.sx).toBeCloseTo(640 / (10 * 1.16), 9);
    expect((await m.app.run('dopeSheet.frame', { what: 'all' })).status).toBe('finished');
    expect(m.sheet.view.f0).toBeCloseTo(-1.6, 9);
    expect(m.app.operators.poll('dopeSheet.frame', {}, { what: 'x' })).toMatchObject({ ok: false });
  });

  it('registers the Select / Move / Scale tools: view.tool switches them', async () => {
    const m = await setUp();
    for (const tool of ['move', 'scale', 'select']) {
      expect((await m.app.runUntyped('view.tool', { panel: 'dopeSheet', tool })).status).toBe('finished');
      expect(m.app.session.getState().tools.dopeSheet).toBe(tool);
    }
  });
});

describe('painting', () => {
  for (const dpr of [1, 2]) {
    it(`draws key, selected and breakdown glyphs and hold bars (DPR ${dpr})`, async () => {
      const m = await setUp({ dpr });
      const [upper] = armKeys(m);
      keyCurve(m.app, CONTROLS.handL, 'rz', [
        [0, 0],
        [10, 30 * DEG, true],
        [20, 30 * DEG],
      ]);
      setKeySelection(m.app, [upper!.keys[2]!]);
      m.sheet.setExpanded(CONTROLS.handL, true);
      m.sheet.redraw(true);
      const near = (actual: readonly number[], color: string): boolean =>
        actual.every((value, i) => Math.abs(value - hex(color)[i]!) <= 6);
      const key = glyph(m, CONTROLS.upperArmL, 10); // (the playhead covers frame 0)
      expect(near(pixel(m.canvas, key.x, key.y, dpr), DEFAULT_DOPE_THEME.key)).toBe(true);
      const selected = glyph(m, CONTROLS.upperArmL, 20);
      expect(near(pixel(m.canvas, selected.x, selected.y, dpr), DEFAULT_DOPE_THEME.keySelected)).toBe(true);
      // ◇: a green outline (its left vertex) around a hollow centre.
      const breakdown = glyph(m, `${CONTROLS.handL}/rz`, 10);
      const outline = [2.5, 3, 3.5, 4, 4.5].map((d) => pixel(m.canvas, breakdown.x - d, breakdown.y, dpr));
      expect(outline.some((rgba) => near(rgba, DEFAULT_DOPE_THEME.keyBreakdown))).toBe(true);
      // The hand holds 30° from 10 to 20: a bar between the glyphs.
      const bar = pixel(m.canvas, xOf(m.sheet, 15), breakdown.y, dpr);
      expect(near(bar, DEFAULT_DOPE_THEME.background)).toBe(false);
      const gap = pixel(m.canvas, xOf(m.sheet, 5), breakdown.y, dpr);
      expect(near(gap, DEFAULT_DOPE_THEME.background)).toBe(true);
    });
  }

  it('draws nothing at zero size (a hidden dock tab) and redraws after a resize', async () => {
    const m = await setUp();
    armKeys(m);
    m.sheet.resize(0, 0, 1);
    m.sheet.redraw(true);
    m.sheet.resize(640, 300, 1);
    const key = glyph(m, 'summary', 10);
    expect(pixel(m.canvas, key.x, key.y)[3]).toBe(255);
  });
});
