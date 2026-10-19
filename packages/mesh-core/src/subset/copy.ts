// `copySubset` (M6A-SPEC §4.3, §5.13): the stored form of a face subset of an edit mesh — the faces, the vertices and
// edges they use, their corners and every (or the named) layer, with the index remap old → new (−1 = not copied).
// Order is canonical: faces, vertices and edges keep their relative order (ascending old index), corners follow each
// face's cycle from its first corner, edges keep their endpoint order (t = 0 stays at the same end). Separate,
// Extract and Duplicate Faces build their outputs from it.
import type { BitSet } from '../bitset';
import { allocLayer, type LayerArray } from '../layers/arrays';
import type { Domain, EditMesh, LayerDef, MeshData, SubsetResult } from '../types';

export function copySubset(
  m: EditMesh,
  faces: BitSet,
  opts?: { readonly layers?: 'all' | readonly string[] },
): SubsetResult {
  const { points: P, edges: E, faces: F, corners: C } = m.counts;
  const pointMap = new Int32Array(P).fill(-1);
  const edgeMap = new Int32Array(E).fill(-1);
  const faceMap = new Int32Array(F).fill(-1);
  const cornerMap = new Int32Array(C).fill(-1);
  const faceList: number[] = [];
  faces.forEach((f) => {
    if (f < F) faceList.push(f);
  });
  // Mark used vertices and edges; number corners in face order.
  let nc = 0;
  for (const f of faceList) {
    const start = m.faceCorner(f);
    let c = start;
    let guard = 0;
    do {
      pointMap[m.cornerVert(c)] = 0;
      edgeMap[m.cornerEdge(c)] = 0;
      cornerMap[c] = nc++;
      c = m.cornerNext(c);
    } while (c !== start && ++guard <= C);
  }
  let np = 0;
  for (let v = 0; v < P; v++) if (pointMap[v] === 0) pointMap[v] = np++;
  let ne = 0;
  for (let e = 0; e < E; e++) if (edgeMap[e] === 0) edgeMap[e] = ne++;
  faceList.forEach((f, i) => {
    faceMap[f] = i;
  });
  const nf = faceList.length;

  const position = new Float32Array(3 * np);
  const src = m.position;
  for (let v = 0; v < P; v++) {
    const j = pointMap[v] as number;
    if (j < 0) continue;
    position[3 * j] = src[3 * v] as number;
    position[3 * j + 1] = src[3 * v + 1] as number;
    position[3 * j + 2] = src[3 * v + 2] as number;
  }
  const edgeVerts = new Uint32Array(2 * ne);
  const edgeFlags = new Uint8Array(ne);
  for (let e = 0; e < E; e++) {
    const j = edgeMap[e] as number;
    if (j < 0) continue;
    edgeVerts[2 * j] = pointMap[m.edgeVert(e, 0)] as number;
    edgeVerts[2 * j + 1] = pointMap[m.edgeVert(e, 1)] as number;
    edgeFlags[j] = m.edgeFlags(e);
  }
  const cornerVert = new Uint32Array(nc);
  const cornerNext = new Uint32Array(nc);
  const faceCorner = new Uint32Array(nf);
  const faceMaterial = new Uint16Array(nf);
  const faceFlags = new Uint8Array(nf);
  faceList.forEach((f, i) => {
    faceCorner[i] = cornerMap[m.faceCorner(f)] as number;
    faceMaterial[i] = m.faceMaterial(f);
    faceFlags[i] = m.faceFlags(f);
    const start = m.faceCorner(f);
    let c = start;
    let guard = 0;
    do {
      const j = cornerMap[c] as number;
      cornerVert[j] = pointMap[m.cornerVert(c)] as number;
      cornerNext[j] = cornerMap[m.cornerNext(c)] as number;
      c = m.cornerNext(c);
    } while (c !== start && ++guard <= C);
  });

  const keep = opts?.layers ?? 'all';
  const layers = new Map<string, { readonly def: LayerDef; readonly data: LayerArray }>();
  const maps: Record<Domain, Int32Array> = { point: pointMap, edge: edgeMap, face: faceMap, corner: cornerMap };
  const sizes: Record<Domain, number> = { point: np, edge: ne, face: nf, corner: nc };
  for (const layer of m.layers()) {
    const def = layer.def;
    if (keep !== 'all' && !keep.includes(def.name)) continue;
    const map = maps[def.domain];
    const comps = def.comps;
    const data = allocLayer(def.type, sizes[def.domain] * comps);
    const from = layer.data;
    for (let i = 0; i < map.length; i++) {
      const j = map[i] as number;
      if (j < 0) continue;
      for (let k = 0; k < comps; k++) data[j * comps + k] = from[i * comps + k] as number;
    }
    layers.set(def.name, { def, data });
  }

  const data: MeshData = {
    counts: { points: np, edges: ne, faces: nf, corners: nc },
    position,
    edgeVerts,
    edgeFlags,
    cornerVert,
    cornerNext,
    faceCorner,
    faceMaterial,
    faceFlags,
    layers,
  };
  return {
    data,
    remap: { points: pointMap, edges: edgeMap, faces: faceMap, corners: cornerMap },
  };
}
