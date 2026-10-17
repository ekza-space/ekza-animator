// The Graph Editor over the real packages: `createEditorApp` with WP-2's memory store, WP-1's AnimX engine, WP-3's
// curve cache and WP-7a's kernel and history. Until those land their stubs throw `not-implemented` and this file
// skips itself (MVP-SPEC §8.1); afterwards it replays the Graph Editor steps of E2E-08…E2E-13 headlessly with exact
// evaluation. Operators that WP-7b registers (`select.keys`, `graph.key.insert`) get minimal stand-ins until then.
import { curveEngine, EkzaError, RAD2DEG } from '@ekza-animator/anim-core';
import { type CurveId, createMemoryStore, type KeyId, type KeyRecord } from '@ekza-animator/doc';
import {
  createEditorApp,
  type EditorApp,
  insertKeyOnCurve,
  type KeyPartSelection,
  type OperatorArgs,
  type OperatorDef,
  setTangentTypes,
  type ToolPointerEvent,
} from '@ekza-animator/editor-core';
import { createFakeServices } from '@ekza-animator/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphEditorController, registerGraphContributions } from '../src';
import { applyKeySelection } from '../src/graph/selection';
import { addCurve, key, pointer, settle, WAVE, waveDoc } from './support/app';

const READY = (() => {
  try {
    createEditorApp({ services: createFakeServices(), store: createMemoryStore() }).dispose();
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
})();

interface Real {
  readonly app: EditorApp;
  readonly controller: GraphEditorController;
  /** rx and ry: flat at 0 with keys at 0/15/30, as `key.set` leaves them next to the rz wave. */
  readonly rx: CurveId;
  readonly ry: CurveId;
}

let current: { real: Real; dispose: () => void } | null = null;
afterEach(() => {
  current?.dispose();
  current = null;
});

/** Registers `def` unless the builtins (WP-7b) already provide the operator. */
function standIn<A, R>(app: EditorApp, def: OperatorDef<A, R, void>): void {
  if (app.operators.get(def.id) === undefined) app.operators.register(def);
}

async function realApp(): Promise<Real> {
  const store = createMemoryStore();
  store.load(await waveDoc());
  const app = createEditorApp({ services: createFakeServices(), store });
  standIn<OperatorArgs<'select.keys'>, void>(app, {
    id: 'select.keys',
    label: 'Select Keys',
    category: 'select',
    scope: 'global',
    apply: (ctx, args) => {
      const selection = ctx.app.session.getState().selection;
      const items = args.items.map((item) => ({
        key: item.key,
        parts: { key: false, in: false, out: false, ...item.parts },
      }));
      ctx.app.session.setState({
        selection: { ...selection, keys: applyKeySelection(selection.keys, items, args.mode) },
      });
    },
  });
  standIn<OperatorArgs<'graph.key.insert'>, { readonly key: KeyId }>(app, {
    id: 'graph.key.insert',
    label: 'Insert Key',
    category: 'graph',
    scope: 'graph',
    flags: { undo: true },
    apply: (ctx, args) => {
      if (ctx.tx === null) throw new Error('graph.key.insert needs a transaction');
      const snap = ctx.app.session.getState().time.snapToFrames;
      return { key: insertKeyOnCurve(ctx.app, ctx.tx, args.curve, snap ? Math.round(args.frame) : args.frame) };
    },
  });
  const flat = [key(0, 0), key(15, 0), key(30, 0)];
  const rx = addCurve(app, { channel: 'rx', keys: flat }).curve;
  const ry = addCurve(app, { channel: 'ry', keys: flat }).curve;

  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:600px;height:300px';
  const base = document.createElement('canvas');
  const overlay = document.createElement('canvas');
  host.append(base, overlay);
  document.body.append(host);
  const controller = new GraphEditorController({ app, base, overlay });
  const contributions = registerGraphContributions(app, () => controller);
  controller.resize(600, 300, 1);
  controller.setCurves([rx, ry, WAVE.curve]);
  const real = { app, controller, rx, ry };
  current = {
    real,
    dispose: () => {
      contributions();
      controller.dispose();
      host.remove();
      app.dispose();
    },
  };
  return real;
}

const at = (point: { readonly x: number; readonly y: number } | null): { x: number; y: number } => {
  if (point === null) throw new Error('point is not on the canvas');
  return { x: point.x, y: point.y };
};

const record = (app: EditorApp, id: KeyId): KeyRecord => {
  const found = app.store.get('keys', id);
  if (found === undefined) throw new Error(`key ${id} is gone`);
  return found;
};
const rz = (app: EditorApp, frame: number): number =>
  curveEngine.evaluate(app.evaluation.compiledCurve(WAVE.curve), frame) * RAD2DEG;
const curveState = (app: EditorApp) => ({
  curve: app.store.get('curves', WAVE.curve),
  keys: app.store.query.keysOfCurve(WAVE.curve),
});

function click(c: GraphEditorController, p: { readonly x: number; readonly y: number }, detail = 1): void {
  c.pointerDown(pointer({ ...p, detail }));
  c.pointerUp(pointer({ ...p, detail, buttons: 0 }));
}

function dragBy(
  c: GraphEditorController,
  from: { readonly x: number; readonly y: number },
  dx: number,
  dy: number,
  extra?: Partial<ToolPointerEvent>,
): void {
  c.pointerDown(pointer({ ...extra, ...from }));
  for (const t of [0.25, 0.5, 0.75, 1]) c.pointerMove(pointer({ ...extra, x: from.x + dx * t, y: from.y + dy * t }));
  c.pointerUp(pointer({ ...extra, x: from.x + dx, y: from.y + dy, buttons: 0 }));
}

const selected = (app: EditorApp): Map<KeyId, KeyPartSelection> => new Map(app.session.getState().selection.keys);

describe.skipIf(!READY)('Graph Editor over the real packages (blocked by WP-1, WP-2, WP-3, WP-7a)', () => {
  it('E2E-08: a double-click where rx/ry cross the rz wave selects the rz keys; tangent types act on them', async () => {
    const { app, controller } = await realApp();
    const p = at(controller.curvePoint(WAVE.curve, 7.5));
    click(controller, p, 1);
    click(controller, p, 2);
    await settle();
    expect([...selected(app).keys()]).toEqual([...WAVE.keys]);
    const keys = [...selected(app).keys()];
    const v0 = record(app, WAVE.keys[0]).v * RAD2DEG;
    const v15 = record(app, WAVE.keys[1]).v * RAD2DEG;
    app.store.transact({ label: 'Linear' }, (tx) => setTangentTypes(app, tx, keys, 'linear', 'both'));
    expect(rz(app, 7.5)).toBeCloseTo((v0 + v15) / 2, 9);
    app.store.transact({ label: 'Step' }, (tx) => setTangentTypes(app, tx, keys, 'step', 'both'));
    expect(rz(app, 14)).toBeCloseTo(v0, 9);
    expect(rz(app, 29)).toBeCloseTo(v15, 9);
  });

  it('E2E-09/13: a pen drag on the broken out handle changes 15–30 only; one undo restores, redo repeats', async () => {
    const { app, controller } = await realApp();
    click(controller, at(controller.keyPoint(WAVE.keys[1])));
    await settle();
    expect([...selected(app).keys()]).toEqual([WAVE.keys[1]]);
    app.store.transact({ label: 'Break Tangents' }, (tx) =>
      tx.put('keys', { ...record(app, WAVE.keys[1]), broken: true }),
    );
    const before = curveState(app);
    const early = [0, 3, 7.5, 12, 15].map((f) => rz(app, f));
    const late = [18, 22.5, 27].map((f) => rz(app, f));
    dragBy(controller, at(controller.handlePoint(WAVE.keys[1], 'out')), 0, -40);
    await settle();
    const k = record(app, WAVE.keys[1]);
    expect(k.outType).toBe('fixed');
    expect(k.inType).toBe(before.keys[1]?.inType);
    expect(k.broken).toBe(true);
    [0, 3, 7.5, 12, 15].forEach((f, i) => expect(rz(app, f)).toBeCloseTo(early[i] as number, 9));
    expect([18, 22.5, 27].some((f, i) => Math.abs(rz(app, f) - (late[i] as number)) > 1e-6)).toBe(true);
    expect(app.history.peekUndo()?.label).toBe('Edit Tangent');
    const after = curveState(app);
    app.history.undo();
    expect(curveState(app)).toEqual(before);
    app.history.redo();
    expect(curveState(app)).toEqual(after);
  });

  it('E2E-10: a free weighted handle changes length; a locked one keeps its Maya weight', async () => {
    const { app, controller } = await realApp();
    app.store.transact({ label: 'Weighted' }, (tx) => {
      tx.patch('curves', WAVE.curve, { weighted: true });
      for (const id of WAVE.keys) tx.put('keys', { ...record(app, id), weightLocked: false });
    });
    click(controller, at(controller.keyPoint(WAVE.keys[0])));
    await settle();
    const values = WAVE.keys.map((id) => record(app, id).v);
    const at7 = rz(app, 7);
    dragBy(controller, at(controller.handlePoint(WAVE.keys[0], 'out')), 60, 0);
    await settle();
    expect(WAVE.keys.map((id) => record(app, id).v)).toEqual(values);
    expect(Math.abs(rz(app, 7) - at7)).toBeGreaterThan(1e-6);
    const free = record(app, WAVE.keys[0]).outHandle;
    expect(free.dt).toBeGreaterThan(5);

    app.store.transact({ label: 'Lock Weights' }, (tx) =>
      tx.put('keys', { ...record(app, WAVE.keys[0]), weightLocked: true }),
    );
    const fps = 30;
    const weight = (h: { readonly dt: number; readonly dv: number }) =>
      3 * Math.hypot(Math.abs(h.dt) / fps, h.dv * RAD2DEG);
    dragBy(controller, at(controller.handlePoint(WAVE.keys[0], 'out')), 0, -30);
    await settle();
    const locked = record(app, WAVE.keys[0]).outHandle;
    expect(weight(locked)).toBeCloseTo(weight(free), 6);
    expect(locked.dv).toBeGreaterThan(free.dv);
  });

  it('E2E-11: the Insert tool adds a key at frame 22 without changing the curve', async () => {
    const { app, controller } = await realApp();
    app.session.setState({ tools: { ...app.session.getState().tools, graph: 'insert' } });
    const frames = Array.from({ length: 121 }, (_, i) => i / 4);
    const before = frames.map((f) => rz(app, f));
    click(controller, at(controller.curvePoint(WAVE.curve, 22)));
    await settle();
    expect(app.store.query.keysOfCurve(WAVE.curve).map((k) => k.t)).toEqual([0, 15, 22, 30]);
    frames.forEach((f, i) => expect(rz(app, f)).toBeCloseTo(before[i] as number, 6));
    expect(app.history.peekUndo()?.label).toBe('Insert Key');
  });

  it('MMB move onto a key: the collision deletes the non-moved key in the same step; undo restores it', async () => {
    const { app, controller } = await realApp();
    click(controller, at(controller.keyPoint(WAVE.keys[1])));
    await settle();
    const before = curveState(app);
    dragBy(controller, { x: 20, y: 20 }, 15 * controller.view.sx, 0, { button: 1 });
    await settle();
    const keys = app.store.query.keysOfCurve(WAVE.curve);
    expect(keys.map((k) => [k.id, k.t])).toEqual([
      [WAVE.keys[0], 0],
      [WAVE.keys[1], 30],
    ]);
    expect(app.history.peekUndo()?.label).toBe('Move Keys');
    expect(selected(app).has(WAVE.keys[2])).toBe(false);
    app.history.undo();
    expect(curveState(app)).toEqual(before);
  });
});
