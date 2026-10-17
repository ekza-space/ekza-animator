import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, Tx } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { applyChannelEdits, beginChannelEditGesture, type ChannelEditResult, type KeyPolicy } from '../../src';
import { cancelChannelEditGestures } from '../../src/edit/channels';
import type { EditorApp } from '../../src/types';
import {
  addOperator,
  curveOf,
  DEG,
  edit,
  kernelApp,
  setFrame,
  twoCharacterDoc,
  W,
  waveApp,
  waveAppWithServices,
  wavePoints,
} from './support';

function apply(
  app: EditorApp,
  edits: { control: ControlId; channel: ChannelId; value: number }[],
  key: KeyPolicy,
): ChannelEditResult {
  return edit(app, 'Edit', (tx: Tx) => applyChannelEdits(app, tx, edits, { key }));
}

describe('applyChannelEdits (§4.11.2 table)', () => {
  describe('curve with keys (fk.lowerArm.L rz)', () => {
    it.each([
      ['force', false, 'key'],
      ['auto', true, 'key'],
      ['auto', false, 'override'],
      ['none', true, 'override'],
      ['none', false, 'override'],
    ] as const)('key: %s, auto-key %s → %s', (policy, autoKey, outcome) => {
      const app = waveApp();
      app.prefs.setState({ autoKey });
      setFrame(app, 5);
      const before = app.store.snapshot();
      const result = apply(app, [{ control: W.lowerArmL, channel: 'rz', value: 12 * DEG }], policy);
      const observed = {
        keyed: result.keyed,
        statics: result.statics,
        resultOverride: result.overrides.get(W.lowerArmL) ?? null,
        keyTimes: wavePoints(app).map(([t]) => t),
        sessionOverride: app.session.getState().overrides.get(W.lowerArmL) ?? null,
        documentChanged: JSON.stringify(app.store.snapshot()) !== JSON.stringify(before),
        state: app.evaluation.channelState(W.lowerArmL, 'rz'),
      };
      const keyed = outcome === 'key';
      expect(observed).toEqual({
        keyed: keyed ? 1 : 0,
        statics: 0,
        resultOverride: keyed ? null : { rz: 12 * DEG },
        keyTimes: keyed ? [0, 5, 15, 30] : [0, 15, 30],
        sessionOverride: keyed ? null : { rz: 12 * DEG },
        documentChanged: keyed,
        state: keyed ? 'keyed-on-frame' : 'changed',
      });
      expect(app.evaluation.channelValues(W.lowerArmL).rz).toBeCloseTo(12 * DEG, 15);
    });
  });

  describe('channel without keys (fk.lowerArm.L rx, no curve)', () => {
    it.each([
      ['force', false, 'keyed-only', 'key'],
      ['auto', true, 'all', 'key'],
      ['auto', true, 'keyed-only', 'static'],
      ['auto', false, 'all', 'static'],
      ['none', true, 'all', 'static'],
    ] as const)('key: %s, auto-key %s (%s) → %s', (policy, autoKey, autoKeyMode, outcome) => {
      const app = waveApp();
      app.prefs.setState({ autoKey, autoKeyMode });
      setFrame(app, 9);
      const result = apply(app, [{ control: W.lowerArmL, channel: 'rx', value: 0.25 }], policy);
      const curve = curveOf(app, W.lowerArmL, 'rx');
      expect(curve).toMatchObject({ weighted: false, pre: 'constant', post: 'constant', locked: false, muted: false });
      const keyed = outcome === 'key';
      expect({
        keyed: result.keyed,
        statics: result.statics,
        keys: curve === undefined ? [] : app.store.query.keysOfCurve(curve.id).map((key) => [key.t, key.v]),
        staticValue: curve?.staticValue,
        state: app.evaluation.channelState(W.lowerArmL, 'rx'),
      }).toEqual({
        keyed: keyed ? 1 : 0,
        statics: keyed ? 0 : 1,
        keys: keyed ? [[9, 0.25]] : [],
        staticValue: keyed ? null : 0.25,
        state: keyed ? 'keyed-on-frame' : 'static',
      });
      expect(result.overrides.size).toBe(0);
      expect(app.evaluation.channelValues(W.lowerArmL).rx).toBe(0.25);
    });

    it('writes the static value of an existing key-less curve without creating another curve', () => {
      const app = waveApp();
      apply(app, [{ control: W.lowerArmL, channel: 'rx', value: 0.1 }], 'none');
      const curve = curveOf(app, W.lowerArmL, 'rx');
      apply(app, [{ control: W.lowerArmL, channel: 'rx', value: 0.2 }], 'auto');
      expect(curveOf(app, W.lowerArmL, 'rx')?.id).toBe(curve?.id);
      expect(app.store.query.curvesOfClip(W.clip)).toHaveLength(2);
      expect(curveOf(app, W.lowerArmL, 'rx')?.staticValue).toBe(0.2);
    });
  });

  it('patches a key within 1e-6 frames and inserts new keys with the default tangents', () => {
    const app = waveApp();
    app.prefs.setState({ defaultTangents: { in: 'linear', out: 'flat' } });
    setFrame(app, 15 + 5e-7);
    apply(app, [{ control: W.lowerArmL, channel: 'rz', value: -40 * DEG }], 'force');
    const at15 = app.store.get('keys', W.keys[1]);
    expect(at15).toMatchObject({ t: 15, v: -40 * DEG, inType: 'auto', outType: 'auto' });
    setFrame(app, 20);
    apply(app, [{ control: W.lowerArmL, channel: 'rz', value: 0 }], 'force');
    const added = app.store.query.keysOfCurve(W.curve).find((key) => key.t === 20);
    expect(added).toMatchObject({
      clip: W.clip,
      curve: W.curve,
      v: 0,
      inType: 'linear',
      outType: 'flat',
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    });
    expect(added?.id).toMatch(/^k_[0-9A-Za-z]{12}$/);
  });

  it('skips locked and non-keyable channels and reports them', () => {
    const app = waveApp();
    edit(app, 'Lock', (tx) =>
      tx.patch('controls', W.lowerArmL, {
        locked: { t: [false, false, false], r: [false, true, false], s: [false, false, false] },
      }),
    );
    const result = apply(
      app,
      [
        { control: W.lowerArmL, channel: 'tx', value: 1 },
        { control: W.lowerArmL, channel: 'ry', value: 1 },
        { control: W.lowerArmL, channel: '@custom', value: 1 },
        { control: W.cog, channel: 'tx', value: 0.5 },
      ],
      'force',
    );
    expect(result.skipped).toEqual([
      { control: W.lowerArmL, channel: 'tx', reason: 'non-keyable' },
      { control: W.lowerArmL, channel: 'ry', reason: 'locked' },
      { control: W.lowerArmL, channel: '@custom', reason: 'non-keyable' },
    ]);
    expect(result.keyed).toBe(1);
    expect(app.evaluation.channelValues(W.cog).tx).toBe(0.5);
  });

  it('throws on unknown controls, non-finite values and characters without an active clip', () => {
    const app = waveApp();
    expect(() => apply(app, [{ control: 'rig_X:nope' as ControlId, channel: 'rz', value: 1 }], 'force')).toThrow(
      EkzaError,
    );
    expect(() => apply(app, [{ control: W.lowerArmL, channel: 'rz', value: Number.NaN }], 'force')).toThrow(EkzaError);
    app.session.setState({ activeClip: {} });
    expect(() => apply(app, [{ control: W.lowerArmL, channel: 'rz', value: 1 }], 'force')).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });

  it('merges overrides per channel and lets keying consume them', () => {
    const app = waveApp();
    apply(app, [{ control: W.handL, channel: 'rz', value: 0 }], 'force'); // key at 0: hand rz is keyed now
    setFrame(app, 5);
    apply(app, [{ control: W.lowerArmL, channel: 'rz', value: 0.1 }], 'none');
    apply(app, [{ control: W.handL, channel: 'rz', value: 0.2 }], 'none');
    expect(app.session.getState().overrides.get(W.lowerArmL)).toEqual({ rz: 0.1 });
    // Keying a channel removes its override; the static write on rx needs no override.
    apply(
      app,
      [
        { control: W.lowerArmL, channel: 'rz', value: 0.3 },
        { control: W.lowerArmL, channel: 'rx', value: 0.4 },
      ],
      'force',
    );
    expect(app.session.getState().overrides.has(W.lowerArmL)).toBe(false);
    expect(app.session.getState().overrides.get(W.handL)).toEqual({ rz: 0.2 });
    expect(app.evaluation.channelValues(W.lowerArmL)).toMatchObject({ rz: 0.3, rx: 0.4 });
  });

  it("keys at each character's own clip frame (24 fps clip in a 30 fps scene)", () => {
    const app = kernelApp({
      snapshot: twoCharacterDoc({ first: { fps: { num: 24, den: 1 }, range: { start: 0, end: 48 } } }),
    });
    setFrame(app, 30);
    apply(app, [{ control: W.lowerArmL, channel: 'rz', value: 0.5 }], 'force');
    expect(app.store.query.keysOfCurve(W.curve).map((key) => key.t)).toEqual([0, 15, 24, 30]);
  });
});

describe('beginChannelEditGesture', () => {
  it('auto-key off on a keyed channel: one override-only step, the document untouched', () => {
    const app = waveApp();
    setFrame(app, 5);
    const before = app.store.snapshot();
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    expect(gesture.active).toBe(true);
    for (const value of [0.1, 0.2, 0.3]) gesture.update([{ control: W.lowerArmL, channel: 'rz', value }]);
    expect(app.session.getState().overrides.get(W.lowerArmL)).toEqual({ rz: 0.3 });
    gesture.commit();
    expect(gesture.active).toBe(false);
    expect(app.store.snapshot()).toEqual(before);
    expect(app.history.peekUndo()).toMatchObject({ label: 'Rotate', docTxId: null });
    // E2E-24 / US-22: Mod+Z restores the pose, keys deep-equal.
    app.history.undo();
    expect(app.session.getState().overrides.size).toBe(0);
    expect(app.store.snapshot()).toEqual(before);
    expect(app.history.canUndo()).toBe(false);
    app.history.redo();
    expect(app.session.getState().overrides.get(W.lowerArmL)).toEqual({ rz: 0.3 });
  });

  it('auto-key on: keys live in the preview and commit as one transaction and one step', () => {
    const app = waveApp();
    app.prefs.setState({ autoKey: true });
    setFrame(app, 20);
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 0.1 }]);
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 0.2 }]);
    expect(app.store.preview?.active).toBe(true);
    expect(wavePoints(app).find(([t]) => t === 20)).toEqual([20, 0.2]);
    expect(app.store.undo.canUndo()).toBe(false);
    gesture.commit();
    expect(app.store.preview).toBeNull();
    expect(app.history.peekUndo()?.docTxId).toBe(app.store.undo.peekUndo()?.txId);
    app.history.undo();
    expect(wavePoints(app).map(([t]) => t)).toEqual([0, 15, 30]);
    expect(app.history.canUndo()).toBe(false);
  });

  it('records doc and override parts of one drag over keyed and unkeyed channels as one step', () => {
    const app = waveApp();
    setFrame(app, 5);
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([
      { control: W.lowerArmL, channel: 'rz', value: 0.5 },
      { control: W.lowerArmL, channel: 'rx', value: 0.25 },
    ]);
    gesture.commit();
    const step = app.history.peekUndo();
    expect(step?.docTxId).not.toBeNull();
    expect(step?.overrides?.after.get(W.lowerArmL)).toEqual({ rz: 0.5 });
    app.history.undo();
    expect(app.evaluation.channelValues(W.lowerArmL).rx).toBe(0);
    expect(app.session.getState().overrides.size).toBe(0);
  });

  it('cancel restores the document and the overrides and records nothing', () => {
    const app = waveApp();
    app.prefs.setState({ autoKey: true });
    app.session.setState({ overrides: new Map([[W.handL, { rz: 0.7 }]]) });
    const before = app.store.snapshot();
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 1 }]);
    gesture.update([{ control: W.handL, channel: 'rz', value: 0.9 }]);
    gesture.cancel();
    expect(app.store.snapshot()).toEqual(before);
    expect(app.store.preview).toBeNull();
    expect(app.session.getState().overrides.get(W.handL)).toEqual({ rz: 0.7 });
    expect(app.history.canUndo()).toBe(false);
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 2 }]); // ignored after the end
    gesture.commit();
    expect(app.history.canUndo()).toBe(false);
  });

  it('ends itself when someone cancels its preview (Esc), restoring the overrides', () => {
    const app = waveApp();
    setFrame(app, 5);
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 0.4 }]);
    gesture.update([{ control: W.lowerArmL, channel: 'rx', value: 0.4 }]); // static value: the preview has changes
    app.store.preview?.cancel();
    expect(gesture.active).toBe(false);
    expect(app.session.getState().overrides.size).toBe(0);
    gesture.commit();
    expect(app.history.canUndo()).toBe(false);
  });

  it('is cancelled by cancelChannelEditGestures (edit.escape), also when it only changed overrides', () => {
    const app = waveApp();
    setFrame(app, 5);
    expect(cancelChannelEditGestures(app)).toBe(false);
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: W.lowerArmL, channel: 'rz', value: 0.4 }]); // override only: the preview is empty
    expect(cancelChannelEditGestures(app)).toBe(true);
    expect(gesture.active).toBe(false);
    expect(app.store.preview).toBeNull();
    expect(app.session.getState().overrides.size).toBe(0);
    expect(cancelChannelEditGestures(app)).toBe(false);
  });

  it('blocks operators while active and refuses a second preview', async () => {
    const app = waveApp();
    addOperator(app, { id: 'test.op', label: 'Op', category: 'test', scope: 'global', apply: () => 1 });
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'none' });
    expect(await app.runUntyped('test.op')).toEqual({ status: 'cancelled', reason: 'gesture in progress' });
    expect(() => beginChannelEditGesture(app, 'Other', { key: 'none' })).toThrow(
      expect.objectContaining({ code: 'preview-active' }),
    );
    gesture.commit();
    expect((await app.runUntyped('test.op')).status).toBe('finished');
  });

  it('toasts once for skipped channels on commit', () => {
    const { app, services } = waveAppWithServices();
    const gesture = beginChannelEditGesture(app, 'Move', { key: 'auto' });
    gesture.update([{ control: W.lowerArmL, channel: 'tx', value: 1 }]);
    gesture.update([{ control: W.lowerArmL, channel: 'tx', value: 2 }]);
    gesture.commit();
    expect(services.toasts).toEqual([{ kind: 'warning', text: '1 locked or non-keyable channel(s) were not changed' }]);
    expect(app.history.canUndo()).toBe(false);
  });
});
