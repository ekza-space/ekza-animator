// CPU component picking (M6A-SPEC §4.4, §5.6; research 13 §7.2). A three-mesh-bvh BVH over the visible triangles
// (refit after position commits, rebuilt after topology commits and hidden-set changes, both deferred to the first
// pick) answers ray hits and occlusion; a per-camera projection of the vertices answers vertex and edge distances in
// screen space. Vertex = nearest projected vertex within 8 CSS px; edge = nearest projected segment within 6 px with
// its parameter t from `edgeVert(e, 0)` (an edge with an end behind the camera by its part in front, clipped at the
// near plane as the line shader draws it); face = the BVH ray hit (camera-based off, as in x-ray: the face-centre dot
// within 8 px first; wire shading: the dot only). Camera-based selection tests occlusion against the visible surface
// and against the meshes around this one (`setOccluder`: the other meshes a pane draws, M6A-B6-22); the picker in turn
// occludes for them (`occludes`). Back faces are pickable only with `backfaces` (the caller passes x-ray || the
// Backfaces option, §5.6). Hidden elements are never pickable.
import type { BitSet, ComponentKind, EditMesh, HiddenSet, Triangulation } from '@ekza-animator/mesh-core';
import { BufferAttribute, BufferGeometry, type Camera, DoubleSide, FrontSide, Matrix4, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { localSegment, type PickOccluder, segmentFar } from './internal/occluder';
import { copyHidden, sameHidden, sameSet } from './internal/sets';
import { allVisible, deriveVisibility, type Topo, topoOfEdit, type Visibility } from './internal/topo';
import type { PickHit, PickOptions } from './types';

export type { PickOccluder } from './internal/occluder';

/**
 * `PickOptions` (§4.4; `wire` joined the contract at INT, M6A-B6-1, M6A-B6-7): `wire` = the pane draws no surface
 * (wire shading), so a face is picked by its centre dot only (§5.6 "wireframe: the face-centre dot within 8 px").
 * Absent = false. Back faces follow `backfaces` alone in every shading: the caller passes `xray || Backfaces option`
 * (§5.6). The alias stays for the package's callers.
 */
export type PickOptionsInput = PickOptions;

/** Default pick radii in CSS px (§5.6). */
export const PICK_RADIUS = { vertex: 8, edge: 6, face: 8 } as const;

/** `check-size` marker of the mesh-view chunk (§2): this entry module pulls three-mesh-bvh in, so it names it too. */
const PICKER_MARKER = 'ekza-mesh-view';

type Viewport = { readonly w: number; readonly h: number };
type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpR = new Vector3();
// The world segment handed to an external occluder (only `externallyOccluded` writes them; occluders read them).
const occFrom = new Vector3();
const occTo = new Vector3();

export class ComponentPicker {
  /** The mesh-view chunk's size marker (§2), on every picker. */
  static readonly marker: string = PICKER_MARKER;
  private mesh: EditMesh | null = null;
  private topo: Topo | null = null;
  private tri: Triangulation | null = null;
  private readonly world = new Matrix4();
  private readonly inverse = new Matrix4();
  private positions = new Float32Array(0);
  private vis: Visibility = { verts: new Uint8Array(0), edges: new Uint8Array(0), faces: new Uint8Array(0) };
  private hidden: HiddenSet | null = null;
  /** The pane's face isolate set (`setIsolate`); null = every face. */
  private isolate: BitSet | null = null;
  /** The isolate set the visibility was derived with. */
  private isolateUsed: BitSet | null = null;
  private visValid = false;
  private bvh: MeshBVH | null = null;
  private geometry: BufferGeometry | null = null;
  private bvhIndex = new Uint32Array(0);
  private bvhTriFace = new Uint32Array(0);
  private bvhTriSource = new Uint32Array(0);
  private bvhState: 'ready' | 'refit' | 'rebuild' = 'rebuild';
  private version = 0;
  // Projection cache: per vertex screen x, y (CSS px) and NDC depth (−1 near … 1 far, perspective and orthographic);
  // NaN x = not projectable (behind the camera or outside the near/far range).
  private screen = new Float32Array(0);
  private readonly projKey = new Float64Array(20).fill(Number.NaN);
  private readonly mvp = new Matrix4();
  private readonly ray = new Ray();
  private readonly cameraLocal = new Vector3();
  private readonly forwardLocal = new Vector3();
  private orthographic = false;
  /** The meshes around this one, consulted by camera-based tests (`setOccluder`). */
  private occluder: PickOccluder | null = null;
  // Scratch of `occludes` (this picker as another picker's occluder; never the module scratch the caller holds).
  private readonly occRay = new Ray();
  private readonly occA = new Vector3();
  private readonly occB = new Vector3();
  /** `clipEdge`'s result: screen x, y of both clipped ends, the nearer NDC depth, the kept edge interval t0…t1. */
  private readonly clipped = new Float64Array(7);

  /**
   * The mesh to pick on, its triangulation and its column-major world-from-local matrix. `topologyChanged` (a
   * topology commit) rebuilds the BVH at the next pick; otherwise it is refit (positions only).
   */
  setMesh(mesh: EditMesh, tri: Triangulation, world: Float64Array, topologyChanged: boolean): void {
    const c = mesh.counts;
    const t = this.topo;
    const rebuild =
      topologyChanged ||
      t === null ||
      mesh !== this.mesh ||
      c.points !== t.points ||
      c.edges !== t.edges ||
      c.faces !== t.faces ||
      c.corners !== t.corners;
    if (rebuild) {
      this.topo = topoOfEdit(mesh);
      this.vis = allVisible(this.topo);
      this.visValid = false;
      this.bvhState = 'rebuild';
      this.positions = new Float32Array(3 * c.points);
    } else if (this.bvhState === 'ready') {
      this.bvhState = 'refit';
    }
    this.mesh = mesh;
    this.tri = tri;
    const p = mesh.position;
    const n = 3 * c.points;
    if (p.length === n) this.positions.set(p);
    else this.positions.set(p.subarray(0, n));
    this.world.fromArray(world);
    this.inverse.copy(this.world).invert();
    this.version++;
  }

  /**
   * A new column-major world-from-local matrix for the same mesh (an object moved): the BVH lives in mesh-local space,
   * so nothing is refit; the projection cache follows the matrix by itself.
   */
  setWorld(world: Float64Array): void {
    this.world.fromArray(world);
    this.inverse.copy(this.world).invert();
  }

  /**
   * Picks only `faces` (and the edges and vertices they use) from now on: a pane's face-mode isolate (`view.isolate`,
   * §5.6), the same rule `EditMeshView.setIsolate` draws with. null picks every face again; a set of another topology
   * (its size is not the face count) isolates nothing. The set is copied: later in-place changes need another call.
   */
  setIsolate(faces: BitSet | null): void {
    this.isolate = faces === null ? null : faces.clone();
  }

  /**
   * What hides this mesh's components besides its own surface (camera-based tests only; §5.6): the other meshes the
   * pane draws, as the host (`MeshDisplay`) collects them for one pane query. null = this mesh only. The host sets it
   * before a query and clears it after.
   */
  setOccluder(occluder: PickOccluder | null): void {
    this.occluder = occluder;
  }

  /**
   * True when a visible triangle of this mesh crosses the world segment `from`–`to` short of a 1e-4 margin at `to`:
   * this mesh hiding another mesh's component (M6A-B6-22). It uses the visibility of the last query or `prepareBvh`
   * call (hidden set, the face isolate set of `setIsolate`), so the host prepares it for the pane first.
   */
  occludes(from: Vector3, to: Vector3): boolean {
    if (this.topo === null || this.tri === null) return false;
    const bvh = this.ensureBvh();
    if (bvh === null) return false;
    const far = localSegment(this.inverse, from, to, this.occRay, this.occA, this.occB);
    return far > 0 && bvh.raycastFirst(this.occRay, DoubleSide, 0, far) !== null;
  }

  /** The face isolate set in effect for the current topology (null when none or of another topology). */
  private isolateInEffect(): BitSet | null {
    const t = this.topo;
    return this.isolate !== null && t !== null && this.isolate.size === t.faces ? this.isolate : null;
  }

  /** The visibility (hidden set, isolate set) the BVH and the projections were built for; changes rebuild the BVH. */
  private syncHidden(hidden: HiddenSet | null): void {
    const t = this.topo;
    if (t === null) return;
    const isolate = this.isolateInEffect();
    if (this.visValid && sameHidden(hidden, this.hidden) && sameSet(isolate, this.isolateUsed)) return;
    this.hidden = copyHidden(hidden);
    this.isolateUsed = isolate;
    deriveVisibility(t, hidden, isolate, this.vis);
    this.visValid = true;
    this.bvhState = 'rebuild';
    this.version++;
  }

  private ensureBvh(): MeshBVH | null {
    const t = this.topo;
    const tri = this.tri;
    if (t === null || tri === null) return null;
    if (this.bvhState === 'ready') return this.bvh;
    if (this.bvhState === 'refit' && this.bvh !== null && this.geometry !== null) {
      // The triangulation of a quad can flip with its positions (§5.4): rewrite changed triangles, then refit.
      const index = this.bvhIndex;
      for (let k = 0; k < this.bvhTriSource.length; k++) {
        const src = 3 * (this.bvhTriSource[k] as number);
        for (let j = 0; j < 3; j++) index[3 * k + j] = t.cv[tri.tris[src + j] as number] as number;
      }
      (this.geometry.index as BufferAttribute).needsUpdate = true;
      (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
      this.bvh.refit();
      this.bvhState = 'ready';
      return this.bvh;
    }
    this.geometry?.dispose();
    this.geometry = null;
    this.bvh = null;
    const triangles = tri.triFace.length;
    const source: number[] = [];
    for (let k = 0; k < triangles; k++) if (this.vis.faces[tri.triFace[k] as number] === 1) source.push(k);
    this.bvhTriSource = Uint32Array.from(source);
    this.bvhTriFace = new Uint32Array(source.length);
    this.bvhIndex = new Uint32Array(3 * source.length);
    for (let k = 0; k < source.length; k++) {
      const s = source[k] as number;
      this.bvhTriFace[k] = tri.triFace[s] as number;
      for (let j = 0; j < 3; j++) this.bvhIndex[3 * k + j] = t.cv[tri.tris[3 * s + j] as number] as number;
    }
    this.bvhState = 'ready';
    if (source.length === 0) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setIndex(new BufferAttribute(this.bvhIndex, 1));
    this.geometry = geometry;
    this.bvh = new MeshBVH(geometry, { indirect: true });
    return this.bvh;
  }

  /** Projects every vertex for `camera` (cached until the camera, viewport, mesh or visibility changes). */
  private project(camera: Camera, viewport: Viewport): void {
    const t = this.topo;
    if (t === null) return;
    this.mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.world);
    const e = this.mvp.elements;
    const key = this.projKey;
    let same = key[16] === viewport.w && key[17] === viewport.h && key[18] === this.version;
    for (let i = 0; i < 16 && same; i++) same = key[i] === e[i];
    if (same && this.screen.length === 3 * t.points) return;
    for (let i = 0; i < 16; i++) key[i] = e[i] as number;
    key[16] = viewport.w;
    key[17] = viewport.h;
    key[18] = this.version;
    if (this.screen.length !== 3 * t.points) this.screen = new Float32Array(3 * t.points);
    const s = this.screen;
    const p = this.positions;
    const m0 = e[0];
    const m1 = e[1];
    const m2 = e[2];
    const m3 = e[3];
    const m4 = e[4];
    const m5 = e[5];
    const m6 = e[6];
    const m7 = e[7];
    const m8 = e[8];
    const m9 = e[9];
    const m10 = e[10];
    const m11 = e[11];
    const m12 = e[12];
    const m13 = e[13];
    const m14 = e[14];
    const m15 = e[15];
    for (let v = 0; v < t.points; v++) {
      const x = p[3 * v] as number;
      const y = p[3 * v + 1] as number;
      const z = p[3 * v + 2] as number;
      const w = m3 * x + m7 * y + m11 * z + m15;
      const cz = m2 * x + m6 * y + m10 * z + m14;
      if (!(w > 1e-9) || cz < -w || cz > w) {
        s[3 * v] = Number.NaN;
        continue;
      }
      const cx = m0 * x + m4 * y + m8 * z + m12;
      const cy = m1 * x + m5 * y + m9 * z + m13;
      s[3 * v] = ((cx / w + 1) / 2) * viewport.w;
      s[3 * v + 1] = ((1 - cy / w) / 2) * viewport.h;
      s[3 * v + 2] = cz / w;
    }
  }

  /** Camera position and forward direction in mesh-local space. */
  private cameraInLocal(camera: Camera): void {
    this.orthographic = (camera as { readonly isOrthographicCamera?: boolean }).isOrthographicCamera === true;
    const m = camera.matrixWorld.elements;
    this.forwardLocal.set(-m[8], -m[9], -m[10]).transformDirection(this.inverse);
    this.cameraLocal.set(m[12], m[13], m[14]).applyMatrix4(this.inverse);
  }

  /**
   * The local ray from the camera towards local point `p` (orthographic: along the view direction from the camera
   * plane); returns the distance to it.
   */
  private rayTo(p: Vector3): number {
    if (this.orthographic) {
      const d = Math.max(0, tmpR.subVectors(p, this.cameraLocal).dot(this.forwardLocal));
      this.ray.direction.copy(this.forwardLocal);
      this.ray.origin.copy(p).addScaledVector(this.forwardLocal, -d);
      return d;
    }
    this.ray.origin.copy(this.cameraLocal);
    this.ray.direction.subVectors(p, this.cameraLocal);
    const d = this.ray.direction.length();
    if (d > 0) this.ray.direction.divideScalar(d);
    return d;
  }

  private faceHas(f: number, kind: ComponentKind, index: number): boolean {
    const t = this.topo as Topo;
    if (kind === 'face') return f === index;
    for (let i = t.fstart[f] as number; i < (t.fstart[f + 1] as number); i++) {
      const c = t.fcorners[i] as number;
      if (kind === 'vertex' ? t.cv[c] === index : t.ce !== null && t.ce[c] === index) return true;
    }
    return false;
  }

  /**
   * True when nothing visible covers local point `p` of element (kind, index) from the camera: no visible triangle of
   * this mesh is hit before 0.9999 × its distance (or the hit face contains the element), and no mesh around it
   * (`setOccluder`) crosses the same segment.
   */
  private unoccluded(p: Vector3, kind: ComponentKind, index: number): boolean {
    const bvh = this.ensureBvh();
    const far = segmentFar(this.rayTo(p));
    if (!(far > 0)) return true;
    if (bvh !== null) {
      const hit = bvh.raycastFirst(this.ray, DoubleSide, 0, far);
      if (hit !== null && !this.faceHas(this.bvhTriFace[hit.faceIndex ?? 0] as number, kind, index)) return false;
    }
    return !this.externallyOccluded(this.ray.origin, p);
  }

  /** Whether a mesh around this one (`setOccluder`) crosses the local segment `from`–`to` (mapped to world). */
  private externallyOccluded(from: Vector3, to: Vector3): boolean {
    const occluder = this.occluder;
    if (occluder === null) return false;
    occFrom.copy(from).applyMatrix4(this.world);
    occTo.copy(to).applyMatrix4(this.world);
    return occluder.occludes(occFrom, occTo);
  }

  private local(v: number, out: Vector3): Vector3 {
    const p = this.positions;
    return out.set(p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2]);
  }

  private faceCentroid(f: number, out: Vector3): Vector3 {
    const t = this.topo as Topo;
    out.set(0, 0, 0);
    const start = t.fstart[f] as number;
    const end = t.fstart[f + 1] as number;
    for (let i = start; i < end; i++) {
      const v = 3 * (t.cv[t.fcorners[i] as number] as number);
      out.x += this.positions[v] as number;
      out.y += this.positions[v + 1] as number;
      out.z += this.positions[v + 2] as number;
    }
    return out.divideScalar(Math.max(1, end - start));
  }

  /** Front-facing test of face f for the current camera (Newell normal against the view direction at `at`). */
  private frontFacing(f: number, at: Vector3): boolean {
    const t = this.topo as Topo;
    const p = this.positions;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const start = t.fstart[f] as number;
    const end = t.fstart[f + 1] as number;
    for (let i = start; i < end; i++) {
      const a = 3 * (t.cv[t.fcorners[i] as number] as number);
      const b = 3 * (t.cv[t.fcorners[i + 1 < end ? i + 1 : start] as number] as number);
      nx += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
      ny += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
      nz += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
    }
    if (this.orthographic) return nx * this.forwardLocal.x + ny * this.forwardLocal.y + nz * this.forwardLocal.z < 0;
    return nx * (at.x - this.cameraLocal.x) + ny * (at.y - this.cameraLocal.y) + nz * (at.z - this.cameraLocal.z) < 0;
  }

  private prepare(camera: Camera, viewport: Viewport, opts: PickOptions): boolean {
    if (this.topo === null || this.tri === null) return false;
    this.syncHidden(opts.hidden);
    this.project(camera, viewport);
    this.cameraInLocal(camera);
    return true;
  }

  private worldPoint(p: Vector3): readonly [number, number, number] {
    tmpC.copy(p).applyMatrix4(this.world);
    return [tmpC.x, tmpC.y, tmpC.z];
  }

  /** The candidate of `kind` under `ndc` (pointer in normalized device coordinates of the pane), or null. */
  hover(
    camera: Camera,
    ndc: readonly [number, number],
    viewport: { readonly w: number; readonly h: number },
    kind: ComponentKind,
    opts: PickOptionsInput,
  ): PickHit | null {
    if (!this.prepare(camera, viewport, opts)) return null;
    const px = ((ndc[0] + 1) / 2) * viewport.w;
    const py = ((1 - ndc[1]) / 2) * viewport.h;
    if (kind === 'vertex') return this.hoverVertex(px, py, opts.radiusPx ?? PICK_RADIUS.vertex, opts);
    if (kind === 'edge') return this.hoverEdge(camera, ndc, viewport, px, py, opts.radiusPx ?? PICK_RADIUS.edge, opts);
    return this.hoverFace(camera, ndc, viewport, px, py, opts);
  }

  private hoverVertex(px: number, py: number, radius: number, opts: PickOptions): PickHit | null {
    const t = this.topo as Topo;
    const s = this.screen;
    const r2 = radius * radius;
    const found: number[] = [];
    for (let v = 0; v < t.points; v++) {
      if (this.vis.verts[v] !== 1) continue;
      const dx = (s[3 * v] as number) - px;
      if (!(dx * dx <= r2)) continue;
      const dy = (s[3 * v + 1] as number) - py;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) found.push(d2, v);
    }
    const order = this.sortCandidates(found, (v) => s[3 * v + 2] as number);
    for (const k of order) {
      const v = found[2 * k + 1] as number;
      const p = this.local(v, tmpA);
      if (opts.cameraBased && !this.unoccluded(p, 'vertex', v)) continue;
      return {
        kind: 'vertex',
        index: v,
        t: null,
        point: this.worldPoint(p),
        distancePx: Math.sqrt(found[2 * k] as number),
      };
    }
    return null;
  }

  /** Candidate order: distance, then depth (nearer first), then index. `found` holds (distance², index) pairs. */
  private sortCandidates(found: readonly number[], depth: (i: number) => number): number[] {
    const order = Array.from({ length: found.length / 2 }, (_, k) => k);
    order.sort((a, b) => {
      const da = found[2 * a] as number;
      const db = found[2 * b] as number;
      if (Math.abs(da - db) > 1e-9) return da - db;
      const ia = found[2 * a + 1] as number;
      const ib = found[2 * b + 1] as number;
      const za = depth(ia);
      const zb = depth(ib);
      if (za !== zb) return za - zb;
      return ia - ib;
    });
    return order;
  }

  /**
   * Edge `e` clipped to the near and far planes in clip space (the GPU clips the drawn line the same way; the line
   * shader trims it at the near plane): for an edge with an end the per-vertex projection cannot place (behind the
   * camera, beyond the far plane). Writes `clipped` and returns true when a part of the edge lies in the depth range.
   */
  private clipEdge(e: number, viewport: Viewport): boolean {
    const t = this.topo as Topo;
    const m = this.mvp.elements;
    const p = this.positions;
    const a = 3 * (t.ev[2 * e] as number);
    const b = 3 * (t.ev[2 * e + 1] as number);
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const az = p[a + 2] as number;
    const bx = p[b] as number;
    const by = p[b + 1] as number;
    const bz = p[b + 2] as number;
    const aw = clipRow(m, 3, ax, ay, az);
    const bw = clipRow(m, 3, bx, by, bz);
    const acz = clipRow(m, 2, ax, ay, az);
    const bcz = clipRow(m, 2, bx, by, bz);
    let t0 = 0;
    let t1 = 1;
    // Near (z ≥ −w) and far (z ≤ w), as signed distances at both ends (Liang–Barsky).
    for (let k = 0; k < 2; k++) {
      const da = k === 0 ? acz + aw : aw - acz;
      const db = k === 0 ? bcz + bw : bw - bcz;
      if (da < 0 && db < 0) return false;
      if (da < 0) t0 = Math.max(t0, da / (da - db));
      else if (db < 0) t1 = Math.min(t1, da / (da - db));
    }
    if (!(t0 <= t1)) return false;
    const out = this.clipped;
    let depth = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 2; k++) {
      const u = k === 0 ? t0 : t1;
      const x = ax + (bx - ax) * u;
      const y = ay + (by - ay) * u;
      const z = az + (bz - az) * u;
      const w = clipRow(m, 3, x, y, z);
      if (!(w > 1e-9)) return false;
      out[2 * k] = ((clipRow(m, 0, x, y, z) / w + 1) / 2) * viewport.w;
      out[2 * k + 1] = ((1 - clipRow(m, 1, x, y, z) / w) / 2) * viewport.h;
      depth = Math.min(depth, clipRow(m, 2, x, y, z) / w);
    }
    out[4] = depth;
    out[5] = t0;
    out[6] = t1;
    return true;
  }

  private hoverEdge(
    camera: Camera,
    ndc: readonly [number, number],
    viewport: Viewport,
    px: number,
    py: number,
    radius: number,
    opts: PickOptions,
  ): PickHit | null {
    const t = this.topo as Topo;
    const s = this.screen;
    const found: number[] = [];
    const r2 = radius * radius;
    const clipped = this.clipped;
    for (let e = 0; e < t.edges; e++) {
      if (this.vis.edges[e] !== 1) continue;
      const a = 3 * (t.ev[2 * e] as number);
      const b = 3 * (t.ev[2 * e + 1] as number);
      let ax = s[a] as number;
      let bx = s[b] as number;
      let ay: number;
      let by: number;
      if (Number.isNaN(ax) || Number.isNaN(bx)) {
        // An end outside the depth range: the part of the edge the pane draws (close-up perspective views).
        if (!this.clipEdge(e, viewport)) continue;
        ax = clipped[0] as number;
        ay = clipped[1] as number;
        bx = clipped[2] as number;
        by = clipped[3] as number;
      } else {
        ay = s[a + 1] as number;
        by = s[b + 1] as number;
      }
      if (Math.min(ax, bx) - radius > px || Math.max(ax, bx) + radius < px) continue;
      if (Math.min(ay, by) - radius > py || Math.max(ay, by) + radius < py) continue;
      const d2 = segmentDistance2(px, py, ax, ay, bx, by);
      if (d2 <= r2) found.push(d2, e);
    }
    if (found.length === 0) return null;
    // The pick ray in mesh-local space (for the edge parameter at the closest approach).
    const pickRay = this.pickRay(camera, ndc);
    const order = this.sortCandidates(found, (e) => {
      const a = 3 * (t.ev[2 * e] as number);
      const b = 3 * (t.ev[2 * e + 1] as number);
      const za = s[a + 2] as number;
      const zb = s[b + 2] as number;
      if (Number.isNaN(s[a]) || Number.isNaN(s[b])) {
        return this.clipEdge(e, viewport) ? (clipped[4] as number) : Number.POSITIVE_INFINITY;
      }
      return Math.min(za, zb);
    });
    for (const k of order) {
      const e = found[2 * k + 1] as number;
      const A = this.local(t.ev[2 * e] as number, tmpA);
      const B = this.local(t.ev[2 * e + 1] as number, tmpB);
      let param = closestOnSegment(pickRay, A, B);
      // A clipped edge: the point stays on the part in front of the camera.
      const sa = s[3 * (t.ev[2 * e] as number)] as number;
      const sb = s[3 * (t.ev[2 * e + 1] as number)] as number;
      if ((Number.isNaN(sa) || Number.isNaN(sb)) && this.clipEdge(e, viewport)) {
        param = Math.max(clipped[5] as number, Math.min(clipped[6] as number, param));
      }
      const p = tmpC.copy(A).lerp(B, param);
      const point = p.clone();
      if (opts.cameraBased && !this.unoccluded(point, 'edge', e)) continue;
      return {
        kind: 'edge',
        index: e,
        t: param,
        point: this.worldPoint(point),
        distancePx: Math.sqrt(found[2 * k] as number),
      };
    }
    return null;
  }

  private pickRay(camera: Camera, ndc: readonly [number, number]): Ray {
    const origin = new Vector3(ndc[0], ndc[1], -1).unproject(camera);
    const far = new Vector3(ndc[0], ndc[1], 1).unproject(camera);
    const ray = new Ray(origin, far.sub(origin).normalize());
    ray.applyMatrix4(this.inverse);
    ray.direction.normalize();
    return ray;
  }

  private hoverFace(
    camera: Camera,
    ndc: readonly [number, number],
    viewport: Viewport,
    px: number,
    py: number,
    opts: PickOptionsInput,
  ): PickHit | null {
    const radius = opts.radiusPx ?? PICK_RADIUS.face;
    // Wire shading draws no surface to click: the face-centre dot only (§5.6).
    if (opts.wire === true) return this.nearestDot(px, py, viewport, radius, opts);
    if (!opts.cameraBased) {
      const dot = this.nearestDot(px, py, viewport, radius, opts);
      if (dot !== null) return dot;
    }
    const ray = this.pickRay(camera, ndc);
    const hit = this.castFace(ray, opts);
    if (hit === null) return null;
    // The nearest face of this mesh can still lie behind another mesh the pane draws.
    if (opts.cameraBased && this.externallyOccluded(ray.origin, hit.local)) return null;
    return { kind: 'face', index: hit.face, t: null, point: hit.point, distancePx: 0 };
  }

  /**
   * The nearest face-centre dot within `radius` px (ties: lower index) whose face is visible, faces the camera unless
   * `backfaces`, and, camera-based, is not occluded.
   */
  private nearestDot(px: number, py: number, viewport: Viewport, radius: number, opts: PickOptions): PickHit | null {
    const t = this.topo as Topo;
    const r2 = radius * radius;
    const found: number[] = [];
    for (let f = 0; f < t.faces; f++) {
      if (this.vis.faces[f] !== 1) continue;
      const q = this.projectLocal(this.faceCentroid(f, tmpA), viewport);
      if (q === null) continue;
      const d2 = (q.x - px) ** 2 + (q.y - py) ** 2;
      if (d2 <= r2) found.push(d2, f);
    }
    if (found.length === 0) return null;
    const order = this.sortCandidates(found, () => 0);
    for (const k of order) {
      const f = found[2 * k + 1] as number;
      const c = this.faceCentroid(f, tmpA);
      if (!opts.backfaces && !this.frontFacing(f, c)) continue;
      if (opts.cameraBased && !this.unoccluded(c, 'face', f)) continue;
      return {
        kind: 'face',
        index: f,
        t: null,
        point: this.worldPoint(c),
        distancePx: Math.sqrt(found[2 * k] as number),
      };
    }
    return null;
  }

  /** Screen point (CSS px) of local point `p` for the projection of the last `project`, or null when not projectable. */
  private projectLocal(p: Vector3, viewport: Viewport): { x: number; y: number; w: number } | null {
    const e = this.mvp.elements;
    const w = e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15];
    const cz = e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14];
    if (!(w > 1e-9) || cz < -w || cz > w) return null;
    const cx = e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12];
    const cy = e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13];
    return { x: ((cx / w + 1) / 2) * viewport.w, y: ((1 - cy / w) / 2) * viewport.h, w };
  }

  /**
   * First face hit by a local-space ray, honouring hidden faces and the back-face rule: camera-based, the nearest face
   * (null when it shows its back without `backfaces`: it hides what lies behind it); camera-based off, nothing
   * occludes, so without `backfaces` the first face whose front the ray meets.
   */
  private castFace(
    localRay: Ray,
    opts: PickOptions,
  ): { readonly face: number; readonly point: readonly [number, number, number]; readonly local: Vector3 } | null {
    const bvh = this.ensureBvh();
    if (bvh === null) return null;
    const frontOnly = !opts.cameraBased && !opts.backfaces;
    const hit = bvh.raycastFirst(localRay, frontOnly ? FrontSide : DoubleSide);
    if (hit === null) return null;
    const f = this.bvhTriFace[hit.faceIndex ?? 0] as number;
    const normal = hit.face?.normal;
    const front = normal === undefined ? true : normal.dot(localRay.direction) < 0;
    if (!front && !opts.backfaces) return null;
    return { face: f, point: this.worldPoint(hit.point), local: hit.point };
  }

  /** Faces under the ray (first hit), for camera-based tests and Tweak. `ray` is in world space. */
  raycastFace(
    ray: Ray,
    opts: PickOptions,
  ): { readonly face: number; readonly point: readonly [number, number, number] } | null {
    if (this.topo === null || this.tri === null) return null;
    this.syncHidden(opts.hidden);
    const local = ray.clone().applyMatrix4(this.inverse);
    local.direction.normalize();
    const hit = this.castFace(local, opts);
    return hit === null ? null : { face: hit.face, point: hit.point };
  }

  /**
   * Components of `kind` inside a pane rectangle (CSS px, any corner order), ascending: vertices and face dots by
   * their projected point, edges when both projected endpoints are inside (Maya). Faces facing away are left out
   * unless `backfaces`; camera-based, occluded components too (by this mesh or by `setOccluder`'s meshes).
   */
  marquee(
    camera: Camera,
    rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
    viewport: { readonly w: number; readonly h: number },
    kind: ComponentKind,
    opts: PickOptionsInput,
  ): Uint32Array {
    if (!this.prepare(camera, viewport, opts)) return new Uint32Array(0);
    const t = this.topo as Topo;
    const r = normalizeRect(rect);
    const s = this.screen;
    const inside = (x: number, y: number): boolean => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
    const out: number[] = [];
    if (kind === 'vertex') {
      for (let v = 0; v < t.points; v++) {
        if (this.vis.verts[v] !== 1 || !inside(s[3 * v] as number, s[3 * v + 1] as number)) continue;
        if (opts.cameraBased && !this.unoccluded(this.local(v, tmpA), 'vertex', v)) continue;
        out.push(v);
      }
    } else if (kind === 'edge') {
      for (let e = 0; e < t.edges; e++) {
        if (this.vis.edges[e] !== 1) continue;
        const a = 3 * (t.ev[2 * e] as number);
        const b = 3 * (t.ev[2 * e + 1] as number);
        if (!inside(s[a] as number, s[a + 1] as number) || !inside(s[b] as number, s[b + 1] as number)) continue;
        if (opts.cameraBased) {
          const mid = this.local(t.ev[2 * e] as number, tmpA).lerp(this.local(t.ev[2 * e + 1] as number, tmpB), 0.5);
          if (!this.unoccluded(mid, 'edge', e)) continue;
        }
        out.push(e);
      }
    } else {
      for (let f = 0; f < t.faces; f++) {
        if (this.vis.faces[f] !== 1) continue;
        const c = this.faceCentroid(f, tmpA);
        const q = this.projectLocal(c, viewport);
        if (q === null || !inside(q.x, q.y)) continue;
        if (!opts.backfaces && !this.frontFacing(f, c)) continue;
        if (opts.cameraBased && !this.unoccluded(c, 'face', f)) continue;
        out.push(f);
      }
    }
    return Uint32Array.from(out);
  }

  /**
   * Screen point (pane CSS px) of a component for tests and tools (B10's `screenOfVertex/Edge/Face`): a vertex, the
   * point at `t` of an edge (default 0.5), or a visible interior point of a face (its centroid, else a triangle
   * centroid; `wire`: the centroid, its dot, only). null when hidden, off-screen, occluded (camera-based, by this mesh
   * or by `setOccluder`'s meshes) or, for a face, facing away without `backfaces`.
   */
  screenOf(
    camera: Camera,
    viewport: Viewport,
    kind: ComponentKind,
    index: number,
    opts: PickOptionsInput,
    t = 0.5,
  ): { readonly x: number; readonly y: number } | null {
    if (!this.prepare(camera, viewport, opts)) return null;
    const topo = this.topo as Topo;
    const onScreen = (p: Vector3): { x: number; y: number } | null => {
      const q = this.projectLocal(p, viewport);
      if (q === null || q.x < 0 || q.y < 0 || q.x > viewport.w || q.y > viewport.h) return null;
      return { x: q.x, y: q.y };
    };
    if (kind === 'vertex') {
      if (index < 0 || index >= topo.points || this.vis.verts[index] !== 1) return null;
      const p = this.local(index, tmpA);
      const q = onScreen(p);
      if (q === null || (opts.cameraBased && !this.unoccluded(p, 'vertex', index))) return null;
      return q;
    }
    if (kind === 'edge') {
      if (index < 0 || index >= topo.edges || this.vis.edges[index] !== 1) return null;
      const p = this.local(topo.ev[2 * index] as number, tmpA)
        .lerp(this.local(topo.ev[2 * index + 1] as number, tmpB), t)
        .clone();
      const q = onScreen(p);
      if (q === null || (opts.cameraBased && !this.unoccluded(p, 'edge', index))) return null;
      return q;
    }
    if (index < 0 || index >= topo.faces || this.vis.faces[index] !== 1) return null;
    const centroid = this.faceCentroid(index, new Vector3());
    if (!opts.backfaces && !this.frontFacing(index, centroid)) return null;
    const candidates = [centroid];
    const tri = this.tri as Triangulation;
    // Wire shading picks a face by its dot only, so the dot is its one point.
    const end = opts.wire === true ? 0 : (tri.faceTriStart[index + 1] as number);
    for (let k = tri.faceTriStart[index] as number; k < end; k++) {
      const c = new Vector3();
      for (let j = 0; j < 3; j++) c.add(this.local(topo.cv[tri.tris[3 * k + j] as number] as number, tmpB));
      candidates.push(c.divideScalar(3));
    }
    for (const p of candidates) {
      const q = onScreen(p);
      if (q === null) continue;
      if (opts.cameraBased && !this.unoccluded(p, 'face', index)) continue;
      return q;
    }
    return null;
  }

  /** Whether element (kind, index) is visible under the last hidden set passed in (tests, hosts). */
  isVisible(kind: ComponentKind, index: number): boolean {
    const v = kind === 'vertex' ? this.vis.verts : kind === 'edge' ? this.vis.edges : this.vis.faces;
    return v[index] === 1;
  }

  /** Forces the deferred BVH work now (an idle callback after a commit). */
  prepareBvh(hidden: HiddenSet | null = this.hidden): void {
    this.syncHidden(hidden);
    this.ensureBvh();
  }

  /** True while the BVH is current (no refit or rebuild pending). */
  get bvhReady(): boolean {
    return this.bvhState === 'ready';
  }

  dispose(): void {
    this.geometry?.dispose();
    this.geometry = null;
    this.bvh = null;
    this.mesh = null;
    this.topo = null;
    this.tri = null;
  }
}

/** Row `row` (0 x, 1 y, 2 z, 3 w) of column-major matrix `m` applied to point (x, y, z, 1). */
function clipRow(m: ArrayLike<number>, row: number, x: number, y: number, z: number): number {
  return (m[row] as number) * x + (m[row + 4] as number) * y + (m[row + 8] as number) * z + (m[row + 12] as number);
}

/** Squared distance from (px, py) to segment a–b (screen space). */
export function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let s = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  s = Math.max(0, Math.min(1, s));
  const x = ax + s * dx - px;
  const y = ay + s * dy - py;
  return x * x + y * y;
}

/** Parameter on segment a–b (clamped 0…1) of its closest approach to `ray`. */
export function closestOnSegment(ray: Ray, a: Vector3, b: Vector3): number {
  const u = new Vector3().subVectors(b, a);
  const d = ray.direction;
  const w = new Vector3().subVectors(a, ray.origin);
  const uu = u.dot(u);
  if (uu === 0) return 0;
  const ud = u.dot(d);
  const dd = d.dot(d);
  const uw = u.dot(w);
  const dw = d.dot(w);
  const denom = uu * dd - ud * ud;
  let s: number;
  if (Math.abs(denom) < 1e-12 * uu * dd) s = -uw / uu;
  else s = (ud * dw - dd * uw) / denom;
  return Math.max(0, Math.min(1, s));
}

function normalizeRect(rect: Rect): Rect {
  return {
    x0: Math.min(rect.x0, rect.x1),
    y0: Math.min(rect.y0, rect.y1),
    x1: Math.max(rect.x0, rect.x1),
    y1: Math.max(rect.y0, rect.y1),
  };
}
