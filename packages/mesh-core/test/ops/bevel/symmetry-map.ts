// A test-only stand-in for B2's `buildSymmetryMap` (M6A-SPEC §5.14), object space, no placement: brute-force mutual
// nearest partners within `tolerance`, edges through their endpoints' partners, faces through their sorted vertex
// tuples. P10 runs on it before B2 lands; the READY.b2 cases run the same checks on the real map.
import type { EditMesh, SymmetryAxis, SymmetryMap } from '../../../src';

export function standInSymmetryMap(m: EditMesh, axis: SymmetryAxis = 'x', tolerance = 1e-4): SymmetryMap {
  const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const { points: P, edges: E, faces: F } = m.counts;
  const p = m.position;
  const nearest = new Int32Array(P).fill(-1);
  for (let v = 0; v < P; v++) {
    const target = [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
    target[k] = -(target[k] as number);
    let best = -1;
    let bestD = tolerance;
    for (let w = 0; w < P; w++) {
      const d = Math.hypot(
        (p[3 * w] as number) - (target[0] as number),
        (p[3 * w + 1] as number) - (target[1] as number),
        (p[3 * w + 2] as number) - (target[2] as number),
      );
      if (d <= bestD && (best === -1 || d < bestD)) {
        best = w;
        bestD = d;
      }
    }
    nearest[v] = best;
  }
  const vertex = new Int32Array(P).fill(-1);
  let unmatched = 0;
  for (let v = 0; v < P; v++) {
    const w = nearest[v] as number;
    if (w !== -1 && (nearest[w] as number) === v) vertex[v] = w;
    else if (Math.abs(p[3 * v + k] as number) <= tolerance) vertex[v] = v;
    else unmatched++;
  }
  const edge = new Int32Array(E).fill(-1);
  const edgeReversed = new Uint8Array(E);
  const edgeSelf = new Uint8Array(E);
  for (let e = 0; e < E; e++) {
    const a = vertex[m.edgeVert(e, 0)] as number;
    const b = vertex[m.edgeVert(e, 1)] as number;
    if (a === -1 || b === -1) continue;
    const pe = m.findEdge(a, b);
    if (pe === -1) continue;
    edge[e] = pe;
    edgeReversed[e] = m.edgeVert(pe, 0) === b ? 1 : 0;
    if (pe === e) edgeSelf[e] = a === m.edgeVert(e, 0) ? 2 : 1;
  }
  const key = (verts: number[]): string => [...verts].sort((x, y) => x - y).join(',');
  const byVerts = new Map<string, number>();
  const vertsOf = (f: number): number[] => {
    const out: number[] = [];
    const start = m.faceCorner(f);
    let c = start;
    do {
      out.push(m.cornerVert(c));
      c = m.cornerNext(c);
    } while (c !== start);
    return out;
  };
  for (let f = 0; f < F; f++) byVerts.set(key(vertsOf(f)), f);
  const face = new Int32Array(F).fill(-1);
  for (let f = 0; f < F; f++) {
    const mapped = vertsOf(f).map((v) => vertex[v] as number);
    if (mapped.includes(-1)) continue;
    face[f] = byVerts.get(key(mapped)) ?? -1;
  }
  return { axis, space: 'object', plane: 0, tolerance, vertex, edge, edgeReversed, edgeSelf, face, unmatched };
}
