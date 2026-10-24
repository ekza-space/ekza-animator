// The topology tools' runtime (M6A-SPEC §5.8–§5.12; B12b), one per viewport, in the lazy topology kit: the preview
// overlay, the extrude manipulator and the Inset/Bevel value handle (drawn through `addMeshLayer`), the pointer hover
// the tools preview from (tools get no pointer moves without a press), component picks through B10's Model select
// runtime, scratch runs of kernel ops for previews and validation (on a copy of the stored revision: no document
// writes, no preview session), and the help line.
import type { Disposer, ReadonlyVec3, ReadonlyXf, Vec3 } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import {
  type EditorApp,
  extrudeManipulatorFrame,
  liveLastRun,
  meshKernel,
  sayModelHelp,
  VIEWPORT_TOOL,
  worldPlacement,
} from '@ekza-studio/editor-core';
import type {
  ComponentKind,
  ComponentSelection,
  EditMesh,
  OpContext,
  OpResult,
  OpWarning,
  Refusal,
} from '@ekza-studio/mesh-core';
import { type Camera, Group, OrthographicCamera, PerspectiveCamera } from 'three';
import type { ViewportManager } from '../../../manager/ViewportManager';
import { ExtrudeManipView, ValueHandleView } from '../../../manipulators/extrude/view';
import type { MeshDisplayPick } from '../../../mesh';
import { PaneProjector } from '../../../picking/geometry';
import { modelSelectOf } from '../select';
import { ToolOverlay } from './overlay';

/** A pane point in CSS px. */
export interface PanePoint {
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
}

/** A pane's camera and projector for a query. */
export interface PaneQuery {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
  readonly projector: PaneProjector;
}

/** The viewport tools whose previews and handles this runtime draws. */
const TOPOLOGY_TOOL_IDS: ReadonlySet<string> = new Set([
  VIEWPORT_TOOL.multiCut,
  VIEWPORT_TOOL.insertLoop,
  VIEWPORT_TOOL.targetWeld,
  VIEWPORT_TOOL.slide,
  VIEWPORT_TOOL.extrude,
]);

/** The kernel ops whose live LastRun gets the value handle (§5.9: Inset offset, Bevel fraction) and their default param. */
export const VALUE_HANDLE_OPS: Readonly<Record<string, string>> = { 'mesh.inset': 'offset', 'mesh.bevel': 'fraction' };

/**
 * The param the value handle drags for a run's args: Inset's offset; Bevel's fraction, or its absolute offset when
 * the run has Offset as Fraction off (the fraction is then ignored by the op). Null for any other op.
 */
export function valueParamOf(opId: string, args: Readonly<Record<string, unknown>>): string | null {
  if (opId === 'mesh.bevel' && args['offsetAsFraction'] === false) return 'offset';
  return VALUE_HANDLE_OPS[opId] ?? null;
}

const IDENTITY: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };

/** The curve engine of a scratch run (topology ops evaluate no falloff curves without soft selection). */
const NO_CURVES = { compile: () => ({}), evaluate: () => 0 } as unknown as OpContext['curves'];

function epsilonOf(position: ArrayLike<number>, points: number): number {
  if (points === 0) return 1e-9;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points; i++) {
    for (let k = 0; k < 3; k++) {
      const value = position[3 * i + k] as number;
      if (value < (lo[k] as number)) lo[k] = value;
      if (value > (hi[k] as number)) hi[k] = value;
    }
  }
  const diagonal = Math.hypot(
    (hi[0] as number) - (lo[0] as number),
    (hi[1] as number) - (lo[1] as number),
    (hi[2] as number) - (lo[2] as number),
  );
  return Math.max(1e-9, 1e-6 * diagonal);
}

/** Column-major 4×4 times a point. */
function transform(m: ArrayLike<number>, x: number, y: number, z: number): Vec3 {
  return [
    (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
    (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
    (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
  ];
}

export function isRefusal(value: OpResult | Refusal): value is Refusal {
  return (value as Refusal).refused === true;
}

export class TopologyRuntime {
  readonly overlay = new ToolOverlay();
  readonly manipulator = new ExtrudeManipView();
  readonly valueHandle = new ValueHandleView();
  private readonly group = new Group();
  private readonly disposers: Disposer[] = [];
  private hover: PanePoint | null = null;
  private hoverListener: ((at: PanePoint | null, shift: boolean) => void) | null = null;
  private readonly scratch = new Map<MeshId, { readonly version: number; readonly mesh: EditMesh }>();
  /** The tool the value handle's manipulator tool replaced (restored when its LastRun goes). */
  private valueTool: { readonly previous: string; readonly stepId: number } | null = null;
  private disposed = false;

  constructor(
    readonly app: EditorApp,
    readonly vm: ViewportManager,
  ) {
    this.group.name = 'ekza.topologyTools';
    this.group.matrixAutoUpdate = false;
    this.group.add(this.overlay.root, this.manipulator.root, this.valueHandle.root);
    this.disposers.push(
      () => this.releaseLayer(true),
      app.session.subscribe((state, previous) => {
        if (
          state.model.extrudeSession !== previous.model.extrudeSession ||
          state.tools.viewport !== previous.tools.viewport ||
          state.tools.manipulatorSize !== previous.tools.manipulatorSize ||
          state.workspace !== previous.workspace ||
          state.lastRun !== previous.lastRun ||
          state.model.componentMode !== previous.model.componentMode
        ) {
          if (state.lastRun !== previous.lastRun) this.followValueHandle();
          this.refreshHandles();
        }
      }),
      app.meshes.subscribe(() => this.refreshHandles()),
      app.components.subscribe(() => this.refreshHandles()),
    );
    if (typeof window !== 'undefined') {
      const move = (e: PointerEvent): void => this.pointerMoved(e);
      window.addEventListener('pointermove', move, { capture: true, passive: true });
      this.disposers.push(() => window.removeEventListener('pointermove', move, { capture: true }));
    }
    this.refreshHandles();
  }

  /** The previews join the viewport's scene only while a topology tool or a handle needs them (no extra layer else). */
  private layer: Disposer | null = null;

  ensureLayer(): void {
    if (this.layer === null && !this.disposed) {
      this.layer = this.vm.addMeshLayer({ root: this.group, applyPane: () => {}, dispose: () => {} });
    }
  }

  /** Leaves the scene when no topology tool is active and nothing shows (`force`: always). */
  releaseLayer(force = false): void {
    if (this.layer === null) return;
    const tool = this.app.session.getState().tools.viewport;
    const busy = TOPOLOGY_TOOL_IDS.has(tool) || this.manipulator.visible || this.valueHandle.visible;
    if (!force && busy) return;
    this.overlay.clear();
    this.layer();
    this.layer = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.overlay.dispose();
    this.manipulator.dispose();
    this.valueHandle.dispose();
  }

  invalidate(): void {
    this.vm.invalidate();
  }

  say(text: string, tone: 'info' | 'warning' = 'info'): void {
    sayModelHelp(this.app, text, tone);
  }

  /** Says the first warning of a finished tool run (§5.14 "No mirror partner: applied to one side"). */
  sayWarnings(value: unknown): void {
    const warnings = (value as { readonly warnings?: readonly OpWarning[] } | null)?.warnings;
    const first = warnings?.[0];
    if (first !== undefined) this.say(first.message, 'warning');
  }

  // ---------- pointer hover ----------

  /** The tool that previews from the hover (one at a time: the active tool). */
  onHover(listener: ((at: PanePoint | null, shift: boolean) => void) | null): void {
    this.hoverListener = listener;
  }

  get hovered(): PanePoint | null {
    return this.hover;
  }

  private pointerMoved(e: PointerEvent): void {
    const paneId = this.vm.paneAt(e.clientX, e.clientY);
    const rect = paneId === null ? null : this.vm.paneRect(paneId);
    this.hover = paneId === null || rect === null ? null : { paneId, x: e.clientX - rect.x, y: e.clientY - rect.y };
    if (e.buttons === 0) this.hoverListener?.(this.hover, e.shiftKey);
  }

  // ---------- panes and picks ----------

  query(paneId: string): PaneQuery | null {
    const view = this.vm.paneView(paneId);
    if (view === null) return null;
    const camera = view.camera;
    const near = camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera ? camera.near : 0.01;
    const projector = new PaneProjector().set(camera, view.width, view.height, near);
    return { camera, width: view.width, height: view.height, projector };
  }

  /** A component of `kind` of a hilited mesh under a pane point (B10's picking), or null. */
  pick(paneId: string, x: number, y: number, kind: ComponentKind): MeshDisplayPick | null {
    return modelSelectOf(this.app)?.pickComponent(paneId, x, y, kind) ?? null;
  }

  /** Pane CSS px of a world point, or null behind the camera. */
  project(paneId: string, p: ReadonlyVec3): { readonly x: number; readonly y: number } | null {
    const q = this.query(paneId);
    const out = [0, 0, 0];
    return q !== null && q.projector.project(p[0], p[1], p[2], out)
      ? { x: out[0] as number, y: out[1] as number }
      : null;
  }

  /** The column-major world matrix a mesh is drawn with (identity when unknown). */
  world(mesh: MeshId): ArrayLike<number> {
    return modelSelectOf(this.app)?.display.worldOf(mesh) ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  /** The mesh's current topology for reading (the open edit mesh, else a copy of the stored revision). */
  readMesh(mesh: MeshId): EditMesh | null {
    const runtime = this.app.meshes.get(mesh);
    if (runtime === undefined || runtime.state !== 'ready') return null;
    return runtime.mesh ?? this.scratchMesh(mesh);
  }

  /** World position of a vertex. */
  vertexWorld(mesh: MeshId, m: EditMesh, v: number): Vec3 {
    const p = m.position;
    return transform(this.world(mesh), p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
  }

  /** World position of the point at `t` on an edge (from `edgeVert(e, 0)`). */
  edgeWorld(mesh: MeshId, m: EditMesh, e: number, t: number): Vec3 {
    const a = this.vertexWorld(mesh, m, m.edgeVert(e, 0));
    const b = this.vertexWorld(mesh, m, m.edgeVert(e, 1));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  /** The edge parameter under a pane point: the closest approach of the pointer ray to the edge, clamped. */
  edgeParamAt(paneId: string, mesh: MeshId, m: EditMesh, e: number, x: number, y: number): number | null {
    const q = this.query(paneId);
    if (q === null) return null;
    const origin = [0, 0, 0];
    const dir = [0, 0, 0];
    q.projector.ray(q.camera, x, y, origin, dir);
    const a = this.edgeWorld(mesh, m, e, 0);
    const b = this.edgeWorld(mesh, m, e, 1);
    const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w: Vec3 = [a[0] - (origin[0] as number), a[1] - (origin[1] as number), a[2] - (origin[2] as number)];
    const d: Vec3 = [dir[0] as number, dir[1] as number, dir[2] as number];
    const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
    const ud = u[0] * d[0] + u[1] * d[1] + u[2] * d[2];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const uw = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
    const dw = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
    const denom = uu * dd - ud * ud;
    if (uu === 0 || Math.abs(denom) < 1e-12 * uu * dd) return null;
    const s = (ud * dw - dd * uw) / denom;
    return Math.max(0, Math.min(1, s));
  }

  // ---------- scratch runs (previews and validation) ----------

  /** An edit mesh of the mesh's stored revision, reused while the runtime's version holds. */
  private scratchMesh(mesh: MeshId): EditMesh | null {
    const runtime = this.app.meshes.get(mesh);
    const kernel = meshKernel();
    const data = runtime?.data() ?? null;
    if (runtime === undefined || kernel === null || data === null) return null;
    const cached = this.scratch.get(mesh);
    if (cached !== undefined && cached.version === runtime.version) return cached.mesh;
    const built = kernel.editMeshFrom(data);
    this.scratch.set(mesh, { version: runtime.version, mesh: built });
    return built;
  }

  /** The op context of a mesh as a run would see it (placement, faceting, its symmetry, its hidden components). */
  opContext(mesh: MeshId, m: EditMesh): OpContext {
    const record = this.app.store.get('meshes', mesh);
    const runtime = this.app.meshes.get(mesh);
    const settings = this.app.session.getState().model.symmetry.get(mesh);
    let map = null;
    try {
      map = runtime?.symmetry() ?? null;
    } catch {
      map = null;
    }
    let hidden = null;
    try {
      hidden = this.app.components.hidden(mesh);
    } catch {
      hidden = null;
    }
    return {
      symmetry: map === null ? null : { map, preserveSeam: settings?.preserveSeam ?? true },
      hidden,
      placement: record === undefined ? IDENTITY : worldPlacement(this.app.store, record),
      faceted: record?.faceted ?? true,
      soft: null,
      curves: NO_CURVES,
      epsilon: epsilonOf(m.position, m.counts.points),
    };
  }

  /**
   * Runs a kernel op on a copy of the mesh's stored revision and reads the result through `read` before the copy is
   * restored: what a run would do, without document writes. Null when the kernel or the mesh is not ready.
   */
  tryOp<T>(
    mesh: MeshId,
    opId: string,
    args: Readonly<Record<string, unknown>>,
    selection: ComponentSelection | null,
    read: (m: EditMesh, result: OpResult | Refusal) => T,
  ): T | null {
    const kernel = meshKernel();
    const op = kernel?.MESH_OPS[opId];
    const m = this.scratchMesh(mesh);
    if (kernel === undefined || kernel === null || op === undefined || m === null) return null;
    m.begin(`preview:${opId}`);
    try {
      const result = op.run(m, selection, args as never, this.opContext(mesh, m));
      return read(m, result);
    } catch {
      return null;
    } finally {
      m.abort();
    }
  }

  /** World segments (xyz pairs) of edges of a scratch result. */
  edgeSegments(mesh: MeshId, m: EditMesh, edges: Iterable<number>): number[] {
    const out: number[] = [];
    for (const e of edges) {
      if (e < 0 || e >= m.counts.edges) continue;
      const a = this.vertexWorld(mesh, m, m.edgeVert(e, 0));
      const b = this.vertexWorld(mesh, m, m.edgeVert(e, 1));
      out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return out;
  }

  // ---------- the extrude manipulator and the value handle ----------

  /** The manipulator size in CSS px (the session's, as the W/E/R manipulator). */
  private sizePx(): number {
    return this.app.session.getState().tools.manipulatorSize;
  }

  /** Shows the extrude manipulator while a session is open with the manipulator tool; the value handle likewise. */
  refreshHandles(): void {
    if (this.disposed) return;
    const state = this.app.session.getState();
    const tool = state.workspace === 'model' && state.tools.viewport === VIEWPORT_TOOL.extrude;
    const frame = tool && state.model.extrudeSession !== null ? extrudeManipulatorFrame(this.app) : null;
    const wasManip = this.manipulator.visible;
    this.manipulator.set(frame, this.sizePx());
    const value = tool && frame === null ? this.valuePivot() : null;
    const wasValue = this.valueHandle.visible;
    this.valueHandle.set(value, this.sizePx());
    if (frame !== null || value !== null || TOPOLOGY_TOOL_IDS.has(state.tools.viewport)) this.ensureLayer();
    else this.releaseLayer();
    if (wasManip || frame !== null || wasValue || value !== null) this.invalidate();
  }

  /** The live Inset/Bevel run whose result is still selected, with its value param; else null. */
  valueRun(): { readonly op: string; readonly param: string; readonly mesh: MeshId } | null {
    const last = liveLastRun(this.app);
    if (last === null || !last.adjustable) return null;
    const param = valueParamOf(last.id, last.args);
    const mesh = last.targets[0];
    const model = this.app.session.getState().model;
    if (param === null || mesh === undefined || !model.hilite.includes(mesh)) return null;
    if (last.kind === null || model.componentMode !== last.kind) return null;
    return { op: last.id, param, mesh };
  }

  /** Where the value handle sits: the centroid of the run's result selection (world). */
  private valuePivot(): Vec3 | null {
    const run = this.valueRun();
    if (run === null) return null;
    const m = this.readMesh(run.mesh);
    if (m === null) return null;
    let sel: ComponentSelection;
    try {
      sel = this.app.components.get(run.mesh, 'face');
    } catch {
      return null;
    }
    const verts = new Set<number>();
    sel.faces.forEach((f) => {
      if (f >= m.counts.faces) return;
      const first = m.faceCorner(f);
      let c = first;
      do {
        verts.add(m.cornerVert(c));
        c = m.cornerNext(c);
      } while (c !== first);
    });
    if (verts.size === 0) {
      const edges = this.app.components.get(run.mesh, 'edge').edges;
      edges.forEach((e) => {
        if (e >= m.counts.edges) return;
        verts.add(m.edgeVert(e, 0));
        verts.add(m.edgeVert(e, 1));
      });
    }
    if (verts.size === 0) return null;
    const sum: Vec3 = [0, 0, 0];
    for (const v of verts) {
      const p = this.vertexWorld(run.mesh, m, v);
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
    }
    return [sum[0] / verts.size, sum[1] / verts.size, sum[2] / verts.size];
  }

  /**
   * After an Inset or Bevel from the select tool, the manipulator tool shows its value handle (as a desktop DCC shows
   * the node's manipulator); the select tool comes back when that operation stops being the live last one.
   */
  private followValueHandle(): void {
    const state = this.app.session.getState();
    const last = state.lastRun;
    const tools = state.tools;
    const fresh =
      last !== null &&
      last.closed === null &&
      VALUE_HANDLE_OPS[last.id] !== undefined &&
      last.source !== 'card' &&
      state.workspace === 'model';
    if (fresh && tools.viewport === VIEWPORT_TOOL.select && this.valueTool?.stepId !== last.stepId) {
      this.valueTool = { previous: tools.viewport, stepId: last.stepId };
      this.app.session.setState({ tools: { ...tools, viewport: VIEWPORT_TOOL.extrude } });
      return;
    }
    const stillLive = last !== null && last.closed === null && VALUE_HANDLE_OPS[last.id] !== undefined;
    if (this.valueTool !== null && !stillLive) {
      const previous = this.valueTool.previous;
      this.valueTool = null;
      if (tools.viewport === VIEWPORT_TOOL.extrude && state.model.extrudeSession === null) {
        this.app.session.setState({ tools: { ...tools, viewport: previous } });
      }
    } else if (this.valueTool !== null && last !== null && stillLive) {
      this.valueTool = { ...this.valueTool, stepId: last.stepId };
    }
  }
}
