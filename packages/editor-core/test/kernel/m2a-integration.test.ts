// M2A-SPEC §8 Integration: regressions found when A1…A5 met on one branch. Each case names the packages whose
// changes met and the rule it guards.
import type { AnimCurve, KeyData, TangentType } from '@ekza-animator/anim-core';
import type { CurveId, KeyId } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ensureCurve, type KeyEditOptions, moveKeys } from '../../src';
import type { EditorApp } from '../../src/types';
import { halfCycleKeys } from '../../src/workflows/mirrorAnimation';
import { edit, W, waveApp } from './support';

const FINAL: KeyEditOptions = { snap: true, resolveCollisions: true };

/** A wave app whose `fk.upperArm.L` rz curve has keys at `times` (values 0.1·i), optionally some breakdowns. */
function armCurve(
  times: readonly number[],
  breakdowns: readonly number[] = [],
): { readonly app: EditorApp; readonly curve: CurveId; readonly keys: KeyId[] } {
  const app = waveApp();
  const { curve, keys } = edit(app, 'Keys', (tx) => {
    for (const key of W.keys) tx.remove('keys', key);
    const id = ensureCurve(app, tx, W.clip, W.upperArmL, 'rz');
    const ids = times.map((t, i) => {
      const key = `k_I${String(i).padStart(11, '0')}` as KeyId;
      tx.put('keys', {
        id: key,
        clip: W.clip,
        curve: id,
        t,
        v: 0.1 * i,
        inType: 'auto',
        outType: 'auto',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
        ...(breakdowns.includes(t) ? { breakdown: true } : {}),
      });
      return key;
    });
    return { curve: id, keys: ids };
  });
  return { app, curve, keys };
}

describe('moveKeys never writes a key at −0 (A3 placement × A4 value-only drag path)', () => {
  it('a snapped sub-half-frame move left of frame 0 keeps the key at +0, also with ripple and breakdowns', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -0.49, max: -1e-6, noNaN: true }),
        fc.constantFrom(0, 1, -12.5),
        fc.boolean(),
        fc.boolean(),
        (dFrames, dValue, ripple, withBreakdown) => {
          const { app, curve, keys } = armCurve([0, 6, 12, 20], withBreakdown ? [6] : []);
          const opts: KeyEditOptions = { ...FINAL, ...(ripple ? { ripple: true } : {}) };
          // A value change makes moveKeys write every key (a jittery vertical drag in the Graph Editor).
          edit(app, 'Move Keys', (tx) => moveKeys(app, tx, keys, dFrames, dValue, opts, { curves: [curve] }));
          const times = app.store.query.keysOfCurve(curve).map((key) => key.t);
          expect(times).toEqual([0, 6, 12, 20]);
          expect(Object.is(times[0], -0)).toBe(false);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('a moved key that lands on frame 0 from the right is +0', () => {
    const { app, curve, keys } = armCurve([1, 6]);
    edit(app, 'Move Keys', (tx) => moveKeys(app, tx, [keys[0] as KeyId], -1, 2, FINAL));
    const first = app.store.query.keysOfCurve(curve)[0];
    expect(first?.t).toBe(0);
    expect(Object.is(first?.t, -0)).toBe(false);
  });
});

describe('frozen handles are never −0 (anim-core resolved handles × A4 half-cycle mirror × A5 autosave JSON)', () => {
  // The owner demo walkthrough found it (M2A-INT-16): a half-cycle mirror freezes the resolved handles of the seam
  // keys as `fixed`; a flat side resolved to dv −0 (slope 0 × a negative dt), and the recovered document (JSON) then
  // differed from the one autosaved by the sign of zero.
  const productionApp = {} as EditorApp; // the kernel's production bindings: the real engine (internalsOf)
  const key = (t: number, v: number, type: TangentType): KeyData => ({
    t,
    v,
    inType: type,
    outType: type,
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
  });

  it('the mirrored keys of flat and moving curves, weighted or not, survive JSON unchanged', () => {
    for (const weighted of [false, true]) {
      for (const type of ['auto', 'linear', 'spline', 'flat', 'clamped'] as const) {
        for (const values of [
          [0, 0, 0],
          [0.1, 0.1, 0.1],
          [0, 0.06, 0],
        ]) {
          const curve: AnimCurve = {
            keys: [
              key(0, values[0] as number, type),
              key(12, values[1] as number, type),
              key(24, values[2] as number, type),
            ],
            weighted,
            pre: 'cycle',
            post: 'cycle',
          };
          const { keys } = halfCycleKeys(productionApp, curve, { start: 0, end: 24 });
          const negative = keys.flatMap((k) =>
            [k.v, k.inHandle.dv, k.outHandle.dv, k.inHandle.dt, k.outHandle.dt].filter((x) => Object.is(x, -0)),
          );
          expect([weighted, type, values, negative.length]).toEqual([weighted, type, values, 0]);
          expect(JSON.parse(JSON.stringify(keys))).toEqual(keys);
        }
      }
    }
  });
});
