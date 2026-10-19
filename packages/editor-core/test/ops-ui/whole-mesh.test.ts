// M6A-SPEC §6.1 Modes column (B11): the twelve ops whose Modes list `object` next to component kinds (Triangulate,
// Quadrangulate, Conform, Reverse, Harden, Soften, Set Normal Angle, Average Vertices, Symmetrize, the three UV
// projections) poll and run in object mode on the selected mesh objects with kind null and a null selection (the whole
// mesh); in a component mode they read the component selection as before. The LastRun records kind null, and Adjust
// Last of a whole-mesh run stays on the whole mesh after a switch to a component mode.
//
// The kernel module is mocked so three of the ops are spies on the B0a reference kernel (the stubs refuse every run
// until B4/B5 land): each records what it read and moves the vertices it acts on, so every run records a step.
import type { ParamValues } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import * as kernel from '@ekza-animator/mesh-core';
import type { ComponentSelection, EditMesh, MeshOp, OpResult } from '@ekza-animator/mesh-core';
import { describe, expect, it, vi } from 'vitest';
import { type EditorApp, WHOLE_MESH_OPS } from '../../src';
import { createMesh, type MeshTestApp, meshTestApp, verticesOf } from '../mesh/support';
import { enterModel } from './model';

interface SpyOp extends MeshOp {
  /** What each run read: null for the whole mesh, else `<kind>:<indices>`. */
  readonly reads: (string | null)[];
}

const SPIED = vi.hoisted(() => ['mesh.triangulate', 'mesh.conform', 'mesh.quadrangulate'] as const);

vi.mock('@ekza-animator/mesh-core', async (importOriginal) => {
  const actual = await importOriginal<typeof kernel>();
  const spy = (id: string): SpyOp => {
    const reads: (string | null)[] = [];
    const base = actual.MESH_OPS[id] as MeshOp;
    return {
      ...base,
      reads,
      poll: () => true,
      run(m: EditMesh, sel: ComponentSelection | null, args: ParamValues): OpResult {
        const items =
          sel === null
            ? null
            : sel.kind === 'face'
              ? sel.faces.toArray()
              : sel.kind === 'edge'
                ? sel.edges.toArray()
                : sel.verts.toArray();
        reads.push(sel === null ? null : `${sel.kind}:${[...(items ?? [])].join(',')}`);
        const dy = typeof args['angle'] === 'number' ? args['angle'] : 0.01;
        for (const v of verticesOf(m, sel)) {
          m.setPosition(
            v,
            m.position[3 * v] as number,
            (m.position[3 * v + 1] as number) + dy,
            m.position[3 * v + 2] as number,
          );
        }
        return { selection: sel ?? actual.selectionOf('face', [], m.counts), warnings: [], resolvedArgs: args };
      },
    };
  };
  const spies = Object.fromEntries(SPIED.map((id) => [id, spy(id)]));
  return { ...actual, MESH_OPS: Object.freeze({ ...actual.MESH_OPS, ...spies }), __spies: spies };
});

const spyOf = (id: (typeof SPIED)[number]): SpyOp =>
  (kernel as unknown as { __spies: Record<string, SpyOp> }).__spies[id] as SpyOp;

/**
 * A Model app in object mode with one cube mesh selected as an object and hilited (what entering a component mode
 * shows), its face memory holding face 2.
 */
async function setup(): Promise<MeshTestApp & { readonly id: MeshId }> {
  const t = await meshTestApp();
  await enterModel(t.app);
  const id = createMesh(t, 'msh_Cube');
  t.app.history.clear();
  const state = t.app.session.getState();
  t.app.session.setState({
    selection: { ...state.selection, objects: [id] },
    model: { ...state.model, componentMode: 'object', hilite: [id] },
  });
  t.meshes.select(id, kernel.selectionOf('face', [2], kernel.primitive('cube', {}).counts));
  for (const op of SPIED) spyOf(op).reads.length = 0;
  return { ...t, id };
}

/** `3`: face mode, same hilited meshes (the card stays, §5.7). */
function faceMode(t: MeshTestApp): void {
  const model = t.app.session.getState().model;
  t.app.session.setState({ model: { ...model, componentMode: 'face' } });
}

/** Selects `faces` of `id` (face memory). */
function selectFaces(t: MeshTestApp, id: MeshId, faces: readonly number[]): void {
  t.meshes.select(id, kernel.selectionOf('face', faces, kernel.primitive('cube', {}).counts));
}

const reason = (app: EditorApp, id: string, args: unknown = {}): string | null => {
  const result = app.operators.poll(id, undefined, args);
  return result === true ? null : result.reason;
};

const undoCount = (app: EditorApp): number =>
  (app.history as unknown as { labels(): { undo: readonly string[] } }).labels().undo.length;

describe('whole-mesh runs of component ops (§6.1 Modes "…, object")', () => {
  it('the table is the Modes column: twelve component ops that also run on whole meshes', () => {
    expect([...WHOLE_MESH_OPS].sort()).toEqual([
      'mesh.averageVertices',
      'mesh.conform',
      'mesh.harden',
      'mesh.quadrangulate',
      'mesh.reverse',
      'mesh.setNormalAngle',
      'mesh.soften',
      'mesh.symmetrize',
      'mesh.triangulate',
      'mesh.uv.box',
      'mesh.uv.cylindrical',
      'mesh.uv.planar',
    ]);
  });

  it('every one of them polls in object mode on a selected mesh; without one: "Select a mesh first"', async () => {
    const t = await setup();
    for (const id of WHOLE_MESH_OPS) expect([id, reason(t.app, id)]).toEqual([id, null]);
    // An op without `object` in its Modes still asks for a component mode.
    expect(reason(t.app, 'mesh.inset')).toBe('Inset: enter a component mode first');
    const state = t.app.session.getState();
    t.app.session.setState({ selection: { ...state.selection, objects: [] } });
    for (const id of WHOLE_MESH_OPS) expect([id, reason(t.app, id)]).toEqual([id, 'Select a mesh first']);
    // Explicit meshes need no object selection.
    expect(reason(t.app, 'mesh.conform', { meshes: [t.id] })).toBeNull();
  });

  it('object mode: Triangulate and Conform run on the whole mesh (kind null, null selection) and record kind null', async () => {
    const t = await setup();
    const result = await t.app.run('mesh.triangulate', {}, { source: 'menu' });
    expect(result.status).toBe('finished');
    expect(spyOf('mesh.triangulate').reads).toEqual([null]);
    expect(t.app.session.getState().lastRun).toMatchObject({ id: 'mesh.triangulate', kind: null, targets: [t.id] });
    expect((await t.app.run('mesh.conform', {}, { source: 'menu' })).status).toBe('finished');
    expect(spyOf('mesh.conform').reads).toEqual([null]);
    expect(t.app.session.getState().lastRun).toMatchObject({ id: 'mesh.conform', kind: null, targets: [t.id] });
  });

  it('a component mode still reads the component selection; an explicit `kind: null` means the whole mesh', async () => {
    const t = await setup();
    faceMode(t);
    expect((await t.app.run('mesh.triangulate', {})).status).toBe('finished');
    expect(spyOf('mesh.triangulate').reads).toEqual(['face:2']);
    expect(t.app.session.getState().lastRun).toMatchObject({ kind: 'face' });
    expect((await t.app.runUntyped('mesh.triangulate', { kind: null, meshes: [t.id] })).status).toBe('finished');
    expect(spyOf('mesh.triangulate').reads).toEqual(['face:2', null]);
    expect(t.app.session.getState().lastRun).toMatchObject({ kind: null, targets: [t.id] });
  });

  it('Adjust Last of a whole-mesh run stays on the whole mesh after `3` (same history length, "(adjusted)")', async () => {
    const t = await setup();
    expect((await t.app.run('mesh.quadrangulate', { angle: 0.2 }, { source: 'menu' })).status).toBe('finished');
    const steps = undoCount(t.app);
    faceMode(t);
    expect(t.app.session.getState().lastRun?.closed).toBeNull();
    const adjusted = await t.app.run('edit.adjustLast', { args: { angle: 0.4 } });
    expect(adjusted.status).toBe('finished');
    expect(spyOf('mesh.quadrangulate').reads).toEqual([null, null]);
    expect(t.app.session.getState().lastRun).toMatchObject({ kind: null, targets: [t.id], args: { angle: 0.4 } });
    expect(undoCount(t.app)).toBe(steps);
    expect(t.app.history.peekUndo()?.label).toBe('Quadrangulate (adjusted)');
  });

  it('Repeat Last (G) of a whole-mesh run follows the current mode: the face selection in face mode', async () => {
    const t = await setup();
    expect((await t.app.run('mesh.triangulate', {}, { source: 'menu' })).status).toBe('finished');
    faceMode(t);
    selectFaces(t, t.id, [4]);
    expect((await t.app.run('edit.repeatLast', undefined, { source: 'keyboard' })).status).toBe('finished');
    expect(spyOf('mesh.triangulate').reads).toEqual([null, 'face:4']);
  });
});
