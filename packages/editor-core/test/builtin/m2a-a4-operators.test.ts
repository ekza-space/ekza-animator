// A4 operators (M2A-SPEC §4.9): `key.tween` (§5.13, the E2E-M2A-13 numbers), `key.convert` (§5.12),
// `graph.buffer.snapshot/swap/clear` (§5.15.1) and `pose.mirrorAnimation` (§5.14: channel rule, the half-cycle
// procedure with its gate, flip involution, scope rules, secondary controls), each with poll, apply and undo/redo.
import { type AnimCurve, curveEngine, type KeyData, type TangentType } from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, CurveId, KeyId, KeyRecord } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { internalsOf } from '../../src/app/internals';
import { ensureCurve } from '../../src/edit/keys';
import { beginTweenGesture } from '../../src/edit/tween';
import type { EditorApp } from '../../src/types';
import { halfCycleKeys, mirrorSign } from '../../src/workflows/mirrorAnimation';
import {
  DEG,
  docJson,
  expectUndoRedoExact,
  opsApp,
  opsAppWith,
  READY,
  runOk,
  runResult,
  setSceneFrame,
  WAVE,
} from './support';

const HAND = WAVE.handL;
const UPPER_L = WAVE.upperArmL;
const UPPER_R = `${WAVE.rig}:fk.upperArm.R` as ControlId;
const LOWER_R = `${WAVE.rig}:fk.lowerArm.R` as ControlId;
const INDEX_L = `${WAVE.rig}:fk.indexProximal.L` as ControlId;

type KeySpec = readonly [t: number, v: number, type?: TangentType];

function curveWith(
  app: EditorApp,
  control: ControlId,
  channel: ChannelId,
  keys: readonly KeySpec[],
): {
  readonly curve: CurveId;
  readonly keys: readonly KeyId[];
} {
  return app.store.transact({ label: 'setup' }, (tx) => {
    const curve = ensureCurve(app, tx, WAVE.clip, control, channel);
    for (const key of tx.query.keysOfCurve(curve)) tx.remove('keys', key.id);
    const ids = keys.map(([t, v, type], i) => {
      const id =
        `k_${control.slice(-6).replace(/\W/g, '')}${channel.replace('@', 'a')}${String(i).padStart(4, '0')}` as KeyId;
      tx.put('keys', {
        id,
        clip: WAVE.clip,
        curve,
        t,
        v,
        inType: type ?? 'linear',
        outType: type ?? 'linear',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
      });
      return id;
    });
    return { curve, keys: ids };
  });
}

function select(app: EditorApp, controls: readonly ControlId[], keys: readonly KeyId[] = []): void {
  const selection = app.session.getState().selection;
  app.session.setState({
    selection: {
      ...selection,
      controls,
      keys: new Map(keys.map((key) => [key, { key: true, in: false, out: false }])),
    },
  });
}

function keyAt(app: EditorApp, curve: CurveId, t: number): KeyRecord | undefined {
  return app.store.query.keysOfCurve(curve).find((key) => Math.abs(key.t - t) < 1e-6);
}

function curveOf(app: EditorApp, control: ControlId, channel: ChannelId) {
  const layer = app.store.query.baseLayer(WAVE.clip);
  return layer === undefined ? undefined : app.store.query.curveFor(WAVE.clip, layer.id, control, channel);
}

/** Value of a control channel's curve at a clip frame (the app's engine). */
function valueAt(app: EditorApp, control: ControlId, channel: ChannelId, t: number): number {
  const curve = curveOf(app, control, channel);
  if (curve === undefined) throw new Error(`no ${channel} curve on ${control}`);
  return internalsOf(app).deps.curves.engine.evaluate(app.evaluation.compiledCurve(curve.id), t);
}

/** Keys of a channel without ids (content comparison across rewrites). */
function contentOf(app: EditorApp, control: ControlId, channel: ChannelId) {
  const curve = curveOf(app, control, channel);
  if (curve === undefined) return null;
  return {
    pre: curve.pre,
    post: curve.post,
    weighted: curve.weighted,
    staticValue: curve.staticValue,
    keys: app.store.query.keysOfCurve(curve.id).map(({ id: _id, clip: _clip, curve: _curve, ...data }) => data),
  };
}

function setClip(app: EditorApp, patch: { range?: { start: number; end: number }; loop?: boolean }): void {
  app.store.transact({ label: 'clip' }, (tx) => tx.patch('clips', WAVE.clip, patch));
}

/** Makes both upper arms translate too, like the world-aligned IK controls (the fixture's FK arms rotate only). */
function translatableArms(app: EditorApp): void {
  app.store.transact({ label: 'keyable' }, (tx) => {
    for (const id of [UPPER_L, UPPER_R]) {
      const control = tx.get('controls', id);
      if (control !== undefined) tx.patch('controls', id, { keyable: { ...control.keyable, t: [true, true, true] } });
    }
  });
}

describe('key.tween (§5.13, E2E-M2A-13 numbers)', () => {
  function setup() {
    const { app, services } = opsAppWith();
    const c = curveWith(app, HAND, 'rz', [
      [0, 0],
      [20, 60 * DEG],
    ]);
    select(app, [HAND]);
    setSceneFrame(app, 10);
    return { app, services, c };
  }

  it('tween 50 sets a breakdown key with 45° at the frame; one step, undo/redo exact', async () => {
    const { app, c } = setup();
    const { value } = await expectUndoRedoExact(app, 'key.tween', { mode: 'tween', amount: 50 });
    expect(value).toEqual({ count: 1 });
    const key = keyAt(app, c.curve, 10);
    expect((key?.v ?? 0) / DEG).toBeCloseTo(45, 9);
    expect(key?.breakdown).toBe(true);
    expect(app.history.peekUndo()?.label).toBe('Tween');
  });

  it('every mode from a fresh setup; overshoot by preference; pushPull after a tween', async () => {
    const cases: readonly [string, number, number, boolean][] = [
      ['tween', 125, 67.5, true],
      ['tween', 125, 60, false],
      ['neighbor', -50, 15, false],
      ['ease', -50, 60 * 0.5 ** 2.5, false],
      ['toDefault', 50, 15, false],
    ];
    for (const [mode, amount, expected, overshoot] of cases) {
      const { app, c } = setup();
      app.prefs.setState({ tweenOvershoot: overshoot });
      await runOk(app, 'key.tween', { mode, amount });
      expect([mode, amount, (keyAt(app, c.curve, 10)?.v ?? 0) / DEG]).toEqual([
        mode,
        amount,
        expect.closeTo(expected, 9),
      ]);
    }
    const { app, c } = setup();
    await runOk(app, 'key.tween', { mode: 'tween', amount: 50 });
    await runOk(app, 'key.tween', { mode: 'pushPull', amount: 100 });
    expect((keyAt(app, c.curve, 10)?.v ?? 0) / DEG).toBeCloseTo(60, 9);
    expect(app.history.peekUndo()?.label).toBe('Push/Pull');
  });

  it('target keys changes selected keys in place; breakdown false makes a plain key; overrides of keyed channels go', async () => {
    const { app, c } = setup();
    const mid = curveWith(app, HAND, 'rx', [
      [0, 0],
      [10, 3],
      [20, 0],
    ]);
    select(app, [HAND], [mid.keys[1] as KeyId]);
    await runOk(app, 'key.tween', { mode: 'tween', amount: 0 });
    expect(app.store.get('keys', mid.keys[1] as KeyId)?.v).toBe(0);
    expect(keyAt(app, c.curve, 10)).toBeUndefined(); // keys target: no key at the frame
    app.session.setState({ overrides: new Map([[HAND, { rz: 1 }]]) });
    await runOk(app, 'key.tween', { mode: 'tween', amount: 0, target: 'frame', breakdown: false });
    expect(keyAt(app, c.curve, 10)?.breakdown).toBeUndefined();
    expect(app.session.getState().overrides.get(HAND)).toBeUndefined();
  });

  it('a slider drag that keys an overridden channel: undo brings the override and the pose back, redo drops it', async () => {
    for (const form of ['slider', 'operator'] as const) {
      const { app, c } = setup();
      await runOk(app, 'channel.setValues', {
        edits: [{ control: HAND, channel: 'rz', value: 40 * DEG }],
        key: 'none',
      });
      expect(app.evaluation.channelValue(HAND, 'rz') / DEG).toBeCloseTo(40, 9);
      let written: unknown;
      if (form === 'slider') {
        const gesture = beginTweenGesture(app, { mode: 'neighbor' });
        gesture.update(0);
        written = gesture.commit(0);
      } else {
        written = ((await runOk(app, 'key.tween', { mode: 'neighbor', amount: 0 })) as { count: number }).count;
      }
      expect(written).toBe(1);
      expect([form, (keyAt(app, c.curve, 10)?.v ?? 0) / DEG]).toEqual([form, expect.closeTo(40, 9)]);
      expect(app.session.getState().overrides.get(HAND)).toBeUndefined();
      const doc = docJson(app);
      const label = form === 'slider' ? 'Tween' : 'Blend to Neighbour';
      expect(app.history.undo()?.label).toBe(label);
      expect(keyAt(app, c.curve, 10)).toBeUndefined();
      expect([form, app.session.getState().overrides.get(HAND)?.rz]).toEqual([form, 40 * DEG]);
      expect([form, app.evaluation.channelValue(HAND, 'rz') / DEG]).toEqual([form, expect.closeTo(40, 9)]);
      expect(app.history.redo()?.label).toBe(label);
      expect(docJson(app)).toEqual(doc);
      expect(app.session.getState().overrides.get(HAND)).toBeUndefined();
      // The step before it is the typed edit: undoing both returns to the curve's 30°.
      app.history.undo();
      expect(app.history.undo()).not.toBeNull();
      expect([form, app.evaluation.channelValue(HAND, 'rz') / DEG]).toEqual([form, expect.closeTo(30, 9)]);
    }
  });

  it('poll: argument shapes, read-only and nothing to tween', async () => {
    const { app } = setup();
    expect(await runResult(app, 'key.tween', { mode: 'warp', amount: 1 })).toMatchObject({ status: 'cancelled' });
    expect(await runResult(app, 'key.tween', { mode: 'tween', amount: Number.NaN })).toMatchObject({
      status: 'cancelled',
    });
    expect(await runResult(app, 'key.tween', { mode: 'tween', amount: 0, target: 'curve' })).toMatchObject({
      status: 'cancelled',
    });
    setSceneFrame(app, 25);
    expect(await runResult(app, 'key.tween', { mode: 'tween', amount: 0 })).toEqual({
      status: 'cancelled',
      reason: 'Nothing to tween: no keyed channel has keys before and after f25',
    });
  });
});

describe('key.convert (§5.12)', () => {
  it('turns the selected keys into breakdowns and back; undo/redo exact', async () => {
    const app = opsApp();
    const c = curveWith(app, HAND, 'rz', [
      [0, 0],
      [10, 1],
      [20, 0],
    ]);
    select(app, [HAND], [c.keys[1] as KeyId]);
    const { value } = await expectUndoRedoExact(app, 'key.convert', { to: 'breakdown' });
    expect(value).toEqual({ count: 1 });
    expect(app.store.get('keys', c.keys[1] as KeyId)?.breakdown).toBe(true);
    expect(app.history.peekUndo()?.label).toBe('Convert to Breakdown');
    await runOk(app, 'key.convert', { to: 'key' });
    expect(Object.hasOwn(app.store.get('keys', c.keys[1] as KeyId) ?? {}, 'breakdown')).toBe(false);
    expect(app.history.peekUndo()?.label).toBe('Convert to Key');
  });

  it("without selected keys: the key target controls' keys at the current frame", async () => {
    const app = opsApp();
    const a = curveWith(app, HAND, 'rz', [
      [0, 0],
      [10, 1],
    ]);
    const b = curveWith(app, HAND, 'rx', [
      [0, 0],
      [10, 1],
    ]);
    select(app, [HAND]);
    setSceneFrame(app, 10);
    expect(await runOk(app, 'key.convert', { to: 'breakdown' })).toEqual({ count: 2 });
    expect([keyAt(app, a.curve, 10)?.breakdown, keyAt(app, b.curve, 10)?.breakdown]).toEqual([true, true]);
    expect(keyAt(app, a.curve, 0)?.breakdown).toBeUndefined();
    setSceneFrame(app, 5);
    expect(await runResult(app, 'key.convert', { to: 'breakdown' })).toEqual({
      status: 'cancelled',
      reason: 'No keys are selected or at the current frame',
    });
    expect((await runResult(app, 'key.convert', { to: 'both' })).status).toBe('cancelled');
  });
});

describe('graph.buffer.* (§5.15.1)', () => {
  it('snapshot, edit, swap restores the snapshot, swap again the edit; undo restores the document, not buffers', async () => {
    const app = opsApp();
    const original = contentOf(app, WAVE.lowerArmL, 'rz');
    expect(await runOk(app, 'graph.buffer.snapshot')).toEqual({ count: 1 });
    const buffer = app.session.getState().curveBuffers.get(WAVE.curve);
    expect(buffer?.curve.keys.map((k) => k.v)).toEqual(original?.keys.map((k) => k.v));
    // Edit the key at 15 to −45°.
    select(app, [WAVE.lowerArmL], [WAVE.keys[1]]);
    await runOk(app, 'graph.keys.setFields', { value: -45 });
    const edited = contentOf(app, WAVE.lowerArmL, 'rz');
    select(app, [WAVE.lowerArmL]);
    await expectUndoRedoExact(app, 'graph.buffer.swap');
    // expectUndoRedoExact swapped back and forth through the history: the buffers are U state and stay swapped once.
    expect(contentOf(app, WAVE.lowerArmL, 'rz')).toEqual(original);
    expect(app.history.peekUndo()?.label).toBe('Swap Buffer Curves');
    await runOk(app, 'graph.buffer.swap');
    expect(contentOf(app, WAVE.lowerArmL, 'rz')).toEqual(edited);
    await runOk(app, 'graph.buffer.swap');
    expect(contentOf(app, WAVE.lowerArmL, 'rz')).toEqual(original);
  });

  it('swap carries weighting and infinities; clear forgets; a deleted curve drops its buffer', async () => {
    const app = opsApp();
    await runOk(app, 'graph.buffer.snapshot', { curves: [WAVE.curve] });
    app.store.transact({ label: 'edit' }, (tx) => tx.patch('curves', WAVE.curve, { weighted: true, post: 'cycle' }));
    await runOk(app, 'graph.buffer.swap', { curves: [WAVE.curve] });
    expect(app.store.get('curves', WAVE.curve)).toMatchObject({ weighted: false, post: 'constant' });
    expect(app.session.getState().curveBuffers.get(WAVE.curve)?.curve).toMatchObject({ weighted: true, post: 'cycle' });
    await runOk(app, 'graph.buffer.clear');
    expect(app.session.getState().curveBuffers.size).toBe(0);
    expect((await runResult(app, 'graph.buffer.clear')).status).toBe('cancelled');
    expect(await runResult(app, 'graph.buffer.swap')).toEqual({
      status: 'cancelled',
      reason: 'The target curves have no buffer curves (Snapshot first)',
    });
    await runOk(app, 'graph.buffer.snapshot');
    app.store.transact({ label: 'delete' }, (tx) => {
      for (const key of tx.query.keysOfCurve(WAVE.curve)) tx.remove('keys', key.id);
      tx.softDelete('curves', WAVE.curve);
    });
    expect(app.session.getState().curveBuffers.has(WAVE.curve)).toBe(false);
  });

  it('swap selects no key it replaced (new key IDs)', async () => {
    const app = opsApp();
    await runOk(app, 'graph.buffer.snapshot');
    select(app, [WAVE.lowerArmL], [WAVE.keys[0]]);
    await runOk(app, 'graph.buffer.swap', { curves: [WAVE.curve] });
    expect(app.session.getState().selection.keys.size).toBe(0);
    expect(app.store.get('keys', WAVE.keys[0])).toBeUndefined();
  });
});

describe('pose.mirrorAnimation channel rule and scope (§5.14)', () => {
  it('mirrorSign: rx, ty, tz, scale copy; ry, rz, tx negate; attributes by AttrDef.mirror', () => {
    expect((['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx'] as ChannelId[]).map((c) => mirrorSign(c, undefined))).toEqual([
      -1, 1, 1, 1, -1, -1, 1,
    ]);
    expect(mirrorSign('@roll', { type: 'float', default: 0, keyable: true, mirror: 'negate' })).toBe(-1);
    expect(mirrorSign('@ikFk', { type: 'float', default: 0, keyable: true })).toBe(1);
  });

  it.skipIf(!READY.wp3)('leftToRight copies the mirrored curves onto the right side; undo/redo exact', async () => {
    const app = opsApp();
    translatableArms(app);
    curveWith(app, UPPER_L, 'rx', [
      [0, 0.1],
      [10, 0.3, 'auto'],
      [20, -0.2],
    ]);
    curveWith(app, UPPER_L, 'ry', [
      [0, 0.2],
      [20, 0.4],
    ]);
    curveWith(app, UPPER_L, 'tx', [
      [0, 0.05],
      [20, -0.05],
    ]);
    curveWith(app, UPPER_R, 'rz', [
      [0, 1],
      [20, 2],
    ]); // replaced by L's (no curve): the default, mirrored
    select(app, [UPPER_L]);
    const { value } = await expectUndoRedoExact(app, 'pose.mirrorAnimation', { mode: 'leftToRight' });
    expect(value).toEqual({ count: 4 });
    expect(app.history.peekUndo()?.label).toBe('Mirror Animation');
    expect(contentOf(app, UPPER_R, 'rx')?.keys.map((k) => [k.t, k.v, k.inType])).toEqual([
      [0, 0.1, 'linear'],
      [10, 0.3, 'auto'],
      [20, -0.2, 'linear'],
    ]);
    expect(contentOf(app, UPPER_R, 'ry')?.keys.map((k) => k.v)).toEqual([-0.2, -0.4]);
    expect(contentOf(app, UPPER_R, 'tx')?.keys.map((k) => k.v)).toEqual([-0.05, 0.05]);
    expect(contentOf(app, UPPER_R, 'rz')).toMatchObject({ keys: [], staticValue: 0 });
    // The source side is unchanged.
    expect(contentOf(app, UPPER_L, 'ry')?.keys.map((k) => k.v)).toEqual([0.2, 0.4]);
  });

  it('flip is an involution (flip ∘ flip = id on every curve), centre controls flip onto themselves', async () => {
    const app = opsApp();
    translatableArms(app);
    curveWith(app, UPPER_L, 'ry', [
      [0, 0.2],
      [12, -0.1, 'auto'],
      [20, 0.4],
    ]);
    curveWith(app, UPPER_R, 'rx', [
      [0, 0.3],
      [20, 0.1],
    ]);
    curveWith(app, WAVE.cog, 'tx', [
      [0, 0.02],
      [20, -0.03],
    ]);
    const content = () =>
      [UPPER_L, UPPER_R, WAVE.cog].flatMap((control) =>
        (['tx', 'rx', 'ry', 'rz'] as ChannelId[]).map((channel) => contentOf(app, control, channel)),
      );
    const before = content();
    await runOk(app, 'pose.mirrorAnimation', { mode: 'flip' });
    expect(contentOf(app, WAVE.cog, 'tx')?.keys.map((k) => k.v)).toEqual([-0.02, 0.03]);
    expect(contentOf(app, UPPER_L, 'rx')?.keys.map((k) => k.v)).toEqual([0.3, 0.1]);
    expect(contentOf(app, UPPER_R, 'ry')?.keys.map((k) => k.v)).toEqual([-0.2, 0.1, -0.4]);
    await runOk(app, 'pose.mirrorAnimation', { mode: 'flip' });
    const after = content().map((c) =>
      c === null ? null : { ...c, staticValue: c.keys.length > 0 ? null : c.staticValue },
    );
    // Curves the first flip created hold the mirrored default as static value (0): equal to having none.
    const normalized = (list: typeof before) =>
      list.map((c) => (c === null || (c.keys.length === 0 && (c.staticValue ?? 0) === 0) ? null : c));
    expect(normalized(after)).toEqual(normalized(before));
  });

  it('only centre controls selected: leftToRight acts on the whole character; flip keeps the scope', async () => {
    const app = opsApp();
    curveWith(app, UPPER_L, 'ry', [
      [0, 0.2],
      [20, 0.4],
    ]);
    curveWith(app, WAVE.cog, 'ry', [
      [0, 0.5],
      [20, 0.6],
    ]);
    select(app, [WAVE.cog]);
    await runOk(app, 'pose.mirrorAnimation', { mode: 'leftToRight' });
    expect(contentOf(app, UPPER_R, 'ry')?.keys.map((k) => k.v)).toEqual([-0.2, -0.4]);
    expect(contentOf(app, WAVE.cog, 'ry')?.keys.map((k) => k.v)).toEqual([0.5, 0.6]);
    await runOk(app, 'pose.mirrorAnimation', { mode: 'flip' });
    expect(contentOf(app, WAVE.cog, 'ry')?.keys.map((k) => k.v)).toEqual([-0.5, -0.6]);
    expect(contentOf(app, UPPER_L, 'ry')?.keys.map((k) => k.v)).toEqual([0.2, 0.4]);
  });

  it('secondary (non-world-aligned) controls are skipped with a warning; locked channels too', async () => {
    const { app, services } = opsAppWith();
    app.store.transact({ label: 'secondary' }, (tx) => {
      const control = tx.get('controls', INDEX_L);
      if (control === undefined) throw new Error('no index');
      tx.patch('controls', INDEX_L, { restWorld: { ...control.restWorld, q: [0, 0, 0.6, 0.8] } });
      const lower = tx.get('controls', LOWER_R);
      if (lower !== undefined) tx.patch('controls', LOWER_R, { locked: { ...lower.locked, r: [false, false, true] } });
    });
    curveWith(app, INDEX_L, 'rz', [
      [0, 0.2],
      [20, 0.4],
    ]);
    await runOk(app, 'pose.mirrorAnimation', { mode: 'leftToRight' });
    expect(contentOf(app, `${WAVE.rig}:fk.indexProximal.R` as ControlId, 'rz')).toBeNull();
    expect(contentOf(app, LOWER_R, 'rz')).toBeNull(); // the wave rz curve of the L lower arm: locked target channel
    expect(services.toasts.at(-1)?.text).toBe('1 secondary control was not mirrored; 1 locked channel was not changed');
  });

  it('poll: humanoid, loop clip for the half cycle, argument shapes', async () => {
    const app = opsApp();
    setClip(app, { loop: false });
    expect(await runResult(app, 'pose.mirrorAnimation', { mode: 'flip', offset: 'halfCycle' })).toEqual({
      status: 'cancelled',
      reason: 'Half-cycle mirroring needs a loop clip (Clip settings › Loop)',
    });
    expect((await runResult(app, 'pose.mirrorAnimation', { mode: 'sideways' })).status).toBe('cancelled');
    expect((await runResult(app, 'pose.mirrorAnimation', { mode: 'flip', offset: 'third' })).status).toBe('cancelled');
    expect((await runResult(app, 'pose.mirrorAnimation', { mode: 'flip', controls: ['nope'] })).status).toBe(
      'cancelled',
    );
    expect((await runResult(app, 'pose.mirrorAnimation', { mode: 'flip' })).status).toBe('finished');
  });
});

describe('pose.mirrorAnimation half cycle (§5.14 gate, FR-POSE-05)', () => {
  /** The gate: R at s + ((t − s + T/2) mod T) equals the mirror of L at t, at every integer frame of [s, e). */
  function expectGate(app: EditorApp, channel: ChannelId, s: number, e: number, tolerance = 1e-9): void {
    const T = e - s;
    const sign = mirrorSign(channel, undefined);
    for (let t = s; t < e; t++) {
      const mapped = s + ((t - s + T / 2) % T);
      const left = valueAt(app, UPPER_L, channel, t);
      const right = valueAt(app, UPPER_R, channel, mapped);
      expect([channel, t, right]).toEqual([channel, t, expect.closeTo(sign * left, -Math.log10(tolerance))]);
    }
  }

  it('linear keys at 0/6/12/18/24 (E2E-M2A-15): right keys {12: 0.1, 18: 0, 0: −0.1, 6: 0, 24: −0.1}, tx negated', async () => {
    const app = opsApp();
    translatableArms(app);
    setClip(app, { range: { start: 0, end: 24 }, loop: true });
    curveWith(app, UPPER_L, 'tz', [
      [0, 0.1],
      [6, 0],
      [12, -0.1],
      [18, 0],
      [24, 0.1],
    ]);
    curveWith(app, UPPER_L, 'tx', [
      [0, 0.02],
      [6, 0],
      [12, -0.02],
      [18, 0],
      [24, 0.02],
    ]);
    const leftBefore = contentOf(app, UPPER_L, 'tz');
    select(app, [UPPER_L]);
    await expectUndoRedoExact(app, 'pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle' });
    expect(contentOf(app, UPPER_R, 'tz')?.keys.map((k) => [k.t, k.v])).toEqual([
      [0, -0.1],
      [6, 0],
      [12, 0.1],
      [18, 0],
      [24, -0.1],
    ]);
    expect(contentOf(app, UPPER_R, 'tx')?.keys.map((k) => [k.t, k.v])).toEqual([
      [0, 0.02],
      [6, 0],
      [12, -0.02],
      [18, 0],
      [24, 0.02],
    ]);
    expect(contentOf(app, UPPER_L, 'tz')).toEqual(leftBefore);
    expectGate(app, 'tz', 0, 24);
    expectGate(app, 'tx', 0, 24);
    // The seam keys are frozen with their resolved (linear) handles.
    expect(
      contentOf(app, UPPER_R, 'tz')
        ?.keys.filter((k) => k.inType === 'fixed')
        .map((k) => k.t),
    ).toEqual([0, 12, 24]);
  });

  it('keys at 0, 9, 15, 24 with auto tangents and no key at 12: exact at every frame, no seam pop', async () => {
    const app = opsApp();
    setClip(app, { range: { start: 0, end: 24 }, loop: true });
    curveWith(app, UPPER_L, 'rx', [
      [0, 0.3, 'auto'],
      [9, -0.4, 'auto'],
      [15, 0.1, 'auto'],
      [24, 0.3, 'auto'],
    ]);
    // Constant infinities (an imported curve), then cyclic ones (keyed on a loop clip, cycle-aware tangents).
    app.store.transact({ label: 'inf' }, (tx) => {
      const curve = curveOf(app, UPPER_L, 'rx');
      if (curve !== undefined) tx.patch('curves', curve.id, { pre: 'constant', post: 'constant' });
    });
    await runOk(app, 'pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle', controls: [UPPER_L] });
    expectGate(app, 'rx', 0, 24);
    app.store.transact({ label: 'inf' }, (tx) => {
      const curve = curveOf(app, UPPER_L, 'rx');
      if (curve !== undefined) tx.patch('curves', curve.id, { pre: 'cycle', post: 'cycle' });
    });
    await runOk(app, 'pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle', controls: [UPPER_L] });
    expectGate(app, 'rx', 0, 24);
    expect(curveOf(app, UPPER_R, 'rx')).toMatchObject({ pre: 'cycle', post: 'cycle' });
    // The closing key: R has a key at 24 equal to its key at 0.
    const right = contentOf(app, UPPER_R, 'rx')?.keys ?? [];
    expect(right.at(-1)?.t).toBe(24);
    expect(right.at(-1)?.v).toBe(right[0]?.v);
  });

  it('a curve that does not loop over the clip is mirrored anyway and warned about', async () => {
    const { app, services } = opsAppWith();
    setClip(app, { range: { start: 0, end: 24 }, loop: true });
    curveWith(app, UPPER_L, 'ry', [
      [0, 0.1],
      [24, 0.5],
    ]);
    await runOk(app, 'pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle', controls: [UPPER_L] });
    expect(contentOf(app, UPPER_R, 'ry')?.keys.map((k) => k.t)).toEqual([0, 12, 24]);
    expect(services.toasts.at(-1)?.text).toBe('1 curve does not loop over 0…24');
  });

  it('flip with half cycle twice is the identity on periodic curves (values at every frame)', async () => {
    const app = opsApp();
    setClip(app, { range: { start: 0, end: 24 }, loop: true });
    curveWith(app, UPPER_L, 'ry', [
      [0, 0.2, 'auto'],
      [7, -0.3, 'auto'],
      [16, 0.4, 'auto'],
      [24, 0.2, 'auto'],
    ]);
    const before = Array.from({ length: 25 }, (_, t) => valueAt(app, UPPER_L, 'ry', t));
    await runOk(app, 'pose.mirrorAnimation', { mode: 'flip', offset: 'halfCycle', controls: [UPPER_L] });
    await runOk(app, 'pose.mirrorAnimation', { mode: 'flip', offset: 'halfCycle', controls: [UPPER_L] });
    const after = Array.from({ length: 25 }, (_, t) => valueAt(app, UPPER_L, 'ry', t));
    after.forEach((v, t) => expect([t, v]).toEqual([t, expect.closeTo(before[t] as number, 9)]));
    expect(docJson(app)).toBeDefined();
  });
});

describe('halfCycleKeys with the AnimX engine (anim-core, cycle-aware)', () => {
  // An app object the kernel did not build gets the production bindings (`internalsOf`): the real engine and insert.
  const productionApp = {} as EditorApp;
  const engine = internalsOf(productionApp).deps.curves.engine;

  function gate(curve: AnimCurve, range: { start: number; end: number }) {
    const { keys, periodic } = halfCycleKeys(productionApp, curve, range);
    const mapped = engine.compile({ ...curve, keys });
    const source = engine.compile(curve);
    const T = range.end - range.start;
    let worst = 0;
    for (let t = range.start; t < range.end; t += 0.5) {
      const at = range.start + ((t - range.start + T / 2) % T);
      worst = Math.max(worst, Math.abs(engine.evaluate(mapped, at) - engine.evaluate(source, t)));
    }
    return { worst, periodic, keys };
  }

  const key = (t: number, v: number, type: TangentType = 'auto'): KeyData => ({
    t,
    v,
    inType: type,
    outType: type,
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
  });

  it('is exact on 0/9/15/24 auto keys with constant and with cyclic (cycle-aware) infinities', () => {
    for (const infinity of ['constant', 'cycle'] as const) {
      const curve: AnimCurve = {
        keys: [key(0, 0.3), key(9, -0.4), key(15, 0.1), key(24, 0.3)],
        weighted: false,
        pre: infinity,
        post: infinity,
      };
      const result = gate(curve, { start: 0, end: 24 });
      expect([infinity, result.periodic, result.worst]).toEqual([infinity, true, expect.closeTo(0, 9)]);
    }
  });

  it('is exact on an odd range (m = 12.5), spline and weighted curves, and keys outside the range', () => {
    const odd: AnimCurve = {
      keys: [key(-3, 1), key(0, 0.5, 'spline'), key(10, -0.5, 'spline'), key(25, 0.5, 'spline'), key(30, 2)],
      weighted: false,
      pre: 'constant',
      post: 'constant',
    };
    const oddResult = gate(odd, { start: 0, end: 25 });
    expect(oddResult.worst).toBeCloseTo(0, 9);
    expect(oddResult.keys.every((k) => k.t >= 0 && k.t <= 25)).toBe(true);
    const weighted: AnimCurve = {
      keys: [
        key(0, 0),
        { ...key(8, 1, 'fixed'), inHandle: { dt: -2, dv: 0.5 }, outHandle: { dt: 4, dv: -0.2 }, broken: true },
        key(24, 0),
      ],
      weighted: true,
      pre: 'cycle',
      post: 'cycle',
    };
    expect(gate(weighted, { start: 0, end: 24 }).worst).toBeCloseTo(0, 9);
    expect(curveEngine).toBeDefined();
  });
});
