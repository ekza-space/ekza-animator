// Time operators (MVP-SPEC §4.9 `time.*`, §4.11.8): clip-frame units, snapping and clamping, scene units, key
// jumps that wrap, playback state; frame changes discard pose overrides; nothing enters the undo history.
import type { ControlId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { registerBuiltinOperators } from '../../src';
import { createFakeEditorApp } from '../../src/testing';
import { twoCharacterDoc } from '../kernel/support';
import { humanoidSkeleton, opsApp, runOk, runResult, setSceneFrame, WAVE } from './support';

function frame(app: ReturnType<typeof opsApp>): number {
  return app.session.getState().time.sceneFrame;
}

describe('time.setFrame / time.step', () => {
  it('sets active-clip frames, snapped and clamped to the clip range', async () => {
    const app = opsApp();
    await runOk(app, 'time.setFrame', { frame: 12.4 });
    expect(frame(app)).toBe(12);
    await runOk(app, 'time.setFrame', { frame: 99 });
    expect(frame(app)).toBe(30);
    await runOk(app, 'time.setFrame', { frame: -3 });
    expect(frame(app)).toBe(0);
    app.session.setState({ time: { ...app.session.getState().time, snapToFrames: false } });
    await runOk(app, 'time.setFrame', { frame: 12.4 });
    expect(frame(app)).toBe(12.4);
    expect(app.history.canUndo()).toBe(false);
  });

  it('sets scene frames directly with unit "scene"', async () => {
    const app = opsApp();
    await runOk(app, 'time.setFrame', { frame: 44.5, unit: 'scene' });
    expect(frame(app)).toBe(44.5);
  });

  it('maps clip frames through the clip fps and scene start (§4.11.8)', async () => {
    const doc = twoCharacterDoc({ first: { fps: { num: 24, den: 1 }, sceneStart: 6 } });
    const app = createFakeEditorApp({ snapshot: doc, skeleton: humanoidSkeleton() });
    registerBuiltinOperators(app);
    await runOk(app, 'time.setFrame', { frame: 24 });
    // scene = sceneStart + clip · sceneFps / clipFps = 6 + 24 · 30 / 24
    expect(frame(app)).toBe(36);
    expect(app.evaluation.clipFrame(WAVE.character)).toBe(24);
  });

  it('discards pose overrides when the frame changes', async () => {
    const app = opsApp();
    app.session.setState({ overrides: new Map([[WAVE.lowerArmL, { rz: 1 }]]) });
    await runOk(app, 'time.setFrame', { frame: 3 });
    expect(app.session.getState().overrides.size).toBe(0);
  });

  it('steps by whole frames inside the range', async () => {
    const app = opsApp();
    await runOk(app, 'time.step', { delta: 1 });
    await runOk(app, 'time.step', { delta: 1 });
    expect(frame(app)).toBe(2);
    await runOk(app, 'time.step', { delta: -5 });
    expect(frame(app)).toBe(0);
  });

  it('refuses malformed frames', async () => {
    const app = opsApp();
    expect((await runResult(app, 'time.setFrame', { frame: Number.POSITIVE_INFINITY })).status).toBe('cancelled');
    expect((await runResult(app, 'time.setFrame', { frame: 1, unit: 'seconds' })).status).toBe('cancelled');
    expect((await runResult(app, 'time.step', {})).status).toBe('cancelled');
  });
});

describe('time.nextKey / time.prevKey / goToStart / goToEnd', () => {
  it('jumps between the keys of the selection (all controls when none) and wraps around', async () => {
    const app = opsApp();
    await runOk(app, 'time.nextKey');
    expect(frame(app)).toBe(15);
    await runOk(app, 'time.nextKey');
    expect(frame(app)).toBe(30);
    await runOk(app, 'time.nextKey');
    expect(frame(app)).toBe(0);
    await runOk(app, 'time.prevKey');
    expect(frame(app)).toBe(30);
    // A selection without keys: no jump.
    app.session.setState({
      selection: { ...app.session.getState().selection, controls: [`${WAVE.rig}:fk.head` as ControlId] },
    });
    setSceneFrame(app, 4);
    await runOk(app, 'time.nextKey');
    expect(frame(app)).toBe(4);
  });

  it('goes to the playback range or the clip range', async () => {
    const app = opsApp();
    await runOk(app, 'time.goToEnd');
    expect(frame(app)).toBe(30);
    await runOk(app, 'time.goToStart');
    expect(frame(app)).toBe(0);
    await runOk(app, 'time.setPlaybackRange', { range: { start: 20, end: 5 } });
    expect(app.session.getState().time.playbackRange).toEqual({ start: 5, end: 20 });
    await runOk(app, 'time.goToStart');
    expect(frame(app)).toBe(5);
    await runOk(app, 'time.goToEnd');
    expect(frame(app)).toBe(20);
    await runOk(app, 'time.setPlaybackRange', { range: null });
    expect(app.session.getState().time.playbackRange).toBeNull();
  });
});

describe('playback', () => {
  it('plays, stops on the current frame and toggles; the clock advances while playing', async () => {
    const app = opsApp();
    await runOk(app, 'time.play');
    expect(app.session.getState().time).toMatchObject({ playing: true, direction: 1 });
    app.playback.advance(0);
    app.playback.advance(1000 / 30);
    expect(frame(app)).toBe(1);
    await runOk(app, 'time.stop');
    expect(app.session.getState().time.playing).toBe(false);
    expect(frame(app)).toBe(1);
    await runOk(app, 'time.togglePlay', { direction: -1 });
    expect(app.session.getState().time).toMatchObject({ playing: true, direction: -1 });
    await runOk(app, 'time.togglePlay');
    expect(app.session.getState().time.playing).toBe(false);
    expect((await runResult(app, 'time.play', { direction: 2 })).status).toBe('cancelled');
  });

  it('sets loop mode and speed', async () => {
    const app = opsApp();
    await runOk(app, 'time.setLoop', { loop: 'oscillate' });
    await runOk(app, 'time.setSpeed', { speed: 'every-frame' });
    expect(app.session.getState().time).toMatchObject({ loop: 'oscillate', speed: 'every-frame' });
    expect((await runResult(app, 'time.setLoop', { loop: 'forever' })).status).toBe('cancelled');
    expect((await runResult(app, 'time.setSpeed', { speed: 3 })).status).toBe('cancelled');
    expect(app.history.canUndo()).toBe(false);
  });
});
