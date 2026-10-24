// MeshData helpers of the intake chain: per-corner faces, triangle areas and normals, smooth point normals, and the
// builder that turns a triangle list over source corners back into a stored mesh (M6A-SPEC §4.3 `MeshData`), carrying
// every layer by its domain: point layers from the source points, corner layers from the source corners, face layers,
// material and flags from a source face, edge flags and edge layers from the source edge between the same points.
import type { LayerDef, MeshData } from '@ekza-studio/mesh-core';
import { EDGE_HARD, EDGE_SEAM } from '@ekza-studio/mesh-core';

type LayerArray = Float32Array | Uint8Array | Uint16Array | Uint32Array;

/** The face of every corner. */
export function cornerFaces(data: MeshData): Uint32Array {
  const out = new Uint32Array(data.counts.corners);
  for (let f = 0; f < data.counts.faces; f++) {
    const first = data.faceCorner[f] as number;
    let c = first;
    let guard = 0;
    do {
      out[c] = f;
      c = data.cornerNext[c] as number;
    } while (c !== first && ++guard <= data.counts.corners);
  }
  return out;
}

/** Twice the area and the unit normal of triangle (a, b, c) of points, written to `out` (nx, ny, nz); returns 2·area. */
export function triangleNormal(position: ArrayLike<number>, a: number, b: number, c: number, out: Float64Array): number {
  const ax = position[3 * a] as number;
  const ay = position[3 * a + 1] as number;
  const az = position[3 * a + 2] as number;
  const ux = (position[3 * b] as number) - ax;
  const uy = (position[3 * b + 1] as number) - ay;
  const uz = (position[3 * b + 2] as number) - az;
  const vx = (position[3 * c] as number) - ax;
  const vy = (position[3 * c + 1] as number) - ay;
  const vz = (position[3 * c + 2] as number) - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length > 0) {
    out[0] = nx / length;
    out[1] = ny / length;
    out[2] = nz / length;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return length;
}

/** Area-weighted smooth normals of the points (3 per point) from triangles of points. */
export function smoothPointNormals(position: ArrayLike<number>, points: number, triPoints: Uint32Array): Float32Array {
  const acc = new Float64Array(3 * points);
  const n = new Float64Array(3);
  for (let t = 0; t < triPoints.length; t += 3) {
    const a = triPoints[t] as number;
    const b = triPoints[t + 1] as number;
    const c = triPoints[t + 2] as number;
    const area2 = triangleNormal(position, a, b, c, n);
    for (const p of [a, b, c]) {
      acc[3 * p] = (acc[3 * p] as number) + area2 * (n[0] as number);
      acc[3 * p + 1] = (acc[3 * p + 1] as number) + area2 * (n[1] as number);
      acc[3 * p + 2] = (acc[3 * p + 2] as number) + area2 * (n[2] as number);
    }
  }
  const out = new Float32Array(3 * points);
  for (let p = 0; p < points; p++) {
    const x = acc[3 * p] as number;
    const y = acc[3 * p + 1] as number;
    const z = acc[3 * p + 2] as number;
    const length = Math.hypot(x, y, z);
    if (length > 0) {
      out[3 * p] = x / length;
      out[3 * p + 1] = y / length;
      out[3 * p + 2] = z / length;
    }
  }
  return out;
}

const newArrayLike = (like: LayerArray, length: number): LayerArray =>
  like instanceof Float32Array
    ? new Float32Array(length)
    : like instanceof Uint8Array
      ? new Uint8Array(length)
      : like instanceof Uint16Array
        ? new Uint16Array(length)
        : new Uint32Array(length);

/** Fills `count` elements of a layer with its default value. */
function fillDefault(out: LayerArray, def: LayerDef, from: number, count: number): void {
  const comps = def.comps;
  for (let i = from; i < count; i++) for (let k = 0; k < comps; k++) out[comps * i + k] = def.default[k] ?? 0;
}

/** Inputs of `buildTriangleMesh`. */
export interface TriangleMeshInput {
  readonly source: MeshData;
  /** Source corner of each output corner, three per output triangle (winding order). */
  readonly corners: Uint32Array;
  /** Source face each output triangle takes its material, flags and face layers from. */
  readonly faces: Uint32Array;
  /** Edges whose faces meet more sharply than this (radians) are hard; null keeps only the source's hard edges. */
  readonly hardAngle: number | null;
  /** Corner layers left out of the result (e.g. `normal.custom` after the geometry changed). */
  readonly dropCornerLayers?: ReadonlySet<string>;
}

/**
 * A stored mesh of triangles over source corners: the used source points (ascending source order) with their
 * positions and point layers, one face per triangle, corners copying the source corners' layers, edges in first-use
 * order whose flags and layers come from the source edge between the same two points (EDGE_HARD also by `hardAngle`).
 * Triangles that name one point twice are dropped.
 */
export function buildTriangleMesh(input: TriangleMeshInput): MeshData {
  const { source, corners, faces } = input;
  const P0 = source.counts.points;
  // Points used by non-degenerate triangles, renumbered in ascending source order.
  const keep: number[] = [];
  for (let t = 0; t < faces.length; t++) {
    const a = source.cornerVert[corners[3 * t] as number] as number;
    const b = source.cornerVert[corners[3 * t + 1] as number] as number;
    const c = source.cornerVert[corners[3 * t + 2] as number] as number;
    if (a !== b && b !== c && a !== c) keep.push(t);
  }
  const used = new Uint8Array(P0);
  for (const t of keep)
    for (let i = 0; i < 3; i++) used[source.cornerVert[corners[3 * t + i] as number] as number] = 1;
  const pointOf = new Int32Array(P0).fill(-1);
  let P = 0;
  for (let p = 0; p < P0; p++) if (used[p] === 1) pointOf[p] = P++;
  const sourcePoint = new Uint32Array(P);
  for (let p = 0; p < P0; p++) if (pointOf[p] !== -1) sourcePoint[pointOf[p] as number] = p;

  const F = keep.length;
  const C = 3 * F;
  const position = new Float32Array(3 * P);
  for (let p = 0; p < P; p++) {
    const s = sourcePoint[p] as number;
    position[3 * p] = source.position[3 * s] as number;
    position[3 * p + 1] = source.position[3 * s + 1] as number;
    position[3 * p + 2] = source.position[3 * s + 2] as number;
  }
  const cornerVert = new Uint32Array(C);
  const cornerNext = new Uint32Array(C);
  const cornerSource = new Uint32Array(C);
  const faceCorner = new Uint32Array(F);
  const faceMaterial = new Uint16Array(F);
  const faceFlags = new Uint8Array(F);
  const faceSource = new Uint32Array(F);
  keep.forEach((t, f) => {
    faceCorner[f] = 3 * f;
    const sf = faces[t] as number;
    faceSource[f] = sf;
    faceMaterial[f] = source.faceMaterial[sf] as number;
    // A triangle has no diagonal to flip (FACE_FLIP_DIAGONAL is meaningless on it).
    faceFlags[f] = (source.faceFlags[sf] as number) & ~1;
    for (let i = 0; i < 3; i++) {
      const sc = corners[3 * t + i] as number;
      cornerSource[3 * f + i] = sc;
      cornerVert[3 * f + i] = pointOf[source.cornerVert[sc] as number] as number;
      cornerNext[3 * f + i] = 3 * f + ((i + 1) % 3);
    }
  });

  // Source edges by their point pair.
  const sourceEdge = new Map<number, number>();
  for (let e = 0; e < source.counts.edges; e++) {
    const a = source.edgeVerts[2 * e] as number;
    const b = source.edgeVerts[2 * e + 1] as number;
    sourceEdge.set(a < b ? a * P0 + b : b * P0 + a, e);
  }
  // Edges in first-use order, with their faces (for the dihedral rule).
  const edgeIndex = new Map<number, number>();
  const edgeVerts: number[] = [];
  const edgeFirstFace: number[] = [];
  const edgeFaces: number[] = [];
  for (let c = 0; c < C; c++) {
    const a = cornerVert[c] as number;
    const b = cornerVert[cornerNext[c] as number] as number;
    const key = a < b ? a * P + b : b * P + a;
    const e = edgeIndex.get(key);
    if (e === undefined) {
      edgeIndex.set(key, edgeVerts.length / 2);
      edgeVerts.push(a, b);
      edgeFirstFace.push(Math.floor(c / 3));
      edgeFaces.push(1);
    } else {
      edgeFaces[e] = (edgeFaces[e] as number) + 1;
    }
  }
  const E = edgeVerts.length / 2;
  const edgeFlags = new Uint8Array(E);
  const edgeSource = new Int32Array(E).fill(-1);
  for (let e = 0; e < E; e++) {
    const a = sourcePoint[edgeVerts[2 * e] as number] as number;
    const b = sourcePoint[edgeVerts[2 * e + 1] as number] as number;
    const s = sourceEdge.get(a < b ? a * P0 + b : b * P0 + a);
    if (s !== undefined) {
      edgeSource[e] = s;
      edgeFlags[e] = (source.edgeFlags[s] as number) & (EDGE_HARD | EDGE_SEAM);
    }
  }
  if (input.hardAngle !== null) {
    // Face normals, then the dihedral rule on manifold edges (the second face is found from the other corners).
    const normals = new Float64Array(3 * F);
    const n = new Float64Array(3);
    for (let f = 0; f < F; f++) {
      triangleNormal(
        position,
        cornerVert[3 * f] as number,
        cornerVert[3 * f + 1] as number,
        cornerVert[3 * f + 2] as number,
        n,
      );
      normals.set(n, 3 * f);
    }
    const otherFace = new Int32Array(E).fill(-1);
    for (let c = 0; c < C; c++) {
      const a = cornerVert[c] as number;
      const b = cornerVert[cornerNext[c] as number] as number;
      const e = edgeIndex.get(a < b ? a * P + b : b * P + a) as number;
      const f = Math.floor(c / 3);
      if (f !== edgeFirstFace[e]) otherFace[e] = f;
    }
    const cosLimit = Math.cos(input.hardAngle);
    for (let e = 0; e < E; e++) {
      if (edgeFaces[e] !== 2) continue;
      const f0 = edgeFirstFace[e] as number;
      const f1 = otherFace[e] as number;
      const dot =
        (normals[3 * f0] as number) * (normals[3 * f1] as number) +
        (normals[3 * f0 + 1] as number) * (normals[3 * f1 + 1] as number) +
        (normals[3 * f0 + 2] as number) * (normals[3 * f1 + 2] as number);
      if (dot < cosLimit) edgeFlags[e] = (edgeFlags[e] as number) | EDGE_HARD;
    }
  }

  const layers = new Map<string, { readonly def: LayerDef; readonly data: LayerArray }>();
  for (const [name, layer] of source.layers) {
    const { def } = layer;
    const comps = def.comps;
    const src = layer.data;
    if (def.domain === 'corner' && input.dropCornerLayers?.has(name) === true) continue;
    const count = def.domain === 'point' ? P : def.domain === 'corner' ? C : def.domain === 'face' ? F : E;
    const out = newArrayLike(src, comps * count);
    const sourceOf =
      def.domain === 'point'
        ? (i: number) => sourcePoint[i] as number
        : def.domain === 'corner'
          ? (i: number) => cornerSource[i] as number
          : def.domain === 'face'
            ? (i: number) => faceSource[i] as number
            : (i: number) => edgeSource[i] as number;
    for (let i = 0; i < count; i++) {
      const s = sourceOf(i);
      for (let k = 0; k < comps; k++) {
        const value = s < 0 || comps * s + k >= src.length ? (def.default[k] ?? 0) : (src[comps * s + k] as number);
        out[comps * i + k] = value;
      }
    }
    if (count === 0) fillDefault(out, def, 0, 0);
    layers.set(name, { def, data: out });
  }
  return {
    counts: { points: P, edges: E, faces: F, corners: C },
    position,
    edgeVerts: Uint32Array.from(edgeVerts),
    edgeFlags,
    cornerVert,
    cornerNext,
    faceCorner,
    faceMaterial,
    faceFlags,
    layers,
  };
}

/** Triangle count of a stored mesh (fans of its faces: a face of n corners counts n − 2). */
export function triangleCount(data: MeshData): number {
  return data.counts.corners - 2 * data.counts.faces;
}

/** A deep copy of a stored mesh (every array its own buffer, so the copy can be transferred to a worker). */
export function cloneMeshData(data: MeshData): MeshData {
  const layers = new Map<string, { readonly def: LayerDef; readonly data: LayerArray }>();
  for (const [name, layer] of data.layers) layers.set(name, { def: layer.def, data: layer.data.slice() });
  return {
    counts: { ...data.counts },
    position: data.position.slice(),
    edgeVerts: data.edgeVerts.slice(),
    edgeFlags: data.edgeFlags.slice(),
    cornerVert: data.cornerVert.slice(),
    cornerNext: data.cornerNext.slice(),
    faceCorner: data.faceCorner.slice(),
    faceMaterial: data.faceMaterial.slice(),
    faceFlags: data.faceFlags.slice(),
    layers,
  };
}

/** The point pairs of edges used by more than two faces (pinched or non-manifold), from the faces' corners. */
export function nonManifoldEdges(data: MeshData): [number, number][] {
  const P = data.counts.points;
  const uses = new Map<number, number>();
  for (let f = 0; f < data.counts.faces; f++) {
    const first = data.faceCorner[f] as number;
    let c = first;
    let guard = 0;
    do {
      const n = data.cornerNext[c] as number;
      const a = data.cornerVert[c] as number;
      const b = data.cornerVert[n] as number;
      const key = a < b ? a * P + b : b * P + a;
      uses.set(key, (uses.get(key) ?? 0) + 1);
      c = n;
    } while (c !== first && ++guard <= data.counts.corners);
  }
  const out: [number, number][] = [];
  for (const [key, count] of uses) if (count > 2) out.push([Math.floor(key / P), key % P]);
  return out;
}
