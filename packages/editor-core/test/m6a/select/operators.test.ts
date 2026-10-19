// B10 (M6A-SPEC §5.6, §6.2): component modes and hilite, selection gestures as history steps (one per gesture,
// continuation coalescing, undo/redo restoring the selection, nothing in Animate), all/invert/none, object selection,
// hide/show/isolate, and the Model session repair. Walker operators (B2) and Mesh Check matching (B5) are gated.
import type { MeshId } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import { describe, expect, it } from 'vitest';
import { componentInternals, type EditorApp, historyLabels, objectsDrawnIn, SELECT_A_MESH_FIRST } from '../../../src';
import { READY } from './ready';
import { addMesh, mirrorMapX, modelApp, probe, selected, selectObjects, withSymmetry } from './support';

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
    selectObjects(app, [plane]);
    await ok(app, 'select.mode', { mode: 'edge' });
    const base = undoLabels(app).length;
    // The first click of the double-click, then the double-click on the same edge (the loop table reads the
    // selection from before the first click).
    await ok(app, 'select.components', { mesh: plane, kind: 'edge', indices: [5], mode: 'replace', gesture: 'click' });
    await ok(app, 'select.mesh.loop', { mesh: plane, kind: 'edge', component: 5, gesture: 'double' });
    expect(selected(app, plane, 'edge').length).toBeGreaterThan(1);
    expect(undoLabels(app).slice(base)).toEqual(['Select', 'Select']);
    app.history.undo();
    expect(selected(app, plane, 'edge')).toEqual([5]);
    app.dispose();
  });

  it('grow repeats while the key is held: the auto-repeated runs coalesce into one step', async () => {
    const app = await modelApp();
    const plane = addMesh(app, 'msh_Grid', 'plane', { subdivisionsWidth: 6, subdivisionsHeight: 6 });
    selectObjects(app, [plane]);
    await ok(app, 'select.mode', { mode: 'face' });
    await ok(app, 'select.components', { mesh: plane, kind: 'face', indices: [14], mode: 'replace' });
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
});

describe.skipIf(!READY.b5)('Mesh Check "select matching" (B5)', () => {
  it('selects the components of a problem code in their kind and hilites the mesh', async () => {
    const app = await modelApp();
    const plane = addMesh(app, 'msh_Open', 'plane');
    await ok(app, 'select.mesh.matching', { mesh: plane, code: 'open-border' });
    expect(app.session.getState().model.hilite).toContain(plane);
    app.dispose();
  });
});
