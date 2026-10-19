// The one normals function (M6A-SPEC §5.4): face normals by Newell's method, normalized (a zero normal — a degenerate
// face — is [0, 1, 0]); corner normals as the angle-weighted average of the face normals in the corner's smooth fan,
// the run of faces around the vertex bounded by hard edges, border edges and non-manifold edges (bow-tie fans stay
// separate). A corner whose `normal.custom` value is non-zero (not cleared) uses it, normalized.
// Incremental: with a `cache` of the same counts and the DirtySet of a non-topology edit, only the faces touching
// dirty points (and dirty faces) get new face normals, and only the corners around the vertices of those faces, the
// endpoints of dirty edges (flags) and dirty corners (custom normals) are recomputed — the one-ring of the edit.
import { EDGE_HARD } from '../constants';
import { isEditMesh } from '../core/access';
import { kernelMeshFrom } from '../core/edit';
import { KERNEL_MARKER } from '../kernel';
import { NORMAL_CUSTOM } from '../layers/builtin';
import type { DirtySet, EditMesh, MeshData, Normals } from '../types';

/** Resolves a nullable smoothingAngle arg (§5.3): null → 0 on faceted meshes, 30° (π/6) otherwise. */
export function resolveSmoothingAngle(value: number | null, faceted: boolean): number {
  if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  return faceted ? 0 : Math.PI / 6;
}

/** Face normal of `f` (normalized Newell; [0, 1, 0] when degenerate) into `out` at `3 * f`. */
function faceNormal(m: EditMesh, f: number, out: Float32Array): void {
  const p = m.position;
  let x = 0;
  let y = 0;
  let z = 0;
  const start = m.faceCorner(f);
  let c = start;
  let guard = 0;
  const max = m.counts.corners;
  do {
    const next = m.cornerNext(c);
    const a = 3 * m.cornerVert(c);
    const b = 3 * m.cornerVert(next);
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const az = p[a + 2] as number;
    const bx = p[b] as number;
    const by = p[b + 1] as number;
    const bz = p[b + 2] as number;
    x += (ay - by) * (az + bz);
    y += (az - bz) * (ax + bx);
    z += (ax - bx) * (ay + by);
    c = next;
  } while (c !== start && ++guard <= max);
  const length = Math.hypot(x, y, z);
  if (length > 0 && Number.isFinite(length)) {
    out[3 * f] = x / length;
    out[3 * f + 1] = y / length;
    out[3 * f + 2] = z / length;
  } else {
    out[3 * f] = 0;
    out[3 * f + 1] = 1;
    out[3 * f + 2] = 0;
  }
}

/** The interior angle of the face at corner `c`. */
function angleAt(m: EditMesh, c: number): number {
  const p = m.position;
  const v = 3 * m.cornerVert(c);
  const a = 3 * m.cornerVert(m.cornerPrev(c));
  const b = 3 * m.cornerVert(m.cornerNext(c));
  const ux = (p[a] as number) - (p[v] as number);
  const uy = (p[a + 1] as number) - (p[v + 1] as number);
  const uz = (p[a + 2] as number) - (p[v + 2] as number);
  const wx = (p[b] as number) - (p[v] as number);
  const wy = (p[b + 1] as number) - (p[v + 1] as number);
  const wz = (p[b + 2] as number) - (p[v + 2] as number);
  const cross = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  return Math.atan2(cross, ux * wx + uy * wy + uz * wz);
}

/** An edge that continues a smooth fan: not hard, exactly two faces. */
function smooth(m: EditMesh, e: number): boolean {
  return (m.edgeFlags(e) & EDGE_HARD) === 0 && m.edgeFaceCount(e) === 2;
}

/** The corner at `v` across edge `e` from corner `c` (whose face uses `e` at `v`). */
function across(m: EditMesh, c: number, e: number, v: number): number {
  const owner = m.cornerEdge(c) === e ? c : m.cornerPrev(c);
  const q = m.cornerRadialNext(owner);
  return m.cornerVert(q) === v ? q : m.cornerNext(q);
}

/**
 * Computes the corner normal of every corner in the fan of `c0` (marking them in `done`) from the face normals.
 * `fan` is scratch.
 */
function fanNormal(
  m: EditMesh,
  c0: number,
  face: Float32Array,
  corner: Float32Array,
  done: Uint8Array,
  fan: number[],
): void {
  const v = m.cornerVert(c0);
  fan.length = 0;
  fan.push(c0);
  done[c0] = 1;
  const C = m.counts.corners;
  // Walk both ways around v across smooth edges; a closed fan ends back at c0.
  for (const first of [m.cornerEdge(m.cornerPrev(c0)), m.cornerEdge(c0)]) {
    let c = c0;
    let e = first;
    for (let guard = 0; guard <= C && smooth(m, e); guard++) {
      const next = across(m, c, e, v);
      if (next === c0 || done[next] === 1) break;
      fan.push(next);
      done[next] = 1;
      const inEdge = m.cornerEdge(m.cornerPrev(next));
      e = inEdge === e ? m.cornerEdge(next) : inEdge;
      c = next;
    }
  }
  let x = 0;
  let y = 0;
  let z = 0;
  for (const c of fan) {
    const f = m.cornerFace(c);
    const w = angleAt(m, c);
    x += w * (face[3 * f] as number);
    y += w * (face[3 * f + 1] as number);
    z += w * (face[3 * f + 2] as number);
  }
  const length = Math.hypot(x, y, z);
  for (const c of fan) {
    if (length > 1e-12 && Number.isFinite(length)) {
      corner[3 * c] = x / length;
      corner[3 * c + 1] = y / length;
      corner[3 * c + 2] = z / length;
    } else {
      const f = m.cornerFace(c);
      corner[3 * c] = face[3 * f] as number;
      corner[3 * c + 1] = face[3 * f + 1] as number;
      corner[3 * c + 2] = face[3 * f + 2] as number;
    }
  }
}

/** Overrides corners with a non-zero `normal.custom` value (normalized). */
function applyCustom(m: EditMesh, corner: Float32Array, corners: Iterable<number> | null): void {
  const custom = m.layer(NORMAL_CUSTOM);
  if (custom === undefined || custom.def.comps !== 3 || custom.def.domain !== 'corner') return;
  const one = (c: number): void => {
    const x = custom.get(c, 0);
    const y = custom.get(c, 1);
    const z = custom.get(c, 2);
    const length = Math.hypot(x, y, z);
    if (length > 0 && Number.isFinite(length)) {
      corner[3 * c] = x / length;
      corner[3 * c + 1] = y / length;
      corner[3 * c + 2] = z / length;
    }
  };
  if (corners === null) for (let c = 0; c < m.counts.corners; c++) one(c);
  else for (const c of corners) one(c);
}

export function computeNormals(m: MeshData | EditMesh, cache?: Normals, dirty?: DirtySet): Normals {
  const mesh = isEditMesh(m) ? m : kernelMeshFrom(m);
  const { faces: F, corners: C } = mesh.counts;
  if (
    cache !== undefined &&
    dirty !== undefined &&
    isEditMesh(m) &&
    !dirty.topology &&
    cache.face.length === 3 * F &&
    cache.corner.length === 3 * C &&
    dirty.points !== 'all' &&
    dirty.faces !== 'all' &&
    dirty.edges !== 'all' &&
    dirty.corners !== 'all'
  ) {
    return incrementalNormals(mesh, cache, dirty);
  }
  const face = new Float32Array(3 * F);
  for (let f = 0; f < F; f++) faceNormal(mesh, f, face);
  const corner = new Float32Array(3 * C);
  const done = new Uint8Array(C);
  const fan: number[] = [];
  for (let c = 0; c < C; c++) if (done[c] !== 1) fanNormal(mesh, c, face, corner, done, fan);
  applyCustom(mesh, corner, null);
  return { face, corner };
}

/** The corners at vertex `v` (their out-edges are incident to v). */
function cornersAt(m: EditMesh, v: number, out: Set<number>): void {
  const start = m.vertEdge(v);
  if (start === -1) return;
  let e = start;
  let guard = 0;
  do {
    const r = m.edgeCorner(e);
    if (r !== -1) {
      let c = r;
      do {
        if (m.cornerVert(c) === v) out.add(c);
        else if (m.cornerVert(m.cornerNext(c)) === v) out.add(m.cornerNext(c));
        c = m.cornerRadialNext(c);
      } while (c !== r);
    }
    e = m.edgeDiskNext(e, v);
  } while (e !== start && e !== -1 && ++guard <= m.counts.edges);
}

function incrementalNormals(m: EditMesh, cache: Normals, dirty: DirtySet): Normals {
  const face = cache.face.slice();
  const corner = cache.corner.slice();
  const faces = new Set<number>(dirty.faces as Uint32Array);
  const pointsAround = new Set<number>();
  for (const v of dirty.points as Uint32Array) cornersAt(m, v, pointsAround);
  for (const c of pointsAround) faces.add(m.cornerFace(c));
  for (const f of faces) faceNormal(m, f, face);
  // Vertices whose fans changed: the vertices of recomputed faces, the endpoints of dirty edges, dirty corners'.
  const vertices = new Set<number>();
  for (const f of faces) {
    const start = m.faceCorner(f);
    let c = start;
    do {
      vertices.add(m.cornerVert(c));
      c = m.cornerNext(c);
    } while (c !== start);
  }
  for (const e of dirty.edges as Uint32Array) {
    vertices.add(m.edgeVert(e, 0));
    vertices.add(m.edgeVert(e, 1));
  }
  for (const c of dirty.corners as Uint32Array) vertices.add(m.cornerVert(c));
  const corners = new Set<number>();
  for (const v of vertices) cornersAt(m, v, corners);
  const done = new Uint8Array(m.counts.corners);
  const fan: number[] = [];
  for (const c of corners) if (done[c] !== 1) fanNormal(m, c, face, corner, done, fan);
  applyCustom(m, corner, corners);
  return { face, corner };
}

/** The unit Newell normal of face `f` in float64, into `out` (a degenerate face: [0, 1, 0]). */
export function faceNormal64(m: EditMesh, f: number, out: Float64Array): Float64Array {
  const p = m.position;
  let x = 0;
  let y = 0;
  let z = 0;
  const start = m.faceCorner(f);
  let c = start;
  let guard = 0;
  do {
    const next = m.cornerNext(c);
    const a = 3 * m.cornerVert(c);
    const b = 3 * m.cornerVert(next);
    x += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
    y += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
    z += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
    c = next;
  } while (c !== start && ++guard <= m.counts.corners);
  const length = Math.hypot(x, y, z);
  if (length > 0 && Number.isFinite(length) && KERNEL_MARKER.length > 0) {
    out[0] = x / length;
    out[1] = y / length;
    out[2] = z / length;
  } else {
    out[0] = 0;
    out[1] = 1;
    out[2] = 0;
  }
  return out;
}
