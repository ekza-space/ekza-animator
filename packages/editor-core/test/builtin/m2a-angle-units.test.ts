// M2A-SPEC §5.1 rule 5 on the Graph Editor's numeric path (hand-off M2A-A4-12, resolved at integration): an
// attribute with `unit: 'angle'` (the foot roll's `@roll`) is typed and shown in degrees like a rotation channel —
// `graph.keys.setFields` takes its value and tangent angles/weights in degrees, and the handle drag metrics
// (`setKeyHandle`) measure its weights in degrees, so an angle attribute behaves exactly like `rz`. A plain attribute
// stays in its own units.
import { RAD2DEG } from '@ekza-animator/anim-core';
import type { ChannelId, CurveId, KeyId, KeyRecord } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { ensureCurve } from '../../src';
import type { EditorApp } from '../../src/types';
import { DEG, expectUndoRedoExact, opsApp, runOk, WAVE } from './support';

const FPS = 30;
let serial = 0;

/** A curve on the hand with keys at 0/10/20 (values in curve units); returns its key ids. */
function curveWith(app: EditorApp, channel: ChannelId, values: readonly number[]): { curve: CurveId; keys: KeyId[] } {
  const prefix = `U${String(serial++).padStart(4, '0')}`;
  return app.store.transact({ label: 'Keys' }, (tx) => {
    const curve = ensureCurve(app, tx, WAVE.clip, WAVE.handL, channel);
    for (const key of tx.query.keysOfCurve(curve)) tx.remove('keys', key.id);
    const keys = values.map((v, i) => {
      const id = `k_${prefix}${String(i).padStart(7, '0')}` as KeyId;
      tx.put('keys', {
        id,
        clip: WAVE.clip,
        curve,
        t: i * 10,
        v,
        inType: 'auto',
        outType: 'auto',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
      });
      return id;
    });
    return { curve, keys };
  });
}

function angleApp(): EditorApp {
  const app = opsApp();
  app.store.transact({ label: 'Attributes' }, (tx) =>
    tx.patch('controls', WAVE.handL, {
      attrs: {
        roll: { type: 'float', default: 0, keyable: true, unit: 'angle' },
        blend: { type: 'float', default: 0, keyable: true },
      },
    }),
  );
  return app;
}

function select(app: EditorApp, ids: readonly KeyId[]): void {
  const parts = { key: true, in: false, out: false };
  app.session.setState({
    selection: { ...app.session.getState().selection, keys: new Map(ids.map((id) => [id, parts])) },
  });
}

function key(app: EditorApp, id: KeyId): KeyRecord {
  const record = app.store.get('keys', id);
  if (record === undefined) throw new Error(`no key ${id}`);
  return record;
}

/** The key without its identity: what must match between `rz` and `@roll` after the same edits. */
const shape = ({ t, v, inType, outType, inHandle, outHandle, broken }: KeyRecord) => ({
  t,
  v,
  inType,
  outType,
  inHandle,
  outHandle,
  broken,
});

describe('graph.keys.setFields on an angle attribute (§5.1 rule 5, M2A-A4-12)', () => {
  it('a typed value is degrees: @roll keyed at 20° becomes 30°, then +=5 makes 35°; one exact step each', async () => {
    const app = angleApp();
    const roll = curveWith(app, '@roll', [0, 20 * DEG, 0]);
    select(app, [roll.keys[1] as KeyId]);
    await expectUndoRedoExact(app, 'graph.keys.setFields', { value: 30 });
    expect(Math.abs(key(app, roll.keys[1] as KeyId).v - 30 * DEG)).toBeLessThanOrEqual(1e-9);
    await runOk(app, 'graph.keys.setFields', { value: 5, relative: true });
    expect(Math.abs(key(app, roll.keys[1] as KeyId).v - 35 * DEG)).toBeLessThanOrEqual(1e-9);
    expect(app.history.peekUndo()?.label).toBe('Set Key Value');
  });

  it('a plain attribute takes the typed value in its own units', async () => {
    const app = angleApp();
    const blend = curveWith(app, '@blend', [0, 0.2, 0]);
    select(app, [blend.keys[1] as KeyId]);
    await runOk(app, 'graph.keys.setFields', { value: 0.5 });
    expect(key(app, blend.keys[1] as KeyId).v).toBeCloseTo(0.5, 12);
  });

  it('tangent angles are measured in degrees per second: a 45° out-angle has the slope rz gets', async () => {
    const app = angleApp();
    const roll = curveWith(app, '@roll', [0, 20 * DEG, 0]);
    select(app, [roll.keys[1] as KeyId]);
    await expectUndoRedoExact(app, 'graph.keys.setFields', { outAngleDeg: 45 });
    const h = key(app, roll.keys[1] as KeyId).outHandle;
    // Maya: angle = atan(dv·k / (dt/fps)) with k = 180/π for an angle unit.
    expect(Math.atan((h.dv * RAD2DEG) / (h.dt / FPS)) / DEG).toBeCloseTo(45, 9);
    // The unified key's in side turns collinear.
    const hin = key(app, roll.keys[1] as KeyId).inHandle;
    expect(hin.dv / hin.dt).toBeCloseTo(h.dv / h.dt, 12);
  });

  it('every field edit on @roll gives exactly what it gives on rz (weighted curves, unified and weight-unlocked)', async () => {
    const app = angleApp();
    const rz = curveWith(app, 'rz', [0, 20 * DEG, -10 * DEG]);
    const roll = curveWith(app, '@roll', [0, 20 * DEG, -10 * DEG]);
    const blend = curveWith(app, '@blend', [0, 20 * DEG, -10 * DEG]);
    const edits: readonly Record<string, number | boolean>[] = [
      { value: 30 },
      { value: -4, relative: true },
      { outAngleDeg: 30 },
      { inAngleDeg: -15 },
      { outWeight: 2 },
      { inWeight: 0.5, relative: true },
      { outAngleDeg: 10, relative: true },
    ];
    for (const ids of [rz.keys, roll.keys, blend.keys]) {
      select(app, ids);
      await runOk(app, 'graph.curve.setWeighted', { weighted: true });
    }
    // Unlock the weights so a drag's weight path (`setKeyHandle` metrics) is exercised as well.
    app.store.transact({ label: 'Unlock' }, (tx) => {
      for (const id of [...rz.keys, ...roll.keys, ...blend.keys])
        tx.put('keys', { ...key(app, id), weightLocked: false });
    });
    // Maya weight of @roll's out handle in display units after each edit: 3·hypot(dt seconds, dv degrees).
    const weights: number[] = [];
    for (const args of edits) {
      for (const ids of [rz.keys, roll.keys, blend.keys]) {
        select(app, [ids[1] as KeyId]);
        await runOk(app, 'graph.keys.setFields', args);
      }
      const out = key(app, roll.keys[1] as KeyId).outHandle;
      weights.push(3 * Math.hypot(out.dt / FPS, out.dv * RAD2DEG));
    }
    expect(weights[edits.findIndex((args) => args['outWeight'] === 2)]).toBeCloseTo(2, 9);
    const rzKeys = app.store.query.keysOfCurve(rz.curve).map(shape);
    const rollKeys = app.store.query.keysOfCurve(roll.curve).map(shape);
    expect(rollKeys).toEqual(rzKeys);
    // A plain attribute reads the same numbers in its own units: different results.
    expect(app.store.query.keysOfCurve(blend.curve).map(shape)).not.toEqual(rzKeys);
  });
});
