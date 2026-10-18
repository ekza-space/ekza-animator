// M2A-SPEC §4.9, §5.9–§5.12 (A3): key.toggleRipple, time.insertTime / time.deleteTime, the time.setFrame carry,
// graph.keys.move / scale ripple defaults by panel, the value scale of graph.keys.scale (§5.15.3, enabled at
// integration), graph.keys.paste 'insert' and graph.keys.copyTo. Every undoable operator reverts and redoes exactly in
// one step (§9.2).
import type { ChannelId, ControlId, CurveId, KeyId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { ensureCurve, registerRippleControls } from '../../src';
import type { EditorApp, KeyPartSelection } from '../../src/types';
import { DEG, expectUndoRedoExact, opsApp, runOk, runResult, setSceneFrame, WAVE } from './support';

type Point = readonly [t: number, v: number, breakdown?: boolean];

let serial = 0;
function curveWith(
  app: EditorApp,
  control: ControlId,
  channel: ChannelId,
  points: readonly Point[],
): { readonly curve: CurveId; readonly keys: KeyId[] } {
  const prefix = `O${String(serial++).padStart(4, '0')}`;
  return app.store.transact({ label: 'Keys' }, (tx) => {
    const curve = ensureCurve(app, tx, WAVE.clip, control, channel);
    for (const key of tx.query.keysOfCurve(curve)) tx.remove('keys', key.id);
    const keys = points.map(([t, v, breakdown], i) => {
      const id = `k_${prefix}${String(i).padStart(7, '0')}` as KeyId;
      tx.put('keys', {
        id,
        clip: WAVE.clip,
        curve,
        t,
        v,
        inType: 'auto',
        outType: 'auto',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
        ...(breakdown === true ? { breakdown: true } : {}),
      });
      return id;
    });
    return { curve, keys };
  });
}

const times = (app: EditorApp, curve: CurveId): number[] => app.store.query.keysOfCurve(curve).map((key) => key.t);
/** Values of a curve's keys in key order. */
const values = (app: EditorApp, curve: CurveId): number[] => app.store.query.keysOfCurve(curve).map((key) => key.v);

function selectKeys(app: EditorApp, keys: readonly KeyId[]): void {
  const selection = app.session.getState().selection;
  const map = new Map<KeyId, KeyPartSelection>(keys.map((id) => [id, { key: true, in: false, out: false }]));
  app.session.setState({ selection: { ...selection, keys: map } });
}

function selectControls(app: EditorApp, controls: readonly ControlId[]): void {
  app.session.setState({ selection: { ...app.session.getState().selection, controls } });
}

/** cog tx at 0/10/20 and the upper arm rz at 0/6/16 (the wave curve keeps its keys at 0/15/30). */
function setup() {
  const app = opsApp();
  const cog = curveWith(app, WAVE.cog, 'tx', [
    [0, 0],
    [10, 1],
    [20, 2],
  ]);
  const arm = curveWith(app, WAVE.upperArmL, 'rz', [
    [0, 0],
    [6, 1],
    [16, 2],
  ]);
  return { app, cog, arm };
}

describe('key.toggleRipple', () => {
  it('toggles session.tools.ripple or sets it; not a history step', async () => {
    const app = opsApp();
    expect(app.session.getState().tools.ripple).toBe(false);
    await runOk(app, 'key.toggleRipple');
    expect(app.session.getState().tools.ripple).toBe(true);
    await runOk(app, 'key.toggleRipple', { ripple: true });
    expect(app.session.getState().tools.ripple).toBe(true);
    await runOk(app, 'key.toggleRipple');
    expect(app.session.getState().tools.ripple).toBe(false);
    expect(app.history.canUndo()).toBe(false);
    expect((await runResult(app, 'key.toggleRipple', { ripple: 'yes' })).status).toBe('cancelled');
  });
});

describe('time.insertTime (§5.9)', () => {
  it('Insert Frame at the current frame: later keys shift by one on the target controls; one exact step', async () => {
    const { app, cog, arm } = setup();
    selectControls(app, [WAVE.cog, WAVE.upperArmL]);
    setSceneFrame(app, 10);
    await expectUndoRedoExact(app, 'time.insertTime', { frames: 1 });
    expect(times(app, cog.curve)).toEqual([0, 10, 21]);
    expect(times(app, arm.curve)).toEqual([0, 6, 17]);
    // Only the target controls: the wave curve (not selected) is unchanged.
    expect(times(app, WAVE.curve)).toEqual([0, 15, 30]);
    expect(app.history.peekUndo()?.label).toBe('Insert Frame');
  });

  it('target "character" and an explicit `at`; no breakdown retiming', async () => {
    const { app, cog } = setup();
    const bd = curveWith(app, WAVE.handL, 'rz', [
      [0, 0],
      [7, 0.5, true],
      [12, 1],
    ]);
    selectControls(app, [WAVE.cog]);
    await runOk(app, 'time.insertTime', { at: 8, frames: 3, target: 'character' });
    expect(times(app, cog.curve)).toEqual([0, 13, 23]);
    expect(times(app, WAVE.curve)).toEqual([0, 18, 33]);
    // The breakdown before the insert point stays although its right anchor moved.
    expect(times(app, bd.curve)).toEqual([0, 7, 15]);
    expect(app.history.peekUndo()?.label).toBe('Insert 3 Frames');
  });

  it('Remove Frame poll-fails when a key would be deleted; removeKeys deletes it', async () => {
    const { app, cog } = setup();
    selectControls(app, [WAVE.cog]);
    setSceneFrame(app, 9);
    expect(app.operators.poll('time.insertTime', {}, { frames: -1 })).toEqual({
      ok: false,
      reason: 'A key at frame 10 would be deleted: use Delete Time',
    });
    setSceneFrame(app, 10);
    await expectUndoRedoExact(app, 'time.insertTime', { frames: -1 });
    expect(times(app, cog.curve)).toEqual([0, 10, 19]);
    expect(app.history.peekUndo()?.label).toBe('Remove Frame');
    selectKeys(app, [cog.keys[1] as KeyId]);
    await runOk(app, 'time.insertTime', { at: 9, frames: -1, removeKeys: true });
    expect(times(app, cog.curve)).toEqual([0, 18]);
    expect(app.session.getState().selection.keys.size).toBe(0);
  });

  it('refuses bad arguments and a document without animated targets', async () => {
    const app = opsApp();
    for (const args of [
      undefined,
      { frames: 0 },
      { frames: 'x' },
      { frames: 1, at: Number.NaN },
      { frames: 1, target: 'x' },
    ]) {
      expect((await runResult(app, 'time.insertTime', args)).status).toBe('cancelled');
    }
    selectControls(app, [WAVE.hips]);
    expect(app.operators.poll('time.insertTime', {}, { frames: 1 })).toEqual({
      ok: false,
      reason: 'No animated controls',
    });
  });
});

describe('time.deleteTime (§5.9)', () => {
  it('removes the band’s frames and their keys and clears the band (one step)', async () => {
    const { app, cog, arm } = setup();
    selectControls(app, [WAVE.cog, WAVE.upperArmL]);
    app.session.setState({ time: { ...app.session.getState().time, band: { start: 5, end: 10 } } });
    await expectUndoRedoExact(app, 'time.deleteTime');
    expect(times(app, cog.curve)).toEqual([0, 14]);
    expect(times(app, arm.curve)).toEqual([0, 10]);
    expect(app.history.peekUndo()?.label).toBe('Delete Time');
  });

  it('without a band deletes the current frame; an explicit range wins', async () => {
    const { app, cog } = setup();
    selectControls(app, [WAVE.cog]);
    setSceneFrame(app, 10);
    await runOk(app, 'time.deleteTime');
    expect(times(app, cog.curve)).toEqual([0, 19]);
    await runOk(app, 'time.deleteTime', { range: { start: 2, end: 1 } });
    expect(times(app, cog.curve)).toEqual([0, 17]);
    expect((await runResult(app, 'time.deleteTime', { range: { start: 1 } })).status).toBe('cancelled');
  });
});

describe('time.setFrame carry (§5.9, FR-TIME-10)', () => {
  it('keeps the pose as overrides at the new frame in one history step; undo drops it and keeps the frame', async () => {
    const app = opsApp();
    // The wave curve: 30° at 0, −30° at 15.
    const at0 = app.evaluation.channelValues(WAVE.lowerArmL).rz;
    expect(at0).toBeCloseTo(30 * DEG, 12);
    await runOk(app, 'time.setFrame', { frame: 15, carry: true });
    expect(app.session.getState().time.sceneFrame).toBe(15);
    expect(app.evaluation.channelValues(WAVE.lowerArmL).rz).toBeCloseTo(30 * DEG, 12);
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)?.rz).toBeCloseTo(30 * DEG, 12);
    // Controls whose values do not change get no override.
    expect(app.session.getState().overrides.has(WAVE.cog)).toBe(false);
    expect(app.history.peekUndo()?.label).toBe('Carry Pose');
    await runOk(app, 'edit.undo');
    expect(app.session.getState().time.sceneFrame).toBe(15);
    expect(app.session.getState().overrides.size).toBe(0);
    expect(app.evaluation.channelValues(WAVE.lowerArmL).rz).toBeCloseTo(-30 * DEG, 12);
    await runOk(app, 'edit.redo');
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)?.rz).toBeCloseTo(30 * DEG, 12);
  });

  it('a carry frame by frame leaves one step at the release frame; S keys the carried value', async () => {
    const app = opsApp();
    selectControls(app, [WAVE.lowerArmL]);
    for (const frame of [3, 6, 9, 10]) await runOk(app, 'time.setFrame', { frame, carry: true });
    const steps: string[] = [];
    while (app.history.canUndo()) {
      steps.push(app.history.peekUndo()?.label ?? '');
      app.history.undo();
    }
    expect(steps).toEqual(['Carry Pose']);
    app.history.redo();
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)?.rz).toBeCloseTo(30 * DEG, 12);
    await runOk(app, 'key.set', { channels: 'rotate' });
    const key = app.store.query.keysOfCurve(WAVE.curve).find((k) => k.t === 10);
    expect(key?.v).toBeCloseTo(30 * DEG, 12);
    // The next frame change ends the carry like any override.
    await runOk(app, 'time.setFrame', { frame: 11 });
    expect(app.session.getState().overrides.size).toBe(0);
  });

  it('without carry or without a frame change nothing is carried', async () => {
    const app = opsApp();
    await runOk(app, 'time.setFrame', { frame: 0, carry: true });
    expect(app.history.canUndo()).toBe(false);
    await runOk(app, 'time.setFrame', { frame: 15 });
    expect(app.session.getState().overrides.size).toBe(0);
    expect((await runResult(app, 'time.setFrame', { frame: 3, carry: 1 })).status).toBe('cancelled');
  });
});

describe('graph.keys.move / graph.keys.scale ripple (§5.11, §6)', () => {
  it('ripples from the Dope Sheet and the time slider when tools.ripple is on, never from the Graph Editor', async () => {
    const { app, cog, arm } = setup();
    selectControls(app, [WAVE.cog, WAVE.upperArmL]);
    await runOk(app, 'key.toggleRipple', { ripple: true });
    selectKeys(app, [cog.keys[1] as KeyId]);
    expect((await app.runUntyped('graph.keys.move', { dFrames: 1, dValue: 0 }, { panel: 'graph' })).status).toBe(
      'finished',
    );
    expect(times(app, cog.curve)).toEqual([0, 11, 20]);
    expect(times(app, arm.curve)).toEqual([0, 6, 16]);
    expect((await app.runUntyped('graph.keys.move', { dFrames: 1, dValue: 0 }, { panel: 'timeline' })).status).toBe(
      'finished',
    );
    expect(times(app, cog.curve)).toEqual([0, 12, 21]);
    expect(times(app, arm.curve)).toEqual([0, 6, 17]);
    // An explicit `ripple` wins over the panel default.
    await app.runUntyped('graph.keys.move', { dFrames: -1, dValue: 0, ripple: false }, { panel: 'dopeSheet' });
    expect(times(app, cog.curve)).toEqual([0, 11, 21]);
    await runOk(app, 'key.toggleRipple', { ripple: false });
    await app.runUntyped('graph.keys.move', { dFrames: 1, dValue: 0 }, { panel: 'dopeSheet' });
    expect(times(app, arm.curve)).toEqual([0, 6, 17]);
  });

  it('the nudge is one exact undo step each; the Dope Sheet ripples over its registered control set', async () => {
    const { app, cog, arm } = setup();
    selectControls(app, [WAVE.cog]);
    const dispose = registerRippleControls(app, 'dopeSheet', () => [WAVE.cog, WAVE.upperArmL]);
    await runOk(app, 'key.toggleRipple', { ripple: true });
    selectKeys(app, [cog.keys[1] as KeyId]);
    const before = times(app, arm.curve);
    const result = await app.runUntyped('graph.keys.move', { dFrames: 2, dValue: 0 }, { panel: 'dopeSheet' });
    expect(result).toEqual({ status: 'finished', value: { count: 3 } });
    expect(times(app, arm.curve)).toEqual([0, 6, 18]);
    await runOk(app, 'edit.undo');
    expect(times(app, arm.curve)).toEqual(before);
    expect(times(app, cog.curve)).toEqual([0, 10, 20]);
    dispose();
  });

  it('the time slider’s band is the region of a ripple scale', async () => {
    const { app, cog, arm } = setup();
    selectControls(app, [WAVE.cog, WAVE.upperArmL]);
    await runOk(app, 'key.toggleRipple', { ripple: true });
    app.session.setState({ time: { ...app.session.getState().time, band: { start: 0, end: 12 } } });
    selectKeys(app, [cog.keys[0], cog.keys[1], arm.keys[0], arm.keys[1]] as KeyId[]);
    await app.runUntyped('graph.keys.scale', { pivot: 0, factor: 1.5 }, { panel: 'timeline' });
    expect(times(app, cog.curve)).toEqual([0, 15, 26]);
    expect(times(app, arm.curve)).toEqual([0, 9, 22]);
  });

  it('valueFactor 1 (or absent) scales time only; a bad ripple argument is refused', async () => {
    const { app, cog } = setup();
    selectKeys(app, [cog.keys[1] as KeyId, cog.keys[2] as KeyId]);
    await runOk(app, 'graph.keys.scale', { pivot: 10, factor: 2, valueFactor: 1 });
    expect(times(app, cog.curve)).toEqual([0, 10, 30]);
    expect(values(app, cog.curve)).toEqual([0, 1, 2]);
    expect((await runResult(app, 'graph.keys.move', { dFrames: 1, dValue: 0, ripple: 1 })).status).toBe('cancelled');
    expect((await runResult(app, 'graph.keys.scale', { pivot: 0, factor: 1, valueFactor: Number.NaN })).status).toBe(
      'cancelled',
    );
  });
});

describe('graph.keys.scale value scale (§5.15.3, integration: A4 scaleKeyValues behind the operator)', () => {
  it('scales the selected values about valuePivot; the unselected key stays; one exact undo step', async () => {
    const { app, cog } = setup();
    selectKeys(app, [cog.keys[1] as KeyId, cog.keys[2] as KeyId]);
    const { value } = await expectUndoRedoExact(app, 'graph.keys.scale', {
      pivot: 0,
      factor: 1,
      valuePivot: 1,
      valueFactor: 2,
    });
    expect(value).toEqual({ count: 2 });
    expect(times(app, cog.curve)).toEqual([0, 10, 20]);
    expect(values(app, cog.curve)).toEqual([0, 1, 3]);
    expect(app.history.peekUndo()?.label).toBe('Scale Keys');
  });

  it('a negative factor flips the values about the pivot; an absent pivot is 0', async () => {
    const { app, cog } = setup();
    selectKeys(app, [cog.keys[1] as KeyId, cog.keys[2] as KeyId]);
    await runOk(app, 'graph.keys.scale', { pivot: 0, factor: 1, valuePivot: 1.5, valueFactor: -1 });
    expect(values(app, cog.curve)).toEqual([0, 2, 1]);
    await runOk(app, 'graph.keys.scale', { pivot: 0, factor: 1, valueFactor: -1 });
    expect(values(app, cog.curve)).toEqual([0, -2, -1]);
  });

  it('rotations and angle attributes take the pivot in degrees; plain attributes in their own units', async () => {
    const app = opsApp();
    app.store.transact({ label: 'Attributes' }, (tx) =>
      tx.patch('controls', WAVE.handL, {
        attrs: {
          roll: { type: 'float', default: 0, keyable: true, unit: 'angle' },
          blend: { type: 'float', default: 0, keyable: true },
        },
      }),
    );
    const rz = curveWith(app, WAVE.handL, 'rz', [
      [0, 10 * DEG],
      [10, 30 * DEG],
    ]);
    const roll = curveWith(app, WAVE.handL, '@roll', [
      [0, 10 * DEG],
      [10, 30 * DEG],
    ]);
    const blend = curveWith(app, WAVE.handL, '@blend', [
      [0, 10],
      [10, 30],
    ]);
    selectKeys(app, [...rz.keys, ...roll.keys, ...blend.keys]);
    await expectUndoRedoExact(app, 'graph.keys.scale', { pivot: 0, factor: 1, valuePivot: 20, valueFactor: 0.5 });
    for (const curve of [rz.curve, roll.curve]) {
      const [a, b] = values(app, curve);
      expect((a ?? 0) / DEG).toBeCloseTo(15, 9);
      expect((b ?? 0) / DEG).toBeCloseTo(25, 9);
    }
    expect(values(app, blend.curve)).toEqual([15, 25]);
  });

  it('time and value scale in one call are one step; undo and redo are exact; locked curves keep their values', async () => {
    const { app, cog, arm } = setup();
    app.store.transact({ label: 'Lock' }, (tx) => tx.patch('curves', arm.curve, { locked: true }));
    selectKeys(app, [cog.keys[1], cog.keys[2], arm.keys[2]] as KeyId[]);
    const { value } = await expectUndoRedoExact(app, 'graph.keys.scale', {
      pivot: 10,
      factor: 2,
      valuePivot: 0,
      valueFactor: 3,
    });
    expect(value).toEqual({ count: 2 });
    expect(times(app, cog.curve)).toEqual([0, 10, 30]);
    expect(values(app, cog.curve)).toEqual([0, 3, 6]);
    expect(times(app, arm.curve)).toEqual([0, 6, 16]);
    expect(values(app, arm.curve)).toEqual([0, 1, 2]);
  });

  it('keys the time scale merges away are skipped by the value scale', async () => {
    const { app, cog } = setup();
    selectKeys(app, [cog.keys[1], cog.keys[2]] as KeyId[]);
    // Factor 0.01 about 0 lands both keys on frame 0 (with the unselected key): collisions resolve to one key.
    const result = await runResult(app, 'graph.keys.scale', { pivot: 0, factor: 0.01, valuePivot: 0, valueFactor: 2 });
    expect(result.status).toBe('finished');
    const keys = app.store.query.keysOfCurve(cog.curve);
    expect(keys.map((key) => key.t)).toEqual([0]);
    expect([0, 2, 4]).toContain(keys[0]?.v);
  });
});

describe('graph.keys.paste insert (§5.10) and graph.keys.copyTo (§5.9)', () => {
  it('insert shifts the scope keys at or after the paste frame by the clipboard span first', async () => {
    const { app, cog, arm } = setup();
    selectControls(app, [WAVE.cog, WAVE.upperArmL]);
    selectKeys(app, [cog.keys[0], cog.keys[1]] as KeyId[]);
    await runOk(app, 'graph.keys.copy');
    setSceneFrame(app, 6);
    await expectUndoRedoExact(app, 'graph.keys.paste', { mode: 'insert' });
    // Span 10 − 0 + 1 = 11: every key at or after 6 moves by 11, then the copies land at 6 and 16.
    expect(times(app, cog.curve)).toEqual([0, 6, 16, 21, 31]);
    expect(times(app, arm.curve)).toEqual([0, 17, 27]);
  });

  it('the default mode is insert only with ripple on in the Dope Sheet or the time slider', async () => {
    const { app, cog } = setup();
    selectControls(app, [WAVE.cog]);
    selectKeys(app, [cog.keys[1] as KeyId]);
    await runOk(app, 'graph.keys.copy');
    setSceneFrame(app, 20);
    await app.runUntyped('graph.keys.paste', undefined, { panel: 'dopeSheet' });
    expect(times(app, cog.curve)).toEqual([0, 10, 20]);
    await runOk(app, 'key.toggleRipple', { ripple: true });
    await app.runUntyped('graph.keys.paste', undefined, { panel: 'graph' });
    expect(times(app, cog.curve)).toEqual([0, 10, 20]);
    await app.runUntyped('edit.paste', undefined, { panel: 'dopeSheet' });
    expect(times(app, cog.curve)).toEqual([0, 10, 20, 21]);
    expect((await runResult(app, 'graph.keys.paste', { mode: 'splice' })).status).toBe('cancelled');
  });

  it('copyTo copies the selected keys by an offset, selects the copies; one exact step', async () => {
    const { app, cog } = setup();
    selectKeys(app, [cog.keys[1] as KeyId]);
    const { value } = await expectUndoRedoExact(app, 'graph.keys.copyTo', { dFrames: 4 });
    expect(value).toEqual({ count: 1 });
    expect(times(app, cog.curve)).toEqual([0, 10, 14, 20]);
    const selected = [...app.session.getState().selection.keys.keys()];
    expect(selected.map((id) => app.store.get('keys', id)?.t)).toEqual([14]);
    expect(app.history.peekUndo()?.label).toBe('Copy Keys');
    expect((await runResult(app, 'graph.keys.copyTo', {})).status).toBe('cancelled');
  });
});
