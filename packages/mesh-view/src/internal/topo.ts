// Flat topology arrays the overlays and the picker read (M6A-SPEC §4.4): corner → vertex, face and edge, taken once per
// topology from an `EditMesh` (or a stored `MeshData`), so every later loop is a typed-array walk instead of a method
// call per element. Also the one visibility rule both the draw list and the picker use (hidden and isolated elements).
import type { BitSet, EditMesh, HiddenSet, MeshData } from '@ekza-animator/mesh-core';

export interface Topo {
  readonly points: number;
  readonly edges: number;
  readonly faces: number;
  readonly corners: number;
  /** Corner → vertex. */
  readonly cv: Uint32Array;
  /** Corner → next corner of its face. */
  readonly cn: Uint32Array;
  /** Corner → face. */
  readonly cf: Uint32Array;
  /** Corner → edge (−1 when unknown: stored data without edit links). */
  readonly ce: Int32Array | null;
  /** Edge endpoints (2E; t = 0 at index 0). */
  readonly ev: Uint32Array;
  /** Edge flags (E). */
  readonly ef: Uint8Array;
  /** Face → its corners, CSR over corners in face-cycle order: corners of f are `fcorners[fstart[f] … fstart[f+1])`. */
  readonly fstart: Uint32Array;
  readonly fcorners: Uint32Array;
}

/** Topology of an edit mesh (edit links resolved once). */
export function topoOfEdit(m: EditMesh): Topo {
  const { points, edges, faces, corners } = m.counts;
  const cv = new Uint32Array(corners);
  const cn = new Uint32Array(corners);
  const cf = new Uint32Array(corners);
  const ce = new Int32Array(corners);
  for (let c = 0; c < corners; c++) {
    cv[c] = m.cornerVert(c);
    cn[c] = m.cornerNext(c);
    cf[c] = m.cornerFace(c);
    ce[c] = m.cornerEdge(c);
  }
  const ev = new Uint32Array(2 * edges);
  const ef = new Uint8Array(edges);
  for (let e = 0; e < edges; e++) {
    ev[2 * e] = m.edgeVert(e, 0);
    ev[2 * e + 1] = m.edgeVert(e, 1);
    ef[e] = m.edgeFlags(e);
  }
  const { fstart, fcorners } = faceCycles(
    faces,
    corners,
    (f) => m.faceCorner(f),
    (c) => cn[c] as number,
  );
  return { points, edges, faces, corners, cv, cn, cf, ce, ev, ef, fstart, fcorners };
}

/** Topology of a stored form (no corner → edge links: static display never needs them). */
export function topoOfData(d: MeshData): Topo {
  const { points, edges, faces, corners } = d.counts;
  const { fstart, fcorners } = faceCycles(
    faces,
    corners,
    (f) => d.faceCorner[f] as number,
    (c) => d.cornerNext[c] as number,
  );
  const cf = new Uint32Array(corners);
  for (let f = 0; f < faces; f++) {
    for (let i = fstart[f] as number; i < (fstart[f + 1] as number); i++) cf[fcorners[i] as number] = f;
  }
  return {
    points,
    edges,
    faces,
    corners,
    cv: d.cornerVert.subarray(0, corners),
    cn: d.cornerNext.subarray(0, corners),
    cf,
    ce: null,
    ev: d.edgeVerts.subarray(0, 2 * edges),
    ef: d.edgeFlags.subarray(0, edges),
    fstart,
    fcorners,
  };
}

function faceCycles(
  faces: number,
  corners: number,
  first: (f: number) => number,
  next: (c: number) => number,
): { fstart: Uint32Array; fcorners: Uint32Array } {
  const fstart = new Uint32Array(faces + 1);
  const fcorners = new Uint32Array(corners);
  let at = 0;
  for (let f = 0; f < faces; f++) {
    fstart[f] = at;
    const start = first(f);
    let c = start;
    let guard = 0;
    do {
      if (at >= corners) break;
      fcorners[at++] = c;
      c = next(c);
    } while (c !== start && c >= 0 && ++guard < corners);
  }
  fstart[faces] = at;
  return { fstart, fcorners };
}

/** Bit `i` of a bitset's words (no bounds checks: callers loop within the mesh's counts). */
export function bit(words: Uint32Array, i: number): boolean {
  return (((words[i >>> 5] as number) >>> (i & 31)) & 1) !== 0;
}

/** Bit `i` of a set that may be smaller than the mesh (a stale selection): out of range reads as clear. */
export function has(set: BitSet | null | undefined, i: number): boolean {
  if (set === null || set === undefined || i >= set.size) return false;
  return bit(set.words, i);
}

/** Per-element visibility (1 = drawn and pickable). */
export interface Visibility {
  readonly verts: Uint8Array;
  readonly edges: Uint8Array;
  readonly faces: Uint8Array;
}

export function allVisible(t: Topo): Visibility {
  return {
    verts: new Uint8Array(t.points).fill(1),
    edges: new Uint8Array(t.edges).fill(1),
    faces: new Uint8Array(t.faces).fill(1),
  };
}

/**
 * The one visibility rule (§5.6 "hidden components are not drawn, not pickable"): a face is visible unless hidden (or
 * outside the isolate set); an edge is visible unless hidden and, when it has faces, only while one of them is visible;
 * a vertex likewise through its edges. So hiding faces takes the edges and vertices only they use along (Maya), and a
 * `HiddenSet` that already lists them changes nothing. Edges without faces and lone vertices follow the isolate set
 * (an isolate set hides them). Writes into `out` and returns it.
 */
export function deriveVisibility(
  t: Topo,
  hidden: HiddenSet | null,
  isolate: BitSet | null,
  out: Visibility,
): Visibility {
  const { verts, edges, faces } = out;
  for (let f = 0; f < t.faces; f++) {
    faces[f] = has(hidden?.faces, f) || (isolate !== null && !has(isolate, f)) ? 0 : 1;
  }
  const lone = isolate === null ? 1 : 0;
  if (t.ce === null) {
    edges.fill(lone);
  } else {
    // 0 = no face seen, 1 = only hidden faces, 2 = a visible face.
    edges.fill(0);
    const ce = t.ce;
    for (let c = 0; c < t.corners; c++) {
      const e = ce[c] as number;
      if (e < 0) continue;
      const seen = faces[t.cf[c] as number] === 1 ? 2 : 1;
      if (seen > (edges[e] as number)) edges[e] = seen;
    }
    for (let e = 0; e < t.edges; e++) {
      const seen = edges[e] as number;
      edges[e] = has(hidden?.edges, e) ? 0 : seen === 0 ? lone : seen === 2 ? 1 : 0;
    }
  }
  // Vertices: the same rule through their edges (0 = no edge, 1 = only undrawn edges, 2 = a drawn edge).
  verts.fill(0);
  for (let e = 0; e < t.edges; e++) {
    const seen = edges[e] === 1 ? 2 : 1;
    const a = t.ev[2 * e] as number;
    const b = t.ev[2 * e + 1] as number;
    if (seen > (verts[a] as number)) verts[a] = seen;
    if (seen > (verts[b] as number)) verts[b] = seen;
  }
  for (let v = 0; v < t.points; v++) {
    const seen = verts[v] as number;
    verts[v] = has(hidden?.verts, v) ? 0 : seen === 0 ? lone : seen === 2 ? 1 : 0;
  }
  return out;
}

/** Face centroids (vertex average, mesh-local) into `out` (3F). */
export function faceCentroids(t: Topo, position: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let f = 0; f < t.faces; f++) {
    const start = t.fstart[f] as number;
    const end = t.fstart[f + 1] as number;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = start; i < end; i++) {
      const v = 3 * (t.cv[t.fcorners[i] as number] as number);
      x += position[v] as number;
      y += position[v + 1] as number;
      z += position[v + 2] as number;
    }
    const n = Math.max(1, end - start);
    out[3 * f] = x / n;
    out[3 * f + 1] = y / n;
    out[3 * f + 2] = z / n;
  }
  return out;
}

/** CSR adjacency `from → to` built from a list of (from, to) pairs given as a callback over `count` items. */
export interface Csr {
  readonly start: Uint32Array;
  readonly items: Uint32Array;
}

export function csr(size: number, count: number, key: (i: number) => number, value: (i: number) => number): Csr {
  const start = new Uint32Array(size + 1);
  for (let i = 0; i < count; i++) {
    const k = key(i);
    if (k >= 0 && k < size) start[k + 1] = (start[k + 1] as number) + 1;
  }
  for (let k = 0; k < size; k++) start[k + 1] = (start[k + 1] as number) + (start[k] as number);
  const fill = start.slice(0, size);
  const items = new Uint32Array(start[size] as number);
  for (let i = 0; i < count; i++) {
    const k = key(i);
    if (k < 0 || k >= size) continue;
    items[fill[k] as number] = value(i);
    fill[k] = (fill[k] as number) + 1;
  }
  return { start, items };
}

/** Vertex → incident edges (each edge listed under both endpoints). */
export function vertexEdges(t: Topo): Csr {
  return csr(
    t.points,
    2 * t.edges,
    (i) => t.ev[i] as number,
    (i) => i >>> 1,
  );
}

/** Vertex → corners at it. */
export function vertexCorners(t: Topo): Csr {
  return csr(
    t.points,
    t.corners,
    (c) => t.cv[c] as number,
    (c) => c,
  );
}

/** Mean edge length (mesh-local), 0 for a mesh without edges. */
export function meanEdgeLength(t: Topo, position: ArrayLike<number>): number {
  if (t.edges === 0) return 0;
  let sum = 0;
  for (let e = 0; e < t.edges; e++) {
    const a = 3 * (t.ev[2 * e] as number);
    const b = 3 * (t.ev[2 * e + 1] as number);
    sum += Math.hypot(
      (position[a] as number) - (position[b] as number),
      (position[a + 1] as number) - (position[b + 1] as number),
      (position[a + 2] as number) - (position[b + 2] as number),
    );
  }
  return sum / t.edges;
}

/**
 * The triangulation's interior diagonals as corner pairs (2 per diagonal): triangle sides that are not face sides,
 * each once.
 */
export function triangulationDiagonals(t: Topo, tris: Uint32Array): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  const side = (a: number, b: number): void => {
    if ((t.cn[a] as number) === b || (t.cn[b] as number) === a) return;
    const key = a < b ? a * t.corners + b : b * t.corners + a;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a, b);
  };
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = tris[i] as number;
    const b = tris[i + 1] as number;
    const c = tris[i + 2] as number;
    side(a, b);
    side(b, c);
    side(c, a);
  }
  return Uint32Array.from(out);
}

/** Axis-aligned bounds of the positions (mesh-local): [minX, minY, minZ, maxX, maxY, maxZ]; zeros when empty. */
export function bounds(position: ArrayLike<number>, points: number): Float64Array {
  const out = new Float64Array(6);
  if (points === 0) return out;
  out.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let v = 0; v < points; v++) {
    for (let k = 0; k < 3; k++) {
      const x = position[3 * v + k] as number;
      if (x < (out[k] as number)) out[k] = x;
      if (x > (out[k + 3] as number)) out[k + 3] = x;
    }
  }
  return out;
}

/** Copies the first `points` positions (3 floats each) of `src` into `dst`. */
export function copyPositions(dst: Float32Array, src: ArrayLike<number>, points: number): void {
  const n = 3 * points;
  if (src instanceof Float32Array) {
    dst.set(src.length === n ? src : src.subarray(0, n));
    return;
  }
  for (let i = 0; i < n; i++) dst[i] = src[i] as number;
}
