// The one normals function (M6A-SPEC §5.4): face normals by Newell's method, normalized (a zero normal — a degenerate
// face — is [0, 1, 0]); corner normals as the angle-weighted average of the face normals in the corner's smooth fan,
// the run of faces around the vertex bounded by hard edges, border edges and non-manifold edges (bow-tie fans stay
// separate). A corner whose `normal.custom` value is non-zero (not cleared) uses it, normalized.
// Incremental: with a `cache` of the same counts and the DirtySet of a non-topology edit, only the faces touching
// dirty points (and dirty faces) get new face normals, and only the corners around the vertices of those faces, the
// endpoints of dirty edges (flags) and dirty corners (custom normals) are recomputed — the one-ring of the edit.
// The work runs on the kernel mesh's typed arrays (a MeshData or a foreign EditMesh is converted first).
import { EDGE_HARD } from '../constants';
import { isEditMesh } from '../core/access';
import { kernelMeshFrom } from '../core/edit';
import { KernelMesh } from '../core/mesh';
import { KERNEL_MARKER } from '../kernel';
import { NORMAL_CUSTOM } from '../layers/builtin';
import type { DirtySet, EditMesh, MeshData, Normals } from '../types';

/** Resolves a nullable smoothingAngle arg (§5.3): null → 0 on faceted meshes, 30° (π/6) otherwise. */
export function resolveSmoothingAngle(value: number | null, faceted: boolean): number {
  if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  return faceted ? 0 : Math.PI / 6;
}

function kernelOf(m: MeshData | EditMesh): KernelMesh {
  if (m instanceof KernelMesh) return m;
  return kernelMeshFrom(isEditMesh(m) ? m.snapshot() : m);
}

/** Face normal of `f` (normalized Newell; [0, 1, 0] when degenerate) into `out` at `3 * f`. */
function faceNormal(k: KernelMesh, f: number, out: Float32Array): void {
  const p = k.pos;
  const cv = k.cv;
  const cn = k.cn;
  let x = 0;
  let y = 0;
  let z = 0;
  const start = k.fc[f] as number;
  let c = start;
  let guard = 0;
  const max = k.cnt[3] as number;
  do {
    const next = cn[c] as number;
    const a = 3 * (cv[c] as number);
    const b = 3 * (cv[next] as number);
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
  const length = Math.sqrt(x * x + y * y + z * z);
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
function angleAt(k: KernelMesh, c: number): number {
  const p = k.pos;
  const cv = k.cv;
  const v = 3 * (cv[c] as number);
  const a = 3 * (cv[k.cp[c] as number] as number);
  const b = 3 * (cv[k.cn[c] as number] as number);
  const px = p[v] as number;
  const py = p[v + 1] as number;
  const pz = p[v + 2] as number;
  const ux = (p[a] as number) - px;
  const uy = (p[a + 1] as number) - py;
  const uz = (p[a + 2] as number) - pz;
  const wx = (p[b] as number) - px;
  const wy = (p[b + 1] as number) - py;
  const wz = (p[b + 2] as number) - pz;
  const cx = uy * wz - uz * wy;
  const cy = uz * wx - ux * wz;
  const cz = ux * wy - uy * wx;
  return Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), ux * wx + uy * wy + uz * wz);
}

/** Per edge: 1 when it continues a smooth fan (not hard, exactly two faces). */
function smoothEdges(k: KernelMesh): Uint8Array {
  const E = k.cnt[1] as number;
  const out = new Uint8Array(E);
  const ec = k.ec;
  const cr = k.cr;
  const ef = k.ef;
  for (let e = 0; e < E; e++) {
    if (((ef[e] as number) & EDGE_HARD) !== 0) continue;
    const c = ec[e] as number;
    if (c === -1) continue;
    const d = cr[c] as number;
    if (d !== c && (cr[d] as number) === c) out[e] = 1;
  }
  return out;
}

/**
 * Computes the corner normal of every corner in the fan of `c0` (marking them in `done`) from the face normals.
 * `fan` is scratch.
 */
function fanNormal(
  k: KernelMesh,
  smooth: Uint8Array,
  c0: number,
  face: Float32Array,
  corner: Float32Array,
  done: Uint8Array,
  fan: number[],
): void {
  const cv = k.cv;
  const cn = k.cn;
  const cp = k.cp;
  const ce = k.ce;
  const cr = k.cr;
  const cf = k.cf;
  const v = cv[c0] as number;
  fan.length = 0;
  fan.push(c0);
  done[c0] = 1;
  const C = k.cnt[3] as number;
  // Walk both ways around v across smooth edges; a closed fan ends back at c0.
  for (let side = 0; side < 2; side++) {
    let c = c0;
    let e = side === 0 ? (ce[cp[c0] as number] as number) : (ce[c0] as number);
    for (let guard = 0; guard <= C && smooth[e] === 1; guard++) {
      const owner = (ce[c] as number) === e ? c : (cp[c] as number);
      const q = cr[owner] as number;
      const next = (cv[q] as number) === v ? q : (cn[q] as number);
      if (next === c0 || done[next] === 1) break;
      fan.push(next);
      done[next] = 1;
      const inEdge = ce[cp[next] as number] as number;
      e = inEdge === e ? (ce[next] as number) : inEdge;
      c = next;
    }
  }
  let x = 0;
  let y = 0;
  let z = 0;
  for (const c of fan) {
    const f = cf[c] as number;
    const w = angleAt(k, c);
    x += w * (face[3 * f] as number);
    y += w * (face[3 * f + 1] as number);
    z += w * (face[3 * f + 2] as number);
  }
  const length = Math.sqrt(x * x + y * y + z * z);
  for (const c of fan) {
    if (length > 1e-12 && Number.isFinite(length)) {
      corner[3 * c] = x / length;
      corner[3 * c + 1] = y / length;
      corner[3 * c + 2] = z / length;
    } else {
      const f = cf[c] as number;
      corner[3 * c] = face[3 * f] as number;
      corner[3 * c + 1] = face[3 * f + 1] as number;
      corner[3 * c + 2] = face[3 * f + 2] as number;
    }
  }
}

/** Overrides corners with a non-zero `normal.custom` value (normalized). */
function applyCustom(k: KernelMesh, corner: Float32Array, corners: Iterable<number> | null): void {
  const custom = k.layer(NORMAL_CUSTOM);
  if (custom === undefined || custom.def.comps !== 3 || custom.def.domain !== 'corner') return;
  const data = custom.data;
  const one = (c: number): void => {
    const x = data[3 * c] as number;
    const y = data[3 * c + 1] as number;
    const z = data[3 * c + 2] as number;
    const length = Math.sqrt(x * x + y * y + z * z);
    if (length > 0 && Number.isFinite(length)) {
      corner[3 * c] = x / length;
      corner[3 * c + 1] = y / length;
      corner[3 * c + 2] = z / length;
    }
  };
  if (corners === null) for (let c = 0; c < (k.cnt[3] as number); c++) one(c);
  else for (const c of corners) one(c);
}

export function computeNormals(m: MeshData | EditMesh, cache?: Normals, dirty?: DirtySet): Normals {
  const k = kernelOf(m);
  const F = k.cnt[2] as number;
  const C = k.cnt[3] as number;
  if (
    cache !== undefined &&
    dirty !== undefined &&
    k === m &&
    !dirty.topology &&
    cache.face.length === 3 * F &&
    cache.corner.length === 3 * C &&
    dirty.points !== 'all' &&
    dirty.faces !== 'all' &&
    dirty.edges !== 'all' &&
    dirty.corners !== 'all'
  ) {
    return incrementalNormals(k, cache, dirty);
  }
  const face = new Float32Array(3 * F);
  for (let f = 0; f < F; f++) faceNormal(k, f, face);
  const corner = new Float32Array(3 * C);
  const done = new Uint8Array(C);
  const fan: number[] = [];
  const smooth = smoothEdges(k);
  for (let c = 0; c < C; c++) if (done[c] !== 1) fanNormal(k, smooth, c, face, corner, done, fan);
  applyCustom(k, corner, null);
  return { face, corner };
}

/** The corners at vertex `v` (their out-edges are incident to v). */
function cornersAt(k: KernelMesh, v: number, out: Set<number>): void {
  const start = k.ve[v] as number;
  if (start === -1) return;
  const ev = k.ev;
  let e = start;
  let guard = 0;
  do {
    const r = k.ec[e] as number;
    if (r !== -1) {
      let c = r;
      do {
        if ((k.cv[c] as number) === v) out.add(c);
        c = k.cr[c] as number;
      } while (c !== r);
    }
    e = k.dn[2 * e + ((ev[2 * e] as number) === v ? 0 : 1)] as number;
  } while (e !== start && e !== -1 && ++guard <= (k.cnt[1] as number));
}

function incrementalNormals(k: KernelMesh, cache: Normals, dirty: DirtySet): Normals {
  const face = cache.face.slice();
  const corner = cache.corner.slice();
  const faces = new Set<number>(dirty.faces as Uint32Array);
  const pointsAround = new Set<number>();
  for (const v of dirty.points as Uint32Array) cornersAt(k, v, pointsAround);
  for (const c of pointsAround) faces.add(k.cf[c] as number);
  for (const f of faces) faceNormal(k, f, face);
  // Vertices whose fans changed: the vertices of recomputed faces, the endpoints of dirty edges, dirty corners'.
  const vertices = new Set<number>();
  for (const f of faces) {
    const start = k.fc[f] as number;
    let c = start;
    do {
      vertices.add(k.cv[c] as number);
      c = k.cn[c] as number;
    } while (c !== start);
  }
  for (const e of dirty.edges as Uint32Array) {
    vertices.add(k.ev[2 * e] as number);
    vertices.add(k.ev[2 * e + 1] as number);
  }
  for (const c of dirty.corners as Uint32Array) vertices.add(k.cv[c] as number);
  const corners = new Set<number>();
  for (const v of vertices) cornersAt(k, v, corners);
  const done = new Uint8Array(k.cnt[3] as number);
  const fan: number[] = [];
  const smooth = smoothEdges(k);
  for (const c of corners) if (done[c] !== 1) fanNormal(k, smooth, c, face, corner, done, fan);
  applyCustom(k, corner, corners);
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
  const length = Math.sqrt(x * x + y * y + z * z);
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
