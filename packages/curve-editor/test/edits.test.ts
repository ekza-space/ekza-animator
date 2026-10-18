// Key moves and handle drags through document previews and the WP-7a edit kernel (MVP-SPEC §4.11.3, §4.11.4,
// E2E-09/10/13). These run once the kernel lands: until then `moveKeys`/`setKeyHandle` are stubs (MVP-SPEC §8.1).
import { RAD2DEG } from '@ekza-animator/anim-core';
import type { KeyRecord } from '@ekza-animator/doc';
import type { ToolPointerEvent } from '@ekza-animator/editor-core';
import { type FakeEditorApp, type FakeServices, naiveCurveEngine } from '@ekza-animator/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGraphContributions } from '../src';
import {
  callsOf,
  KERNEL_READY,
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

const keysOf = (app: FakeEditorApp): readonly KeyRecord[] => app.store.query.keysOfCurve(WAVE.curve);
const keyRecord = (app: FakeEditorApp, index: 0 | 1 | 2): KeyRecord => {
  const record = app.store.get('keys', WAVE.keys[index]);
  if (record === undefined) throw new Error(`key ${index} is gone`);
  return record;
};
const valueAt = (app: FakeEditorApp, frame: number): number =>
  naiveCurveEngine.evaluate(app.evaluation.compiledCurve(WAVE.curve), frame);

/** Moves the pointer in a few steps and releases, like a real drag. */
function dragBy(
  m: Mounted,
  from: { readonly x: number; readonly y: number },
  dx: number,
  dy: number,
  extra?: Partial<ToolPointerEvent>,
): void {
  m.controller.pointerDown(pointer({ ...extra, ...from }));
  for (const t of [0.25, 0.5, 0.75, 1])
    m.controller.pointerMove(pointer({ ...extra, x: from.x + dx * t, y: from.y + dy * t }));
  m.controller.pointerUp(pointer({ ...extra, x: from.x + dx, y: from.y + dy, buttons: 0 }));
}

describe.skipIf(!KERNEL_READY)('[needs WP-7a] key moves (MVP-SPEC §4.11.3)', () => {
  it('MMB drag anywhere moves the selected keys: frames snap, values follow, one history step', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    const before = app.store.snapshot();
    const { sx, sy } = controller.view;
    dragBy(mounted, { x: 20, y: 20 }, 3.2 * sx, -10 * sy, { button: 1 });
    await settle();
    const moved = keyRecord(app, 1);
    expect(moved.t).toBe(18);
    expect(moved.v * RAD2DEG).toBeCloseTo(-20, 9);
    expect(keyRecord(app, 0).t).toBe(0);
    expect(keyRecord(app, 2).t).toBe(30);
    expect(app.history.peekUndo()?.label).toBe('Move Keys');
    expect(app.history.peekUndo()?.docTxId).toBe(app.store.undo.peekUndo()?.txId);
    expect(app.store.preview).toBeNull();
    app.history.undo();
    expect(app.store.snapshot()).toEqual(before);
  });

  it('LMB drag on an unselected key selects and moves it; Alt turns snapping off; Shift locks the axis', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const { sx, sy } = controller.view;
    dragBy(mounted, at(controller.keyPoint(WAVE.keys[0])), 2.4 * sx, 0);
    await settle();
    expect(keyRecord(app, 0).t).toBe(2);

    dragBy(mounted, at(controller.keyPoint(WAVE.keys[0])), 1.5 * sx, 0, { alt: true });
    await settle();
    expect(keyRecord(app, 0).t).toBeCloseTo(3.5, 9);

    const v = keyRecord(app, 2).v;
    dragBy(mounted, at(controller.keyPoint(WAVE.keys[2])), -4 * sx, 1.5 * sy, { shift: true });
    await settle();
    expect(keyRecord(app, 2).t).toBe(26);
    expect(keyRecord(app, 2).v).toBe(v);
  });

  // Acceptance round 1: Shift+press on a selected key toggled it off before the drag could start.
  it('Shift+LMB drag on a selected key moves it on the dominant axis; Shift+click toggles it off', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const dispose = registerGraphContributions(app, () => controller);
    try {
      selectKeys(app, [[WAVE.keys[1], { key: true }]]);
      const { sx, sy } = controller.view;
      const v = keyRecord(app, 1).v;
      dragBy(mounted, at(controller.keyPoint(WAVE.keys[1])), 3 * sx, 1.2 * sy, { shift: true });
      await settle();
      expect(keyRecord(app, 1).t).toBe(18);
      expect(keyRecord(app, 1).v).toBe(v);
      expect([...app.session.getState().selection.keys.keys()]).toEqual([WAVE.keys[1]]);
      expect(app.history.peekUndo()?.label).toBe('Move Keys');

      // The press leaves the selection alone (no select.keys run); the release toggles the key off.
      expect(callsOf(app, 'select.keys')).toEqual([]);
      const k = at(controller.keyPoint(WAVE.keys[1]));
      controller.pointerDown(pointer({ ...k, shift: true }));
      await settle();
      expect(callsOf(app, 'select.keys')).toEqual([]);
      controller.pointerUp(pointer({ ...k, shift: true, buttons: 0 }));
      await settle();
      expect(callsOf(app, 'select.keys')).toEqual([
        { items: [{ key: WAVE.keys[1], parts: { key: true, in: false, out: false } }], mode: 'toggle' },
      ]);
    } finally {
      dispose();
    }
  });

  // Acceptance round 3: a click on a key and a press-drag on it within the double-click time selected the whole
  // curve on press and the drag did nothing.
  it('a click and a quick press-drag on a key moves the key; the double-click release still selects the curve', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const dispose = registerGraphContributions(app, () => controller);
    try {
      const { sx } = controller.view;
      const k15 = at(controller.keyPoint(WAVE.keys[1]));
      // The first click selected the key (the fake app records select.keys without running it).
      controller.pointerDown(pointer({ ...k15, detail: 1 }));
      controller.pointerUp(pointer({ ...k15, detail: 1, buttons: 0 }));
      await settle();
      expect(callsOf(app, 'select.keys')).toEqual([
        { items: [{ key: WAVE.keys[1], parts: { key: true, in: false, out: false } }], mode: 'replace' },
      ]);
      selectKeys(app, [[WAVE.keys[1], { key: true }]]);
      dragBy(mounted, k15, 3 * sx, 0, { detail: 2 });
      await settle();
      expect(keysOf(app).map((record) => record.t)).toEqual([0, 18, 30]);
      expect([...app.session.getState().selection.keys.keys()]).toEqual([WAVE.keys[1]]);
      expect(app.history.peekUndo()?.label).toBe('Move Keys');
      expect(callsOf(app, 'select.curveKeys')).toEqual([]);

      // Without a drag the second press is a double-click: the release selects the whole curve.
      const k18 = at(controller.keyPoint(WAVE.keys[1]));
      controller.pointerDown(pointer({ ...k18, detail: 2 }));
      await settle();
      expect(app.session.getState().selection.keys.size).toBe(1);
      controller.pointerUp(pointer({ ...k18, detail: 2, buttons: 0 }));
      await settle();
      expect(callsOf(app, 'select.curveKeys')).toEqual([{ curve: WAVE.curve, mode: 'replace' }]);
      expect([...app.session.getState().selection.keys.keys()]).toEqual([...WAVE.keys]);
    } finally {
      dispose();
    }
  });

  it('a double-click press-drag on a curve segment selects the curve and moves all its keys', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const dispose = registerGraphContributions(app, () => controller);
    try {
      const { sx } = controller.view;
      const mid = at(controller.curvePoint(WAVE.curve, 7.5));
      controller.pointerDown(pointer({ ...mid, detail: 1 }));
      controller.pointerUp(pointer({ ...mid, detail: 1, buttons: 0 }));
      dragBy(mounted, mid, 2 * sx, 0, { detail: 2 });
      await settle();
      expect(keysOf(app).map((record) => record.t)).toEqual([2, 17, 32]);
      expect([...app.session.getState().selection.keys.keys()]).toEqual([...WAVE.keys]);
      expect(app.history.peekUndo()?.label).toBe('Move Keys');
    } finally {
      dispose();
    }
  });

  it('commits a landing on a non-moved key by deleting that key (resolveCollisions)', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [[WAVE.keys[0], { key: true }]]);
    dragBy(mounted, at(controller.keyPoint(WAVE.keys[0])), 15 * controller.view.sx, 0);
    await settle();
    expect(keysOf(app).map((k) => [k.id, k.t])).toEqual([
      [WAVE.keys[0], 15],
      [WAVE.keys[2], 30],
    ]);
    expect(app.session.getState().selection.keys.has(WAVE.keys[1])).toBe(false);
    expect(app.history.peekUndo()?.label).toBe('Move Keys');
  });

  it('Esc during a drag rolls the preview back without a history step', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const before = app.store.snapshot();
    const k = at(controller.keyPoint(WAVE.keys[1]));
    controller.pointerDown(pointer(k));
    await settle();
    controller.pointerMove(pointer({ x: k.x + 40, y: k.y - 30 }));
    expect(app.store.preview?.active).toBe(true);
    expect(keyRecord(app, 1).t).not.toBe(15);
    expect(controller.key(keyEvent({ code: 'Escape' }))).toBe(true);
    controller.pointerUp(pointer({ x: k.x + 40, y: k.y - 30, buttons: 0 }));
    expect(app.store.preview).toBeNull();
    expect(app.store.snapshot()).toEqual(before);
    expect(app.history.canUndo()).toBe(false);
  });
});

describe.skipIf(!KERNEL_READY)('[needs WP-7a] handle drags (MVP-SPEC §4.11.4, E2E-09/10/13)', () => {
  it('a unified handle drag rotates both sides (collinear), keeps the non-weighted length, "Edit Tangent"', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    dragBy(mounted, at(controller.handlePoint(WAVE.keys[1], 'out')), 0, -30);
    await settle();
    const k = keyRecord(app, 1);
    expect(k.outType).toBe('fixed');
    expect(k.inType).toBe('fixed');
    expect(k.broken).toBe(false);
    expect(k.outHandle.dv / k.outHandle.dt).toBeGreaterThan(0);
    expect(k.inHandle.dv / k.inHandle.dt).toBeCloseTo(k.outHandle.dv / k.outHandle.dt, 9);
    expect(app.history.peekUndo()?.label).toBe('Edit Tangent');
  });

  it('E2E-09/13: a broken key changes only the dragged side; one undo restores the curve', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    app.store.transact({ label: 'Break' }, (tx) => tx.put('keys', { ...keyRecord(app, 1), broken: true }));
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    const before = app.store.snapshot();
    const early = [2, 5, 7.5, 12].map((f) => valueAt(app, f));
    const late = [18, 22.5, 27].map((f) => valueAt(app, f));
    dragBy(mounted, at(controller.handlePoint(WAVE.keys[1], 'out')), 0, -40);
    await settle();
    const k = keyRecord(app, 1);
    expect(k.outType).toBe('fixed');
    expect(k.inType).toBe('auto');
    expect(k.broken).toBe(true);
    [2, 5, 7.5, 12].forEach((f, i) => expect(valueAt(app, f)).toBeCloseTo(early[i] as number, 9));
    expect([18, 22.5, 27].some((f, i) => Math.abs(valueAt(app, f) - (late[i] as number)) > 1e-6)).toBe(true);
    expect(app.history.peekUndo()?.label).toBe('Edit Tangent');
    app.history.undo();
    expect(app.store.snapshot()).toEqual(before);
  });

  it('Alt while dragging breaks the tangent: the commit writes broken: true and keeps the other side', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [[WAVE.keys[1], { key: true }]]);
    dragBy(mounted, at(controller.handlePoint(WAVE.keys[1], 'out')), 0, -30, { alt: true });
    await settle();
    const k = keyRecord(app, 1);
    expect(k.broken).toBe(true);
    expect(k.inType).toBe('auto');
  });

  it('Shift locks a handle drag to the dominant axis', async () => {
    const app = await waveApp();
    app.store.transact({ label: 'Weighted' }, (tx) => {
      tx.patch('curves', WAVE.curve, { weighted: true });
      tx.put('keys', { ...keyRecord(app, 0), weightLocked: false });
    });
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [[WAVE.keys[0], { key: true }]]);
    const end = at(controller.handlePoint(WAVE.keys[0], 'out'));
    // Mostly right with a little vertical wobble: the end moves right only, so the free handle grows but keeps dv.
    const resolved = app.evaluation.compiledCurve(WAVE.curve);
    const dv = resolved.outDv[0] as number;
    dragBy(mounted, end, 40, -6, { shift: true });
    await settle();
    const handle = keyRecord(app, 0).outHandle;
    expect(handle.dt).toBeCloseTo((resolved.outDt[0] as number) + 40 / controller.view.sx, 9);
    expect(handle.dv).toBeCloseTo(dv, 9);
  });

  it('E2E-10: free weighted handles change length; locked weights keep the Maya weight', async () => {
    const app = await waveApp();
    app.store.transact({ label: 'Weighted' }, (tx) => {
      tx.patch('curves', WAVE.curve, { weighted: true });
      tx.put('keys', { ...keyRecord(app, 0), weightLocked: false });
    });
    mounted = mount(app);
    const { controller } = mounted;
    selectKeys(app, [[WAVE.keys[0], { key: true }]]);
    const value = keyRecord(app, 0).v;
    dragBy(mounted, at(controller.handlePoint(WAVE.keys[0], 'out')), 60, 0);
    await settle();
    const free = keyRecord(app, 0);
    expect(free.t).toBe(0);
    expect(free.v).toBe(value);
    expect(free.outType).toBe('fixed');
    expect(free.outHandle.dt).toBeGreaterThan(5);

    app.store.transact({ label: 'Lock' }, (tx) => tx.put('keys', { ...keyRecord(app, 0), weightLocked: true }));
    const weight = (h: { readonly dt: number; readonly dv: number }) =>
      3 * Math.hypot(Math.abs(h.dt) / 30, h.dv * RAD2DEG);
    // A locked weight keeps the length of the resolved handle (with the AnimX engine, the stored fixed handle; the
    // test kit's naive engine ignores weights and resolves span/3) while the angle follows the pointer.
    const compiled = app.evaluation.compiledCurve(WAVE.curve);
    const resolved = { dt: compiled.outDt[0] as number, dv: compiled.outDv[0] as number };
    dragBy(mounted, at(controller.handlePoint(WAVE.keys[0], 'out')), 0, -50);
    await settle();
    const locked = keyRecord(app, 0).outHandle;
    expect(weight(locked)).toBeCloseTo(weight(resolved), 6);
    expect(locked.dv / locked.dt).toBeGreaterThan(resolved.dv / resolved.dt);
  });
});

describe('edit plumbing without the kernel', () => {
  it.skipIf(KERNEL_READY)('reports a failed edit and leaves the document untouched (stubbed kernel)', async () => {
    const app = await waveApp();
    mounted = mount(app);
    const { controller } = mounted;
    const before = app.store.snapshot();
    const k = at(controller.keyPoint(WAVE.keys[1]));
    controller.pointerDown(pointer(k));
    await settle();
    controller.pointerMove(pointer({ x: k.x + 40, y: k.y }));
    controller.pointerUp(pointer({ x: k.x + 40, y: k.y, buttons: 0 }));
    expect(app.store.preview).toBeNull();
    expect(app.store.snapshot()).toEqual(before);
    const { toasts } = app.services as FakeServices;
    expect(toasts.at(-1)?.kind).toBe('error');
    expect(toasts.at(-1)?.text).toContain('Move Keys');
    expect(controller.busy).toBe(false);
  });
});
