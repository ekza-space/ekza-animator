import { afterEach, describe, expect, it } from 'vitest';
import { GRAPH_METRICS, type GraphHit } from '../src';
import { frameToX, valueToY, xToFrame, yToValue } from '../src/view/transform';
import { addCurve, callsOf, drag, key, type Mounted, mount, selectKeys, settle, WAVE, waveApp } from './support/app';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

function ofKind<K extends GraphHit['kind']>(hit: GraphHit, kind: K): Extract<GraphHit, { readonly kind: K }> {
  expect(hit.kind).toBe(kind);
  return hit as Extract<GraphHit, { readonly kind: K }>;
}

const at = (point: { readonly x: number; readonly y: number } | null): { x: number; y: number } => {
  if (point === null) throw new Error('point is not on the canvas');
  return { x: point.x, y: point.y };
};

describe('GraphEditorController.hitTest (MVP-SPEC §4.11.18)', () => {
  it('hits keys within 6 px, the curve within 4 px and reports empty space with its frame and value', async () => {
    mounted = mount(await waveApp());
    const { controller } = mounted;
    const k15 = at(controller.keyPoint(WAVE.keys[1]));
    expect(controller.hitTest(k15.x, k15.y)).toEqual({ kind: 'key', key: WAVE.keys[1], curve: WAVE.curve });
    // Key 15 is a flat extreme: straight above it, only the key tolerance applies.
    expect(controller.hitTest(k15.x, k15.y - (GRAPH_METRICS.hitKey - 0.2)).kind).toBe('key');
    const above = ofKind(controller.hitTest(k15.x, k15.y - (GRAPH_METRICS.hitKey + 0.5)), 'none');
    expect(above.frame).toBeCloseTo(xToFrame(controller.view, k15.x), 9);
    expect(above.value).toBeCloseTo(yToValue(controller.view, 300, k15.y - (GRAPH_METRICS.hitKey + 0.5)), 9);
    // Beside the key (beyond 6 px) but 3 px off the flat curve: a curve hit at the pointer's frame.
    const beside = ofKind(controller.hitTest(k15.x + 8, k15.y - 3), 'curve');
    expect(beside.curve).toBe(WAVE.curve);
    expect(beside.frame).toBeCloseTo(xToFrame(controller.view, k15.x + 8), 9);
    expect(beside.value).toBeCloseTo(-30, 0); // degrees, at the −30° extreme
    const mid = at(controller.curvePoint(WAVE.curve, 7.5));
    expect(controller.hitTest(mid.x, mid.y + GRAPH_METRICS.hitCurve - 1).kind).toBe('curve');
    // Frame 2 at −25° is far below the curve (≈ +29° there).
    const empty = { x: frameToX(controller.view, 2), y: valueToY(controller.view, 300, -25) };
    expect(controller.hitTest(empty.x, empty.y).kind).toBe('none');
  });

  it('hits shown handles (5 px) only for keys with a selected part, after keys', async () => {
    mounted = mount(await waveApp());
    const { app, controller } = mounted;
    expect(controller.handlePoint(WAVE.keys[1], 'out')).toBeNull();
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    const k15 = at(controller.keyPoint(WAVE.keys[1]));
    const out = at(controller.handlePoint(WAVE.keys[1], 'out'));
    const inn = at(controller.handlePoint(WAVE.keys[1], 'in'));
    // Non-weighted handles are drawn 40 px from the key along the (flat) tangent.
    expect(out.x - k15.x).toBeCloseTo(GRAPH_METRICS.handleLength, 9);
    expect(out.y).toBeCloseTo(k15.y, 9);
    expect(k15.x - inn.x).toBeCloseTo(GRAPH_METRICS.handleLength, 9);
    expect(controller.hitTest(out.x, out.y - 4.5)).toEqual({
      kind: 'handle',
      key: WAVE.keys[1],
      curve: WAVE.curve,
      side: 'out',
    });
    expect(controller.hitTest(inn.x, inn.y)).toMatchObject({ kind: 'handle', side: 'in' });
  });

  it('ranks a selected handle above a key, and a key above an unselected handle', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    const out = at(controller.handlePoint(WAVE.keys[1], 'out'));
    // A key of another curve exactly under the out handle of key 15.
    const frame = xToFrame(controller.view, out.x);
    const degrees = yToValue(controller.view, 300, out.y);
    const other = addCurve(app, { channel: 'rx', keys: [key(frame, (degrees * Math.PI) / 180)] });
    controller.setCurves([WAVE.curve, other.curve]);
    expect(at(controller.keyPoint(other.keys[0]!)).x).toBeCloseTo(out.x, 6);
    expect(controller.hitTest(out.x, out.y)).toMatchObject({ kind: 'key', key: other.keys[0] });
    selectKeys(app, [[WAVE.keys[1], { key: true, out: true }]]);
    expect(controller.hitTest(out.x, out.y)).toMatchObject({ kind: 'handle', key: WAVE.keys[1], side: 'out' });
  });

  it('E2E-08: where curves cross, the one drawn on top is hit (last listed, focused curves above the rest)', async () => {
    const app = await waveApp();
    // rx and ry flat at 0° with keys at 0/15/30, like `key.set` on the wave control: at frame 7.5 the rz wave
    // crosses both at 0°.
    const rx = addCurve(app, { channel: 'rx', keys: [key(0, 0), key(15, 0), key(30, 0)] });
    const ry = addCurve(app, { channel: 'ry', keys: [key(0, 0), key(15, 0), key(30, 0)] });
    mounted = mount(app, { curves: [rx.curve, ry.curve, WAVE.curve] });
    const { controller } = mounted;
    const crossing = at(controller.curvePoint(WAVE.curve, 7.5));
    expect(at(controller.curvePoint(rx.curve, 7.5)).y).toBeCloseTo(crossing.y, 6);
    for (const dy of [-0.2, 0, 0.2]) {
      expect(controller.hitTest(crossing.x, crossing.y + dy)).toMatchObject({ kind: 'curve', curve: WAVE.curve });
    }
    // A selected key of rx focuses rx: it is drawn above rz, so the crossing hits rx.
    selectKeys(app, [[rx.keys[0]!, { key: true }]]);
    expect(controller.hitTest(crossing.x, crossing.y)).toMatchObject({ kind: 'curve', curve: rx.curve });
    // A clearly nearer curve still wins over the topmost one.
    expect(controller.hitTest(crossing.x, crossing.y - 3)).toMatchObject({ kind: 'curve', curve: WAVE.curve });
  });

  it('where keys overlap, a selected key is hit before the others, else the one of the last curve', async () => {
    const app = await waveApp();
    const rx = addCurve(app, { channel: 'rx', keys: [key(0, 0), key(15, 0)] });
    const ry = addCurve(app, { channel: 'ry', keys: [key(0, 0), key(15, 0)] });
    mounted = mount(app, { curves: [rx.curve, ry.curve] });
    const { controller } = mounted;
    const k = at(controller.keyPoint(rx.keys[1]!));
    expect(controller.hitTest(k.x, k.y)).toMatchObject({ kind: 'key', key: ry.keys[1] });
    selectKeys(app, [[rx.keys[1]!, { key: true }]]);
    expect(controller.hitTest(k.x + 1, k.y)).toMatchObject({ kind: 'key', key: rx.keys[1] });
  });

  it('never hits keys, handles or segments of locked curves', async () => {
    const app = await waveApp();
    const locked = addCurve(app, { channel: 'ry', keys: [key(5, 0.2), key(25, 0.9)], locked: true });
    mounted = mount(app, { curves: [locked.curve] });
    const { controller } = mounted;
    const k = at(controller.keyPoint(locked.keys[0]!));
    expect(controller.hitTest(k.x, k.y).kind).toBe('none');
    const mid = at(controller.curvePoint(locked.curve, 15));
    expect(controller.hitTest(mid.x, mid.y).kind).toBe('none');
    selectKeys(app, [[locked.keys[0]!, { key: true }]]);
    expect(controller.handlePoint(locked.keys[0]!, 'out')).toBeNull();
  });

  it('returns null points for keys and curves that are not shown or off the canvas', async () => {
    mounted = mount(await waveApp());
    const { controller } = mounted;
    controller.setView({ f0: 100, v0: 0, sx: 10, sy: 1 });
    expect(controller.keyPoint(WAVE.keys[0])).toBeNull();
    expect(controller.curvePoint(WAVE.curve, 7.5)).toBeNull();
    controller.setCurves([]);
    controller.frame('all');
    expect(controller.keyPoint(WAVE.keys[0])).toBeNull();
  });
});

describe('marquee range queries', () => {
  it('selects the keys inside the rectangle with the press modifiers', async () => {
    mounted = mount(await waveApp());
    const { app, controller } = mounted;
    const k0 = at(controller.keyPoint(WAVE.keys[0]));
    const k15 = at(controller.keyPoint(WAVE.keys[1]));
    const k30 = at(controller.keyPoint(WAVE.keys[2]));
    // A box around keys 0 and 15 starting in empty space above-left of key 0.
    drag(controller, { x: k0.x - 10, y: Math.min(k0.y, k15.y) - 10 }, { x: k15.x + 10, y: Math.max(k0.y, k15.y) + 10 });
    await settle();
    expect(callsOf(app, 'select.keys')).toEqual([
      {
        items: [
          { key: WAVE.keys[0], parts: { key: true, in: false, out: false } },
          { key: WAVE.keys[1], parts: { key: true, in: false, out: false } },
        ],
        mode: 'replace',
      },
    ]);
    // Shift toggles, Mod removes, Mod+Shift adds.
    drag(controller, { x: k30.x + 10, y: k30.y - 10 }, { x: k30.x - 10, y: k30.y + 10 }, { shift: true });
    drag(controller, { x: k30.x + 10, y: k30.y - 10 }, { x: k30.x - 10, y: k30.y + 10 }, { mod: true });
    drag(controller, { x: k30.x + 10, y: k30.y - 10 }, { x: k30.x - 10, y: k30.y + 10 }, { mod: true, shift: true });
    await settle();
    expect(
      callsOf(app, 'select.keys')
        .slice(1)
        .map((args) => (args as { mode: string }).mode),
    ).toEqual(['toggle', 'remove', 'add']);
  });

  it('selects the shown handles when the rectangle holds no key', async () => {
    mounted = mount(await waveApp());
    const { app, controller } = mounted;
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    const out = at(controller.handlePoint(WAVE.keys[1], 'out'));
    drag(controller, { x: out.x - 6, y: out.y - 12 }, { x: out.x + 6, y: out.y + 12 });
    await settle();
    expect(callsOf(app, 'select.keys').at(-1)).toEqual({
      items: [{ key: WAVE.keys[1], parts: { key: false, in: false, out: true } }],
      mode: 'replace',
    });
  });

  it('a click on empty space clears the key selection; with modifiers it keeps it', async () => {
    mounted = mount(await waveApp());
    const { app, controller } = mounted;
    controller.pointerDown({ ...pointerAt(5, 5) });
    controller.pointerUp({ ...pointerAt(5, 5), buttons: 0 });
    controller.pointerDown({ ...pointerAt(5, 5), shift: true });
    controller.pointerUp({ ...pointerAt(5, 5), shift: true, buttons: 0 });
    await settle();
    expect(callsOf(app, 'select.keys')).toEqual([{ items: [], mode: 'replace' }]);
  });
});

function pointerAt(x: number, y: number) {
  return {
    panel: 'graph',
    paneId: null,
    x,
    y,
    button: 0,
    buttons: 1,
    shift: false,
    alt: false,
    mod: false,
    ctrl: false,
    pointerType: 'mouse' as const,
    timeStamp: 0,
    detail: 1,
  };
}
