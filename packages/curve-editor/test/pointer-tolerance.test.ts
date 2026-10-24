// STUDIO-TOUCH-SPEC §5.4 (ST-8; T1): the curve editors' tolerances by pointer type. The Dope Sheet's controller
// switches its glyph and region tolerances and its drag slop to the pointer of each press and move; the Graph
// Editor's hit radii switch through `setGraphPointer` (a touch shell's curve adapter calls it; Studio Pro's mouse
// never does). The mouse brings back today's values.
import { afterEach, describe, expect, it } from 'vitest';
import { GRAPH_METRICS } from '../src';
import { DOPE_TOLERANCE } from '../src/dopesheet/layout';
import { CURVE_POINTER_TOLERANCE, setDopeSheetPointer, setGraphPointer } from '../src/painters/pointer';
import {
  CONTROLS,
  dopeApp,
  keyCurve,
  type MountedSheet,
  mountSheet,
  pointer as dopePointer,
} from './dopesheet/fixture';
import { type Mounted, mount, WAVE, waveApp } from './support/app';

let graph: Mounted | null = null;
let sheet: MountedSheet | null = null;
afterEach(() => {
  graph?.dispose();
  graph = null;
  sheet?.dispose();
  sheet = null;
  setGraphPointer('mouse');
  setDopeSheetPointer('mouse');
});

const hits = (): number[] => [GRAPH_METRICS.hitKey, GRAPH_METRICS.hitHandle, GRAPH_METRICS.hitCurve];

describe('curve editor tolerances by pointer type (§5.4)', () => {
  it('a finger or the pen switches them; the mouse restores today’s', () => {
    expect(hits()).toEqual([6, 5, 4]);
    expect(DOPE_TOLERANCE).toEqual({ glyphPx: 6, regionHandlePx: 6, dragPx: 3 });
    setGraphPointer('touch');
    setDopeSheetPointer('touch');
    expect(hits()).toEqual([22, 22, 22]);
    expect(DOPE_TOLERANCE).toEqual({ glyphPx: 22, regionHandlePx: 22, dragPx: 10 });
    setGraphPointer('pen');
    expect(hits()).toEqual([9, 9, 9]);
    setGraphPointer('');
    setDopeSheetPointer('mouse');
    expect(hits()).toEqual([6, 5, 4]);
    expect(DOPE_TOLERANCE).toEqual({ glyphPx: 6, regionHandlePx: 6, dragPx: 3 });
    expect(CURVE_POINTER_TOLERANCE.mouse).toMatchObject({ hitKey: 6, hitHandle: 5, hitCurve: 4 });
  });

  it('the Graph Editor: with a finger’s radii a key 15 px away is hit, with the mouse’s it is not', async () => {
    graph = mount(await waveApp());
    const { controller } = graph;
    const k15 = controller.keyPoint(WAVE.keys[1]);
    if (k15 === null) throw new Error('key 15 is not on the canvas');
    const probe = { x: k15.x, y: k15.y - 15 };
    expect(controller.hitTest(probe.x, probe.y).kind).not.toBe('key');
    setGraphPointer('touch');
    expect(controller.hitTest(probe.x, probe.y)).toEqual({ kind: 'key', key: WAVE.keys[1], curve: WAVE.curve });
  });

  it('the Dope Sheet: a pen move 8 px beside a glyph hits it, a mouse move does not', async () => {
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
    sheet.sheet.pointerMove(dopePointer(beside.x, beside.y, { buttons: 0 }));
    expect(sheet.sheet.hitTest(beside.x, beside.y).kind).toBe('none');
  });
});
