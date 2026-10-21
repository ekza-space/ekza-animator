// M2A-SPEC §5.14 / §9.2: the mirror kernel under random curves. Half-cycle remap (`halfCycleKeys`) with the
// production AnimX engine: the FR-POSE-05 gate at every integer frame for periodic curves of every tangent type
// (step and stepNext included), weighted curves, every infinity and random ranges; time order and range of the
// written keys; the non-periodic flag; the remap applied twice is the identity. Flip through the operator:
// flip ∘ flip = id on random curves (values, handles, tangent types, weighting, infinities, breakdowns).
import type { AnimCurve, Handle, InfinityMode, KeyData, TangentType } from '@ekza-studio/anim-core';
import type { ChannelId, ControlId, CurveId } from '@ekza-studio/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { internalsOf } from '../../src/app/internals';
import { ensureCurve } from '../../src/edit/keys';
import type { EditorApp } from '../../src/types';
import { halfCycleKeys } from '../../src/workflows/mirrorAnimation';
import { opsApp, runOk, WAVE } from './support';

// An app object the kernel did not build gets the production bindings (`internalsOf`): the real engine and insert.
const productionApp = {} as EditorApp;
const engine = internalsOf(productionApp).deps.curves.engine;

const GATE = 1e-9;
const TANGENTS: readonly TangentType[] = [
  'auto',
  'autoEase',
  'autoMix',
  'spline',
  'clamped',
  'plateau',
  'linear',
  'flat',
  'step',
  'stepNext',
  'fixed',
];
const INFINITIES: readonly InfinityMode[] = ['constant', 'linear', 'cycle', 'cycleOffset', 'oscillate'];
const isCyclic = (mode: InfinityMode): boolean => mode === 'cycle' || mode === 'cycleOffset' || mode === 'oscillate';

interface Range {
  readonly start: number;
  readonly end: number;
}

const key = (t: number, v: number, inType: TangentType, outType: TangentType = inType): KeyData => ({
  t,
  v,
  inType,
  outType,
  inHandle: { dt: 0, dv: 0 },
  outHandle: { dt: 0, dv: 0 },
  broken: false,
  weightLocked: true,
});

const curveOf = (keys: readonly KeyData[], infinity: InfinityMode = 'constant', weighted = false): AnimCurve => ({
  keys,
  weighted,
  pre: infinity,
  post: infinity,
});

/**
 * Tolerance on spans AnimX had to correct (a weighted handle longer than its span: the monotonic-X correction puts the
 * control polygon on the boundary where X(u) is stationary, so the inverse X(u) = t is ill-conditioned). The remap
 * itself is exact there (it freezes the handles the engine started from, so the copy is corrected the same way); what
 * remains is anim-core's: its shape-preserving split of such a span and AnimX's cycle mapping are accurate to a few
 * 1e-9 there (worst 6.2e-9 over 10⁵ random corrected curves), not to 1e-13 as everywhere else.
 */
const CORRECTED_GATE = 1e-7;

/** True when the engine's monotonic-X correction changed a handle of a weighted span of `curve`. */
function hasCorrectedSpan(curve: AnimCurve): boolean {
  if (!curve.weighted) return false;
  const compiled = engine.compile(curve);
  const keys = curve.keys;
  return keys.some((key, i) => {
    const prev = keys[i - 1];
    const span = prev !== undefined ? key.t - prev.t : (keys[i + 1]?.t ?? key.t + 1) - key.t;
    const inDt = key.inType === 'fixed' ? key.inHandle.dt : -(span * (1.0 / 3.0));
    return compiled.inDt[i] !== inDt || (key.outType === 'fixed' && compiled.outDt[i] !== key.outHandle.dt);
  });
}

const gateOf = (curve: AnimCurve): number => (hasCorrectedSpan(curve) ? CORRECTED_GATE : GATE);

/** Largest |R(s + ((t − s + T/2) mod T)) − L(t)| over the integer frames t ∈ [s, e). */
function gateError(source: AnimCurve, mapped: readonly KeyData[], range: Range): number {
  const left = engine.compile(source);
  const right = engine.compile({ ...source, keys: mapped });
  const T = range.end - range.start;
  let worst = 0;
  for (let t = range.start; t < range.end; t++) {
    const at = range.start + ((t - range.start + T / 2) % T);
    worst = Math.max(worst, Math.abs(engine.evaluate(right, at) - engine.evaluate(left, t)));
  }
  return worst;
}

/** Values at every integer frame of [s, e], for comparing two curves. */
function framesOf(curve: AnimCurve, range: Range): number[] {
  const compiled = engine.compile(curve);
  const out: number[] = [];
  for (let t = range.start; t <= range.end; t++) out.push(engine.evaluate(compiled, t));
  return out;
}

describe('halfCycleKeys on stepped curves (§5.14: step flags map with their spans)', () => {
  const range = { start: 0, end: 24 };

  it('keys 0/12/24 stepped (values 0/1/0): exact at every frame, the seam keys keep step', () => {
    const curve = curveOf([key(0, 0, 'flat', 'step'), key(12, 1, 'flat', 'step'), key(24, 0, 'flat', 'step')]);
    const { keys, periodic } = halfCycleKeys(productionApp, curve, range);
    expect(periodic).toBe(true);
    expect(gateError(curve, keys, range)).toBeLessThanOrEqual(GATE);
    expect(keys.map((k) => [k.t, k.v, k.outType])).toEqual([
      [0, 1, 'step'],
      [12, 0, 'step'],
      [24, 1, 'step'],
    ]);
  });

  it('keys 0/6/18/24 stepped: the key inserted at m sits inside a step span and holds its value', () => {
    const curve = curveOf([key(0, 0, 'flat', 'step'), key(6, 1, 'flat', 'step'), key(18, -1, 'flat', 'step')]);
    const closed = curveOf([...curve.keys, key(24, 0, 'flat', 'step')]);
    expect(gateError(closed, halfCycleKeys(productionApp, closed, range).keys, range)).toBeLessThanOrEqual(GATE);
    // Without a key at 24 the constant post-infinity holds −1 at 24 ≠ 0 at 0: the curve does not loop.
    expect(halfCycleKeys(productionApp, curve, range).periodic).toBe(false);
    const { keys } = halfCycleKeys(productionApp, closed, range);
    expect(keys.map((k) => [k.t, k.v, k.outType])).toEqual([
      [0, 1, 'step'],
      [6, -1, 'step'],
      [12, 0, 'step'],
      [18, 1, 'step'],
      [24, 1, 'step'],
    ]);
  });

  it('stepNext curves (0/12/24 and 0/6/18/24), a mix with Bézier spans, an odd range and an offset range', () => {
    const cases: readonly { readonly curve: AnimCurve; readonly range: Range }[] = [
      {
        curve: curveOf([key(0, 0, 'flat', 'stepNext'), key(12, 1, 'flat', 'stepNext'), key(24, 0, 'flat', 'stepNext')]),
        range,
      },
      {
        curve: curveOf([
          key(0, 0, 'flat', 'stepNext'),
          key(6, 1, 'flat', 'stepNext'),
          key(18, -1, 'flat', 'stepNext'),
          key(24, 0, 'flat', 'stepNext'),
        ]),
        range,
      },
      {
        curve: curveOf(
          [
            key(0, 0.2, 'auto', 'step'),
            key(5, 0.7, 'auto'),
            key(11, -0.3, 'flat', 'stepNext'),
            key(17, 0.4, 'linear'),
            key(24, 0.2, 'linear', 'step'),
          ],
          'cycle',
        ),
        range,
      },
      {
        curve: curveOf([key(0, 0, 'flat', 'step'), key(7, 1, 'auto', 'stepNext'), key(25, 0, 'auto', 'step')]),
        range: { start: 0, end: 25 },
      },
      {
        curve: curveOf([key(4, 0.5, 'spline', 'step'), key(16, -0.5, 'flat', 'stepNext'), key(28, 0.5, 'linear')]),
        range: { start: 10, end: 34 },
      },
    ];
    for (const { curve, range: r } of cases) {
      const { keys, periodic } = halfCycleKeys(productionApp, curve, r);
      const values = framesOf(curve, r);
      expect([r, periodic]).toEqual([r, Math.abs((values[0] as number) - (values.at(-1) as number)) <= GATE]);
      expect([r, periodic ? gateError(curve, keys, r) : 0]).toEqual([r, expect.closeTo(0, 9)]);
    }
  });

  it('a weighted seam key whose handle AnimX corrects (longer than its span) stays exact (1e-9)', () => {
    // The seam at m = 12 has a 4-frame out handle over a 1.25-frame span. Freezing the corrected handle let AnimX
    // correct it a second time, on the other branch (7.9e-6 off at f13); the handle the engine started from is exact.
    const fixedKey = (t: number, v: number, inHandle: Handle, outHandle: Handle, outType: TangentType = 'fixed') => ({
      ...key(t, v, 'fixed', outType),
      inHandle,
      outHandle,
      broken: true,
    });
    const curve = curveOf(
      [
        fixedKey(8, 2, { dt: -0.45, dv: 0 }, { dt: 0.84, dv: 0 }, 'step'),
        key(9.25, 0, 'clamped', 'auto'),
        fixedKey(12, 0, { dt: -0.19, dv: 0 }, { dt: 4, dv: 0 }),
        { ...key(13.25, -2, 'fixed', 'spline'), inHandle: { dt: -0.15, dv: 0 } },
        key(15.75, 0, 'flat', 'plateau'),
        key(16, 2, 'spline', 'plateau'),
      ],
      'constant',
      true,
    );
    const range8 = { start: 8, end: 16 };
    expect(hasCorrectedSpan(curve)).toBe(true);
    const { keys, periodic } = halfCycleKeys(productionApp, curve, range8);
    expect(periodic).toBe(true);
    expect(gateError(curve, keys, range8)).toBeLessThanOrEqual(GATE);
    // the key landing at s carries m's stored 4-frame handle, not the corrected one
    expect(keys[0]?.outHandle).toEqual({ dt: 4, dv: 0 });
  });

  it('pose.mirrorAnimation leftToRight with half cycle keeps a stepped curve stepped', async () => {
    const app = opsApp();
    const left = WAVE.upperArmL;
    const right = `${WAVE.rig}:fk.upperArm.R` as ControlId;
    app.store.transact({ label: 'setup' }, (tx) => {
      tx.patch('clips', WAVE.clip, { range: { start: 0, end: 24 }, loop: true });
      const curve = ensureCurve(app, tx, WAVE.clip, left, 'rx');
      for (const k of tx.query.keysOfCurve(curve)) tx.remove('keys', k.id);
      [key(0, 0, 'flat', 'step'), key(6, 1, 'flat', 'step'), key(18, -1, 'flat', 'step'), key(24, 0, 'flat', 'step')]
        .map((data, i) => ({ ...data, id: `k_step${i}` as never, clip: WAVE.clip, curve }))
        .forEach((record) => tx.put('keys', record));
    });
    await runOk(app, 'pose.mirrorAnimation', { mode: 'leftToRight', offset: 'halfCycle', controls: [left] });
    const valueAt = (control: ControlId, t: number): number => {
      const layer = app.store.query.baseLayer(WAVE.clip);
      const curve = layer && app.store.query.curveFor(WAVE.clip, layer.id, control, 'rx');
      if (curve === undefined) throw new Error('no curve');
      return engine.evaluate(app.evaluation.compiledCurve(curve.id), t);
    };
    for (let t = 0; t < 24; t++) {
      expect([t, valueAt(right, (t + 12) % 24)]).toEqual([t, expect.closeTo(valueAt(left, t), 9)]);
    }
  });
});

// ---------- random curves ----------

/** A finite double without −0 (two negations of −0 give +0, which `toEqual` tells apart). */
const finite = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((x) => x + 0);

const tangent = fc.constantFrom(...TANGENTS);

/** A key at `t` with random value, tangent types per side, fixed handles (in: dt ≤ 0, out: dt ≥ 0) and flags. */
const keyAt = (t: number, value?: number): fc.Arbitrary<KeyData> =>
  fc
    .record({
      v: value === undefined ? finite(-2, 2) : fc.constant(value),
      inType: tangent,
      outType: tangent,
      inDt: finite(0.05, 4),
      inDv: finite(-3, 3),
      outDt: finite(0.05, 4),
      outDv: finite(-3, 3),
      broken: fc.boolean(),
      weightLocked: fc.boolean(),
      breakdown: fc.boolean(),
    })
    .map((r) => ({
      t,
      v: r.v,
      inType: r.inType,
      outType: r.outType,
      inHandle: { dt: -r.inDt, dv: r.inDv },
      outHandle: { dt: r.outDt, dv: r.outDv },
      broken: r.broken,
      weightLocked: r.weightLocked,
      ...(r.breakdown ? { breakdown: true } : {}),
    }));

/** Distinct key times on a quarter-frame grid in [lo, hi] (exact seam hits or ≥ 0.25 frames away from them). */
const timesIn = (lo: number, hi: number, max: number): fc.Arbitrary<number[]> =>
  fc
    .uniqueArray(fc.integer({ min: Math.ceil(lo * 4), max: Math.floor(hi * 4) }), { maxLength: max })
    .map((quarters) => quarters.map((q) => q / 4).sort((a, b) => a - b));

const rangeArb: fc.Arbitrary<Range> = fc
  .record({ start: fc.integer({ min: -12, max: 12 }), length: fc.integer({ min: 2, max: 40 }) })
  .map(({ start, length }) => ({ start, end: start + length }));

/**
 * A curve that loops over `range`: keys at s and e with the same value, random keys between and outside them, every
 * tangent type on either side, weighted or not, any infinity.
 */
const periodicCurve: fc.Arbitrary<{ readonly curve: AnimCurve; readonly range: Range }> = rangeArb.chain((range) =>
  fc
    .record({
      seamValue: finite(-2, 2),
      inner: timesIn(range.start + 0.25, range.end - 0.25, 7),
      outer: fc.tuple(timesIn(range.start - 6, range.start - 0.25, 2), timesIn(range.end + 0.25, range.end + 6, 2)),
      weighted: fc.boolean(),
      pre: fc.constantFrom(...INFINITIES),
      post: fc.constantFrom(...INFINITIES),
    })
    .chain(({ seamValue, inner, outer, weighted, pre, post }) =>
      fc
        .tuple(
          keyAt(range.start, seamValue),
          fc.tuple(...inner.map((t) => keyAt(t))),
          keyAt(range.end, seamValue),
          fc.tuple(...[...outer[0], ...outer[1]].map((t) => keyAt(t))),
        )
        .map(([first, between, last, beyond]) => ({
          range,
          curve: {
            keys: [first, ...between, last, ...beyond].sort((a, b) => a.t - b.t),
            weighted,
            pre,
            post,
          },
        })),
    ),
);

/** Any curve (no seam keys forced): random keys around and in the range. */
const anyCurve: fc.Arbitrary<{ readonly curve: AnimCurve; readonly range: Range }> = rangeArb.chain((range) =>
  fc
    .record({
      times: timesIn(range.start - 6, range.end + 6, 8).filter((times) => times.length > 0),
      weighted: fc.boolean(),
      pre: fc.constantFrom(...INFINITIES),
      post: fc.constantFrom(...INFINITIES),
    })
    .chain(({ times, weighted, pre, post }) =>
      fc.tuple(...times.map((t) => keyAt(t))).map((keys) => ({ range, curve: { keys, weighted, pre, post } })),
    ),
);

describe('halfCycleKeys properties (§9.2, production engine)', () => {
  it('the FR-POSE-05 gate holds at every integer frame for periodic curves of every tangent type (1e-9)', () => {
    fc.assert(
      fc.property(periodicCurve, ({ curve, range }) => {
        const { keys, periodic } = halfCycleKeys(productionApp, curve, range);
        expect(periodic).toBe(true);
        expect(gateError(curve, keys, range)).toBeLessThanOrEqual(gateOf(curve));
      }),
      { numRuns: 400 },
    );
  });

  it('written keys are in time order inside [s, e], start at s, end at e and keep every in-range key', () => {
    fc.assert(
      fc.property(anyCurve, ({ curve, range }) => {
        const { keys } = halfCycleKeys(productionApp, curve, range);
        const times = keys.map((k) => k.t);
        expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
        expect(keys[0]?.t).toBe(range.start);
        expect(keys.at(-1)?.t).toBe(range.end);
        const T = range.end - range.start;
        const seams = [range.start, range.start + T / 2];
        const inRange = curve.keys.filter((k) => k.t >= range.start && k.t < range.end && !seams.includes(k.t));
        // the in-range source keys, the two seam keys landing at s and m, and the closing copy at e (plus the copies
        // of the key range where a cyclic infinity reaches into the clip range)
        const first = curve.keys[0]?.t ?? range.start;
        const last = curve.keys.at(-1)?.t ?? range.end;
        const unrolled = (isCyclic(curve.pre) && range.start < first) || (isCyclic(curve.post) && range.end > last);
        const expected = inRange.length + 3;
        expect(keys.length).toBeGreaterThanOrEqual(expected);
        expect(!unrolled || curve.keys.length < 2 ? keys.length : expected).toBe(expected);
        // values and flags travel with the keys (tangent sides next to an inserted seam key may have been frozen)
        for (const k of inRange) {
          const landed = range.start + ((k.t - range.start + T / 2) % T);
          const out = keys.find((candidate) => candidate.t === landed);
          expect([out?.v, out?.breakdown, out?.weightLocked]).toEqual([k.v, k.breakdown, k.weightLocked]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('a curve is flagged non-periodic exactly when its values at s and e differ; periodic ones meet the gate', () => {
    fc.assert(
      fc.property(anyCurve, ({ curve, range }) => {
        const { keys, periodic } = halfCycleKeys(productionApp, curve, range);
        const compiled = engine.compile(curve);
        const drift = Math.abs(engine.evaluate(compiled, range.start) - engine.evaluate(compiled, range.end));
        fc.pre(Math.abs(drift - GATE) > 1e-12);
        // A `cycle` infinity whose end values differ jumps at every cycle boundary: no keys can follow a jump, so
        // the gate is for continuous curves (cycleOffset and oscillate always are).
        const jump = Math.abs((curve.keys[0]?.v ?? 0) - (curve.keys.at(-1)?.v ?? 0));
        const first = curve.keys[0]?.t ?? range.start;
        const last = curve.keys.at(-1)?.t ?? range.end;
        fc.pre(
          !(
            jump > 0 &&
            curve.keys.length > 1 &&
            ((curve.pre === 'cycle' && range.start < first) || (curve.post === 'cycle' && range.end > last))
          ),
        );
        // Reversed (oscillate) copies of a span AnimX corrected cannot be written exactly (see the cyclic property).
        fc.pre(!(hasCorrectedSpan(curve) && (curve.pre === 'oscillate' || curve.post === 'oscillate')));
        expect(periodic).toBe(drift <= GATE);
        expect(periodic ? gateError(curve, keys, range) : 0).toBeLessThanOrEqual(gateOf(curve));
      }),
      { numRuns: 300 },
    );
  });

  it('cyclic infinities reaching into the clip range are written out: the gate holds (cycle, cycleOffset, oscillate)', () => {
    // A key range of length P inside or across [s, e] with T a multiple of the infinity's period (P, or 2P for
    // oscillate); cycle and cycleOffset curves end on their first value, so the source is continuous and loops.
    const cyclic = fc
      .record({
        mode: fc.constantFrom<InfinityMode>('cycle', 'cycleOffset', 'oscillate'),
        start: fc.integer({ min: -8, max: 8 }),
        period: fc.integer({ min: 1, max: 12 }),
        cycles: fc.integer({ min: 1, max: 3 }),
        lead: fc.integer({ min: 0, max: 48 }),
        weighted: fc.boolean(),
        seamValue: finite(-2, 2),
      })
      .chain(({ mode, start, period, cycles, lead, weighted, seamValue }) => {
        const T = (mode === 'oscillate' ? 2 : 1) * cycles * period;
        const a = start - (lead % (period * 4)) / 4; // the key range starts at or before s, on a quarter frame
        const range = { start, end: start + T };
        return fc
          .tuple(
            keyAt(a, seamValue),
            timesIn(a + 0.25, a + period - 0.25, 5).chain((times) => fc.tuple(...times.map((t) => keyAt(t)))),
            mode === 'oscillate' ? keyAt(a + period) : keyAt(a + period, seamValue),
          )
          .map(([head, between, tail]) => ({
            range,
            curve: { keys: [head, ...between, tail], weighted, pre: mode, post: mode } as AnimCurve,
          }));
      });
    fc.assert(
      fc.property(cyclic, ({ curve, range }) => {
        // AnimX corrects a weighted span keeping its first handle; a reversed copy of a corrected span would need
        // the other handle kept, which no key data expresses: documented limitation (wp-notes M2A-A4-13).
        fc.pre(!(curve.pre === 'oscillate' && hasCorrectedSpan(curve)));
        const { keys, periodic } = halfCycleKeys(productionApp, curve, range);
        expect(periodic).toBe(true);
        expect(gateError(curve, keys, range)).toBeLessThanOrEqual(gateOf(curve));
      }),
      { numRuns: 300 },
    );
  });

  it('the half cycle applied twice is the identity on periodic curves (values at every frame of [s, e])', () => {
    fc.assert(
      fc.property(periodicCurve, ({ curve, range }) => {
        const once = { ...curve, keys: halfCycleKeys(productionApp, curve, range).keys };
        const twice = { ...curve, keys: halfCycleKeys(productionApp, once, range).keys };
        const expected = framesOf(curve, range);
        const tolerance = 2 * gateOf(curve);
        framesOf(twice, range).forEach((v, i) =>
          expect(Math.abs(v - (expected[i] as number))).toBeLessThanOrEqual(tolerance),
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe('pose.mirrorAnimation flip properties (§9.2)', () => {
  const UPPER_L = WAVE.upperArmL;
  const UPPER_R = `${WAVE.rig}:fk.upperArm.R` as ControlId;
  const CHANNELS: readonly ChannelId[] = ['rx', 'ry', 'rz'];

  /** Random keys (fixed times on a frame grid), weighting and infinities for one channel. */
  const channelCurve = fc.record({
    times: fc.uniqueArray(fc.integer({ min: -4, max: 40 }), { maxLength: 6 }).map((t) => t.sort((a, b) => a - b)),
    weighted: fc.boolean(),
    pre: fc.constantFrom(...INFINITIES),
    post: fc.constantFrom(...INFINITIES),
  });
  const scene = fc.array(fc.tuple(fc.constantFrom(UPPER_L, UPPER_R), fc.constantFrom(...CHANNELS), channelCurve), {
    minLength: 1,
    maxLength: 4,
  });

  function contentOf(app: EditorApp, control: ControlId, channel: ChannelId) {
    const layer = app.store.query.baseLayer(WAVE.clip);
    const curve = layer && app.store.query.curveFor(WAVE.clip, layer.id, control, channel);
    if (curve === undefined) return null;
    const keys = app.store.query.keysOfCurve(curve.id).map(({ id: _id, clip: _c, curve: _cv, ...data }) => data);
    // A curve the first flip created from no curve holds the mirrored default (0) as static value: equal to none.
    if (keys.length === 0 && (curve.staticValue ?? 0) === 0) return null;
    return { pre: curve.pre, post: curve.post, weighted: curve.weighted, staticValue: curve.staticValue, keys };
  }

  it('flip ∘ flip = id on random curves of a mirror pair (keys, handles, types, flags, weighting, infinities)', async () => {
    let serial = 0;
    await fc.assert(
      fc.asyncProperty(
        scene,
        fc.array(fc.tuple(finite(-2, 2), keyAt(0)), { minLength: 6, maxLength: 6 }),
        async (channels, data) => {
          const app = opsApp();
          app.store.transact({ label: 'setup' }, (tx) => {
            for (const [control, channel, spec] of channels) {
              const curve: CurveId = ensureCurve(app, tx, WAVE.clip, control, channel);
              for (const k of tx.query.keysOfCurve(curve)) tx.remove('keys', k.id);
              tx.patch('curves', curve, { weighted: spec.weighted, pre: spec.pre, post: spec.post });
              spec.times.forEach((t, i) => {
                const [v, k] = data[i % data.length] as [number, KeyData];
                tx.put('keys', { ...k, t, v, id: `k_flip${serial++}` as never, clip: WAVE.clip, curve });
              });
            }
          });
          const snapshot = () =>
            [UPPER_L, UPPER_R].flatMap((control) => CHANNELS.map((channel) => contentOf(app, control, channel)));
          const before = snapshot();
          await runOk(app, 'pose.mirrorAnimation', { mode: 'flip', controls: [UPPER_L] });
          await runOk(app, 'pose.mirrorAnimation', { mode: 'flip', controls: [UPPER_L] });
          expect(snapshot()).toEqual(before);
        },
      ),
      { numRuns: 60 },
    );
  });
});
