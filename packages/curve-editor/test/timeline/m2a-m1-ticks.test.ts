// M2A-SPEC §5.21.1 (M-1): a Graph Editor value drag of 1,000 keys must not make the time slider rebuild its tick set
// and repaint on every preview batch. Key updates that keep their time and curve leave the slider alone; a key that
// moves in time, a new key or a deleted one repaints it as before.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCurve, type Mounted, mount, WAVE, waveApp } from './fixture';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

/** Two animation frames: whatever the slider scheduled has painted. */
const frames = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Counts the slider's paints (every redraw copies its base layer onto the canvas with one drawImage). */
function countPaints(canvas: HTMLCanvasElement): { readonly count: () => number } {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2D context');
  const spy = vi.spyOn(ctx, 'drawImage');
  return { count: () => spy.mock.calls.length };
}

describe('TimeSliderController: key value edits (M-1)', () => {
  it('a committed value edit and drag previews of values do not repaint; a retime, an insert and a delete do', async () => {
    mounted = mount(await waveApp());
    const { app, canvas, slider } = mounted;
    const hand = addCurve(app, WAVE.handL, 'rx', [5, 15]);
    await frames();
    const paints = countPaints(canvas);

    app.store.transact({ label: 'Value' }, (tx) => tx.patch('keys', hand.keys[0]!, { v: 2 }));
    const preview = app.store.beginPreview('Move Keys');
    for (const v of [3, 4, 5]) preview.update((tx) => tx.patch('keys', hand.keys[1]!, { v }));
    await frames();
    expect(paints.count()).toBe(0);
    preview.commit({ label: 'Move Keys' });
    await frames();
    expect(paints.count()).toBe(0);
    expect([5, 15].map((frame) => slider.tickPoint(frame) !== null)).toEqual([true, true]);

    app.store.transact({ label: 'Retime' }, (tx) => tx.patch('keys', hand.keys[0]!, { t: 9 }));
    await frames();
    expect(paints.count()).toBe(1);
    expect([5, 9].map((frame) => slider.tickPoint(frame) !== null)).toEqual([false, true]);

    const added = addCurve(app, WAVE.handL, 'ry', [21]);
    await frames();
    expect(paints.count()).toBe(2);
    expect(slider.tickPoint(21)).not.toBeNull();

    app.store.transact({ label: 'Delete' }, (tx) => tx.remove('keys', added.keys[0]!));
    await frames();
    expect(paints.count()).toBe(3);
    expect(slider.tickPoint(21)).toBeNull();
  });
});
