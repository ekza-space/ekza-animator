// The Model select runtime (M6A-SPEC §5.6, §4.4, §5.5 rule 8; B10), a lazy chunk with mesh-view:
//
// - hosts B6's `MeshDisplay` on the viewport (props in every workspace, hilited meshes' components in Model);
// - picks for the select tool: components of the hilited meshes (hover pre-selection with the symmetry partner,
//   click, marquee with mesh-view's both-endpoints edge rule, camera-based and back-face options per pane) and mesh
//   objects in object mode (a ray against the drawn faces; a marquee by the projected visible vertices);
// - provides the pointer probe of the headless Model operators (the mesh under the pointer and at the last press, the
//   key being dispatched) and the bounds `F`/`A` frame in Model (component, then object selections, then the meshes);
// - pushes `view.isolate`'s face sets to the display and drops the ones a topology change made stale.
import type { Disposer } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import {
  componentInternals,
  type EditorApp,
  objectsDrawnIn,
  provideModelPointer,
  type SelectMode,
  type ToolPointerEvent,
} from '@ekza-animator/editor-core';
import type { BitSet, ComponentKind } from '@ekza-animator/mesh-core';
import { type Camera, Matrix4, Ray, Vector3 } from 'three';
import type { SpatialBounds } from '../../../framing/bounds';
import type { ViewportManager } from '../../../manager/ViewportManager';
import { loadMeshDisplay, type MeshDisplay, type MeshDisplayPick } from '../../../mesh';
import { PICK } from '../../../theme';
import type { MarqueeRect } from '../../../types';
import type { ViewportToolHost } from '../../host';
import { selectModeOf } from '../../selectTool';

/** Two presses within this time (ms) and distance (CSS px) on one component make a double-click (§5.6 loop table). */
export const DOUBLE_CLICK_MS = 500;
export const DOUBLE_CLICK_PX = 4;

/** What the display's queries take for a pane (the caller's options of B6's hand-over). */
interface PaneQuery {
  readonly camera: Camera;
  readonly viewport: { readonly w: number; readonly h: number };
  readonly opts: { readonly cameraBased: boolean; readonly backfaces: boolean; readonly wire: boolean };
}

/** The pointer behaviour of the select, move, rotate and scale tools in the Model workspace. */
export interface ModelSelectBehaviour {
  pointerDown(e: ToolPointerEvent): boolean;
  pointerMove(e: ToolPointerEvent): boolean;
  pointerUp(e: ToolPointerEvent): boolean;
  cancel(): void;
}

export async function createModelSelectRuntime(app: EditorApp, vm: ViewportManager): Promise<ModelSelectRuntime> {
  const display = await loadMeshDisplay({ app, target: vm, theme: vm.renderer.domElement });
  return new ModelSelectRuntime(app, vm, display);
}

const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchC = new Vector3();
const scratchHit = new Vector3();
const scratchMatrix = new Matrix4();
const scratchRay = new Ray();

export class ModelSelectRuntime {
  readonly display: MeshDisplay;
  private readonly disposers: Disposer[] = [];
  /** Pane-local pointer position while over a pane (hover), null outside. */
  private hoverAt: { paneId: string; x: number; y: number } | null = null;
  /** The last press per pane (pane-local), for the RMB mode menu's mesh. */
  private readonly pressAt = new Map<string, { x: number; y: number }>();
  private lastKey: string | null = null;
  /** Face isolate sets pushed to the display, per pane. */
  private readonly pushedIsolates = new Map<string, Set<MeshId>>();
  private disposed = false;

  constructor(
    readonly app: EditorApp,
    readonly vm: ViewportManager,
    display: MeshDisplay,
  ) {
    this.display = display;
    if (typeof window !== 'undefined') {
      const move = (e: PointerEvent): void => this.pointerMoved(e);
      const down = (e: PointerEvent): void => this.pointerPressed(e);
      const key = (e: KeyboardEvent): void => {
        if (!e.repeat || this.lastKey === null) this.lastKey = e.code;
      };
      window.addEventListener('pointermove', move, { capture: true, passive: true });
      window.addEventListener('pointerdown', down, { capture: true, passive: true });
      window.addEventListener('keydown', key, { capture: true, passive: true });
      this.disposers.push(() => {
        window.removeEventListener('pointermove', move, { capture: true });
        window.removeEventListener('pointerdown', down, { capture: true });
        window.removeEventListener('keydown', key, { capture: true });
      });
    }
    this.disposers.push(
      provideModelPointer(app, {
        meshAt: (paneId, at) => this.meshAt(paneId, at),
        lastKey: () => this.lastKey,
      }),
      app.components.subscribe(() => this.syncIsolates()),
      app.session.subscribe((state, previous) => {
        if (
          state.workspace !== previous.workspace ||
          state.model.componentMode !== previous.model.componentMode ||
          state.model.hilite !== previous.model.hilite
        ) {
          this.display.setHover(null, null);
        }
        if (state.model.isolate !== previous.model.isolate) this.syncIsolates();
      }),
      () => display.dispose(),
    );
    vm.setFrameBounds((what) => this.frameBounds(what));
    this.disposers.push(() => vm.setFrameBounds(null));
    this.syncIsolates();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // pane queries

  private kind(): ComponentKind | null {
    const state = this.app.session.getState();
    if (state.workspace !== 'model') return null;
    const mode = state.model.componentMode;
    return mode === 'object' ? null : mode;
  }

  /** The camera, size and picking options of a pane (§5.6 camera-based `auto`, back faces, wire dots). */
  query(paneId: string): PaneQuery | null {
    const view = this.vm.paneView(paneId);
    if (view === null) return null;
    const model = this.app.session.getState().model;
    const flags = view.display;
    const wire = flags.shading === 'wire';
    const cameraBased = model.cameraBased === 'on' || (model.cameraBased === 'auto' && !wire && !flags.xray);
    const backfaces = (flags.xray || model.backfaces) && !flags.cull;
    return { camera: view.camera, viewport: { w: view.width, h: view.height }, opts: { cameraBased, backfaces, wire } };
  }

  /** The component of `kind` under a pane point (hilited meshes only), or null. */
  pickComponent(paneId: string, x: number, y: number, kind: ComponentKind): MeshDisplayPick | null {
    const q = this.query(paneId);
    if (q === null) return null;
    const ndc: [number, number] = [(x / q.viewport.w) * 2 - 1, 1 - (y / q.viewport.h) * 2];
    return this.display.pick(q.camera, ndc, q.viewport, kind, q.opts, paneId);
  }

  /** The components of `kind` inside a pane rectangle, per hilited mesh. */
  marqueeComponents(paneId: string, rect: MarqueeRect, kind: ComponentKind): ReadonlyMap<MeshId, Uint32Array> {
    const q = this.query(paneId);
    if (q === null) return new Map();
    return this.display.marquee(q.camera, rect, q.viewport, kind, q.opts, paneId);
  }

  /** Pane CSS px of a component of a hilited mesh (null when not visible there). */
  screenOf(mesh: MeshId, kind: ComponentKind, index: number, paneId: string, t = 0.5): { x: number; y: number } | null {
    const q = this.query(paneId);
    if (q === null) return null;
    const point = this.display.screenOf(mesh, q.camera, q.viewport, kind, index, q.opts, paneId, t);
    return point === null ? null : { x: point.x, y: point.y };
  }

  /** The mesh object whose visible faces a pane ray at (x, y) hits first, or null. */
  pickObject(paneId: string, x: number, y: number): MeshId | null {
    const q = this.query(paneId);
    if (q === null) return null;
    const ndcX = (x / q.viewport.w) * 2 - 1;
    const ndcY = 1 - (y / q.viewport.h) * 2;
    const camera = q.camera;
    const origin = scratchA.setFromMatrixPosition(camera.matrixWorld);
    const target = scratchB.set(ndcX, ndcY, 0.5).unproject(camera);
    if ((camera as { readonly isOrthographicCamera?: boolean }).isOrthographicCamera === true) {
      origin.set(ndcX, ndcY, -1).unproject(camera);
      target.set(ndcX, ndcY, 1).unproject(camera);
    }
    const worldRay = new Ray(origin.clone(), target.sub(origin).normalize());
    let best: MeshId | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const id of objectsDrawnIn(this.app, paneId) as MeshId[]) {
      const distance = this.rayDistance(id, worldRay);
      if (distance !== null && distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** World distance along `ray` to the first visible face of a mesh, or null. */
  private rayDistance(id: MeshId, ray: Ray): number | null {
    const runtime = this.app.meshes.get(id);
    const world = this.display.worldOf(id);
    const data = runtime?.state === 'ready' ? runtime.data() : null;
    if (runtime === undefined || world === null || data === null) return null;
    const tri = runtime.triangulation();
    let hidden: BitSet | null = null;
    try {
      const faces = this.app.components.hidden(id).faces;
      hidden = faces.isEmpty() ? null : faces;
    } catch {
      hidden = null;
    }
    const m = scratchMatrix.fromArray(world);
    const inverse = m.clone().invert();
    const local = scratchRay.copy(ray).applyMatrix4(inverse);
    const p = data.position;
    let nearest: number | null = null;
    const count = tri.triFace.length;
    for (let t = 0; t < count; t++) {
      if (hidden !== null && hidden.has(tri.triFace[t] as number)) continue;
      const a = tri.tris[3 * t] as number;
      const b = tri.tris[3 * t + 1] as number;
      const c = tri.tris[3 * t + 2] as number;
      scratchA.set(p[3 * a] as number, p[3 * a + 1] as number, p[3 * a + 2]);
      scratchB.set(p[3 * b] as number, p[3 * b + 1] as number, p[3 * b + 2]);
      scratchC.set(p[3 * c] as number, p[3 * c + 1] as number, p[3 * c + 2]);
      const hit = local.intersectTriangle(scratchA, scratchB, scratchC, false, scratchHit);
      if (hit === null) continue;
      const d = hit.applyMatrix4(m).distanceTo(ray.origin);
      if (nearest === null || d < nearest) nearest = d;
    }
    return nearest;
  }

  /** Mesh objects with a visible vertex inside a pane rectangle (object-mode marquee). */
  marqueeObjects(paneId: string, rect: MarqueeRect): MeshId[] {
    const q = this.query(paneId);
    if (q === null) return [];
    const x0 = Math.min(rect.x0, rect.x1);
    const x1 = Math.max(rect.x0, rect.x1);
    const y0 = Math.min(rect.y0, rect.y1);
    const y1 = Math.max(rect.y0, rect.y1);
    const out: MeshId[] = [];
    const camera = q.camera;
    camera.updateMatrixWorld();
    const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (const id of objectsDrawnIn(this.app, paneId) as MeshId[]) {
      const runtime = this.app.meshes.get(id);
      const world = this.display.worldOf(id);
      const data = runtime?.state === 'ready' ? runtime.data() : null;
      if (world === null || data === null || data === undefined) continue;
      const mvp = new Matrix4().multiplyMatrices(viewProjection, new Matrix4().fromArray(world));
      const p = data.position;
      for (let v = 0; v < data.counts.points; v++) {
        scratchA.set(p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2]).applyMatrix4(mvp);
        if (scratchA.z < -1 || scratchA.z > 1) continue;
        const sx = ((scratchA.x + 1) / 2) * q.viewport.w;
        const sy = ((1 - scratchA.y) / 2) * q.viewport.h;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) {
          out.push(id);
          break;
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // pointer tracking (hover pre-selection, the operators' probe)

  private paneLocal(clientX: number, clientY: number): { paneId: string; x: number; y: number } | null {
    const paneId = this.vm.paneAt(clientX, clientY);
    const rect = paneId === null ? null : this.vm.paneRect(paneId);
    if (paneId === null || rect === null) return null;
    return { paneId, x: clientX - rect.x, y: clientY - rect.y };
  }

  private pointerMoved(e: PointerEvent): void {
    const at = this.paneLocal(e.clientX, e.clientY);
    this.hoverAt = at;
    if (e.buttons !== 0) return;
    const kind = this.kind();
    if (kind === null || at === null) {
      this.display.setHover(null, null);
      return;
    }
    const hit = this.pickComponent(at.paneId, at.x, at.y, kind);
    this.display.setHover(hit?.mesh ?? null, hit === null ? null : { kind: hit.kind, index: hit.index });
  }

  private pointerPressed(e: PointerEvent): void {
    const at = this.paneLocal(e.clientX, e.clientY);
    if (at !== null) this.pressAt.set(at.paneId, { x: at.x, y: at.y });
    this.display.setHover(null, null);
  }

  private meshAt(paneId: string | null, at: 'press' | 'hover'): MeshId | null {
    const hover = this.hoverAt;
    const pane = paneId ?? hover?.paneId ?? null;
    if (pane === null) return null;
    const point = at === 'press' ? (this.pressAt.get(pane) ?? null) : hover?.paneId === pane ? hover : null;
    return point === null ? null : this.pickObject(pane, point.x, point.y);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // framing and isolate

  /** World positions of the visible selected components of the hilited meshes (expanded by symmetry). */
  private selectionPoints(): Float32Array[] {
    const kind = this.kind();
    const internals = componentInternals(this.app.components);
    if (kind === null || internals === null) return [];
    const out: Float32Array[] = [];
    for (const id of this.app.session.getState().model.hilite) {
      const sel = internals.expanded(id, kind);
      const mesh = this.app.meshes.get(id)?.mesh ?? null;
      const world = this.display.worldOf(id);
      if (sel === null || mesh === null || world === null) continue;
      const verts = new Set<number>();
      if (kind === 'vertex') sel.verts.forEach((v) => verts.add(v));
      else if (kind === 'edge') {
        sel.edges.forEach((e) => {
          verts.add(mesh.edgeVert(e, 0));
          verts.add(mesh.edgeVert(e, 1));
        });
      } else {
        sel.faces.forEach((f) => {
          const first = mesh.faceCorner(f);
          let c = first;
          do {
            verts.add(mesh.cornerVert(c));
            c = mesh.cornerNext(c);
          } while (c !== first && c >= 0);
        });
      }
      if (verts.size > 0) out.push(worldPoints(mesh.position, [...verts], world));
    }
    return out;
  }

  /** World positions of every vertex of meshes (their stored revisions). */
  private meshPoints(ids: readonly string[]): Float32Array[] {
    const out: Float32Array[] = [];
    for (const id of ids as MeshId[]) {
      const data = this.app.meshes.get(id)?.data() ?? null;
      const world = this.display.worldOf(id);
      if (data === null || world === null || data.counts.points === 0) continue;
      const all = Array.from({ length: data.counts.points }, (_, i) => i);
      out.push(worldPoints(data.position, all, world));
    }
    return out;
  }

  private frameBounds(what: 'selection' | 'all'): SpatialBounds | null {
    const state = this.app.session.getState();
    if (state.workspace !== 'model') return null;
    if (what === 'selection') {
      const components = bounds(this.selectionPoints());
      if (components !== null) return components;
      const objects = bounds(this.meshPoints(state.selection.objects));
      if (objects !== null) return objects;
    }
    return bounds(this.meshPoints(this.app.meshes.list().map((runtime) => runtime.id)));
  }

  /** Pushes `view.isolate`'s face sets; a set of another face count (a topology change) ends that mesh's isolate. */
  private syncIsolates(): void {
    const internals = componentInternals(this.app.components);
    if (internals === null) return;
    const isolate = this.app.session.getState().model.isolate;
    const panes = new Set<string>([...this.pushedIsolates.keys(), ...Object.keys(isolate)]);
    for (const pane of panes) {
      const wanted = isolate[pane] === null || isolate[pane] === undefined ? null : internals.faceIsolate(pane);
      const pushed = this.pushedIsolates.get(pane) ?? new Set<MeshId>();
      const next = new Set<MeshId>();
      let stale = false;
      for (const [mesh, faces] of wanted ?? []) {
        const count = this.app.meshes.get(mesh)?.mesh?.counts.faces ?? this.app.meshes.get(mesh)?.data()?.counts.faces;
        if (count !== faces.size) {
          stale = true;
          continue;
        }
        this.display.setFaceIsolate(pane, mesh, faces);
        next.add(mesh);
      }
      for (const mesh of pushed) if (!next.has(mesh)) this.display.setFaceIsolate(pane, mesh, null);
      if (next.size === 0) this.pushedIsolates.delete(pane);
      else this.pushedIsolates.set(pane, next);
      if (stale && wanted !== null) {
        const kept = new Map([...wanted].filter(([mesh]) => next.has(mesh)));
        internals.setFaceIsolate(pane, kept.size === 0 ? null : kept);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the select tool's Model behaviour

  /** The Model pointer behaviour shared by the select, move, rotate and scale tools (their misses select). */
  behaviour(host: ViewportToolHost): ModelSelectBehaviour {
    return new ModelPointer(this, host);
  }
}

/** World positions of some vertices of a mesh (column-major world matrix). */
function worldPoints(position: Readonly<Float32Array>, verts: readonly number[], world: Float64Array): Float32Array {
  const out = new Float32Array(3 * verts.length);
  const m = world;
  verts.forEach((v, i) => {
    const x = position[3 * v] as number;
    const y = position[3 * v + 1] as number;
    const z = position[3 * v + 2] as number;
    out[3 * i] = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
    out[3 * i + 1] = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
    out[3 * i + 2] = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
  });
  return out;
}

function bounds(points: readonly Float32Array[]): SpatialBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const array of points) {
    for (let i = 0; i + 2 < array.length; i += 3) {
      const x = array[i] as number;
      const y = array[i + 1] as number;
      const z = array[i + 2] as number;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  if (minX > maxX) return null;
  // A single point (or a flat set) still frames: pad degenerate extents to 10 cm.
  const pad = (lo: number, hi: number): [number, number] => (hi - lo < 1e-4 ? [lo - 0.05, hi + 0.05] : [lo, hi]);
  [minX, maxX] = pad(minX, maxX);
  [minY, maxY] = pad(minY, maxY);
  [minZ, maxZ] = pad(minZ, maxZ);
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

interface Press {
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly mode: SelectMode;
  readonly double: boolean;
  readonly shift: boolean;
  readonly mod: boolean;
  marquee: boolean;
}

/**
 * Click, double-click and marquee in Model (§5.6): component modes select components of the hilited meshes
 * (`select.components`, one step per gesture; the loop table on double-clicks through `select.mesh.loop`), object mode
 * selects mesh objects (`select.objects`). Modifiers as in Animate: click replaces, Shift toggles, Mod removes,
 * Mod+Shift adds; a click on empty space clears the current mode's selection on the hilited meshes.
 */
class ModelPointer implements ModelSelectBehaviour {
  private press: Press | null = null;
  private last: {
    readonly paneId: string;
    readonly x: number;
    readonly y: number;
    readonly at: number;
    readonly hit: string | null;
    /** The modifiers of the first click: a double-click repeats them (Shift/Mod double-clicks, §5.6). */
    readonly mode: SelectMode;
  } | null = null;

  constructor(
    private readonly runtime: ModelSelectRuntime,
    private readonly host: ViewportToolHost,
  ) {}

  private get app(): EditorApp {
    return this.runtime.app;
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.paneId === null) return false;
    const last = this.last;
    const double =
      last !== null &&
      last.paneId === e.paneId &&
      last.mode === selectModeOf(e) &&
      e.timeStamp - last.at <= DOUBLE_CLICK_MS &&
      Math.hypot(e.x - last.x, e.y - last.y) <= DOUBLE_CLICK_PX;
    this.press = {
      paneId: e.paneId,
      x: e.x,
      y: e.y,
      mode: selectModeOf(e),
      double,
      shift: e.shift,
      mod: e.mod,
      marquee: false,
    };
    return true;
  }

  pointerMove(e: ToolPointerEvent): boolean {
    const press = this.press;
    if (press === null) return false;
    if (!press.marquee && Math.hypot(e.x - press.x, e.y - press.y) >= PICK.marqueeMinPx) press.marquee = true;
    if (press.marquee) this.host.setMarquee(press.paneId, { x0: press.x, y0: press.y, x1: e.x, y1: e.y });
    return true;
  }

  pointerUp(e: ToolPointerEvent): boolean {
    const press = this.press;
    if (press === null) return false;
    this.press = null;
    if (press.marquee) {
      this.host.setMarquee(press.paneId, null);
      this.last = null;
      this.marquee(press, { x0: press.x, y0: press.y, x1: e.x, y1: e.y });
      return true;
    }
    this.click(press, e.timeStamp);
    return true;
  }

  cancel(): void {
    if (this.press?.marquee === true) this.host.setMarquee(this.press.paneId, null);
    this.press = null;
  }

  private kind(): ComponentKind | null {
    const mode = this.app.session.getState().model.componentMode;
    return mode === 'object' ? null : mode;
  }

  private run(op: string, args: unknown, paneId: string, repeat = false): void {
    void this.app.runUntyped(op, args, { panel: 'viewport', paneId, source: 'tool', ...(repeat ? { repeat } : {}) });
  }

  private click(press: Press, at: number): void {
    const kind = this.kind();
    if (kind === null) {
      this.last = null;
      const mesh = this.runtime.pickObject(press.paneId, press.x, press.y);
      if (mesh !== null) this.run('select.objects', { ids: [mesh], mode: press.mode }, press.paneId);
      else if (press.mode === 'replace') this.run('select.objects', { ids: [], mode: 'replace' }, press.paneId);
      return;
    }
    const hit = this.runtime.pickComponent(press.paneId, press.x, press.y, kind);
    const key = hit === null ? null : `${hit.mesh}:${hit.kind}:${hit.index}`;
    const previous = this.last;
    if (press.double && hit !== null && previous?.hit === key) {
      // The second press of a double-click on the same component: Maya's loop table (§5.6).
      this.last = null;
      const gesture = press.mod ? 'mod-double' : press.shift ? 'shift-double' : 'double';
      this.run('select.mesh.loop', { mesh: hit.mesh, kind: hit.kind, component: hit.index, gesture }, press.paneId);
      return;
    }
    this.last = { paneId: press.paneId, x: press.x, y: press.y, at, hit: key, mode: press.mode };
    if (hit !== null) {
      this.run(
        'select.components',
        { mesh: hit.mesh, kind: hit.kind, indices: [hit.index], mode: press.mode, gesture: 'click' },
        press.paneId,
      );
      return;
    }
    const first = this.app.session.getState().model.hilite[0];
    if (press.mode === 'replace' && first !== undefined) {
      this.run(
        'select.components',
        { mesh: first, kind, indices: [], mode: 'replace', gesture: 'click' },
        press.paneId,
      );
    }
  }

  private marquee(press: Press, rect: MarqueeRect): void {
    const kind = this.kind();
    if (kind === null) {
      const ids = this.runtime.marqueeObjects(press.paneId, rect);
      if (ids.length > 0 || press.mode === 'replace')
        this.run('select.objects', { ids, mode: press.mode }, press.paneId);
      return;
    }
    const found = this.runtime.marqueeComponents(press.paneId, rect, kind);
    const hilite = this.app.session.getState().model.hilite;
    const entries = [...found].filter(([mesh]) => hilite.includes(mesh));
    if (entries.length === 0) {
      const first = hilite[0];
      if (press.mode === 'replace' && first !== undefined) {
        this.run(
          'select.components',
          { mesh: first, kind, indices: [], mode: 'replace', gesture: 'marquee' },
          press.paneId,
        );
      }
      return;
    }
    // One gesture, one step: the meshes after the first continue it (`repeat`), adding to the replace.
    entries.forEach(([mesh, indices], i) => {
      const mode: SelectMode = i > 0 && press.mode === 'replace' ? 'add' : press.mode;
      this.run(
        'select.components',
        { mesh, kind, indices: [...indices], mode, gesture: 'marquee' },
        press.paneId,
        i > 0,
      );
    });
  }
}
