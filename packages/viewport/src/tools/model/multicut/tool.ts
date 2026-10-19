// The Multi-Cut tool (`K`; M6A-SPEC §5.11 "Multi-Cut", §5.10 modal tool contract, §5.14; B12b). LMB places points on
// edges (at the clicked parameter; `Shift` snaps it to `prefs.modeling.multiCutSnapStep`) or on vertices (within 8 px);
// consecutive points must share a face and the chord must stay inside it (checked by a scratch run of `mesh.cut`, so
// the help line says why a point is not added). RMB (pointer-down button 2, never `contextmenu`) or `Enter` completes
// with one `mesh.cut` run (`source: 'tool'`; symmetric paths are mirrored by the kernel); `Backspace` removes the last
// point; `Esc` cancels with no step. `Ctrl`-click on an edge inserts an edge loop at the cursor's parameter,
// `Ctrl+Shift`-click at the nearest snap step, `Ctrl`+MMB (the trackpad stand-in included) at 0.5 — one step each,
// the tool stays active. RMB never cancels. The preview draws the cut the kernel would make (mirror included) and a
// rubber band to the snapped pointer.
import type { Vec3 } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import type { EditorApp, ToolInstance, ToolKeyEvent, ToolPhase, ToolPointerEvent } from '@ekza-animator/editor-core';
import type { EditMesh } from '@ekza-animator/mesh-core';
import { PREVIEW } from '../topology/overlay';
import { isRefusal, type PanePoint, type TopologyRuntime } from '../topology/runtime';

/** A placed point: on an edge at `t`, or at a vertex; with its world position for the preview. */
export interface CutPoint {
  readonly kind: 'edge' | 'vertex';
  readonly edge: number;
  readonly t: number;
  readonly vertex: number;
  readonly world: Vec3;
}

/** The `points` arg of `mesh.cut` (§6.1). */
export function cutArgs(points: readonly CutPoint[]): Record<string, unknown>[] {
  return points.map((p) =>
    p.kind === 'vertex' ? { kind: 'vertex', vertex: p.vertex } : { kind: 'edge', edge: p.edge, t: p.t },
  );
}

/** `t` snapped to multiples of `step` (§5.11 `Shift`). */
export function snapT(t: number, step: number): number {
  if (!(step > 0)) return t;
  return Math.max(0, Math.min(1, Math.round(t / step) * step));
}

export const CLICK_EACH_FACE = 'Click on each face the cut crosses';
export const LEAVES_FACE = 'That cut would leave the face';
export const POINTS_ON_EDGES = 'Click on an edge or a vertex: points inside faces arrive later';
export const ONE_MESH = 'Multi-Cut cuts one mesh at a time: finish this cut first';

/** Faces around a vertex. */
function vertexFaces(m: EditMesh, v: number): Set<number> {
  const out = new Set<number>();
  const first = m.vertEdge(v);
  if (first < 0) return out;
  let e = first;
  do {
    const c0 = m.edgeCorner(e);
    if (c0 >= 0) {
      let c = c0;
      do {
        out.add(m.cornerFace(c));
        c = m.cornerRadialNext(c);
      } while (c !== c0 && c >= 0);
    }
    e = m.edgeDiskNext(e, v);
  } while (e !== first && e >= 0);
  return out;
}

/** Faces around an edge. */
function edgeFaces(m: EditMesh, e: number): Set<number> {
  const out = new Set<number>();
  const c0 = m.edgeCorner(e);
  if (c0 < 0) return out;
  let c = c0;
  do {
    out.add(m.cornerFace(c));
    c = m.cornerRadialNext(c);
  } while (c !== c0 && c >= 0);
  return out;
}

const facesOf = (m: EditMesh, p: CutPoint): Set<number> =>
  p.kind === 'vertex' ? vertexFaces(m, p.vertex) : edgeFaces(m, p.edge);

export class MultiCutTool implements ToolInstance {
  private points: CutPoint[] = [];
  private mesh: MeshId | null = null;
  private paneId: string | null = null;
  /** The press this tool took (its release is swallowed). */
  private pressed = false;
  private rubber: Vec3 | null = null;
  private preview: number[] = [];

  constructor(
    private readonly app: EditorApp,
    private readonly rt: TopologyRuntime,
  ) {}

  activate(): void {
    this.rt.onHover((at, shift) => this.hovered(at, shift));
  }

  deactivate(): void {
    this.reset();
    this.rt.onHover(null);
  }

  phase(): ToolPhase {
    return this.points.length > 0 ? 'placing' : 'idle';
  }

  cursor(): string | null {
    return 'crosshair';
  }

  /** The points placed so far (tests, the readout). */
  get placed(): readonly CutPoint[] {
    return this.points;
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.paneId === null) return false;
    // RMB completes (pointer-down button 2 only; the browser's contextmenu never reaches tools). It never cancels.
    if (e.button === 2) {
      if (this.points.length === 0) return false;
      this.pressed = true;
      this.complete();
      return true;
    }
    if (e.ctrl && (e.button === 0 || e.button === 1)) {
      this.pressed = true;
      this.loopAt(e);
      return true;
    }
    if (e.button !== 0) return false;
    this.pressed = true;
    const point = this.pointAt(e.paneId, e.x, e.y, e.shift);
    if (point === null) return true;
    this.add(point.mesh, point.point, e.paneId);
    return true;
  }

  pointerMove(_e: ToolPointerEvent): boolean {
    return this.pressed;
  }

  pointerUp(_e: ToolPointerEvent): boolean {
    const was = this.pressed;
    this.pressed = false;
    return was;
  }

  key(e: ToolKeyEvent): boolean {
    if (e.type !== 'down' || this.points.length === 0) return false;
    if (e.code === 'Backspace') {
      this.points = this.points.slice(0, -1);
      if (this.points.length === 0) this.mesh = null;
      this.refreshPreview();
      return true;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      this.complete();
      return true;
    }
    if (e.code === 'Escape') {
      this.reset();
      return true;
    }
    return false;
  }

  cancel(): void {
    // Esc or a lost pointer during a press: the cut in progress is dropped (no step).
    this.pressed = false;
    this.reset();
  }

  // ---------- points ----------

  /** The point a click at (x, y) places: a vertex within 8 px, else the edge under the pointer at its parameter. */
  pointAt(
    paneId: string,
    x: number,
    y: number,
    shift: boolean,
  ): { readonly mesh: MeshId; readonly point: CutPoint } | null {
    const vertex = this.rt.pick(paneId, x, y, 'vertex');
    if (vertex !== null) {
      const m = this.rt.readMesh(vertex.mesh);
      if (m === null) return null;
      return {
        mesh: vertex.mesh,
        point: {
          kind: 'vertex',
          edge: -1,
          t: 0,
          vertex: vertex.index,
          world: this.rt.vertexWorld(vertex.mesh, m, vertex.index),
        },
      };
    }
    const edge = this.rt.pick(paneId, x, y, 'edge');
    if (edge === null) {
      if (this.rt.pick(paneId, x, y, 'face') !== null) this.rt.say(POINTS_ON_EDGES, 'warning');
      return null;
    }
    const m = this.rt.readMesh(edge.mesh);
    if (m === null) return null;
    let t = edge.t ?? 0.5;
    if (shift) t = snapT(t, this.app.prefs.getState().modeling.multiCutSnapStep);
    if (t <= 0 || t >= 1) {
      const vertexIndex = m.edgeVert(edge.index, t <= 0 ? 0 : 1);
      return {
        mesh: edge.mesh,
        point: {
          kind: 'vertex',
          edge: -1,
          t: 0,
          vertex: vertexIndex,
          world: this.rt.vertexWorld(edge.mesh, m, vertexIndex),
        },
      };
    }
    return {
      mesh: edge.mesh,
      point: { kind: 'edge', edge: edge.index, t, vertex: -1, world: this.rt.edgeWorld(edge.mesh, m, edge.index, t) },
    };
  }

  /** Adds a point when it continues the path (a face shared with the previous point, the chord inside it). */
  add(mesh: MeshId, point: CutPoint, paneId: string): boolean {
    if (this.mesh !== null && this.mesh !== mesh) {
      this.rt.say(ONE_MESH, 'warning');
      return false;
    }
    const last = this.points.at(-1);
    if (last !== undefined) {
      const m = this.rt.readMesh(mesh);
      if (m === null) return false;
      const shared = [...facesOf(m, last)].some((f) => facesOf(m, point).has(f));
      if (!shared) {
        this.rt.say(CLICK_EACH_FACE, 'warning');
        return false;
      }
      const next = [...this.points, point];
      const verdict = this.rt.tryOp(mesh, 'mesh.cut', { points: cutArgs(next) }, null, (_m, result) =>
        isRefusal(result) ? result : null,
      );
      if (verdict !== null && verdict !== undefined) {
        this.rt.say(verdict.code === 'cut.no-common-face' ? CLICK_EACH_FACE : LEAVES_FACE, 'warning');
        return false;
      }
    }
    this.mesh = mesh;
    this.paneId = paneId;
    this.points = [...this.points, point];
    this.refreshPreview();
    return true;
  }

  /** One `mesh.cut` run with the placed points (a single point cuts nothing: the path is dropped). */
  complete(): void {
    const mesh = this.mesh;
    const points = this.points;
    const paneId = this.paneId;
    this.reset();
    if (mesh === null || points.length < 2) return;
    void this.app
      .runUntyped(
        'mesh.cut',
        { points: cutArgs(points), meshes: [mesh], kind: 'edge' },
        { source: 'tool', ...(paneId === null ? {} : { paneId }) },
      )
      .then((result) => {
        if (result.status === 'finished') this.rt.sayWarnings(result.value);
        else if (result.status === 'cancelled') this.rt.say(result.reason, 'warning');
        else this.rt.say(result.error.message, 'warning');
      });
  }

  /** `Ctrl`-click: an edge loop through the clicked edge (`Ctrl+Shift`: at the snap step; `Ctrl`+MMB: at 0.5). */
  private loopAt(e: ToolPointerEvent): void {
    if (e.paneId === null) return;
    const hit = this.rt.pick(e.paneId, e.x, e.y, 'edge');
    if (hit === null) return;
    const step = this.app.prefs.getState().modeling.multiCutSnapStep;
    const raw = hit.t ?? 0.5;
    const weight = e.button === 1 ? 0.5 : e.shift ? snapT(raw, step) : raw;
    // A loop changes the topology the placed points refer to: the cut in progress is dropped first.
    this.reset();
    const paneId = e.paneId;
    void this.app
      .runUntyped(
        'mesh.insertLoop',
        { seedEdge: hit.index, weight, mode: 'relative', meshes: [hit.mesh], kind: 'edge' },
        { source: 'tool', paneId },
      )
      .then((result) => {
        if (result.status === 'finished') this.rt.sayWarnings(result.value);
        else if (result.status === 'cancelled') this.rt.say(result.reason, 'warning');
      });
  }

  private reset(): void {
    this.points = [];
    this.mesh = null;
    this.paneId = null;
    this.rubber = null;
    this.preview = [];
    this.rt.overlay.clear();
    this.rt.invalidate();
  }

  // ---------- preview ----------

  private hovered(at: PanePoint | null, shift: boolean): void {
    if (this.points.length === 0 || at === null || this.mesh === null) {
      if (this.rubber !== null) {
        this.rubber = null;
        this.draw();
      }
      return;
    }
    const point = this.pointAt(at.paneId, at.x, at.y, shift);
    this.rubber = point !== null && point.mesh === this.mesh ? point.point.world : this.unprojectNear(at);
    this.draw();
  }

  /** A point under the pointer at the depth of the last placed point (the rubber band's free end). */
  private unprojectNear(at: PanePoint): Vec3 | null {
    const last = this.points.at(-1);
    const q = this.rt.query(at.paneId);
    if (last === undefined || q === null) return null;
    const origin = [0, 0, 0];
    const dir = [0, 0, 0];
    q.projector.ray(q.camera, at.x, at.y, origin, dir);
    const depth = Math.hypot(
      last.world[0] - (origin[0] as number),
      last.world[1] - (origin[1] as number),
      last.world[2] - (origin[2] as number),
    );
    return [
      (origin[0] as number) + (dir[0] as number) * depth,
      (origin[1] as number) + (dir[1] as number) * depth,
      (origin[2] as number) + (dir[2] as number) * depth,
    ];
  }

  /** The cut the kernel would make now (chord edges, mirrored path included), for the preview. */
  private refreshPreview(): void {
    const mesh = this.mesh;
    this.preview = [];
    if (mesh !== null && this.points.length >= 2) {
      this.preview =
        this.rt.tryOp(mesh, 'mesh.cut', { points: cutArgs(this.points) }, null, (m, result) =>
          isRefusal(result) ? [] : this.rt.edgeSegments(mesh, m, result.selection.edges.toArray()),
        ) ?? [];
    }
    this.draw();
  }

  private draw(): void {
    const segments: { positions: number[]; color: readonly [number, number, number] }[] = [];
    if (this.preview.length > 0) segments.push({ positions: this.preview, color: PREVIEW.cut });
    else {
      const path: number[] = [];
      for (let i = 1; i < this.points.length; i++) {
        const a = (this.points[i - 1] as CutPoint).world;
        const b = (this.points[i] as CutPoint).world;
        path.push(...a, ...b);
      }
      if (path.length > 0) segments.push({ positions: path, color: PREVIEW.cut });
    }
    const last = this.points.at(-1);
    if (last !== undefined && this.rubber !== null) {
      segments.push({ positions: [...last.world, ...this.rubber], color: PREVIEW.rubber });
    }
    this.rt.overlay.set(
      segments,
      this.points.map((p) => ({ at: p.world, color: PREVIEW.cut })),
    );
    this.rt.invalidate();
  }
}
