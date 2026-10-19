// UV projections (M6A-SPEC §5.28): the per-corner `uv0` values of planar, box (Maya Automatic Mapping) and cylindrical
// mapping for a set of faces, their charts, and the fit into 0–1. Pure functions over an EditMesh in mesh-local space;
// the ops (../../ops/uv) write the values and the seams.
//
// Conventions (u right, v up as seen from outside, so a projected image never reads mirrored; 1 UV unit = 1 m before
// the fit):
// - planar x: u = −z, v = y · y: u = x, v = −z (the plane primitive's layout) · z: u = x, v = y;
//   camera: u along the camera's right, v along its up, both taken into mesh-local space through the placement;
// - box: each face to the most aligned of the six axis planes by its Newell normal (ties: x before y before z),
//   +X/+Y/+Z as planar, −X: u = z, v = y · −Y: u = x, v = z · −Z: u = −x, v = y; a chart is a set of faces connected
//   through shared edges with the same plane;
// - cylindrical around the local x, y or z axis through the faces' bounding-box centre: the wrap (u = 0 ≡ 1) is on
//   −Z (−Y for the z axis), u grows to the right seen from outside, v along the axis; each face's corners take the
//   angle branch nearest the face centre's angle, so no face spans the wrap and the discontinuity lies on the edges
//   at the wrap; corners on the axis take the face centre's angle; u is metres of arc at the mean radius.
// - fit (default): every chart is moved to start at (0, 0) and all charts of the run are scaled by one factor so the
//   largest chart extent is 1 (uniform, aspect kept); off: the raw metres.
import { KERNEL_MARKER } from '../../kernel';
import type { EditMesh } from '../../types';

export type Vec3Like = readonly [number, number, number];

/** A planar projection frame: u = p·uAxis, v = p·vAxis (mesh-local, may carry the placement's scale). */
export interface PlanarFrame {
  readonly u: Vec3Like;
  readonly v: Vec3Like;
}

/** Planar frames per axis and for the box planes (0 +X, 1 −X, 2 +Y, 3 −Y, 4 +Z, 5 −Z). */
export const BOX_FRAMES: readonly PlanarFrame[] = [
  { u: [0, 0, -1], v: [0, 1, 0] },
  { u: [0, 0, 1], v: [0, 1, 0] },
  { u: [1, 0, 0], v: [0, 0, -1] },
  { u: [1, 0, 0], v: [0, 0, 1] },
  { u: [1, 0, 0], v: [0, 1, 0] },
  { u: [-1, 0, 0], v: [0, 1, 0] },
];

export function planarFrame(axis: 'x' | 'y' | 'z'): PlanarFrame {
  return BOX_FRAMES[axis === 'x' ? 0 : axis === 'y' ? 2 : 4] as PlanarFrame;
}

/** The box plane (0…5) of a normal: the dominant axis (ties: x, then y, then z) and its sign. */
export function boxPlane(n: ArrayLike<number>): number {
  const ax = Math.abs(n[0] as number);
  const ay = Math.abs(n[1] as number);
  const az = Math.abs(n[2] as number);
  if (ax >= ay && ax >= az) return (n[0] as number) >= 0 ? 0 : 1;
  if (ay >= az) return (n[1] as number) >= 0 ? 2 : 3;
  return (n[2] as number) >= 0 ? 4 : 5;
}

/** Rotates v by the inverse of the unit quaternion q = [x, y, z, w]. */
function inverseRotate(q: ArrayLike<number>, v: Vec3Like): [number, number, number] {
  const x = -(q[0] as number);
  const y = -(q[1] as number);
  const z = -(q[2] as number);
  const w = q[3] as number;
  // t = 2 · (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/**
 * The planar frame of a pane camera given as world-space `direction` (where it looks) and `up`, for a mesh with world
 * placement (t, q, s): u = right·(R·S·p), v = up′·(R·S·p), i.e. the local axes Sᵀ·Rᵀ·right and Sᵀ·Rᵀ·up′. Null when
 * the camera is not usable (not finite, zero or parallel vectors).
 */
export function cameraFrame(
  camera: { readonly direction: Vec3Like; readonly up: Vec3Like },
  placement: { readonly q: ArrayLike<number>; readonly s: ArrayLike<number> },
): PlanarFrame | null {
  const d = camera.direction;
  const up = camera.up;
  if (![...d, ...up].every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const dl = Math.hypot(d[0], d[1], d[2]);
  if (!(dl > 0)) return null;
  const f: Vec3Like = [d[0] / dl, d[1] / dl, d[2] / dl];
  // right = f × up; up′ = right × f
  let r: [number, number, number] = [
    f[1] * up[2] - f[2] * up[1],
    f[2] * up[0] - f[0] * up[2],
    f[0] * up[1] - f[1] * up[0],
  ];
  const rl = Math.hypot(r[0], r[1], r[2]);
  if (!(rl > 1e-9 * Math.hypot(up[0], up[1], up[2]))) return null;
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u2: Vec3Like = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const s = placement.s;
  const local = (w: Vec3Like): Vec3Like => {
    const v = inverseRotate(placement.q, w);
    return [v[0] * (s[0] as number), v[1] * (s[1] as number), v[2] * (s[2] as number)];
  };
  return { u: local(r), v: local(u2) };
}

/** The faces' corners in winding order (a scratch list). */
export function cornersOfFace(m: EditMesh, f: number, out: number[] = []): number[] {
  out.length = 0;
  const start = m.faceCorner(f);
  let c = start;
  let guard = 0;
  do {
    out.push(c);
    c = m.cornerNext(c);
  } while (c !== start && ++guard <= m.counts.corners);
  return out;
}

/** Per-corner UVs of a run: `uv[2c]`, `uv[2c + 1]` for the run's corners; `chart[c]` ≥ 0 for them, −1 elsewhere. */
export interface Projection {
  readonly uv: Float64Array;
  readonly chart: Int32Array;
  readonly charts: number;
}

function emptyProjection(m: EditMesh): { uv: Float64Array; chart: Int32Array } {
  const chart = new Int32Array(m.counts.corners).fill(-1);
  return { uv: new Float64Array(2 * m.counts.corners), chart };
}

/** Planar projection of `faces` with `frame`; one chart. */
export function projectPlanar(m: EditMesh, faces: readonly number[], frame: PlanarFrame): Projection {
  const { uv, chart } = emptyProjection(m);
  const p = m.position;
  const corners: number[] = [];
  for (const f of faces) {
    for (const c of cornersOfFace(m, f, corners)) {
      const v = 3 * m.cornerVert(c);
      const x = p[v] as number;
      const y = p[v + 1] as number;
      const z = p[v + 2] as number;
      uv[2 * c] = x * frame.u[0] + y * frame.u[1] + z * frame.u[2];
      uv[2 * c + 1] = x * frame.v[0] + y * frame.v[1] + z * frame.v[2];
      chart[c] = 0;
    }
  }
  return { uv, chart, charts: faces.length > 0 ? 1 : 0 };
}

/** Newell normal of face f (not normalized) into `out`. */
function newell(m: EditMesh, f: number, out: Float64Array, corners: number[]): void {
  const p = m.position;
  let x = 0;
  let y = 0;
  let z = 0;
  cornersOfFace(m, f, corners);
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const a = 3 * m.cornerVert(corners[i] as number);
    const b = 3 * m.cornerVert(corners[(i + 1) % n] as number);
    x += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
    y += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
    z += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

/** Box (automatic) projection of `faces`: each face to its most aligned axis plane; charts by plane and adjacency. */
export function projectBox(m: EditMesh, faces: readonly number[]): Projection {
  const { uv, chart } = emptyProjection(m);
  const run = new Int32Array(m.counts.faces).fill(-1); // face → plane, −1 outside the run
  const n = new Float64Array(3);
  const corners: number[] = [];
  const sorted = [...faces].sort((a, b) => a - b);
  for (const f of sorted) {
    newell(m, f, n, corners);
    run[f] = boxPlane(n);
  }
  const faceChart = new Int32Array(m.counts.faces).fill(-1);
  let charts = 0;
  for (const seed of sorted) {
    if ((faceChart[seed] as number) !== -1) continue;
    const id = charts++;
    faceChart[seed] = id;
    const queue = [seed];
    for (let i = 0; i < queue.length; i++) {
      const f = queue[i] as number;
      for (const c of cornersOfFace(m, f, corners)) {
        const e = m.cornerEdge(c);
        if (m.edgeFaceCount(e) !== 2) continue;
        const g = m.cornerFace(m.cornerRadialNext(c));
        if (g === f || (run[g] as number) !== (run[f] as number) || (faceChart[g] as number) !== -1) continue;
        faceChart[g] = id;
        queue.push(g);
      }
    }
  }
  const p = m.position;
  for (const f of sorted) {
    const frame = BOX_FRAMES[run[f] as number] as PlanarFrame;
    for (const c of cornersOfFace(m, f, corners)) {
      const v = 3 * m.cornerVert(c);
      const x = p[v] as number;
      const y = p[v + 1] as number;
      const z = p[v + 2] as number;
      uv[2 * c] = x * frame.u[0] + y * frame.u[1] + z * frame.u[2];
      uv[2 * c + 1] = x * frame.v[0] + y * frame.v[1] + z * frame.v[2];
      chart[c] = faceChart[f] as number;
    }
  }
  return { uv, chart, charts };
}

/** Axis, front (opposite the wrap) and right of a cylindrical projection around a local axis. */
export function cylinderAxes(axis: 'x' | 'y' | 'z'): {
  readonly axis: Vec3Like;
  readonly front: Vec3Like;
  readonly right: Vec3Like;
} {
  // right = axis × front: u grows to the right seen from outside, looking at the front.
  if (axis === 'x') return { axis: [1, 0, 0], front: [0, 0, 1], right: [0, -1, 0] };
  if (axis === 'y') return { axis: [0, 1, 0], front: [0, 0, 1], right: [1, 0, 0] };
  return { axis: [0, 0, 1], front: [0, 1, 0], right: [-1, 0, 0] };
}

/** Cylindrical projection of `faces` around the local `axis` through their bounding-box centre; one chart. */
export function projectCylindrical(m: EditMesh, faces: readonly number[], axis: 'x' | 'y' | 'z'): Projection {
  const { uv, chart } = emptyProjection(m);
  const { axis: a, front, right } = cylinderAxes(axis);
  const p = m.position;
  const corners: number[] = [];
  const verts = new Set<number>();
  for (const f of faces) for (const c of cornersOfFace(m, f, corners)) verts.add(m.cornerVert(c));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      const x = p[3 * v + k] as number;
      lo[k] = Math.min(lo[k] as number, x);
      hi[k] = Math.max(hi[k] as number, x);
    }
  }
  const centre = lo.map((l, k) => (l + (hi[k] as number)) / 2);
  const rel = (v: number, k: number): number => (p[3 * v + k] as number) - (centre[k] as number);
  const dot3 = (v: number, d: Vec3Like): number => rel(v, 0) * d[0] + rel(v, 1) * d[1] + rel(v, 2) * d[2];
  let radius = 0;
  for (const v of verts) {
    const h = dot3(v, a);
    const x = rel(v, 0) - h * a[0];
    const y = rel(v, 1) - h * a[1];
    const z = rel(v, 2) - h * a[2];
    radius += Math.hypot(x, y, z) / verts.size;
  }
  if (!(radius > 0)) radius = 1;
  const tiny = 1e-9 * Math.max(radius, 1e-12);
  for (const f of faces) {
    cornersOfFace(m, f, corners);
    // The face centre's angle picks the branch of every corner.
    let fr = 0;
    let ff = 0;
    for (const c of corners) {
      const v = m.cornerVert(c);
      fr += dot3(v, right) / corners.length;
      ff += dot3(v, front) / corners.length;
    }
    const centreAngle = Math.atan2(fr, ff);
    for (const c of corners) {
      const v = m.cornerVert(c);
      const r = dot3(v, right);
      const fw = dot3(v, front);
      let phi = Math.hypot(r, fw) <= tiny ? centreAngle : Math.atan2(r, fw);
      while (phi - centreAngle > Math.PI) phi -= 2 * Math.PI;
      while (centreAngle - phi > Math.PI) phi += 2 * Math.PI;
      uv[2 * c] = (phi + Math.PI) * radius;
      uv[2 * c + 1] = dot3(v, a);
      chart[c] = 0;
    }
  }
  return { uv, chart, charts: faces.length > 0 ? 1 : 0 };
}

/** The fit (§5.28): each chart starts at (0, 0); one uniform scale makes the largest chart extent 1. */
export function fitCharts(projection: Projection): void {
  const { uv, chart, charts } = projection;
  if (charts === 0) return;
  const lo = new Float64Array(2 * charts).fill(Infinity);
  const hi = new Float64Array(2 * charts).fill(-Infinity);
  for (let c = 0; c < chart.length; c++) {
    const k = chart[c] as number;
    if (k < 0) continue;
    for (let i = 0; i < 2; i++) {
      lo[2 * k + i] = Math.min(lo[2 * k + i] as number, uv[2 * c + i] as number);
      hi[2 * k + i] = Math.max(hi[2 * k + i] as number, uv[2 * c + i] as number);
    }
  }
  let extent = 0;
  for (let i = 0; i < 2 * charts; i++) extent = Math.max(extent, (hi[i] as number) - (lo[i] as number));
  const scale = extent > 0 && Number.isFinite(extent) && KERNEL_MARKER.length > 0 ? 1 / extent : 1;
  for (let c = 0; c < chart.length; c++) {
    const k = chart[c] as number;
    if (k < 0) continue;
    uv[2 * c] = ((uv[2 * c] as number) - (lo[2 * k] as number)) * scale;
    uv[2 * c + 1] = ((uv[2 * c + 1] as number) - (lo[2 * k + 1] as number)) * scale;
  }
}
