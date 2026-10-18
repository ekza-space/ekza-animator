// M2A-SPEC §8 Integration: regressions found when A1…A5 met on one branch. Each case names the packages whose
// changes met and the rule it guards.
import type { CurveId, KeyId } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ensureCurve, type KeyEditOptions, moveKeys } from '../../src';
import type { EditorApp } from '../../src/types';
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
