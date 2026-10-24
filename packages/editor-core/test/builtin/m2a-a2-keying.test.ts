// M2A-SPEC §5.1 rules 1–6, §5.12, §5.19 (A2): attribute channels through the edit kernel, `key.set` with the
// `keyAll` rule (explicit only as channels selected in the Channels panel), body-part keying, breakdown keys,
// `key.setTarget`, `pose.resetToRest`, the pose clipboard and mirror with attributes, locks and Delete at frame.
import type { ChannelId, ControlId, DocSnapshot } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { applyChannelEdits, keyTargetControls } from '../../src';
import type { EditorApp } from '../../src/types';
import { cid, ikApp, ikWaveDoc } from './ikFixture';
import { DEG, expectUndoRedoExact, runOk, runResult, setSceneFrame, WAVE } from './support';

function select(app: EditorApp, keys: readonly string[], channels: readonly [string, ChannelId][] = []): void {
  app.session.setState({
    selection: {
      ...app.session.getState().selection,
      controls: keys.map(cid),
      channels: channels.map(([key, channel]) => ({ control: cid(key), channel })),
    },
  });
}

/** Channels with a key at `frame`, per control template key (active clip, base layer). */
function keyedAt(app: EditorApp, frame: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const curve of app.store.query.curvesOfClip(WAVE.clip)) {
    // The fixture's own wave curve (fk.lowerArm.L rz, keys at 0/15/30) is not part of these scenarios.
    if (curve.id === WAVE.curve) continue;
    if (!app.store.query.keysOfCurve(curve.id).some((key) => Math.abs(key.t - frame) < 1e-6)) continue;
    const control = app.store.get('controls', curve.control);
    if (control === undefined) continue;
    (out[control.key] ??= []).push(curve.channel);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

function keysOf(app: EditorApp, control: ControlId, channel: ChannelId) {
  const curve = app.store.query.curveFor(WAVE.clip, WAVE.layer, control, channel);
  return curve === undefined ? [] : app.store.query.keysOfCurve(curve.id);
}

const IK_FOOT_ALL = ['@bank', '@heelTwist', '@roll', '@toeTwist', '@twist', 'rx', 'ry', 'rz', 'tx', 'ty', 'tz'];

describe('attribute channels in the edit kernel (§5.1 rules 1–3)', () => {
  it('applyChannelEdits writes statics, overrides and keys on attributes; channelState reports them', async () => {
    const { app } = ikApp();
    const roll = cid('ik.leg.L');
    expect(app.evaluation.channelState(roll, '@roll')).toBe('static');
    expect(app.evaluation.channelState(roll, '@nope')).toBe('non-keyable');
    await runOk(app, 'channel.setValues', { edits: [{ control: roll, channel: '@roll', value: 20 * DEG }] });
    expect(app.evaluation.channelValue(roll, '@roll')).toBeCloseTo(20 * DEG, 12);
    expect(app.store.query.curveFor(WAVE.clip, WAVE.layer, roll, '@roll')?.staticValue).toBeCloseTo(20 * DEG, 12);
    await runOk(app, 'channel.setValues', {
      edits: [{ control: roll, channel: '@roll', value: 10 * DEG }],
      key: 'force',
    });
    expect(app.evaluation.channelState(roll, '@roll')).toBe('keyed-on-frame');
    setSceneFrame(app, 3);
    expect(app.evaluation.channelState(roll, '@roll')).toBe('keyed');
    await runOk(app, 'channel.setValues', { edits: [{ control: roll, channel: '@roll', value: 5 * DEG }] });
    expect(app.evaluation.channelState(roll, '@roll')).toBe('changed');
    expect(app.session.getState().overrides.get(roll)).toEqual({ '@roll': 5 * DEG });
    // Unknown attributes and attributes of controls without them are non-keyable and skipped.
    const result = await runOk(app, 'channel.setValues', {
      edits: [{ control: cid('fk.hand.L'), channel: '@roll', value: 1 }],
    });
    expect(result).toMatchObject({ skipped: [{ channel: '@roll', reason: 'non-keyable' }] });
  });

  it('a new key on a stepped attribute (ikFk) gets in flat, out step; other attributes the default tangents', async () => {
    const { app } = ikApp();
    const ik = cid('ik.leg.L');
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: '@ikFk', value: 0 },
        { control: ik, channel: '@twist', value: 0.1 },
      ],
      key: 'force',
    });
    expect(keysOf(app, ik, '@ikFk')).toMatchObject([{ t: 0, v: 0, inType: 'flat', outType: 'step' }]);
    expect(keysOf(app, ik, '@twist')).toMatchObject([{ t: 0, v: 0.1, inType: 'auto', outType: 'auto' }]);
  });

  it('channel.toggleLock skips attribute rows and refuses a selection of attributes only', async () => {
    const { app } = ikApp();
    const ik = cid('ik.leg.L');
    expect(await runResult(app, 'channel.toggleLock', { refs: [{ control: ik, channel: '@roll' }] })).toEqual({
      status: 'cancelled',
      reason: 'Attributes cannot be locked',
    });
    await runOk(app, 'channel.toggleLock', {
      refs: [
        { control: ik, channel: '@roll' },
        { control: ik, channel: 'tx' },
      ],
    });
    expect(app.store.get('controls', ik)?.locked.t).toEqual([true, false, false]);
    expect((await runResult(app, 'channel.toggleLock', { refs: [{ control: ik, channel: 'qq' }] })).status).toBe(
      'cancelled',
    );
  });
});

describe('key.set and the keyAll rule (§5.1 rule 4)', () => {
  it('S on the IK foot keys t, r and five attributes, never @ikFk or @soft', async () => {
    const { app } = ikApp();
    select(app, ['ik.leg.L']);
    const { value } = await expectUndoRedoExact(app, 'key.set');
    expect(value).toEqual({ count: 11 });
    expect(keyedAt(app, 0)).toMatchObject({ 'ik.leg.L': IK_FOOT_ALL });
    expect(app.history.peekUndo()?.label).toBe('Set Key');
  });

  it("'attributes' keys the same five; 'translate', 'rotate' and 'scale' never key attributes", async () => {
    const { app } = ikApp();
    select(app, ['ik.leg.L']);
    await runOk(app, 'key.set', { channels: 'attributes' });
    expect(keyedAt(app, 0)['ik.leg.L']).toEqual(['@bank', '@heelTwist', '@roll', '@toeTwist', '@twist']);
    expect(app.history.peekUndo()?.label).toBe('Key Attributes');
    setSceneFrame(app, 4);
    await runOk(app, 'key.set', { channels: 'translate' });
    expect(keyedAt(app, 4)['ik.leg.L']).toEqual(['tx', 'ty', 'tz']);
  });

  it('with @ikFk a channel selected in the Channels panel, S keys it (all, attributes, selected)', async () => {
    const { app } = ikApp();
    select(app, ['ik.leg.L'], [['ik.leg.L', '@ikFk']]);
    await runOk(app, 'key.set');
    expect(keyedAt(app, 0)['ik.leg.L']).toEqual(['@ikFk', ...IK_FOOT_ALL].sort());
    expect(keysOf(app, cid('ik.leg.L'), '@ikFk')).toMatchObject([{ v: 1, outType: 'step' }]);
    setSceneFrame(app, 2);
    await runOk(app, 'key.set', { channels: 'selected' });
    expect(keyedAt(app, 2)['ik.leg.L']).toEqual(['@ikFk']);
    setSceneFrame(app, 3);
    await runOk(app, 'key.set', { channels: 'attributes' });
    expect(keyedAt(app, 3)['ik.leg.L']).toEqual(['@bank', '@heelTwist', '@ikFk', '@roll', '@toeTwist', '@twist']);
  });

  it('the IK/FK proxy channel keys the limb IK control while an FK control of the limb is selected', async () => {
    const { app } = ikApp();
    select(app, ['fk.upperArm.L'], [['ik.arm.L', '@ikFk']]);
    await runOk(app, 'key.set');
    expect(keyedAt(app, 0)).toEqual({
      'fk.upperArm.L': ['rx', 'ry', 'rz'],
      'ik.arm.L': ['@ikFk'],
    });
    // Without the limb among the targets, a stray ref keys nothing extra.
    setSceneFrame(app, 5);
    select(app, ['fk.hips'], [['ik.arm.L', '@ikFk']]);
    await runOk(app, 'key.set');
    expect(Object.keys(keyedAt(app, 5))).toEqual(['fk.hips']);
  });

  it("'selected' with no keyable selected channel poll-fails", async () => {
    const { app } = ikApp();
    select(app, ['ik.leg.L']);
    expect(await runResult(app, 'key.set', { channels: 'selected' })).toEqual({
      status: 'cancelled',
      reason: 'No keyable channels are selected',
    });
    select(app, ['ik.leg.L'], [['ik.leg.L', '@soft']]);
    expect((await runResult(app, 'key.set', { channels: 'selected' })).status).toBe('finished');
    expect(keyedAt(app, 0)['ik.leg.L']).toEqual(['@soft']);
  });

  it('breakdown: true creates breakdown keys and turns keys at the frame into breakdowns (Set Breakdown)', async () => {
    const { app } = ikApp();
    select(app, ['fk.lowerArm.L']);
    setSceneFrame(app, 15);
    // The wave key at 15 exists: it becomes a breakdown; the other rotation channels get new breakdown keys.
    await expectUndoRedoExact(app, 'key.set', { breakdown: true });
    expect(app.history.peekUndo()?.label).toBe('Set Breakdown');
    const at15 = ['rx', 'ry', 'rz'].map((channel) =>
      keysOf(app, WAVE.lowerArmL, channel as ChannelId).find((key) => key.t === 15),
    );
    for (const key of at15) expect(key?.breakdown).toBe(true);
    // A plain S keeps the flag of a key already at the frame (tween patches keep it too).
    await runOk(app, 'key.set');
    expect(keysOf(app, WAVE.lowerArmL, 'rz').find((key) => key.t === 15)?.breakdown).toBe(true);
    expect(keysOf(app, WAVE.lowerArmL, 'rz').find((key) => key.t === 0)?.breakdown).toBeUndefined();
    expect(await runResult(app, 'key.set', { breakdown: 'yes' })).toMatchObject({ status: 'cancelled' });
  });
});

describe('body-part keying and key.setTarget (§5.19)', () => {
  it("S with fk.hand.L selected and target 'bodyPart' keys exactly the arm.L controls", async () => {
    const { app } = ikApp();
    select(app, ['fk.hand.L']);
    await runOk(app, 'key.setTarget', { target: 'bodyPart' });
    expect(app.session.getState().tools.keyTarget).toBe('bodyPart');
    expect(app.history.canUndo()).toBe(false);
    await runOk(app, 'key.set');
    const keyed = keyedAt(app, 0);
    expect(Object.keys(keyed).sort()).toEqual(
      ['fk.hand.L', 'fk.lowerArm.L', 'fk.shoulder.L', 'fk.upperArm.L', 'ik.arm.L', 'pole.arm.L'].sort(),
    );
    // keyAll: false attributes are not keyed by body part; the hidden IK arm control is keyed (rule 1 only).
    expect(keyed['ik.arm.L']).toEqual(['@twist', 'rx', 'ry', 'rz', 'tx', 'ty', 'tz']);
    expect(keyed['pole.arm.L']).toEqual(['tx', 'ty', 'tz']);
  });

  it("legs: 'bodyPart' from the IK foot keys the whole leg (FK chain hidden by IK too)", async () => {
    const { app } = ikApp();
    select(app, ['ik.leg.R']);
    await runOk(app, 'key.set', { target: 'bodyPart' });
    expect(Object.keys(keyedAt(app, 0)).sort()).toEqual(
      ['fk.foot.R', 'fk.lowerLeg.R', 'fk.toes.R', 'fk.upperLeg.R', 'ik.leg.R', 'pole.leg.R'].sort(),
    );
    expect(keyTargetControls(app, 'bodyPart')).toHaveLength(6);
  });

  it('key.setTarget validates its target', async () => {
    const { app } = ikApp();
    expect((await runResult(app, 'key.setTarget', { target: 'limb' })).status).toBe('cancelled');
    await runOk(app, 'key.setTarget', { target: 'character' });
    expect(app.session.getState().tools.keyTarget).toBe('character');
    await runOk(app, 'key.setTarget', { target: 'selected' });
    expect(app.session.getState().tools.keyTarget).toBe('selected');
  });

  it('on a generic rig body-part keying keys the selected controls and says so once', async () => {
    const doc = ikWaveDoc() as unknown as { tables: { rigs: Record<string, { generator: { name: string } }> } };
    const rig = doc.tables.rigs[WAVE.rig];
    if (rig !== undefined) rig.generator.name = 'ekza-autorig-generic';
    const { app, services } = ikApp({ snapshot: doc as unknown as DocSnapshot });
    select(app, ['fk.hand.L']);
    await runOk(app, 'key.set', { target: 'bodyPart' });
    expect(Object.keys(keyedAt(app, 0))).toEqual(['fk.hand.L']);
    setSceneFrame(app, 2);
    await runOk(app, 'key.set', { target: 'bodyPart' });
    expect(services.toasts.filter((toast) => /no body parts/.test(toast.text))).toHaveLength(1);
  });
});

describe('pose tools with attributes (§5.1 rule 6, §5.8)', () => {
  it('pose.resetToRest resets pose attributes to their defaults and leaves ikFk and soft alone', async () => {
    const { app } = ikApp();
    const ik = cid('ik.leg.L');
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: '@roll', value: 0.3 },
        { control: ik, channel: '@twist', value: -0.2 },
        { control: ik, channel: '@ikFk', value: 0.25 },
        { control: ik, channel: '@soft', value: 0.1 },
        { control: ik, channel: 'ty', value: 0.05 },
      ],
    });
    select(app, ['ik.leg.L']);
    await expectUndoRedoExact(app, 'pose.resetToRest');
    expect(app.evaluation.attrValues(ik)).toMatchObject({ roll: 0, twist: 0, ikFk: 0.25, soft: 0.1 });
    expect(app.evaluation.channelValues(ik).ty).toBe(0);
    // Channels selected in the Channels panel do not change that (rule 6: a reset never flips a limb between IK and FK;
    // the selected-channel exception of rule 4 is for keying and the clipboard).
    await runOk(app, 'channel.setValues', { edits: [{ control: ik, channel: '@roll', value: 0.2 }] });
    select(
      app,
      ['ik.leg.L'],
      [
        ['ik.leg.L', '@ikFk'],
        ['ik.leg.L', '@soft'],
        ['ik.leg.L', '@roll'],
      ],
    );
    await runOk(app, 'pose.resetToRest');
    expect(app.evaluation.attrValues(ik)).toMatchObject({ roll: 0, ikFk: 0.25, soft: 0.1 });
  });

  it('the pose clipboard carries attributes except keyAll: false ones; paste writes them', async () => {
    const { app } = ikApp();
    const ik = cid('ik.leg.L');
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: '@roll', value: 0.3 },
        { control: ik, channel: '@ikFk', value: 0.4 },
        { control: ik, channel: 'tx', value: 0.1 },
      ],
    });
    select(app, ['ik.leg.L']);
    await runOk(app, 'pose.copy');
    const entry = app.session.getState().clipboard.pose?.controls['ik.leg.L'];
    expect(entry?.values).toMatchObject({ tx: 0.1, '@roll': 0.3 });
    expect(entry?.values).not.toHaveProperty('@ikFk');
    await runOk(app, 'pose.resetToRest');
    await runOk(app, 'channel.setValues', { edits: [{ control: ik, channel: '@ikFk', value: 1 }] });
    await runOk(app, 'pose.paste');
    expect(app.evaluation.attrValues(ik)).toMatchObject({ roll: 0.3, ikFk: 1 });
    expect(app.evaluation.channelValues(ik).tx).toBeCloseTo(0.1, 12);
  });

  it('a selected keyAll: false channel rides the clipboard both ways (copy and paste, §5.1 rule 4)', async () => {
    const { app } = ikApp();
    const ik = cid('ik.leg.L');
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: '@roll', value: 0.3 },
        { control: ik, channel: '@ikFk', value: 0.4 },
        { control: ik, channel: '@soft', value: 0.05 },
      ],
    });
    select(app, ['ik.leg.L'], [['ik.leg.L', '@ikFk']]);
    await runOk(app, 'pose.copy');
    const entry = app.session.getState().clipboard.pose?.controls['ik.leg.L'];
    expect(entry?.values).toMatchObject({ '@roll': 0.3, '@ikFk': 0.4 });
    expect(entry?.values).not.toHaveProperty('@soft');
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: '@roll', value: 0 },
        { control: ik, channel: '@ikFk', value: 1 },
        { control: ik, channel: '@soft', value: 0.2 },
      ],
    });
    // Still selected on the target control: the paste writes it back.
    await expectUndoRedoExact(app, 'pose.paste');
    expect(app.evaluation.attrValues(ik)).toMatchObject({ roll: 0.3, ikFk: 0.4, soft: 0.2 });
    // Not selected any more: the paste leaves the limb mode alone.
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: ik, channel: '@roll', value: 0 },
        { control: ik, channel: '@ikFk', value: 1 },
      ],
    });
    select(app, ['ik.leg.L']);
    await runOk(app, 'pose.paste');
    expect(app.evaluation.attrValues(ik)).toMatchObject({ roll: 0.3, ikFk: 1 });
  });

  it('mirror maps attributes by AttrDef.mirror and carries ikFk (copy)', async () => {
    const { app } = ikApp();
    const left = cid('ik.leg.L');
    const right = cid('ik.leg.R');
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: left, channel: '@roll', value: 0.3 },
        { control: left, channel: '@bank', value: 0.2 },
        { control: left, channel: '@twist', value: 0.1 },
        { control: left, channel: '@heelTwist', value: 0.05 },
        { control: left, channel: '@ikFk', value: 0.5 },
      ],
    });
    select(app, ['ik.leg.L']);
    await runOk(app, 'pose.mirror', { mode: 'leftToRight' });
    expect(app.evaluation.attrValues(right)).toMatchObject({
      roll: 0.3,
      bank: 0.2,
      twist: -0.1,
      heelTwist: -0.05,
      ikFk: 0.5,
    });
    expect(app.evaluation.attrValues(left)).toMatchObject({ roll: 0.3, twist: 0.1 });
    await runOk(app, 'pose.mirror', { mode: 'flip' });
    expect(app.evaluation.attrValues(left)).toMatchObject({ twist: 0.1, heelTwist: 0.05 });
  });

  it('key.deleteAtFrame removes attribute keys but keeps the limb mode keys unless @ikFk is selected', async () => {
    const { app } = ikApp();
    select(app, ['ik.leg.L'], [['ik.leg.L', '@ikFk']]);
    await runOk(app, 'key.set');
    select(app, ['ik.leg.L']);
    await runOk(app, 'key.deleteAtFrame');
    expect(keyedAt(app, 0)['ik.leg.L']).toEqual(['@ikFk']);
    select(app, ['ik.leg.L'], [['ik.leg.L', '@ikFk']]);
    await runOk(app, 'key.deleteAtFrame');
    expect(keyedAt(app, 0)['ik.leg.L']).toBeUndefined();
  });

  it('applyChannelEdits leaves attribute values unclamped (ranges apply where values are produced)', () => {
    const { app } = ikApp();
    const ik = cid('ik.leg.L');
    app.store.transact({ label: 'test' }, (tx) => {
      applyChannelEdits(app, tx, [{ control: ik, channel: '@soft', value: 2 }], { key: 'auto' });
    });
    expect(app.evaluation.channelValue(ik, '@soft')).toBe(2);
  });
});
