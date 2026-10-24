// M2A-SPEC §5.13 tween family and §5.15.3 value scaling (A4) on the kernel: the formulas of every mode, overshoot
// and attribute ranges, the 'frame' target (neighbours, the keyAll rule, Channels panel channels, skipped channels),
// runs of selected keys, target resolution, the slider gesture (one step, coalesced, Esc) and `scaleKeyValues`.
import { type TangentType } from '@ekza-studio/anim-core';
import type { AttrDef, ChannelId, ControlId, CurveId, KeyId, KeyRecord } from '@ekza-studio/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  beginTweenGesture,
  clampTweenAmount,
  ensureCurve,
  resolveTweenTarget,
  scaleKeyValues,
  tweenEdits,
} from '../../src';
import { type TweenPlanEntry, tweenValue } from '../../src/edit/tween';
import type { EditorApp, TweenMode } from '../../src/types';
import { DEG, edit, setFrame, WAVE, waveApp } from './support';

const ARM = WAVE.lowerArmL;
const HAND = WAVE.handL;

type KeySpec = readonly [t: number, v: number, type?: TangentType];

/** A base-layer curve of the wave clip with exactly these keys (ids k_<tag><n>). */
function curveWith(
  app: EditorApp,
  control: ControlId,
  channel: ChannelId,
  keys: readonly KeySpec[],
  tag = 'T',
): {
  readonly curve: CurveId;
  readonly keys: readonly KeyId[];
} {
  return edit(app, 'setup', (tx) => {
    const curve = ensureCurve(app, tx, WAVE.clip, control, channel);
    for (const key of tx.query.keysOfCurve(curve)) tx.remove('keys', key.id);
    const ids = keys.map(([t, v, type], i) => {
      const id = `k_${tag}${channel.replace('@', 'a')}${String(i).padStart(6, '0')}` as KeyId;
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

function selectControls(app: EditorApp, controls: readonly ControlId[]): void {
  app.session.setState({ selection: { ...app.session.getState().selection, controls } });
}

function selectKeys(app: EditorApp, keys: readonly KeyId[]): void {
  const selection = app.session.getState().selection;
  app.session.setState({
    selection: { ...selection, keys: new Map(keys.map((key) => [key, { key: true, in: false, out: false }])) },
  });
}

function keyAt(app: EditorApp, curve: CurveId, t: number): KeyRecord | undefined {
  return app.store.query.keysOfCurve(curve).find((key) => Math.abs(key.t - t) < 1e-6);
}

const entry = (over: Partial<TweenPlanEntry> = {}): TweenPlanEntry => ({
  curve: 'crv_x' as CurveId,
  control: ARM,
  channel: 'rz',
  key: null,
  t: 10,
  r: 0.5,
  vp: 0,
  vn: 60,
  vc: 30,
  d: 0,
  min: Number.NEGATIVE_INFINITY,
  max: Number.POSITIVE_INFINITY,
  stepped: false,
  ...over,
});

describe('tween formulas (§5.13)', () => {
  it('every mode at the E2E-M2A-13 numbers (linear 0 → 60 over 0…20, frame 10)', () => {
    const e = entry();
    expect(tweenValue('tween', 50, e)).toBeCloseTo(45, 12);
    expect(tweenValue('tween', -100, e)).toBe(0);
    expect(tweenValue('tween', 100, e)).toBe(60);
    expect(tweenValue('tween', 125, e)).toBeCloseTo(67.5, 12);
    expect(tweenValue('neighbor', -50, e)).toBeCloseTo(15, 12);
    expect(tweenValue('neighbor', 100, e)).toBe(60);
    expect(tweenValue('ease', -50, e)).toBeCloseTo(60 * 0.5 ** 2.5, 12);
    expect(tweenValue('ease', 50, e)).toBeCloseTo(60 * (1 - 0.5 ** 2.5), 12);
    expect(tweenValue('ease', 0, e)).toBeCloseTo(30, 12);
    expect(tweenValue('toDefault', 50, e)).toBeCloseTo(15, 12);
    expect(tweenValue('toDefault', -50, e)).toBeCloseTo(45, 12);
    expect(tweenValue('pushPull', 100, entry({ vc: 45 }))).toBeCloseTo(60, 12);
  });

  it('pushPull relaxes toward the time-weighted in-between line, not the average (r ≠ 0.5)', () => {
    // p = (0, 0), n = (20, 40): at r = 0.25 the in-between line is 10 (the plain average would be 20).
    const e = entry({ r: 0.25, vp: 0, vn: 40, vc: 30 });
    expect(tweenValue('pushPull', -100, e)).toBeCloseTo(10, 12);
    expect(tweenValue('pushPull', -50, e)).toBeCloseTo(20, 12);
    expect(tweenValue('pushPull', 100, e)).toBeCloseTo(50, 12);
    expect(tweenValue('pushPull', 0, e)).toBe(30);
  });

  it('ease has no overshoot past ±100; the amount is limited to ±100, ±150 with overshoot', () => {
    expect(tweenValue('ease', -150, entry())).toBe(tweenValue('ease', -100, entry()));
    expect(clampTweenAmount(125, false)).toBe(100);
    expect(clampTweenAmount(-125, false)).toBe(-100);
    expect(clampTweenAmount(125, true)).toBe(125);
    expect(clampTweenAmount(-170, true)).toBe(-150);
    expect(clampTweenAmount(Number.NaN, true)).toBe(0);
  });

  it('clamps attribute values to their range', () => {
    const e = entry({ vp: 0, vn: 1, vc: 0.5, min: 0, max: 1 });
    expect(tweenValue('tween', 150, e)).toBe(1);
    expect(tweenValue('tween', -150, e)).toBe(0);
  });

  it('property: amount 0 keeps the in-between (tween), the value (neighbor, pushPull, toDefault)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (r, vp, vn, vc) => {
          const e = entry({ r, vp, vn, vc });
          const digits = 9;
          expect(tweenValue('tween', 0, e)).toBeCloseTo((vp + vn) / 2, digits);
          expect(tweenValue('neighbor', 0, e)).toBeCloseTo(vc, digits);
          expect(tweenValue('pushPull', 0, e)).toBeCloseTo(vc, digits);
          expect(tweenValue('toDefault', 0, e)).toBeCloseTo(vc, digits);
          expect(tweenValue('tween', -100, e)).toBeCloseTo(vp, digits);
          expect(tweenValue('tween', 100, e)).toBeCloseTo(vn, digits);
        },
      ),
    );
  });
});

describe('tweenEdits: the pose at a frame (§5.13 target "frame")', () => {
  it('tweens each keyed channel between its neighbours at the frame, curves ⊕ overrides as the current value', () => {
    const app = waveApp();
    const rz = curveWith(app, HAND, 'rz', [
      [0, 0],
      [20, 60 * DEG],
    ]);
    const rx = curveWith(app, HAND, 'rx', [
      [0, 10 * DEG],
      [20, 20 * DEG],
    ]);
    setFrame(app, 10);
    const target = { kind: 'frame', controls: [HAND], channels: null, frame: 10 } as const;
    const edits = tweenEdits(app, 'tween', 50, target);
    expect(edits.map((e) => [e.channel, e.curve, e.t])).toEqual([
      ['rx', rx.curve, 10],
      ['rz', rz.curve, 10],
    ]);
    expect((edits[1]?.value ?? 0) / DEG).toBeCloseTo(45, 9);
    // An override is the current value of neighbor/toDefault/pushPull.
    app.session.setState({ overrides: new Map([[HAND, { rz: 40 * DEG }]]) });
    const neighbor = tweenEdits(app, 'neighbor', 50, target).find((e) => e.channel === 'rz');
    expect((neighbor?.value ?? 0) / DEG).toBeCloseTo(50, 9);
  });

  it('skips channels without keys on both sides, locked curves and channels, and keyAll: false attributes', () => {
    const app = waveApp();
    const attrs: Readonly<Record<string, AttrDef>> = {
      soft: { type: 'float', default: 0, min: 0, max: 0.25, keyable: true, keyAll: false },
      roll: { type: 'float', default: 0, keyable: true, unit: 'angle' },
    };
    edit(app, 'attrs', (tx) => tx.patch('controls', HAND, { attrs }));
    curveWith(app, HAND, 'rx', [[0, 0]]); // no key after 10
    curveWith(app, HAND, 'ry', [
      [0, 0],
      [20, 1],
    ]);
    const rz = curveWith(app, HAND, 'rz', [
      [0, 0],
      [20, 1],
    ]);
    const soft = curveWith(app, HAND, '@soft', [
      [0, 0],
      [20, 0.2],
    ]);
    const roll = curveWith(app, HAND, '@roll', [
      [0, 0],
      [20, 0.4],
    ]);
    edit(app, 'lock', (tx) => {
      const control = tx.get('controls', HAND);
      if (control === undefined) throw new Error('no hand');
      tx.patch('controls', HAND, { locked: { ...control.locked, r: [false, true, false] } });
      tx.patch('curves', rz.curve, { locked: true });
    });
    setFrame(app, 10);
    const frame = { kind: 'frame', controls: [HAND], channels: null, frame: 10 } as const;
    expect(tweenEdits(app, 'tween', 0, frame).map((e) => e.channel)).toEqual(['@roll']);
    // A channel selected in the Channels panel names keyAll: false attributes explicitly.
    const selected = tweenEdits(app, 'tween', 0, {
      ...frame,
      channels: [
        { control: HAND, channel: '@soft' },
        { control: ARM, channel: '@soft' },
      ],
    });
    expect(selected.map((e) => [e.channel, e.curve, e.value])).toEqual([['@soft', soft.curve, 0.1]]);
    expect(roll.curve).toBeDefined();
  });
});

describe('tweenEdits: runs of selected keys (§5.13 target "keys")', () => {
  it('a block of three selected keys tweens toward the unselected keys around it', () => {
    const app = waveApp();
    const c = curveWith(app, HAND, 'rz', [
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
      [40, 0],
    ]);
    const block = tweenEdits(app, 'tween', 0, { kind: 'keys', keys: [c.keys[1], c.keys[2], c.keys[3]] as KeyId[] });
    // p = key 0 (0), n = key 40 (0): the block flattens toward the hold.
    expect(block.map((e) => [e.t, e.value])).toEqual([
      [10, 0],
      [20, 0],
      [30, 0],
    ]);
    const pushed = tweenEdits(app, 'pushPull', -100, {
      kind: 'keys',
      keys: [c.keys[1], c.keys[2], c.keys[3]] as KeyId[],
    });
    expect(pushed.map((e) => e.value)).toEqual([0, 0, 0]);
  });

  it('an isolated key is a run of one: the per-key result', () => {
    const app = waveApp();
    const c = curveWith(app, HAND, 'rz', [
      [0, 0],
      [10, 10],
      [20, 50],
      [30, 30],
    ]);
    const one = tweenEdits(app, 'tween', 0, { kind: 'keys', keys: [c.keys[2] as KeyId] });
    expect(one).toEqual([{ curve: c.curve, control: HAND, channel: 'rz', t: 20, value: 20 }]);
    // Two runs on one curve: 10 alone and 30 alone (20 unselected between them).
    const two = tweenEdits(app, 'tween', -100, { kind: 'keys', keys: [c.keys[1], c.keys[3]] as KeyId[] });
    expect(two.map((e) => [e.t, e.value])).toEqual([[10, 0]]);
  });

  it('runs without both neighbours are skipped; several curves are independent', () => {
    const app = waveApp();
    const a = curveWith(app, HAND, 'rz', [
      [0, 0],
      [10, 10],
    ]);
    const b = curveWith(app, HAND, 'rx', [
      [0, 0],
      [10, 10],
      [20, 0],
    ]);
    const edits = tweenEdits(app, 'neighbor', 100, { kind: 'keys', keys: [a.keys[0], b.keys[1]] as KeyId[] });
    expect(edits.map((e) => [e.curve, e.value])).toEqual([[b.curve, 0]]);
  });
});

describe('resolveTweenTarget (§5.13 target resolution and the toggle)', () => {
  it("'auto' tweens selected keys; without keys, or with 'frame', the pose at the current frame", () => {
    const app = waveApp();
    const c = curveWith(app, HAND, 'rz', [
      [0, 0],
      [10, 10],
      [20, 20],
    ]);
    selectControls(app, [HAND]);
    setFrame(app, 21);
    expect(resolveTweenTarget(app)).toMatchObject({ kind: 'frame', label: 'Pose @ f21' });
    selectKeys(app, [c.keys[1] as KeyId, c.keys[2] as KeyId]);
    expect(resolveTweenTarget(app)).toMatchObject({ kind: 'keys', label: '2 keys' });
    selectKeys(app, [c.keys[1] as KeyId]);
    expect(resolveTweenTarget(app).label).toBe('1 key');
    const tools = app.session.getState().tools;
    app.session.setState({ tools: { ...tools, tweenTarget: 'frame' } });
    expect(resolveTweenTarget(app)).toMatchObject({ kind: 'frame', label: 'Pose @ f21' });
    expect(resolveTweenTarget(app, 'keys').kind).toBe('keys');
    setFrame(app, 7.5);
    expect(resolveTweenTarget(app).label).toBe('Pose @ f7.5');
  });

  it('the pose target uses the key target controls and the channels selected in the Channels panel', () => {
    const app = waveApp();
    selectControls(app, [HAND]);
    const selection = app.session.getState().selection;
    app.session.setState({ selection: { ...selection, channels: [{ control: HAND, channel: 'ty' }] } });
    const resolved = resolveTweenTarget(app);
    expect(resolved.target).toEqual({
      kind: 'frame',
      controls: [HAND],
      channels: [{ control: HAND, channel: 'ty' }],
      frame: 0,
    });
  });
});

describe('beginTweenGesture (§5.13 slider drag)', () => {
  function setup() {
    const app = waveApp();
    const c = curveWith(app, HAND, 'rz', [
      [0, 0],
      [20, 60 * DEG],
    ]);
    selectControls(app, [HAND]);
    setFrame(app, 10);
    return { app, c };
  }

  it('previews each amount, commits ONE step labelled Tween with a breakdown key; undo removes it', () => {
    const { app, c } = setup();
    const gesture = beginTweenGesture(app, { mode: 'tween' });
    expect([gesture.kind, gesture.count]).toEqual(['frame', 1]);
    gesture.update(20);
    expect((keyAt(app, c.curve, 10)?.v ?? 0) / DEG).toBeCloseTo(36, 9);
    gesture.update(50);
    expect(gesture.commit(50)).toBe(1);
    const key = keyAt(app, c.curve, 10);
    expect((key?.v ?? 0) / DEG).toBeCloseTo(45, 9);
    expect(key?.breakdown).toBe(true);
    expect(app.history.peekUndo()?.label).toBe('Tween');
    expect(app.history.undo()?.label).toBe('Tween');
    expect(keyAt(app, c.curve, 10)).toBeUndefined();
    expect(app.evaluation.channelValue(HAND, 'rz') / DEG).toBeCloseTo(30, 9);
    expect(app.history.peekUndo()?.label).toBe('setup');
  });

  it('coalesces updates to one preview per frame with a frame requester', () => {
    const { app, c } = setup();
    let requested = 0;
    app.setFrameRequester(() => {
      requested++;
    });
    const previews: number[] = [];
    const off = app.store.subscribe((batch) => {
      if (batch.origin === 'preview') previews.push(batch.changes.length);
    });
    const gesture = beginTweenGesture(app, { mode: 'tween' });
    gesture.update(10);
    gesture.update(30);
    expect(previews).toEqual([]);
    app.flushScheduled();
    expect(previews).toHaveLength(1);
    expect((keyAt(app, c.curve, 10)?.v ?? 0) / DEG).toBeCloseTo(39, 9);
    gesture.commit(30);
    off();
    expect(requested).toBeGreaterThan(0);
  });

  it('Esc cancels without a trace and restores the overrides it took over', () => {
    const { app, c } = setup();
    const overrides = new Map([[HAND, { rz: 5 * DEG, rx: 1 * DEG }]]);
    app.session.setState({ overrides });
    const before = JSON.stringify(app.store.snapshot());
    const gesture = beginTweenGesture(app, { mode: 'neighbor' });
    // While the drag runs the keyed channel's override is gone (the key shows), the other override stays.
    expect(app.session.getState().overrides.get(HAND)).toEqual({ rx: 1 * DEG });
    gesture.update(100);
    gesture.cancel();
    expect(JSON.stringify(app.store.snapshot())).toBe(before);
    expect(app.session.getState().overrides).toBe(overrides);
    expect(keyAt(app, c.curve, 10)).toBeUndefined();
    expect(app.history.peekUndo()?.label).toBe('setup');
  });

  it('keys target: changes the selected keys in place; breakdown false keys plain keys at the frame', () => {
    const { app, c } = setup();
    const mid = curveWith(app, HAND, 'rx', [
      [0, 0],
      [10, 3],
      [20, 0],
    ]);
    selectKeys(app, [mid.keys[1] as KeyId]);
    const keys = beginTweenGesture(app, { mode: 'tween' });
    expect(keys.kind).toBe('keys');
    keys.commit(0);
    expect(app.store.get('keys', mid.keys[1] as KeyId)?.v).toBe(0);
    selectKeys(app, []);
    const plain = beginTweenGesture(app, { mode: 'tween', breakdown: false });
    plain.commit(0);
    expect(keyAt(app, c.curve, 10)?.breakdown).toBeUndefined();
  });
});

describe('scaleKeyValues (§5.15.3)', () => {
  it('scales values around a display pivot; fixed handles scale their dv; a negative factor flips', () => {
    const app = waveApp();
    const c = curveWith(app, HAND, 'rz', [
      [0, -30 * DEG],
      [10, 30 * DEG],
      [20, 0],
    ]);
    edit(app, 'fix', (tx) => {
      const key = tx.get('keys', c.keys[1] as KeyId) as KeyRecord;
      tx.put('keys', { ...key, inType: 'fixed', inHandle: { dt: -2, dv: 0.2 }, outType: 'auto' });
    });
    edit(app, 'scale', (tx) => {
      const result = scaleKeyValues(app, tx, c.keys.slice(0, 2), -30, 0.5);
      expect(result).toEqual({ moved: 2, deleted: [] });
    });
    const [a, b, z] = app.store.query.keysOfCurve(c.curve);
    expect((a?.v ?? 0) / DEG).toBeCloseTo(-30, 9);
    expect((b?.v ?? 0) / DEG).toBeCloseTo(0, 9);
    expect(b?.inHandle).toEqual({ dt: -2, dv: 0.1 });
    expect(b?.outHandle).toEqual({ dt: 0, dv: 0 });
    expect(z?.v).toBe(0);
    edit(app, 'flip', (tx) => scaleKeyValues(app, tx, [c.keys[1] as KeyId], 10, -1));
    expect((app.store.get('keys', c.keys[1] as KeyId)?.v ?? 0) / DEG).toBeCloseTo(20, 9);
    expect(app.store.get('keys', c.keys[1] as KeyId)?.inHandle).toEqual({ dt: -2, dv: -0.1 });
  });

  it('factor 1 and locked curves change nothing; translation pivots are metres', () => {
    const app = waveApp();
    const t = curveWith(app, HAND, 'ty', [
      [0, 0.2],
      [10, 0.4],
    ]);
    const before = JSON.stringify(app.store.snapshot());
    edit(app, 'noop', (tx) => expect(scaleKeyValues(app, tx, t.keys, 0, 1).moved).toBe(0));
    expect(JSON.stringify(app.store.snapshot())).toBe(before);
    edit(app, 'scale', (tx) => scaleKeyValues(app, tx, t.keys, 0.2, 2));
    expect(app.store.query.keysOfCurve(t.curve).map((k) => k.v)).toEqual([0.2, 0.6000000000000001]);
    edit(app, 'lock', (tx) => tx.patch('curves', t.curve, { locked: true }));
    edit(app, 'locked', (tx) => expect(scaleKeyValues(app, tx, t.keys, 0, 3).moved).toBe(0));
  });

  it('property: scaling by f then 1/f around the same pivot restores the values', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), { minLength: 1, maxLength: 6 }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        (values, pivot, factor) => {
          const app = waveApp();
          const c = curveWith(
            app,
            HAND,
            'ty',
            values.map((v, i) => [i * 5, v] as const),
          );
          edit(app, 'there', (tx) => scaleKeyValues(app, tx, c.keys, pivot, factor));
          edit(app, 'back', (tx) => scaleKeyValues(app, tx, c.keys, pivot, 1 / factor));
          const after = app.store.query.keysOfCurve(c.curve).map((k) => k.v);
          after.forEach((v, i) => {
            expect(Math.abs(v - (values[i] as number))).toBeLessThanOrEqual(1e-9 * 1000);
          });
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('tween modes list', () => {
  it('names the five modes of the contract', () => {
    const modes: TweenMode[] = ['tween', 'neighbor', 'ease', 'pushPull', 'toDefault'];
    for (const mode of modes) expect(Number.isFinite(tweenValue(mode, 30, entry()))).toBe(true);
  });
});

describe('M-1 mechanism 6: no pose change, no re-evaluation event (§5.21.1)', () => {
  it('a key edit that leaves the current frame’s values unchanged reports no pose change', () => {
    const app = waveApp();
    setFrame(app, 0);
    app.evaluation.tick();
    const events: (readonly string[])[] = [];
    const off = app.evaluation.subscribe((event) => events.push(event.characters));
    const version = app.evaluation.poseVersion;
    // The key at 30 changes; frame 0 sits on the first key (value unchanged).
    edit(app, 'far key', (tx) => {
      const key = tx.get('keys', WAVE.keys[2]);
      if (key !== undefined) tx.put('keys', { ...key, v: key.v + 0.5 });
    });
    expect(app.evaluation.tick()).toBe(false);
    expect(app.evaluation.poseVersion).toBe(version);
    expect(events).toEqual([]);
    // The key at 0 changes: the pose changes and is reported.
    edit(app, 'near key', (tx) => {
      const key = tx.get('keys', WAVE.keys[0]);
      if (key !== undefined) tx.put('keys', { ...key, v: key.v + 0.5 });
    });
    expect(app.evaluation.tick()).toBe(true);
    expect(events).toEqual([[WAVE.character]]);
    // An override at the frame is a change too.
    app.session.setState({ overrides: new Map([[ARM, { rx: 0.25 }]]) });
    expect(app.evaluation.tick()).toBe(true);
    off();
  });
});
