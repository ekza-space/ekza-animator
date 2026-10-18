// M2A-SPEC §5.18 (A2, FR-CB-05): the virtual slider kernel — rates per channel kind, Shift/Mod factors read at each
// move (integrated increments), relative values per control, attribute ranges, one history step, cancel.
import { describe, expect, it } from 'vitest';
import {
  beginVirtualSlider,
  defaultPrefs,
  virtualSliderFactor,
  virtualSliderLabel,
  virtualSliderRate,
} from '../../src';
import { cid, ikApp } from '../builtin/ikFixture';
import { DEG, opsApp, runOk, WAVE } from '../builtin/support';

describe('virtual slider rates (§5.18)', () => {
  it('per pixel: rotations and angle attributes 0.5°, translations 0.01 m, scale 0.01, ranged attributes (max−min)/200', () => {
    const { app } = ikApp();
    const prefs = defaultPrefs('other');
    const ik = app.store.get('controls', cid('ik.leg.L')) ?? null;
    expect(virtualSliderRate(prefs, ik, 'rz')).toBeCloseTo(0.5 * DEG, 15);
    expect(virtualSliderRate(prefs, ik, '@roll')).toBeCloseTo(0.5 * DEG, 15);
    expect(virtualSliderRate(prefs, ik, 'tx')).toBe(0.01);
    expect(virtualSliderRate(prefs, ik, 'sy')).toBe(0.01);
    expect(virtualSliderRate(prefs, ik, '@ikFk')).toBe(1 / 200);
    expect(virtualSliderRate(prefs, ik, '@soft')).toBe(0.25 / 200);
    expect(virtualSliderRate(prefs, null, '@unknown')).toBe(0.01);
    expect(virtualSliderFactor({ shift: true, mod: false })).toBe(0.1);
    expect(virtualSliderFactor({ shift: false, mod: true })).toBe(10);
    expect(virtualSliderFactor({ shift: true, mod: true })).toBeCloseTo(1, 15);
  });

  it('labels name the channel', () => {
    const { app } = ikApp();
    expect(virtualSliderLabel(app, [{ control: WAVE.lowerArmL, channel: 'rz' }])).toBe('Drag Rotate Z');
    expect(virtualSliderLabel(app, [{ control: cid('ik.leg.L'), channel: '@heelTwist' }])).toBe('Drag Heel Twist');
    expect(
      virtualSliderLabel(app, [
        { control: WAVE.lowerArmL, channel: 'rx' },
        { control: WAVE.lowerArmL, channel: 'rz' },
      ]),
    ).toBe('Drag 2 Channels');
  });
});

describe('beginVirtualSlider (§5.18)', () => {
  it('40 px right on rz adds 20° in one history step; undo restores', async () => {
    const app = opsApp();
    app.prefs.setState({ autoKey: false });
    const start = app.evaluation.channelValues(WAVE.handL).rz;
    const slider = beginVirtualSlider(app, [{ control: WAVE.handL, channel: 'rz' }]);
    for (let i = 0; i < 8; i++) slider.move(5, { shift: false, mod: false });
    expect(app.evaluation.channelValues(WAVE.handL).rz).toBeCloseTo(start + 20 * DEG, 12);
    slider.commit();
    expect(slider.active).toBe(false);
    expect(app.history.peekUndo()?.label).toBe('Drag Rotate Z');
    expect(app.evaluation.channelValues(WAVE.handL).rz).toBeCloseTo(start + 20 * DEG, 12);
    await runOk(app, 'edit.undo');
    expect(app.evaluation.channelValues(WAVE.handL).rz).toBe(start);
    expect(app.history.canUndo()).toBe(false);
  });

  it('modifiers are read at each move: 20 px plain + 20 px Shift = 11°; Mod ×10', () => {
    const app = opsApp();
    const slider = beginVirtualSlider(app, [{ control: WAVE.handL, channel: 'rz' }]);
    slider.move(20, { shift: false, mod: false });
    slider.move(20, { shift: true, mod: false });
    expect(app.evaluation.channelValues(WAVE.handL).rz).toBeCloseTo(11 * DEG, 12);
    slider.move(-2, { shift: false, mod: true });
    expect(app.evaluation.channelValues(WAVE.handL).rz).toBeCloseTo(1 * DEG, 12);
    slider.commit();
  });

  it('values are relative per control; a keyed channel without auto-key becomes an override', () => {
    const app = opsApp();
    app.prefs.setState({ autoKey: false });
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 15 } });
    const startLower = app.evaluation.channelValues(WAVE.lowerArmL).rz; // keyed: −30°
    expect(startLower).toBeCloseTo(-30 * DEG, 12);
    const slider = beginVirtualSlider(app, [
      { control: WAVE.lowerArmL, channel: 'rz' },
      { control: WAVE.handL, channel: 'rz' },
    ]);
    slider.move(10, { shift: false, mod: false });
    slider.commit();
    expect(app.evaluation.channelValues(WAVE.lowerArmL).rz).toBeCloseTo(-25 * DEG, 12);
    expect(app.evaluation.channelValues(WAVE.handL).rz).toBeCloseTo(5 * DEG, 12);
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)?.rz).toBeCloseTo(-25 * DEG, 12);
    expect(app.history.peekUndo()?.label).toBe('Drag Rotate Z');
  });

  it('auto-key on keys the keyed channel on release (M1 rules), one step', async () => {
    const app = opsApp();
    app.prefs.setState({ autoKey: true });
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 15 } });
    const slider = beginVirtualSlider(app, [{ control: WAVE.lowerArmL, channel: 'rz' }]);
    slider.move(20, { shift: false, mod: false });
    slider.commit();
    const key = app.store.query.keysOfCurve(WAVE.curve).find((k) => k.t === 15);
    expect(key?.v).toBeCloseTo(-20 * DEG, 12);
    await runOk(app, 'edit.undo');
    expect(app.store.query.keysOfCurve(WAVE.curve).find((k) => k.t === 15)?.v).toBeCloseTo(-30 * DEG, 12);
    expect(app.history.canUndo()).toBe(false);
  });

  it('attributes: ranged rate, clamped to the range; cancel restores; no motion records nothing', () => {
    const { app } = ikApp();
    const ik = cid('ik.leg.L');
    const slider = beginVirtualSlider(app, [
      { control: ik, channel: '@ikFk' },
      { control: ik, channel: '@roll' },
    ]);
    slider.move(-100, { shift: false, mod: false });
    expect(app.evaluation.channelValue(ik, '@ikFk')).toBeCloseTo(0.5, 12);
    expect(app.evaluation.channelValue(ik, '@roll')).toBeCloseTo(-50 * DEG, 12);
    slider.move(-300, { shift: false, mod: false });
    expect(app.evaluation.channelValue(ik, '@ikFk')).toBe(0);
    slider.cancel();
    expect(app.evaluation.channelValue(ik, '@ikFk')).toBe(1);
    expect(app.evaluation.channelValue(ik, '@roll')).toBe(0);
    expect(app.history.canUndo()).toBe(false);
    const idle = beginVirtualSlider(app, [{ control: ik, channel: '@roll' }]);
    idle.move(0, { shift: false, mod: false });
    idle.commit();
    expect(app.history.canUndo()).toBe(false);
  });

  it('locked, non-keyable and unknown channels are left out; with none the slider is inactive', async () => {
    const app = opsApp();
    await runOk(app, 'channel.toggleLock', { refs: [{ control: WAVE.handL, channel: 'rz' }] });
    const locked = beginVirtualSlider(app, [
      { control: WAVE.handL, channel: 'rz' },
      { control: WAVE.handL, channel: '@nope' },
    ]);
    expect(locked.active).toBe(false);
    expect(locked.refs).toEqual([]);
    locked.move(10, { shift: false, mod: false });
    locked.commit();
    const some = beginVirtualSlider(app, [
      { control: WAVE.handL, channel: 'rz' },
      { control: WAVE.handL, channel: 'rx' },
      { control: WAVE.handL, channel: 'rx' },
    ]);
    expect(some.refs).toEqual([{ control: WAVE.handL, channel: 'rx' }]);
    some.cancel();
  });

  it('Esc through edit.escape ends the slider: later moves do nothing', async () => {
    const app = opsApp();
    const slider = beginVirtualSlider(app, [{ control: WAVE.handL, channel: 'rz' }]);
    slider.move(10, { shift: false, mod: false });
    await runOk(app, 'edit.escape');
    expect(app.evaluation.channelValues(WAVE.handL).rz).toBe(0);
    slider.move(10, { shift: false, mod: false });
    expect(slider.active).toBe(false);
    slider.commit();
    expect(app.evaluation.channelValues(WAVE.handL).rz).toBe(0);
    expect(app.history.canUndo()).toBe(false);
  });
});
