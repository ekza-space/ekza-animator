// M6A-SPEC §5.7 (B11): the LastRun lifecycle (recording, each closing event of the table, the mode-switch exception,
// paramless repeatable ops), Adjust Last (history length kept, "(adjusted)" label, bit-identical to a fresh run, the
// re-run after `3` on the restored face selection with the recorded targets, refusals), Repeat Last by the run source,
// `tool.last`, `view.lastOpCard`, the extrude-session hook of undo/redo and the runner's coercion and option defaults.
//
// The kernel module is mocked to add `mesh.test.advance` (./support.ts) to `MESH_OPS`, so the B11 registration path
// (`registeredMeshOperator` over B7's `meshOperator`) runs end to end on the B0a reference kernel.
import type { ParamValues } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import * as kernel from '@ekza-animator/mesh-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type ComponentSelectionService,
  type EditorApp,
  type KernelMeshRuntimes,
  LAST_RUN_CLOSED,
  LEFT_MODEL_REASON,
  lastOpCardState,
  lastRunWarnings,
  NO_OPERATION_TO_ADJUST,
  type OperatorDef,
  registeredMeshOperator,
  switchWorkspace,
} from '../../src';
import type * as ComponentsFactory from '../../src/app/factories/components';
import { createMesh, type MeshTestApp, meshTestApp, positionsOf } from '../mesh/support';
import { enterModel } from './model';
import { READY } from './ready';
import { ADVANCE, type AdvanceOp } from './support';

vi.mock('@ekza-animator/mesh-core', async (importOriginal) => {
  const actual = await importOriginal<typeof kernel>();
  const { makeAdvanceOp } = await import('./support');
  const advance = makeAdvanceOp(actual);
  return { ...actual, MESH_OPS: Object.freeze({ ...actual.MESH_OPS, [advance.id]: advance }), __advance: advance };
});

/**
 * The B0a component selection service never changes; each app's service is wrapped so a test can bump its version as
 * B10's does on a selection change (`componentBumps`, one per app, in creation order).
 */
const componentBumps = vi.hoisted(() => [] as ((changed: boolean) => void)[]);
/**
 * B10's pending result (one per app, in creation order): an op's result selection stored inside its commit is
 * published when the service next reads the mesh, else in a microtask at the end of the task (`mark` stores one).
 */
const componentPending = vi.hoisted(() => [] as { mark(): void }[]);

vi.mock('../../src/app/factories/components', async (importOriginal) => {
  const actual = await importOriginal<typeof ComponentsFactory>();
  return {
    createComponents(deps: Parameters<typeof actual.createComponents>[0]): ComponentSelectionService {
      const real = actual.createComponents(deps);
      const listeners = new Set<(version: number) => void>();
      let version = real.version;
      const bump = (changed: boolean): void => {
        if (changed) version++;
        for (const listener of Array.from(listeners)) listener(version);
      };
      componentBumps.push(bump);
      let pending = false;
      const settle = (): void => {
        if (!pending) return;
        pending = false;
        bump(true);
      };
      componentPending.push({
        mark() {
          pending = true;
          queueMicrotask(settle);
        },
      });
      return Object.create(real, {
        version: { get: () => version },
        subscribe: {
          value: (listener: (version: number) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        snapshot: {
          value: (meshes?: readonly MeshId[]) => {
            settle();
            return real.snapshot(meshes);
          },
        },
      }) as ComponentSelectionService;
    },
  };
});

const advanceOp = (): AdvanceOp => (kernel as unknown as { __advance: AdvanceOp }).__advance;

/** A Model app with one cube mesh, `mesh.test.advance` registered, face `face` selected and the cube hilited. */
async function setup(face = 2): Promise<MeshTestApp & { readonly id: MeshId }> {
  const t = await meshTestApp();
  await enterModel(t.app);
  t.app.operators.register(registeredMeshOperator(ADVANCE));
  const id = createMesh(t, 'msh_Cube');
  t.app.history.clear();
  selectFace(t, id, face);
  return { ...t, id };
}

function selectFace(t: MeshTestApp, id: MeshId, face: number): void {
  const model = t.app.session.getState().model;
  t.app.session.setState({ model: { ...model, componentMode: 'face', hilite: [id] } });
  t.meshes.select(id, kernel.selectionOf('face', [face], kernel.primitive('cube', {}).counts));
}

const live = (app: EditorApp) => app.session.getState().lastRun;
const labels = (app: EditorApp) => app.history.peekUndo()?.label ?? null;
const undoCount = (app: EditorApp): number =>
  (app.history as unknown as { labels(): { undo: readonly string[] } }).labels().undo.length;

/** A store-writing operator with the given flags/params (renames the cube of `setup`). */
function writer(
  id: `${string}.${string}`,
  def: Partial<OperatorDef<unknown, unknown, unknown>> = {},
): OperatorDef<unknown, unknown, unknown> {
  let n = 0;
  return {
    id,
    label: id,
    category: 'test',
    scope: 'global',
    flags: { undo: true },
    apply: (ctx) => {
      n++;
      ctx.tx?.patch('meshes', 'msh_Cube' as MeshId, { name: `${id} ${n}` });
    },
    ...def,
  };
}

describe('LastRun recording (§5.7)', () => {
  it('records a kernel op with resolved args, kind, targets, step, source, seed and context', async () => {
    const t = await setup();
    const result = await t.app.run('mesh.test.advance' as never, { dy: 0.2 } as never, {
      source: 'menu',
      paneId: 'pane-persp',
    });
    expect(result.status).toBe('finished');
    const last = live(t.app);
    expect(last).toMatchObject({
      id: 'mesh.test.advance',
      label: 'Advance',
      args: { dy: 0.2, steps: 1, seedFace: 2 },
      kind: 'face',
      targets: [t.id],
      source: 'menu',
      paneId: 'pane-persp',
      adjustable: true,
      repeatable: true,
      tool: null,
      closed: null,
      context: { symmetry: {}, soft: null },
    });
    expect(last?.stepId).toBe(t.app.history.peekUndo()?.id);
    expect(last?.docSeqAfter).toBe(t.app.store.version);
    expect(last?.seed).toMatch(/^tx_/);
    expect(last?.params).toBe(ADVANCE.params);
  });

  it('records paramless repeatable runs (no card fields) and the run warnings', async () => {
    const t = await setup();
    t.app.operators.register(writer('test.paramless', { flags: { undo: true, repeatable: true } }));
    await t.app.runUntyped('test.paramless', undefined, { source: 'menu' });
    expect(live(t.app)).toMatchObject({
      id: 'test.paramless',
      params: [],
      args: {},
      repeatable: true,
      adjustable: false,
    });
    await t.app.runUntyped('mesh.test.advance', { dy: 2 });
    expect(lastRunWarnings(t.app)).toEqual([{ code: 'advance.far', message: 'Advanced more than 1 m', count: 1 }]);
  });

  it('records nothing for runs that are not undoable, are cancelled or fail, or record no step', async () => {
    const t = await setup();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.2 });
    const recorded = live(t.app);
    t.app.operators.register(writer('test.noundo', { flags: {}, params: [] }));
    t.app.operators.register(writer('test.cancel', { params: [], poll: () => ({ ok: false, reason: 'no' }) }));
    t.app.operators.register(
      writer('test.throws', {
        params: [],
        apply: () => {
          throw new Error('boom');
        },
      }),
    );
    t.app.operators.register(writer('test.nostep', { params: [], apply: () => {} }));
    for (const id of ['test.noundo', 'test.cancel', 'test.throws', 'test.nostep']) await t.app.runUntyped(id);
    expect(live(t.app)).toBe(recorded);
  });

  it('a selection-only operator never becomes lastRun; its selection change closes the card', async () => {
    const t = await setup();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.2 });
    t.app.operators.register({
      ...writer('test.select', { params: [], flags: { selection: true } }),
      apply: ({ app }) => {
        app.session.setState({ selection: { ...app.session.getState().selection, objects: ['msh_Cube' as MeshId] } });
      },
    });
    await t.app.runUntyped('test.select');
    expect(live(t.app)).toMatchObject({ id: 'mesh.test.advance', closed: LAST_RUN_CLOSED.selection });
  });
});

describe('the runner coerces params and applies option-box defaults (§4.6, §8.5)', () => {
  it('clamps and drops unknown keys; meshes and kind pass through unchanged', async () => {
    const t = await setup();
    const seen: unknown[] = [];
    t.app.operators.register({
      ...writer('test.args'),
      params: ADVANCE.params,
      extraArgs: ['meshes', 'kind'],
      apply: (_ctx, args) => {
        seen.push(args);
      },
    });
    await t.app.runUntyped('test.args', { steps: 9, junk: 1, meshes: ['msh_A'], kind: 'edge' });
    expect(seen).toEqual([{ steps: 4, meshes: ['msh_A'], kind: 'edge' }]);
  });

  it('option-box defaults start UI runs (keyboard, menu, tool …), never scripts or card re-runs', async () => {
    const t = await setup();
    const modeling = t.app.prefs.getState().modeling;
    t.app.prefs.setState({ modeling: { ...modeling, optionDefaults: { 'mesh.test.advance': { steps: 3 } } } });
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 }, { source: 'menu' });
    expect(live(t.app)?.args).toMatchObject({ dy: 0.1, steps: 3 });
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 });
    expect(live(t.app)?.args).toMatchObject({ dy: 0.1, steps: 1 });
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1, steps: 2 }, { source: 'toolkit' });
    expect(live(t.app)?.args).toMatchObject({ steps: 2 });
  });

  it('settles the mesh runtimes after a failed run (M6A-B7-26)', async () => {
    const t = await setup();
    const reconcile = vi.spyOn(t.app.meshes as KernelMeshRuntimes, 'reconcile');
    t.app.operators.register(
      writer('test.boom', {
        apply: () => {
          throw new Error('boom');
        },
      }),
    );
    expect((await t.app.runUntyped('test.boom')).status).toBe('failed');
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

describe('when the card closes (§5.7 table)', () => {
  async function recorded(): Promise<MeshTestApp & { readonly id: MeshId }> {
    const t = await setup();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.2 }, { source: 'keyboard' });
    // The end of the task: B10's service settles the run's own result selection (its microtask) — that publish is
    // part of the run and keeps the card live.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(live(t.app)?.closed).toBeNull();
    return t;
  }

  it('another undoable operator, or any store write by this user', async () => {
    const t = await recorded();
    t.app.operators.register(writer('test.other', { flags: { undo: true } }));
    await t.app.runUntyped('test.other');
    expect(live(t.app)?.closed).toBe(LAST_RUN_CLOSED.another);
    const u = await recorded();
    u.app.store.transact({ label: 'Rename' }, (tx) => tx.patch('meshes', u.id, { name: 'x' }));
    expect(live(u.app)?.closed).toBe(LAST_RUN_CLOSED.another);
  });

  it('a selection change of objects or of the hilite set', async () => {
    const t = await recorded();
    t.app.session.setState({ selection: { ...t.app.session.getState().selection, objects: [t.id] } });
    expect(live(t.app)?.closed).toBe(LAST_RUN_CLOSED.selection);
    const u = await recorded();
    u.app.session.setState({ model: { ...u.app.session.getState().model, hilite: [] } });
    expect(live(u.app)?.closed).toBe(LAST_RUN_CLOSED.selection);
  });

  it("a component selection change (the selection service's version; B10 bumps it)", async () => {
    const t = await setup();
    const bump = componentBumps.at(-1);
    await t.app.runUntyped('mesh.test.advance', { dy: 0.2 }, { source: 'keyboard' });
    expect(live(t.app)?.closed).toBeNull();
    bump?.(false); // a notification with the same version keeps the card
    expect(live(t.app)?.closed).toBeNull();
    bump?.(true);
    expect(live(t.app)?.closed).toBe(LAST_RUN_CLOSED.selection);
  });

  it("not the run's own result selection, which B10's service publishes after the commit (on a read or a microtask)", async () => {
    const t = await setup();
    const pending = componentPending.at(-1);
    t.app.operators.register(
      writer('test.result', {
        params: [],
        flags: { undo: true, adjustable: true },
        apply: (ctx) => {
          ctx.tx?.patch('meshes', t.id, { name: 'result' });
          pending?.mark(); // the op stores its result selection inside its commit
        },
      }),
    );
    await t.app.runUntyped('test.result', {}, { source: 'keyboard' });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(live(t.app)).toMatchObject({ id: 'test.result', closed: null });
    // A later change still closes it.
    componentBumps.at(-1)?.(true);
    expect(live(t.app)?.closed).toBe(LAST_RUN_CLOSED.selection);
  });

  it.skipIf(!READY.b10)("a component selection change through B10's service (READY.b10)", async () => {
    const t = await recorded();
    t.app.components.set(t.id, kernel.selectionOf('face', [3], kernel.primitive('cube', {}).counts));
    expect(live(t.app)?.closed).toBe(LAST_RUN_CLOSED.selection);
  });

  it('undo or redo of any step', async () => {
    const t = await recorded();
    t.app.history.undo();
    expect(live(t.app)?.closed).toBe(LAST_RUN_CLOSED.undone);
  });

  it('a workspace switch', async () => {
    const t = await recorded();
    switchWorkspace(t.app, 'animate');
    expect(live(t.app)?.closed).toBe(LEFT_MODEL_REASON);
  });

  it('a remote batch touching a target mesh (another mesh keeps the card live and adjustable)', async () => {
    const t = await recorded();
    const other = createMeshRemote(t, 'msh_Other');
    expect(live(t.app)?.closed).toBeNull();
    expect(t.app.operators.poll('edit.adjustLast', undefined, { args: { dy: 0.3 } })).toBe(true);
    void other;
    const record = t.app.store.get('meshes', t.id);
    if (record === undefined) throw new Error('missing');
    t.app.store.applyChanges(
      [{ table: 'meshes', id: t.id, before: record, after: { ...record, name: 'Renamed' }, fields: ['name'] }],
      { origin: 'remote', label: 'Peer rename' },
    );
    expect(live(t.app)?.closed).toBe(LAST_RUN_CLOSED.remote);
  });

  it('symmetry or soft-select settings of a target mesh', async () => {
    const t = await recorded();
    const model = t.app.session.getState().model;
    t.app.session.setState({
      model: {
        ...model,
        symmetry: new Map([['msh_Else' as MeshId, { mode: 'object-x', tolerance: 0.001, preserveSeam: true }]]),
      },
    });
    expect(live(t.app)?.closed).toBeNull();
    t.app.session.setState({
      model: {
        ...t.app.session.getState().model,
        symmetry: new Map([[t.id, { mode: 'object-x', tolerance: 0.001, preserveSeam: true }]]),
      },
    });
    expect(live(t.app)?.closed).toBe(LAST_RUN_CLOSED.settings);
    const u = await recorded();
    const soft = u.app.session.getState().model.softSelect;
    u.app.session.setState({ model: { ...u.app.session.getState().model, softSelect: { ...soft, on: true } } });
    expect(live(u.app)?.closed).toBe(LAST_RUN_CLOSED.settings);
  });

  it('never: a component-mode switch with the same hilite, shading, panels, camera, T (E2E-MOD-19)', async () => {
    const t = await recorded();
    const model = t.app.session.getState().model;
    t.app.session.setState({ model: { ...model, componentMode: 'object', lastComponentMode: 'face' } });
    t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'vertex' } });
    t.app.session.setState({ hoveredPanel: { kind: 'viewport', paneId: 'pane-top' } });
    t.app.session.setState({ viewportLayout: 'quad', maximizedPane: null });
    expect((await t.app.runUntyped('view.lastOpCard', { expand: true, focusPrimary: true })).status).toBe('finished');
    expect(live(t.app)?.closed).toBeNull();
    expect(t.app.operators.poll('edit.adjustLast', undefined, { args: {} })).toBe(true);
  });
});

/** Creates a mesh through a remote batch (another user's record: a batch that touches no target). */
function createMeshRemote(t: MeshTestApp, id: string): MeshId {
  const existing = t.app.store.get('meshes', t.app.session.getState().lastRun?.targets[0] as MeshId);
  if (existing === undefined) throw new Error('missing');
  const after = { ...existing, id: id as MeshId, name: id };
  t.app.store.applyChanges([{ table: 'meshes', id: id as MeshId, before: undefined, after }], {
    origin: 'remote',
    label: 'Peer create',
  });
  return id as MeshId;
}

describe('edit.adjustLast (§5.7)', () => {
  it('replaces the step: history length kept, "(adjusted)" label, bit-identical to a fresh run', async () => {
    const t = await setup();
    const base = positionsOf(t, t.id);
    await t.app.runUntyped('mesh.test.advance', { dy: 0.2 }, { source: 'keyboard' });
    const before = undoCount(t.app);
    const seed = live(t.app)?.seed;
    const result = await t.app.run('edit.adjustLast', { args: { dy: 0.35, steps: 2 } });
    expect(result.status).toBe('finished');
    expect(undoCount(t.app)).toBe(before);
    expect(labels(t.app)).toBe('Advance (adjusted)');
    expect(t.app.history.canRedo()).toBe(false);
    expect(live(t.app)).toMatchObject({
      args: { dy: 0.35, steps: 2, seedFace: 2 },
      source: 'keyboard',
      seed,
      closed: null,
    });
    // A fresh run with the same args on a fresh app lands on the same positions, bit for bit.
    const f = await setup();
    await f.app.runUntyped('mesh.test.advance', { dy: 0.35, steps: 2 });
    expect(positionsOf(t, t.id)).toEqual(positionsOf(f, f.id));
    expect(positionsOf(t, t.id)).not.toEqual(base);
    // One undo removes the adjusted operation entirely.
    t.app.history.undo();
    expect(positionsOf(t, t.id)).toEqual(base);
  });

  it('after `3` (object mode) re-runs on the restored face selection with the recorded targets', async () => {
    const t = await setup(4);
    const base = positionsOf(t, t.id);
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 }, { source: 'keyboard' });
    // `3` again: object mode, the hilite list kept; the selection of the face mode stays in memory.
    t.app.session.setState({
      model: { ...t.app.session.getState().model, componentMode: 'object', lastComponentMode: 'face' },
    });
    expect(live(t.app)?.closed).toBeNull();
    const op = advanceOp();
    const reads = op.reads.length;
    expect((await t.app.run('edit.adjustLast', { args: { dy: 0.5 } })).status).toBe('finished');
    expect(op.reads.length).toBe(reads + 1);
    expect(op.reads.at(-1)).toEqual([4]);
    expect(t.app.session.getState().model.componentMode).toBe('object');
    expect(live(t.app)).toMatchObject({ kind: 'face', targets: [t.id], args: { dy: 0.5 } });
    const moved = positionsOf(t, t.id);
    const f = await setup(4);
    await f.app.runUntyped('mesh.test.advance', { dy: 0.5 });
    expect(moved).toEqual(positionsOf(f, f.id));
    expect(moved).not.toEqual(base);
  });

  it('a refused re-run redoes the original step and reports the reason', async () => {
    const t = await setup();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.2 });
    const after = positionsOf(t, t.id);
    const count = undoCount(t.app);
    const result = await t.app.run('edit.adjustLast', { args: { dy: 13 } });
    expect(result).toEqual({ status: 'cancelled', reason: 'Advance: Thirteen is unlucky' });
    expect(undoCount(t.app)).toBe(count);
    expect(labels(t.app)).toBe('Advance');
    expect(positionsOf(t, t.id)).toEqual(after);
    expect(live(t.app)).toMatchObject({ args: { dy: 0.2 }, closed: null, stepId: t.app.history.peekUndo()?.id });
    // The card is still adjustable.
    expect((await t.app.run('edit.adjustLast', { args: { dy: 0.3 } })).status).toBe('finished');
  });

  it('poll: a live, adjustable last run whose step is on top and nothing written since', async () => {
    const t = await setup();
    expect(t.app.operators.poll('edit.adjustLast', undefined, { args: {} })).toEqual({
      ok: false,
      reason: NO_OPERATION_TO_ADJUST,
    });
    t.app.operators.register(writer('test.repeatOnly', { flags: { undo: true, repeatable: true } }));
    await t.app.runUntyped('test.repeatOnly');
    expect(t.app.operators.poll('edit.adjustLast', undefined, { args: {} })).toEqual({
      ok: false,
      reason: 'test.repeatOnly has no settings to adjust',
    });
  });

  it('mesh.create.cube: the adjusted re-run keeps the mesh id and records the primitive parameters', async () => {
    const t = await meshTestApp();
    await enterModel(t.app);
    const modeling = t.app.prefs.getState().modeling;
    t.app.prefs.setState({ modeling: { ...modeling, primitiveDefaults: 'maya' } });
    const created = await t.app.run('mesh.create.cylinder', {});
    const id = (created as { value: { mesh: MeshId } }).value.mesh;
    expect(live(t.app)).toMatchObject({ id: 'mesh.create.cylinder', targets: [id], kind: null });
    // The Maya set was used and recorded (radius 1, height 2, 20 sides).
    expect(live(t.app)?.args).toMatchObject({ radius: 1, height: 2, subdivisionsAxis: 20 });
    const count = undoCount(t.app);
    await t.app.run('edit.adjustLast', { args: { subdivisionsAxis: 10 } });
    expect(undoCount(t.app)).toBe(count);
    expect(t.app.store.get('meshes', id)?.generator?.params).toMatchObject({ subdivisionsAxis: 10, radius: 1 });
    expect(t.app.session.getState().selection.objects).toEqual([id]);
    expect(live(t.app)?.targets).toEqual([id]);
  });
});

describe('edit.repeatLast (§5.7 source rule)', () => {
  it('rule 2: a menu run repeats on the current selection; selection-bound args re-resolve', async () => {
    const t = await setup(2);
    await t.app.runUntyped('mesh.test.advance', { dy: 0.25, steps: 2 }, { source: 'menu' });
    expect(live(t.app)?.args['seedFace']).toBe(2);
    selectFace(t, t.id, 5);
    const op = advanceOp();
    expect((await t.app.run('edit.repeatLast', undefined, { source: 'keyboard' })).status).toBe('finished');
    expect(op.reads.at(-1)).toEqual([5]);
    expect(live(t.app)).toMatchObject({ args: { dy: 0.25, steps: 2, seedFace: 5 }, source: 'keyboard' });
    expect(labels(t.app)).toBe('Advance');
  });

  it('rule 1: after a tool run `G` re-activates the tool (no new step); rule 3 for pointer-only ops', async () => {
    const t = await setup();
    t.app.operators.register(writer('test.cut', { flags: { undo: true }, params: [], tool: 'multiCut' }));
    await t.app.runUntyped('test.cut', undefined, { source: 'tool' });
    t.app.session.setState({ tools: { ...t.app.session.getState().tools, viewport: 'move' } });
    const steps = undoCount(t.app);
    expect((await t.app.run('edit.repeatLast')).status).toBe('finished');
    expect(t.app.session.getState().tools.viewport).toBe('multiCut');
    expect(undoCount(t.app)).toBe(steps);
    // Rule 3: not repeatable, with a tool: the tool even after a menu run.
    await t.app.runUntyped('test.cut', undefined, { source: 'menu' });
    t.app.session.setState({ tools: { ...t.app.session.getState().tools, viewport: 'select' } });
    expect((await t.app.run('edit.repeatLast')).status).toBe('finished');
    expect(t.app.session.getState().tools.viewport).toBe('multiCut');
  });

  it('poll: nothing ran; not repeatable without a tool; the operator no longer polls', async () => {
    const t = await setup();
    expect(t.app.operators.poll('edit.repeatLast')).toEqual({ ok: false, reason: 'Nothing to repeat' });
    t.app.operators.register(writer('test.once', { flags: { undo: true, adjustable: true }, params: [] }));
    await t.app.runUntyped('test.once');
    expect(t.app.operators.poll('edit.repeatLast')).toEqual({ ok: false, reason: 'test.once cannot be repeated' });
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 });
    t.meshes.select(t.id, kernel.selectionOf('face', [], kernel.primitive('cube', {}).counts));
    expect(t.app.operators.poll('edit.repeatLast')).toEqual({ ok: false, reason: 'Select components first' });
  });
});

describe('tool.last and view.lastOpCard', () => {
  it('Y activates the last non-transform viewport tool', async () => {
    const t = await setup();
    expect(t.app.operators.poll('tool.last')).toEqual({ ok: false, reason: 'No tool used yet' });
    await t.app.run('view.tool', { panel: 'viewport', tool: 'multiCut' });
    await t.app.run('view.tool', { panel: 'viewport', tool: 'move' });
    expect((await t.app.run('tool.last')).status).toBe('finished');
    expect(t.app.session.getState().tools.viewport).toBe('multiCut');
  });

  it('T opens and expands the card with the primary field focused; reopens an extrude session', async () => {
    const t = await setup();
    expect((await t.app.run('view.lastOpCard', { expand: true, focusPrimary: true })).status).toBe('cancelled');
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 }, { paneId: 'pane-front', source: 'menu' });
    const seq = lastOpCardState(t.app).focusSeq;
    expect(lastOpCardState(t.app).expanded).toBe(false);
    await t.app.run('view.lastOpCard', { expand: true, focusPrimary: true });
    expect(lastOpCardState(t.app)).toMatchObject({
      expanded: true,
      focusField: 'dy',
      paneId: 'pane-front',
      dismissed: false,
    });
    expect(lastOpCardState(t.app).focusSeq).toBe(seq + 1);
    // An adjusted re-run keeps the card as it is; a new operation starts collapsed.
    await t.app.run('edit.adjustLast', { args: { dy: 0.2 } });
    expect(lastOpCardState(t.app).expanded).toBe(true);
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 });
    expect(lastOpCardState(t.app).expanded).toBe(false);
    // `T` on a live extrude reopens its session when the selection is still its result (§5.7; B12b decides the rest).
    const reopen = vi.spyOn(t.app.extrude, 'reopen');
    const current = live(t.app);
    if (current === null) throw new Error('no lastRun');
    t.app.session.setState({ lastRun: { ...current, id: 'mesh.extrude' } });
    await t.app.run('view.lastOpCard', { expand: true, focusPrimary: true });
    expect(reopen).toHaveBeenCalledTimes(1);
    // A switch to object mode keeps the card live (same hilite) but shows another selection: `T` opens only the card.
    const model = t.app.session.getState().model;
    t.app.session.setState({ model: { ...model, componentMode: 'object' } });
    expect(live(t.app)?.closed).toBeNull();
    expect((await t.app.run('view.lastOpCard', { expand: true, focusPrimary: true })).status).toBe('finished');
    expect(reopen).toHaveBeenCalledTimes(1);
    // Back in face mode the result is the selection again.
    t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'face' } });
    await t.app.run('view.lastOpCard', { expand: true, focusPrimary: true });
    expect(reopen).toHaveBeenCalledTimes(2);
  });
});

describe('edit.undo / edit.redo and the extrude session (§5.8 args stack)', () => {
  it('without a session undo stays synchronous (shipped behaviour)', async () => {
    const t = await setup();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 });
    const count = undoCount(t.app);
    void t.app.run('edit.undo');
    expect(undoCount(t.app)).toBe(count - 1);
  });

  it('while a session is open they step its stack first; at its end they undo the extrude', async () => {
    const t = await setup();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 });
    const count = undoCount(t.app);
    (t.app.extrude as { state: unknown }).state = { stepId: 1 };
    const back = vi.spyOn(t.app.extrude, 'stepBack').mockReturnValueOnce(true).mockReturnValueOnce(false);
    const forward = vi.spyOn(t.app.extrude, 'stepForward').mockReturnValueOnce(true);
    await t.app.run('edit.undo');
    expect(back).toHaveBeenCalledTimes(1);
    expect(undoCount(t.app)).toBe(count);
    await t.app.run('edit.redo');
    expect(forward).toHaveBeenCalledTimes(1);
    expect(t.app.history.canRedo()).toBe(false);
    await t.app.run('edit.undo');
    expect(undoCount(t.app)).toBe(count - 1);
  });
});

describe('capture arming after keyboard runs (§5.10 (b))', () => {
  it('arms after a keyboard run with a primary param, in Model only', async () => {
    const t = await setup();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 }, { source: 'menu' });
    expect(t.app.capture.state.armed).toBeNull();
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 }, { source: 'keyboard' });
    expect(t.app.capture.state).toEqual({ armed: 'keyboard-op', field: 'dy', text: null });
    expect(t.app.session.getState().model.capture).toEqual(t.app.capture.state);
    t.app.capture.disarm();
    switchWorkspace(t.app, 'animate');
    selectFace(t, t.id, 2);
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 }, { source: 'keyboard' });
    expect(t.app.capture.state.armed).toBeNull();
  });

  it("never with numericCapture 'explicit'", async () => {
    const t = await setup();
    const modeling = t.app.prefs.getState().modeling;
    t.app.prefs.setState({ modeling: { ...modeling, numericCapture: 'explicit' } });
    await t.app.runUntyped('mesh.test.advance', { dy: 0.1 }, { source: 'keyboard' });
    expect(t.app.capture.state.armed).toBeNull();
  });
});

/** Unused-import guard for ParamValues (type-only re-export check). */
export type _Args = ParamValues;
