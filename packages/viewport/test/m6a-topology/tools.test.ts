// B12b (M6A-SPEC §5.8–§5.12, §5.10 modal tool contract) on a real viewport: the tool state machines — RMB never
// cancels (it completes Multi-Cut, is ignored while sliding or welding), `Esc` leaves no step, a `contextmenu` event
// alone completes nothing, `Backspace` removes a Multi-Cut point, `Ctrl`-click inserts a loop; the Insert Edge Loop
// hover preview and slide; Target Weld's target and centre modes; the Slide tool's rail pick and percent; the extrude
// manipulator (shown with a session, its handles absorbed into the extrude's args, the local/world toggle, `Esc`
// during the first drag ends the session with the zero-drop) and the Inset value handle.
import type { MeshId, MeshRecord, MeshRef } from '@ekza-animator/doc';
import {
  type EditorApp,
  historyLabels,
  loadExtrudeEngine,
  loadMeshKernel,
  registerBuiltinOperators,
} from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { type MeshData, primitive, writeRevision } from '@ekza-animator/mesh-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ModelSelectRuntime, modelSelectOf } from '../../src';
import {
  extrudeGrabPoint,
  isExtrudeHandle,
  pickExtrudeHandle,
  worldPerPixel,
} from '../../src/manipulators/extrude/geometry';
import { PaneProjector } from '../../src/picking/geometry';
import { snapT } from '../../src/tools/model/multicut/tool';
import { pickRail, slidePercent } from '../../src/tools/model/slide/tool';
import { loadTopologyKit, topologyManipulatorPoint } from '../../src/tools/model/topology';
import { createRig, pointer, type Rig } from '../helpers';

const PANE = 'pane-single';
let rig: Rig | null = null;

beforeAll(async () => {
  await Promise.all([loadMeshKernel(), loadExtrudeEngine(), loadTopologyKit()]);
});

afterEach(() => {
  rig?.dispose();
  rig = null;
  vi.restoreAllMocks();
});

function createMesh(app: EditorApp, id: string, data: MeshData): MeshId {
  const out = writeRevision(data);
  for (const [, chunk] of out.newChunks) app.blobs.put(chunk);
  app.blobs.put(out.manifestBytes);
  const ref: MeshRef = { manifest: out.manifestId, rev: 1, base: null, joints: [] };
  const record: MeshRecord = {
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
  };
  app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', record));
  return id as MeshId;
}

interface Scene {
  readonly rig: Rig;
  readonly app: FakeEditorApp;
  readonly runtime: ModelSelectRuntime;
  readonly mesh: MeshId;
}

/** One pane in Model looking at `data` from `view` (a cube from the front, a plane from the top). */
async function scene(data: MeshData, view: 'front' | 'top' | 'persp' = 'front'): Promise<Scene> {
  const app = createFakeEditorApp();
  registerBuiltinOperators(app);
  app.session.setState({ workspace: 'model' });
  const r = await createRig({ app });
  rig = r;
  r.layout('single', { camera: () => ({ kind: 'view', preset: view }), display: { shading: 'shaded' } });
  const mesh = createMesh(app, 'msh_Mesh', data);
  await expect.poll(() => modelSelectOf(app), { timeout: 15_000 }).not.toBeNull();
  const runtime = modelSelectOf(app) as ModelSelectRuntime;
  r.vm.frame(PANE, 'all');
  r.frame();
  return { rig: r, app, runtime, mesh };
}

async function run(app: EditorApp, op: string, args?: unknown, ctx?: Parameters<EditorApp['runUntyped']>[2]) {
  const result = await app.runUntyped(op, args, ctx);
  expect([op, result.status]).toEqual([op, 'finished']);
  return result;
}

async function tool(s: Scene, id: string): Promise<void> {
  s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.mesh] } });
  await run(s.app, 'view.tool', { panel: 'viewport', tool: id });
  s.rig.frame();
  // The tool's components draw once the hilite (§5.6 component tools in object mode) reaches the display.
  await expect.poll(() => s.runtime.screenOf(s.mesh, 'edge', 0, PANE)).not.toBeNull();
}

function element(s: Scene): HTMLElement {
  const pane = s.rig.panes.get(PANE);
  if (pane === undefined) throw new Error('no pane');
  return pane;
}

function at(s: Scene, kind: 'vertex' | 'edge' | 'face', index: number, t?: number): { x: number; y: number } {
  const p = s.runtime.screenOf(s.mesh, kind, index, PANE, t);
  if (p === null) throw new Error(`${kind} ${index} is not visible`);
  return p;
}

function click(s: Scene, p: { x: number; y: number }, init?: PointerEventInit): void {
  pointer(element(s), 'pointerdown', p.x, p.y, init);
  pointer(element(s), 'pointerup', p.x, p.y, init);
}

function drag(s: Scene, from: { x: number; y: number }, to: { x: number; y: number }, init?: PointerEventInit): void {
  const button = init?.button ?? 0;
  pointer(element(s), 'pointerdown', from.x, from.y, init);
  for (let i = 1; i <= 6; i++) {
    pointer(element(s), 'pointermove', from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6, {
      ...init,
      buttons: 1 << (button === 1 ? 2 : button === 2 ? 1 : 0),
    });
  }
  pointer(element(s), 'pointerup', to.x, to.y, init);
}

const counts = (s: Scene): string => {
  const c = s.app.meshes.get(s.mesh)?.data()?.counts;
  return c === undefined ? 'none' : `${c.points}/${c.edges}/${c.faces}`;
};

const labels = (app: EditorApp): readonly string[] => historyLabels(app.history).undo;

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** The edges of a mesh's data by their ends. */
function edgesOf(data: MeshData): { e: number; a: number[]; b: number[] }[] {
  const out: { e: number; a: number[]; b: number[] }[] = [];
  const p = data.position;
  for (let e = 0; e < data.counts.edges; e++) {
    const va = data.edgeVerts[2 * e] as number;
    const vb = data.edgeVerts[2 * e + 1] as number;
    out.push({
      e,
      a: [p[3 * va] as number, p[3 * va + 1] as number, p[3 * va + 2] as number],
      b: [p[3 * vb] as number, p[3 * vb + 1] as number, p[3 * vb + 2] as number],
    });
  }
  return out;
}

/** The 2 × 1 plane of E2E-MOD-05 (6/7/2, in XZ) and its three Z edges (x = −1, 0, 1). */
function twoQuads(): { data: MeshData; zEdges: number[] } {
  const data = primitive('plane', { width: 2, height: 1, subdivisionsWidth: 2, subdivisionsHeight: 1 });
  const zEdges = [-1, 0, 1].map((x) => {
    const edge = edgesOf(data).find((g) => Math.abs((g.a[0] ?? 9) - x) < 1e-6 && Math.abs((g.b[0] ?? 9) - x) < 1e-6);
    if (edge === undefined) throw new Error(`no Z edge at x = ${x}`);
    return edge.e;
  });
  return { data, zEdges };
}

describe('pure helpers', () => {
  it('snapT snaps to the step and clamps; pickRail follows the drag; slidePercent clamps to ±1', () => {
    expect(snapT(0.37, 0.25)).toBe(0.25);
    expect(snapT(0.9, 0.25)).toBe(1);
    expect(snapT(0.37, 0)).toBe(0.37);
    const rails = [
      { rail: 3, dx: 0, dy: -40 },
      { rail: 7, dx: 0, dy: 40 },
      { rail: 9, dx: 40, dy: 0 },
    ];
    expect(pickRail(rails, 1, -10)?.rail).toBe(3);
    expect(pickRail(rails, 0, 5)?.rail).toBe(7);
    expect(slidePercent({ dx: 0, dy: -40 }, 0, -12)).toBeCloseTo(0.3, 12);
    expect(slidePercent({ dx: 0, dy: -40 }, 0, -80)).toBe(1);
    expect(slidePercent({ dx: 0, dy: -40 }, 0, 80)).toBe(-1);
  });
});

describe('Multi-Cut (§5.11; the modal tool contract §5.10)', () => {
  it('three clicks then RMB: one "Multi-Cut" step; a contextmenu event alone completes nothing', async () => {
    const { data, zEdges } = twoQuads();
    const s = await scene(data, 'top');
    await tool(s, 'multiCut');
    const base = labels(s.app).length;
    for (const e of zEdges) click(s, at(s, 'edge', e, 0.5));
    expect(s.rig.vm.activeTool()?.phase?.()).toBe('placing');
    element(s).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    await settle();
    expect(counts(s)).toBe('6/7/2');
    // RMB (pointer-down button 2) completes.
    click(s, at(s, 'edge', zEdges[2] as number, 0.5), { button: 2 });
    await settle();
    expect(counts(s)).toBe('9/12/4');
    expect(labels(s.app).slice(base)).toEqual(['Multi-Cut']);
    expect(s.app.session.getState().lastRun).toMatchObject({ id: 'mesh.cut', source: 'tool', tool: 'multiCut' });
    expect(s.rig.vm.activeTool()?.phase?.()).toBe('idle');
  });

  it('Esc leaves no step; Backspace removes the last point; Enter completes', async () => {
    const { data, zEdges } = twoQuads();
    const s = await scene(data, 'top');
    await tool(s, 'multiCut');
    const active = s.rig.vm.activeTool();
    const key = (code: string): boolean | undefined =>
      active?.key?.({ type: 'down', code, shift: false, alt: false, mod: false, ctrl: false, repeat: false });
    click(s, at(s, 'edge', zEdges[0] as number, 0.5));
    click(s, at(s, 'edge', zEdges[1] as number, 0.5));
    expect(key('Escape')).toBe(true);
    await settle();
    expect(counts(s)).toBe('6/7/2');
    expect(labels(s.app)).toEqual(['Create']);
    // Backspace: the third point goes; Enter cuts the two-point path (across the left quad).
    for (const e of zEdges) click(s, at(s, 'edge', e, 0.5));
    expect(key('Backspace')).toBe(true);
    expect(key('Enter')).toBe(true);
    await settle();
    expect(counts(s)).toBe('8/10/3');
    // Idle: the reserved keys are not the tool's (Backspace then deletes through the keymap).
    expect(key('Backspace')).toBe(false);
  });

  it('a point on a face the path does not cross is refused with the help line', async () => {
    const { data, zEdges } = twoQuads();
    const s = await scene(data, 'top');
    await tool(s, 'multiCut');
    const said: string[] = [];
    const { onModelHelp } = await import('@ekza-animator/editor-core');
    onModelHelp(s.app, (m) => said.push(m.text));
    click(s, at(s, 'edge', zEdges[0] as number, 0.5));
    click(s, at(s, 'edge', zEdges[2] as number, 0.5));
    expect(said).toContain('Click on each face the cut crosses');
    expect(s.rig.vm.activeTool()?.phase?.()).toBe('placing');
  });

  it('Ctrl-click inserts an edge loop at the cursor: one "Insert Edge Loop" step, the tool stays', async () => {
    const { data } = twoQuads();
    const s = await scene(data, 'top');
    await tool(s, 'multiCut');
    // An X edge of the plane (along X on z = −0.5): its ring crosses the left quad.
    const xEdge = edgesOf(data).find(
      (g) =>
        Math.abs((g.a[2] ?? 0) + 0.5) < 1e-6 &&
        Math.abs((g.b[2] ?? 0) + 0.5) < 1e-6 &&
        Math.max(g.a[0] ?? 0, g.b[0] ?? 0) <= 1e-6,
    );
    if (xEdge === undefined) throw new Error('no X edge');
    click(s, at(s, 'edge', xEdge.e, 0.5), { ctrlKey: true });
    await settle();
    expect(counts(s)).toBe('8/10/3');
    expect(labels(s.app).at(-1)).toBe('Insert Edge Loop');
    expect(s.app.session.getState().tools.viewport).toBe('multiCut');
  });
});

describe('Insert Edge Loop (§5.11)', () => {
  it('hover previews the loop; press, slide, release places it; Esc while sliding leaves no step', async () => {
    const s = await scene(primitive('cube', {}), 'front');
    await tool(s, 'insertLoop');
    // The front face's bottom edge (a ring round the cube's four sides).
    const front = edgesOf(primitive('cube', {})).find(
      (g) => (g.a[2] ?? 0) > 0.49 && (g.b[2] ?? 0) > 0.49 && (g.a[1] ?? 0) < -0.49 && (g.b[1] ?? 0) < -0.49,
    );
    if (front === undefined) throw new Error('no front bottom edge');
    const p = at(s, 'edge', front.e, 0.3);
    pointer(element(s), 'pointermove', p.x, p.y);
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, buttons: 0 }));
    // Esc while pressed: nothing.
    pointer(element(s), 'pointerdown', p.x, p.y);
    expect(s.rig.vm.activeTool()?.phase?.()).toBe('placing');
    // RMB while sliding is ignored (never a cancel, never a menu).
    pointer(element(s), 'pointerdown', p.x, p.y, { button: 2 });
    expect(s.rig.vm.activeTool()?.phase?.()).toBe('placing');
    s.rig.vm
      .activeTool()
      ?.key?.({ type: 'down', code: 'Escape', shift: false, alt: false, mod: false, ctrl: false, repeat: false });
    pointer(element(s), 'pointerup', p.x, p.y);
    await settle();
    expect(counts(s)).toBe('8/12/6');
    // Press at 0.3, slide to 0.6, release: one loop at the slid weight.
    const q = at(s, 'edge', front.e, 0.6);
    drag(s, p, q);
    await settle();
    expect(counts(s)).toBe('12/20/10');
    const last = s.app.session.getState().lastRun;
    expect(last).toMatchObject({ id: 'mesh.insertLoop', source: 'tool', tool: 'insertLoop' });
    expect(Number(last?.args['weight'])).toBeCloseTo(0.6, 3);
  });
});

describe('Target Weld (§5.12)', () => {
  it('a drag onto a neighbour welds at the target; MMB welds at the centre; Esc and empty drops do nothing', async () => {
    const s = await scene(primitive('cube', {}), 'front');
    await tool(s, 'targetWeld');
    const cube = primitive('cube', {});
    const front = edgesOf(cube).find(
      (g) => (g.a[2] ?? 0) > 0.49 && (g.b[2] ?? 0) > 0.49 && (g.a[1] ?? 0) > 0.49 && (g.b[1] ?? 0) > 0.49,
    );
    if (front === undefined) throw new Error('no front top edge');
    const va = cube.edgeVerts[2 * front.e] as number;
    const vb = cube.edgeVerts[2 * front.e + 1] as number;
    const pa = at(s, 'vertex', va);
    const pb = at(s, 'vertex', vb);
    // Esc during the drag.
    pointer(element(s), 'pointerdown', pa.x, pa.y);
    pointer(element(s), 'pointermove', pb.x, pb.y, { buttons: 1 });
    s.rig.vm
      .activeTool()
      ?.key?.({ type: 'down', code: 'Escape', shift: false, alt: false, mod: false, ctrl: false, repeat: false });
    pointer(element(s), 'pointerup', pb.x, pb.y);
    // A drop on empty space.
    drag(s, pa, { x: pa.x + 300, y: pa.y + 200 });
    await settle();
    expect(counts(s)).toBe('8/12/6');
    // MMB: the midpoint.
    drag(s, pa, pb, { button: 1 });
    await settle();
    expect(counts(s)).toBe('7/11/6');
    expect(s.app.session.getState().lastRun?.args['mode']).toBe('center');
    const ps = s.app.meshes.get(s.mesh)?.data()?.position ?? new Float32Array();
    const mid = [(cube.position[3 * va] as number) / 2 + (cube.position[3 * vb] as number) / 2, 0.5, 0.5];
    let found = false;
    for (let v = 0; v < ps.length / 3; v++) {
      if (
        Math.hypot(
          (ps[3 * v] as number) - (mid[0] as number),
          (ps[3 * v + 1] as number) - 0.5,
          (ps[3 * v + 2] as number) - 0.5,
        ) < 1e-6
      )
        found = true;
    }
    expect(found).toBe(true);
  });
});

describe('the extrude manipulator (§5.8) and the value handle (§5.9)', () => {
  async function extruded(): Promise<Scene> {
    const cube = primitive('cube', {});
    const s = await scene(cube, 'persp');
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.mesh] } });
    await run(s.app, 'select.mode', { mode: 'face' });
    const top = [...Array(cube.counts.faces).keys()].find((f) => {
      let y = 0;
      let n = 0;
      const first = cube.faceCorner[f] as number;
      let c = first;
      do {
        y += cube.position[3 * (cube.cornerVert[c] as number) + 1] as number;
        n++;
        c = cube.cornerNext[c] as number;
      } while (c !== first);
      return y / n > 0.49;
    });
    await run(s.app, 'select.components', { mesh: s.mesh, kind: 'face', indices: [top], mode: 'replace' });
    await run(s.app, 'mesh.extrude', {}, { source: 'keyboard', paneId: PANE });
    await settle();
    s.rig.frame();
    return s;
  }

  it('shows on the cap with the session; every handle grab point picks its handle', async () => {
    const s = await extruded();
    expect(s.app.session.getState().tools.viewport).toBe('extrude');
    for (const handle of ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz', 'suniform'] as const) {
      const p = topologyManipulatorPoint(s.rig.vm, PANE, handle);
      expect([handle, p !== null]).toEqual([handle, true]);
      const view = s.rig.vm.paneView(PANE);
      if (view === null || p === null) continue;
      const projector = new PaneProjector().set(view.camera, view.width, view.height, 0.01);
      const frame = (await import('@ekza-animator/editor-core')).extrudeManipulatorFrame(s.app);
      if (frame === null) throw new Error('no frame');
      const k =
        worldPerPixel(view.camera, view.height, projector, frame.pivot) *
        s.app.session.getState().tools.manipulatorSize;
      expect([handle, pickExtrudeHandle(frame, k, projector, p.x, p.y)]).toEqual([handle, handle]);
      expect(extrudeGrabPoint(frame, handle, k, projector)).not.toBeNull();
    }
    expect(isExtrudeHandle('tview')).toBe(false);
  });

  it('a tz drag absorbs into localTranslateZ (one step); Esc during the first drag ends with the zero-drop', async () => {
    const s = await extruded();
    const steps = labels(s.app).length;
    const tz = topologyManipulatorPoint(s.rig.vm, PANE, 'tz');
    if (tz === null) throw new Error('no tz');
    // Esc during the first drag: the drag is cancelled, the session ends and its zero extrude goes.
    pointer(element(s), 'pointerdown', tz.x, tz.y);
    pointer(element(s), 'pointermove', tz.x, tz.y - 20, { buttons: 1 });
    s.rig.vm
      .activeTool()
      ?.key?.({ type: 'down', code: 'Escape', shift: false, alt: false, mod: false, ctrl: false, repeat: false });
    pointer(element(s), 'pointerup', tz.x, tz.y - 20);
    await settle();
    expect(s.app.extrude.state).toBeNull();
    expect(counts(s)).toBe('8/12/6');
    expect(s.app.session.getState().tools.viewport).toBe('select');

    const t = await extruded();
    const handle = topologyManipulatorPoint(t.rig.vm, PANE, 'tz');
    if (handle === null) throw new Error('no tz');
    drag(t, handle, { x: handle.x, y: handle.y - 40 });
    await settle();
    expect(Number(t.app.session.getState().lastRun?.args['localTranslateZ'])).toBeGreaterThan(0);
    expect(labels(t.app).length).toBe(steps);
    expect(t.app.extrude.state?.stack).toHaveLength(2);
  });

  it('the toggle switches the handles between the cap and world axes', async () => {
    const s = await extruded();
    const { extrudeManipulatorFrame } = await import('@ekza-animator/editor-core');
    const frame = extrudeManipulatorFrame(s.app);
    const view = s.rig.vm.paneView(PANE);
    if (frame === null || view === null) throw new Error('no frame');
    const projector = new PaneProjector().set(view.camera, view.width, view.height, 0.01);
    const k =
      worldPerPixel(view.camera, view.height, projector, frame.pivot) * s.app.session.getState().tools.manipulatorSize;
    const p = extrudeGrabPoint(frame, 'space', k, projector);
    if (p === null) throw new Error('no toggle');
    click(s, p);
    expect(s.app.extrude.state?.manipSpace).toBe('world');
  });

  it('after an Inset the value handle drags its offset (the card preview, one adjust)', async () => {
    const cube = primitive('cube', {});
    const s = await scene(cube, 'persp');
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.mesh] } });
    await run(s.app, 'select.mode', { mode: 'face' });
    await run(s.app, 'select.components', { mesh: s.mesh, kind: 'face', indices: [0], mode: 'replace' });
    await run(s.app, 'view.tool', { panel: 'viewport', tool: 'select' });
    await run(s.app, 'mesh.inset', { offset: 0.1 }, { source: 'menu', paneId: PANE });
    await settle();
    s.rig.frame();
    expect(s.app.session.getState().tools.viewport).toBe('extrude');
    const steps = labels(s.app).length;
    const { topologyKit } = await import('../../src/tools/model/topology');
    const kit = topologyKit();
    if (kit === null) throw new Error('no kit');
    const pivot = kit.topologyRuntime(s.app, s.rig.vm).valueHandle.at;
    if (pivot === null) throw new Error('no value handle');
    const p = s.rig.vm.project(PANE, pivot);
    if (p === null) throw new Error('value handle off-screen');
    drag(s, { x: p.x + 20, y: p.y }, { x: p.x + 30, y: p.y });
    await settle();
    expect(Number(s.app.session.getState().lastRun?.args['offset'])).toBeCloseTo(0.2, 6);
    expect(labels(s.app).length).toBe(steps);
  });
});
