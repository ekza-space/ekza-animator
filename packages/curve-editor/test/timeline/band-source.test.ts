// The focused band-source seam of the time slider's contributions (STUDIO-TOUCH-SPEC §20.3 item 18; T7): every
// surface that edits the band (Pro's time slider, Ekza Studio's Thread) provides itself; the first registers
// `time.selectBand` and the `timeline.context.*` items unless an owner already has, `time.selectBand` redraws the
// focused source, and the last one to go removes only what the seam registered.
import { describe, expect, it } from 'vitest';
import { focusedBandSource, provideBandSource, registerTimelineContributions } from '../../src';
import { waveApp } from './fixture';

describe('provideBandSource', () => {
  it('registers the contributions once, redraws the focused source, and unregisters with the last one', async () => {
    const app = await waveApp();
    const drawn: string[] = [];
    const thread = provideBandSource(app, { redraw: () => drawn.push('thread') });
    expect(app.operators.get('time.selectBand')).toBeDefined();
    expect(app.menus.list().filter((item) => item.menu === 'timeline.context')).toHaveLength(14);
    const slider = provideBandSource(app, { redraw: () => drawn.push('slider') });
    // a second source does not register again (no "already registered")
    expect(app.menus.list()).toHaveLength(14);
    await app.run('time.selectBand', { band: { start: 1, end: 4 } });
    expect(drawn).toEqual(['slider']);
    thread.focus();
    await app.run('time.selectBand', { band: null });
    expect(drawn).toEqual(['slider', 'thread']);
    expect(focusedBandSource(app)).not.toBeNull();
    thread.dispose();
    expect(app.operators.get('time.selectBand')).toBeDefined();
    slider.dispose();
    expect(app.operators.get('time.selectBand')).toBeUndefined();
    expect(app.menus.list()).toEqual([]);
    expect(focusedBandSource(app)).toBeNull();
    app.dispose();
  });

  it('leaves an owner’s own registration alone (Pro’s time slider host registers itself)', async () => {
    const app = await waveApp();
    const own = registerTimelineContributions(app, () => null);
    const thread = provideBandSource(app, { redraw: () => undefined });
    thread.dispose();
    expect(app.operators.get('time.selectBand')).toBeDefined();
    own();
    expect(app.operators.get('time.selectBand')).toBeUndefined();
    app.dispose();
  });
});
