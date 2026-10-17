// Band move and scale through the edit kernel (MVP-SPEC §4.11.3, §4.11.17): one history step per drag. The kernel
// helpers are WP-7a's; until they land the drags that need them are skipped (§8.1: blocked by WP-7a) and the
// stub path checks that a failed drag leaves the document untouched.
import type { FakeServices } from '@ekza-animator/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addCurve,
  editKernelReady,
  keyTimes,
  type Mounted,
  mount,
  pointer,
  selectControls,
  settle,
  WAVE,
  waveApp,
} from './fixture';

const kernel = editKernelReady();

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

async function setUp(): Promise<Mounted> {
  mounted = mount(await waveApp());
  return mounted;
}

/** Drags with the left button from frame `from` to frame `to` (through `via`). */
function drag(m: Mounted, from: number, to: number, via: readonly number[] = []): void {
  const { slider } = m;
  slider.pointerDown(pointer(slider.frameToX(from)));
  for (const frame of via) slider.pointerMove(pointer(slider.frameToX(frame)));
  slider.pointerMove(pointer(slider.frameToX(to)));
  slider.pointerUp(pointer(slider.frameToX(to), { buttons: 0 }));
}

describe('band drags through the edit kernel', () => {
  it.skipIf(!kernel)(
    'dragging the band middle retimes the band keys of every target control as one undo step (E2E-23)',
    async () => {
      const m = await setUp();
      const { app, slider } = m;
      const curves = [
        addCurve(app, WAVE.upperArmL, 'rz', [0, 10, 20]),
        addCurve(app, WAVE.lowerArmL, 'rx', [0, 10, 20]),
        addCurve(app, WAVE.handL, 'ry', [0, 10, 20]),
      ];
      const other = addCurve(app, WAVE.hips, 'ry', [0, 10, 20]);
      selectControls(app, [WAVE.upperArmL, WAVE.lowerArmL, WAVE.handL]);
      const before = app.store.snapshot();

      slider.pointerDown(pointer(slider.tickPoint(10)!.x, { shift: true }));
      slider.pointerUp(pointer(slider.tickPoint(10)!.x, { shift: true, buttons: 0 }));
      await settle();
      expect(app.session.getState().selection.keys.size).toBe(3);

      drag(m, 10, 14, [11, 12.6]);
      await settle();
      for (const { curve } of curves) expect(keyTimes(app, curve)).toEqual([0, 14, 20]);
      expect(keyTimes(app, other.curve)).toEqual([0, 10, 20]);
      expect(keyTimes(app, WAVE.curve)).toEqual([0, 15, 30]);
      expect(app.session.getState().time.band).toEqual({ start: 14, end: 14 });
      expect(app.session.getState().selection.keys.size).toBe(3);
      expect(app.store.preview).toBeNull();

      expect(app.history.peekUndo()?.label).toBe('Move Keys');
      app.history.undo();
      expect(app.history.canUndo()).toBe(false);
      expect(app.store.snapshot()).toEqual(before);
      app.history.redo();
      for (const { curve } of curves) expect(keyTimes(app, curve)).toEqual([0, 14, 20]);
    },
  );

  it.skipIf(!kernel)('dragging a band end scales the band keys around the opposite end', async () => {
    const m = await setUp();
    const { app, slider } = m;
    const hand = addCurve(app, WAVE.handL, 'ry', [0, 10, 20]);
    selectControls(app, [WAVE.handL]);
    await app.run('time.selectBand', { band: { start: 0, end: 20 } });
    const edge = slider.frameToX(20.5);
    expect(slider.hitTest(edge, 20).kind).toBe('band-end');

    slider.pointerDown(pointer(edge));
    slider.pointerMove(pointer(slider.frameToX(25.5)));
    slider.pointerMove(pointer(slider.frameToX(30.5)));
    slider.pointerUp(pointer(slider.frameToX(30.5), { buttons: 0 }));
    await settle();
    expect(keyTimes(app, hand.curve)).toEqual([0, 15, 30]);
    expect(app.session.getState().time.band).toEqual({ start: 0, end: 30 });
    expect(app.history.peekUndo()?.label).toBe('Scale Keys');
    app.history.undo();
    expect(keyTimes(app, hand.curve)).toEqual([0, 10, 20]);
    expect(app.history.canUndo()).toBe(false);

    // The start end scales around the band's last frame.
    await app.run('time.selectBand', { band: { start: 0, end: 20 } });
    slider.pointerDown(pointer(slider.frameToX(-0.5)));
    slider.pointerMove(pointer(slider.frameToX(9.5)));
    slider.pointerUp(pointer(slider.frameToX(9.5), { buttons: 0 }));
    await settle();
    expect(keyTimes(app, hand.curve)).toEqual([10, 15, 20]);
  });

  it.skipIf(!kernel)('a moved key that lands on a key outside the band replaces it', async () => {
    const m = await setUp();
    const { app } = m;
    const hand = addCurve(app, WAVE.handL, 'ry', [10, 14]);
    selectControls(app, [WAVE.handL]);
    await app.run('time.selectBand', { band: { start: 10, end: 10 } });
    drag(m, 10, 14, [12]);
    await settle();
    expect(keyTimes(app, hand.curve)).toEqual([14]);
    expect(app.store.query.keysOfCurve(hand.curve)[0]?.id).toBe(hand.keys[0]);
    app.history.undo();
    expect(keyTimes(app, hand.curve)).toEqual([10, 14]);
  });

  it.skipIf(!kernel)('a preview cancelled from outside (Esc) ends the drag without an undo step', async () => {
    const m = await setUp();
    const { app, slider } = m;
    const hand = addCurve(app, WAVE.handL, 'ry', [10]);
    selectControls(app, [WAVE.handL]);
    await app.run('time.selectBand', { band: { start: 10, end: 10 } });
    slider.pointerDown(pointer(slider.frameToX(10)));
    slider.pointerMove(pointer(slider.frameToX(12)));
    expect(keyTimes(app, hand.curve)).toEqual([12]);
    app.store.preview?.cancel();
    slider.pointerMove(pointer(slider.frameToX(16)));
    slider.pointerUp(pointer(slider.frameToX(16), { buttons: 0 }));
    await settle();
    expect(keyTimes(app, hand.curve)).toEqual([10]);
    expect(app.history.canUndo()).toBe(false);
    expect(app.session.getState().time.band).toEqual({ start: 10, end: 10 });
    expect(slider.dragging).toBe(false);
  });

  it.skipIf(!kernel)('controller.cancel() drops a key drag in progress', async () => {
    const m = await setUp();
    const { app, slider } = m;
    const hand = addCurve(app, WAVE.handL, 'ry', [0, 10, 20]);
    selectControls(app, [WAVE.handL]);
    await app.run('time.selectBand', { band: { start: 0, end: 20 } });
    slider.pointerDown(pointer(slider.frameToX(20.5)));
    slider.pointerMove(pointer(slider.frameToX(40.5)));
    expect(keyTimes(app, hand.curve)).toEqual([0, 20, 40]);
    slider.cancel();
    expect(keyTimes(app, hand.curve)).toEqual([0, 10, 20]);
    expect(app.store.preview).toBeNull();
    expect(app.history.canUndo()).toBe(false);
  });

  it.skipIf(kernel)('without the edit kernel (WP-7a stub) a key drag drops its preview and reports why', async () => {
    const m = await setUp();
    const { app } = m;
    const hand = addCurve(app, WAVE.handL, 'ry', [10]);
    await app.run('time.selectBand', { band: { start: 10, end: 10 } });
    drag(m, 10, 14);
    await settle();
    expect(keyTimes(app, hand.curve)).toEqual([10]);
    expect(app.store.preview).toBeNull();
    expect(app.history.canUndo()).toBe(false);
    expect(app.session.getState().time.band).toEqual({ start: 10, end: 10 });
    expect((app.services as FakeServices).toasts).toEqual([
      { kind: 'error', text: expect.stringMatching(/^Move Keys failed: editor-core\./) as unknown as string },
    ]);
    expect(m.slider.dragging).toBe(false);
  });

  it('a band without keys moves without touching the document', async () => {
    const m = await setUp();
    const { app } = m;
    selectControls(app, [WAVE.handL]);
    await app.run('time.selectBand', { band: { start: 3, end: 6 } });
    const version = app.store.version;
    drag(m, 4, 9);
    await settle();
    expect(app.session.getState().time.band).toEqual({ start: 8, end: 11 });
    expect(app.store.version).toBe(version);
    expect(app.history.canUndo()).toBe(false);
  });

  it('a press on the band middle without moving keeps keys, band and frame', async () => {
    const m = await setUp();
    const { app } = m;
    await app.run('time.selectBand', { band: { start: 15, end: 15 } });
    drag(m, 15, 15.2);
    await settle();
    expect(app.session.getState().time.band).toEqual({ start: 15, end: 15 });
    expect(keyTimes(app, WAVE.curve)).toEqual([0, 15, 30]);
    expect(app.calls.map((call) => call.id)).toEqual(['time.selectBand']);
  });
});
