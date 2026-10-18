// M2A-SPEC §8 Integration (A3 × A4): the time slider skips key updates that keep their time and curve (A4's M-1 cut),
// but a breakdown tick is green (§5.9, A3), so a key whose breakdown flag changes in place (`key.convert`) must still
// rebuild the ticks and repaint.
import { afterEach, describe, expect, it } from 'vitest';
import { addCurve, type Mounted, mount, WAVE, waveApp } from './fixture';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

/** Two animation frames: whatever the slider scheduled has painted. */
const frames = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

describe('TimeSliderController: breakdown flags changed in place (A3 × A4)', () => {
  it('a key converted to a breakdown and back updates its tick; a value-only edit keeps the flag', async () => {
    mounted = mount(await waveApp());
    const { app, slider } = mounted;
    const hand = addCurve(app, WAVE.handL, 'rx', [7, 23]);
    await frames();
    const at23 = () => slider.keyTicks().find((tick) => tick.frame === 23)?.breakdown;
    expect(at23()).toBe(false);

    app.store.transact({ label: 'Convert to Breakdown' }, (tx) => tx.patch('keys', hand.keys[1]!, { breakdown: true }));
    await frames();
    expect(at23()).toBe(true);

    app.store.transact({ label: 'Value' }, (tx) => tx.patch('keys', hand.keys[1]!, { v: 3 }));
    await frames();
    expect(at23()).toBe(true);

    app.store.transact({ label: 'Convert to Key' }, (tx) => tx.patch('keys', hand.keys[1]!, { breakdown: false }));
    await frames();
    expect(at23()).toBe(false);
  });
});
