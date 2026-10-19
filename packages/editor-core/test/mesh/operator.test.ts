// M6A-SPEC §4.6 (B7): the descriptor wrappers. `meshes` and `kind` survive `coerceArgs` (the runner's coercion with
// `passThrough: def.extraArgs`) and reach `apply`; default targets are the hilited meshes with a selection of the
// kind; Adjust Last's recorded kind, seed and symmetry/soft context reach the commit; READY.b1: real kernel ops
// (extrude) through the runtime, undo through the journal back to the identical manifest.
import { coerceArgs } from '@ekza-animator/anim-core';
import { primitive, selectionOf } from '@ekza-animator/mesh-core';
import { MESH_OP_DESCRIPTORS, MESH_SET_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { describe, expect, it, vi } from 'vitest';
import { adjustedRun, type LastRun, meshOperator, meshSetOperator, runSeedOf, runSettings } from '../../src';
import { createMesh, meshTestApp } from './support';
import { READY } from './ready';

describe('meshOperator and the runner (§4.6)', () => {
  it('meshes and kind survive coerceArgs with the declared extraArgs; unknown keys drop', () => {
    const desc = MESH_OP_DESCRIPTORS['mesh.extrude'];
    if (desc === undefined) throw new Error('missing descriptor');
    const def = meshOperator(desc);
    const { args, problems } = coerceArgs(
      def.params ?? [],
      { meshes: ['msh_A', 'msh_B'], kind: 'face', divisions: 2, junk: 1 },
      { passThrough: def.extraArgs ?? [] },
    );
    expect(args['meshes']).toEqual(['msh_A', 'msh_B']);
    expect(args['kind']).toBe('face');
    expect(args['divisions']).toBe(2);
    expect('junk' in args).toBe(false);
    expect(problems).toEqual(["unknown argument 'junk' dropped"]);
    const setDef = meshSetOperator(MESH_SET_OP_DESCRIPTORS['mesh.combine'] as never);
    expect(setDef.extraArgs).toEqual(['meshes', 'kind']);
  });

  it('apply receives meshes and kind unchanged and passes the kind, seed and recorded context to commitOp', async () => {
    const t = await meshTestApp({ builtins: false });
    const id = createMesh(t, 'msh_Cube');
    const desc = MESH_OP_DESCRIPTORS['mesh.extrude'];
    if (desc === undefined) throw new Error('missing descriptor');
    t.app.operators.register(meshOperator(desc));
    const commit = vi.spyOn(t.meshes, 'commitOp');
    t.meshes.select(id, selectionOf('face', [0], primitive('cube', {}).counts));
    // A first run (menu): fresh seed, the session's settings (none recorded).
    await t.app.runUntyped('mesh.extrude', { meshes: [id], kind: 'face', divisions: 2 }, { source: 'menu' });
    expect(commit).toHaveBeenCalledTimes(1);
    const [, , targets, args, ctx] = commit.mock.calls[0] ?? [];
    expect(targets).toEqual([id]);
    expect(args).toEqual({ divisions: 2 });
    expect(ctx).toMatchObject({ kind: 'face' });
    expect((ctx as { settings?: unknown }).settings).toBeUndefined();
    const seed = runSeedOf(t.app)?.seed;
    expect(typeof seed).toBe('string');
    // An adjusted re-run (card) of the same operator: the recorded seed and context.
    const lastRun = {
      id: 'mesh.extrude',
      seed: 'tx_recorded',
      context: { symmetry: { [id]: { mode: 'object-x', tolerance: 0.001, preserveSeam: true } }, soft: null },
    } as unknown as LastRun;
    t.app.session.setState({ lastRun });
    await t.app.runUntyped('mesh.extrude', { meshes: [id], kind: 'face' }, { source: 'card' });
    const [, , , , adjusted] = commit.mock.calls[1] ?? [];
    expect(adjusted).toMatchObject({ seed: 'tx_recorded', kind: 'face', settings: lastRun.context });
    // Any other source is a first run.
    const ctx3 = { app: t.app, source: 'keyboard' } as never;
    expect(adjustedRun(ctx3, 'mesh.extrude')).toBeNull();
    expect(runSettings(ctx3, 'mesh.extrude')).toBeUndefined();
  });

  it('default targets: the hilited meshes with a selection of the kind (others are skipped)', async () => {
    const t = await meshTestApp({ builtins: false });
    const a = createMesh(t, 'msh_A');
    const b = createMesh(t, 'msh_B');
    t.app.operators.register(meshOperator(MESH_OP_DESCRIPTORS['mesh.extrude'] as never));
    const commit = vi.spyOn(t.meshes, 'commitOp');
    t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: 'face', hilite: [a, b] } });
    expect(t.app.operators.poll('mesh.extrude', undefined, {})).toEqual({
      ok: false,
      reason: 'Select components first',
    });
    t.meshes.select(b, selectionOf('face', [2], primitive('cube', {}).counts));
    expect(t.app.operators.poll('mesh.extrude', undefined, {})).toBe(true);
    await t.app.runUntyped('mesh.extrude', {});
    expect(commit.mock.calls[0]?.[2]).toEqual([b]);
  });
});

describe.skipIf(!READY.b1)('[READY.b1] kernel ops through the runtime', () => {
  it('extrudes a cube face (12/20/10) and undoes through the journal to the identical manifest', async () => {
    const t = await meshTestApp({ builtins: false });
    const id = createMesh(t, 'msh_Cube');
    t.app.meshes.open(id);
    const before = t.app.store.get('meshes', id)?.data;
    t.app.operators.register(meshOperator(MESH_OP_DESCRIPTORS['mesh.extrude'] as never));
    t.meshes.select(id, selectionOf('face', [0], primitive('cube', {}).counts));
    const result = await t.app.runUntyped('mesh.extrude', { meshes: [id], kind: 'face' });
    expect(result.status).toBe('finished');
    const c = t.app.meshes.get(id)?.data()?.counts;
    expect(`${c?.points}/${c?.edges}/${c?.faces}`).toBe('12/20/10');
    const seen: string[] = [];
    t.app.meshes.subscribe((_, e) => seen.push(e.type));
    t.app.history.undo();
    expect(t.app.store.get('meshes', id)?.data).toEqual(before);
    expect(t.app.meshes.get(id)?.data()?.counts).toEqual(primitive('cube', {}).counts);
    expect(seen).not.toContain('rebuilt');
    t.app.history.redo();
    expect(t.app.meshes.get(id)?.data()?.counts.faces).toBe(10);
  });
});
