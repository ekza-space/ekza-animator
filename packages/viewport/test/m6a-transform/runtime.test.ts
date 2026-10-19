// B12a (M6A-SPEC §5.15, §5.10, §5.14): Model's transform runtime on a real viewport — the manipulator on component
// selections (pivot, World/Object/Component frames) and on objects, component W/E/R drags through a MeshOpSession that
// commit one "Move"/"Rotate"/"Scale" step (Esc cancels without a step), object Move/Rotate through
// `scene.object.transform`, the MMB rule (view plane, last-picked handle, the INPUTS field), Tweak, snapping (grid,
// increments, vertex onto another mesh), pivot editing (objects and components), the soft-select radius and overlay,
// symmetric transforms through the UI path and the numeric capture target of a drag.
import { type Mat4, mat4Compose } from '@ekza-animator/anim-core';
import type { MeshId, MeshRecord, MeshRef } from '@ekza-animator/doc';
import {
  componentInternals,
  type EditorApp,
  historyLabels,
  loadMeshKernel,
  registerBuiltinOperators,
  selectInputsField,
  setComponentSpace,
} from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { type MeshData, primitive, writeRevision } from '@ekza-animator/mesh-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type ModelTransformRuntime,
  modelSelectOf,
  modelTransformOf,
  transformAnnouncement,
  transformReadout,
} from '../../src';
import { createRig, drag, pointer, type Rig } from '../helpers';

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
  readonly runtime: ModelTransformRuntime;
  readonly cube: MeshId;
  readonly other: MeshId | null;
}

/**
 * A single pane in Model, a cube at the origin: the persp view by default (edge-on plane handles of the front view
 * pick like their axes), the front ortho view on request (screen x → world +x, screen y → world −y).
 */
async function scene(opts?: {
  readonly second?: boolean;
  readonly front?: boolean;
  readonly data?: MeshData;
}): Promise<Scene> {
  const app = createFakeEditorApp();
  registerBuiltinOperators(app);
  app.session.setState({ workspace: 'model' });
  const r = await createRig({ app });
  rig = r;
  r.layout('single', {
    camera: () => ({ kind: 'view', preset: opts?.front === true ? 'front' : 'persp' }),
    display: { shading: 'shaded' },
  });
  const cube = createMesh(app, 'msh_Cube', opts?.data ?? primitive('cube', {}));
  const other =
    opts?.second === true
      ? createMesh(app, 'msh_Other', primitive('cube', {}), {
          placement: { t: [2.5, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
        })
      : null;
  // Both lazy chunks (mesh-view with the select runtime, the transform runtime): a cold import takes seconds.
  await expect.poll(() => modelSelectOf(app), { timeout: 15_000 }).not.toBeNull();
  await expect.poll(() => modelTransformOf(app), { timeout: 15_000 }).not.toBeNull();
  r.vm.frame(PANE, 'all');
  r.frame();
  return { rig: r, app, runtime: modelTransformOf(app) as ModelTransformRuntime, cube, other };
}

async function run(app: EditorApp, op: string, args?: unknown): Promise<void> {
  const result = await app.runUntyped(op, args);
  expect([op, result.status, result.status === 'cancelled' ? result.reason : '']).toEqual([op, 'finished', '']);
}

async function tool(s: Scene, id: 'move' | 'rotate' | 'scale' | 'select'): Promise<void> {
  await run(s.app, 'view.tool', { panel: 'viewport', tool: id });
  s.rig.frame();
}

/** Selects the mesh objects, enters a component mode and selects components of the cube. */
async function pick(s: Scene, kind: 'vertex' | 'edge' | 'face', indices: readonly number[]): Promise<void> {
  s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.cube] } });
  await run(s.app, 'select.mode', { mode: kind });
  await run(s.app, 'select.components', { mesh: s.cube, kind, indices, mode: 'replace' });
  s.rig.frame();
}

function element(s: Scene): HTMLElement {
  const pane = s.rig.panes.get(PANE);
  if (pane === undefined) throw new Error('no pane');
  return pane;
}

function handle(s: Scene, h: string): { x: number; y: number } {
  const point = s.rig.vm.manipulatorScreenPoint(PANE, h as never);
  if (point === null) throw new Error(`handle ${h} not visible`);
  return { x: point.x, y: point.y };
}

function positions(app: EditorApp, mesh: MeshId): number[][] {
  const data = app.meshes.get(mesh)?.data();
  if (data === null || data === undefined) throw new Error('no data');
  const out: number[][] = [];
  for (let v = 0; v < data.counts.points; v++) {
    out.push([data.position[3 * v] as number, data.position[3 * v + 1] as number, data.position[3 * v + 2] as number]);
  }
  return out;
}

const labels = (app: EditorApp): readonly string[] => historyLabels(app.history).undo;

/** Waits for the commit a drag release started (the run is asynchronous). */
async function settled(app: EditorApp, steps: number): Promise<void> {
  await expect.poll(() => labels(app).length).toBe(steps);
}

function key(
  s: Scene,
  code: string,
  type: 'down' | 'up',
  mods: Partial<{ shift: boolean; mod: boolean }> = {},
): boolean {
  return (
    s.rig.vm.activeTool()?.key?.({
      type,
      code,
      shift: mods.shift ?? false,
      alt: false,
      mod: mods.mod ?? false,
      ctrl: false,
      repeat: false,
    }) ?? false
  );
}

const near = (a: number | undefined, b: number, eps = 1e-5): boolean => a !== undefined && Math.abs(a - b) <= eps;

describe('the manipulator on components and objects (§5.15)', () => {
  it('sits on the bounding-box centre of the picked vertices with World, Object or Component axes', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', []);
    expect(s.rig.vm.manipulatorAxes()).toBeNull(); // nothing selected: no manipulator
    const p = positions(s.app, s.cube);
    const top = p.map((q, v) => ({ q, v })).filter(({ q }) => near(q[1], 0.5));
    await pick(
      s,
      'vertex',
      top.map(({ v }) => v),
    );
    expect(s.rig.vm.manipulatorAxes()).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    const centre = s.rig.vm.project(PANE, [0, 0.5, 0]);
    const grab = handle(s, 'tview');
    expect(near(grab.x, centre?.x ?? Number.NaN, 0.5) && near(grab.y, centre?.y ?? Number.NaN, 0.5)).toBe(true);
    // Component: Z along the top face normal (+Y), X/Y by the region-frame rule.
    setComponentSpace(s.app, 'move', true);
    s.rig.vm.refreshManipulatorSoon();
    const axes = s.rig.vm.manipulatorAxes();
    expect(axes?.[2]?.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0, 1, 0]);
  });

  it('sits on the topmost selected object in object mode (Move, Rotate); Scale stays B9’s', async () => {
    const s = await scene();
    s.app.store.transact({ label: 'Place' }, (tx) =>
      tx.patch('meshes', s.cube, { placement: { t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }, pivot: [0, 0.5, 0] }),
    );
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.cube] } });
    await tool(s, 'move');
    const at = s.rig.vm.project(PANE, [1, 0.5, 0]);
    const grab = handle(s, 'tview');
    expect(near(grab.x, at?.x ?? Number.NaN, 0.5) && near(grab.y, at?.y ?? Number.NaN, 0.5)).toBe(true);
  });
});

describe('component drags (§5.15, §5.10)', () => {
  it('drags the ty handle: one "Move" step along +Y only; undo restores bit-equal positions', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [0, 1]);
    const before = positions(s.app, s.cube);
    const steps = labels(s.app).length;
    const from = handle(s, 'ty');
    drag(element(s), from, { x: from.x, y: from.y - 40 });
    await settled(s.app, steps + 1);
    expect(labels(s.app).at(-1)).toBe('Move');
    const after = positions(s.app, s.cube);
    const dy = (after[0]?.[1] ?? 0) - (before[0]?.[1] ?? 0);
    expect(dy).toBeGreaterThan(0);
    for (const v of [0, 1]) {
      expect(after[v]?.[0]).toBe(before[v]?.[0]);
      expect(after[v]?.[2]).toBe(before[v]?.[2]);
      expect(near(after[v]?.[1], (before[v]?.[1] ?? 0) + dy)).toBe(true);
    }
    for (let v = 2; v < before.length; v++) expect(after[v]).toEqual(before[v]);
    s.app.history.undo();
    expect(positions(s.app, s.cube)).toEqual(before);
  });

  it('in an ortho side view a press on an axis whose plane handle lies edge-on over it drags that axis', async () => {
    const s = await scene({ front: true });
    await tool(s, 'move');
    await pick(s, 'vertex', [0]);
    const before = positions(s.app, s.cube);
    const steps = labels(s.app).length;
    const tx = handle(s, 'tx');
    drag(element(s), tx, { x: tx.x + 30, y: tx.y + 10 });
    await settled(s.app, steps + 1);
    expect(s.app.session.getState().model.tweakHandle).toBe('tx');
    const after = positions(s.app, s.cube);
    expect((after[0]?.[0] ?? 0) - (before[0]?.[0] ?? 0)).toBeGreaterThan(0);
    expect(after[0]?.[1]).toBe(before[0]?.[1]);
    expect(after[0]?.[2]).toBe(before[0]?.[2]);
  });

  it('Esc (cancel) during a drag restores the mesh and records nothing', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [0]);
    const before = positions(s.app, s.cube);
    const steps = labels(s.app).length;
    const from = handle(s, 'tx');
    pointer(element(s), 'pointerdown', from.x, from.y);
    pointer(element(s), 'pointermove', from.x + 30, from.y, { buttons: 1 });
    expect(s.rig.vm.activeTool()?.phase?.()).toBe('dragging');
    expect(s.app.capture.state.armed).toBe('drag');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    pointer(element(s), 'pointerup', from.x + 30, from.y);
    await Promise.resolve();
    expect(positions(s.app, s.cube)).toEqual(before);
    expect(labels(s.app)).toHaveLength(steps);
    expect(s.app.capture.state.armed).toBeNull();
  });

  it('rotates and scales faces about the selection centre ("Rotate", "Scale")', async () => {
    const s = await scene();
    await pick(s, 'face', [0]);
    await tool(s, 'rotate');
    const steps = labels(s.app).length;
    const ring = handle(s, 'rz');
    drag(element(s), ring, { x: ring.x + 30, y: ring.y + 10 });
    await settled(s.app, steps + 1);
    expect(labels(s.app).at(-1)).toBe('Rotate');
    await tool(s, 'scale');
    const cube = handle(s, 'suniform');
    drag(element(s), cube, { x: cube.x + 40, y: cube.y });
    await settled(s.app, steps + 2);
    expect(labels(s.app).at(-1)).toBe('Scale');
  });

  it('commits the value typed in the capture window (§5.10): exactly 0.5 m along Y', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [2]);
    const before = positions(s.app, s.cube);
    const steps = labels(s.app).length;
    const from = handle(s, 'ty');
    pointer(element(s), 'pointerdown', from.x, from.y);
    pointer(element(s), 'pointermove', from.x, from.y - 20, { buttons: 1 });
    const target = s.rig.vm.activeTool()?.numeric?.();
    expect(target?.active).toBe('translateY');
    expect(target?.fields.map((f) => f.name)).toEqual(['translateX', 'translateY', 'translateZ']);
    target?.set('translateY', 0.5);
    target?.confirm();
    pointer(element(s), 'pointerup', from.x, from.y - 20);
    await settled(s.app, steps + 1);
    expect(positions(s.app, s.cube)[2]?.[1]).toBe(Math.fround((before[2]?.[1] ?? 0) + 0.5));
    // The committed value goes to the help line (the editor's overlay writes it, §5.10 polite live region).
    expect(transformAnnouncement(s.app)).toEqual({ paneId: PANE, text: 'Move Translate Y 0.500 m' });
  });

  it('a drag without typed values, or a cancelled one, announces nothing', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [2]);
    const steps = labels(s.app).length;
    const from = handle(s, 'ty');
    drag(element(s), from, { x: from.x, y: from.y - 20 });
    await settled(s.app, steps + 1);
    expect(transformAnnouncement(s.app)).toBeNull();
    pointer(element(s), 'pointerdown', from.x, from.y);
    pointer(element(s), 'pointermove', from.x, from.y - 20, { buttons: 1 });
    const target = s.rig.vm.activeTool()?.numeric?.();
    target?.set('translateY', 0.5);
    target?.cancel();
    pointer(element(s), 'pointerup', from.x, from.y - 20);
    await Promise.resolve();
    expect(labels(s.app)).toHaveLength(steps + 1);
    expect(transformAnnouncement(s.app)).toBeNull();
  });

  it('the Scale tool shows the grabbing cursor while a component drag runs (as Move and Rotate)', async () => {
    const s = await scene();
    await pick(s, 'face', [0]);
    await tool(s, 'scale');
    const tool0 = s.rig.vm.activeTool();
    expect(tool0?.cursor?.() ?? null).toBeNull();
    const cube = handle(s, 'suniform');
    pointer(element(s), 'pointerdown', cube.x, cube.y);
    pointer(element(s), 'pointermove', cube.x + 30, cube.y, { buttons: 1 });
    expect(s.rig.vm.activeTool()?.phase?.()).toBe('dragging');
    expect(s.rig.vm.activeTool()?.cursor?.()).toBe('grabbing');
    pointer(element(s), 'pointerup', cube.x + 30, cube.y);
    expect(s.rig.vm.activeTool()?.cursor?.() ?? null).toBeNull();
  });
});

describe('the extrude session absorbs W/E/R and MMB drags first (§5.8; B12b behind READY.b12b)', () => {
  it('calls app.extrude.beginAbsorb with the tool and space and feeds the gesture world deltas; no own step', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'face', [0]);
    const updates: unknown[] = [];
    let commits = 0;
    const absorb = vi.spyOn(s.app.extrude, 'beginAbsorb').mockReturnValue({
      update: (delta) => updates.push(delta),
      commit: () => {
        commits++;
      },
      cancel: () => {},
    });
    const before = positions(s.app, s.cube);
    const steps = labels(s.app).length;
    const ty = handle(s, 'ty');
    drag(element(s), ty, { x: ty.x, y: ty.y - 30 });
    expect(absorb).toHaveBeenCalledWith('move', 'world');
    expect(updates.length).toBeGreaterThan(0);
    const last = updates.at(-1) as { translate?: number[] };
    expect(last.translate?.[1]).toBeGreaterThan(0);
    expect(last.translate?.[0]).toBeCloseTo(0, 9);
    expect(commits).toBe(1);
    await Promise.resolve();
    expect(labels(s.app)).toHaveLength(steps);
    expect(positions(s.app, s.cube)).toEqual(before);
    // An MMB drag asks with 'mmb'.
    drag(element(s), { x: 200, y: 200 }, { x: 240, y: 200 }, { button: 1 });
    expect(absorb).toHaveBeenLastCalledWith('mmb', 'world');
  });
});

describe('the MMB rule (§5.15)', () => {
  it('moves in the view plane without a picked handle, then along the last-picked handle only', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [0, 1]);
    const before = positions(s.app, s.cube);
    const steps = labels(s.app).length;
    drag(element(s), { x: 100, y: 100 }, { x: 140, y: 100 }, { button: 1 });
    await settled(s.app, steps + 1);
    const moved = positions(s.app, s.cube);
    const delta = [0, 1, 2].map((k) => (moved[0]?.[k] ?? 0) - (before[0]?.[k] ?? 0));
    const other = [0, 1, 2].map((k) => (moved[1]?.[k] ?? 0) - (before[1]?.[k] ?? 0));
    const camera = s.rig.vm.camera(PANE);
    const forward = [0, 1, 2].map((k) => (camera.target[k] ?? 0) - (camera.position[k] ?? 0));
    const length = Math.hypot(...forward);
    expect(Math.hypot(...delta)).toBeGreaterThan(0.01);
    expect(Math.abs(delta.reduce((sum, d, k) => sum + d * (forward[k] ?? 0), 0) / length)).toBeLessThan(1e-5);
    delta.forEach((d, k) => expect(near(other[k], d)).toBe(true)); // both by the same delta
    s.app.history.undo();
    // A LMB press-release on tx picks it (no move, no step).
    const tx = handle(s, 'tx');
    pointer(element(s), 'pointerdown', tx.x, tx.y);
    pointer(element(s), 'pointerup', tx.x, tx.y);
    expect(s.app.session.getState().model.tweakHandle).toBe('tx');
    expect(labels(s.app)).toHaveLength(steps);
    drag(element(s), { x: 100, y: 100 }, { x: 140, y: 140 }, { button: 1 });
    await settled(s.app, steps + 1);
    const along = positions(s.app, s.cube);
    expect((along[0]?.[0] ?? 0) - (before[0]?.[0] ?? 0)).toBeGreaterThan(0);
    expect(along[0]?.[1]).toBe(before[0]?.[1]);
    expect(along[0]?.[2]).toBe(before[0]?.[2]);
    await tool(s, 'rotate');
    expect(s.app.session.getState().model.tweakHandle).toBeNull(); // cleared on a tool switch
  });

  it('drags the selected INPUTS field: width += 40 px × metresPerPx as an adjusted primitive run', async () => {
    const s = await scene();
    await run(s.app, 'mesh.create.cube');
    const created = s.app.store.list('meshes').find((m) => m.generator !== null);
    if (created === undefined) throw new Error('no primitive');
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [created.id] } });
    await tool(s, 'move');
    selectInputsField(s.app, { entry: 'primitive', mesh: created.id, param: 'width' });
    const steps = labels(s.app).length;
    drag(element(s), { x: 100, y: 100 }, { x: 140, y: 100 }, { button: 1 });
    await expect.poll(() => s.app.store.get('meshes', created.id)?.generator?.params['width']).toBeCloseTo(1.4, 9);
    expect(labels(s.app)).toHaveLength(steps); // adjusted in place, not a new step
  });
});

describe('Tweak (§5.15)', () => {
  it('a drag starting on an unselected vertex selects and moves it in one "Move" step', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [0]);
    await run(s.app, 'model.selectionStyle.set', { style: 'tweak' });
    const selectRuntime = modelSelectOf(s.app);
    const p = positions(s.app, s.cube);
    // A front vertex not selected: the one at the top right front (+x, +y, +z).
    const v = p.findIndex((q) => near(q[0], 0.5) && near(q[1], 0.5) && near(q[2], 0.5));
    const at = selectRuntime?.screenOf(s.cube, 'vertex', v, PANE);
    if (at === null || at === undefined) throw new Error('vertex not visible');
    const steps = labels(s.app).length;
    drag(element(s), at, { x: at.x + 30, y: at.y });
    await settled(s.app, steps + 1);
    expect(labels(s.app).slice(steps)).toEqual(['Move']);
    expect([...s.app.components.get(s.cube, 'vertex').verts.toArray()]).toEqual([v]);
    const moved = positions(s.app, s.cube);
    expect((moved[v]?.[0] ?? 0) - (p[v]?.[0] ?? 0)).toBeGreaterThan(0);
    expect(moved[0]).toEqual(p[0]);
  });

  it('Esc during a Tweak drag puts the selection it replaced back and records nothing', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [0]);
    await run(s.app, 'model.selectionStyle.set', { style: 'tweak' });
    const p = positions(s.app, s.cube);
    const v = p.findIndex((q) => near(q[0], 0.5) && near(q[1], 0.5) && near(q[2], 0.5));
    const at = modelSelectOf(s.app)?.screenOf(s.cube, 'vertex', v, PANE);
    if (at === null || at === undefined) throw new Error('vertex not visible');
    const steps = labels(s.app).length;
    pointer(element(s), 'pointerdown', at.x, at.y);
    pointer(element(s), 'pointermove', at.x + 30, at.y, { buttons: 1 });
    expect(s.rig.vm.activeTool()?.phase?.()).toBe('dragging');
    expect([...s.app.components.get(s.cube, 'vertex').verts.toArray()]).toEqual([v]); // the press replaced it
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    pointer(element(s), 'pointerup', at.x + 30, at.y);
    await Promise.resolve();
    expect([...s.app.components.get(s.cube, 'vertex').verts.toArray()]).toEqual([0]);
    expect(positions(s.app, s.cube)).toEqual(p);
    expect(labels(s.app)).toHaveLength(steps);
  });
});

describe('snapping (§5.15)', () => {
  it('X snaps the moved pivot to the grid, J the move to increments', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [0]);
    const before = positions(s.app, s.cube);
    let steps = labels(s.app).length;
    // Observed holds return false (§5.17 step 2: the keymap still resolves the key); the runtime holds the snap.
    expect(key(s, 'KeyX', 'down')).toBe(false);
    expect(s.runtime.held.grid).toBe(true);
    const from = handle(s, 'ty');
    drag(element(s), from, { x: from.x, y: from.y - 37 });
    expect(key(s, 'KeyX', 'up')).toBe(false);
    expect(s.runtime.held.grid).toBe(false);
    await settled(s.app, ++steps);
    const y = positions(s.app, s.cube)[0]?.[1] ?? 0;
    expect(near(Math.round(y / 0.1) * 0.1, y)).toBe(true);
    s.app.history.undo();
    await run(s.app, 'model.snap.toggle', { kind: 'increment' });
    const again = handle(s, 'tx');
    drag(element(s), again, { x: again.x + 37, y: again.y });
    await settled(s.app, steps);
    const dx = (positions(s.app, s.cube)[0]?.[0] ?? 0) - (before[0]?.[0] ?? 0);
    expect(near(Math.round(dx / 0.1) * 0.1, dx)).toBe(true);
    expect(dx).not.toBe(0);
  });

  it('V snaps an object move onto another mesh’s vertex: its placement lands on that vertex (E2E-MOD-28)', async () => {
    const s = await scene({ second: true, front: true });
    const other = s.other as MeshId;
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.cube] } });
    await tool(s, 'move');
    const target = [2.5 - 0.5, 0.5, 0.5] as const; // a corner of the other cube (front, top, left)
    const at = s.rig.vm.project(PANE, [...target]);
    if (at === null) throw new Error('vertex not visible');
    const steps = labels(s.app).length;
    key(s, 'KeyV', 'down');
    drag(element(s), handle(s, 'tview'), { x: at.x + 3, y: at.y - 2 }, undefined, 6);
    key(s, 'KeyV', 'up');
    await settled(s.app, steps + 1);
    expect(labels(s.app).at(-1)).toBe('Move');
    const t = s.app.store.get('meshes', s.cube)?.placement.t ?? [];
    expect(t.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([...target]);
    expect(s.app.store.get('meshes', other)?.placement.t).toEqual([2.5, 0, 0]);
  });
});

describe('objects (§5.13 scene.object.transform)', () => {
  it('moves and rotates the selected object in one step each; undo restores the placement', async () => {
    const s = await scene();
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.cube] } });
    await tool(s, 'move');
    const steps = labels(s.app).length;
    const ty = handle(s, 'ty');
    drag(element(s), ty, { x: ty.x, y: ty.y - 30 });
    await settled(s.app, steps + 1);
    const moved = s.app.store.get('meshes', s.cube)?.placement;
    expect(moved?.t[1]).toBeGreaterThan(0);
    expect(moved?.t[0]).toBe(0);
    await tool(s, 'rotate');
    const ring = handle(s, 'ry');
    drag(element(s), ring, { x: ring.x + 30, y: ring.y });
    await settled(s.app, steps + 2);
    expect(labels(s.app).slice(-2)).toEqual(['Move', 'Rotate']);
    const turned = s.app.store.get('meshes', s.cube)?.placement;
    expect(turned?.q[1]).not.toBe(0);
    expect(turned?.t.map((x) => Math.round(x * 1e9) / 1e9)).toEqual(moved?.t.map((x) => Math.round(x * 1e9) / 1e9));
    s.app.history.undo();
    expect(s.app.store.get('meshes', s.cube)?.placement).toEqual(moved);
  });
});

describe('typed values of object drags (§5.10)', () => {
  /** |q · expected| = 1 within eps (q and −q are the same rotation). */
  const sameRotation = (q: readonly number[] | undefined, expected: readonly number[], eps = 1e-9): boolean =>
    q !== undefined && Math.abs(Math.abs(q.reduce((sum, x, k) => sum + x * (expected[k] ?? 0), 0)) - 1) <= eps;

  it('an object Rotate drag commits the typed angle: rotateY = 90° about Y in one "Rotate" step', async () => {
    const s = await scene();
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.cube] } });
    await tool(s, 'rotate');
    const steps = labels(s.app).length;
    const ring = handle(s, 'ry');
    pointer(element(s), 'pointerdown', ring.x, ring.y);
    pointer(element(s), 'pointermove', ring.x + 20, ring.y, { buttons: 1 });
    const target = s.rig.vm.activeTool()?.numeric?.();
    expect(target?.active).toBe('rotateY');
    expect(target?.fields.map((f) => f.name)).toEqual(['rotateX', 'rotateY', 'rotateZ']);
    target?.set('rotateY', Math.PI / 2);
    expect(target?.value('rotateY')).toBe(Math.PI / 2);
    target?.confirm();
    pointer(element(s), 'pointerup', ring.x + 20, ring.y);
    await settled(s.app, steps + 1);
    expect(labels(s.app).slice(steps)).toEqual(['Rotate']);
    const placement = s.app.store.get('meshes', s.cube)?.placement;
    expect(sameRotation(placement?.q, [0, Math.SQRT1_2, 0, Math.SQRT1_2])).toBe(true);
    expect(placement?.t).toEqual([0, 0, 0]);
    expect(placement?.s).toEqual([1, 1, 1]);
  });

  it('several typed Euler fields compose in the frame as mesh.transformComponents does (xyz: Ry·Rx)', async () => {
    const s = await scene();
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.cube] } });
    await tool(s, 'rotate');
    const steps = labels(s.app).length;
    const ring = handle(s, 'ry');
    pointer(element(s), 'pointerdown', ring.x, ring.y);
    pointer(element(s), 'pointermove', ring.x + 20, ring.y, { buttons: 1 });
    const target = s.rig.vm.activeTool()?.numeric?.();
    target?.set('rotateX', Math.PI / 2);
    target?.set('rotateY', Math.PI / 2);
    target?.confirm();
    pointer(element(s), 'pointerup', ring.x + 20, ring.y);
    await settled(s.app, steps + 1);
    // Ry(90°)·Rx(90°) = (x, y, z, w) (0.5, 0.5, −0.5, 0.5).
    expect(sameRotation(s.app.store.get('meshes', s.cube)?.placement.q, [0.5, 0.5, -0.5, 0.5])).toBe(true);
  });
});

describe('pivot editing (§5.15)', () => {
  it('D held: the manipulator is dashed and a drag moves the object pivot (mesh.pivot.set, undoable)', async () => {
    const s = await scene();
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.cube] } });
    await tool(s, 'rotate');
    expect(key(s, 'KeyD', 'down')).toBe(false); // observed (§5.17 step 2), held by the runtime
    expect(s.runtime.held.pivot).toBe(true);
    s.rig.frame();
    const tx = handle(s, 'tx'); // pivot editing shows the translate handles whatever the tool
    const steps = labels(s.app).length;
    drag(element(s), tx, { x: tx.x + 40, y: tx.y });
    key(s, 'KeyD', 'up');
    await settled(s.app, steps + 1);
    const pivot = s.app.store.get('meshes', s.cube)?.pivot ?? [];
    expect(pivot[0]).toBeGreaterThan(0);
    expect(pivot[1]).toBe(0);
    expect(s.app.store.get('meshes', s.cube)?.placement.t).toEqual([0, 0, 0]);
    s.app.history.undo();
    expect(s.app.store.get('meshes', s.cube)?.pivot).toEqual([0, 0, 0]);
  });

  it('in a component mode it pins componentPivot (U state); a new selection drops it', async () => {
    const s = await scene();
    await tool(s, 'move');
    await pick(s, 'vertex', [0]);
    await run(s.app, 'model.pivot.editToggle');
    s.rig.frame();
    const tx = handle(s, 'tx');
    const steps = labels(s.app).length;
    drag(element(s), tx, { x: tx.x + 40, y: tx.y });
    await expect.poll(() => s.app.session.getState().model.componentPivot).not.toBeNull();
    expect(labels(s.app)).toHaveLength(steps);
    await run(s.app, 'model.pivot.editToggle');
    await run(s.app, 'select.components', { mesh: s.cube, kind: 'vertex', indices: [1], mode: 'replace' });
    await expect.poll(() => s.app.session.getState().model.componentPivot).toBeNull();
  });
});

describe('soft selection (§5.15)', () => {
  it('pushes the weights to the display; B+LMB drag scales the radius (no tap toggle behind it)', async () => {
    const s = await scene({
      data: primitive('plane', { width: 4, height: 4, subdivisionsWidth: 8, subdivisionsHeight: 8 }),
    });
    const display = modelSelectOf(s.app)?.display;
    if (display === undefined) throw new Error('no display');
    const pushed = vi.spyOn(display, 'setSoftWeights');
    await tool(s, 'move');
    await pick(s, 'vertex', [40]);
    await run(s.app, 'model.softSelect.set', { on: true, radius: 1 });
    await expect.poll(() => pushed.mock.calls.some(([mesh, w]) => mesh === s.cube && w !== null)).toBe(true);
    expect(key(s, 'KeyB', 'down')).toBe(false); // observed: the keymap's tap toggles soft select
    drag(element(s), { x: 300, y: 300 }, { x: 400, y: 300 });
    expect(key(s, 'KeyB', 'up')).toBe(true); // a B+drag release is no tap
    await expect.poll(() => s.app.session.getState().model.softSelect.radius).toBeCloseTo(2, 6);
    expect(transformReadout(s.app)?.ring ?? null).toBeNull();
  });
});

describe('symmetry through the UI path (§5.14, P10)', () => {
  /** A cube cut once across X: the seam (x = 0) holds a ring of vertices on the mirror plane. */
  const SEAMED = (): MeshData => primitive('cube', { subdivisionsWidth: 2 });
  const P10 = 1e-6;

  /** Each vertex's mirror partner across x = 0 in a symmetric rest pose (a seam vertex is its own). */
  function partnersX(p: readonly number[][]): number[] {
    return p.map((q) => p.findIndex((r) => near(r[0], -(q[0] ?? 0)) && near(r[1], q[1] ?? 0) && near(r[2], q[2] ?? 0)));
  }

  /** P10: every vertex mirrors its rest partner within 1e-6 m; seam vertices stay exactly on x = 0. */
  function expectSymmetricX(q: readonly number[][], partner: readonly number[]): void {
    partner.forEach((w, v) => {
      expect(w).toBeGreaterThanOrEqual(0);
      const a = q[v] ?? [];
      const b = q[w] ?? [];
      expect(Math.abs((a[0] ?? 0) + (b[0] ?? 0))).toBeLessThanOrEqual(P10);
      expect(Math.abs((a[1] ?? 0) - (b[1] ?? 0))).toBeLessThanOrEqual(P10);
      expect(Math.abs((a[2] ?? 0) - (b[2] ?? 0))).toBeLessThanOrEqual(P10);
    });
    const seam = partner.flatMap((w, v) => (w === v ? [v] : []));
    expect(seam.map((v) => Math.abs(q[v]?.[0] ?? Number.NaN))).toEqual(seam.map(() => 0));
  }

  /** The cube in Object X, the given tool, its rest positions and partners. */
  async function mirrored(
    t: 'move' | 'rotate' | 'scale',
    data?: MeshData,
  ): Promise<{ s: Scene; rest: number[][]; partner: number[] }> {
    const s = await scene(data === undefined ? {} : { data });
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.cube] } });
    await run(s.app, 'model.symmetry.set', { mode: 'object-x' });
    await tool(s, t);
    const rest = positions(s.app, s.cube);
    return { s, rest, partner: partnersX(rest) };
  }

  const at = (p: readonly number[][], x: number, y: number, z: number): number =>
    p.findIndex((q) => near(q[0], x) && near(q[1], y) && near(q[2], z));
  const moved = (a: readonly number[][], b: readonly number[][]): number[] =>
    a.flatMap((q, v) => (q.some((x, k) => x !== b[v]?.[k]) ? [v] : []));

  it('a vertex moved along +X under Object X moves its partner along −X', async () => {
    const { s, rest, partner } = await mirrored('move');
    const v = at(rest, 0.5, 0.5, 0.5);
    const mirror = at(rest, -0.5, 0.5, 0.5);
    await pick(s, 'vertex', [v]);
    const steps = labels(s.app).length;
    const tx = handle(s, 'tx');
    drag(element(s), tx, { x: tx.x + 30, y: tx.y });
    await settled(s.app, steps + 1);
    const q = positions(s.app, s.cube);
    const dx = (q[v]?.[0] ?? 0) - 0.5;
    expect(dx).toBeGreaterThan(0);
    expect(Math.abs((q[mirror]?.[0] ?? 0) - (-0.5 - dx))).toBeLessThanOrEqual(P10);
    expect(q[mirror]?.[1]).toBe(rest[mirror]?.[1]);
    expect(moved(q, rest).sort((a, b) => a - b)).toEqual([v, mirror].sort((a, b) => a - b));
    expectSymmetricX(q, partner);
  });

  it('rotates the +X side about its centre and the −X side about the mirrored pivot (S·R·S)', async () => {
    const { s, rest, partner } = await mirrored('rotate', SEAMED());
    const side = rest.flatMap((q, v) => (near(q[0], 0.5) ? [v] : []));
    expect(side).toHaveLength(4);
    await pick(s, 'vertex', side);
    const steps = labels(s.app).length;
    const ring = handle(s, 'rz');
    drag(element(s), ring, { x: ring.x + 30, y: ring.y + 10 });
    await settled(s.app, steps + 1);
    expect(labels(s.app).at(-1)).toBe('Rotate');
    const q = positions(s.app, s.cube);
    expect(moved(q, rest)).toHaveLength(8); // the picked side and its mirror; the seam ring stays
    expectSymmetricX(q, partner);
  });

  it('scales the +X side along one axis and the −X side by the mirrored scale', async () => {
    const { s, rest, partner } = await mirrored('scale', SEAMED());
    const side = rest.flatMap((q, v) => (near(q[0], 0.5) ? [v] : []));
    await pick(s, 'vertex', side);
    const steps = labels(s.app).length;
    const sy = handle(s, 'sy');
    drag(element(s), sy, { x: sy.x, y: sy.y - 30 });
    await settled(s.app, steps + 1);
    expect(labels(s.app).at(-1)).toBe('Scale');
    const q = positions(s.app, s.cube);
    const top = at(rest, 0.5, 0.5, 0.5);
    expect(q[top]?.[1]).toBeGreaterThan(0.5);
    expect(q[top]?.[0]).toBe(rest[top]?.[0]); // along Y only
    expect(moved(q, rest)).toHaveLength(8);
    expectSymmetricX(q, partner);
  });

  it('soft select under symmetry: both sides take their weights, the seam keeps x = 0', async () => {
    const { s, rest, partner } = await mirrored('move', SEAMED());
    await run(s.app, 'model.softSelect.set', { on: true, radius: 0.8 });
    const v = at(rest, 0.5, 0.5, 0.5);
    const seam = at(rest, 0, 0.5, 0.5);
    await pick(s, 'vertex', [v]);
    const steps = labels(s.app).length;
    const grab = handle(s, 'tview');
    drag(element(s), grab, { x: grab.x + 25, y: grab.y - 15 });
    await settled(s.app, steps + 1);
    const q = positions(s.app, s.cube);
    // The seam vertex is 0.5 m from the pick: it moves (in the plane) by its weight.
    expect(Math.abs((q[seam]?.[1] ?? 0) - 0.5) + Math.abs((q[seam]?.[2] ?? 0) - 0.5)).toBeGreaterThan(1e-4);
    expect(moved(q, rest).length).toBeGreaterThan(2);
    expectSymmetricX(q, partner);
  });

  /** The stored picks of `kind` and the counts B10's HUD shows ("1 (+1 sym)"). */
  function picksOf(s: Scene, kind: 'vertex' | 'face'): { picks: number[]; selected: number; mirrored: number } {
    const sel = s.app.components.get(s.cube, kind);
    const set = kind === 'vertex' ? sel.verts : sel.faces;
    const counts = componentInternals(s.app.components)?.counts([s.cube]);
    return {
      picks: [...set.toArray()],
      selected: counts?.selected[kind] ?? -1,
      mirrored: counts?.mirrored[kind] ?? -1,
    };
  }

  /** Whether the manipulator's grab point sits on the projection of a world point (within half a pixel). */
  function manipulatorOn(s: Scene, world: readonly number[]): boolean {
    const at = s.rig.vm.project(PANE, [world[0] ?? 0, world[1] ?? 0, world[2] ?? 0]);
    const grab = handle(s, 'tview');
    return near(grab.x, at?.x ?? Number.NaN, 0.5) && near(grab.y, at?.y ?? Number.NaN, 0.5);
  }

  /** A drag of `h` by `px` pixels along the screen direction of the world axis `axis` from the pivot `from`. */
  function dragAlong(s: Scene, h: string, from: readonly number[], axis: readonly number[], px: number): void {
    const a = s.rig.vm.project(PANE, [from[0] ?? 0, from[1] ?? 0, from[2] ?? 0]);
    const b = s.rig.vm.project(PANE, [
      (from[0] ?? 0) + (axis[0] ?? 0),
      (from[1] ?? 0) + (axis[1] ?? 0),
      (from[2] ?? 0) + (axis[2] ?? 0),
    ]);
    if (a === null || b === null) throw new Error('axis not visible');
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const grab = handle(s, h);
    drag(element(s), grab, { x: grab.x + ((b.x - a.x) / len) * px, y: grab.y + ((b.y - a.y) / len) * px });
  }

  it('two symmetric vertex drags in a row: the picks stay [v] (+1 sym) and the manipulator follows the pick', async () => {
    const { s, rest, partner } = await mirrored('move');
    const v = at(rest, 0.5, 0.5, 0.5);
    const mirror = at(rest, -0.5, 0.5, 0.5);
    await pick(s, 'vertex', [v]);
    expect(picksOf(s, 'vertex')).toEqual({ picks: [v], selected: 1, mirrored: 1 });
    expect(manipulatorOn(s, [0.5, 0.5, 0.5])).toBe(true);
    const steps = labels(s.app).length;
    const ty = handle(s, 'ty');
    drag(element(s), ty, { x: ty.x, y: ty.y - 30 });
    await settled(s.app, steps + 1);
    const first = positions(s.app, s.cube);
    const dy1 = (first[v]?.[1] ?? 0) - 0.5;
    expect(dy1).toBeGreaterThan(0);
    // The run expanded the picks for the op; the selection stays the user's pick.
    expect(picksOf(s, 'vertex')).toEqual({ picks: [v], selected: 1, mirrored: 1 });
    s.rig.frame();
    expect(manipulatorOn(s, first[v] ?? [])).toBe(true);
    // The second drag starts from the pick (not from the pick and its partner, whose pivot is on the mirror plane).
    const ty2 = handle(s, 'ty');
    drag(element(s), ty2, { x: ty2.x, y: ty2.y - 30 });
    await settled(s.app, steps + 2);
    const second = positions(s.app, s.cube);
    expect((second[v]?.[1] ?? 0) - (first[v]?.[1] ?? 0)).toBeGreaterThan(0);
    expect(second[v]?.[0]).toBe(rest[v]?.[0]);
    expect(second[v]?.[2]).toBe(rest[v]?.[2]);
    expect(moved(second, rest).sort((a, b) => a - b)).toEqual([v, mirror].sort((a, b) => a - b));
    expectSymmetricX(second, partner);
    expect(picksOf(s, 'vertex')).toEqual({ picks: [v], selected: 1, mirrored: 1 });
    s.rig.frame();
    expect(manipulatorOn(s, second[v] ?? [])).toBe(true);
    // Undo and redo bring back each revision with the pick.
    s.app.history.undo();
    await expect.poll(() => positions(s.app, s.cube)).toEqual(first);
    await expect.poll(() => picksOf(s, 'vertex').picks).toEqual([v]);
    s.app.history.undo();
    await expect.poll(() => positions(s.app, s.cube)).toEqual(rest);
    await expect.poll(() => picksOf(s, 'vertex').picks).toEqual([v]);
    s.app.history.redo();
    await expect.poll(() => positions(s.app, s.cube)).toEqual(first);
    await expect.poll(() => picksOf(s, 'vertex').picks).toEqual([v]);
  });

  it('the second Component-space drag of a +X face still moves along the face normal', async () => {
    const { s, rest, partner } = await mirrored('move');
    const data = s.app.meshes.get(s.cube)?.data();
    if (data === null || data === undefined) throw new Error('no data');
    const faceVerts = (f: number): number[] => {
      const out: number[] = [];
      const start = data.faceCorner[f] as number;
      let c = start;
      do {
        out.push(data.cornerVert[c] as number);
        c = data.cornerNext[c] as number;
      } while (c !== start);
      return out;
    };
    let face = -1;
    for (let f = 0; f < data.counts.faces; f++) {
      if (faceVerts(f).every((w) => near(rest[w]?.[0], 0.5))) face = f;
    }
    expect(face).toBeGreaterThanOrEqual(0);
    const verts = faceVerts(face);
    setComponentSpace(s.app, 'move', true);
    await pick(s, 'face', [face]);
    const normal = (): number[] | undefined => s.rig.vm.manipulatorAxes()?.[2]?.map((x) => Math.round(x * 1e6) / 1e6);
    expect(normal()).toEqual([1, 0, 0]);
    const steps = labels(s.app).length;
    dragAlong(s, 'tz', [0.5, 0, 0], [1, 0, 0], 30);
    await settled(s.app, steps + 1);
    const first = positions(s.app, s.cube);
    const dx1 = (first[verts[0] ?? 0]?.[0] ?? 0) - 0.5;
    expect(dx1).toBeGreaterThan(0);
    expect(picksOf(s, 'face')).toEqual({ picks: [face], selected: 1, mirrored: 1 });
    s.rig.frame();
    // The Component frame is the pick's: Z still along +X, the pivot on the moved face.
    expect(normal()).toEqual([1, 0, 0]);
    expect(manipulatorOn(s, [0.5 + dx1, 0, 0])).toBe(true);
    dragAlong(s, 'tz', [0.5 + dx1, 0, 0], [1, 0, 0], 30);
    await settled(s.app, steps + 2);
    const second = positions(s.app, s.cube);
    for (const w of verts) {
      expect((second[w]?.[0] ?? 0) - (first[w]?.[0] ?? 0)).toBeGreaterThan(0);
      expect(near(second[w]?.[1], rest[w]?.[1] ?? Number.NaN, 1e-6)).toBe(true);
      expect(near(second[w]?.[2], rest[w]?.[2] ?? Number.NaN, 1e-6)).toBe(true);
    }
    expectSymmetricX(second, partner);
    expect(picksOf(s, 'face')).toEqual({ picks: [face], selected: 1, mirrored: 1 });
  });

  it('a seam vertex dragged in the view plane stays exactly on x = 0 (Preserve Seam)', async () => {
    const { s, rest, partner } = await mirrored('move', SEAMED());
    expect(s.app.session.getState().model.symmetry.get(s.cube)?.preserveSeam).toBe(true);
    const seam = at(rest, 0, 0.5, 0.5);
    await pick(s, 'vertex', [seam]);
    const steps = labels(s.app).length;
    const grab = handle(s, 'tview');
    drag(element(s), grab, { x: grab.x + 25, y: grab.y - 15 });
    await settled(s.app, steps + 1);
    const q = positions(s.app, s.cube);
    expect(Math.abs(q[seam]?.[0] ?? Number.NaN)).toBe(0);
    expect(moved(q, rest)).toEqual([seam]);
    expectSymmetricX(q, partner);
  });
});

/** World matrix of a mesh's placement (used by the object tests). */
export function worldOf(app: EditorApp, mesh: MeshId): Mat4 {
  return mat4Compose(app.store.get('meshes', mesh)?.placement ?? { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
}
