// M2A-SPEC §5.9, §5.11, §5.12 (A3): the edit kernel's ripple (one global region over the scope curves), breakdown
// retiming inside moveKeys/scaleKeys, copyKeys and insertTime.
import type { ChannelId, ControlId, CurveId, KeyId, KeyRecord } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  copyKeys,
  ensureCurve,
  insertTime,
  type KeyEditOptions,
  moveKeys,
  type RippleScope,
  registerRippleControls,
  rippleMoveShift,
  rippleScopeOf,
  scaleKeys,
} from '../../src';
import { keysInRemovedTime } from '../../src/edit/keys';
import type { EditorApp } from '../../src/types';
import { edit, select, W, waveApp } from './support';

const FINAL: KeyEditOptions = { snap: true, resolveCollisions: true };
const DRAG: KeyEditOptions = { snap: false, resolveCollisions: false };
const RIPPLE: KeyEditOptions = { ...FINAL, ripple: true };

type Point = readonly [t: number, v: number, breakdown?: boolean];

let serial = 0;
/** Replaces the keys of the base-layer curve (W.clip, control, channel) with `points`; ids ascend with time. */
function curveWith(
  app: EditorApp,
  control: ControlId,
  channel: ChannelId,
  points: readonly Point[],
): { readonly curve: CurveId; readonly keys: KeyId[] } {
  const prefix = `T${String(serial++).padStart(4, '0')}`;
  return edit(app, 'Keys', (tx) => {
    const curve = ensureCurve(app, tx, W.clip, control, channel);
    for (const key of tx.query.keysOfCurve(curve)) tx.remove('keys', key.id);
    const keys = [...points]
      .sort((a, b) => a[0] - b[0])
      .map(([t, v, breakdown], i) => {
        const id = `k_${prefix}${String(i).padStart(7, '0')}` as KeyId;
        tx.put('keys', {
          id,
          clip: W.clip,
          curve,
          t,
          v,
          inType: 'auto',
          outType: 'auto',
          inHandle: { dt: 0, dv: 0 },
          outHandle: { dt: 0, dv: 0 },
          broken: false,
          weightLocked: true,
          ...(breakdown === true ? { breakdown: true } : {}),
        });
        return id;
      });
    return { curve, keys };
  });
}

const times = (app: EditorApp, curve: CurveId): number[] => app.store.query.keysOfCurve(curve).map((key) => key.t);
const values = (app: EditorApp, curve: CurveId): number[] => app.store.query.keysOfCurve(curve).map((key) => key.v);

/** A wave app whose wave curve has no keys left (only the given curves animate). */
function bareApp(): EditorApp {
  const app = waveApp();
  edit(app, 'Clear', (tx) => {
    for (const key of W.keys) tx.remove('keys', key);
  });
  return app;
}

describe('ripple scale (§5.11): one global region', () => {
  it('moves every later key of every scope curve by the same amount (cog 0/4/10, arm 0/6, ×2 → +10)', () => {
    const app = bareApp();
    const cog = curveWith(app, W.cog, 'tx', [
      [0, 0],
      [4, 1],
      [10, 2],
      [20, 3],
    ]);
    const arm = curveWith(app, W.upperArmL, 'rz', [
      [0, 0],
      [6, 1],
      [16, 2],
    ]);
    const edited = [...cog.keys.slice(0, 3), ...arm.keys.slice(0, 2)];
    const scope: RippleScope = { curves: [cog.curve, arm.curve] };
    const result = edit(app, 'Scale', (tx) => scaleKeys(app, tx, edited, 0, 2, RIPPLE, scope));
    expect(result.deleted).toEqual([]);
    expect(times(app, cog.curve)).toEqual([0, 8, 20, 30]);
    // Per-curve bounds would have shifted 16 by +6 (the arm's last edited key is at 6).
    expect(times(app, arm.curve)).toEqual([0, 12, 26]);
    expect(values(app, cog.curve)).toEqual([0, 1, 2, 3]);
    expect(values(app, arm.curve)).toEqual([0, 1, 2]);
  });

  it('uses the band as the region: keys after the band end shift by (pivot + (b − pivot)·f) − b', () => {
    const app = bareApp();
    const cog = curveWith(app, W.cog, 'tx', [
      [0, 0],
      [10, 1],
      [20, 2],
    ]);
    const arm = curveWith(app, W.upperArmL, 'rz', [
      [0, 0],
      [6, 1],
      [16, 2],
    ]);
    const band = [cog.keys[0], cog.keys[1], arm.keys[0], arm.keys[1]] as KeyId[];
    edit(app, 'Scale', (tx) =>
      scaleKeys(app, tx, band, 0, 1.5, RIPPLE, { curves: [cog.curve, arm.curve], region: { start: 0, end: 12 } }),
    );
    // Band 0…12 → 0…18: later keys +6.
    expect(times(app, cog.curve)).toEqual([0, 15, 26]);
    expect(times(app, arm.curve)).toEqual([0, 9, 22]);
  });

  it('scales unedited scope keys inside the region; keys before the region stay', () => {
    const app = bareApp();
    const cog = curveWith(app, W.cog, 'tx', [
      [-5, 9],
      [0, 0],
      [10, 1],
      [20, 2],
    ]);
    const arm = curveWith(app, W.upperArmL, 'rz', [
      [-3, 9],
      [5, 1],
      [15, 2],
    ]);
    edit(app, 'Scale', (tx) =>
      scaleKeys(app, tx, [cog.keys[1], cog.keys[2]] as KeyId[], 0, 2, RIPPLE, { curves: [cog.curve, arm.curve] }),
    );
    expect(times(app, cog.curve)).toEqual([-5, 0, 20, 30]);
    // Arm 5 lies in the region [0, 10]: scaled to 10; 15 > 10 shifts by +10; −3 stays.
    expect(times(app, arm.curve)).toEqual([-3, 10, 25]);
  });

  it('without ripple only the edited keys scale (M1)', () => {
    const app = bareApp();
    const cog = curveWith(app, W.cog, 'tx', [
      [0, 0],
      [10, 1],
      [20, 2],
    ]);
    edit(app, 'Scale', (tx) => scaleKeys(app, tx, [cog.keys[1]] as KeyId[], 0, 1.5, FINAL));
    expect(times(app, cog.curve)).toEqual([0, 15, 20]);
  });
});

describe('ripple move (§5.11)', () => {
  function setup() {
    const app = bareApp();
    const cog = curveWith(app, W.cog, 'tx', [
      [0, 0],
      [10, 1],
      [20, 2],
    ]);
    const arm = curveWith(app, W.upperArmL, 'rz', [
      [0, 0],
      [5, 1],
      [15, 2],
    ]);
    return { app, cog, arm, scope: { curves: [cog.curve, arm.curve] } as RippleScope };
  }

  it('moves every scope key at or after the region start, edited or not', () => {
    const { app, cog, arm, scope } = setup();
    edit(app, 'Move', (tx) => moveKeys(app, tx, [cog.keys[1]] as KeyId[], 5, 0, RIPPLE, scope));
    expect(times(app, cog.curve)).toEqual([0, 15, 25]);
    expect(times(app, arm.curve)).toEqual([0, 5, 20]);
  });

  it('with Δ < 0 the block stops once, before the latest key before the region over all scope curves', () => {
    const { app, cog, arm, scope } = setup();
    // The arm's key at 5 stops the block: snapping lands the block start on 6, so every key moves by −4.
    const shift = rippleMoveShift(app, app.store, [cog.keys[1]] as KeyId[], -8, RIPPLE, scope);
    expect(shift).toBe(-4);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [cog.keys[1]] as KeyId[], -8, 0, RIPPLE, scope));
    expect(times(app, cog.curve)).toEqual([0, 6, 16]);
    expect(times(app, arm.curve)).toEqual([0, 5, 11]);
  });

  it('while dragging without snapping the block stops 1e-3 after the stop key', () => {
    const { app, cog, arm, scope } = setup();
    const drag: KeyEditOptions = { ...DRAG, ripple: true };
    expect(rippleMoveShift(app, app.store, [cog.keys[1]] as KeyId[], -8, drag, scope)).toBeCloseTo(-4.999, 12);
    edit(app, 'Drag', (tx) => moveKeys(app, tx, [cog.keys[1]] as KeyId[], -8, 0, drag, scope));
    expect(times(app, cog.curve)[1]).toBeCloseTo(5.001, 12);
    expect(times(app, arm.curve)[2]).toBeCloseTo(10.001, 12);
  });

  it('a block that would pass the stop key stops on the next whole frame after it (snapping)', () => {
    const { app, cog, arm, scope } = setup();
    // Region start 15 (the arm key); the stop is the cog key at 10: −10 overshoots it, the block starts on 11.
    edit(app, 'Move', (tx) => moveKeys(app, tx, [arm.keys[2]] as KeyId[], -10, 0, RIPPLE, scope));
    expect(times(app, arm.curve)).toEqual([0, 5, 11]);
    expect(times(app, cog.curve)).toEqual([0, 10, 16]);
  });

  it('a block landing exactly on the stop key deletes it on its own curve only (final update)', () => {
    const app = bareApp();
    const cog = curveWith(app, W.cog, 'tx', [
      [0, 0],
      [5, 1],
      [20, 2],
    ]);
    const arm = curveWith(app, W.upperArmL, 'rz', [
      [0, 0],
      [10, 1],
      [15, 2],
    ]);
    const scope: RippleScope = { curves: [cog.curve, arm.curve] };
    const result = edit(app, 'Move', (tx) => moveKeys(app, tx, [arm.keys[2]] as KeyId[], -5, 0, RIPPLE, scope));
    expect(result.deleted).toEqual([arm.keys[1]]);
    expect(times(app, arm.curve)).toEqual([0, 10]);
    expect(values(app, arm.curve)).toEqual([0, 2]);
    expect(times(app, cog.curve)).toEqual([0, 5, 15]);
  });

  it('changes only the edited keys’ values; the ripple never changes values', () => {
    const { app, cog, arm, scope } = setup();
    edit(app, 'Move', (tx) => moveKeys(app, tx, [cog.keys[1]] as KeyId[], 2, 3, RIPPLE, scope));
    expect(values(app, cog.curve)).toEqual([0, 1 + 3, 2]);
    expect(values(app, arm.curve)).toEqual([0, 1, 2]);
  });

  it('the default scope is the selected controls of the clip’s character, else all of its controls', () => {
    const { app, cog, arm } = setup();
    select(app, [W.cog]);
    expect(rippleScopeOf(app, app.store, [cog.keys[1]] as KeyId[], null).curves).toEqual([cog.curve]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [cog.keys[1]] as KeyId[], 5, 0, RIPPLE));
    expect(times(app, arm.curve)).toEqual([0, 5, 15]);
    select(app, []);
    expect([...rippleScopeOf(app, app.store, [cog.keys[1]] as KeyId[], null).curves].sort()).toEqual(
      [cog.curve, arm.curve, W.curve].sort(),
    );
  });

  it('a panel’s registered control set wins over the default rule; the region is kept', () => {
    const { app, cog, arm } = setup();
    const dispose = registerRippleControls(app, 'dopeSheet', () => [W.cog, W.upperArmL]);
    select(app, [W.cog]);
    const scope = rippleScopeOf(app, app.store, [cog.keys[1]] as KeyId[], 'dopeSheet', { start: 8, end: 12 });
    expect([...scope.curves].sort()).toEqual([cog.curve, arm.curve].sort());
    expect(scope.region).toEqual({ start: 8, end: 12 });
    expect(rippleScopeOf(app, app.store, [cog.keys[1]] as KeyId[], 'timeline').curves).toEqual([cog.curve]);
    dispose();
    expect(rippleScopeOf(app, app.store, [cog.keys[1]] as KeyId[], 'dopeSheet').curves).toEqual([cog.curve]);
  });

  it('without ripple the shift is the requested offset (M1)', () => {
    const { app, cog } = setup();
    expect(rippleMoveShift(app, app.store, [cog.keys[1]] as KeyId[], -8.4, FINAL)).toBe(-8.4);
  });
});

describe('breakdown retiming (§5.12)', () => {
  it('keeps a breakdown’s ratio between its anchors (0, ◇10, 20 with 20 → 30: ◇ at 15, value unchanged)', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [10, 0.5, true],
      [20, 1],
    ]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[2]] as KeyId[], 10, 0, FINAL));
    expect(times(app, c.curve)).toEqual([0, 15, 30]);
    expect(values(app, c.curve)).toEqual([0, 0.5, 1]);
    expect(app.store.get('keys', c.keys[1] as KeyId)?.breakdown).toBe(true);
  });

  it('rounds half up inside [t_a′ + 1, t_c′ − 1] with snapping (◇7 between 0 and 20, 20 → 30: 10.5 → 11)', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [7, 0.5, true],
      [20, 1],
    ]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[2]] as KeyId[], 10, 0, FINAL));
    expect(times(app, c.curve)).toEqual([0, 11, 30]);
    const free = bareApp();
    const d = curveWith(free, W.cog, 'rz', [
      [0, 0],
      [7, 0.5, true],
      [20, 1],
    ]);
    edit(free, 'Move', (tx) => moveKeys(free, tx, [d.keys[2]] as KeyId[], 10, 0, { ...FINAL, snap: false }));
    expect(times(free, d.curve)).toEqual([0, 10.5, 30]);
  });

  it('keeps the exact time when no whole frame fits between the anchors', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [5, 0.5, true],
      [10, 1],
    ]);
    // 10 → 1.5 (block 0…): the breakdown's ratio 0.5 gives 0.75; no whole frame in [1, 0.5].
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[2]] as KeyId[], -8.5, 0, { ...FINAL, snap: false }));
    expect(times(app, c.curve)).toEqual([0, 0.75, 1.5]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[2]] as KeyId[], 0.5, 0, FINAL)); // 1.5 → 2: ◇ at 1
    expect(times(app, c.curve)).toEqual([0, 1, 2]);
  });

  it('leaves breakdowns alone when their anchors did not move, and with retimeBreakdowns: false', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [10, 0.5, true],
      [20, 1],
      [30, 2],
    ]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[3]] as KeyId[], 5, 0, FINAL));
    expect(times(app, c.curve)).toEqual([0, 10, 20, 35]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[2]] as KeyId[], 4, 0, { ...FINAL, retimeBreakdowns: false }));
    expect(times(app, c.curve)).toEqual([0, 10, 24, 35]);
  });

  it('an edited breakdown moves as directed; a converted key no longer retimes', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [10, 0.5, true],
      [20, 1],
    ]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[1], c.keys[2]] as KeyId[], 3, 0, FINAL));
    expect(times(app, c.curve)).toEqual([0, 13, 23]);
    edit(app, 'Convert', (tx) => {
      const { breakdown: _flag, ...rest } = tx.get('keys', c.keys[1] as KeyId) as KeyRecord;
      tx.put('keys', rest);
    });
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[2]] as KeyId[], 10, 0, FINAL));
    expect(times(app, c.curve)).toEqual([0, 13, 33]);
  });

  it('a breakdown with one anchor moves by that anchor’s offset', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [-6, 0.1, true],
      [0, 0],
      [10, 0.5, true],
    ]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[1]] as KeyId[], 2, 0, FINAL));
    expect(times(app, c.curve)).toEqual([-4, 2, 12]);
  });

  it('retimes inside scaleKeys too, and after a ripple', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [5, 0.5, true],
      [10, 1],
      [15, 1.5, true],
      [20, 2],
    ]);
    edit(app, 'Scale', (tx) => scaleKeys(app, tx, [c.keys[2]] as KeyId[], 0, 2, FINAL));
    // 10 → 20 overshoots the breakdown at 15 (a non-moved neighbour when clamping): it stops on 14; both breakdowns
    // then keep their ratios between their anchors (0…14 and 14…20).
    expect(times(app, c.curve)).toEqual([0, 7, 14, 17, 20]);
    const app2 = bareApp();
    const d = curveWith(app2, W.cog, 'rz', [
      [0, 0],
      [5, 0.5, true],
      [10, 1],
      [15, 1.5, true],
      [20, 2],
    ]);
    // Ripple move of the key at 10 by +4: 10…20 move, ◇15 moves with both anchors, ◇5 retimes to 7.
    edit(app2, 'Move', (tx) => moveKeys(app2, tx, [d.keys[2]] as KeyId[], 4, 0, RIPPLE, { curves: [d.curve] }));
    expect(times(app2, d.curve)).toEqual([0, 7, 14, 19, 24]);
  });

  it('keeps exact times when rounding would put two breakdowns of one span on one frame', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [1, 0.1, true],
      [2, 0.2, true],
      [10, 1],
    ]);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[3]] as KeyId[], -7, 0, FINAL));
    const [t0, t1, t2, t3] = times(app, c.curve);
    expect([t0, t3]).toEqual([0, 3]);
    expect(t1).toBeCloseTo(0.3, 12);
    expect(t2).toBeCloseTo(0.6, 12);
  });
});

describe('the edited slice of a long curve (place works on the keys an edit can change)', () => {
  /** 0, ◇5, 10, ◇15, 20, ◇25, 30, then plain keys every 10 frames up to 200. */
  const long = (): Point[] => [
    [0, 0],
    [5, 0.1, true],
    [10, 0.2],
    [15, 0.3, true],
    [20, 0.4],
    [25, 0.5, true],
    [30, 0.6],
    ...Array.from({ length: 17 }, (_, i): Point => [40 + i * 10, 1 + i]),
  ];

  it('a sparse move retimes only the breakdowns next to the moved key; far keys never change', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', long());
    const before = app.store.query.keysOfCurve(c.curve);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [c.keys[4]] as KeyId[], 2, 0, FINAL));
    const after = times(app, c.curve);
    expect(after.slice(0, 7)).toEqual([0, 5, 10, 16, 22, 26, 30]);
    expect(after.slice(7)).toEqual(before.slice(7).map((key) => key.t));
    expect(values(app, c.curve)).toEqual(before.map((key) => key.v));
  });

  it('a run stops at its neighbour on a long curve (drag margin, snapped overshoot, landing deletes it)', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', long());
    const last = c.keys.length - 1;
    // 190 and 200 dragged back by 25: the block stops 1e-3 after 180 while dragging…
    edit(app, 'Drag', (tx) => moveKeys(app, tx, [c.keys[last - 1], c.keys[last]] as KeyId[], -25, 0, DRAG));
    expect(times(app, c.curve).slice(-3)).toEqual([180, 180.001, 190.001]);
    // …on whole frames after it with snapping, and lands on it (deleting it) when moved exactly there.
    const snapped = bareApp();
    const d = curveWith(snapped, W.cog, 'rz', long());
    edit(snapped, 'Move', (tx) => moveKeys(snapped, tx, [d.keys[last]] as KeyId[], -25, 0, FINAL));
    expect(times(snapped, d.curve).slice(-2)).toEqual([190, 191]);
    const landing = bareApp();
    const e = curveWith(landing, W.cog, 'rz', long());
    const result = edit(landing, 'Move', (tx) => moveKeys(landing, tx, [e.keys[last]] as KeyId[], -10, 0, FINAL));
    expect(result.deleted).toEqual([e.keys[last - 1]]);
    expect(times(landing, e.curve).slice(-2)).toEqual([180, 190]);
  });

  it('a scale of the first keys leaves the rest of the curve alone and keeps its order', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', long());
    edit(app, 'Scale', (tx) => scaleKeys(app, tx, [c.keys[2], c.keys[4]] as KeyId[], 0, 1.4, FINAL));
    // 10 → 14, 20 → 28; ◇5 follows 10 (one anchor side moved: r = 0.5 between 0 and 14 → 7), ◇15 sits midway
    // between 14 and 28 (21), ◇25 between 28 and 30 (29).
    expect(times(app, c.curve).slice(0, 8)).toEqual([0, 7, 14, 21, 28, 29, 30, 40]);
  });
});

describe('retiming and ripple invariants (property)', () => {
  const curveInput = fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 2, maxLength: 9 }).chain((ts) =>
    fc.record({
      times: fc.constant([...ts].sort((a, b) => a - b)),
      breakdown: fc.array(fc.boolean(), { minLength: ts.length, maxLength: ts.length }),
      edited: fc.array(fc.boolean(), { minLength: ts.length, maxLength: ts.length }),
    }),
  );

  it('retiming preserves the key order and never changes values (moveKeys and scaleKeys)', () => {
    fc.assert(
      fc.property(
        curveInput,
        fc.integer({ min: -30, max: 30 }),
        fc.double({ min: 0.2, max: 3, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        ({ times: ts, breakdown, edited }, d, factor, snap, scale) => {
          const app = bareApp();
          const c = curveWith(
            app,
            W.cog,
            'rz',
            ts.map((t, i) => [t, i * 0.25, breakdown[i] === true] as Point),
          );
          const selected = c.keys.filter((_, i) => edited[i] === true);
          const opts: KeyEditOptions = { snap, resolveCollisions: true };
          const result = edit(app, 'Edit', (tx) =>
            scale ? scaleKeys(app, tx, selected, 0, factor, opts) : moveKeys(app, tx, selected, d, 0, opts),
          );
          const after = c.keys.flatMap((id) => {
            const key = app.store.get('keys', id);
            return key === undefined ? [] : [key];
          });
          expect(after.length + result.deleted.length).toBe(c.keys.length);
          // Original order, strictly increasing.
          for (let i = 1; i < after.length; i++) {
            expect((after[i] as KeyRecord).t - (after[i - 1] as KeyRecord).t).toBeGreaterThanOrEqual(1e-6);
          }
          // Values never change; non-edited non-breakdown keys never move.
          expect(after.map((key) => key.v)).toEqual(after.map((key) => c.keys.indexOf(key.id) * 0.25));
          const fixed = after.filter((key) => {
            const index = c.keys.indexOf(key.id);
            return edited[index] !== true && breakdown[index] !== true;
          });
          expect(fixed.map((key) => key.t)).toEqual(fixed.map((key) => ts[c.keys.indexOf(key.id)]));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('ripple moves every later scope key by one amount and leaves earlier keys alone', () => {
    const input = fc.record({
      a: fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 6 }),
      b: fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 6 }),
      pick: fc.integer({ min: 0, max: 5 }),
      d: fc.integer({ min: -25, max: 25 }),
      snap: fc.boolean(),
    });
    fc.assert(
      fc.property(input, ({ a, b, pick, d, snap }) => {
        const app = bareApp();
        const ca = curveWith(
          app,
          W.cog,
          'tx',
          a.map((t) => [t, t] as Point),
        );
        const cb = curveWith(
          app,
          W.upperArmL,
          'rz',
          b.map((t) => [t, t] as Point),
        );
        const edited = ca.keys[pick % ca.keys.length] as KeyId;
        const start = app.store.get('keys', edited)?.t ?? 0;
        const scope: RippleScope = { curves: [ca.curve, cb.curve] };
        const opts: KeyEditOptions = { snap, resolveCollisions: true, ripple: true };
        const shift = rippleMoveShift(app, app.store, [edited], d, opts, scope);
        const before = new Map(
          [...app.store.query.keysOfCurve(ca.curve), ...app.store.query.keysOfCurve(cb.curve)].map((key) => [
            key.id,
            key.t,
          ]),
        );
        const result = edit(app, 'Move', (tx) => moveKeys(app, tx, [edited], d, 0, opts, scope));
        // Δ ≥ 0 moves by Δ; Δ < 0 by at most Δ, never past the stop key.
        expect(shift).toBe(d >= 0 ? d : Math.max(d, shift));
        expect(shift).toBeLessThanOrEqual(Math.max(0, d));
        const stop = Math.max(-Infinity, ...[...before.values()].filter((t) => t < start));
        expect(start + shift).toBeGreaterThanOrEqual(stop);
        const gone = [...before.keys()].filter((id) => app.store.get('keys', id) === undefined);
        expect(gone.every((id) => result.deleted.includes(id))).toBe(true);
        const kept = [...before].filter(([id]) => app.store.get('keys', id) !== undefined);
        expect(kept.map(([id]) => app.store.get('keys', id)?.t)).toEqual(
          kept.map(([, t]) => (t >= start ? t + shift : t)),
        );
        expect(kept.map(([id]) => app.store.get('keys', id)?.v)).toEqual(kept.map(([, t]) => t));
      }),
      { numRuns: 300 },
    );
  });
});

describe('copyKeys (§5.9)', () => {
  it('copies keys by an offset on the same curves; the originals stay', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [10, 0.5, true],
      [20, 1],
    ]);
    const result = edit(app, 'Copy', (tx) => copyKeys(app, tx, [c.keys[1]] as KeyId[], 4, FINAL));
    expect(result.deleted).toEqual([]);
    expect(result.created).toHaveLength(1);
    expect(times(app, c.curve)).toEqual([0, 10, 14, 20]);
    const copy = app.store.get('keys', result.created[0] as KeyId);
    expect(copy).toMatchObject({ t: 14, v: 0.5, breakdown: true, curve: c.curve, clip: W.clip });
    expect(app.store.get('keys', c.keys[1] as KeyId)?.t).toBe(10);
  });

  it('replaces a non-copied key at a copy’s time; skips copies onto copied keys; snaps', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [10, 0.5],
      [20, 1],
    ]);
    const result = edit(app, 'Copy', (tx) => copyKeys(app, tx, [c.keys[0], c.keys[1]] as KeyId[], 10.4, FINAL));
    // 0 → 10 lands on a copied key (skipped); 10 → 20 replaces the key at 20.
    expect(result.deleted).toEqual([c.keys[2]]);
    expect(result.created).toHaveLength(1);
    expect(times(app, c.curve)).toEqual([0, 10, 20]);
    expect(values(app, c.curve)).toEqual([0, 0.5, 0.5]);
    const free = bareApp();
    const d = curveWith(free, W.cog, 'rz', [[0, 0]]);
    edit(free, 'Copy', (tx) => copyKeys(free, tx, d.keys, 2.5, { ...FINAL, snap: false }));
    expect(times(free, d.curve)).toEqual([0, 2.5]);
  });

  it('skips locked curves', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [[0, 0]]);
    edit(app, 'Lock', (tx) => tx.patch('curves', c.curve, { locked: true }));
    expect(edit(app, 'Copy', (tx) => copyKeys(app, tx, c.keys, 3, FINAL))).toEqual({ created: [], deleted: [] });
  });
});

describe('insertTime (§5.9): a uniform time warp', () => {
  it('inserts frames after `at`: later keys (breakdowns included) shift, nothing at or before `at` changes', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [7, 0.3, true],
      [10, 0.5],
      [14, 0.7, true],
      [20, 1],
    ]);
    const result = edit(app, 'Insert', (tx) => insertTime(app, tx, [c.curve], 10, 1));
    expect(result).toEqual({ moved: 2, deleted: [] });
    // The breakdown at 7 stays although its right anchor moved: no retiming.
    expect(times(app, c.curve)).toEqual([0, 7, 10, 15, 21]);
    expect(values(app, c.curve)).toEqual([0, 0.3, 0.5, 0.7, 1]);
  });

  it('removes frames: keys in (at, at + |frames|] are deleted, later keys move back', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [
      [0, 0],
      [10, 0.5],
      [11, 0.6],
      [20, 1],
    ]);
    expect(keysInRemovedTime(app.store, [c.curve], 10, -1).map((key) => key.t)).toEqual([11]);
    expect(keysInRemovedTime(app.store, [c.curve], 11, -1)).toEqual([]);
    const result = edit(app, 'Remove', (tx) => insertTime(app, tx, [c.curve], 10, -1));
    expect(result).toEqual({ moved: 1, deleted: [c.keys[2]] });
    expect(times(app, c.curve)).toEqual([0, 10, 19]);
  });

  it('a curve that loses its last key keeps its value as staticValue; locked curves are skipped', () => {
    const app = bareApp();
    const c = curveWith(app, W.cog, 'rz', [[5, 0.4]]);
    const locked = curveWith(app, W.upperArmL, 'rz', [[30, 1]]);
    edit(app, 'Lock', (tx) => tx.patch('curves', locked.curve, { locked: true }));
    edit(app, 'Remove', (tx) => insertTime(app, tx, [c.curve, locked.curve], 0, -10));
    expect(times(app, c.curve)).toEqual([]);
    expect(app.store.get('curves', c.curve)?.staticValue).toBeCloseTo(0.4, 12);
    expect(times(app, locked.curve)).toEqual([30]);
  });

  it('rejects non-finite input', () => {
    const app = bareApp();
    expect(() => edit(app, 'x', (tx) => insertTime(app, tx, [], Number.NaN, 1))).toThrow('must be finite');
    expect(() => edit(app, 'x', (tx) => copyKeys(app, tx, [], Number.POSITIVE_INFINITY, FINAL))).toThrow(
      'must be finite',
    );
  });

  it('is a uniform shift for any input (property)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: -5, max: 40 }),
        fc.integer({ min: -6, max: 6 }).filter((n) => n !== 0),
        (ts, at, frames) => {
          const app = bareApp();
          const c = curveWith(
            app,
            W.cog,
            'rz',
            ts.map((t, i) => [t, t, i % 2 === 0] as Point),
          );
          const before = app.store.query.keysOfCurve(c.curve).map((key) => [key.id, key.t] as const);
          edit(app, 'Time', (tx) => insertTime(app, tx, [c.curve], at, frames));
          const expected = before.map(([, t]) =>
            t <= at ? t : frames < 0 && t <= at - frames ? undefined : t + frames,
          );
          expect(before.map(([id]) => app.store.get('keys', id)?.t)).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
