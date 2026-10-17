// Graph Editor operators (MVP-SPEC §4.9 `graph.*`, §4.11.3–§4.11.5) on the wave fixture: targets (selected keys and
// handles, else the shown curves), tangent rules, weights, infinity, numeric fields, moving/scaling/deleting/
// inserting keys, the key clipboard, Euler filter and Simplify; undo/redo exactness.
import { type KeyData, RAD2DEG } from '@ekza-animator/anim-core';
import type { CurveId, KeyId, KeyRecord } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
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

type App = ReturnType<typeof opsApp>;
const K = (n: number) => WAVE.keys[n] as KeyId;

function keys(app: App, curve: CurveId = WAVE.curve): readonly KeyRecord[] {
  return app.store.query.keysOfCurve(curve);
}

function key(app: App, id: KeyId): KeyRecord {
  const record = app.store.get('keys', id);
  if (record === undefined) throw new Error(`no key ${id}`);
  return record;
}

async function selectKeys(app: App, ids: readonly KeyId[], parts?: { key?: boolean; in?: boolean; out?: boolean }) {
  await runOk(app, 'select.keys', {
    items: ids.map((k) => ({ key: k, ...(parts === undefined ? {} : { parts }) })),
    mode: 'replace',
  });
}

/** Replaces the keys of a curve (test setup, outside the operators). */
function setKeys(app: App, curve: CurveId, data: readonly Partial<KeyData>[]): KeyId[] {
  return app.store.transact({ label: 'setup' }, (tx) => {
    for (const k of tx.query.keysOfCurve(curve)) tx.remove('keys', k.id);
    return data.map((d, i) => {
      const id = `k_Setup${String(i).padStart(7, '0')}` as KeyId;
      tx.put('keys', {
        id,
        clip: WAVE.clip,
        curve,
        t: d.t ?? i,
        v: d.v ?? 0,
        inType: d.inType ?? 'auto',
        outType: d.outType ?? 'auto',
        inHandle: d.inHandle ?? { dt: 0, dv: 0 },
        outHandle: d.outHandle ?? { dt: 0, dv: 0 },
        broken: d.broken ?? false,
        weightLocked: d.weightLocked ?? true,
      });
      return id;
    });
  });
}

describe('graph.tangent.set', () => {
  it('sets both sides of selected keys; step sets the out side only', async () => {
    const app = opsApp();
    await selectKeys(app, [...WAVE.keys]);
    await expectUndoRedoExact(app, 'graph.tangent.set', { type: 'linear' });
    expect(keys(app).map((k) => [k.inType, k.outType])).toEqual([
      ['linear', 'linear'],
      ['linear', 'linear'],
      ['linear', 'linear'],
    ]);
    expect(app.history.peekUndo()?.label).toBe('Tangents: linear');
    await runOk(app, 'graph.tangent.set', { type: 'step', side: 'in' });
    expect(keys(app).map((k) => [k.inType, k.outType])).toEqual([
      ['linear', 'step'],
      ['linear', 'step'],
      ['linear', 'step'],
    ]);
  });

  it('sets the side of a selected handle, or the given side of a selected key', async () => {
    const app = opsApp();
    await selectKeys(app, [K(1)], { out: true });
    await runOk(app, 'graph.tangent.set', { type: 'flat' });
    expect([key(app, K(1)).inType, key(app, K(1)).outType]).toEqual(['auto', 'flat']);
    await selectKeys(app, [K(1)]);
    await runOk(app, 'graph.tangent.set', { type: 'clamped', side: 'in' });
    expect([key(app, K(1)).inType, key(app, K(1)).outType]).toEqual(['clamped', 'flat']);
  });

  it('acts on every key of the shown curves when no key is selected', async () => {
    const app = opsApp();
    await runOk(app, 'graph.tangent.set', { type: 'spline' });
    expect(keys(app).every((k) => k.inType === 'spline' && k.outType === 'spline')).toBe(true);
    // With a selected control that has no curves there is nothing to act on.
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [WAVE.hips] } });
    expect((await runResult(app, 'graph.tangent.set', { type: 'flat' })).status).toBe('cancelled');
  });

  it('stores the resolved handles when switching to fixed', async () => {
    const app = opsApp();
    await selectKeys(app, [K(0)]);
    await runOk(app, 'graph.tangent.set', { type: 'fixed' });
    const compiled = app.evaluation.compiledCurve(WAVE.curve);
    expect(key(app, K(0)).outHandle).toEqual({ dt: compiled.outDt[0], dv: compiled.outDv[0] });
  });

  it('sets plateau (M1-stretch, AnimX legacy auto) and refuses unknown types', async () => {
    const app = opsApp();
    await runOk(app, 'graph.tangent.set', { type: 'plateau' });
    expect(keys(app).every((k) => k.inType === 'plateau' && k.outType === 'plateau')).toBe(true);
    expect((await runResult(app, 'graph.tangent.set', { type: 'bezier' })).status).toBe('cancelled');
    expect((await runResult(app, 'graph.tangent.set', { type: 'flat', side: 'up' })).status).toBe('cancelled');
  });
});

describe('graph.tangent.break / unify / lockWeight / setWeighted / infinity', () => {
  it('breaks and unifies; computed pairs stay computed, fixed ones turn collinear keeping the out angle', async () => {
    const app = opsApp();
    await selectKeys(app, [K(1)]);
    await expectUndoRedoExact(app, 'graph.tangent.break');
    expect(key(app, K(1)).broken).toBe(true);
    await expectUndoRedoExact(app, 'graph.tangent.unify');
    expect(key(app, K(1))).toMatchObject({ broken: false, inType: 'auto', outType: 'auto' });

    const [, b] = setKeys(app, WAVE.curve, [
      { t: 0, v: 0 },
      {
        t: 10,
        v: 1,
        inType: 'fixed',
        inHandle: { dt: -3, dv: 0.6 },
        outType: 'fixed',
        outHandle: { dt: 3, dv: 0.3 },
        broken: true,
      },
      { t: 20, v: 0 },
    ]);
    await selectKeys(app, [b as KeyId]);
    await runOk(app, 'graph.tangent.unify');
    const unified = key(app, b as KeyId);
    expect(unified.broken).toBe(false);
    expect(unified.outHandle.dv / unified.outHandle.dt).toBeCloseTo(0.1, 12);
    expect(unified.inHandle.dv / unified.inHandle.dt).toBeCloseTo(0.1, 12);
    expect(unified.inHandle.dt).toBeLessThan(0);
  });

  it('needs selected keys to break or unify', async () => {
    const app = opsApp();
    expect((await runResult(app, 'graph.tangent.break')).status).toBe('cancelled');
    expect((await runResult(app, 'graph.tangent.unify')).status).toBe('cancelled');
  });

  it('locks or frees weights of the selected keys, or of every shown key', async () => {
    const app = opsApp();
    await expectUndoRedoExact(app, 'graph.tangent.lockWeight', { locked: false });
    expect(keys(app).every((k) => !k.weightLocked)).toBe(true);
    await selectKeys(app, [K(2)]);
    await runOk(app, 'graph.tangent.lockWeight', { locked: true });
    expect(keys(app).map((k) => k.weightLocked)).toEqual([false, false, true]);
  });

  it('makes the shown curves weighted and back', async () => {
    const app = opsApp();
    await expectUndoRedoExact(app, 'graph.curve.setWeighted', { weighted: true });
    expect(app.store.get('curves', WAVE.curve)?.weighted).toBe(true);
    expect(app.history.peekUndo()?.label).toBe('Weighted Tangents');
    await runOk(app, 'graph.curve.setWeighted', { weighted: false });
    expect(app.store.get('curves', WAVE.curve)?.weighted).toBe(false);
  });

  it('sets pre and post infinity of the selected controls’ curves', async () => {
    const app = opsApp();
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [WAVE.lowerArmL] } });
    await expectUndoRedoExact(app, 'graph.infinity.set', { post: 'cycle' });
    expect(app.store.get('curves', WAVE.curve)).toMatchObject({ pre: 'constant', post: 'cycle' });
    await runOk(app, 'graph.infinity.set', { pre: 'oscillate', post: 'cycleOffset' });
    expect(app.store.get('curves', WAVE.curve)).toMatchObject({ pre: 'oscillate', post: 'cycleOffset' });
    expect((await runResult(app, 'graph.infinity.set', {})).status).toBe('cancelled');
    expect((await runResult(app, 'graph.infinity.set', { post: 'forever' })).status).toBe('cancelled');
  });
});

describe('graph.keys.move / scale / delete / insert / keyCurves', () => {
  it('moves selected keys in frames and display units, snapped', async () => {
    const app = opsApp();
    await selectKeys(app, [K(1)]);
    const { value } = await expectUndoRedoExact(app, 'graph.keys.move', { dFrames: 3.4, dValue: 10 });
    expect(value).toEqual({ count: 1 });
    expect(key(app, K(1)).t).toBe(18);
    expect(key(app, K(1)).v).toBeCloseTo(-20 * DEG, 12);
  });

  it('deletes keys a moved key lands on', async () => {
    const app = opsApp();
    await selectKeys(app, [K(1)]);
    await runOk(app, 'graph.keys.move', { dFrames: 15, dValue: 0 });
    expect(keys(app).map((k) => k.t)).toEqual([0, 30]);
    expect(app.store.get('keys', K(2))).toBeUndefined();
    expect([...app.session.getState().selection.keys.keys()]).toEqual([K(1)]);
  });

  it('scales selected keys in time around a pivot', async () => {
    const app = opsApp();
    await selectKeys(app, [...WAVE.keys]);
    await expectUndoRedoExact(app, 'graph.keys.scale', { pivot: 0, factor: 2 });
    expect(keys(app).map((k) => k.t)).toEqual([0, 30, 60]);
    expect((await runResult(app, 'graph.keys.scale', { pivot: 0, factor: 0 })).status).toBe('cancelled');
  });

  it('deletes selected keys and forgets them', async () => {
    const app = opsApp();
    await selectKeys(app, [K(0), K(2)]);
    const { value } = await expectUndoRedoExact(app, 'graph.keys.delete');
    expect(value).toEqual({ count: 2 });
    expect(app.history.peekUndo()?.label).toBe('Delete 2 Keys');
    expect(keys(app).map((k) => k.id)).toEqual([K(1)]);
    expect(app.session.getState().selection.keys.size).toBe(0);
    expect((await runResult(app, 'graph.keys.delete')).status).toBe('cancelled');
  });

  it('inserts a key on a curve at a snapped frame without changing its shape, and selects it', async () => {
    const app = opsApp();
    const sample = (f: number) => {
      setSceneFrame(app, f);
      return app.evaluation.channelValues(WAVE.lowerArmL).rz;
    };
    const values = [0, 7, 16, 22, 25, 29].map(sample);
    const { value } = await expectUndoRedoExact(app, 'graph.key.insert', { curve: WAVE.curve, frame: 22.3 });
    const id = (value as { key: KeyId }).key;
    expect(key(app, id).t).toBe(22);
    expect([...app.session.getState().selection.keys.keys()]).toEqual([id]);
    const after = [0, 7, 16, 22, 25, 29].map(sample);
    after.forEach((v, i) => expect(v).toBeCloseTo(values[i] as number, 9));
    expect((await runResult(app, 'graph.key.insert', { curve: 'crv_nope0000000000', frame: 1 })).status).toBe(
      'cancelled',
    );
  });

  it('keys the shown curves at the current frame (S in the Graph Editor)', async () => {
    const app = opsApp();
    setSceneFrame(app, 7);
    const v7 = app.evaluation.channelValues(WAVE.lowerArmL).rz;
    const { value } = await expectUndoRedoExact(app, 'graph.keys.keyCurves');
    expect(value).toEqual({ count: 1 });
    const inserted = keys(app).find((k) => k.t === 7);
    expect(inserted?.v).toBeCloseTo(v7, 12);
  });
});

describe('graph.keys.copy / paste', () => {
  it('copies keys relative to the earliest and pastes them at the current frame (merge)', async () => {
    const app = opsApp();
    await selectKeys(app, [K(0), K(1)]);
    expect(await runOk(app, 'graph.keys.copy')).toEqual({ count: 2 });
    const clipboard = app.session.getState().clipboard.keys;
    expect(clipboard?.curves).toEqual([
      expect.objectContaining({ control: 'fk.lowerArm.L', channel: 'rz', weighted: false }),
    ]);
    expect(clipboard?.curves[0]?.keys.map((k) => k.dt)).toEqual([0, 15]);
    setSceneFrame(app, 15);
    const { value } = await expectUndoRedoExact(app, 'graph.keys.paste');
    expect(value).toEqual({ count: 2 });
    expect(keys(app).map((k) => [k.t, k.v / DEG])).toEqual([
      [0, expect.closeTo(30, 9)],
      [15, expect.closeTo(30, 9)],
      [30, expect.closeTo(-30, 9)],
    ]);
    expect(app.session.getState().selection.keys.size).toBe(2);
  });

  it('replace mode clears the pasted span first', async () => {
    const app = opsApp();
    await selectKeys(app, [K(0), K(2)]);
    await runOk(app, 'graph.keys.copy');
    setSceneFrame(app, 0);
    await runOk(app, 'graph.keys.paste', { mode: 'replace' });
    expect(keys(app).map((k) => k.t)).toEqual([0, 30]);
  });

  it('converts fixed handles when pasting into a weighted curve', async () => {
    const app = opsApp();
    const [, b] = setKeys(app, WAVE.curve, [
      { t: 0 },
      { t: 6, v: 1, outType: 'fixed', outHandle: { dt: 1, dv: 0.5 } },
      { t: 12 },
    ]);
    await selectKeys(app, [b as KeyId]);
    await runOk(app, 'graph.keys.copy');
    await runOk(app, 'graph.curve.setWeighted', { weighted: true });
    setSceneFrame(app, 18);
    await runOk(app, 'graph.keys.paste');
    const pasted = keys(app).find((k) => k.t === 18);
    // The neighbour after 18 is none (clip ends at 30 but the curve's last key is 18): the handle stays.
    expect(pasted?.outHandle).toEqual({ dt: 1, dv: 0.5 });
    setSceneFrame(app, 3);
    await runOk(app, 'graph.keys.paste');
    const early = keys(app).find((k) => k.t === 3);
    // Next key at 6: |dt| = (6 − 3) / 3 = 1 along the same direction.
    expect(early?.outHandle.dt).toBeCloseTo(1, 12);
    expect(early?.outHandle.dv).toBeCloseTo(0.5, 12);
  });

  it('needs copied keys and reports channels missing on the rig', async () => {
    const { app, services } = opsAppWith();
    expect((await runResult(app, 'graph.keys.paste')).status).toBe('cancelled');
    app.session.setState({
      clipboard: {
        pose: null,
        keys: {
          kind: 'ekza.keys',
          version: 2,
          curves: [
            {
              control: 'fk.tail',
              channel: 'rz',
              weighted: false,
              keys: [
                {
                  dt: 0,
                  v: 1,
                  inType: 'auto',
                  outType: 'auto',
                  inHandle: { dt: 0, dv: 0 },
                  outHandle: { dt: 0, dv: 0 },
                  broken: false,
                  weightLocked: true,
                },
              ],
            },
          ],
        },
      },
    });
    expect(await runOk(app, 'graph.keys.paste')).toEqual({ count: 0 });
    expect(services.toasts.at(-1)?.text).toBe('1 key(s) had no matching channel');
  });
});

describe.skipIf(!READY.wp1)('graph.keys.setFields [needs WP-1 tangentFields]', () => {
  it('types value, frame and angles on the selected key (E2E-12)', async () => {
    const app = opsApp();
    await selectKeys(app, [K(1)]);
    await expectUndoRedoExact(app, 'graph.keys.setFields', { value: -45 });
    expect(key(app, K(1)).v).toBeCloseTo(-45 * DEG, 12);
    await runOk(app, 'graph.keys.setFields', { frame: 18 });
    expect(key(app, K(1)).t).toBe(18);
    await runOk(app, 'graph.keys.setFields', { outAngleDeg: 0 });
    const k = key(app, K(1));
    expect(k.outType).toBe('fixed');
    expect(k.outHandle.dv).toBeCloseTo(0, 12);
    // The key is unified: the in side turns collinear (flat) too.
    expect(k.inType).toBe('fixed');
    expect(k.inHandle.dv).toBeCloseTo(0, 12);
    expect(app.history.peekUndo()?.label).toBe('Edit Tangent');
  });

  it('gives a positive incoming slope for a positive in-angle on a rising curve', async () => {
    const app = opsApp();
    const [, b] = setKeys(app, WAVE.curve, [
      { t: 30, v: 30 * DEG },
      { t: 40, v: 60 * DEG },
    ]);
    await selectKeys(app, [b as KeyId]);
    await runOk(app, 'graph.keys.setFields', { inAngleDeg: 30 });
    const k = key(app, b as KeyId);
    expect(k.inType).toBe('fixed');
    const slope = k.inHandle.dv / k.inHandle.dt;
    expect(slope).toBeGreaterThan(0);
    expect(slope).toBeCloseTo(Math.tan(30 * DEG) / (30 * RAD2DEG), 12);
  });

  it('moves neighbouring keys by a relative frame as one block (no key lands on another)', async () => {
    const app = opsApp();
    const ids = setKeys(app, WAVE.curve, [
      { t: 10, v: 0 },
      { t: 11, v: 1 },
      { t: 20, v: 0 },
    ]);
    await selectKeys(app, [ids[0] as KeyId, ids[1] as KeyId]);
    await runOk(app, 'graph.keys.setFields', { frame: 1, relative: true });
    expect(keys(app).map((k) => [k.t, k.v])).toEqual([
      [11, 0],
      [12, 1],
      [20, 0],
    ]);
  });

  it('moves several keys of one curve to a typed frame as a block, and never moves handle-only selections', async () => {
    const app = opsApp();
    await selectKeys(app, [K(1), K(2)]);
    await runOk(app, 'graph.keys.setFields', { frame: 20 });
    expect(keys(app).map((k) => k.t)).toEqual([0, 20, 35]);
    await selectKeys(app, [K(0)], { out: true });
    expect((await runResult(app, 'graph.keys.setFields', { frame: 5 })).status).toBe('finished');
    expect(key(app, K(0)).t).toBe(0);
  });

  it('applies relative edits and weights only on weighted curves', async () => {
    const app = opsApp();
    await selectKeys(app, [K(0), K(2)]);
    await runOk(app, 'graph.keys.setFields', { value: 5, relative: true });
    expect(key(app, K(0)).v).toBeCloseTo(35 * DEG, 12);
    expect(key(app, K(2)).v).toBeCloseTo(35 * DEG, 12);
    const before = docJson(app);
    await runOk(app, 'graph.keys.setFields', { outWeight: 2 });
    expect(docJson(app)).toEqual(before);
    await runOk(app, 'graph.curve.setWeighted', { weighted: true });
    await runOk(app, 'graph.keys.setFields', { outWeight: 2 });
    const h = key(app, K(0)).outHandle;
    expect(3 * Math.hypot(h.dt / 30, h.dv * RAD2DEG)).toBeCloseTo(2, 9);
    expect((await runResult(app, 'graph.keys.setFields', {})).status).toBe('cancelled');
  });
});

describe.skipIf(!READY.wp1)('graph.eulerFilter / graph.curves.simplify [needs WP-1]', () => {
  it('removes 2π jumps at each curve’s own keys', async () => {
    const app = opsApp();
    setKeys(app, WAVE.curve, [
      { t: 0, v: 0.1 },
      { t: 10, v: 0.2 + 2 * Math.PI },
      { t: 20, v: 0.3 },
    ]);
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [WAVE.lowerArmL] } });
    const { value } = await expectUndoRedoExact(app, 'graph.eulerFilter');
    expect(value).toEqual({ count: 1 });
    expect(keys(app).map((k) => k.v)).toEqual([0.1, expect.closeTo(0.2, 9), 0.3]);
  });

  it('leaves controls with a locked rotation curve alone', async () => {
    const { app, services } = opsAppWith();
    setKeys(app, WAVE.curve, [
      { t: 0, v: 0.1 },
      { t: 10, v: 0.2 + 2 * Math.PI },
    ]);
    app.store.transact({ label: 'lock' }, (tx) => tx.patch('curves', WAVE.curve, { locked: true }));
    const before = docJson(app);
    expect(await runOk(app, 'graph.eulerFilter')).toEqual({ count: 0 });
    expect(docJson(app)).toEqual(before);
    expect(services.toasts.at(-1)?.text).toMatch(/locked rotation curves/);
  });

  it('reduces dense curves within the tolerance', async () => {
    const app = opsApp();
    setKeys(
      app,
      WAVE.curve,
      Array.from({ length: 31 }, (_, i) => ({
        t: i,
        v: i * 0.01,
        inType: 'linear' as const,
        outType: 'linear' as const,
      })),
    );
    const { value } = await expectUndoRedoExact(app, 'graph.curves.simplify');
    expect(value).toMatchObject({ before: 31, after: 2 });
    expect((value as { maxError: number }).maxError).toBeLessThan(1e-9);
    expect((await runResult(app, 'graph.curves.simplify', { tolerance: { rotationRad: -1 } })).status).toBe(
      'cancelled',
    );
  });
});
