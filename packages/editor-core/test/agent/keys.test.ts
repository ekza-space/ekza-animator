// MCP-SPEC §4.10 (P1): `key.write`, `key.delete`, `key.adjust`, `key.retime` — poll, apply, undo/redo exact, stored
// units, explicit targets only (the user's selection, band and override stay), out-of-range frames and
// `extendRange`, the §5.5 limits.
import type { CurveId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { internalsOf } from '../../src/app/internals';
import {
  AGENT,
  agentOk,
  agentRefusal,
  asAgent,
  changedFields,
  DEG,
  expectAgentUndoRedoExact,
  keysOf,
  opsApp,
  runAgent,
  seedUser,
  sessionRecord,
  WAVE,
  waveCurve,
} from './support';

const ARM = WAVE.lowerArmL;
const UPPER = WAVE.upperArmL;

/** Element-wise toBeCloseTo (12 digits). */
function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 12));
}

describe('key.write', () => {
  it('writes keys in stored units at explicit frames, one AI step, never touching the user session', async () => {
    const app = opsApp();
    seedUser(app);
    const { value } = await expectAgentUndoRedoExact(app, 'key.write', {
      clip: WAVE.clip,
      keys: [
        { control: UPPER, channel: 'rz', frame: 5, value: 20 * DEG },
        { control: ARM, channel: 'rz', frame: 15, value: 0.25 },
      ],
      label: 'Set keys (2 on 2 curves)',
    });
    expect(value).toEqual({ written: 2, curvesCreated: 1, rangeExtended: false, hiddenByOverrides: [] });
    expect(keysOf(app, waveCurve(app, UPPER, 'rz'))).toEqual([[5, Math.round(20 * DEG * 1e9) / 1e9]]);
    expect(keysOf(app, waveCurve(app, ARM, 'rz'))[1]).toEqual([15, 0.25]);
    expect(app.history.peekUndo()?.label).toBe('AI: Set keys (2 on 2 curves)');
    expect(app.history.peekUndo()?.actor).toEqual(AGENT);
  });

  it('keys the keyed pose without the user overrides (poseAt) and reports hidden keys', async () => {
    const app = opsApp();
    seedUser(app);
    // The user overrides fk.hand.L rx at frame 12 of the wave clip: a key there is hidden behind it.
    const value = (await agentOk(app, 'key.write', {
      clip: WAVE.clip,
      poseAt: { controls: [WAVE.handL, ARM], frames: [12], channels: 'rotate' },
    })) as { written: number; hiddenByOverrides: unknown[] };
    expect(value.written).toBe(6);
    expect(value.hiddenByOverrides).toEqual([{ control: WAVE.handL, channel: 'rx' }]);
    // The key holds the keyed value (0), not the override (10°); the arm keeps its curve value at 12.
    expect(keysOf(app, waveCurve(app, WAVE.handL, 'rx'))).toEqual([[12, 0]]);
    const engine = internalsOf(app).deps.curves.engine;
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    const at12 = app.store.query.keysOfCurve(arm).find((key) => key.t === 12)?.v;
    expect(at12).toBeCloseTo(engine.evaluate(app.evaluation.compiledCurve(arm), 12), 12);
    expect(app.session.getState().overrides.get(WAVE.handL)).toEqual({ rx: 10 * DEG });
  });

  it('refuses frames outside the clip unless extendRange, and never grows a range beyond 100,000 frames', async () => {
    const app = opsApp();
    const at = (frame: number, extendRange?: boolean) => ({
      clip: WAVE.clip,
      keys: [{ control: ARM, channel: 'rz', frame, value: 0 }],
      ...(extendRange === undefined ? {} : { extendRange }),
    });
    expect(await agentRefusal(app, 'key.write', at(40))).toMatch(/outside the clip range 0…30.*extendRange/);
    expect(await agentOk(app, 'key.write', at(40, true))).toMatchObject({ rangeExtended: true });
    expect(app.store.get('clips', WAVE.clip)?.range).toEqual({ start: 0, end: 40 });
    expect(await agentRefusal(app, 'key.write', at(-99_999, true))).toMatch(/beyond 100000 frames/);
    expect(await agentRefusal(app, 'key.write', at(100_001, true))).toMatch(/±100000/);
  });

  it('polls the shape: one of keys/poseAt, known channels, unlocked keyable channels, the limits', async () => {
    const app = opsApp();
    const base = { clip: WAVE.clip };
    expect(await agentRefusal(app, 'key.write', base)).toBe('expects exactly one of keys or poseAt');
    expect(await agentRefusal(app, 'key.write', { clip: 'clp_nope', keys: [] })).toBe('The clip does not exist');
    expect(await agentRefusal(app, 'key.write', { ...base, keys: [] })).toBe('keys is empty');
    const key = (channel: string) => ({ ...base, keys: [{ control: ARM, channel, frame: 1, value: 0 }] });
    expect(await agentRefusal(app, 'key.write', key('qx'))).toMatch(/unknown channel/);
    expect(await agentRefusal(app, 'key.write', key('@nope'))).toMatch(/not keyable/);
    await app.runUntyped('channel.toggleLock', { refs: [{ control: ARM, channel: 'rx' }], locked: true });
    expect(await agentRefusal(app, 'key.write', key('rx'))).toMatch(/fk\.lowerArm\.L\.rx is locked/);
    const many = Array.from({ length: 50_001 }, (_, i) => ({ control: ARM, channel: 'rz', frame: i % 30, value: 0 }));
    expect(await agentRefusal(app, 'key.write', { ...base, keys: many })).toMatch(/more than 50000/);
    expect(
      await agentRefusal(app, 'key.write', { ...base, poseAt: { controls: [ARM], frames: [1], channels: 'selected' } }),
    ).toMatch(/selection/);
  });

  it('sets explicit tangents and the breakdown flag, also on a key that is already there', async () => {
    const app = opsApp();
    await agentOk(app, 'key.write', {
      clip: WAVE.clip,
      keys: [{ control: ARM, channel: 'rz', frame: 15, value: 0, inType: 'linear', outType: 'step', breakdown: true }],
    });
    const key = app.store.query.keysOfCurve(waveCurve(app, ARM, 'rz') as CurveId)[1];
    expect(key).toMatchObject({ t: 15, v: 0, inType: 'linear', outType: 'step', breakdown: true });
  });
});

describe('key.delete', () => {
  it('deletes keys at frames or in a range on the targets only', async () => {
    const app = opsApp();
    seedUser(app);
    await agentOk(app, 'key.write', {
      clip: WAVE.clip,
      keys: [10, 20].map((frame) => ({ control: UPPER, channel: 'rz', frame, value: frame * DEG })),
    });
    const { value } = await expectAgentUndoRedoExact(app, 'key.delete', {
      clip: WAVE.clip,
      targets: [{ control: ARM, channel: 'rz' }],
      frames: [0],
    });
    expect(value).toEqual({ deleted: 1 });
    expect(keysOf(app, waveCurve(app, ARM, 'rz')).map(([t]) => t)).toEqual([15, 30]);
    expect(keysOf(app, waveCurve(app, UPPER, 'rz')).map(([t]) => t)).toEqual([10, 20]);
    await agentOk(app, 'key.delete', {
      clip: WAVE.clip,
      targets: [{ control: UPPER, channel: 'rz' }],
      range: { start: 0, end: 12 },
    });
    expect(keysOf(app, waveCurve(app, UPPER, 'rz')).map(([t]) => t)).toEqual([20]);
  });

  it('keeps the value at the clip start as the static value when a curve loses its last key', async () => {
    const app = opsApp();
    seedUser(app); // the user's frame is 12: the static value does not depend on it
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    await agentOk(app, 'key.delete', { clip: WAVE.clip, targets: [{ control: ARM, channel: 'rz' }] });
    expect(app.store.query.keysOfCurve(arm)).toEqual([]);
    expect(app.store.get('curves', arm)?.staticValue).toBeCloseTo(30 * DEG, 12);
  });

  it('polls targets, frames xor range', async () => {
    const app = opsApp();
    const t = [{ control: ARM, channel: 'rz' }];
    expect(await agentRefusal(app, 'key.delete', { clip: WAVE.clip, targets: [] })).toBe('targets is empty');
    expect(
      await agentRefusal(app, 'key.delete', { clip: WAVE.clip, targets: t, frames: [1], range: { start: 0, end: 1 } }),
    ).toBe('expects frames or range, not both');
    expect(
      await agentRefusal(app, 'key.delete', { clip: WAVE.clip, targets: [{ control: 'rig_x:nope', channel: 'rz' }] }),
    ).toMatch(/not one of the clip's character/);
  });
});

describe('key.adjust', () => {
  const targets = [{ control: ARM, channel: 'rz' }];

  it('scales values about the rest value and keeps tangent shapes (slopes scaled, types kept)', async () => {
    const app = opsApp();
    seedUser(app);
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    // Fixed handles on the middle key so the slope scaling is visible.
    const middle = app.store.query.keysOfCurve(arm)[1];
    if (middle === undefined) throw new Error('no key');
    app.store.transact({ label: 'setup' }, (tx) => {
      tx.put('keys', {
        ...middle,
        inType: 'fixed',
        outType: 'fixed',
        inHandle: { dt: -5, dv: 0.1 },
        outHandle: { dt: 5, dv: -0.2 },
      });
    });
    const { value } = await expectAgentUndoRedoExact(app, 'key.adjust', { clip: WAVE.clip, targets, factor: 1.5 });
    expect(value).toEqual({ keys: 3, curves: 1, skipped: [] });
    const keys = app.store.query.keysOfCurve(arm);
    expectClose(
      keys.map((key) => key.v),
      [45 * DEG, -45 * DEG, 45 * DEG],
    );
    expect(keys[1]).toMatchObject({ inType: 'fixed', outType: 'fixed', inHandle: { dt: -5 }, outHandle: { dt: 5 } });
    expect(keys[1]?.inHandle.dv).toBeCloseTo(0.15, 12);
    expect(keys[1]?.outHandle.dv).toBeCloseTo(-0.3, 12);
  });

  it('pivots about the mean, a frame or a value, and offsets per channel kind', async () => {
    const app = opsApp();
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    const engine = internalsOf(app).deps.curves.engine;
    const compiled = app.evaluation.compiledCurve(arm);
    let sum = 0;
    for (let f = 0; f <= 30; f++) sum += engine.evaluate(compiled, f);
    const mean = sum / 31;
    await agentOk(app, 'key.adjust', { clip: WAVE.clip, targets, factor: 2, pivot: { kind: 'mean' } });
    expect(app.store.query.keysOfCurve(arm)[0]?.v).toBeCloseTo(mean + 2 * (30 * DEG - mean), 12);
    const app2 = opsApp();
    await agentOk(app2, 'key.adjust', { clip: WAVE.clip, targets, factor: 0.5, pivot: { kind: 'frame', frame: 15 } });
    expectClose(
      app2.store.query.keysOfCurve(arm).map((k) => k.v),
      [0, -30 * DEG, 0],
    );
    const app3 = opsApp();
    await agentOk(app3, 'key.write', {
      clip: WAVE.clip,
      keys: [{ control: WAVE.cog, channel: 'ty', frame: 0, value: 0.1 }],
    });
    await agentOk(app3, 'key.adjust', {
      clip: WAVE.clip,
      targets: [...targets, { control: WAVE.cog, channel: 'ty' }],
      offset: { rotate: 10 * DEG, translate: -0.03 },
    });
    expect(app3.store.query.keysOfCurve(arm)[0]?.v).toBeCloseTo(40 * DEG, 12);
    expect(keysOf(app3, waveCurve(app3, WAVE.cog, 'ty'))).toEqual([[0, 0.07]]);
  });

  it('fades the change over falloffFrames outside the range; only keys at frames with frames', async () => {
    const app = opsApp();
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    await agentOk(app, 'key.adjust', {
      clip: WAVE.clip,
      targets,
      range: { start: 10, end: 20 },
      falloffFrames: 20,
      offset: { rotate: 0.2 },
    });
    // 15 inside (1), 0 and 30 at distance 10 of 20 (0.5).
    expect(app.store.query.keysOfCurve(arm)).toHaveLength(3);
    expectClose(
      app.store.query.keysOfCurve(arm).map((k) => k.v),
      [30 * DEG + 0.1, -30 * DEG + 0.2, 30 * DEG + 0.1],
    );
    const app2 = opsApp();
    await agentOk(app2, 'key.adjust', { clip: WAVE.clip, targets, frames: [30], offset: { rotate: 0.2 } });
    expectClose(
      app2.store.query.keysOfCurve(arm).map((k) => k.v),
      [30 * DEG, -30 * DEG, 30 * DEG + 0.2],
    );
  });

  it('skips and reports locked and static channels', async () => {
    const app = opsApp();
    await app.runUntyped('channel.toggleLock', { refs: [{ control: UPPER, channel: 'rz' }], locked: true });
    const value = await agentOk(app, 'key.adjust', {
      clip: WAVE.clip,
      targets: [...targets, { control: UPPER, channel: 'rz' }, { control: UPPER, channel: 'rx' }],
      factor: 1.1,
    });
    expect(value).toEqual({
      keys: 3,
      curves: 1,
      skipped: [
        { control: UPPER, channel: 'rz', reason: 'locked' },
        { control: UPPER, channel: 'rx', reason: 'no_keys' },
      ],
    });
  });

  it('polls factor bounds, offsets, pivots and that something changes', async () => {
    const app = opsApp();
    const base = { clip: WAVE.clip, targets };
    expect(await agentRefusal(app, 'key.adjust', base)).toBe('Nothing to adjust: pass factor or offset');
    expect(await agentRefusal(app, 'key.adjust', { ...base, factor: 0.001 })).toBe('factor must lie in 0.01…100');
    expect(await agentRefusal(app, 'key.adjust', { ...base, offset: { rotate: 100 } })).toMatch(/offset\.rotate/);
    expect(await agentRefusal(app, 'key.adjust', { ...base, factor: 2, pivot: { kind: 'median' } })).toMatch(/pivot/);
    expect(
      await agentRefusal(app, 'key.adjust', {
        ...base,
        factor: 2,
        pivot: { kind: 'mean' },
        range: { start: -60_000, end: 60_000 },
      }),
    ).toMatch(/samples at most 100000 frames/);
  });
});

describe('key.retime', () => {
  const targets = [{ control: ARM, channel: 'rz' }];

  it('offsets keys by frames', async () => {
    const app = opsApp();
    seedUser(app);
    const { value } = await expectAgentUndoRedoExact(app, 'key.retime', {
      clip: WAVE.clip,
      targets,
      mode: 'offset',
      offset: 2,
    });
    expect(value).toEqual({ moved: 3, merged: 0, clamped: 0, snapped: 0, contactFrame: null });
    expect(keysOf(app, waveCurve(app, ARM, 'rz')).map(([t]) => t)).toEqual([2, 17, 32]);
  });

  it('scales about a pivot, snaps to whole frames and merges collisions (the later key wins)', async () => {
    const app = opsApp();
    await agentOk(app, 'key.write', {
      clip: WAVE.clip,
      keys: [1, 2, 3].map((frame) => ({ control: UPPER, channel: 'rz', frame, value: frame })),
    });
    const value = await agentOk(app, 'key.retime', {
      clip: WAVE.clip,
      targets: [{ control: UPPER, channel: 'rz' }],
      mode: 'scale',
      factor: 0.5,
      pivot: 0,
    });
    // 1 → 0.5 → 1 (snapped), 2 → 1 (collides with it), 3 → 1.5 → 2 (snapped).
    expect(value).toMatchObject({ merged: 1, snapped: 2 });
    expect(keysOf(app, waveCurve(app, UPPER, 'rz')).map(([t]) => t)).toEqual([1, 2]);
  });

  it('inserts and deletes time after a frame', async () => {
    const app = opsApp();
    await agentOk(app, 'key.retime', { clip: WAVE.clip, targets, mode: 'insertTime', at: 10, frames: 5 });
    expect(keysOf(app, waveCurve(app, ARM, 'rz')).map(([t]) => t)).toEqual([0, 20, 35]);
    const value = await agentOk(app, 'key.retime', { clip: WAVE.clip, targets, mode: 'deleteTime', at: 0, frames: 20 });
    expect(value).toMatchObject({ moved: 1, merged: 1 });
    expect(keysOf(app, waveCurve(app, ARM, 'rz')).map(([t]) => t)).toEqual([0, 15]);
  });

  it('wraps an offset on a loop clip (the cyclic offset) and keeps the loop closed', async () => {
    const app = opsApp();
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    const engine = internalsOf(app).deps.curves.engine;
    const old = app.evaluation.compiledCurve(arm);
    const before = Array.from({ length: 31 }, (_, f) => engine.evaluate(old, f));
    await agentOk(app, 'key.retime', { clip: WAVE.clip, targets, mode: 'offset', offset: 10, wrap: true });
    const keys = app.store.query.keysOfCurve(arm);
    expect(keys.map((key) => key.t)).toEqual([0, 10, 25, 30]);
    expect(keys[0]?.v).toBeCloseTo(keys[3]?.v ?? Number.NaN, 12);
    // The keys moved by 10 frames, those past the end came in at the start.
    expect(keys[1]?.v).toBeCloseTo(before[0] as number, 12);
    expect(keys[2]?.v).toBeCloseTo(before[15] as number, 12);
    expect(keys[0]?.v).toBeCloseTo(before[20] as number, 12);
    const noLoop = opsApp();
    await noLoop.runUntyped('clip.setSettings', { clip: WAVE.clip, loop: false });
    expect(
      await agentRefusal(noLoop, 'key.retime', { clip: WAVE.clip, targets, mode: 'offset', offset: 1, wrap: true }),
    ).toMatch(/loop clip/);
  });

  it('retimes breakdowns proportionally, unless retimeBreakdowns is false', async () => {
    const run = async (retimeBreakdowns?: boolean) => {
      const app = opsApp();
      await agentOk(app, 'key.write', {
        clip: WAVE.clip,
        keys: [{ control: ARM, channel: 'rz', frame: 20, value: 0, breakdown: true }],
      });
      // The anchors 0, 15 and 30 scale about 0; the breakdown at 20 (a third of the way from 15 to 30) follows them.
      await agentOk(app, 'key.retime', {
        clip: WAVE.clip,
        targets,
        mode: 'scale',
        factor: 2,
        pivot: 0,
        ...(retimeBreakdowns === undefined ? {} : { retimeBreakdowns }),
      });
      return keysOf(app, waveCurve(app, ARM, 'rz')).map(([t]) => t);
    };
    expect(await run()).toEqual([0, 30, 40, 60]);
    // Without retiming the breakdown stays at 20 and stops the key from 15 short of it (one clamped key).
    expect(await run(false)).toEqual([0, 19, 20, 60]);
  });

  it('moves the contact frame with an offset or scale of every keyed curve', async () => {
    const app = opsApp();
    await app.runUntyped('clip.setSettings', { clip: WAVE.clip, contact: 10 });
    const value = await agentOk(app, 'key.retime', { clip: WAVE.clip, targets, mode: 'offset', offset: 3 });
    expect(value).toMatchObject({ contactFrame: 13 });
    expect(app.store.get('clips', WAVE.clip)?.contact).toBe(13);
  });

  it('polls modes, bounds and the stretch warp', async () => {
    const app = opsApp();
    const base = { clip: WAVE.clip, targets };
    expect(await agentRefusal(app, 'key.retime', { ...base, mode: 'offset' })).toMatch(/offset must be/);
    expect(await agentRefusal(app, 'key.retime', { ...base, mode: 'scale', factor: 0 })).toMatch(/0\.01…100/);
    expect(await agentRefusal(app, 'key.retime', { ...base, mode: 'insertTime', at: 0, frames: -1 })).toMatch(
      /positive/,
    );
    expect(await agentRefusal(app, 'key.retime', { ...base, mode: 'warp', warp: [[0, 0]] })).toMatch(
      /not available yet/,
    );
  });
});

describe('explicit targets only', () => {
  it('never reads or writes the user selection: a run with an agent context changes nothing it names not', async () => {
    const app = opsApp();
    seedUser(app);
    const before = sessionRecord(app);
    // The user's selected key (15 on the arm) is not a target of this call.
    const result = await runAgent(
      app,
      'key.delete',
      { clip: WAVE.clip, targets: [{ control: UPPER, channel: 'rz' }] },
      asAgent(),
    );
    expect(result).toEqual({ status: 'finished', value: { deleted: 0 } });
    expect(changedFields(before, sessionRecord(app))).toEqual([]);
    expect(app.store.query.keysOfCurve(waveCurve(app, ARM, 'rz') as CurveId)).toHaveLength(3);
  });
});
