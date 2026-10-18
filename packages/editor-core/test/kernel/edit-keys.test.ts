import { type AnimCurve, EkzaError, type KeyData, RAD2DEG, type TangentType } from '@ekza-animator/anim-core';
import type { ClipId, ClipRecord, CurveId, KeyId, KeyRecord, Tx } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  deleteKeys,
  ensureCurve,
  insertKeyOnCurve,
  type KeyEditOptions,
  moveKeys,
  scaleKeys,
  setKeyHandle,
  setTangentTypes,
} from '../../src';
import { naiveCurveEngine } from '../../src/testing';
import type { EditorApp } from '../../src/types';
import { DEG, edit, expectClose, keysOf, setFrame, W, waveApp, wavePoints } from './support';

const DRAG: KeyEditOptions = { snap: false, resolveCollisions: false };
const FINAL: KeyEditOptions = { snap: true, resolveCollisions: true };
const [K0, K15, K30] = W.keys;

const valueAt = (app: EditorApp, curve: CurveId, frame: number): number =>
  naiveCurveEngine.evaluate(app.evaluation.compiledCurve(curve), frame);

/** Adds keys to the wave curve (t, v) and returns their ids in order. */
function addKeys(app: EditorApp, points: readonly [number, number][]): KeyId[] {
  return edit(app, 'Add', (tx) =>
    points.map(([t, v], i) => {
      const id = `k_TestKey${String(i).padStart(5, '0')}` as KeyId;
      tx.put('keys', { ...(tx.get('keys', K0) as KeyRecord), id, t, v });
      return id;
    }),
  );
}

describe('ensureCurve', () => {
  it('finds the canonical base-layer curve or creates one', () => {
    const app = waveApp();
    const [existing, created] = edit(app, 'Curves', (tx) => [
      ensureCurve(app, tx, W.clip, W.lowerArmL, 'rz'),
      ensureCurve(app, tx, W.clip, W.lowerArmL, 'ry'),
    ]);
    expect(existing).toBe(W.curve);
    // The wave clip loops: new curves cycle (M2A-SPEC §5.23; literal update, §3 rule 8).
    expect(app.store.get('clips', W.clip)?.loop).toBe(true);
    expect(app.store.get('curves', created)).toMatchObject({
      clip: W.clip,
      layer: 'lay_SyntheticWave001',
      control: W.lowerArmL,
      channel: 'ry',
      weighted: false,
      pre: 'cycle',
      post: 'cycle',
      staticValue: null,
      locked: false,
      muted: false,
      deleted: null,
    });
  });

  it('creates constant infinities on clips that do not loop and never rewrites existing curves (§5.23)', () => {
    const app = waveApp();
    edit(app, 'Once', (tx) => tx.patch('clips', W.clip, { loop: false }));
    const created = edit(app, 'Curve', (tx) => ensureCurve(app, tx, W.clip, W.lowerArmL, 'ry'));
    expect(app.store.get('curves', created)).toMatchObject({ pre: 'constant', post: 'constant' });
    edit(app, 'Loop', (tx) => tx.patch('clips', W.clip, { loop: true }));
    expect(edit(app, 'Again', (tx) => ensureCurve(app, tx, W.clip, W.lowerArmL, 'ry'))).toBe(created);
    expect(app.store.get('curves', created)).toMatchObject({ pre: 'constant', post: 'constant' });
    expect(app.store.get('curves', W.curve)).toMatchObject({ pre: 'constant', post: 'constant' });
  });

  it('repairs a clip without base layer and rejects unknown clips and controls', () => {
    const app = waveApp();
    const clip = 'clp_NoLayerClip00001' as ClipId;
    const curve = edit(app, 'New Clip', (tx) => {
      tx.put('clips', { ...(tx.get('clips', W.clip) as ClipRecord), id: clip, name: 'bare', order: 'a1' });
      return ensureCurve(app, tx, clip, W.handL, 'rz');
    });
    const layer = app.store.query.baseLayer(clip);
    expect(layer).toMatchObject({ clip, name: 'Base', mode: 'override', weight: 1, order: 'a0', deleted: null });
    expect(app.store.get('curves', curve)?.layer).toBe(layer?.id);
    expect(() => edit(app, 'x', (tx) => ensureCurve(app, tx, 'clp_Missing000000001' as ClipId, W.handL, 'rz'))).toThrow(
      EkzaError,
    );
    expect(() => edit(app, 'x', (tx) => ensureCurve(app, tx, W.clip, 'rig_X:nope' as never, 'rz'))).toThrow(EkzaError);
  });
});

describe('moveKeys (§4.11.3)', () => {
  it('moves in time (snapped to integers when asked) and value (display units)', () => {
    const app = waveApp();
    const v15 = app.store.get('keys', K15)?.v ?? 0;
    const result = edit(app, 'Move', (tx) =>
      moveKeys(app, tx, [K15], 2.4, 10, { snap: true, resolveCollisions: true }),
    );
    expect(result).toEqual({ moved: 1, deleted: [] });
    expect(app.store.get('keys', K15)).toMatchObject({ t: 17 });
    expect(app.store.get('keys', K15)?.v).toBeCloseTo(v15 + 10 * DEG, 15);
    edit(app, 'Move', (tx) => moveKeys(app, tx, [K15], 0.25, 0, DRAG));
    expect(app.store.get('keys', K15)?.t).toBe(17.25);
  });

  it('never lets a dragged key cross a non-moved neighbour; a run stops as a block', () => {
    const app = waveApp();
    edit(app, 'Drag', (tx) => moveKeys(app, tx, [K15], 20, 0, DRAG));
    expect(app.store.get('keys', K15)?.t).toBeCloseTo(30 - 1e-3, 12);
    const fresh = waveApp();
    edit(fresh, 'Drag', (tx) => moveKeys(fresh, tx, [K0, K15], 20, 0, DRAG));
    expectClose(
      wavePoints(fresh).map(([t]) => t),
      [15 - 1e-3, 30 - 1e-3, 30],
      12,
    );
    edit(fresh, 'Drag', (tx) => moveKeys(fresh, tx, [K0, K15], -100, 0, DRAG));
    expectClose(
      wavePoints(fresh).map(([t]) => t),
      [-85 - 1e-3, -70 - 1e-3, 30],
      9,
    );
  });

  it('on the final update a key landing exactly on a non-moved key deletes it', () => {
    const app = waveApp();
    const result = edit(app, 'Move', (tx) => moveKeys(app, tx, [K15], 15, 0, FINAL));
    expect(result).toEqual({ moved: 1, deleted: [K30] });
    expect(app.store.get('keys', K30)).toBeUndefined();
    expect(wavePoints(app).map(([t]) => t)).toEqual([0, 30]);
  });

  it('with snapping, a key dragged past a neighbour stops on the last whole frame before it (acceptance round 2)', () => {
    const app = waveApp();
    const snapDrag: KeyEditOptions = { snap: true, resolveCollisions: false };
    edit(app, 'Drag', (tx) => moveKeys(app, tx, [K15], 22, 0, snapDrag));
    expect(app.store.get('keys', K15)?.t).toBe(29);
    const result = edit(app, 'Move', (tx) => moveKeys(app, tx, [K15], 8, 0, FINAL)); // 29 + 8 = 37: past 30
    expect(result).toEqual({ moved: 0, deleted: [] });
    expect(wavePoints(app).map(([t]) => t)).toEqual([0, 29, 30]);
    // Backwards past frame 0, as a block of two keys: the run stops at 1 and 2… unless it does not fit.
    const fresh = waveApp();
    edit(fresh, 'Move', (tx) => moveKeys(fresh, tx, [K15, K30], -40, 0, FINAL));
    expect(wavePoints(fresh).map(([t]) => t)).toEqual([0, 1, 16]);
    // Without snapping the old rule holds: it stops at the neighbour and lands on it on the final update.
    const free = waveApp();
    const freeResult = edit(free, 'Move', (tx) =>
      moveKeys(free, tx, [K15], 22, 0, { snap: false, resolveCollisions: true }),
    );
    expect(freeResult.deleted).toEqual([K30]);
  });

  it('keeps one of two moved keys that snap onto one frame (the nearer one)', () => {
    const app = waveApp();
    const [a, b] = addKeys(app, [
      [10.2, 1],
      [10.4, 2],
    ]);
    const result = edit(app, 'Move', (tx) => moveKeys(app, tx, [a as KeyId, b as KeyId], 0, 0, FINAL));
    expect(result.deleted).toEqual([b]);
    expect(app.store.get('keys', a as KeyId)).toMatchObject({ t: 10, v: 1 });
  });

  it('skips missing keys and keys of locked curves', () => {
    const app = waveApp();
    edit(app, 'Lock', (tx) => tx.patch('curves', W.curve, { locked: true }));
    const result = edit(app, 'Move', (tx) => moveKeys(app, tx, [K15, 'k_Missing0000' as KeyId], 3, 0, FINAL));
    expect(result).toEqual({ moved: 0, deleted: [] });
    expect(app.store.get('keys', K15)?.t).toBe(15);
  });
});

describe('scaleKeys (§4.11.3)', () => {
  it('scales times around the pivot, snapped when asked', () => {
    const app = waveApp();
    expect(edit(app, 'Scale', (tx) => scaleKeys(app, tx, [K0, K15, K30], 0, 2, FINAL))).toEqual({
      moved: 2,
      deleted: [],
    });
    expect(wavePoints(app).map(([t]) => t)).toEqual([0, 30, 60]);
    edit(app, 'Scale', (tx) => scaleKeys(app, tx, [K15], 60, 0.75, FINAL)); // 30 → 37.5 → 38
    expect(app.store.get('keys', K15)?.t).toBe(38);
  });

  it('clamps the factor to 0.01; the key farther from the pivot survives a pile-up', () => {
    const app = waveApp();
    const result = edit(app, 'Scale', (tx) => scaleKeys(app, tx, [K0, K15, K30], 0, 0, FINAL));
    expect([...result.deleted].sort()).toEqual([K0, K15].sort());
    expect(wavePoints(app)).toEqual([[0, app.store.get('keys', K30)?.v]]);
    const drag = waveApp();
    edit(drag, 'Scale', (tx) => scaleKeys(drag, tx, [K15, K30], 0, 0, DRAG));
    expect(drag.store.get('keys', K15)?.t).toBeCloseTo(0.15, 12);
    expect(drag.store.get('keys', K30)?.t).toBeCloseTo(0.3, 12);
  });

  it('follows the move rule against non-moved keys', () => {
    const app = waveApp();
    expect(edit(app, 'Scale', (tx) => scaleKeys(app, tx, [K30], 0, 0.5, FINAL))).toEqual({ moved: 1, deleted: [K15] });
    const drag = waveApp();
    edit(drag, 'Scale', (tx) => scaleKeys(drag, tx, [K30], 0, 0.1, DRAG));
    expect(drag.store.get('keys', K30)?.t).toBeCloseTo(15 + 1e-3, 12);
  });

  it('scales the dt of fixed handles on weighted curves only', () => {
    const fixed = {
      inType: 'fixed',
      outType: 'fixed',
      inHandle: { dt: -4, dv: 1 },
      outHandle: { dt: 4, dv: 1 },
    } as const;
    for (const weighted of [true, false]) {
      const app = waveApp();
      edit(app, 'Setup', (tx) => {
        tx.patch('curves', W.curve, { weighted });
        tx.put('keys', { ...(tx.get('keys', K15) as KeyRecord), ...fixed });
      });
      edit(app, 'Scale', (tx) => scaleKeys(app, tx, [K15, K30], 0, 2, FINAL));
      const key = app.store.get('keys', K15);
      expect(key?.t).toBe(30);
      expect(key?.inHandle).toEqual(weighted ? { dt: -8, dv: 1 } : { dt: -4, dv: 1 });
      expect(key?.outHandle).toEqual(weighted ? { dt: 8, dv: 1 } : { dt: 4, dv: 1 });
    }
  });
});

describe('move and scale invariants (property)', () => {
  /** The wave curve with keys at the given distinct times; ids ascend with time. */
  function curveWithKeys(times: readonly number[]): { readonly app: EditorApp; readonly ids: KeyId[] } {
    const app = waveApp();
    edit(app, 'Clear', (tx) => {
      for (const key of W.keys) tx.remove('keys', key);
    });
    const sorted = [...times].sort((a, b) => a - b);
    return {
      app,
      ids: addKeys(
        app,
        sorted.map((t, i) => [t, i * 0.1] as [number, number]),
      ),
    };
  }

  /** Every key record of the wave curve, hidden duplicates included, in the original order of `ids`. */
  function survivors(app: EditorApp, ids: readonly KeyId[]): KeyRecord[] {
    return ids.flatMap((id) => {
      const key = app.store.get('keys', id);
      return key === undefined ? [] : [key];
    });
  }

  const input = fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 8 }).chain((times) =>
    fc.record({
      times: fc.constant(times),
      moving: fc.array(fc.boolean(), { minLength: times.length, maxLength: times.length }),
      snap: fc.boolean(),
      resolve: fc.boolean(),
    }),
  );

  it('moveKeys keeps every curve ordered: no crossing while dragging, unique times after the final update', () => {
    fc.assert(
      fc.property(input, fc.double({ min: -50, max: 50, noNaN: true }), ({ times, moving, snap, resolve }, d) => {
        const { app, ids } = curveWithKeys(times);
        const selected = ids.filter((_, i) => moving[i] === true);
        const result = edit(app, 'Move', (tx) =>
          moveKeys(app, tx, selected, d, 0, { snap, resolveCollisions: resolve }),
        );
        const after = survivors(app, ids);
        expect(after.length + result.deleted.length).toBe(ids.length);
        expect(result.deleted.length === 0 || resolve).toBe(true);
        expect(result.deleted.every((id) => ids.includes(id))).toBe(true);
        // Original order, strictly increasing times (no duplicates, hidden or not).
        const gaps = after.slice(1).map((key, i) => key.t - (after[i] as KeyRecord).t);
        expect(gaps.every((gap) => gap >= 1e-6)).toBe(true);
        const sorted = [...times].sort((a, b) => a - b);
        const stayed = after.filter((key) => !selected.includes(key.id));
        expect(stayed.map((key) => key.t)).toEqual(stayed.map((key) => sorted[ids.indexOf(key.id)]));
        const landed = after.filter((key) => selected.includes(key.id) && snap && resolve);
        expect(landed.every((key) => Number.isInteger(key.t))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('scaleKeys keeps every curve ordered and leaves unique times after the final update', () => {
    fc.assert(
      fc.property(
        input,
        fc.double({ min: -10, max: 50, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        ({ times, moving, snap, resolve }, pivot, factor) => {
          const { app, ids } = curveWithKeys(times);
          const selected = ids.filter((_, i) => moving[i] === true);
          const result = edit(app, 'Scale', (tx) =>
            scaleKeys(app, tx, selected, pivot, factor, { snap, resolveCollisions: resolve }),
          );
          const after = survivors(app, ids);
          expect(after.length + result.deleted.length).toBe(ids.length);
          expect(result.deleted.length === 0 || resolve).toBe(true);
          // While dragging, snapped or clamped moving keys may share a frame; they never swap.
          const gaps = after.slice(1).map((key, i) => key.t - (after[i] as KeyRecord).t);
          expect(gaps.every((gap) => gap >= (resolve ? 1e-6 : 0))).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('setTangentTypes (§4.11.4)', () => {
  it('linear on all keys: the span is linear; stepped sets the out side only', () => {
    const app = waveApp();
    const v0 = app.store.get('keys', K0)?.v ?? 0;
    const v15 = app.store.get('keys', K15)?.v ?? 0;
    edit(app, 'Linear', (tx) => setTangentTypes(app, tx, [K0, K15, K30], 'linear', 'both'));
    expect(valueAt(app, W.curve, 7.5)).toBeCloseTo((v0 + v15) / 2, 12);
    edit(app, 'Step', (tx) => setTangentTypes(app, tx, [K0, K15, K30], 'step', 'both'));
    expect(keysOf(app, W.curve).map((key) => [key.inType, key.outType])).toEqual([
      ['linear', 'step'],
      ['linear', 'step'],
      ['linear', 'step'],
    ]);
    expect(valueAt(app, W.curve, 14)).toBe(v0);
    expect(valueAt(app, W.curve, 29)).toBe(v15);
    edit(app, 'In', (tx) => setTangentTypes(app, tx, [K15], 'flat', 'in'));
    expect(app.store.get('keys', K15)).toMatchObject({ inType: 'flat', outType: 'step' });
  });

  it('fixed stores the resolved handles first, so the curve does not change; back to auto keeps them', () => {
    const app = waveApp();
    const before = [3, 7.5, 12, 18, 25].map((f) => valueAt(app, W.curve, f));
    const compiled = app.evaluation.compiledCurve(W.curve);
    edit(app, 'Fix', (tx) => setTangentTypes(app, tx, [K0, K15], 'fixed', 'both'));
    const k0 = app.store.get('keys', K0);
    expect(k0).toMatchObject({ inType: 'fixed', outType: 'fixed' });
    expect(k0?.outHandle).toEqual({ dt: compiled.outDt[0], dv: compiled.outDv[0] });
    expectClose(
      [3, 7.5, 12, 18, 25].map((f) => valueAt(app, W.curve, f)),
      before,
      12,
    );
    const handle = app.store.get('keys', K15)?.outHandle;
    edit(app, 'Auto', (tx) => setTangentTypes(app, tx, [K15], 'auto', 'out'));
    expect(app.store.get('keys', K15)).toMatchObject({ inType: 'fixed', outType: 'auto', outHandle: handle });
  });

  it('leaves locked curves alone', () => {
    const app = waveApp();
    edit(app, 'Lock', (tx) => tx.patch('curves', W.curve, { locked: true }));
    edit(app, 'Linear', (tx) => setTangentTypes(app, tx, [K0], 'linear', 'both'));
    expect(app.store.get('keys', K0)?.inType).toBe('auto');
  });
});

describe('setKeyHandle (§4.11.4 handle rules)', () => {
  it('non-weighted unified: both sides fixed and collinear, each keeping its span/3 length', () => {
    const app = waveApp();
    edit(app, 'Edit Tangent', (tx) => setKeyHandle(app, tx, K15, 'out', { dt: 2, dv: 0.2 }, { tempBreak: false }));
    const key = app.store.get('keys', K15);
    expect(key).toMatchObject({ inType: 'fixed', outType: 'fixed', broken: false });
    expect(key?.outHandle.dt).toBeCloseTo(5, 12);
    expect(key?.outHandle.dv).toBeCloseTo(0.5, 12);
    expect(key?.inHandle.dt).toBeCloseTo(-5, 12);
    expect(key?.inHandle.dv).toBeCloseTo(-0.5, 12);
  });

  it('broken: only the dragged side changes — the curve before the key stays (E2E-09)', () => {
    const app = waveApp();
    const left = [2, 5, 10, 14].map((f) => valueAt(app, W.curve, f));
    const right = [17, 22, 28].map((f) => valueAt(app, W.curve, f));
    edit(app, 'Break', (tx) => tx.patch('keys', K15, { broken: true }));
    edit(app, 'Edit Tangent', (tx) => setKeyHandle(app, tx, K15, 'out', { dt: 5, dv: 1 }, { tempBreak: false }));
    expect(app.store.get('keys', K15)).toMatchObject({ inType: 'auto', outType: 'fixed', broken: true });
    expect([2, 5, 10, 14].map((f) => valueAt(app, W.curve, f))).toEqual(left);
    expect([17, 22, 28].map((f) => valueAt(app, W.curve, f))).not.toEqual(right);
  });

  it('tempBreak leaves the opposite side and writes broken', () => {
    const app = waveApp();
    edit(app, 'Edit Tangent', (tx) => setKeyHandle(app, tx, K15, 'in', { dt: -5, dv: 1 }, { tempBreak: true }));
    expect(app.store.get('keys', K15)).toMatchObject({ inType: 'fixed', outType: 'auto', broken: true });
  });

  it('weight-locked weighted keys change the angle only; unlocked ones take the handle with dt clamped to the span', () => {
    const fps = 30;
    const k = RAD2DEG;
    const weight = (h: { dt: number; dv: number }) => 3 * Math.hypot(Math.abs(h.dt) / fps, h.dv * k);
    const app = waveApp();
    edit(app, 'Weighted', (tx) => tx.patch('curves', W.curve, { weighted: true }));
    const resolved = app.evaluation.compiledCurve(W.curve);
    const outBefore = { dt: resolved.outDt[0] as number, dv: resolved.outDv[0] as number };
    edit(app, 'Drag', (tx) => setKeyHandle(app, tx, K0, 'out', { dt: 3, dv: 0.3 }, { tempBreak: false }));
    const locked = app.store.get('keys', K0);
    expect(weight(locked?.outHandle ?? { dt: 0, dv: 0 })).toBeCloseTo(weight(outBefore), 9);
    expect((locked?.outHandle.dv ?? 0) / (locked?.outHandle.dt ?? 1)).toBeCloseTo(0.1, 12);

    edit(app, 'Unlock', (tx) => tx.put('keys', { ...(tx.get('keys', K0) as KeyRecord), weightLocked: false }));
    edit(app, 'Drag', (tx) => setKeyHandle(app, tx, K0, 'out', { dt: 6, dv: 0.3 }, { tempBreak: false }));
    expect(app.store.get('keys', K0)?.outHandle).toEqual({ dt: 6, dv: 0.3 });
    edit(app, 'Drag', (tx) => setKeyHandle(app, tx, K0, 'out', { dt: 60, dv: 1 }, { tempBreak: false }));
    // §4.11.4 "dt is clamped to (0, span]": the height is kept (WP-6 G-21, v0.3 integration).
    const limited = app.store.get('keys', K0)?.outHandle;
    expect(limited?.dt).toBeCloseTo(15, 12);
    expect(limited?.dv).toBeCloseTo(1, 12);
  });

  it('turns a handle dragged across its key vertical, ignores locked curves and rejects bad input', () => {
    const app = waveApp();
    edit(app, 'Drag', (tx) => setKeyHandle(app, tx, K15, 'out', { dt: -2, dv: 1 }, { tempBreak: true }));
    const out = app.store.get('keys', K15)?.outHandle;
    expect(out?.dt).toBeGreaterThan(0);
    expect((out?.dv ?? 0) / (out?.dt ?? 1)).toBeGreaterThan(1e5);
    edit(app, 'Lock', (tx) => tx.patch('curves', W.curve, { locked: true }));
    const before = app.store.get('keys', K0);
    edit(app, 'Drag', (tx) => setKeyHandle(app, tx, K0, 'out', { dt: 1, dv: 1 }, { tempBreak: false }));
    expect(app.store.get('keys', K0)).toBe(before);
    expect(() =>
      edit(app, 'x', (tx) =>
        setKeyHandle(app, tx, 'k_Missing0000' as KeyId, 'in', { dt: -1, dv: 0 }, { tempBreak: false }),
      ),
    ).toThrow(EkzaError);
    expect(() =>
      edit(app, 'x', (tx) => setKeyHandle(app, tx, K0, 'in', { dt: Number.NaN, dv: 0 }, { tempBreak: false })),
    ).toThrow(EkzaError);
  });
});

describe('insertKeyOnCurve (§4.11.4)', () => {
  it('inserts without changing the curve and freezes the neighbours that would change', () => {
    const app = waveApp();
    const samples = Array.from({ length: 121 }, (_, i) => i / 4);
    const before = samples.map((f) => valueAt(app, W.curve, f));
    const id = edit(app, 'Insert Key', (tx) => insertKeyOnCurve(app, tx, W.curve, 22));
    expect(app.store.get('keys', id)).toMatchObject({
      t: 22,
      inType: 'fixed',
      outType: 'fixed',
      clip: W.clip,
      curve: W.curve,
    });
    expectClose(
      samples.map((f) => valueAt(app, W.curve, f)),
      before,
      9,
    );
    // The wave's keys are extremes (flat auto tangents): nothing needs freezing.
    expect(
      keysOf(app, W.curve)
        .filter((key) => key.id !== id)
        .map((key) => [key.inType, key.outType]),
    ).toEqual([
      ['auto', 'auto'],
      ['auto', 'auto'],
      ['auto', 'auto'],
    ]);

    // A rising curve: key 15's auto tangent depends on its right neighbour, so both its sides are frozen with their
    // old handles (§4.11.4 insert rule 3).
    edit(app, 'Rise', (tx) => {
      tx.remove('keys', id);
      tx.put('keys', { ...(tx.get('keys', K0) as KeyRecord), v: 0 });
      tx.put('keys', { ...(tx.get('keys', K15) as KeyRecord), v: 1 });
      tx.put('keys', { ...(tx.get('keys', K30) as KeyRecord), v: 3 });
    });
    const rising = samples.map((f) => valueAt(app, W.curve, f));
    const old = app.evaluation.compiledCurve(W.curve);
    edit(app, 'Insert Key', (tx) => insertKeyOnCurve(app, tx, W.curve, 22));
    expectClose(
      samples.map((f) => valueAt(app, W.curve, f)),
      rising,
      9,
    );
    expect(app.store.get('keys', K15)).toMatchObject({
      inType: 'fixed',
      outType: 'fixed',
      inHandle: { dt: old.inDt[1], dv: old.inDv[1] },
      outHandle: { dt: old.outDt[1], dv: old.outDv[1] },
    });
    expect(app.store.get('keys', K0)).toMatchObject({ inType: 'auto', outType: 'auto' });
  });

  it('returns the key already at the frame; seeds an empty curve with its static value', () => {
    const app = waveApp();
    expect(edit(app, 'Insert', (tx) => insertKeyOnCurve(app, tx, W.curve, 15 + 1e-7))).toBe(K15);
    const curve = edit(app, 'Curve', (tx) => {
      const id = ensureCurve(app, tx, W.clip, W.handL, 'rz');
      tx.patch('curves', id, { staticValue: 0.75 });
      return id;
    });
    const id = edit(app, 'Insert', (tx) => insertKeyOnCurve(app, tx, curve, 4));
    expect(app.store.get('keys', id)).toMatchObject({ t: 4, v: 0.75, inType: 'auto', outType: 'auto' });
    edit(app, 'Lock', (tx) => tx.patch('curves', curve, { locked: true }));
    expect(() => edit(app, 'Insert', (tx) => insertKeyOnCurve(app, tx, curve, 8))).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });

  it('preserves the shape of random curves of every tangent type (naive engine, property)', () => {
    const types: TangentType[] = [
      'auto',
      'autoEase',
      'autoMix',
      'spline',
      'clamped',
      'linear',
      'flat',
      'step',
      'stepNext',
      'fixed',
    ];
    const keyArb = fc.record({
      dt: fc.integer({ min: 1, max: 10 }),
      v: fc.double({ min: -2, max: 2, noNaN: true }),
      inType: fc.constantFrom(...types),
      outType: fc.constantFrom(...types),
      slopeIn: fc.double({ min: -1, max: 1, noNaN: true }),
      slopeOut: fc.double({ min: -1, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(keyArb, { minLength: 2, maxLength: 6 }),
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        (raw, where) => {
          const app = waveApp();
          let t = 0;
          const points = raw.map((k) => {
            t += k.dt;
            return k;
          });
          const ids = edit(app, 'Setup', (tx: Tx) => {
            for (const key of keysOf(app, W.curve)) tx.remove('keys', key.id);
            let time = 0;
            return points.map((k, i) => {
              time += k.dt;
              const id = `k_Prop${String(i).padStart(8, '0')}` as KeyId;
              tx.put('keys', {
                id,
                clip: W.clip,
                curve: W.curve,
                t: time,
                v: k.v,
                inType: k.inType,
                outType: k.outType,
                inHandle: { dt: -1, dv: -k.slopeIn },
                outHandle: { dt: 1, dv: k.slopeOut },
                broken: true,
                weightLocked: true,
              });
              return id;
            });
          });
          expect(ids).toHaveLength(points.length);
          const first = points[0]?.dt ?? 0;
          const frame = first + (t - first) * where;
          if (keysOf(app, W.curve).some((key) => Math.abs(key.t - frame) < 1e-6)) return;
          const samples = Array.from({ length: 200 }, (_, i) => first + ((t - first) * i) / 199);
          const before = samples.map((f) => valueAt(app, W.curve, f));
          edit(app, 'Insert', (tx) => insertKeyOnCurve(app, tx, W.curve, frame));
          const after = samples.map((f) => valueAt(app, W.curve, f));
          after.forEach((v, i) => expect(Math.abs(v - (before[i] as number))).toBeLessThan(1e-9));
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('deleteKeys', () => {
  it('hard-deletes keys and keeps the value of a curve that loses its last key as staticValue', () => {
    const app = waveApp();
    expect(edit(app, 'Delete', (tx) => deleteKeys(app, tx, [K15]))).toBe(1);
    expect(wavePoints(app).map(([t]) => t)).toEqual([0, 30]);
    setFrame(app, 12);
    const value = app.evaluation.channelValues(W.lowerArmL).rz;
    expect(edit(app, 'Delete', (tx) => deleteKeys(app, tx, [K0, K30, 'k_Missing0000' as KeyId]))).toBe(2);
    expect(keysOf(app, W.curve)).toEqual([]);
    expect(app.store.get('curves', W.curve)?.staticValue).toBeCloseTo(value, 15);
    expect(app.evaluation.channelValues(W.lowerArmL).rz).toBeCloseTo(value, 15);
    expect(app.evaluation.channelState(W.lowerArmL, 'rz')).toBe('static');
  });

  it('leaves locked curves alone', () => {
    const app = waveApp();
    edit(app, 'Lock', (tx) => tx.patch('curves', W.curve, { locked: true }));
    expect(edit(app, 'Delete', (tx) => deleteKeys(app, tx, [K0]))).toBe(0);
    expect(keysOf(app, W.curve)).toHaveLength(3);
  });
});

describe('naive shape-preserving insert stand-in', () => {
  it('matches the §4.11.4 span rules for step, stepNext and linear spans', async () => {
    const { naiveInsertKeyPreservingShape } = await import('../../src/testing/naive');
    const key = (t: number, v: number, inType: TangentType, outType: TangentType): KeyData => ({
      t,
      v,
      inType,
      outType,
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    });
    const curve = (keys: KeyData[]): AnimCurve => ({ keys, weighted: false, pre: 'constant', post: 'constant' });
    const step = naiveInsertKeyPreservingShape(curve([key(0, 1, 'flat', 'step'), key(10, 5, 'flat', 'step')]), 4);
    expect(step.keys[1]).toMatchObject({ t: 4, v: 1, inType: 'flat', outType: 'step' });
    expect(step.frozen).toEqual([]);
    const next = naiveInsertKeyPreservingShape(curve([key(0, 1, 'flat', 'stepNext'), key(10, 5, 'flat', 'flat')]), 4);
    expect(next.keys[1]).toMatchObject({ v: 5, inType: 'flat', outType: 'stepNext' });
    const linear = naiveInsertKeyPreservingShape(
      curve([key(0, 0, 'linear', 'linear'), key(10, 10, 'linear', 'linear')]),
      4,
    );
    expect(linear.keys[1]).toMatchObject({ v: 4, inType: 'linear', outType: 'linear' });
    expect(linear.frozen).toEqual([]);
  });
});
