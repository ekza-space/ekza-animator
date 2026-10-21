// B12a (M6A-SPEC §6.2, §5.13–§5.15): the editor operators of the transform package — symmetry per mesh, soft select
// and the selection settings, snapping toggles, the Component orientation, pivots (set, center, bottom centre, reset,
// bake), Reset/Freeze Transformations and object transforms — on the real kernel and runtime (B1, B2, B7) with B10's
// selection service. `mesh.applyTransform` is B4's kernel op: until B4 merges, the module mock below substitutes a
// positions-only implementation so Freeze and Bake Pivot run end to end (READY.b4 then uses the real op).
import { type Mat4, mat4Compose, type ParamValues } from '@ekza-studio/anim-core';
import type { GroupId, MeshId } from '@ekza-studio/doc';
import { makeTestGroup } from '@ekza-studio/doc/testing';
import type * as Kernel from '@ekza-studio/mesh-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type EditorApp,
  FREEZE_SKINNED,
  historyLabels,
  NOTHING_TO_FREEZE,
  NOTHING_TO_TRANSFORM,
  placementChangeLabel,
  SELECT_A_MESH_FIRST,
  setTweakHandle,
  symmetryOf,
  transformSpace,
} from '../../../src';
import { addMesh, modelApp, pointOf, selectObjects } from '../select/support';

vi.mock('@ekza-studio/mesh-core', async (importOriginal) => {
  const actual = await importOriginal<typeof Kernel>();
  const real = actual.MESH_OPS['mesh.applyTransform'] as Kernel.MeshOp;
  // B4 landed when its op runs on a cube without the stub's refusal.
  const cube = actual.editMeshFrom(actual.primitive('cube', {}));
  cube.begin('probe');
  const probe = real.run(
    cube,
    null,
    {},
    {
      symmetry: null,
      hidden: null,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      faceted: true,
      soft: null,
      curves: { compile: () => ({}) as never, evaluate: () => 0 },
      epsilon: 1e-9,
    },
  );
  cube.abort();
  const landed = !(actual.isRefusal(probe) && probe.code === 'not-implemented');
  if (landed) return { ...actual, __b4: true };
  const stand: Kernel.MeshOp = {
    ...real,
    poll: () => true,
    run(m, sel, args: ParamValues) {
      const matrix = args['matrix'] as number[];
      for (let v = 0; v < m.counts.points; v++) {
        const x = m.position[3 * v] as number;
        const y = m.position[3 * v + 1] as number;
        const z = m.position[3 * v + 2] as number;
        m.setPosition(
          v,
          (matrix[0] as number) * x + (matrix[4] as number) * y + (matrix[8] as number) * z + (matrix[12] as number),
          (matrix[1] as number) * x + (matrix[5] as number) * y + (matrix[9] as number) * z + (matrix[13] as number),
          (matrix[2] as number) * x + (matrix[6] as number) * y + (matrix[10] as number) * z + (matrix[14] as number),
        );
      }
      return {
        selection: sel ?? actual.selectionOf('face', [], m.counts),
        warnings: [],
        resolvedArgs: { matrix },
      };
    },
  };
  return {
    ...actual,
    MESH_OPS: Object.freeze({ ...actual.MESH_OPS, 'mesh.applyTransform': stand }),
    __b4: false,
  };
});

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

async function ok(app: EditorApp, op: string, args?: unknown): Promise<void> {
  const result = await app.runUntyped(op, args);
  expect([op, result.status, result.status === 'cancelled' ? result.reason : '']).toEqual([op, 'finished', '']);
}

/** The poll reason a run was cancelled with ("finished"/"failed: …" otherwise). */
async function reasonOf(app: EditorApp, op: string, args: unknown): Promise<string> {
  const result = await app.runUntyped(op, args);
  if (result.status === 'cancelled') return result.reason;
  return result.status === 'failed' ? `failed: ${result.error.message}` : 'finished';
}

const model = (app: EditorApp) => app.session.getState().model;
const labels = (app: EditorApp): readonly string[] => historyLabels(app.history).undo;

/** World positions of a mesh's points (placement applied). */
function worldPoints(app: EditorApp, id: MeshId): number[][] {
  const record = app.store.get('meshes', id);
  const data = app.meshes.get(id)?.data();
  if (record === undefined || data === null || data === undefined) throw new Error(`no data ${id}`);
  const m: Mat4 = mat4Compose(record.placement);
  const out: number[][] = [];
  for (let v = 0; v < data.counts.points; v++) {
    const [x, y, z] = pointOf(data, v);
    out.push([
      (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
      (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
      (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
    ]);
  }
  return out;
}

function placeMesh(app: EditorApp, id: MeshId, placement: Parameters<typeof mat4Compose>[0]): void {
  app.store.transact({ label: 'Place' }, (tx) => tx.patch('meshes', id, { placement }));
}

describe('model.symmetry.set (§5.14)', () => {
  it('remembers a mode per mesh for the selected meshes, then the hilite; the runtime builds the map', async () => {
    const app = await modelApp();
    const a = addMesh(app, 'msh_A', 'cube');
    const b = addMesh(app, 'msh_B', 'cube');
    expect(await reasonOf(app, 'model.symmetry.set', { mode: 'object-x' })).toEqual(SELECT_A_MESH_FIRST);
    expect(await reasonOf(app, 'model.symmetry.set', {})).toEqual(
      'expects { meshes?, mode?, tolerance?, preserveSeam? } with at least one setting',
    );
    expect(await reasonOf(app, 'model.symmetry.set', { mode: 'diagonal' })).toEqual(
      expect.stringContaining('mode is one of') as never,
    );
    selectObjects(app, [a]);
    const steps = labels(app).length;
    await ok(app, 'model.symmetry.set', { mode: 'object-x' });
    expect(symmetryOf(app, a)).toEqual({ mode: 'object-x', tolerance: 0.001, preserveSeam: true });
    expect(symmetryOf(app, b).mode).toBe('off');
    expect(labels(app)).toHaveLength(steps); // U state: no history step
    const map = app.meshes.get(a)?.symmetry();
    expect(map).not.toBeNull();
    expect(map?.unmatched).toBe(0);
    const partners = [...(map?.vertex ?? [])];
    expect(partners.every((p, v) => p < 0 || partners[p] === v)).toBe(true); // P9
    // Component mode: the hilite is the default target; an explicit list wins.
    await ok(app, 'select.mode', { mode: 'vertex' });
    await ok(app, 'model.symmetry.set', { tolerance: 0.01, preserveSeam: false });
    expect(symmetryOf(app, a)).toEqual({ mode: 'object-x', tolerance: 0.01, preserveSeam: false });
    await ok(app, 'model.symmetry.set', { meshes: [b], mode: 'world-z' });
    expect(symmetryOf(app, b).mode).toBe('world-z');
    expect(await reasonOf(app, 'model.symmetry.set', { meshes: ['msh_Nope'], mode: 'off' })).toEqual(
      'Unknown mesh msh_Nope',
    );
  });
});

describe('soft select and the selection settings (§5.15, §5.6)', () => {
  it('sets, toggles and validates soft selection; styles, camera-based, back faces and constraints', async () => {
    const app = await modelApp();
    await ok(app, 'model.softSelect.toggle');
    expect(model(app).softSelect.on).toBe(true);
    await ok(app, 'model.softSelect.set', { radius: 1.8, falloff: 'surface', curve: 'linear' });
    expect(model(app).softSelect).toEqual({ on: true, radius: 1.8, falloff: 'surface', curve: 'linear' });
    expect(await reasonOf(app, 'model.softSelect.set', { radius: 0 })).toEqual('radius is a distance above 0 (metres)');
    expect(await reasonOf(app, 'model.softSelect.set', { curve: 'bouncy' })).toEqual(
      expect.stringContaining('curve is one of') as never,
    );
    expect(await reasonOf(app, 'model.softSelect.set', {})).toEqual(
      'expects { on?, radius?, falloff?, curve? } with at least one setting',
    );
    await ok(app, 'model.selectionStyle.set', { style: 'toggle' });
    expect(model(app).selectionStyle).toBe('tweak');
    await ok(app, 'model.selectionStyle.set', { style: 'toggle' });
    expect(model(app).selectionStyle).toBe('marquee');
    expect(await reasonOf(app, 'model.selectionStyle.set', { style: 'drag' })).toEqual('Drag selection arrives later');
    await ok(app, 'model.cameraBased.set', { value: 'off' });
    expect(model(app).cameraBased).toBe('off');
    await ok(app, 'model.backfaces.toggle');
    expect(model(app).backfaces).toBe(true);
    await ok(app, 'model.constraint.set', { constraint: 'off' });
    expect(await reasonOf(app, 'model.constraint.set', { constraint: 'loop' })).toEqual(
      'Selection constraints arrive later',
    );
    expect(labels(app)).toHaveLength(0);
  });

  it('keeps the Model-only toggles out of Animate', async () => {
    const app = await modelApp();
    await ok(app, 'workspace.set', { workspace: 'animate' });
    for (const op of ['model.softSelect.toggle', 'model.backfaces.toggle', 'model.pivot.editToggle']) {
      expect(await reasonOf(app, op, undefined)).toEqual('Modeling settings are in the Model workspace');
    }
  });
});

describe('snapping, orientation and the last-picked handle (§5.15)', () => {
  it('toggles the sticky snaps; Component is a Move/Rotate orientation next to the preferences', async () => {
    const app = await modelApp();
    await ok(app, 'model.snap.toggle', { kind: 'grid' });
    await ok(app, 'model.snap.toggle', { kind: 'vertex' });
    await ok(app, 'model.snap.toggle', { kind: 'grid' });
    expect(model(app).snap).toEqual({ grid: false, vertex: true, increment: false });
    expect(await reasonOf(app, 'model.snap.toggle', { kind: 'edge' })).toEqual(
      'expects { kind: grid | vertex | increment }',
    );
    expect(transformSpace(app, 'move')).toBe('world');
    expect(transformSpace(app, 'rotate')).toBe('object');
    await ok(app, 'view.setManipSpace', { tool: 'move', space: 'component' });
    expect(transformSpace(app, 'move')).toBe('component');
    expect(transformSpace(app, 'scale')).toBe('component');
    expect(app.prefs.getState().moveSpace).toBe('world');
    await ok(app, 'view.setManipSpace', { tool: 'move', space: 'object' });
    expect(transformSpace(app, 'move')).toBe('object');
    await ok(app, 'view.setManipSpace', { tool: 'rotate', space: 'gimbal' });
    expect(transformSpace(app, 'rotate')).toBe('object');
    setTweakHandle(app, 'tx');
    expect(model(app).tweakHandle).toBe('tx');
    setTweakHandle(app, null);
    expect(model(app).tweakHandle).toBeNull();
  });
});

describe('pivots (§5.15) and object transforms (§5.13)', () => {
  it('sets a pivot (undoable) and centres, bottom-centres and resets it from the bounds', async () => {
    const app = await modelApp();
    const cube = addMesh(app, 'msh_Cube', 'cube', { width: 2, height: 4, depth: 1 });
    expect(await reasonOf(app, 'mesh.pivot.center', undefined)).toEqual(NOTHING_TO_TRANSFORM);
    await ok(app, 'mesh.pivot.set', { id: cube, pivot: [1, 2, 3] });
    expect(app.store.get('meshes', cube)?.pivot).toEqual([1, 2, 3]);
    expect(labels(app).at(-1)).toBe('Set Pivot');
    await ok(app, 'edit.undo');
    expect(app.store.get('meshes', cube)?.pivot).toEqual([0, 0, 0]);
    selectObjects(app, [cube]);
    await ok(app, 'mesh.pivot.bottomCenter');
    expect(app.store.get('meshes', cube)?.pivot).toEqual([0, -2, 0]);
    await ok(app, 'mesh.pivot.center');
    expect(app.store.get('meshes', cube)?.pivot).toEqual([0, 0, 0]);
    await ok(app, 'mesh.pivot.set', { id: cube, pivot: [0.5, 0.5, 0.5] });
    await ok(app, 'mesh.pivot.reset');
    expect(app.store.get('meshes', cube)?.pivot).toEqual([0, 0, 0]);
  });

  it('centres a group pivot on its descendant meshes, in the group space', async () => {
    const app = await modelApp();
    app.store.transact({ label: 'Group' }, (tx) =>
      tx.put('groups', makeTestGroup('grp_G', { placement: { t: [10, 0, 0], q: [0, 0, 0, 1], s: [2, 2, 2] } })),
    );
    const cube = addMesh(app, 'msh_Cube', 'cube', {}, { parent: 'grp_G' as GroupId });
    placeMesh(app, cube, { t: [3, 1, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    await ok(app, 'mesh.pivot.center', { ids: ['grp_G'] });
    expect(app.store.get('groups', 'grp_G' as GroupId)?.pivot).toEqual([3, 1, 0]);
  });

  it('resets transformations as one undoable record patch', async () => {
    const app = await modelApp();
    const cube = addMesh(app, 'msh_Cube', 'cube');
    placeMesh(app, cube, { t: [1, 2, 3], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], s: [2, 2, 2] });
    const before = app.meshes.get(cube)?.ref?.manifest;
    selectObjects(app, [cube]);
    await ok(app, 'mesh.resetTransforms');
    expect(app.store.get('meshes', cube)?.placement).toEqual({ t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    expect(app.meshes.get(cube)?.ref?.manifest).toBe(before); // positions untouched
    await ok(app, 'edit.undo');
    expect(app.store.get('meshes', cube)?.placement.t).toEqual([1, 2, 3]);
  });

  it('commits object transforms with the dominant change as the label', async () => {
    const app = await modelApp();
    const a = addMesh(app, 'msh_A', 'cube');
    const b = addMesh(app, 'msh_B', 'cube');
    const id = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    expect(await reasonOf(app, 'scene.object.transform', { ids: [a], placements: [] })).toEqual(
      'expects { ids, placements } (one placement per id)',
    );
    await ok(app, 'scene.object.transform', {
      ids: [a, b],
      placements: [
        { ...id, t: [1, 0, 0] },
        { ...id, t: [0, 0, 2] },
      ],
    });
    expect(app.store.get('meshes', b)?.placement.t).toEqual([0, 0, 2]);
    await ok(app, 'scene.object.transform', { ids: [a], placements: [{ ...id, t: [1, 0, 0], q: [0, 0, 2, 0] }] });
    expect(app.store.get('meshes', a)?.placement.q).toEqual([0, 0, 1, 0]); // normalized
    await ok(app, 'scene.object.transform', {
      ids: [a],
      placements: [{ ...id, t: [1, 0, 0], q: [0, 0, 1, 0], s: [2, 1, 1] }],
    });
    expect(labels(app).slice(-3)).toEqual(['Move', 'Rotate', 'Scale']);
    expect(placementChangeLabel([id as never], [{ ...id, t: [1, 0, 0] } as never])).toBe('Move');
    await ok(app, 'edit.undo');
    await ok(app, 'edit.undo');
    expect(app.store.get('meshes', a)?.placement).toEqual({ ...id, t: [1, 0, 0] });
  });

  it('labels component transforms by their dominant part (§6.1)', async () => {
    const app = await modelApp();
    const cube = addMesh(app, 'msh_Cube', 'cube');
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'vertex' });
    await ok(app, 'select.components', { mesh: cube, kind: 'vertex', indices: [0, 1], mode: 'replace' });
    await ok(app, 'mesh.transformComponents', { translateY: 0.5 });
    await ok(app, 'mesh.transformComponents', { rotateY: 0.5 });
    await ok(app, 'mesh.transformComponents', { scaleX: 2 });
    expect(labels(app).slice(-3)).toEqual(['Move', 'Rotate', 'Scale']);
  });
});

describe('Freeze Transformations and Bake Pivot (§5.13; B4 `mesh.applyTransform`)', () => {
  it('freezes the placement into the mesh: the world stays, the pivot follows, one undoable step', async () => {
    const app = await modelApp();
    const cube = addMesh(app, 'msh_Cube', 'cube');
    const placement = { t: [1, 2, 3], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], s: [2, 1, 0.5] } as const;
    placeMesh(app, cube, placement);
    app.store.transact({ label: 'Pivot' }, (tx) => tx.patch('meshes', cube, { pivot: [0.5, 0, 0] }));
    const world = worldPoints(app, cube);
    const before = app.meshes.get(cube)?.ref?.manifest;
    selectObjects(app, [cube]);
    expect(await reasonOf(app, 'mesh.freezeTransforms', { translate: false, rotate: false, scale: false })).toEqual(
      NOTHING_TO_FREEZE,
    );
    await ok(app, 'mesh.freezeTransforms', { translate: true, rotate: true, scale: true });
    const record = app.store.get('meshes', cube);
    expect(record?.placement).toEqual({ t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    worldPoints(app, cube).forEach((p, v) => {
      p.forEach((value, k) => expect(near(value, world[v]?.[k] as number)).toBe(true));
    });
    // The pivot keeps its world place: (0.5, 0, 0) local → t + R·(s∘p) = (1, 2, 3) + R_y90·(1, 0, 0) = (1, 2, 2).
    expect(record?.pivot.map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 2, 2]);
    expect(labels(app).at(-1)).toBe('Freeze Transformations');
    await ok(app, 'edit.undo');
    expect(app.store.get('meshes', cube)?.placement).toEqual(placement);
    expect(app.meshes.get(cube)?.ref?.manifest).toBe(before);
  });

  it('freezes only the chosen parts, and a group freezes its meshes', async () => {
    const app = await modelApp();
    app.store.transact({ label: 'Group' }, (tx) => tx.put('groups', makeTestGroup('grp_G')));
    const cube = addMesh(app, 'msh_Cube', 'cube', {}, { parent: 'grp_G' as GroupId });
    placeMesh(app, cube, { t: [1, 0, 0], q: [0, 0, 0, 1], s: [3, 3, 3] });
    const world = worldPoints(app, cube);
    await ok(app, 'mesh.freezeTransforms', { ids: ['grp_G'], translate: false, rotate: true, scale: true });
    expect(app.store.get('meshes', cube)?.placement).toEqual({ t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    worldPoints(app, cube).forEach((p, v) => {
      p.forEach((value, k) => expect(near(value, world[v]?.[k] as number)).toBe(true));
    });
  });

  it('refuses skinned meshes', async () => {
    const app = await modelApp();
    const cube = addMesh(app, 'msh_Cube', 'cube', {}, { skin: { asset: 'ast_X' as never, skin: 0 } });
    expect(await reasonOf(app, 'mesh.freezeTransforms', { ids: [cube] })).toEqual(FREEZE_SKINNED);
  });

  it('bakes the pivot: the geometry moves so the pivot is the origin, the placement compensates', async () => {
    const app = await modelApp();
    const cube = addMesh(app, 'msh_Cube', 'cube');
    placeMesh(app, cube, { t: [1, 0, 0], q: [0, 0, Math.SQRT1_2, Math.SQRT1_2], s: [2, 2, 2] });
    app.store.transact({ label: 'Pivot' }, (tx) => tx.patch('meshes', cube, { pivot: [0, -0.5, 0] }));
    const child = addMesh(app, 'msh_Child', 'cube', {}, { parent: cube });
    const world = worldPoints(app, cube);
    await ok(app, 'mesh.pivot.bake', { ids: [cube] });
    const record = app.store.get('meshes', cube);
    expect(record?.pivot).toEqual([0, 0, 0]);
    worldPoints(app, cube).forEach((p, v) => {
      p.forEach((value, k) => expect(near(value, world[v]?.[k] as number)).toBe(true));
    });
    // The child keeps its world place: its placement moved by −pivot in the parent's space.
    expect(app.store.get('meshes', child)?.placement.t).toEqual([0, 0.5, 0]);
    expect(labels(app).at(-1)).toBe('Bake Pivot');
  });
});
