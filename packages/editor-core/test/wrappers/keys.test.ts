// The animation wrappers on the wave fixture (STUDIO-TOUCH-SPEC §10.3, §10.6, §15 rows 7.11, 8.25; T5a): Hold Pose,
// Paste Pose at Frame, Make Loop, Scale / Offset Key Values and Offset in Loop fill their wrapped operator's explicit
// targets from the session (active clip, playhead, time band, selection, copied pose), record one undo step under
// their own label with an exact undo and redo, and refuse in plain words.
import { describe, expect, it } from 'vitest';
import type { EditorApp } from '../../src/types';
import { DEG, expectOneStep, refusal, runOk, select, setSceneFrame, WAVE, waveApp } from './support';

const ARM = WAVE.lowerArmL;
const round = (v: number): number => Math.round(v * 1e9) / 1e9;

/** [frame, value in degrees] of the wave's lowerArm.L rz keys. */
function armKeys(app: EditorApp): [number, number][] {
  return app.store.query
    .keysOfCurve(WAVE.curve)
    .map((key) => [key.t, round(key.v / DEG)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

function band(app: EditorApp, start: number, end: number): void {
  app.session.setState({ time: { ...app.session.getState().time, band: { start, end } } });
}

describe('pose.hold', () => {
  it('keys the band start pose at the band end on the selected controls (one step)', async () => {
    const app = await waveApp();
    select(app, [ARM]);
    expect(await refusal(app, 'pose.hold')).toBe('Pick a time range to hold the pose over');
    band(app, 0, 10);
    const { value } = await expectOneStep(app, 'pose.hold', undefined, 'Hold Pose');
    expect((value as { keyed: number }).keyed).toBeGreaterThan(0);
    expect(armKeys(app)).toEqual([
      [0, 30],
      [10, 30],
      [15, -30],
      [30, 30],
    ]);
  });

  it('takes explicit frames and refuses a range of one frame', async () => {
    const app = await waveApp();
    select(app, [ARM]);
    await runOk(app, 'pose.hold', { from: 15, to: [20, 25] });
    expect(armKeys(app).filter(([t]) => t === 20 || t === 25)).toEqual([
      [20, -30],
      [25, -30],
    ]);
    expect(await refusal(app, 'pose.hold', { from: 5, to: 5 })).toBe('Pick a time range to hold the pose over');
    expect(await refusal(app, 'pose.hold', { from: 5, to: 'end' })).toBe('to must be a frame');
  });
});

describe('pose.pasteAt', () => {
  it('keys the copied pose at another frame and leaves the playhead where it is', async () => {
    const app = await waveApp();
    select(app, [ARM]);
    expect(await refusal(app, 'pose.pasteAt', { frame: 20 })).toBe('There is no copied pose');
    setSceneFrame(app, 0);
    await runOk(app, 'pose.copy');
    setSceneFrame(app, 12);
    await expectOneStep(app, 'pose.pasteAt', { frame: 20 }, 'Paste Pose at Frame 20');
    expect(armKeys(app).find(([t]) => t === 20)).toEqual([20, 30]);
    expect(app.session.getState().time.sceneFrame).toBe(12);
    // The default frame is the playhead.
    await expectOneStep(app, 'pose.pasteAt', undefined, 'Paste Pose at Frame 12');
    expect(armKeys(app).find(([t]) => t === 12)).toEqual([12, 30]);
  });
});

describe('clip.loop', () => {
  it('makes the active animation loop seamlessly (one step, its own label)', async () => {
    const app = await waveApp();
    await runOk(app, 'key.write', {
      clip: WAVE.clip,
      keys: [{ control: ARM, channel: 'rz', frame: 30, value: 40 * DEG }],
    });
    const { value } = await expectOneStep(app, 'clip.loop', undefined, 'Make Loop "wave"');
    const made = value as { curvesChanged: number; seamBefore: number; seamAfter: number };
    expect(made.curvesChanged).toBe(1);
    expect(made.seamBefore).toBeCloseTo(10 * DEG, 9);
    expect(made.seamAfter).toBeLessThan(1e-9);
    expect(await refusal(app, 'clip.loop', { method: 'twice' })).toBe('method is one of matchEnds, blend, cycleOnly');
    expect(await refusal(app, 'clip.loop', { clip: 'clp_Nope' })).toBe('The animation does not exist');
  });
});

describe('key.scaleValues and key.offsetValues', () => {
  it('scale the selected controls about the rest pose, or only the selected keys', async () => {
    const app = await waveApp();
    expect(await refusal(app, 'key.scaleValues', { factor: 2 })).toBe(
      'Select keys, channels or animated controls first',
    );
    select(app, [ARM]);
    expect(await refusal(app, 'key.scaleValues', { factor: 1 })).toBe('Nothing to scale: the factor is 1');
    expect(await refusal(app, 'key.scaleValues', { factor: 500 })).toBe('factor must lie in 0.01…100');
    await expectOneStep(app, 'key.scaleValues', { factor: 2 }, 'Scale Values ×2');
    expect(armKeys(app)).toEqual([
      [0, 60],
      [15, -60],
      [30, 60],
    ]);
    const state = app.session.getState();
    app.session.setState({
      selection: { ...state.selection, keys: new Map([[WAVE.keys[1], { key: true, in: false, out: false }]]) },
    });
    await runOk(app, 'key.scaleValues', { factor: 0.5 });
    expect(armKeys(app)).toEqual([
      [0, 60],
      [15, -30],
      [30, 60],
    ]);
  });

  it('offset values inside the time band only', async () => {
    const app = await waveApp();
    select(app, [ARM]);
    expect(await refusal(app, 'key.offsetValues', { rotate: 0 })).toBe('Nothing to offset: every offset is 0');
    band(app, 10, 20);
    await expectOneStep(app, 'key.offsetValues', { rotate: 10 * DEG }, 'Offset Values');
    expect(armKeys(app)).toEqual([
      [0, 30],
      [15, -20],
      [30, 30],
    ]);
  });
});

describe('key.offsetInLoop', () => {
  it('shifts whole curves in time around the loop (one step)', async () => {
    const app = await waveApp();
    select(app, [ARM]);
    const { value } = await expectOneStep(app, 'key.offsetInLoop', { offset: 5 }, 'Offset in Loop (+5 frames)');
    expect((value as { moved: number }).moved).toBeGreaterThan(0);
    expect(armKeys(app).some(([t, v]) => t === 20 && v === -30)).toBe(true);
    expect(await refusal(app, 'key.offsetInLoop', { offset: 0 })).toBe('Nothing to offset: the offset is 0');
    await runOk(app, 'clip.setSettings', { clip: WAVE.clip, loop: false });
    expect(await refusal(app, 'key.offsetInLoop', { offset: 5 })).toBe(
      'The animation does not loop: turn Loop on first',
    );
  });
});
