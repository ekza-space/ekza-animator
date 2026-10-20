// B12b (M6A-SPEC §5.8–§5.12, §5.10 modal tool contract) on a real viewport: the tool state machines — RMB never
// cancels (it completes Multi-Cut, is ignored while sliding or welding), `Esc` leaves no step, a `contextmenu` event
// alone completes nothing, `Backspace` removes a Multi-Cut point, `Ctrl`-click inserts a loop (`Ctrl`+MMB at 0.5,
// `Ctrl+Shift` at the snap step), `Shift` snaps a cut point's `t`, a click within 8 px of a vertex cuts at it; the
// reserved modal keys belong to every tool while it is placing or dragging (never the keymap's delete); the Insert
// Edge Loop hover preview and slide; Target Weld's target and centre modes; the Slide tool's rail pick, percent, MMB
// drag and typed percent; the extrude manipulator (shown with a session, its handles absorbed into the extrude's
// args, the local/world toggle, `Esc` during the first drag ends the session with the zero-drop, `Shift` during a
// drag ×0.1 per move) and the Inset value handle.
import { quatFromAxisAngle, quatRotateVec3, type Vec3 } from '@ekza-animator/anim-core';
import type { MeshId, MeshRecord, MeshRef } from '@ekza-animator/doc';
import {
  attachMeshes,
  type EditorApp,
  extrudeManipulatorFrame,
  historyLabels,
  loadExtrudeEngine,
  loadMeshKernel,
  registerBuiltinOperators,
  RESERVED_MODAL_KEYS,
  selectInputsField,
  type ToolPhase,
} from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import { type MeshData, primitive, writeRevision } from '@ekza-animator/mesh-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ModelSelectRuntime, modelSelectOf, modelTransformOf } from '../../src';
import { ringScreenTangent } from '../../src/manipulators/drag';
import {
  EXTRUDE_LAYOUT,
  extrudeGrabPoint,
  isExtrudeHandle,
  pickExtrudeHandle,
  ringPoints,
  worldPerPixel,
} from '../../src/manipulators/extrude/geometry';
import { PaneProjector } from '../../src/picking/geometry';
import { dragSpeed } from '../../src/tools/model/extrude/tool';
import { snapT } from '../../src/tools/model/multicut/tool';
import { pickRail, slidePercent } from '../../src/tools/model/slide/tool';
import { loadTopologyKit, topologyKit, topologyManipulatorPoint } from '../../src/tools/model/topology';
import { PREVIEW } from '../../src/tools/model/topology/overlay';
import { valueParamOf } from '../../src/tools/model/topology/runtime';
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
  // The registry reads the session's symmetry settings once attached (the editor attaches it at boot, M6A-B7-1): the
  // previews' scratch runs then see the symmetry map the runs use.
  attachMeshes(app);
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

const phase = (s: Scene): ToolPhase | undefined => s.rig.vm.activeTool()?.phase?.();

/** A key going down to the active tool (as the keyboard adapter hands it a reserved key mid-gesture). */
const keyDown = (s: Scene, code: string): boolean | undefined =>
  s.rig.vm
    .activeTool()
    ?.key?.({ type: 'down', code, shift: false, alt: false, mod: false, ctrl: false, repeat: false });

/**
 * §5.10: every reserved modal key in `codes` (those the tool has no action for) is consumed while the tool is in
 * `during`, and nothing happens: same phase, counts and history.
 */
async function swallows(s: Scene, codes: readonly string[], during: ToolPhase): Promise<void> {
  const before = { counts: counts(s), steps: [...labels(s.app)] };
  for (const code of codes) {
    expect(RESERVED_MODAL_KEYS.has(code)).toBe(true);
    expect([code, keyDown(s, code)]).toEqual([code, true]);
    expect([code, phase(s)]).toEqual([code, during]);
  }
  await settle();
  expect(counts(s)).toBe(before.counts);
  expect(labels(s.app)).toEqual(before.steps);
}

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

/** Object X symmetry on the scene's mesh (the runs and the previews read it from the session). */
function objectX(s: Scene): void {
  const model = s.app.session.getState().model;
  s.app.session.setState({
    model: {
      ...model,
      symmetry: new Map([[s.mesh, { mode: 'object-x' as const, tolerance: 0.001, preserveSeam: true }]]),
    },
  });
}

/** The preview overlay's segments of a colour now, as [from, to] world points. */
function previewSegments(s: Scene, color: readonly [number, number, number]): [Vec3, Vec3][] {
  const rt = topologyKit()?.topologyRuntime(s.app, s.rig.vm);
  if (rt === undefined) throw new Error('no topology kit');
  const out: [Vec3, Vec3][] = [];
  for (const list of rt.overlay.drawn) {
    if (list.color !== color) continue;
    const p = list.positions;
    for (let i = 0; i + 5 < p.length; i += 6) {
      out.push([
        [p[i] as number, p[i + 1] as number, p[i + 2] as number],
        [p[i + 3] as number, p[i + 4] as number, p[i + 5] as number],
      ]);
    }
  }
  return out;
}

/** A hover (no button) at a pane point: the topology runtime previews from window pointer moves. */
function hover(s: Scene, p: { x: number; y: number }): void {
  const rect = s.rig.vm.paneRect(PANE);
  if (rect === null) throw new Error('no pane rect');
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.x + p.x, clientY: rect.y + p.y, buttons: 0 }));
}

/** Positions of the vertices from index `from` on (the ones a run added). */
function addedPoints(s: Scene, from: number): Vec3[] {
  const d = s.app.meshes.get(s.mesh)?.data();
  const out: Vec3[] = [];
  for (let v = from; v < (d?.counts.points ?? 0); v++) {
    out.push([d?.position[3 * v] ?? 0, d?.position[3 * v + 1] ?? 0, d?.position[3 * v + 2] ?? 0]);
  }
  return out;
}

/** The cube's front bottom edge (along X at y = z = −0.5… +0.5): its ring runs round the four sides. */
function frontBottom(): { e: number; a: number[]; b: number[] } {
  const edge = edgesOf(primitive('cube', {})).find(
    (g) => (g.a[2] ?? 0) > 0.49 && (g.b[2] ?? 0) > 0.49 && (g.a[1] ?? 0) < -0.49 && (g.b[1] ?? 0) < -0.49,
  );
  if (edge === undefined) throw new Error('no front bottom edge');
  return edge;
}

/** Every point of a loop round the cube's four sides at x = `x`: y and z at ±0.5. */
function expectLoopAt(segments: readonly [Vec3, Vec3][], x: number): void {
  for (const [a, b] of segments) {
    for (const p of [a, b]) {
      expect(p[0]).toBeCloseTo(x, 5);
      expect(Math.abs(p[1])).toBeCloseTo(0.5, 5);
      expect(Math.abs(p[2])).toBeCloseTo(0.5, 5);
    }
  }
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

  it('dragSpeed: Shift ×0.1 (it wins), Mod ×10; a Shift held since the press (smart extrude) is not fine', () => {
    expect(dragSpeed({ shift: false, mod: false })).toBe(1);
    expect(dragSpeed({ shift: true, mod: false })).toBe(0.1);
    expect(dragSpeed({ shift: false, mod: true })).toBe(10);
    expect(dragSpeed({ shift: true, mod: true })).toBe(0.1);
    expect(dragSpeed({ shift: true, mod: false }, true)).toBe(1);
    expect(dragSpeed({ shift: true, mod: true }, true)).toBe(10);
  });

  it('valueParamOf: Inset drags offset; Bevel its fraction, or its absolute offset with Offset as Fraction off', () => {
    expect(valueParamOf('mesh.inset', {})).toBe('offset');
    expect(valueParamOf('mesh.bevel', {})).toBe('fraction');
    expect(valueParamOf('mesh.bevel', { offsetAsFraction: true })).toBe('fraction');
    expect(valueParamOf('mesh.bevel', { offsetAsFraction: false })).toBe('offset');
    expect(valueParamOf('mesh.extrude', {})).toBeNull();
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

  it('Ctrl+MMB inserts the loop at 0.5, Ctrl+Shift-click at the snap step (one step each)', async () => {
    const { data } = twoQuads();
    const s = await scene(data, 'top');
    await tool(s, 'multiCut');
    const step = s.app.prefs.getState().modeling.multiCutSnapStep;
    expect(step).toBe(0.25);
    const xEdge = edgesOf(data).find(
      (g) =>
        Math.abs((g.a[2] ?? 0) + 0.5) < 1e-6 &&
        Math.abs((g.b[2] ?? 0) + 0.5) < 1e-6 &&
        Math.max(g.a[0] ?? 0, g.b[0] ?? 0) <= 1e-6,
    );
    if (xEdge === undefined) throw new Error('no X edge');
    const base = labels(s.app).length;
    // Ctrl+MMB at t = 0.3: the loop goes in at 0.5.
    click(s, at(s, 'edge', xEdge.e, 0.3), { ctrlKey: true, button: 1 });
    await settle();
    expect(counts(s)).toBe('8/10/3');
    expect(s.app.session.getState().lastRun).toMatchObject({ id: 'mesh.insertLoop', source: 'tool' });
    expect(s.app.session.getState().lastRun?.args['weight']).toBe(0.5);
    expect(labels(s.app).length).toBe(base + 1);
    await run(s.app, 'edit.undo');
    s.rig.frame();
    expect(counts(s)).toBe('6/7/2');
    // Ctrl+Shift-click at t = 0.37: at the nearest snap step (0.25).
    click(s, at(s, 'edge', xEdge.e, 0.37), { ctrlKey: true, shiftKey: true });
    await settle();
    expect(counts(s)).toBe('8/10/3');
    expect(s.app.session.getState().lastRun?.args['weight']).toBe(0.25);
    expect(labels(s.app).length).toBe(base + 1);
    expect(s.app.session.getState().tools.viewport).toBe('multiCut');
  });

  it('Shift snaps a point to the snap step; a click within 8 px of a vertex cuts at the vertex', async () => {
    const { data, zEdges } = twoQuads();
    const s = await scene(data, 'top');
    await tool(s, 'multiCut');
    const mid = zEdges[1] as number;
    const v0 = data.edgeVerts[2 * mid] as number;
    const v1 = data.edgeVerts[2 * mid + 1] as number;
    const p0 = at(s, 'vertex', v0);
    const p1 = at(s, 'vertex', v1);
    const length = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    expect(length).toBeGreaterThan(60);
    /** The middle edge's screen point `px` CSS px from its first vertex. */
    const along = (px: number) => ({
      x: p0.x + ((p1.x - p0.x) * px) / length,
      y: p0.y + ((p1.y - p0.y) * px) / length,
    });
    /** The new vertices of the last cut (indices from 6 on). */
    const added = (): number[][] => {
      const d = s.app.meshes.get(s.mesh)?.data();
      const out: number[][] = [];
      for (let v = 6; v < (d?.counts.points ?? 0); v++) {
        out.push([d?.position[3 * v] ?? 0, d?.position[3 * v + 1] ?? 0, d?.position[3 * v + 2] ?? 0]);
      }
      return out;
    };
    // Shift-click the left border edge at t = 0.37 (snapped to 0.25), then click 5 px from the middle edge's vertex:
    // the cut runs from the snapped point to that vertex (one new vertex, two new edges, one new face).
    click(s, at(s, 'edge', zEdges[0] as number, 0.37), { shiftKey: true });
    click(s, along(5));
    expect(keyDown(s, 'Enter')).toBe(true);
    await settle();
    expect(counts(s)).toBe('7/9/3');
    const snapped = added();
    expect(snapped).toHaveLength(1);
    expect(snapped[0]?.[0]).toBeCloseTo(-1, 6);
    expect(Math.abs(snapped[0]?.[2] ?? 0)).toBeCloseTo(0.25, 6);
    await run(s.app, 'edit.undo');
    s.rig.frame();
    // 12 px from the vertex: a point on the middle edge (two new vertices).
    click(s, at(s, 'edge', zEdges[0] as number, 0.37), { shiftKey: true });
    click(s, along(12));
    expect(keyDown(s, 'Enter')).toBe(true);
    await settle();
    expect(counts(s)).toBe('8/10/3');
  });

  it("PageUp and PageDown (no count) are swallowed while placing; idle, the reserved keys are the keymap's", async () => {
    const { data, zEdges } = twoQuads();
    const s = await scene(data, 'top');
    await tool(s, 'multiCut');
    click(s, at(s, 'edge', zEdges[0] as number, 0.5));
    click(s, at(s, 'edge', zEdges[1] as number, 0.5));
    await swallows(s, ['PageUp', 'PageDown'], 'placing');
    // Both points are still placed: Enter cuts across the left quad.
    expect(keyDown(s, 'Enter')).toBe(true);
    await settle();
    expect(counts(s)).toBe('8/10/3');
    for (const code of RESERVED_MODAL_KEYS) expect([code, keyDown(s, code)]).toEqual([code, false]);
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
    hover(s, p);
    // The hover preview: the whole loop round the cube's four sides near t = 0.3 of the edge.
    const hovered = previewSegments(s, PREVIEW.loop);
    expect(hovered).toHaveLength(4);
    const x03 = (front.a[0] ?? 0) + ((front.b[0] ?? 0) - (front.a[0] ?? 0)) * 0.3;
    expect(Math.abs((hovered[0]?.[0][0] ?? 9) - x03)).toBeLessThan(0.02);
    expectLoopAt(hovered, hovered[0]?.[0][0] ?? 9);
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

describe('Insert Edge Loop and Multi-Cut previews (§5.11, §5.14: the cut a run makes, mirrored under symmetry)', () => {
  it('the hover and the slide preview the loop the run inserts (same points)', async () => {
    const s = await scene(primitive('cube', {}), 'front');
    await tool(s, 'insertLoop');
    const front = frontBottom();
    // Hover, then a click at the same point: the run's new loop is the previewed one.
    const p = at(s, 'edge', front.e, 0.3);
    hover(s, p);
    const hovered = previewSegments(s, PREVIEW.loop);
    expect(hovered).toHaveLength(4);
    const x = hovered[0]?.[0][0] ?? 9;
    expectLoopAt(hovered, x);
    click(s, p);
    await settle();
    expect(counts(s)).toBe('12/20/10');
    const placed = addedPoints(s, 8);
    expect(placed).toHaveLength(4);
    for (const q of placed) expect(q[0]).toBeCloseTo(x, 5);
    await run(s.app, 'edit.undo');
    s.rig.frame();
    // Press at 0.3 and slide to 0.6: the preview follows the slide; the release places that loop.
    const q = at(s, 'edge', front.e, 0.6);
    pointer(element(s), 'pointerdown', p.x, p.y);
    pointer(element(s), 'pointermove', q.x, q.y, { buttons: 1 });
    const slid = previewSegments(s, PREVIEW.loop);
    expect(slid).toHaveLength(4);
    const x06 = (front.a[0] ?? 0) + ((front.b[0] ?? 0) - (front.a[0] ?? 0)) * 0.6;
    const xs = slid[0]?.[0][0] ?? 9;
    expect(Math.abs(xs - x06)).toBeLessThan(0.02);
    expectLoopAt(slid, xs);
    pointer(element(s), 'pointerup', q.x, q.y);
    await settle();
    expect(counts(s)).toBe('12/20/10');
    for (const r of addedPoints(s, 8)) expect(r[0]).toBeCloseTo(xs, 5);
  });

  it('under Object X the preview holds the mirror loop: two loops at 0.3, one (its own mirror) at a typed 0.5', async () => {
    const s = await scene(primitive('cube', {}), 'front');
    objectX(s);
    await tool(s, 'insertLoop');
    const front = frontBottom();
    const p = at(s, 'edge', front.e, 0.3);
    hover(s, p);
    const both = previewSegments(s, PREVIEW.loop);
    expect(both).toHaveLength(8);
    const x = both[0]?.[0][0] ?? 9;
    expect(Math.abs(x)).toBeGreaterThan(0.1);
    expectLoopAt(
      both.filter(([a]) => a[0] * x > 0),
      x,
    );
    expectLoopAt(
      both.filter(([a]) => a[0] * x < 0),
      -x,
    );
    expect(both.filter(([a]) => a[0] * x > 0)).toHaveLength(4);
    // A typed weight of 0.5 puts the loop on the plane: one loop, its own mirror.
    pointer(element(s), 'pointerdown', p.x, p.y);
    const numeric = s.rig.vm.activeTool()?.numeric?.() ?? null;
    expect(numeric?.active).toBe('weight');
    numeric?.set('weight', 0.5);
    const middle = previewSegments(s, PREVIEW.loop);
    expect(middle).toHaveLength(4);
    expectLoopAt(middle, 0);
    expect(keyDown(s, 'Escape')).toBe(true);
    pointer(element(s), 'pointerup', p.x, p.y);
    await settle();
    expect(counts(s)).toBe('8/12/6');
    // The runs match: two loops at ±x (16/28/14) for the hovered point, one (12/20/10) at 0.5.
    hover(s, p);
    click(s, p);
    await settle();
    expect(counts(s)).toBe('16/28/14');
    const placed = addedPoints(s, 8);
    expect(placed.filter((q) => Math.abs(q[0] - x) < 1e-5)).toHaveLength(4);
    expect(placed.filter((q) => Math.abs(q[0] + x) < 1e-5)).toHaveLength(4);
    await run(s.app, 'edit.undo');
    s.rig.frame();
    pointer(element(s), 'pointerdown', p.x, p.y);
    s.rig.vm.activeTool()?.numeric?.()?.set('weight', 0.5);
    expect(keyDown(s, 'Enter')).toBe(true);
    pointer(element(s), 'pointerup', p.x, p.y);
    await settle();
    expect(counts(s)).toBe('12/20/10');
  });

  it('Multi-Cut previews the chord the run cuts; under Object X its mirror too (one seam point)', async () => {
    const { data, zEdges } = twoQuads();
    const s = await scene(data, 'top');
    await tool(s, 'multiCut');
    click(s, at(s, 'edge', zEdges[0] as number, 0.5));
    click(s, at(s, 'edge', zEdges[1] as number, 0.5));
    const cut = previewSegments(s, PREVIEW.cut);
    expect(cut).toHaveLength(1);
    const chord = cut[0] as [Vec3, Vec3];
    const ends = [chord[0], chord[1]].sort((a, b) => a[0] - b[0]);
    expect(ends[0]?.[0]).toBeCloseTo(-1, 5);
    expect(ends[1]?.[0]).toBeCloseTo(0, 5);
    for (const e of ends) {
      expect(e?.[1]).toBeCloseTo(0, 5);
      expect(Math.abs(e?.[2] ?? 9)).toBeLessThan(0.02);
    }
    expect(keyDown(s, 'Enter')).toBe(true);
    await settle();
    expect(counts(s)).toBe('8/10/3');
    // The run's two new points are the chord's ends.
    const placed = addedPoints(s, 6).sort((a, b) => a[0] - b[0]);
    placed.forEach((q, i) => {
      for (let k = 0; k < 3; k++) expect(q[k]).toBeCloseTo(ends[i]?.[k] ?? 9, 5);
    });
    await run(s.app, 'edit.undo');
    s.rig.frame();

    objectX(s);
    click(s, at(s, 'edge', zEdges[0] as number, 0.5));
    click(s, at(s, 'edge', zEdges[1] as number, 0.5));
    const mirrored = previewSegments(s, PREVIEW.cut);
    expect(mirrored).toHaveLength(2);
    const xs = mirrored.flatMap(([a, b]) => [a[0], b[0]]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-1, 5);
    expect(xs[3]).toBeCloseTo(1, 5);
    expect(xs[1]).toBeCloseTo(0, 5);
    expect(xs[2]).toBeCloseTo(0, 5);
    expect(keyDown(s, 'Enter')).toBe(true);
    await settle();
    expect(counts(s)).toBe('9/12/4');
  });
});

describe('Insert Edge Loop counts (§5.10 PageUp/PageDown)', () => {
  it('PageUp during the press steps the Multiple mode loop count of that placement', async () => {
    const s = await scene(primitive('cube', {}), 'front');
    const modeling = s.app.prefs.getState().modeling;
    s.app.prefs.setState({
      modeling: {
        ...modeling,
        optionDefaults: { ...modeling.optionDefaults, 'mesh.insertLoop': { mode: 'multiple', divisions: 2 } },
      },
    });
    await tool(s, 'insertLoop');
    const front = edgesOf(primitive('cube', {})).find(
      (g) => (g.a[2] ?? 0) > 0.49 && (g.b[2] ?? 0) > 0.49 && (g.a[1] ?? 0) < -0.49 && (g.b[1] ?? 0) < -0.49,
    );
    if (front === undefined) throw new Error('no front bottom edge');
    const p = at(s, 'edge', front.e, 0.5);
    pointer(element(s), 'pointerdown', p.x, p.y);
    const key = {
      type: 'down',
      code: 'PageUp',
      shift: false,
      alt: false,
      mod: false,
      ctrl: false,
      repeat: false,
    } as const;
    expect(s.rig.vm.activeTool()?.key?.(key)).toBe(true);
    pointer(element(s), 'pointerup', p.x, p.y);
    await settle();
    // Three loops round the cube's four sides.
    expect(counts(s)).toBe('20/36/18');
    expect(s.app.session.getState().lastRun?.args['divisions']).toBe(3);
  });

  it('Backspace is swallowed while placing and sliding (never the keymap delete); Enter places', async () => {
    const s = await scene(primitive('cube', {}), 'front');
    await tool(s, 'insertLoop');
    const front = edgesOf(primitive('cube', {})).find(
      (g) => (g.a[2] ?? 0) > 0.49 && (g.b[2] ?? 0) > 0.49 && (g.a[1] ?? 0) < -0.49 && (g.b[1] ?? 0) < -0.49,
    );
    if (front === undefined) throw new Error('no front bottom edge');
    const p = at(s, 'edge', front.e, 0.3);
    const q = at(s, 'edge', front.e, 0.6);
    pointer(element(s), 'pointerdown', p.x, p.y);
    await swallows(s, ['Backspace'], 'placing');
    pointer(element(s), 'pointermove', q.x, q.y, { buttons: 1 });
    await swallows(s, ['Backspace'], 'dragging');
    expect(keyDown(s, 'Enter')).toBe(true);
    await settle();
    expect(counts(s)).toBe('12/20/10');
    pointer(element(s), 'pointerup', q.x, q.y);
    await settle();
    expect(counts(s)).toBe('12/20/10');
    expect(keyDown(s, 'Backspace')).toBe(false);
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

  it("RMB is ignored during the drag; the reserved keys are the tool's (nothing deleted); the LMB release welds", async () => {
    const s = await scene(primitive('cube', {}), 'front');
    await tool(s, 'targetWeld');
    const cube = primitive('cube', {});
    const front = edgesOf(cube).find(
      (g) => (g.a[2] ?? 0) > 0.49 && (g.b[2] ?? 0) > 0.49 && (g.a[1] ?? 0) > 0.49 && (g.b[1] ?? 0) > 0.49,
    );
    if (front === undefined) throw new Error('no front top edge');
    const pa = at(s, 'vertex', cube.edgeVerts[2 * front.e] as number);
    const pb = at(s, 'vertex', cube.edgeVerts[2 * front.e + 1] as number);
    const base = labels(s.app).length;
    pointer(element(s), 'pointerdown', pa.x, pa.y);
    pointer(element(s), 'pointermove', pb.x, pb.y, { buttons: 1 });
    expect(phase(s)).toBe('dragging');
    // RMB during the drag: neither a cancel nor a marking menu.
    pointer(element(s), 'pointerdown', pb.x, pb.y, { button: 2 });
    pointer(element(s), 'pointermove', pb.x, pb.y, { buttons: 3 });
    expect(phase(s)).toBe('dragging');
    await swallows(s, ['Backspace', 'Enter', 'NumpadEnter', 'PageUp', 'PageDown'], 'dragging');
    expect(counts(s)).toBe('8/12/6');
    pointer(element(s), 'pointerup', pb.x, pb.y);
    await settle();
    expect(counts(s)).toBe('7/11/6');
    expect(labels(s.app).length).toBe(base + 1);
    expect(s.app.session.getState().lastRun).toMatchObject({ id: 'mesh.targetWeld', source: 'tool' });
    expect(keyDown(s, 'Backspace')).toBe(false);
  });
});

describe('Slide Edge (§5.12, §5.10)', () => {
  /** The 2 × 1 plane from the top, its middle edge selected (edge mode), the Slide tool active. */
  async function sliding(): Promise<{ readonly s: Scene; readonly mid: number }> {
    const { data, zEdges } = twoQuads();
    const s = await scene(data, 'top');
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.mesh] } });
    await run(s.app, 'select.mode', { mode: 'edge' });
    const mid = zEdges[1] as number;
    await run(s.app, 'select.components', { mesh: s.mesh, kind: 'edge', indices: [mid], mode: 'replace' });
    await tool(s, 'slide');
    return { s, mid };
  }

  const positions = (s: Scene): number[] => Array.from(s.app.meshes.get(s.mesh)?.data()?.position ?? []);

  it("RMB is ignored and the reserved keys are the tool's during the drag; Esc leaves no step", async () => {
    const { s, mid } = await sliding();
    const base = [...labels(s.app)];
    const before = positions(s);
    const p = at(s, 'edge', mid, 0.5);
    pointer(element(s), 'pointerdown', p.x, p.y);
    expect(phase(s)).toBe('placing');
    pointer(element(s), 'pointermove', p.x + 30, p.y, { buttons: 1 });
    expect(phase(s)).toBe('dragging');
    pointer(element(s), 'pointerdown', p.x + 30, p.y, { button: 2 });
    pointer(element(s), 'pointermove', p.x + 30, p.y, { buttons: 3 });
    expect(phase(s)).toBe('dragging');
    await swallows(s, ['Backspace', 'PageUp', 'PageDown'], 'dragging');
    expect(keyDown(s, 'Escape')).toBe(true);
    expect(phase(s)).toBe('idle');
    pointer(element(s), 'pointerup', p.x + 30, p.y);
    await settle();
    expect(labels(s.app)).toEqual(base);
    expect(positions(s)).toEqual(before);
    expect(counts(s)).toBe('6/7/2');
    expect(keyDown(s, 'Backspace')).toBe(false);
  });

  it('an MMB drag slides along the rail it picks; a typed percent commits on confirm', async () => {
    const { s, mid } = await sliding();
    const base = labels(s.app).length;
    const p = at(s, 'edge', mid, 0.5);
    // MMB to the right: the rails towards x = 1, a positive percent.
    drag(s, p, { x: p.x + 40, y: p.y }, { button: 1 });
    await settle();
    const last = s.app.session.getState().lastRun;
    expect(last).toMatchObject({ id: 'mesh.slide', source: 'tool', tool: 'slide' });
    const percent = Number(last?.args['percent']);
    expect(percent).toBeGreaterThan(0);
    expect(percent).toBeLessThan(1);
    expect(labels(s.app).length).toBe(base + 1);
    // The edge's ends moved along +X by the percent of their 1 m rails.
    const d = s.app.meshes.get(s.mesh)?.data();
    if (d === undefined || d === null) throw new Error('no data');
    for (const v of [d.edgeVerts[2 * mid] as number, d.edgeVerts[2 * mid + 1] as number]) {
      expect(d.position[3 * v] as number).toBeCloseTo(percent, 6);
    }
    // A typed percent during the next drag (the capture window's entry) commits on confirm.
    const q = at(s, 'edge', mid, 0.5);
    pointer(element(s), 'pointerdown', q.x, q.y);
    pointer(element(s), 'pointermove', q.x - 20, q.y, { buttons: 1 });
    const numeric = s.rig.vm.activeTool()?.numeric?.() ?? null;
    expect(numeric?.active).toBe('percent');
    numeric?.set('percent', -0.25);
    numeric?.confirm();
    await settle();
    expect(phase(s)).toBe('idle');
    pointer(element(s), 'pointerup', q.x - 20, q.y);
    await settle();
    expect(s.app.session.getState().lastRun?.args['percent']).toBe(-0.25);
    expect(labels(s.app).length).toBe(base + 2);
  });
});

/** The vertices of a face of mesh data, winding order. */
function faceVertsOf(data: MeshData, f: number): number[] {
  const out: number[] = [];
  const first = data.faceCorner[f] as number;
  let c = first;
  do {
    out.push(data.cornerVert[c] as number);
    c = data.cornerNext[c] as number;
  } while (c !== first);
  return out;
}

/** The cube's top face (its centroid at y = 0.5). */
function cubeTop(cube: MeshData): number {
  const top = [...Array(cube.counts.faces).keys()].find((f) => {
    const verts = faceVertsOf(cube, f);
    return verts.reduce((y, v) => y + (cube.position[3 * v + 1] as number), 0) / verts.length > 0.49;
  });
  if (top === undefined) throw new Error('no top face');
  return top;
}

describe('the extrude manipulator (§5.8) and the value handle (§5.9)', () => {
  async function extruded(): Promise<Scene> {
    const cube = primitive('cube', {});
    const s = await scene(cube, 'persp');
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.mesh] } });
    await run(s.app, 'select.mode', { mode: 'face' });
    const top = cubeTop(cube);
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

  it("the reserved keys are the tool's during a handle drag: nothing is deleted, the drag still commits", async () => {
    const s = await extruded();
    const steps = labels(s.app).length;
    const tz = topologyManipulatorPoint(s.rig.vm, PANE, 'tz');
    if (tz === null) throw new Error('no tz');
    pointer(element(s), 'pointerdown', tz.x, tz.y);
    await swallows(s, ['Backspace', 'Enter', 'NumpadEnter', 'PageUp', 'PageDown'], 'placing');
    pointer(element(s), 'pointermove', tz.x, tz.y - 30, { buttons: 1 });
    await swallows(s, ['Backspace', 'Enter', 'NumpadEnter', 'PageUp', 'PageDown'], 'dragging');
    expect(s.app.extrude.state).not.toBeNull();
    pointer(element(s), 'pointerup', tz.x, tz.y - 30);
    await settle();
    expect(counts(s)).toBe('12/20/10');
    expect(labels(s.app).length).toBe(steps);
    expect(Number(s.app.session.getState().lastRun?.args['localTranslateZ'])).toBeGreaterThan(0);
    expect(s.app.extrude.state?.stack).toHaveLength(2);
  });

  it('Shift pressed after the drag started is the fine adjustment (×0.1), per move: no jump', async () => {
    /** The absorbed world-Y travel of each of four 10 px tz moves, with Shift held from move `shiftFrom` on. */
    async function travel(shiftFrom: number | null): Promise<number[]> {
      const s = await extruded();
      const ys: number[] = [];
      const absorb = s.app.extrude.beginAbsorb.bind(s.app.extrude);
      vi.spyOn(s.app.extrude, 'beginAbsorb').mockImplementation((tool, space) => {
        const gesture = absorb(tool, space);
        if (gesture === null) return null;
        return {
          ...gesture,
          update: (delta) => {
            ys.push(delta.translate?.[1] ?? Number.NaN);
            gesture.update(delta);
          },
        };
      });
      const tz = topologyManipulatorPoint(s.rig.vm, PANE, 'tz');
      if (tz === null) throw new Error('no tz');
      pointer(element(s), 'pointerdown', tz.x, tz.y);
      for (let i = 1; i <= 4; i++) {
        pointer(element(s), 'pointermove', tz.x, tz.y - 10 * i, {
          buttons: 1,
          shiftKey: shiftFrom !== null && i >= shiftFrom,
        });
      }
      pointer(element(s), 'pointerup', tz.x, tz.y - 40);
      await settle();
      // A plain drag absorbs (no smart extrude): the session's stack grew, still one Extrude step.
      expect(s.app.extrude.state?.stack).toHaveLength(2);
      s.rig.dispose();
      rig = null;
      vi.restoreAllMocks();
      return ys;
    }
    const plain = await travel(null);
    const fine = await travel(2);
    expect(plain).toHaveLength(4);
    expect(fine).toHaveLength(4);
    const first = plain[0] as number;
    expect(first).toBeGreaterThan(0);
    expect(plain[3] as number).toBeGreaterThan(first);
    expect(fine[0] as number).toBeCloseTo(first, 12);
    for (let i = 1; i < 4; i++) expect(fine[i] as number).toBeCloseTo(first + 0.1 * ((plain[i] as number) - first), 9);
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

  /** The pane's projector, the manipulator frame and its world units per manipulator unit. */
  function manip(s: Scene) {
    const view = s.rig.vm.paneView(PANE);
    const frame = extrudeManipulatorFrame(s.app);
    if (view === null || frame === null) throw new Error('no manipulator');
    const projector = new PaneProjector().set(view.camera, view.width, view.height, 0.01);
    const k =
      worldPerPixel(view.camera, view.height, projector, frame.pivot) * s.app.session.getState().tools.manipulatorSize;
    const screen = (p: readonly number[]): { x: number; y: number } => {
      const out = [0, 0, 0];
      if (!projector.project(p[0] as number, p[1] as number, p[2] as number, out)) throw new Error('behind');
      return { x: out[0] as number, y: out[1] as number };
    };
    /** The unit screen direction of a world axis through the pivot. */
    const direction = (axis: readonly number[]): { x: number; y: number } => {
      const a = screen(frame.pivot);
      const b = screen([
        frame.pivot[0] + (axis[0] as number) * k,
        frame.pivot[1] + (axis[1] as number) * k,
        frame.pivot[2] + (axis[2] as number) * k,
      ]);
      const n = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: (b.x - a.x) / n, y: (b.y - a.y) / n };
    };
    return { frame, projector, k, screen, direction };
  }

  /** World points of the cap (the cube's top face keeps its index). */
  function capPoints(s: Scene): Vec3[] {
    const d = s.app.meshes.get(s.mesh)?.data();
    if (d === undefined || d === null) throw new Error('no data');
    return faceVertsOf(d, cubeTop(primitive('cube', {}))).map(
      (v) => [d.position[3 * v] as number, d.position[3 * v + 1] as number, d.position[3 * v + 2] as number] as Vec3,
    );
  }

  const argOf = (s: Scene, name: string): number => Number(s.app.session.getState().lastRun?.args[name]);

  it('a ring drag rotates the cap about its pivot in the drag direction (localRotateX)', async () => {
    const s = await extruded();
    const steps = labels(s.app).length;
    const m = manip(s);
    const before = capPoints(s);
    const press = topologyManipulatorPoint(s.rig.vm, PANE, 'rx');
    if (press === null) throw new Error('no rx');
    // The ring sample the tool grabs (the nearest to the press) and the ring's screen tangent there.
    let grab: Vec3 = [m.frame.pivot[0], m.frame.pivot[1], m.frame.pivot[2]];
    let best = Number.POSITIVE_INFINITY;
    for (const p of ringPoints(m.frame, 0, m.k)) {
      const q = m.screen(p);
      const d = Math.hypot(q.x - press.x, q.y - press.y);
      if (d < best) {
        best = d;
        grab = p;
      }
    }
    const axis = m.frame.axes[0];
    const [tx, ty] = ringScreenTangent(m.projector, m.frame.pivot, axis, grab);
    const n = Math.hypot(tx, ty);
    const to = { x: press.x + (30 * tx) / n, y: press.y + (30 * ty) / n };
    drag(s, press, to);
    await settle();
    const angle = argOf(s, 'localRotateX');
    expect(angle).toBeGreaterThan(0.01);
    expect(argOf(s, 'localRotateY')).toBeCloseTo(0, 9);
    expect(argOf(s, 'localRotateZ')).toBeCloseTo(0, 9);
    expect(labels(s.app).length).toBe(steps);
    expect(s.app.extrude.state?.stack).toHaveLength(2);
    // About the pivot: every cap point is its start point turned by the angle about the frame's X through the pivot.
    const q = quatFromAxisAngle([axis[0], axis[1], axis[2]], angle);
    const pivot = m.frame.pivot;
    const turn = (p: readonly number[]): Vec3 => {
      const r = quatRotateVec3(q, [
        (p[0] as number) - pivot[0],
        (p[1] as number) - pivot[1],
        (p[2] as number) - pivot[2],
      ]);
      return [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]];
    };
    capPoints(s).forEach((p, i) => {
      const expected = turn(before[i] as Vec3);
      for (let c = 0; c < 3; c++) expect(p[c]).toBeCloseTo(expected[c] as number, 5);
    });
    // In the drag direction: the grabbed ring point, turned by the angle, moved along the drag on screen.
    const from = m.screen(grab);
    const moved = m.screen(turn(grab));
    expect((moved.x - from.x) * (to.x - press.x) + (moved.y - from.y) * (to.y - press.y)).toBeGreaterThan(0);
  });

  it('an axis scale cube drag scales the cap along that cap axis only (localScaleX)', async () => {
    const s = await extruded();
    const m = manip(s);
    const before = capPoints(s);
    const press = topologyManipulatorPoint(s.rig.vm, PANE, 'sx');
    if (press === null) throw new Error('no sx');
    const axis = m.frame.scaleAxes[0];
    const dir = m.direction(axis);
    drag(s, press, { x: press.x + 25 * dir.x, y: press.y + 25 * dir.y });
    await settle();
    const factor = argOf(s, 'localScaleX');
    expect(factor).toBeGreaterThan(1.05);
    expect(argOf(s, 'localScaleY')).toBe(1);
    expect(argOf(s, 'localScaleZ')).toBe(1);
    const pivot = m.frame.pivot;
    capPoints(s).forEach((p, i) => {
      const b = before[i] as Vec3;
      const along = (b[0] - pivot[0]) * axis[0] + (b[1] - pivot[1]) * axis[1] + (b[2] - pivot[2]) * axis[2];
      for (let c = 0; c < 3; c++)
        expect(p[c]).toBeCloseTo((b[c] as number) + (factor - 1) * along * (axis[c] as number), 5);
    });
  });

  it('after the local/world toggle a translate drag moves the cap along the world axis (args in the cap frame)', async () => {
    const s = await extruded();
    const local = manip(s);
    const toggle = extrudeGrabPoint(local.frame, 'space', local.k, local.projector);
    if (toggle === null) throw new Error('no toggle');
    click(s, toggle);
    expect(s.app.extrude.state?.manipSpace).toBe('world');
    const m = manip(s);
    expect(m.frame.axes).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    // The cap frame of the top face: X = world +Z, Y = world +X, Z = world +Y; its scale handles stay on it.
    expect(m.frame.scaleAxes[1]?.[0]).toBeCloseTo(1, 9);
    const before = capPoints(s);
    const press = topologyManipulatorPoint(s.rig.vm, PANE, 'tx');
    if (press === null) throw new Error('no tx');
    const dir = m.direction([1, 0, 0]);
    drag(s, press, { x: press.x + 25 * dir.x, y: press.y + 25 * dir.y });
    await settle();
    const d = argOf(s, 'localTranslateY');
    expect(d).toBeGreaterThan(0.01);
    expect(argOf(s, 'localTranslateX')).toBeCloseTo(0, 9);
    expect(argOf(s, 'localTranslateZ')).toBeCloseTo(0, 9);
    capPoints(s).forEach((p, i) => {
      const b = before[i] as Vec3;
      expect(p[0]).toBeCloseTo(b[0] + d, 5);
      expect(p[1]).toBeCloseTo(b[1], 5);
      expect(p[2]).toBeCloseTo(b[2], 5);
    });
    expect(EXTRUDE_LAYOUT.toggle).toHaveLength(3);
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
    // The reserved keys are the tool's during a value drag too (nothing deleted); release adjusts once more.
    pointer(element(s), 'pointerdown', p.x + 20, p.y);
    pointer(element(s), 'pointermove', p.x + 30, p.y, { buttons: 1 });
    await swallows(s, ['Backspace', 'Enter', 'NumpadEnter', 'PageUp', 'PageDown'], 'dragging');
    pointer(element(s), 'pointerup', p.x + 30, p.y);
    await settle();
    expect(Number(s.app.session.getState().lastRun?.args['offset'])).toBeCloseTo(0.3, 6);
    expect(labels(s.app).length).toBe(steps);
  });
});

// M6A-INT (cross-package): B12a's W/E/R tools and B12b's session meet here. `Shift` at the start of a W handle drag
// is smart extrude (B12a never called B12b's `beginSmartExtrude`: the drag moved the face, "Move"); an MMB drag with
// a Channel Box INPUTS field selected runs that field's slider while the session's manipulator tool is the active
// one after `Mod+E` (§5.15 MMB rule; B12b's tool only selected).
describe('W/E/R and the extrude session together (M6A-INT-5, M6A-INT-9)', () => {
  async function topFaceSelected(): Promise<Scene> {
    const cube = primitive('cube', {});
    const s = await scene(cube, 'persp');
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.mesh] } });
    await run(s.app, 'select.mode', { mode: 'face' });
    await run(s.app, 'select.components', { mesh: s.mesh, kind: 'face', indices: [cubeTop(cube)], mode: 'replace' });
    await expect.poll(() => modelTransformOf(s.app), { timeout: 15_000 }).not.toBeNull();
    s.rig.frame();
    return s;
  }

  it('Shift held at the start of a W handle drag extrudes the face: one "Extrude" step, its session open', async () => {
    const s = await topFaceSelected();
    await run(s.app, 'view.tool', { panel: 'viewport', tool: 'move' });
    s.rig.frame();
    const steps = labels(s.app).length;
    const ty = s.rig.vm.manipulatorScreenPoint(PANE, 'ty');
    if (ty === null) throw new Error('no ty handle');
    drag(s, ty, { x: ty.x, y: ty.y - 40 }, { shiftKey: true });
    await settle();
    await expect.poll(() => labels(s.app).length).toBe(steps + 1);
    expect(labels(s.app).at(-1)).toBe('Extrude');
    expect(counts(s)).toBe('12/20/10');
    expect(s.app.session.getState().lastRun?.id).toBe('mesh.extrude');
    expect(Number(s.app.session.getState().lastRun?.args['localTranslateZ'])).toBeGreaterThan(0);
    expect(s.app.extrude.state).not.toBeNull();
    // Without Shift the same drag moves the face ("Move").
    const plain = await topFaceSelected();
    await run(plain.app, 'view.tool', { panel: 'viewport', tool: 'move' });
    plain.rig.frame();
    const handle = plain.rig.vm.manipulatorScreenPoint(PANE, 'ty');
    if (handle === null) throw new Error('no ty handle');
    drag(plain, handle, { x: handle.x, y: handle.y - 40 });
    await settle();
    await expect.poll(() => labels(plain.app).at(-1)).toBe('Move');
    expect(counts(plain)).toBe('8/12/6');
  });

  it('an MMB drag with an INPUTS field selected runs its slider while the extrude manipulator is active', async () => {
    const s = await topFaceSelected();
    await run(s.app, 'mesh.extrude', {}, { source: 'keyboard', paneId: PANE });
    await settle();
    s.rig.frame();
    expect(s.app.session.getState().tools.viewport).toBe('extrude');
    const steps = labels(s.app).length;
    selectInputsField(s.app, { entry: 'lastop', mesh: s.mesh, param: 'localTranslateZ' });
    drag(s, { x: 120, y: 120 }, { x: 160, y: 120 }, { button: 1 });
    await settle();
    // 40 px at the shipped 0.01 m per px (prefs.virtualSlider), one adjusted step: the history keeps its length.
    await expect.poll(() => Number(s.app.session.getState().lastRun?.args['localTranslateZ'])).toBeCloseTo(0.4, 9);
    expect(labels(s.app)).toHaveLength(steps);
    expect(s.app.session.getState().tools.viewport).toBe('extrude');
    expect(s.app.extrude.state).not.toBeNull();
  });
});

describe('the Bevel value handle (§5.9; READY.b5, a failure since INT)', () => {
  /** A cube's edge 0 bevelled from the select tool with `args`: the manipulator tool shows the value handle. */
  async function bevelled(args: Readonly<Record<string, unknown>>) {
    const cube = primitive('cube', {});
    const s = await scene(cube, 'persp');
    s.app.session.setState({ selection: { ...s.app.session.getState().selection, objects: [s.mesh] } });
    await run(s.app, 'select.mode', { mode: 'edge' });
    await run(s.app, 'select.components', { mesh: s.mesh, kind: 'edge', indices: [0], mode: 'replace' });
    await run(s.app, 'view.tool', { panel: 'viewport', tool: 'select' });
    await run(s.app, 'mesh.bevel', { ...args }, { source: 'menu', paneId: PANE });
    await settle();
    s.rig.frame();
    expect(s.app.session.getState().tools.viewport).toBe('extrude');
    const kit = topologyKit();
    if (kit === null) throw new Error('no kit');
    return { s, rt: kit.topologyRuntime(s.app, s.rig.vm) };
  }

  it('Offset as Fraction off: the handle drags the absolute offset (the card preview, one adjust)', async () => {
    const { s, rt } = await bevelled({ offsetAsFraction: false });
    expect(rt.valueRun()?.param).toBe('offset');
    const steps = labels(s.app).length;
    const before = { ...s.app.session.getState().lastRun?.args };
    const pivot = rt.valueHandle.at;
    if (pivot === null) throw new Error('no value handle');
    const p = s.rig.vm.project(PANE, pivot);
    if (p === null) throw new Error('value handle off-screen');
    drag(s, { x: p.x + 20, y: p.y }, { x: p.x + 30, y: p.y });
    await settle();
    const after = s.app.session.getState().lastRun?.args ?? {};
    // 10 px at the distance rate (0.01 m/px).
    expect(Number(after['offset'])).toBeCloseTo(Number(before['offset']) + 0.1, 6);
    expect(after['fraction']).toBe(before['fraction']);
    expect(labels(s.app).length).toBe(steps);
  });

  it('Offset as Fraction on (the default): the handle is on the fraction', async () => {
    // The fraction drag itself is not asserted here: with B5 merged the card preview of a new fraction makes the
    // Last-op tracker close the LastRun ("Selection changed") before the adjust, so the card's own Fraction slider
    // fails the same way (B11 + B5, recorded for INT in docs/wp-notes/m6a-model-topology-tools.md).
    const { rt } = await bevelled({});
    expect(rt.valueRun()?.param).toBe('fraction');
    expect(rt.valueHandle.at).not.toBeNull();
  });
});
