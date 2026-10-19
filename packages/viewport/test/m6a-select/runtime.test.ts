// B10 (M6A-SPEC §5.6, §4.4): the Model select runtime on a real viewport — it loads with the first mesh, picks
// components of the hilited meshes on click (one history step per gesture), applies Maya's modifiers, selects edges
// by marquee only with both endpoints inside, sends double-clicks to the loop table, selects mesh objects in object
// mode, pre-highlights the hovered component, answers the operators' pointer probe, frames component selections and
// pushes face isolate sets to the mesh display.
import type { MeshId, MeshRecord, MeshRef } from '@ekza-animator/doc';
import {
  type EditorApp,
  historyLabels,
  loadMeshKernel,
  modelPointer,
  registerBuiltinOperators,
} from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { type MeshData, primitive, writeRevision } from '@ekza-animator/mesh-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ModelSelectRuntime, modelSelectOf } from '../../src';
import { loopGestureOf } from '../../src/tools/model/select/runtime';
import { createRig, pointer, type Rig } from '../helpers';

const PANE = 'pane-single';
let rig: Rig | null = null;

beforeAll(async () => {
  await loadMeshKernel();
});

afterEach(() => {
  rig?.dispose();
  rig = null;
  vi.restoreAllMocks();
});

function createMesh(app: EditorApp, id: string, data: MeshData, fields: Partial<MeshRecord> = {}): MeshId {
  const out = writeRevision(data);
  for (const [, chunk] of out.newChunks) app.blobs.put(chunk);
  app.blobs.put(out.manifestBytes);
  const ref: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
  app.store.transact({ label: 'Create' }, (tx) =>
    tx.put('meshes', {
      id: id as MeshId,
      name: id,
      owner: { scene: true },
      parent: null,
      order: 'a0',
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      pivot: [0, 0, 0],
      source: null,
      data: ref,
      faceted: true,
      generator: null,
      palette: null,
      material: { preset: 'unlit' },
      colourOutput: 'palette-texture',
      skin: null,
      budget: null,
      handheld: null,
      deleted: null,
      ...fields,
    }),
  );
  return id as MeshId;
}

interface Scene {
  readonly rig: Rig;
  readonly app: FakeEditorApp;
  readonly runtime: ModelSelectRuntime;
  readonly cube: MeshId;
}

/** A single front ortho pane in Model, a cube at the origin framed in it. */
async function scene(opts?: { readonly second?: boolean }): Promise<Scene & { readonly other: MeshId | null }> {
  const app = createFakeEditorApp();
  registerBuiltinOperators(app);
  app.session.setState({ workspace: 'model' });
  const r = await createRig({ app });
  rig = r;
  r.layout('single', { camera: () => ({ kind: 'view', preset: 'front' }), display: { shading: 'shaded' } });
  const cube = createMesh(app, 'msh_Cube', primitive('cube', {}));
  const other =
    opts?.second === true
      ? createMesh(app, 'msh_Other', primitive('cube', {}), {
          placement: { t: [3, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        })
      : null;
  await expect.poll(() => modelSelectOf(app)).not.toBeNull();
  const runtime = modelSelectOf(app) as ModelSelectRuntime;
  r.vm.frame(PANE, 'all');
  r.frame();
  return { rig: r, app, runtime, cube, other };
}

async function run(app: EditorApp, op: string, args?: unknown): Promise<void> {
  const result = await app.runUntyped(op, args);
  expect([op, result.status]).toEqual([op, 'finished']);
}

async function enter(s: Scene, mode: 'vertex' | 'edge' | 'face', meshes: readonly MeshId[] = [s.cube]): Promise<void> {
  s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [...meshes] } });
  await run(s.app, 'select.mode', { mode });
  s.rig.frame();
}

function element(s: Scene): HTMLElement {
  const pane = s.rig.panes.get(PANE);
  if (pane === undefined) throw new Error('no pane');
  return pane;
}

/** A click at pane CSS px (the single pane sits at the page origin). */
function click(s: Scene, at: { x: number; y: number }, init?: PointerEventInit): void {
  pointer(element(s), 'pointerdown', at.x, at.y, init);
  pointer(element(s), 'pointerup', at.x, at.y, init);
}

function screenOf(s: Scene, kind: 'vertex' | 'edge' | 'face', index: number, t?: number): { x: number; y: number } {
  const point = s.runtime.screenOf(s.cube, kind, index, PANE, t);
  if (point === null) throw new Error(`${kind} ${index} not visible`);
  return point;
}

const byId = (a: string | null, b: string | null): number => String(a).localeCompare(String(b));

const picks = (app: EditorApp, mesh: MeshId, kind: 'vertex' | 'edge' | 'face'): number[] => {
  const sel = app.components.get(mesh, kind);
  return [...(kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces).toArray()];
};

describe('loading (§5.5 rule 8, B6 hosting)', () => {
  it('loads with the first mesh: the display hosts it and the pointer probe is installed', async () => {
    const s = await scene();
    expect(s.rig.vm.meshLayers()).toHaveLength(1);
    expect(modelPointer(s.app)).not.toBeNull();
  });

  it('answers isOverMesh for the meshes mesh-view draws (marking menus over a mesh, §8.4)', async () => {
    const s = await scene();
    const at = s.rig.vm.project(PANE, [0, 0, 0.5]);
    if (at === null) throw new Error('cube not visible');
    expect(s.rig.vm.isOverMesh(PANE, at.x, at.y)).toBe(true);
    expect(s.rig.vm.isOverMesh(PANE, 4, 4)).toBe(false);
  });
});

describe('component clicks (§5.6)', () => {
  it('a click selects the face under the pointer (one "Select" step); empty space clears; modifiers', async () => {
    const s = await scene();
    await enter(s, 'face');
    const base = historyLabels(s.app.history).undo.length;
    click(s, screenOf(s, 'face', 0));
    expect(picks(s.app, s.cube, 'face')).toEqual([0]);
    click(s, { x: 20, y: 20 });
    expect(picks(s.app, s.cube, 'face')).toEqual([]);
    click(s, screenOf(s, 'face', 0), { shiftKey: true });
    expect(picks(s.app, s.cube, 'face')).toEqual([0]);
    click(s, screenOf(s, 'face', 0), { ctrlKey: true }); // Mod (Ctrl off macOS) removes
    expect(picks(s.app, s.cube, 'face')).toEqual([]);
    expect(historyLabels(s.app.history).undo.slice(base)).toEqual(['Select', 'Select', 'Select', 'Select']);
    s.app.history.undo();
    expect(picks(s.app, s.cube, 'face')).toEqual([0]);
  });

  it('a marquee selects an edge only with both projected endpoints inside (§5.6, E2E-MOD-25)', async () => {
    const s = await scene();
    await enter(s, 'edge');
    // The front face's bottom edge: vertices 4 and 5.
    const edge = 0; // (4, 5)
    const a = s.runtime.screenOf(s.cube, 'vertex', 4, PANE);
    const b = s.runtime.screenOf(s.cube, 'vertex', 5, PANE);
    if (a === null || b === null) throw new Error('endpoints');
    const drag = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
      pointer(element(s), 'pointerdown', from.x, from.y);
      pointer(element(s), 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2, { buttons: 1 });
      pointer(element(s), 'pointermove', to.x, to.y, { buttons: 1 });
      pointer(element(s), 'pointerup', to.x, to.y);
    };
    const mid = (a.x + b.x) / 2;
    drag({ x: Math.min(a.x, b.x) - 10, y: a.y - 10 }, { x: mid, y: a.y + 10 });
    expect(picks(s.app, s.cube, 'edge')).not.toContain(edge);
    drag({ x: Math.min(a.x, b.x) - 10, y: a.y - 10 }, { x: Math.max(a.x, b.x) + 10, y: a.y + 10 });
    expect(picks(s.app, s.cube, 'edge')).toContain(edge);
  });

  it('a double-click on the same component runs the loop table with the modifiers (`select.mesh.loop`)', async () => {
    const s = await scene();
    await enter(s, 'edge');
    const at = screenOf(s, 'edge', 0);
    click(s, at);
    click(s, at);
    const loop = s.app.calls.filter((call) => call.id === 'select.mesh.loop');
    expect(loop).toEqual([
      { id: 'select.mesh.loop', args: { mesh: s.cube, kind: 'edge', component: 0, gesture: 'double' } },
    ]);
    click(s, at, { shiftKey: true });
    click(s, at, { shiftKey: true });
    expect(s.app.calls.filter((call) => call.id === 'select.mesh.loop').at(-1)?.args).toMatchObject({
      gesture: 'shift-double',
    });
    // Mod+Shift adds (the click rules): its double-click extends like Shift; Mod alone removes the run.
    const mod: PointerEventInit = s.app.keymap.platform === 'mac' ? { metaKey: true } : { ctrlKey: true };
    click(s, at, { ...mod, shiftKey: true });
    click(s, at, { ...mod, shiftKey: true });
    expect(s.app.calls.filter((call) => call.id === 'select.mesh.loop').at(-1)?.args).toMatchObject({
      gesture: 'shift-double',
    });
    click(s, at, mod);
    click(s, at, mod);
    expect(s.app.calls.filter((call) => call.id === 'select.mesh.loop').at(-1)?.args).toMatchObject({
      gesture: 'mod-double',
    });
    expect(s.app.calls.filter((call) => call.id === 'select.mesh.loop')).toHaveLength(4);
    expect([
      loopGestureOf({ shift: false, mod: false }),
      loopGestureOf({ shift: true, mod: false }),
      loopGestureOf({ shift: true, mod: true }),
      loopGestureOf({ shift: false, mod: true }),
    ]).toEqual(['double', 'shift-double', 'shift-double', 'mod-double']);
  });

  it('the hovered component is pre-highlighted; the pointer probe names the mesh under the pointer', async () => {
    const s = await scene();
    await enter(s, 'face');
    const hover = vi.spyOn(s.runtime.display, 'setHover');
    const at = screenOf(s, 'face', 0);
    pointer(element(s), 'pointermove', at.x, at.y, { buttons: 0 });
    expect(hover).toHaveBeenLastCalledWith(s.cube, { kind: 'face', index: 0 });
    expect(modelPointer(s.app)?.meshAt(PANE, 'hover')).toBe(s.cube);
    pointer(element(s), 'pointermove', 15, 15, { buttons: 0 });
    expect(hover).toHaveBeenLastCalledWith(null, null);
    expect(modelPointer(s.app)?.meshAt(PANE, 'hover')).toBeNull();
  });
});

describe('object mode (§5.6)', () => {
  it('a click selects the mesh object under the pointer; empty space clears; a marquee selects by vertices', async () => {
    const s = await scene({ second: true });
    const at = s.rig.vm.project(PANE, [0, 0, 0.5]);
    if (at === null) throw new Error('cube not visible');
    click(s, { x: at.x, y: at.y });
    expect(s.app.session.getState().selection.objects).toEqual([s.cube]);
    click(s, { x: 5, y: 5 });
    expect(s.app.session.getState().selection.objects).toEqual([]);
    pointer(element(s), 'pointerdown', 2, 2);
    pointer(element(s), 'pointermove', 600, 300, { buttons: 1 });
    pointer(element(s), 'pointermove', 1198, 598, { buttons: 1 });
    pointer(element(s), 'pointerup', 1198, 598);
    expect([...s.app.session.getState().selection.objects].sort(byId)).toEqual([s.cube, s.other].sort(byId));
  });

  it('the RMB press point stays the menu mesh when a later left click lands elsewhere (click-release menus)', async () => {
    const s = await scene();
    const at = s.rig.vm.project(PANE, [0, 0, 0.5]);
    if (at === null) throw new Error('cube not visible');
    pointer(element(s), 'pointerdown', at.x, at.y, { button: 2 });
    pointer(element(s), 'pointerup', at.x, at.y, { button: 2 });
    pointer(element(s), 'pointerdown', 10, 10);
    pointer(element(s), 'pointerup', 10, 10);
    expect(modelPointer(s.app)?.meshAt(PANE, 'press')).toBe(s.cube);
  });

  it('entering a component mode without a selection hilites the mesh under the pointer', async () => {
    const s = await scene();
    const at = s.rig.vm.project(PANE, [0, 0, 0.5]);
    if (at === null) throw new Error('cube not visible');
    pointer(element(s), 'pointermove', at.x, at.y, { buttons: 0 });
    const result = await s.app.runUntyped('select.mode', { mode: 'vertex' }, { source: 'keyboard', paneId: PANE });
    expect(result.status).toBe('finished');
    expect(s.app.session.getState().model.hilite).toEqual([s.cube]);
  });
});

describe('framing and isolate', () => {
  it('F frames the component selection (the camera looks at the selected vertex)', async () => {
    const s = await scene();
    await enter(s, 'vertex');
    s.app.components.apply(s.cube, 'vertex', [7], 'replace'); // (0.5, 0.5, 0.5)
    s.rig.vm.frame(PANE, 'selection');
    s.rig.frame();
    const at = s.rig.vm.project(PANE, [0.5, 0.5, 0.5]);
    const rect = s.rig.vm.paneRect(PANE);
    if (at === null || rect === null) throw new Error('not visible');
    expect(Math.abs(at.x - rect.w / 2)).toBeLessThan(2);
    expect(Math.abs(at.y - rect.h / 2)).toBeLessThan(2);
  });

  it('view.isolate in face mode pushes the selected faces as the pane face isolate set', async () => {
    const s = await scene();
    await enter(s, 'face');
    s.app.components.apply(s.cube, 'face', [0, 4], 'replace');
    const isolate = vi.spyOn(s.runtime.display, 'setFaceIsolate');
    await run(s.app, 'view.isolate', { paneId: PANE });
    const pushed = isolate.mock.calls.find(([pane, mesh, faces]) => pane === PANE && mesh === s.cube && faces !== null);
    expect([...(pushed?.[2]?.toArray() ?? [])]).toEqual([0, 4]);
    await run(s.app, 'view.isolate', { paneId: PANE });
    expect(isolate).toHaveBeenLastCalledWith(PANE, s.cube, null);
  });
});

describe('Mesh Check overlay (§5.25)', () => {
  it('follows the panes’ meshCheck flag for every drawn mesh, without the Mesh Check panel', async () => {
    const s = await scene({ second: true });
    const lints = vi.spyOn(s.runtime.display, 'setLints');
    const pane = s.rig.vm.paneState(PANE);
    if (pane === null) throw new Error('no pane');
    expect(pane.display.meshCheck).toBe(false);
    s.rig.vm.updatePane(PANE, { display: { ...pane.display, meshCheck: true } });
    await expect.poll(() => new Set(lints.mock.calls.map(([mesh]) => mesh))).toEqual(new Set([s.cube, s.other]));
    lints.mockClear();
    // Nothing changed: nothing recomputed.
    s.rig.vm.updatePane(PANE, { display: { ...pane.display, meshCheck: true } });
    await Promise.resolve();
    expect(lints).not.toHaveBeenCalled();
    s.rig.vm.updatePane(PANE, { display: { ...pane.display, meshCheck: false } });
    await expect.poll(() => lints.mock.calls.length).toBe(2);
    expect(lints.mock.calls.every(([, problems]) => problems.length === 0)).toBe(true);
  });
});

describe('the pointer probe over meshes without a record (§5.6 "Make editable first")', () => {
  it('assetMeshAt: a mesh the viewport draws without a record under the point, never a record’s mesh', async () => {
    const s = await scene();
    const over = vi.spyOn(s.rig.vm, 'isOverMesh').mockReturnValue(true); // e.g. a character's glTF mesh
    pointer(element(s), 'pointermove', 15, 15, { buttons: 0 });
    expect(modelPointer(s.app)?.assetMeshAt?.(PANE, 'hover')).toBe(true);
    const at = s.rig.vm.project(PANE, [0, 0, 0.5]);
    if (at === null) throw new Error('cube not visible');
    pointer(element(s), 'pointermove', at.x, at.y, { buttons: 0 });
    expect(modelPointer(s.app)?.assetMeshAt?.(PANE, 'hover')).toBe(false);
    over.mockReturnValue(false);
    pointer(element(s), 'pointermove', 15, 15, { buttons: 0 });
    expect(modelPointer(s.app)?.assetMeshAt?.(PANE, 'hover')).toBe(false);
  });
});
