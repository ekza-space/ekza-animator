// M2A-SPEC §8 A0 (editor-core): the frame scheduler, the key-edit gesture, coalesced channel gestures, units and
// defaults of attribute channels, evaluation of attributes, the baselines (visibility rule 1, body parts, key
// targets), `writeKeyAt` options, the cycle-aware engine of loop clips (§5.23) and the contract stubs.
import {
  type AnimCurve,
  compileAnimCurve,
  curveEngine,
  DEG2RAD,
  EkzaError,
  evaluateAnimCurve,
  type KeyData,
  segmentControlPoints,
} from '@ekza-studio/anim-core';
import type { AttrDef, ChangeBatch, ControlId, CurveId, KeyId, SolverId, Tx } from '@ekza-studio/doc';
import type { LimbDesc, RigProgram } from '@ekza-studio/rig';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EDITOR_CURVE_ENGINE } from '../../src/app/deps';
import { cancelChannelEditGestures } from '../../src/edit/channels';
import {
  beginChannelEditGesture,
  beginKeyEditGesture,
  registerBuiltinOperators,
  bodyPartOf,
  channelDefaultOf,
  channelUnit,
  controlVisibility,
  copyKeys,
  formatChannelValue,
  fromDisplayValue,
  insertTime,
  keyTargetControls,
  moveKeys,
  scaleKeyValues,
  toDisplayValue,
  tweenEdits,
  writeKeyAt,
} from '../../src';
import { naiveCurveEngine, naiveCycleAwareCurveEngine } from '../../src/testing';
import { naiveAttrSlots } from '../../src/testing/rig';
import { edit, kernelApp, keysOf, select, WAVE, waveApp, waveDoc } from './support';

const IK_ATTRS: Readonly<Record<string, AttrDef>> = {
  ikFk: { type: 'float', default: 1, min: 0, max: 1, keyable: true, keyAll: false, stepped: true },
  soft: { type: 'float', default: 0, min: 0, max: 0.25, keyable: true, keyAll: false },
  roll: { type: 'float', default: 0, keyable: true, unit: 'angle' },
  reach: { type: 'float', default: 0.5, keyable: true, unit: 'distance' },
};

/** The wave app with IK-like attributes on the left foot (no ik2 solver: the naive program has none). */
function attrApp() {
  const app = waveApp();
  const foot = `${WAVE.rig}:fk.foot.L` as ControlId;
  edit(app, 'Attributes', (tx) => tx.patch('controls', foot, { attrs: IK_ATTRS }));
  return { app, foot };
}

describe('scheduleBeforeFrame / flushScheduled (§4.5, M-1 mechanism 1)', () => {
  it('runs tasks synchronously without a frame requester (Node)', () => {
    const app = waveApp();
    const runs: string[] = [];
    app.scheduleBeforeFrame('a', () => runs.push('a'));
    app.scheduleBeforeFrame('a', () => runs.push('a2'));
    expect(runs).toEqual(['a', 'a2']);
    app.flushScheduled();
    expect(runs).toEqual(['a', 'a2']);
  });

  it('with a frame requester: defers to the next flush, replaces by key, keeps scheduling order', () => {
    const app = waveApp();
    let requests = 0;
    app.setFrameRequester(() => requests++);
    const runs: string[] = [];
    app.scheduleBeforeFrame('a', () => runs.push('a1'));
    app.scheduleBeforeFrame('b', () => runs.push('b'));
    app.scheduleBeforeFrame('a', () => runs.push('a2'));
    expect(runs).toEqual([]);
    expect(requests).toBeGreaterThanOrEqual(1);
    app.flushScheduled();
    expect(runs).toEqual(['a2', 'b']);
    app.flushScheduled();
    expect(runs).toEqual(['a2', 'b']);
  });

  it('runs tasks scheduled during a flush in the same flush, and every task even when one throws', () => {
    const app = waveApp();
    app.setFrameRequester(() => undefined);
    const runs: string[] = [];
    app.scheduleBeforeFrame('first', () => {
      runs.push('first');
      app.scheduleBeforeFrame('nested', () => runs.push('nested'));
      throw new Error('boom');
    });
    app.scheduleBeforeFrame('second', () => runs.push('second'));
    expect(() => app.flushScheduled()).toThrow('boom');
    expect(runs).toEqual(['first', 'second', 'nested']);
  });
});

describe('beginKeyEditGesture (§4.5)', () => {
  const previewBatches = (app: ReturnType<typeof waveApp>): ChangeBatch[] => {
    const batches: ChangeBatch[] = [];
    app.store.subscribe((batch) => {
      if (batch.origin === 'preview') batches.push(batch);
    });
    return batches;
  };
  const move =
    (app: ReturnType<typeof waveApp>, dFrames: number, final = false) =>
    (tx: Tx) => {
      moveKeys(app, tx, [WAVE.keys[1]], dFrames, 0, { snap: true, resolveCollisions: final });
    };

  it('coalesces two updates in one frame into one preview update and commits one history step', () => {
    const app = waveApp();
    app.setFrameRequester(() => undefined);
    const batches = previewBatches(app);
    const gesture = beginKeyEditGesture(app, 'Move Keys');
    gesture.update(move(app, 1));
    gesture.update(move(app, 2));
    expect(batches).toHaveLength(0);
    expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(15);
    app.flushScheduled();
    expect(batches).toHaveLength(1);
    expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(17);
    const historyBefore = app.history.canUndo();
    const batch = gesture.commit(move(app, 3, true));
    expect(batch).not.toBeNull();
    expect(gesture.active).toBe(false);
    expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(18);
    expect(historyBefore).toBe(false);
    expect(app.history.peekUndo()?.label).toBe('Move Keys');
    app.history.undo();
    expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(15);
    expect(app.history.canUndo()).toBe(false);
  });

  it('applies updates at once without a frame requester; commit labels and cancel leave no trace', () => {
    const app = waveApp();
    const gesture = beginKeyEditGesture(app, 'Move Keys');
    gesture.update(move(app, -2));
    expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(13);
    gesture.cancel();
    expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(15);
    expect(app.history.canUndo()).toBe(false);
    expect(app.store.preview).toBeNull();

    const labelled = beginKeyEditGesture(app, 'Move Keys');
    labelled.commit(move(app, 4, true), { label: 'Retime' });
    expect(app.history.peekUndo()?.label).toBe('Retime');
  });

  it('Esc (cancelling the edit gestures) cancels a pending drag; a later commit does nothing', () => {
    const app = waveApp();
    app.setFrameRequester(() => undefined);
    const gesture = beginKeyEditGesture(app, 'Move Keys');
    gesture.update(move(app, 3));
    app.flushScheduled();
    expect(cancelChannelEditGestures(app)).toBe(true);
    expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(15);
    gesture.update(move(app, 5));
    app.flushScheduled();
    expect(gesture.commit(move(app, 5, true))).toBeNull();
    expect(app.store.get('keys', WAVE.keys[1])?.t).toBe(15);
    expect(app.history.canUndo()).toBe(false);
  });
});

describe('beginChannelEditGesture coalescing (§4.5)', () => {
  it('two updates in one frame are one preview update; commit applies the pending one', () => {
    const app = waveApp();
    app.setFrameRequester(() => undefined);
    let previews = 0;
    app.store.subscribe((batch) => {
      if (batch.origin === 'preview') previews++;
    });
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: WAVE.handL, channel: 'ry', value: 0.1 }]);
    gesture.update([{ control: WAVE.handL, channel: 'ry', value: 0.2 }]);
    expect(previews).toBe(0);
    app.flushScheduled();
    expect(previews).toBe(1);
    expect(app.evaluation.channelValues(WAVE.handL).ry).toBeCloseTo(0.2, 12);
    gesture.update([{ control: WAVE.handL, channel: 'ry', value: 0.3 }]);
    gesture.commit();
    expect(app.evaluation.channelValues(WAVE.handL).ry).toBeCloseTo(0.3, 12);
    expect(app.history.peekUndo()?.label).toBe('Rotate');
  });

  it('cancel drops a pending update', () => {
    const app = waveApp();
    app.setFrameRequester(() => undefined);
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: WAVE.handL, channel: 'ry', value: 0.5 }]);
    gesture.cancel();
    app.flushScheduled();
    expect(app.evaluation.channelValues(WAVE.handL).ry).toBe(0);
    expect(app.store.preview).toBeNull();
  });
});

describe('channel units and defaults (§5.1 rules 5–6)', () => {
  it('channelUnit: rotations are angles, translations distances, attributes by AttrDef.unit', () => {
    const { app, foot } = attrApp();
    const control = app.store.get('controls', foot) ?? null;
    expect(channelUnit(control, 'rx')).toBe('angle');
    expect(channelUnit(control, 'ty')).toBe('distance');
    expect(channelUnit(control, 'sz')).toBe('none');
    expect(channelUnit(control, '@roll')).toBe('angle');
    expect(channelUnit(control, '@reach')).toBe('distance');
    expect(channelUnit(control, '@soft')).toBe('none');
    expect(channelUnit(control, '@missing')).toBe('none');
    expect(channelUnit(null, '@roll')).toBe('none');
    expect(channelUnit(null, 'rz')).toBe('angle');
  });

  it('channelDefaultOf: TRS defaults and AttrDef.default (0 when unknown)', () => {
    const { app, foot } = attrApp();
    const control = app.store.get('controls', foot) ?? null;
    expect(channelDefaultOf(control, 'sx')).toBe(1);
    expect(channelDefaultOf(control, 'tx')).toBe(0);
    expect(channelDefaultOf(control, '@ikFk')).toBe(1);
    expect(channelDefaultOf(control, '@reach')).toBe(0.5);
    expect(channelDefaultOf(control, '@missing')).toBe(0);
    expect(channelDefaultOf(null, '@ikFk')).toBe(0);
  });

  it('unit-aware display: typing 30 on @roll stores π/6; @soft shows 3 decimals; the M1 rule without a unit', () => {
    const { app, foot } = attrApp();
    const control = app.store.get('controls', foot) ?? null;
    const roll = channelUnit(control, '@roll');
    expect(fromDisplayValue('@roll', 30, roll)).toBeCloseTo(Math.PI / 6, 15);
    expect(toDisplayValue('@roll', Math.PI / 6, roll)).toBeCloseTo(30, 12);
    expect(formatChannelValue('@roll', Math.PI / 6, roll)).toBe('30.000');
    const soft = channelUnit(control, '@soft');
    expect(formatChannelValue('@soft', 0.1, soft)).toBe('0.100');
    expect(fromDisplayValue('@soft', 0.1, soft)).toBe(0.1);
    expect(formatChannelValue('@reach', 0.25, channelUnit(control, '@reach'))).toBe('0.250');
    // M1 behaviour without a unit: degrees for rotation channels only.
    expect(toDisplayValue('rx', Math.PI)).toBeCloseTo(180, 12);
    expect(toDisplayValue('@roll', 1)).toBe(1);
    expect(fromDisplayValue('ry', 90)).toBeCloseTo(90 * DEG2RAD, 15);
    // A given unit wins over the channel id.
    expect(toDisplayValue('rx', 1, 'none')).toBe(1);
  });
});

describe('evaluation of attributes (§4.5)', () => {
  it('channelValue reads curves, static values, defaults and overrides of TRS and attribute channels', () => {
    const { app, foot } = attrApp();
    expect(app.evaluation.channelValue(foot, '@ikFk')).toBe(1);
    expect(app.evaluation.channelValue(foot, '@reach')).toBe(0.5);
    expect(app.evaluation.channelValue(foot, '@missing')).toBe(0);
    expect(app.evaluation.channelValue(WAVE.lowerArmL, 'rz')).toBe(app.evaluation.channelValues(WAVE.lowerArmL).rz);
    const curve = edit(app, 'Roll curve', (tx) => {
      tx.put('curves', {
        id: 'crv_AttrRoll0000001' as CurveId,
        clip: WAVE.clip,
        layer: WAVE.layer,
        control: foot,
        channel: '@roll',
        weighted: false,
        pre: 'constant',
        post: 'constant',
        staticValue: 0.25,
        locked: false,
        muted: false,
        deleted: null,
      });
      return 'crv_AttrRoll0000001' as CurveId;
    });
    expect(app.evaluation.channelValue(foot, '@roll')).toBe(0.25);
    edit(app, 'Key', (tx) => writeKeyAt(app, tx, curve, 0, 0.5, { in: 'linear', out: 'linear' }));
    expect(app.evaluation.channelValue(foot, '@roll')).toBe(0.5);
    app.session.setState({ overrides: new Map([[foot, { '@roll': -0.1 }]]) });
    expect(app.evaluation.channelValue(foot, '@roll')).toBe(-0.1);
    expect(app.evaluation.attrValues(foot)).toEqual({ ikFk: 1, soft: 0, roll: -0.1, reach: 0.5 });
    expect(app.evaluation.attrValues(WAVE.handL)).toEqual({});
  });

  it('the runtime samples attribute curves and overrides into its channel buffer', () => {
    const { app, foot } = attrApp();
    app.session.setState({ overrides: new Map([[foot, { '@soft': 0.2 }]]) });
    app.evaluation.tick();
    const runtime = app.characters.get(WAVE.character);
    if (runtime === undefined) throw new Error('no runtime');
    const slot = runtime.program.attrIndex.get(`${foot}/@soft`) as number;
    expect(runtime.channels.attrs[slot]).toBe(0.2);
    const ikFk = runtime.program.attrIndex.get(`${foot}/@ikFk`) as number;
    expect(runtime.channels.attrs[ikFk]).toBe(1);
  });

  it('ikFk is null without that limb (no ik2 solver compiled)', () => {
    const { app } = attrApp();
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBeNull();
  });

  it('ikFk reads the IK control’s @ikFk clamped to [0, 1], and 0 for a limb whose op is skipped (§5.4 rule 4)', () => {
    const foot = `${WAVE.rig}:fk.foot.L` as ControlId;
    const SOLVER = 'slv_LegL0000000000' as SolverId;
    let skipped = false;
    const asked: string[] = [];
    // A1 builds RigProgram.limbs; here the naive program gets one leg limb whose IK control is the left foot.
    const app = kernelApp({
      snapshot: waveDoc(),
      deps: (base) => ({
        ...base,
        rig: {
          ...base.rig,
          compileRig: (def, skeleton) => {
            const program = base.rig.compileRig(def, skeleton);
            const limb = { id: 'leg.L', solver: SOLVER, params: { ikControl: foot } } as unknown as LimbDesc;
            return Object.assign(Object.create(Object.getPrototypeOf(program) as object) as RigProgram, program, {
              limbs: [limb],
            });
          },
          isRigOpSkipped: (_program, id) => {
            asked.push(id);
            return skipped;
          },
        },
      }),
    });
    edit(app, 'Attributes', (tx) => tx.patch('controls', foot, { attrs: IK_ATTRS }));
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(1);
    expect(app.evaluation.ikFk(WAVE.character, 'arm.L')).toBeNull();
    app.session.setState({ overrides: new Map([[foot, { '@ikFk': 1.7 }]]) });
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(1);
    app.session.setState({ overrides: new Map([[foot, { '@ikFk': -0.2 }]]) });
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(0);
    app.session.setState({ overrides: new Map([[foot, { '@ikFk': 0.4 }]]) });
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(0.4);
    skipped = true;
    expect(app.evaluation.ikFk(WAVE.character, 'leg.L')).toBe(0);
    expect(asked.at(-1)).toBe(SOLVER);
  });
});

describe('the naive program (test kit) has the compiler’s attribute slot order', () => {
  it('orders slots by (control id, attribute name)', () => {
    const { app } = attrApp();
    const controls = app.store.query.controlsOfRig(WAVE.rig);
    const { slots } = naiveAttrSlots(controls);
    expect(slots.map((slot) => slot.name)).toEqual(['ikFk', 'reach', 'roll', 'soft']);
  });
});

describe('baselines: visibility rule 1, body parts, key targets (§5.5, §5.19)', () => {
  it('controlVisibility rule 1: hidden by the user, secondary while hidden by default, unknown', () => {
    const app = waveApp();
    expect(controlVisibility(app, WAVE.handL)).toBe('visible');
    app.session.setState({ hiddenControls: new Set([WAVE.handL]) });
    expect(controlVisibility(app, WAVE.handL)).toBe('hidden');
    edit(app, 'Secondary', (tx) => tx.patch('controls', WAVE.cog, { hiddenByDefault: true }));
    expect(controlVisibility(app, WAVE.cog)).toBe('hidden');
    app.session.setState({ showSecondary: true });
    expect(controlVisibility(app, WAVE.cog)).toBe('visible');
    expect(controlVisibility(app, 'rig_X:gone' as ControlId)).toBe('hidden');
  });

  it('bodyPartOf follows the template-key table and the nearest grouped ancestor', () => {
    const app = waveApp();
    const part = (key: string) => bodyPartOf(app, `${WAVE.rig}:${key}` as ControlId);
    expect(part('root')).toBe('root');
    expect(part('cog')).toBe('torso');
    expect(part('fk.upperChest')).toBe('torso');
    expect(part('fk.jaw')).toBe('head');
    expect(part('fk.shoulder.L')).toBe('arm.L');
    expect(part('fk.hand.R')).toBe('arm.R');
    expect(part('fk.indexProximal.L')).toBe('fingers.L');
    expect(part('fk.toes.R')).toBe('leg.R');
    expect(bodyPartOf(app, 'rig_X:gone' as ControlId)).toBeNull();
    // A control outside the table takes the part of its nearest grouped ancestor.
    const extra = `${WAVE.rig}:sec.hat` as ControlId;
    const head = app.store.get('controls', `${WAVE.rig}:fk.head` as ControlId);
    if (head === undefined) throw new Error('no head control');
    edit(app, 'Secondary', (tx) =>
      tx.put('controls', {
        ...head,
        id: extra,
        key: 'sec.hat',
        parent: `${WAVE.rig}:fk.head` as ControlId,
        drives: null,
        mirror: null,
        order: 'z0',
      }),
    );
    expect(bodyPartOf(app, extra)).toBe('head');
    // Generic rigs have no body parts.
    edit(app, 'Generic', (tx) =>
      tx.patch('rigs', WAVE.rig, { generator: { name: 'ekza-autorig-generic', version: '0.2.0' } }),
    );
    expect(part('fk.hand.L')).toBeNull();
  });

  it('keyTargetControls: selected, character (rule 1) and body part', () => {
    const app = waveApp();
    const id = (key: string) => `${WAVE.rig}:${key}` as ControlId;
    select(app, [id('fk.hand.L')]);
    expect(keyTargetControls(app, 'selected')).toEqual([id('fk.hand.L')]);
    expect(new Set(keyTargetControls(app, 'bodyPart'))).toEqual(
      new Set([id('fk.shoulder.L'), id('fk.upperArm.L'), id('fk.lowerArm.L'), id('fk.hand.L')]),
    );
    const all = keyTargetControls(app, 'character');
    expect(all).toHaveLength(app.store.query.controlsOfRig(WAVE.rig).length);
    app.session.setState({ hiddenControls: new Set([id('fk.upperArm.L'), id('fk.head')]) });
    expect(keyTargetControls(app, 'bodyPart')).not.toContain(id('fk.upperArm.L'));
    expect(keyTargetControls(app, 'character')).not.toContain(id('fk.head'));
    select(app, [id('fk.indexProximal.R'), id('fk.toes.L')]);
    expect(new Set(keyTargetControls(app, 'bodyPart'))).toEqual(
      new Set([id('fk.indexProximal.R'), id('fk.upperLeg.L'), id('fk.lowerLeg.L'), id('fk.foot.L'), id('fk.toes.L')]),
    );
    select(app, []);
    expect(keyTargetControls(app, 'bodyPart')).toEqual([]);
  });
});

describe('writeKeyAt options (§4.5)', () => {
  it('breakdown flags new keys; existing: set writes the flag, keep leaves it', () => {
    const app = waveApp();
    const curve = WAVE.curve;
    const tangents = { in: 'auto', out: 'auto' } as const;
    const created = edit(app, 'Breakdown', (tx) => writeKeyAt(app, tx, curve, 7, 0.1, tangents, { breakdown: true }));
    expect(app.store.get('keys', created)?.breakdown).toBe(true);
    const plain = edit(app, 'Key', (tx) => writeKeyAt(app, tx, curve, 20, 0.2, tangents));
    expect(app.store.get('keys', plain)).not.toHaveProperty('breakdown');
    // keep: a tween patch keeps the flag.
    edit(app, 'Patch', (tx) => writeKeyAt(app, tx, curve, 7, 0.3, tangents, { breakdown: false }));
    expect(app.store.get('keys', created)).toMatchObject({ v: 0.3, breakdown: true });
    // set: writes it either way.
    edit(app, 'Convert', (tx) => writeKeyAt(app, tx, curve, 7, 0.3, tangents, { breakdown: false, existing: 'set' }));
    expect(app.store.get('keys', created)).not.toHaveProperty('breakdown');
    edit(app, 'Convert', (tx) => writeKeyAt(app, tx, curve, 20, 0.2, tangents, { breakdown: true, existing: 'set' }));
    expect(app.store.get('keys', plain)?.breakdown).toBe(true);
    expect(keysOf(app, curve).map((key) => key.t)).toEqual([0, 7, 15, 20, 30]);
  });
});

describe('loop clips: cycle-aware engine (§5.23)', () => {
  const keys = (values: readonly [number, number][], type: KeyData['inType'] = 'auto'): KeyData[] =>
    values.map(([t, v]) => ({
      t,
      v,
      inType: type,
      outType: type,
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    }));
  /** One-sided slopes at the seam from the exact Bézier control points of the end segments. */
  const seamSlopes = (curve: AnimCurve) => {
    const compiled = EDITOR_CURVE_ENGINE.compile(curve);
    const points = new Float64Array(8);
    segmentControlPoints(compiled, compiled.keyCount - 2, points);
    const left = ((points[7] as number) - (points[5] as number)) / ((points[6] as number) - (points[4] as number));
    segmentControlPoints(compiled, 0, points);
    const right = ((points[3] as number) - (points[1] as number)) / ((points[2] as number) - (points[0] as number));
    return { left, right };
  };

  it('a cycling curve is C¹ at the seam (1e-9)', () => {
    const curve: AnimCurve = {
      keys: keys([
        [0, 0],
        [6, 0.02],
        [12, 0],
        [18, -0.02],
        [24, 0],
      ]),
      weighted: false,
      pre: 'cycle',
      post: 'cycle',
    };
    const { left, right } = seamSlopes(curve);
    expect(Math.abs(left - right)).toBeLessThan(1e-9);
    expect(Math.abs(right)).toBeGreaterThan(1e-4);
    // The plain AnimX engine eases out flat at the end keys (the M1 hitch).
    const plain = curveEngine.compile(curve);
    expect(plain.outSlope[0]).toBe(0);
    // The value at the seam is continuous too.
    const c = EDITOR_CURVE_ENGINE.compile(curve);
    expect(EDITOR_CURVE_ENGINE.evaluate(c, 24 - 1e-9)).toBeCloseTo(EDITOR_CURVE_ENGINE.evaluate(c, 24 + 1e-9), 7);
  });

  it('curves with a constant infinity evaluate bit-identically to M1', () => {
    const arb = fc.array(fc.tuple(fc.integer({ min: 0, max: 60 }), fc.double({ min: -2, max: 2, noNaN: true })), {
      minLength: 2,
      maxLength: 8,
    });
    fc.assert(
      fc.property(arb, fc.constantFrom('constant', 'linear', 'cycle', 'oscillate'), (raw, post) => {
        const unique = [...new Map(raw.map(([t, v]) => [t, v])).entries()].sort((a, b) => a[0] - b[0]);
        if (unique.length < 2) return;
        const curve: AnimCurve = { keys: keys(unique), weighted: false, pre: 'constant', post };
        const a = EDITOR_CURVE_ENGINE.compile(curve);
        const b = compileAnimCurve(curve);
        for (let f = -10; f <= 70; f += 0.5) {
          expect(Object.is(EDITOR_CURVE_ENGINE.evaluate(a, f), evaluateAnimCurve(b, f))).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('the test kit’s naive engine applies the same option', () => {
    const curve: AnimCurve = {
      keys: keys([
        [0, 0],
        [6, 1],
        [12, 0],
        [18, -1],
        [24, 0],
      ]),
      weighted: false,
      pre: 'cycle',
      post: 'cycle',
    };
    const aware = naiveCycleAwareCurveEngine.compile(curve);
    expect(aware.outSlope[0]).toBeCloseTo(aware.inSlope[4] as number, 12);
    expect(Math.abs(aware.outSlope[0] as number)).toBeGreaterThan(0);
    expect(naiveCurveEngine.compile(curve).outSlope[0]).toBe(0);
    const constant = { ...curve, pre: 'constant' as const };
    expect([...naiveCycleAwareCurveEngine.compile(constant).outSlope]).toEqual([
      ...naiveCurveEngine.compile(constant).outSlope,
    ]);
  });

  it('keying a loop clip creates cycling curves (key.set → ensureCurve)', async () => {
    const app = waveApp();
    registerBuiltinOperators(app);
    expect(app.store.get('clips', WAVE.clip)?.loop).toBe(true);
    select(app, [WAVE.handL]);
    const result = await app.run('key.set', { channels: 'rotate' });
    expect(result.status).toBe('finished');
    const base = app.store.query.baseLayer(WAVE.clip);
    const curve = base === undefined ? undefined : app.store.query.curveFor(WAVE.clip, base.id, WAVE.handL, 'rx');
    expect(curve).toMatchObject({ pre: 'cycle', post: 'cycle' });
    // Existing curves keep their infinities.
    expect(app.store.get('curves', WAVE.curve)).toMatchObject({ pre: 'constant', post: 'constant' });
  });
});

describe('former contract stubs (§3 rule 1)', () => {
  it('are implemented at integration: none throws EkzaError("not-implemented")', () => {
    const app = waveApp();
    const code = (fn: () => unknown): string | null => {
      try {
        fn();
        return null;
      } catch (error) {
        return error instanceof EkzaError ? `${error.code}:${error.message}` : 'other';
      }
    };
    edit(app, 'Stubs', (tx) => {
      // A4 landed scaleKeyValues and tweenEdits (m2a-a4-edit.test.ts); A3 copyKeys and insertTime (m2a-timing.test.ts).
      expect(code(() => scaleKeyValues(app, tx, [], 0, 1))).toBeNull();
      expect(copyKeys(app, tx, [] as KeyId[], 1, { snap: true, resolveCollisions: true })).toEqual({
        created: [],
        deleted: [],
      });
      expect(insertTime(app, tx, [], 0, 1)).toEqual({ moved: 0, deleted: [] });
    });
    expect(code(() => tweenEdits(app, 'tween', 0, { kind: 'keys', keys: [] }))).toBeNull();
  });
});
