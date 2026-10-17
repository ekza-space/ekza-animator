import { describe, expect, it } from 'vitest';
import type { EditorApp, TimeState } from '../../src/types';
import { edit, kernelApp, setFrame, twoCharacterDoc, W, waveApp } from './support';

function play(app: EditorApp, time: Partial<TimeState> = {}): void {
  app.session.setState({ time: { ...app.session.getState().time, playing: true, ...time } });
}
const time = (app: EditorApp) => app.session.getState().time;

/** Advances the clock at the given timestamps and returns the scene frames after each call. */
function ticks(app: EditorApp, stamps: readonly number[]): number[] {
  return stamps.map((ms) => {
    app.playback.advance(ms);
    return time(app).sceneFrame;
  });
}

describe('playback clock', () => {
  it('does nothing while stopped', () => {
    const app = waveApp();
    expect(app.playback.running).toBe(false);
    expect(app.playback.advance(0)).toBe(false);
    expect(app.playback.advance(1000)).toBe(false);
    expect(time(app).sceneFrame).toBe(0);
  });

  it('plays in real time with frame dropping, snapped to integer clip frames, looping in [start, end)', () => {
    const app = waveApp();
    play(app);
    expect(app.playback.running).toBe(true);
    expect(app.playback.advance(1000)).toBe(false); // the first tick starts the clock
    expect(app.playback.advance(1033.4)).toBe(true); // 1.002 frames
    expect(time(app).sceneFrame).toBe(1);
    expect(app.playback.advance(1040)).toBe(false); // 1.2 frames: still frame 1
    expect(ticks(app, [1500, 1999])).toEqual([15, 29]);
    expect(ticks(app, [2000.1, 2200])).toEqual([0, 6]); // 30 wraps to 0
    expect(ticks(app, [5000])).toEqual([0]); // frame dropping: 90 frames later, wrapped
  });

  it('steps one clip frame per tick in every-frame mode, at half and double speed by time', () => {
    const app = waveApp();
    play(app, { speed: 'every-frame' });
    expect(ticks(app, [0, 0, 0, 5000])).toEqual([0, 1, 2, 3]);
    const half = waveApp();
    play(half, { speed: 'half' });
    expect(ticks(half, [0, 1000])).toEqual([0, 15]);
    const double = waveApp();
    play(double, { speed: 'double' });
    expect(ticks(double, [0, 250])).toEqual([0, 15]);
  });

  it('stops at the end in once mode and starts over when played again at the end', () => {
    const app = waveApp();
    play(app, { loop: 'once' });
    expect(ticks(app, [0, 900, 2000])).toEqual([0, 27, 30]);
    expect(time(app).playing).toBe(false);
    expect(app.playback.advance(2100)).toBe(false);
    play(app);
    expect(ticks(app, [3000, 3100])).toEqual([0, 3]);
  });

  it('oscillates between start and end, flipping the direction', () => {
    const app = waveApp();
    play(app, { loop: 'oscillate' });
    app.playback.advance(0);
    app.playback.advance(1100); // 33 frames: bounced off 30 at 27
    expect(time(app)).toMatchObject({ sceneFrame: 27, direction: -1, playing: true });
    app.playback.advance(2100); // 30 frames back: bounced off 0 at 3
    expect(time(app)).toMatchObject({ sceneFrame: 3, direction: 1 });
    app.playback.advance(2200);
    expect(time(app).sceneFrame).toBe(6);
  });

  it('plays backwards', () => {
    const app = waveApp();
    setFrame(app, 10);
    play(app, { direction: -1 });
    expect(ticks(app, [0, 100, 400])).toEqual([10, 7, -0 + 28]);
    const once = waveApp();
    setFrame(once, 10);
    play(once, { direction: -1, loop: 'once' });
    expect(ticks(once, [0, 1000])).toEqual([10, 0]);
    expect(time(once).playing).toBe(false);
  });

  it('honours the playback range (scene frames)', () => {
    const app = waveApp();
    setFrame(app, 10);
    play(app, { playbackRange: { start: 10, end: 20 } });
    expect(ticks(app, [0, 200, 400])).toEqual([10, 16, 12]);
  });

  it("maps a 24 fps clip onto the 30 fps scene clock and snaps to the clip's frames", () => {
    const app = kernelApp({
      snapshot: twoCharacterDoc({ first: { fps: { num: 24, den: 1 }, range: { start: 0, end: 48 } } }),
    });
    play(app);
    app.playback.advance(0);
    app.playback.advance(100); // 2.4 clip frames → frame 2 → scene 2.5
    expect(time(app).sceneFrame).toBe(2.5);
    app.playback.advance(1000); // 24 clip frames → scene 30
    expect(time(app).sceneFrame).toBe(30);
    expect(app.evaluation.clipFrame(W.character)).toBe(24);
    app.session.setState({ time: { ...time(app), snapToFrames: false } });
    app.playback.advance(1100);
    expect(time(app).sceneFrame).toBeCloseTo(33, 9);
  });

  it('continues from a frame set during playback and from speed changes', () => {
    const app = waveApp();
    play(app);
    ticks(app, [0, 200]);
    expect(time(app).sceneFrame).toBe(6);
    setFrame(app, 20); // scrub while playing
    expect(ticks(app, [300, 400])).toEqual([20, 23]);
    app.session.setState({ time: { ...time(app), speed: 'double' } });
    expect(ticks(app, [500])).toEqual([29]);
  });

  it('plays the scene range at the scene rate without an active clip', () => {
    const app = waveApp();
    app.session.setState({ activeCharacter: null });
    play(app);
    expect(ticks(app, [0, 500, 1100])).toEqual([0, 15, 3]); // project sceneRange 0..30
  });

  it('requests frames while running', () => {
    const app = waveApp();
    let requests = 0;
    app.setFrameRequester(() => requests++);
    play(app);
    expect(requests).toBe(1); // playing → frame loop starts
    app.playback.advance(0);
    app.playback.advance(40);
    expect(requests).toBeGreaterThanOrEqual(3);
    app.session.setState({ time: { ...time(app), playing: false } });
    const settled = requests;
    app.playback.advance(80);
    expect(requests).toBe(settled);
  });

  it('moves an out-of-range frame into the range on start; survives a zero-length range', () => {
    const app = waveApp();
    edit(app, 'Range', (tx) => tx.patch('clips', W.clip, { range: { start: 5, end: 5 } }));
    play(app);
    expect(ticks(app, [0, 100])).toEqual([5, 5]);
  });
});
