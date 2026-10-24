// STUDIO-TOUCH-SPEC §5.4 (ST-8; T1): the curve editors' tolerances follow the pointer type. A press or a move by a
// finger or the pen switches the Graph Editor's key / handle / curve hit radii, the Dope Sheet's glyph and region
// handles, the drag slop and the axis-lock travel to theirs (22 / 9 px pick, 10 / 4 px slop); the mouse brings back
// today's values, which Studio Pro's mouse input never leaves.
import { afterEach, describe, expect, it } from 'vitest';
import { GRAPH_METRICS } from '../src';
import { resolveAxisLock } from '../src/graph/gestures';
import { CURVE_POINTER_TOLERANCE, CURVE_TOLERANCE, setCurvePointer } from '../src/painters/theme';
import {
  CONTROLS,
  dopeApp,
  keyCurve,
  type MountedSheet,
  mountSheet,
  pointer as dopePointer,
} from './dopesheet/fixture';
import { type Mounted, mount, pointer, WAVE, waveApp } from './support/app';

let graph: Mounted | null = null;
let sheet: MountedSheet | null = null;
afterEach(() => {
  graph?.dispose();
  graph = null;
  sheet?.dispose();
  sheet = null;
  setCurvePointer('mouse');
});

describe('curve editor tolerances by pointer type (§5.4)', () => {
  it('a finger or the pen switches them; the mouse restores today’s', () => {
    expect(CURVE_TOLERANCE).toEqual(CURVE_POINTER_TOLERANCE.mouse);
    expect([GRAPH_METRICS.hitKey, GRAPH_METRICS.hitHandle, GRAPH_METRICS.hitCurve]).toEqual([6, 5, 4]);
    setCurvePointer('touch');
    expect(CURVE_TOLERANCE).toEqual(CURVE_POINTER_TOLERANCE.touch);
    expect([GRAPH_METRICS.hitKey, GRAPH_METRICS.hitHandle, GRAPH_METRICS.hitCurve]).toEqual([22, 22, 22]);
    expect(resolveAxisLock(null, true, 8, 0)).toBeNull(); // a finger's 10 px before Shift picks an axis
    setCurvePointer('pen');
    expect(CURVE_TOLERANCE.dragPx).toBe(4);
    expect(resolveAxisLock(null, true, 8, 0)).toBe('time');
    setCurvePointer('mouse');
    expect([GRAPH_METRICS.hitKey, GRAPH_METRICS.hitHandle, GRAPH_METRICS.hitCurve]).toEqual([6, 5, 4]);
  });

  it('the Graph Editor: a finger hovering 15 px off a key hits it, the mouse does not', async () => {
    graph = mount(await waveApp());
    const { controller } = graph;
    const k15 = controller.keyPoint(WAVE.keys[1]);
    if (k15 === null) throw new Error('key 15 is not on the canvas');
    const probe = { x: k15.x, y: k15.y - 15 };
    controller.pointerMove(pointer({ ...probe, buttons: 0 }));
    expect(controller.hitTest(probe.x, probe.y).kind).not.toBe('key');
    controller.pointerMove(pointer({ ...probe, buttons: 0, pointerType: 'touch' }));
    expect(controller.hitTest(probe.x, probe.y)).toEqual({ kind: 'key', key: WAVE.keys[1], curve: WAVE.curve });
    controller.pointerMove(pointer({ ...probe, buttons: 0 }));
    expect(controller.hitTest(probe.x, probe.y).kind).not.toBe('key');
  });

  it('the Dope Sheet: a pen press 8 px beside a glyph hits it, a mouse press does not', async () => {
    sheet = mountSheet(await dopeApp());
    keyCurve(sheet.app, CONTROLS.lowerArmL, 'rz', [[10, 0]]);
    sheet.sheet.redraw(true);
    const at = sheet.sheet.glyphPoint('summary', 10);
    if (at === null) throw new Error('no glyph');
    const beside = { x: at.x + 8, y: at.y };
    sheet.sheet.pointerMove(dopePointer(beside.x, beside.y, { buttons: 0 }));
    expect(sheet.sheet.hitTest(beside.x, beside.y).kind).toBe('none');
    sheet.sheet.pointerMove(dopePointer(beside.x, beside.y, { buttons: 0, pointerType: 'pen' }));
    expect(sheet.sheet.hitTest(beside.x, beside.y)).toEqual({ kind: 'glyph', row: 'summary', frame: 10 });
  });
});
