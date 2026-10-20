// B10 (M6A-SPEC §5.6, §6.2): component modes and hilite, selection gestures as history steps (one per gesture,
// continuation coalescing, undo/redo restoring the selection, nothing in Animate), all/invert/none, object selection,
// hide/show/isolate, and the Model session repair. Walker operators (B2) and Mesh Check matching (B5) are gated.
import type { GroupId, MeshId, PaletteId } from '@ekza-animator/doc';
import { makeTestGroup, makeTestMesh, makeTestPalette, makeTestSwatch } from '@ekza-animator/doc/testing';
import type { MeshData } from '@ekza-animator/mesh-core';
import { MESH_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { buildMeshData } from '@ekza-animator/mesh-core/testing';
import { describe, expect, it } from 'vitest';
import {
  componentInternals,
  type EditorApp,
  historyLabels,
  MAKE_EDITABLE_HINT,
  meshCheckOptions,
  meshOperator,
  objectsDrawnIn,
  provideModelPointer,
  SELECT_A_MESH_FIRST,
} from '../../../src';
import { READY } from './ready';
import {
  addMesh,
  edgesWhere,
  faceVertsOf,
  facesWhere,
  mirrorMapX,
  modelApp,
  planeAxes,
  pointOf,
  probe,
  selected,
  selectObjects,
  withSymmetry,
} from './support';

/** Equal within float noise. */
const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-5;

/** Coordinate `axis` of an edge's two endpoints. */
const ends = (data: MeshData, e: number, axis: number): number[] => [
  pointOf(data, data.edgeVerts[2 * e] as number)[axis] as number,
  pointOf(data, data.edgeVerts[2 * e + 1] as number)[axis] as number,
];

async function scene(): Promise<{ readonly app: EditorApp; readonly cube: MeshId; readonly plane: MeshId }> {
  const app = await modelApp();
  const cube = addMesh(app, 'msh_Cube', 'cube');
  const plane = addMesh(app, 'msh_Plane', 'plane', { subdivisionsWidth: 2, subdivisionsHeight: 1 });
  return { app, cube, plane };
}

const undoLabels = (app: EditorApp): readonly string[] => historyLabels(app.history).undo;
const mode = (app: EditorApp): string => app.session.getState().model.componentMode;

async function ok(app: EditorApp, op: string, args?: unknown, ctx?: Parameters<EditorApp['runUntyped']>[2]) {
  const result = await app.runUntyped(op, args, ctx);
  expect([op, result.status, result.status === 'cancelled' ? result.reason : '']).toEqual([op, 'finished', '']);
  return result;
}

describe('select.mode (§5.6 modes and hilite)', () => {
  it('enters a component mode on the selected meshes; refuses without a mesh; never records a step', async () => {
    const { app, cube } = await scene();
    const steps = undoLabels(app).length;
    expect(await app.runUntyped('select.mode', { mode: 'face' })).toEqual({
      status: 'cancelled',
      reason: SELECT_A_MESH_FIRST,
    });
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'face' });
    expect([mode(app), app.session.getState().model.hilite]).toEqual(['face', [cube]]);
    expect(app.meshes.get(cube)?.isOpen).toBe(true);
    await ok(app, 'select.mode', { mode: 'edge' });
    expect(mode(app)).toBe('edge');
    expect(undoLabels(app).length).toBe(steps);
    app.dispose();
  });

  it('hilites the mesh under the pointer without a selection, and the RMB menu adds its press mesh', async () => {
    const { app, cube, plane } = await scene();
    probe(app, { mesh: plane });
    await ok(app, 'select.mode', { mode: 'vertex' }, { source: 'keyboard', paneId: 'pane-persp' });
    expect(app.session.getState().model.hilite).toEqual([plane]);
    probe(app, { press: cube });
    await ok(app, 'select.mode', { mode: 'face' }, { source: 'marking-menu', paneId: 'pane-persp' });
    expect([mode(app), app.session.getState().model.hilite]).toEqual(['face', [plane, cube]]);
    app.dispose();
  });

  it('the active digit returns to object mode; F9/F10, menus and scripts are idempotent; F8 toggles', async () => {
    const { app, cube } = await scene();
    selectObjects(app, [cube]);
    probe(app, { key: 'F9' });
    await ok(app, 'select.mode', { mode: 'vertex' }, { source: 'keyboard' });
    await ok(app, 'select.mode', { mode: 'vertex' }, { source: 'keyboard' });
    expect(mode(app)).toBe('vertex');
    await ok(app, 'select.mode', { mode: 'vertex' }, { source: 'menu' });
    expect(mode(app)).toBe('vertex');
    probe(app, { key: 'Digit1' });
    await ok(app, 'select.mode', { mode: 'vertex' }, { source: 'keyboard' });
    expect(mode(app)).toBe('object');
    await ok(app, 'select.mode', { mode: 'toggle' });
    expect(mode(app)).toBe('vertex');
    await ok(app, 'select.mode', { mode: 'toggle' });
    expect(mode(app)).toBe('object');
    // Headless keyboard runs (no probe key) count as digits.
    probe(app, {});
    await ok(app, 'select.mode', { mode: 'face' }, { source: 'keyboard' });
    await ok(app, 'select.mode', { mode: 'face' }, { source: 'keyboard' });
    expect(mode(app)).toBe('object');
    app.dispose();
  });

  it('returning to object mode selects the hilited meshes (one "Select" step only when that changes it)', async () => {
    const { app, cube, plane } = await scene();
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'model.hilite', { meshes: [plane], mode: 'add' });
    const steps = undoLabels(app).length;
    await ok(app, 'select.mode', { mode: 'object' });
    expect(app.session.getState().selection.objects).toEqual([cube, plane]);
    expect(app.session.getState().model.hilite).toEqual([cube, plane]); // kept, not drawn
    expect(undoLabels(app).slice(steps)).toEqual(['Select']);
    expect(app.meshes.get(cube)?.isOpen).toBe(false);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.mode', { mode: 'object' });
    expect(undoLabels(app).slice(steps)).toEqual(['Select']); // unchanged object selection: nothing recorded
    app.history.undo();
    expect(app.session.getState().selection.objects).toEqual([cube]); // before the first switch
    expect(mode(app)).toBe('object'); // undo never changes the mode
    app.dispose();
  });

  it('over a character mesh without a record: "Make editable first" with the Outliner action (§5.6)', async () => {
    const { app, cube } = await scene();
    provideModelPointer(app, { meshAt: () => null, assetMeshAt: () => true, lastKey: () => null });
    expect(await app.runUntyped('select.mode', { mode: 'face' }, { source: 'keyboard' })).toEqual({
      status: 'cancelled',
      reason: MAKE_EDITABLE_HINT,
    });
    // The RMB mode menu opened over it refuses even with a mesh selected (the menu was opened for that mesh).
    selectObjects(app, [cube]);
    expect(await app.runUntyped('select.mode', { mode: 'face' }, { source: 'marking-menu' })).toEqual({
      status: 'cancelled',
      reason: MAKE_EDITABLE_HINT,
    });
    // A key with a mesh selected enters on it; then the menu over the asset mesh refuses in component mode too.
    await ok(app, 'select.mode', { mode: 'face' }, { source: 'keyboard' });
    expect(await app.runUntyped('select.mode', { mode: 'edge' }, { source: 'marking-menu' })).toEqual({
      status: 'cancelled',
      reason: MAKE_EDITABLE_HINT,
    });
    expect(MAKE_EDITABLE_HINT).toMatch(/^Make editable first: .*Outliner/);
    app.dispose();
  });

  it('is Model only', async () => {
    const { app, cube } = await scene();
    selectObjects(app, [cube]);
    await ok(app, 'workspace.set', { workspace: 'animate' });
    const result = await app.runUntyped('select.mode', { mode: 'face' });
    expect(result).toEqual({ status: 'cancelled', reason: 'Component modes are in the Model workspace' });
    app.dispose();
  });
});

describe('model.hilite', () => {
  it('adds, replaces and removes; refuses meshes without data ("Make editable first")', async () => {
    const { app, cube, plane } = await scene();
    await ok(app, 'model.hilite', { meshes: [cube], mode: 'replace' });
    await ok(app, 'model.hilite', { meshes: [plane], mode: 'add' });
    expect(app.session.getState().model.hilite).toEqual([cube, plane]);
    await ok(app, 'model.hilite', { meshes: [cube], mode: 'remove' });
    expect(app.session.getState().model.hilite).toEqual([plane]);
    app.store.transact({ label: 'Asset row' }, (tx) =>
      tx.put('meshes', makeTestMesh('msh_Asset', { name: 'Asset row' })),
    );
    expect(await app.runUntyped('model.hilite', { meshes: ['msh_Asset'], mode: 'add' })).toEqual({
      status: 'cancelled',
      reason: 'Make editable first',
    });
    app.dispose();
  });
});

describe('selection steps (§5.6 selection undo)', () => {
  it('one "Select" step per gesture; undo and redo restore it; a replace clears the other hilited meshes', async () => {
    const { app, cube, plane } = await scene();
    selectObjects(app, [cube, plane]);
    await ok(app, 'select.mode', { mode: 'face' });
    const base = undoLabels(app).length;
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [1], mode: 'replace' });
    await ok(app, 'select.components', { mesh: plane, kind: 'face', indices: [0], mode: 'add' });
    expect([selected(app, cube, 'face'), selected(app, plane, 'face')]).toEqual([[1], [0]]);
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [3], mode: 'replace' });
    expect([selected(app, cube, 'face'), selected(app, plane, 'face')]).toEqual([[3], []]);
    expect(undoLabels(app).slice(base)).toEqual(['Select', 'Select', 'Select']);
    app.history.undo();
    expect([selected(app, cube, 'face'), selected(app, plane, 'face')]).toEqual([[1], [0]]);
    app.history.redo();
    expect([selected(app, cube, 'face'), selected(app, plane, 'face')]).toEqual([[3], []]);
    expect(app.session.getState().model.componentMode).toBe('face'); // restoring never changes the mode
    app.dispose();
  });

  it('three quick Shift-clicks are three steps: one undo removes only the third (E2E-MOD-26)', async () => {
    const { app, cube } = await scene();
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'edge' });
    const base = undoLabels(app).length;
    for (const e of [0, 4, 8]) {
      await ok(app, 'select.components', { mesh: cube, kind: 'edge', indices: [e], mode: 'toggle', gesture: 'click' });
    }
    expect(undoLabels(app).slice(base)).toEqual(['Select', 'Select', 'Select']);
    app.history.undo();
    expect(selected(app, cube, 'edge')).toEqual([0, 4]);
    app.dispose();
  });

  it('a click on empty space then one undo restores the selection; an unchanged gesture records nothing', async () => {
    const { app, cube } = await scene();
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'edge' });
    await ok(app, 'select.components', { mesh: cube, kind: 'edge', indices: [0, 1, 2, 3], mode: 'replace' });
    const base = undoLabels(app).length;
    await ok(app, 'select.components', { mesh: cube, kind: 'edge', indices: [], mode: 'replace' });
    await ok(app, 'select.components', { mesh: cube, kind: 'edge', indices: [], mode: 'replace' });
    expect(undoLabels(app).length).toBe(base + 1);
    app.history.undo();
    expect(selected(app, cube, 'edge')).toEqual([0, 1, 2, 3]);
    app.dispose();
  });

  it('a marquee across meshes is one step (continuation runs coalesce); a selection step clears redo', async () => {
    const { app, cube, plane } = await scene();
    selectObjects(app, [cube, plane]);
    await ok(app, 'select.mode', { mode: 'vertex' });
    await ok(app, 'select.components', { mesh: cube, kind: 'vertex', indices: [0], mode: 'replace' });
    app.history.undo();
    expect(app.history.canRedo()).toBe(true);
    const base = undoLabels(app).length;
    await ok(app, 'select.components', {
      mesh: cube,
      kind: 'vertex',
      indices: [1, 2],
      mode: 'replace',
      gesture: 'marquee',
    });
    await ok(
      app,
      'select.components',
      { mesh: plane, kind: 'vertex', indices: [4], mode: 'add', gesture: 'marquee' },
      { repeat: true },
    );
    expect(undoLabels(app).slice(base)).toEqual(['Select']);
    expect(app.history.canRedo()).toBe(false);
    app.history.undo();
    expect([selected(app, cube, 'vertex'), selected(app, plane, 'vertex')]).toEqual([[], []]);
    app.dispose();
  });

  it('a marquee is one run with `also`: one step even when its first mesh part changes nothing (§5.6)', async () => {
    const { app, cube, plane } = await scene();
    selectObjects(app, [cube, plane]);
    await ok(app, 'select.mode', { mode: 'vertex' });
    const base = undoLabels(app).length;
    const marquee = { mesh: cube, kind: 'vertex', indices: [1, 2], mode: 'replace', gesture: 'marquee' };
    await ok(app, 'select.components', marquee);
    // The second marquee covers the same cube vertices (unchanged) and a plane vertex.
    await ok(app, 'select.components', { ...marquee, also: [{ mesh: plane, indices: [4] }] });
    expect([selected(app, cube, 'vertex'), selected(app, plane, 'vertex')]).toEqual([[1, 2], [4]]);
    expect(undoLabels(app).slice(base)).toEqual(['Select', 'Select']);
    app.history.undo();
    expect([selected(app, cube, 'vertex'), selected(app, plane, 'vertex')]).toEqual([[1, 2], []]);
    app.history.undo();
    expect([selected(app, cube, 'vertex'), selected(app, plane, 'vertex')]).toEqual([[], []]);
    // A replace marquee replaces on every hilited mesh; an additive one adds on each mesh it covers.
    app.history.redo();
    app.history.redo();
    await ok(app, 'select.components', { ...marquee, indices: [0], also: [{ mesh: plane, indices: [5] }] });
    expect([selected(app, cube, 'vertex'), selected(app, plane, 'vertex')]).toEqual([[0], [5]]);
    await ok(app, 'select.components', {
      ...marquee,
      indices: [3],
      mode: 'add',
      also: [{ mesh: plane, indices: [1] }],
    });
    expect([selected(app, cube, 'vertex'), selected(app, plane, 'vertex')]).toEqual([
      [0, 3],
      [1, 5],
    ]);
    expect(await app.runUntyped('select.components', { ...marquee, also: [{ mesh: plane }] })).toEqual({
      status: 'cancelled',
      reason: 'also must be a list of { mesh, indices }',
    });
    app.dispose();
  });

  it('a continuation never merges into an earlier gesture’s step when its own first run changed nothing', async () => {
    const { app, cube, plane } = await scene();
    selectObjects(app, [cube, plane]);
    await ok(app, 'select.mode', { mode: 'vertex' });
    const base = undoLabels(app).length;
    const marquee = { kind: 'vertex', mode: 'replace', gesture: 'marquee' };
    await ok(app, 'select.components', { ...marquee, mesh: cube, indices: [1, 2] });
    await ok(app, 'select.components', { ...marquee, mesh: cube, indices: [1, 2] }); // changes nothing
    await ok(app, 'select.components', { ...marquee, mesh: plane, indices: [4], mode: 'add' }, { repeat: true });
    expect(undoLabels(app).slice(base)).toEqual(['Select', 'Select']);
    app.history.undo();
    expect([selected(app, cube, 'vertex'), selected(app, plane, 'vertex')]).toEqual([[1, 2], []]);
    app.dispose();
  });

  it('undoing a click in another mode keeps the face pick order and active face (Bridge, Target Weld)', async () => {
    const { app, cube } = await scene();
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [5], mode: 'replace' });
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [2], mode: 'add' });
    await ok(app, 'select.mode', { mode: 'edge' });
    await ok(app, 'select.components', { mesh: cube, kind: 'edge', indices: [7], mode: 'replace' });
    app.history.undo();
    expect(selected(app, cube, 'edge')).toEqual([]);
    const face = app.components.get(cube, 'face');
    expect([[...(face.order ?? [])], face.active]).toEqual([[5, 2], 2]);
    app.dispose();
  });

  it('records nothing in Animate (shipped selection behaviour)', async () => {
    const { app } = await scene();
    await ok(app, 'workspace.set', { workspace: 'animate' });
    const base = undoLabels(app).length;
    await app.runUntyped('select.controls', { ids: [], mode: 'replace' });
    expect(undoLabels(app).length).toBe(base);
    app.dispose();
  });

  it('a removal on a mirrored partner removes both sides (expanded set, §5.6)', async () => {
    const { app, plane } = await scene();
    const data = app.meshes.get(plane)?.data();
    if (data === null || data === undefined) throw new Error('data');
    withSymmetry(app, plane, mirrorMapX(data));
    selectObjects(app, [plane]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.components', { mesh: plane, kind: 'face', indices: [0], mode: 'replace' });
    expect(app.session.getState().model.components.mirrored.face).toBe(1);
    await ok(app, 'select.components', { mesh: plane, kind: 'face', indices: [1], mode: 'remove' });
    expect(componentInternals(app.components)?.expanded(plane, 'face')?.faces.isEmpty()).toBe(true);
    app.dispose();
  });
});

describe('all, invert, none', () => {
  it('act on the current kind of every hilited mesh, skipping hidden components', async () => {
    const { app, cube, plane } = await scene();
    selectObjects(app, [cube, plane]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.mesh.all');
    expect([selected(app, cube, 'face').length, selected(app, plane, 'face').length]).toEqual([6, 2]);
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [0], mode: 'replace' });
    await ok(app, 'view.hide', { target: 'selected' });
    await ok(app, 'select.mesh.invert');
    expect(selected(app, cube, 'face')).toEqual([1, 2, 3, 4, 5]);
    expect(selected(app, plane, 'face')).toEqual([0, 1]);
    await ok(app, 'select.mesh.none');
    expect([selected(app, cube, 'face'), selected(app, plane, 'face')]).toEqual([[], []]);
    expect(await app.runUntyped('select.mesh.grow')).toMatchObject({ status: 'cancelled' });
    app.dispose();
  });

  it('invert under symmetry complements the expanded selection (the picks and their partners, §5.6)', async () => {
    const app = await modelApp();
    const strip = addMesh(app, 'msh_Strip', 'plane', { subdivisionsWidth: 6, subdivisionsHeight: 1 });
    const data = app.meshes.get(strip)?.data();
    if (data === null || data === undefined) throw new Error('data');
    withSymmetry(app, strip, mirrorMapX(data));
    selectObjects(app, [strip]);
    await ok(app, 'select.mode', { mode: 'face' });
    const internals = componentInternals(app.components);
    const end = facesWhere(data, (c) => Math.max(...c.map(Math.abs)) > 0.4 && (c[0] as number) < 0)[0] as number;
    const partner = internals?.partnerOf(strip, 'face', end) ?? -1;
    expect(partner).toBeGreaterThanOrEqual(0);
    expect(partner).not.toBe(end);
    await ok(app, 'select.components', { mesh: strip, kind: 'face', indices: [end], mode: 'replace' });
    expect([...(internals?.expanded(strip, 'face')?.faces.toArray() ?? [])]).toEqual(
      [end, partner].sort((a, b) => a - b),
    );
    await ok(app, 'select.mesh.invert');
    const rest = [0, 1, 2, 3, 4, 5].filter((f) => f !== end && f !== partner);
    // Neither side of the inverted pair comes back through the expansion; ops act on the four others.
    expect([...(internals?.expanded(strip, 'face')?.faces.toArray() ?? [])]).toEqual(rest);
    expect(selected(app, strip, 'face')).toEqual(rest);
    app.dispose();
  });
});

describe('select.objects', () => {
  it('combines object selections by mode, Mod+A selects every visible mesh, one step each', async () => {
    const { app, cube, plane } = await scene();
    const base = undoLabels(app).length;
    await ok(app, 'select.objects', { ids: [cube], mode: 'replace' });
    await ok(app, 'select.objects', { ids: [plane], mode: 'toggle' });
    expect(app.session.getState().selection.objects).toEqual([cube, plane]);
    await ok(app, 'select.objects', { ids: [cube], mode: 'remove' });
    expect(app.session.getState().selection.objects).toEqual([plane]);
    await ok(app, 'select.objects', { all: 'meshes', mode: 'replace' });
    expect(app.session.getState().selection.objects).toEqual([cube, plane]);
    await ok(app, 'select.objects', { ids: ['msh_Gone'], mode: 'add' });
    expect(app.session.getState().selection.objects).toEqual([cube, plane]);
    expect(undoLabels(app).slice(base)).toEqual(['Select', 'Select', 'Select', 'Select']);
    app.dispose();
  });
});

describe('hide, show, isolate (§5.6)', () => {
  it('component hides convert to faces, record "Hide"/"Show" and undo', async () => {
    const { app, cube } = await scene();
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'face' });
    expect(await app.runUntyped('view.hide', { target: 'selected' })).toEqual({
      status: 'cancelled',
      reason: 'Nothing is selected',
    });
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [1], mode: 'replace' });
    const base = undoLabels(app).length;
    await ok(app, 'view.hide', { target: 'selected' });
    expect([...app.components.hidden(cube).faces.toArray()]).toEqual([1]);
    expect(app.session.getState().model.components.hidden.face).toBe(1);
    expect(selected(app, cube, 'face')).toEqual([]); // hidden components are not read as selected
    await ok(app, 'view.showAll');
    expect(app.components.hidden(cube).faces.isEmpty()).toBe(true);
    expect(undoLabels(app).slice(base)).toEqual(['Hide', 'Show']);
    app.history.undo();
    expect([...app.components.hidden(cube).faces.toArray()]).toEqual([1]);
    app.history.undo();
    expect(app.components.hidden(cube).faces.isEmpty()).toBe(true);
    expect(selected(app, cube, 'face')).toEqual([1]); // the stored pick comes back with the face
    app.dispose();
  });

  it('object hides (selected and unselected) and Show All; pane objects follow hides and isolate sets', async () => {
    const { app, cube, plane } = await scene();
    expect(objectsDrawnIn(app, 'pane-persp')).toEqual([cube, plane]);
    selectObjects(app, [cube]);
    await ok(app, 'view.hide', { target: 'selected' });
    expect([...app.session.getState().model.hiddenObjects]).toEqual([cube]);
    expect(objectsDrawnIn(app, 'pane-persp')).toEqual([plane]);
    await ok(app, 'view.showAll');
    await ok(app, 'view.hide', { target: 'unselected' });
    expect([...app.session.getState().model.hiddenObjects]).toEqual([plane]);
    await ok(app, 'view.showAll');
    // Isolate (Shift+L) in one pane: only the selection there; again toggles it off.
    await ok(app, 'view.isolate', { paneId: 'pane-persp' });
    expect(objectsDrawnIn(app, 'pane-persp')).toEqual([cube]);
    expect(objectsDrawnIn(app, 'pane-front')).toEqual([cube, plane]);
    await ok(app, 'view.isolate', undefined, { paneId: 'pane-persp' });
    expect(objectsDrawnIn(app, 'pane-persp')).toEqual([cube, plane]);
    app.dispose();
  });

  it('isolate in face mode keeps only the selected faces of the hilited meshes in that pane', async () => {
    const { app, cube } = await scene();
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [2, 4], mode: 'replace' });
    await ok(app, 'view.isolate', { paneId: 'pane-top' });
    const internals = componentInternals(app.components);
    expect([...(internals?.faceIsolate('pane-top')?.get(cube)?.toArray() ?? [])]).toEqual([2, 4]);
    expect(app.session.getState().model.isolate['pane-top']).toEqual([cube]);
    await ok(app, 'view.isolate', { paneId: 'pane-top' });
    expect(internals?.faceIsolate('pane-top')).toBeNull();
    app.dispose();
  });
});

describe('Model session repair', () => {
  it('prunes deleted meshes from the hilite, hidden objects and isolate sets; a load resets them', async () => {
    const { app, cube, plane } = await scene();
    selectObjects(app, [cube, plane]);
    await ok(app, 'select.mode', { mode: 'face' });
    const model = app.session.getState().model;
    app.session.setState({
      model: { ...model, hiddenObjects: new Set([cube]), isolate: { 'pane-persp': [cube], 'pane-top': [cube, plane] } },
    });
    app.store.transact({ label: 'Delete' }, (tx) =>
      tx.patch('meshes', cube, { deleted: { at: 1, by: 'local' } as never }),
    );
    const after = app.session.getState().model;
    expect(after.hilite).toEqual([plane]);
    expect(after.hiddenObjects.size).toBe(0);
    expect(after.isolate).toEqual({ 'pane-persp': null, 'pane-top': [plane] });
    app.store.load(app.store.snapshot());
    const loaded = app.session.getState().model;
    expect([loaded.componentMode, loaded.hilite, loaded.isolate]).toEqual(['object', [], {}]);
    app.dispose();
  });
});

describe.skipIf(!READY.b2)('walkers through the operators (B2)', () => {
  it('double-click selects the edge loop; Shift+double-click on an adjacent edge adds the full loop', async () => {
    const app = await modelApp();
    const plane = addMesh(app, 'msh_Grid', 'plane', { subdivisionsWidth: 4, subdivisionsHeight: 4 });
    const data = app.meshes.get(plane)?.data();
    if (data === null || data === undefined) throw new Error('data');
    const [u, w] = planeAxes(data);
    // The lines w = 0 and w = 0.25 of the 4 × 4 grid (side 1): four edges each, along u.
    const line = (at: number) => edgesWhere(data, (a, b) => near(a[w], at) && near(b[w], at));
    const span = (e: number): [number, number] => {
      const values = ends(data, e, u);
      return [Math.min(...values), Math.max(...values)];
    };
    const middle = line(0);
    const upper = line(0.25);
    expect([middle.length, upper.length]).toEqual([4, 4]);
    selectObjects(app, [plane]);
    await ok(app, 'select.mode', { mode: 'edge' });
    const base = undoLabels(app).length;
    // The first click of the double-click, then the double-click on the same edge (the loop table reads the
    // selection from before the first click).
    const start = middle.find((e) => near(span(e)[0], -0.5)) as number;
    await ok(app, 'select.components', {
      mesh: plane,
      kind: 'edge',
      indices: [start],
      mode: 'replace',
      gesture: 'click',
    });
    await ok(app, 'select.mesh.loop', { mesh: plane, kind: 'edge', component: start, gesture: 'double' });
    expect(selected(app, plane, 'edge')).toEqual(middle);
    expect(undoLabels(app).slice(base)).toEqual(['Select', 'Select']);
    app.history.undo();
    expect(selected(app, plane, 'edge')).toEqual([start]);
    // Shift+double-click on the edge next to the reference (the last pick) along its loop: the full loop is added.
    const reference = upper.find((e) => near(span(e)[0], -0.5)) as number;
    const next = upper.find((e) => near(span(e)[0], -0.25)) as number;
    await ok(app, 'select.components', { mesh: plane, kind: 'edge', indices: [reference], mode: 'add' });
    await ok(app, 'select.components', {
      mesh: plane,
      kind: 'edge',
      indices: [next],
      mode: 'toggle',
      gesture: 'click',
    });
    await ok(app, 'select.mesh.loop', { mesh: plane, kind: 'edge', component: next, gesture: 'shift-double' });
    expect(selected(app, plane, 'edge')).toEqual([start, ...upper].sort((a, b) => a - b));
    app.dispose();
  });

  it('grow repeats while the key is held: the auto-repeated runs coalesce into one step', async () => {
    const app = await modelApp();
    // A 10×10 grid: three grows from a centre face stay inside it, so the shrink after them changes something.
    const plane = addMesh(app, 'msh_Grid', 'plane', { subdivisionsWidth: 10, subdivisionsHeight: 10 });
    selectObjects(app, [plane]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.components', { mesh: plane, kind: 'face', indices: [55], mode: 'replace' });
    const base = undoLabels(app).length;
    await ok(app, 'select.mesh.grow', undefined, { source: 'keyboard' });
    await ok(app, 'select.mesh.grow', undefined, { source: 'keyboard', repeat: true });
    await ok(app, 'select.mesh.grow', undefined, { source: 'keyboard', repeat: true });
    expect(undoLabels(app).slice(base)).toEqual(['Select']);
    await ok(app, 'select.mesh.shrink', undefined, { source: 'keyboard' });
    expect(undoLabels(app).slice(base)).toEqual(['Select', 'Select']);
    app.dispose();
  });

  it('convert to edges switches to edge mode; border with nothing selected takes every border loop', async () => {
    const app = await modelApp();
    const plane = addMesh(app, 'msh_Grid', 'plane', { subdivisionsWidth: 2, subdivisionsHeight: 2 });
    selectObjects(app, [plane]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.components', { mesh: plane, kind: 'face', indices: [0], mode: 'replace' });
    await ok(app, 'select.mesh.convert', { to: 'edge', mode: 'touching' });
    expect([mode(app), selected(app, plane, 'edge').length]).toEqual(['edge', 4]);
    await ok(app, 'select.mesh.none');
    await ok(app, 'select.mesh.border');
    expect(selected(app, plane, 'edge').length).toBe(8);
    app.dispose();
  });

  /** A 4 × 2 grid (side 1) in face mode with its last column (u > 0.25) hidden. */
  async function hiddenColumn() {
    const app = await modelApp();
    const plane = addMesh(app, 'msh_Grid', 'plane', { subdivisionsWidth: 4, subdivisionsHeight: 2 });
    const data = app.meshes.get(plane)?.data();
    if (data === null || data === undefined) throw new Error('data');
    const [u, w] = planeAxes(data);
    selectObjects(app, [plane]);
    await ok(app, 'select.mode', { mode: 'face' });
    const column = facesWhere(data, (c) => (c[u] as number) > 0.25);
    expect(column.length).toBe(2);
    await ok(app, 'select.components', { mesh: plane, kind: 'face', indices: column, mode: 'replace' });
    await ok(app, 'view.hide', { target: 'selected' });
    expect([...app.components.hidden(plane).faces.toArray()]).toEqual(column);
    return { app, plane, data, u, w, column };
  }

  it('hidden components stop the loop walker (§5.6): the loop ends at a hidden column', async () => {
    const { app, plane, data, u, w } = await hiddenColumn();
    await ok(app, 'select.mode', { mode: 'edge' });
    const line = edgesWhere(data, (a, b) => near(a[w], 0) && near(b[w], 0));
    expect(line.length).toBe(4);
    const start = line.find((e) => Math.min(...ends(data, e, u)) < -0.4) as number;
    await ok(app, 'select.components', {
      mesh: plane,
      kind: 'edge',
      indices: [start],
      mode: 'replace',
      gesture: 'click',
    });
    await ok(app, 'select.mesh.loop', { mesh: plane, kind: 'edge', component: start, gesture: 'double' });
    // The three visible edges of the middle line; its edge between the two hidden faces is hidden.
    const visible = line.filter((e) => Math.max(...ends(data, e, u)) < 0.3);
    expect(visible.length).toBe(3);
    expect(selected(app, plane, 'edge')).toEqual(visible);
    app.dispose();
  });

  it('grow and convert skip hidden components', async () => {
    const { app, plane, data, u, column } = await hiddenColumn();
    // Grow from a face next to the hidden column: its visible vertex neighbours only.
    const nextTo = facesWhere(data, (c) => (c[u] as number) > 0 && (c[u] as number) < 0.25)[0] as number;
    await ok(app, 'select.components', { mesh: plane, kind: 'face', indices: [nextTo], mode: 'replace' });
    await ok(app, 'select.mesh.grow');
    const touching = new Set(faceVertsOf(data, nextTo));
    const neighbours: number[] = [];
    for (let f = 0; f < data.counts.faces; f++) {
      if (faceVertsOf(data, f).some((v) => touching.has(v)) && !column.includes(f)) neighbours.push(f);
    }
    expect(neighbours.length).toBe(4);
    expect(selected(app, plane, 'face')).toEqual(neighbours);
    // An edge on the border of the hidden column converts to its one visible face.
    await ok(app, 'select.mode', { mode: 'edge' });
    const seam = edgesWhere(data, (a, b) => near(a[u], 0.25) && near(b[u], 0.25));
    const edge = seam[0] as number;
    await ok(app, 'select.components', { mesh: plane, kind: 'edge', indices: [edge], mode: 'replace' });
    await ok(app, 'select.mesh.convert', { to: 'face', mode: 'touching' });
    const a = data.edgeVerts[2 * edge] as number;
    const b = data.edgeVerts[2 * edge + 1] as number;
    const sides = facesWhere(data, () => true).filter((f) => {
      const verts = faceVertsOf(data, f);
      return verts.includes(a) && verts.includes(b);
    });
    expect(sides.length).toBe(2);
    expect([mode(app), selected(app, plane, 'face')]).toEqual(['face', sides.filter((f) => !column.includes(f))]);
    app.dispose();
  });
});

describe.skipIf(!READY.b3)('hidden components are never op targets (B3 through B7)', () => {
  it('a delete on faces whose stored picks include a hidden face deletes only the visible one', async () => {
    const app = await modelApp();
    (app.meshes as unknown as { attach?(a: EditorApp): void }).attach?.(app);
    const desc = MESH_OP_DESCRIPTORS['mesh.delete'];
    if (desc === undefined) throw new Error('mesh.delete');
    app.operators.register({ ...meshOperator(desc), id: 'test.b10.delete' } as never);
    const cube = addMesh(app, 'msh_Cube', 'cube');
    const before = app.meshes.get(cube)?.data();
    if (before === null || before === undefined) throw new Error('data');
    selectObjects(app, [cube]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [1], mode: 'replace' });
    await ok(app, 'view.hide', { target: 'selected' });
    await ok(app, 'select.components', { mesh: cube, kind: 'face', indices: [0], mode: 'add' });
    // The hidden pick stays stored; reads (and so ops) see the visible face only.
    expect(selected(app, cube, 'face')).toEqual([0]);
    const hiddenCorners = faceVertsOf(before, 1).map((v) => pointOf(before, v));
    await ok(app, 'test.b10.delete');
    const after = app.meshes.get(cube)?.data();
    if (after === null || after === undefined) throw new Error('data');
    expect(after.counts.faces).toBe(5);
    // The hidden face is still there, its corners bit-equal.
    const survivor = facesWhere(after, () => true).find((f) => {
      const corners = faceVertsOf(after, f).map((v) => pointOf(after, v));
      return hiddenCorners.every((p) => corners.some((q) => q.every((x, k) => x === p[k])));
    });
    expect(survivor).toBeDefined();
    app.dispose();
  });
});

describe.skipIf(!READY.b5)('Mesh Check "select matching" (B5)', () => {
  it('selects the open border of a mesh its template flags closed (edges, edge mode); none on an open mesh', async () => {
    const app = await modelApp();
    app.store.transact({ label: 'Template' }, (tx) =>
      tx.put('groups', makeTestGroup('grp_Prop', { template: { kind: 'prop', params: {} } })),
    );
    const lid = addMesh(app, 'msh_Lid', 'plane', {}, { parent: 'grp_Prop' as GroupId });
    const open = addMesh(app, 'msh_Open', 'plane');
    const data = app.meshes.get(lid)?.data();
    if (data === null || data === undefined) throw new Error('data');
    expect(data.counts.edges).toBe(4);
    await ok(app, 'select.mesh.matching', { mesh: lid, code: 'open-border' });
    expect([mode(app), app.session.getState().model.hilite]).toEqual(['edge', [lid]]);
    // A 1 × 1 plane: its four edges are its border.
    expect(selected(app, lid, 'edge')).toEqual([0, 1, 2, 3]);
    // An open mesh (no template) has no open-border problem: the replace selects nothing anywhere.
    await ok(app, 'select.mesh.matching', { mesh: open, code: 'open-border' });
    expect([selected(app, open, 'edge'), selected(app, lid, 'edge')]).toEqual([[], []]);
    expect(app.session.getState().model.hilite).toEqual([lid, open]);
    app.dispose();
  });

  it('selects loose geometry in its kind: a quad’s unused point is a loose vertex (vertex mode)', async () => {
    const app = await modelApp();
    // A quad and one point no face uses (vertex 4): a vertex without edges.
    const data = buildMeshData({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 3, 3, 3],
      faces: [[0, 1, 2, 3]],
    });
    const id = 'msh_Loose' as MeshId;
    app.store.transact({ label: 'Create' }, (tx) => {
      tx.put('meshes', makeTestMesh(id, { name: id }));
      app.meshes.writeData(tx, id, data);
    });
    await ok(app, 'select.mesh.matching', { mesh: id, code: 'loose-geometry' });
    expect([mode(app), selected(app, id, 'vertex')]).toEqual(['vertex', [4]]);
    app.dispose();
  });
});

describe('Mesh Check options (§5.25)', () => {
  it('closed by a template group above the mesh or the humanoid body generator; duplicate slots of the palette', async () => {
    const app = await modelApp();
    app.store.transact({ label: 'Content' }, (tx) => {
      tx.put('groups', makeTestGroup('grp_Hand', { template: { kind: 'handheld', params: {} } }));
      tx.put('groups', makeTestGroup('grp_Inner', { parent: 'grp_Hand' as GroupId }));
      tx.put('groups', makeTestGroup('grp_Plain'));
    });
    const deep = addMesh(app, 'msh_Deep', 'cube', {}, { parent: 'grp_Inner' as GroupId });
    const plain = addMesh(app, 'msh_Plain', 'cube', {}, { parent: 'grp_Plain' as GroupId });
    const body = addMesh(
      app,
      'msh_Body',
      'cube',
      {},
      {
        generator: { kind: 'humanoidBody', params: {}, version: 1 },
      },
    );
    const closed = (id: MeshId) => meshCheckOptions(app, id).closedExpected;
    expect([closed(deep), closed(plain), closed(body)]).toEqual([true, false, true]);
    // Two live swatches on one slot (a merge of two peers' palettes): that slot is a duplicate.
    app.store.transact({ label: 'Palette' }, (tx) => {
      tx.put('palettes', makeTestPalette('pal_P'));
      tx.put('swatches', makeTestSwatch('sw_A', 'pal_P', 3, { order: 'a0' }));
      tx.put('swatches', makeTestSwatch('sw_B', 'pal_P', 3, { order: 'a1' }));
      tx.put('swatches', makeTestSwatch('sw_C', 'pal_P', 4, { order: 'a2' }));
      tx.patch('meshes', plain, { palette: 'pal_P' as PaletteId });
    });
    expect([...(meshCheckOptions(app, plain).duplicateSlots ?? [])]).toEqual([3]);
    expect(meshCheckOptions(app, deep).duplicateSlots).toBeUndefined();
    app.dispose();
  });
});

describe('acceptance fix round 1: walkers and additive picks store the picked side only (§5.6)', () => {
  async function grid(): Promise<{ app: EditorApp; mesh: MeshId; data: MeshData }> {
    const app = await modelApp();
    const mesh = addMesh(app, 'msh_Grid', 'plane', { subdivisionsWidth: 6, subdivisionsHeight: 2 });
    const data = app.meshes.get(mesh)?.data();
    if (data === null || data === undefined) throw new Error('data');
    withSymmetry(app, mesh, mirrorMapX(data));
    selectObjects(app, [mesh]);
    return { app, mesh, data };
  }

  it('an edge loop from a pick stores its own side; the mirrored loop is derived, not stored', async () => {
    const { app, mesh, data } = await grid();
    const [, v] = planeAxes(data);
    await ok(app, 'select.mode', { mode: 'edge' });
    // The column of edges at x = −1/3 (across the strip) and its mirror at x = +1/3.
    const column = (x: number): number[] =>
      edgesWhere(data, (a, b) => near(a[0], x) && near(b[0], x) && !near(a[v], b[v] as number));
    const left = column(-1 / 3);
    const right = column(1 / 3);
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
    await ok(app, 'select.components', { mesh, kind: 'edge', indices: [left[0] as number], mode: 'replace' });
    await ok(app, 'select.mesh.convert', { to: 'edge', mode: 'loop' });
    expect(selected(app, mesh, 'edge')).toEqual(left);
    const internals = componentInternals(app.components);
    expect([...(internals?.expanded(mesh, 'edge')?.edges.toArray() ?? [])]).toEqual(
      [...left, ...right].sort((a, b) => a - b),
    );
    app.dispose();
  });

  it('grow stores the picked side; the expansion still shows both', async () => {
    const { app, mesh, data } = await grid();
    await ok(app, 'select.mode', { mode: 'face' });
    const leftEnd = facesWhere(data, (c) => (c[0] as number) < -0.4);
    expect(leftEnd).toHaveLength(2);
    await ok(app, 'select.components', { mesh, kind: 'face', indices: leftEnd, mode: 'replace' });
    await ok(app, 'select.mesh.grow');
    const stored = selected(app, mesh, 'face');
    expect(stored.every((f) => facesWhere(data, (c) => (c[0] as number) < 0).includes(f))).toBe(true);
    expect(stored).toHaveLength(4);
    expect(componentInternals(app.components)?.expanded(mesh, 'face')?.faces.count()).toBe(8);
    app.dispose();
  });

  it('an additive pick of a derived partner stores nothing new', async () => {
    const { app, mesh, data } = await grid();
    await ok(app, 'select.mode', { mode: 'face' });
    const left = facesWhere(data, (c) => (c[0] as number) < -0.4)[0] as number;
    const partner = componentInternals(app.components)?.partnerOf(mesh, 'face', left) ?? -1;
    expect(partner).not.toBe(-1);
    await ok(app, 'select.components', { mesh, kind: 'face', indices: [left], mode: 'replace' });
    await ok(app, 'select.components', { mesh, kind: 'face', indices: [partner], mode: 'add' });
    expect(selected(app, mesh, 'face')).toEqual([left]);
    app.dispose();
  });
});

describe('acceptance fix round 1: template symmetry survives a document load', () => {
  it('a mesh in a Humanoid template group takes Object X again after a load; other meshes stay off', async () => {
    const app = await modelApp();
    app.store.transact({ label: 'Template' }, (tx) =>
      tx.put('groups', makeTestGroup('grp_Human', { template: { kind: 'humanoid', params: {} } })),
    );
    const body = addMesh(app, 'msh_Body', 'cube', {}, { parent: 'grp_Human' as GroupId });
    const prop = addMesh(app, 'msh_Prop', 'cube');
    const snapshot = app.store.snapshot();
    // A fresh session (a reload) remembers nothing; the load brings the template's symmetry back.
    app.session.setState({ model: { ...app.session.getState().model, symmetry: new Map() } });
    app.store.load(snapshot);
    const symmetry = app.session.getState().model.symmetry;
    expect(symmetry.get(body)?.mode).toBe('object-x');
    expect(symmetry.get(body)?.tolerance).toBe(app.prefs.getState().modeling.symmetryTolerance);
    expect(symmetry.has(prop)).toBe(false);
    // An explicit choice made after the load is kept by later loads.
    await ok(app, 'model.symmetry.set', { meshes: [body], mode: 'off' });
    app.store.load(app.store.snapshot());
    expect(app.session.getState().model.symmetry.get(body)?.mode).toBe('off');
    app.dispose();
  });
});
