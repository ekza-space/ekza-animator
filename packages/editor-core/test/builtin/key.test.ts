// Keying and channel operators (MVP-SPEC §4.11.1, §4.11.2): what `key.set` keys and with which values, overrides
// consumed by keying, delete at frame, auto key, typed channel values and channel locks; undo/redo exactness.
import type { ControlId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { curveOf as waveCurve } from '../kernel/support';
import {
  DEG,
  docJson,
  expectUndoRedoExact,
  opsApp,
  opsAppWith,
  runOk,
  runResult,
  setSceneFrame,
  WAVE,
} from './support';

const R = (key: string) => `${WAVE.rig}:${key}` as ControlId;

function select(app: ReturnType<typeof opsApp>, ids: readonly ControlId[]): void {
  app.session.setState({ selection: { ...app.session.getState().selection, controls: ids } });
}

function keysAt(app: ReturnType<typeof opsApp>, control: ControlId, channel: string): [number, number][] {
  const curve = waveCurve(app, control, channel);
  return curve === undefined ? [] : app.store.query.keysOfCurve(curve.id).map((k) => [k.t, k.v]);
}

describe('key.set', () => {
  it('keys every keyable rotation of the selection at the current frame with the current values', async () => {
    const app = opsApp();
    select(app, [WAVE.lowerArmL]);
    setSceneFrame(app, 7);
    const value = app.evaluation.channelValues(WAVE.lowerArmL).rz;
    const { value: result } = await expectUndoRedoExact(app, 'key.set', { channels: 'all' });
    expect(result).toEqual({ count: 3 });
    expect(keysAt(app, WAVE.lowerArmL, 'rx')).toEqual([[7, 0]]);
    expect(keysAt(app, WAVE.lowerArmL, 'ry')).toEqual([[7, 0]]);
    expect(keysAt(app, WAVE.lowerArmL, 'rz').map(([t]) => t)).toEqual([0, 7, 15, 30]);
    expect(keysAt(app, WAVE.lowerArmL, 'rz')[1]?.[1]).toBeCloseTo(value, 12);
    expect(app.history.peekUndo()?.label).toBe('Set Key');
    const key = app.store.query.keysOfCurve(waveCurve(app, WAVE.lowerArmL, 'rx')?.id as never)[0];
    expect(key).toMatchObject({ inType: 'auto', outType: 'auto', broken: false, weightLocked: true });
  });

  it('keys translate, rotate or scale only, and labels the step', async () => {
    const app = opsApp();
    select(app, [WAVE.cog]);
    await runOk(app, 'key.set', { channels: 'translate' });
    expect(app.history.peekUndo()?.label).toBe('Key Translate');
    expect(keysAt(app, WAVE.cog, 'tx')).toHaveLength(1);
    expect(keysAt(app, WAVE.cog, 'rx')).toHaveLength(0);
    await runOk(app, 'key.set', { channels: 'rotate' });
    expect(app.history.peekUndo()?.label).toBe('Key Rotate');
    expect(keysAt(app, WAVE.cog, 'rz')).toHaveLength(1);
    // cog has no keyable scale: nothing to key, the run still finishes with count 0.
    expect(await runOk(app, 'key.set', { channels: 'scale' })).toEqual({ count: 0 });
  });

  it('keys the selected channels, always all three rotations together', async () => {
    const app = opsApp();
    select(app, [WAVE.cog]);
    app.session.setState({
      selection: { ...app.session.getState().selection, channels: [{ control: WAVE.cog, channel: 'ry' }] },
    });
    expect(await runOk(app, 'key.set', { channels: 'selected' })).toEqual({ count: 3 });
    expect(keysAt(app, WAVE.cog, 'tx')).toHaveLength(0);
    for (const channel of ['rx', 'ry', 'rz']) expect(keysAt(app, WAVE.cog, channel)).toHaveLength(1);
  });

  it('skips locked channels and keys the whole character with target "character"', async () => {
    const app = opsApp();
    await runOk(app, 'channel.toggleLock', { refs: [{ control: WAVE.cog, channel: 'tx' }], locked: true });
    const result = (await runOk(app, 'key.set', { channels: 'all', target: 'character' })) as { count: number };
    expect(keysAt(app, WAVE.cog, 'tx')).toHaveLength(0);
    expect(keysAt(app, WAVE.cog, 'ty')).toHaveLength(1);
    const expected = app.store.query
      .controlsOfRig(WAVE.rig)
      .reduce(
        (n, c) =>
          n + [...c.keyable.t, ...c.keyable.r, ...c.keyable.s].filter(Boolean).length - (c.id === WAVE.cog ? 1 : 0),
        0,
      );
    expect(result.count).toBe(expected);
  });

  it('patches the value of a key already on the frame', async () => {
    const app = opsApp();
    select(app, [WAVE.lowerArmL]);
    setSceneFrame(app, 15);
    app.session.setState({ overrides: new Map([[WAVE.lowerArmL, { rz: 0.25 }]]) });
    await runOk(app, 'key.set', { channels: 'rotate' });
    expect(keysAt(app, WAVE.lowerArmL, 'rz')).toEqual([
      [0, 30 * DEG],
      [15, 0.25],
      [30, 30 * DEG],
    ]);
  });

  it('consumes the overrides it keys; undo brings them back', async () => {
    const app = opsApp();
    select(app, [WAVE.lowerArmL]);
    setSceneFrame(app, 5);
    await runOk(app, 'channel.setValues', { edits: [{ control: WAVE.lowerArmL, channel: 'rz', value: 1 }] });
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)).toEqual({ rz: 1 });
    await runOk(app, 'key.set');
    expect(app.session.getState().overrides.size).toBe(0);
    expect(keysAt(app, WAVE.lowerArmL, 'rz')).toContainEqual([5, 1]);
    await runOk(app, 'edit.undo');
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)).toEqual({ rz: 1 });
    expect(keysAt(app, WAVE.lowerArmL, 'rz').map(([t]) => t)).toEqual([0, 15, 30]);
  });

  // Acceptance round 1 (§8.3 step 12): keying a typed, unkeyed edit used to strip the edit's own step, so the next
  // undo skipped it and the typed value stayed as an override no step owned.
  it('keys a typed unkeyed edit without losing its undo step (Maya order: key, edit, older key)', async () => {
    const app = opsApp();
    select(app, [WAVE.upperArmL]);
    setSceneFrame(app, 0);
    const start = docJson(app);
    await runOk(app, 'key.set');
    const keyed = docJson(app);
    await runOk(app, 'channel.setValues', { edits: [{ control: WAVE.upperArmL, channel: 'rx', value: 15 * DEG }] });
    expect(app.session.getState().overrides.get(WAVE.upperArmL)).toEqual({ rx: 15 * DEG });
    await runOk(app, 'key.set');
    expect(app.session.getState().overrides.size).toBe(0);
    expect(keysAt(app, WAVE.upperArmL, 'rx')).toEqual([[0, 15 * DEG]]);

    expect(app.history.undo()).toMatchObject({ label: 'Set Key', overridesRestored: true, warnings: [] });
    expect(docJson(app)).toEqual(keyed);
    expect(app.session.getState().overrides.get(WAVE.upperArmL)).toEqual({ rx: 15 * DEG });
    expect(app.history.undo()).toMatchObject({ overridesRestored: true, warnings: [] });
    expect(docJson(app)).toEqual(keyed);
    expect(app.session.getState().overrides.size).toBe(0);
    expect(app.evaluation.channelValues(WAVE.upperArmL).rx).toBe(0);
    expect(app.history.undo()).toMatchObject({ label: 'Set Key', warnings: [] });
    expect(docJson(app)).toEqual(start);
    expect(app.history.canUndo()).toBe(false);

    app.history.redo();
    app.history.redo();
    expect(app.session.getState().overrides.get(WAVE.upperArmL)).toEqual({ rx: 15 * DEG });
    app.history.redo();
    expect(app.session.getState().overrides.size).toBe(0);
    expect(keysAt(app, WAVE.upperArmL, 'rx')).toEqual([[0, 15 * DEG]]);
  });

  it('undoes ten mixed actions one by one back to the start and redoes them (§8.3 step 12)', async () => {
    const app = opsApp();
    setSceneFrame(app, 15);
    const start = docJson(app);
    const R2 = (control: ControlId) => ({ control, channel: 'rz' as const });
    const actions: readonly (readonly [string, unknown])[] = [
      ['select.controls', { ids: [WAVE.lowerArmL], mode: 'replace' }],
      ['key.set', undefined],
      ['channel.setValues', { edits: [{ control: WAVE.lowerArmL, channel: 'rz', value: 40 * DEG }] }],
      ['key.set', { channels: 'rotate' }],
      ['graph.tangent.set', { type: 'linear' }],
      ['channel.setValues', { edits: [{ control: WAVE.upperArmL, channel: 'rx', value: 12 * DEG }] }],
      ['channel.toggleLock', { refs: [R2(WAVE.handL)], locked: true }],
      ['channel.setValues', { edits: [{ control: WAVE.lowerArmL, channel: 'rx', value: 15 * DEG }] }],
      ['key.set', { channels: 'rotate' }],
      ['graph.infinity.set', { post: 'cycle' }],
    ];
    const states: unknown[] = [];
    const overrides: string[] = [];
    const snapshot = () => JSON.stringify([...app.session.getState().overrides]);
    for (const [id, args] of actions) {
      states.push(docJson(app));
      overrides.push(snapshot());
      if (id === 'graph.tangent.set' || id === 'graph.infinity.set') {
        // The Graph Editor targets the selected keys: select the lowerArm rz keys (a double-click on the curve).
        const curve = waveCurve(app, WAVE.lowerArmL, 'rz');
        const keys = app.store.query.keysOfCurve(curve?.id as never);
        const selection = app.session.getState().selection;
        const parts = { key: true, in: false, out: false };
        app.session.setState({ selection: { ...selection, keys: new Map(keys.map((key) => [key.id, parts])) } });
      }
      await runOk(app, id, args);
    }
    const end = docJson(app);
    const endOverrides = snapshot();
    for (let i = actions.length - 1; i >= 0; i--) {
      // Selection-only runs are not history steps; every other action is exactly one.
      if (actions[i]?.[0] === 'select.controls') continue;
      expect(app.history.undo()?.warnings).toEqual([]);
      expect(docJson(app)).toEqual(states[i]);
      expect(snapshot()).toBe(overrides[i]);
    }
    expect(docJson(app)).toEqual(start);
    expect(app.session.getState().overrides.size).toBe(0);
    expect(app.history.canUndo()).toBe(false);
    while (app.history.canRedo()) app.history.redo();
    expect(docJson(app)).toEqual(end);
    expect(snapshot()).toBe(endOverrides);
  });

  it('refuses without targets or an active clip', async () => {
    const app = opsApp();
    expect(await runResult(app, 'key.set')).toEqual({ status: 'cancelled', reason: 'nothing selected' });
    select(app, [WAVE.cog]);
    expect((await runResult(app, 'key.set', { channels: 'selected' })).status).toBe('cancelled');
    expect((await runResult(app, 'key.set', { channels: 'everything' })).status).toBe('cancelled');
  });

  it('uses the default tangents of the preferences', async () => {
    const app = opsApp();
    app.prefs.setState({ defaultTangents: { in: 'linear', out: 'step' } });
    select(app, [WAVE.hips]);
    await runOk(app, 'key.set', { channels: 'rotate' });
    const curve = waveCurve(app, WAVE.hips, 'rx');
    expect(app.store.query.keysOfCurve(curve?.id as never)[0]).toMatchObject({ inType: 'linear', outType: 'step' });
  });
});

describe('key.deleteAtFrame / key.toggleAutoKey', () => {
  it("deletes the selected controls' keys at the current frame", async () => {
    const app = opsApp();
    select(app, [WAVE.lowerArmL]);
    setSceneFrame(app, 15);
    const { value } = await expectUndoRedoExact(app, 'key.deleteAtFrame');
    expect(value).toEqual({ count: 1 });
    expect(keysAt(app, WAVE.lowerArmL, 'rz').map(([t]) => t)).toEqual([0, 30]);
    expect(app.history.peekUndo()?.label).toBe('Delete Keys');
  });

  it('keeps the value as the static value when the last key goes', async () => {
    const app = opsApp();
    select(app, [WAVE.lowerArmL]);
    for (const frame of [0, 30]) {
      setSceneFrame(app, frame);
      await runOk(app, 'key.deleteAtFrame');
    }
    setSceneFrame(app, 15);
    await runOk(app, 'key.deleteAtFrame');
    expect(keysAt(app, WAVE.lowerArmL, 'rz')).toEqual([]);
    expect(waveCurve(app, WAVE.lowerArmL, 'rz')?.staticValue).toBeCloseTo(-30 * DEG, 12);
  });

  it('needs a selection', async () => {
    const app = opsApp();
    expect((await runResult(app, 'key.deleteAtFrame')).status).toBe('cancelled');
  });

  it('keeps the keys of locked channels', async () => {
    const app = opsApp();
    select(app, [WAVE.lowerArmL]);
    await runOk(app, 'channel.toggleLock', { refs: [{ control: WAVE.lowerArmL, channel: 'rz' }] });
    setSceneFrame(app, 15);
    expect(await runOk(app, 'key.deleteAtFrame')).toEqual({ count: 0 });
    expect(keysAt(app, WAVE.lowerArmL, 'rz')).toHaveLength(3);
  });

  it('toggles auto key', async () => {
    const app = opsApp();
    expect(app.prefs.getState().autoKey).toBe(false);
    await runOk(app, 'key.toggleAutoKey');
    expect(app.prefs.getState().autoKey).toBe(true);
    await runOk(app, 'key.toggleAutoKey');
    expect(app.prefs.getState().autoKey).toBe(false);
    expect(app.history.canUndo()).toBe(false);
  });
});

describe('channel.setValues', () => {
  it('keys with key: force, overrides keyed curves with auto key off, sets static values otherwise', async () => {
    const app = opsApp();
    setSceneFrame(app, 10);
    await expectUndoRedoExact(app, 'channel.setValues', {
      edits: [{ control: WAVE.lowerArmL, channel: 'rx', value: 0.5 }],
      key: 'force',
      label: 'Typed',
    });
    expect(app.history.peekUndo()?.label).toBe('Typed');
    expect(keysAt(app, WAVE.lowerArmL, 'rx')).toEqual([[10, 0.5]]);
    const before = docJson(app);
    await runOk(app, 'channel.setValues', { edits: [{ control: WAVE.lowerArmL, channel: 'rz', value: 0.1 }] });
    expect(docJson(app)).toEqual(before);
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)).toEqual({ rz: 0.1 });
    await runOk(app, 'channel.setValues', { edits: [{ control: WAVE.hips, channel: 'ry', value: 0.2 }] });
    expect(waveCurve(app, WAVE.hips, 'ry')?.staticValue).toBe(0.2);
  });

  it('reports locked and non-keyable channels', async () => {
    const { app, services } = opsAppWith();
    await runOk(app, 'channel.toggleLock', { refs: [{ control: WAVE.cog, channel: 'tx' }] });
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: WAVE.cog, channel: 'tx', value: 1 },
        { control: WAVE.lowerArmL, channel: 'tx', value: 1 },
      ],
    });
    expect(services.toasts.at(-1)).toEqual({
      kind: 'warning',
      text: 'Not changed: 1 locked, 1 non-keyable channel(s)',
    });
  });

  it('refuses malformed edits', async () => {
    const app = opsApp();
    for (const args of [
      {},
      { edits: [{ control: WAVE.cog, channel: 'tx', value: Number.NaN }] },
      { edits: [{ control: R('nope'), channel: 'tx', value: 1 }] },
      { edits: [], key: 'sometimes' },
    ]) {
      expect((await runResult(app, 'channel.setValues', args)).status).toBe('cancelled');
    }
  });
});

describe('channel.toggleLock', () => {
  it('locks unless every channel is locked, then unlocks; undoable', async () => {
    const app = opsApp();
    const refs = [
      { control: WAVE.cog, channel: 'tx' },
      { control: WAVE.cog, channel: 'rz' },
    ];
    await expectUndoRedoExact(app, 'channel.toggleLock', { refs });
    expect(app.store.get('controls', WAVE.cog)?.locked).toEqual({
      t: [true, false, false],
      r: [false, false, true],
      s: [false, false, false],
    });
    expect(app.history.peekUndo()?.label).toBe('Lock Channels');
    await runOk(app, 'channel.toggleLock', { refs });
    expect(app.store.get('controls', WAVE.cog)?.locked.t).toEqual([false, false, false]);
    await runOk(app, 'channel.toggleLock', { refs: [refs[0]], locked: true });
    await runOk(app, 'channel.toggleLock', { refs, locked: true });
    expect(app.store.get('controls', WAVE.cog)?.locked.r).toEqual([false, false, true]);
  });

  it('refuses unknown controls and custom attributes', async () => {
    const app = opsApp();
    expect((await runResult(app, 'channel.toggleLock', { refs: [] })).status).toBe('cancelled');
    expect(
      (await runResult(app, 'channel.toggleLock', { refs: [{ control: WAVE.cog, channel: '@blink' }] })).status,
    ).toBe('cancelled');
  });
});
