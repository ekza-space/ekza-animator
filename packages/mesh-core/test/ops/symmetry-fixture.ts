// Symmetry maps for the B4 tests before B2 merges (M6A-SPEC §5.14; READY.b2 swaps in B2's `buildSymmetryMap` for the
// gated cases): vertex partners by the §5.14 rule (mutual nearest reflection within tolerance, seam vertices their own
// partners), edge partners over the partner endpoints with `edgeReversed` and `edgeSelf` (1 crossing, 2 in-seam), face
// partners by the sorted partner vertex tuple — and the runtime's expansion of 'expand'-class selections.
import {
  BitSet,
  type ComponentSelection,
  type EditMesh,
  type OpContext,
  type SymmetryAxis,
  type SymmetryMap,
} from '../../src';
import { vertexPartners } from '../../src/subset/symmetry';
import { context } from './harness';

export function testSymmetryMap(
  m: EditMesh,
  opts: { readonly axis?: SymmetryAxis; readonly tolerance?: number; readonly plane?: number } = {},
): SymmetryMap {
  const axis = opts.axis ?? 'x';
  const tolerance = opts.tolerance ?? 1e-4;
  const plane = opts.plane ?? 0;
  const { partner: vertex, unmatched } = vertexPartners(m, axis, plane, tolerance);
  const E = m.counts.edges;
  const edge = new Int32Array(E).fill(-1);
  const edgeReversed = new Uint8Array(E);
  const edgeSelf = new Uint8Array(E);
  for (let e = 0; e < E; e++) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    const pa = vertex[a] as number;
    const pb = vertex[b] as number;
    if (pa < 0 || pb < 0) continue;
    const pe = m.findEdge(pa, pb);
    if (pe < 0) continue;
    edge[e] = pe;
    edgeReversed[e] = m.edgeVert(pe, 0) === pb ? 1 : 0;
    if (pe === e) {
      if (pa === b && pb === a) edgeSelf[e] = 1;
      else if (pa === a && pb === b) edgeSelf[e] = 2;
    }
  }
  const F = m.counts.faces;
  const key = (verts: number[]): string => [...verts].sort((x, y) => x - y).join(',');
  const byKey = new Map<string, number>();
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
  for (let f = 0; f < F; f++) {
    const k = key(vertsOf(f));
    if (!byKey.has(k)) byKey.set(k, f);
  }
  const face = new Int32Array(F).fill(-1);
  for (let f = 0; f < F; f++) {
    const mapped = vertsOf(f).map((v) => vertex[v] as number);
    if (mapped.some((v) => v < 0)) continue;
    face[f] = byKey.get(key(mapped)) ?? -1;
  }
  return { axis, space: 'object', plane, tolerance, vertex, edge, edgeReversed, edgeSelf, face, unmatched };
}

/** The runtime's expansion for 'expand'-class ops: the selection plus every matched partner. */
export function expand(sel: ComponentSelection, map: SymmetryMap): ComponentSelection {
  const grow = (set: BitSet, partners: Int32Array): BitSet => {
    const out = set.clone();
    set.forEach((i) => {
      const p = partners[i] ?? -1;
      if (p >= 0) out.add(p);
    });
    return out;
  };
  return {
    kind: sel.kind,
    verts: grow(sel.verts, map.vertex),
    edges: grow(sel.edges, map.edge),
    faces: grow(sel.faces, map.face),
    order: sel.order,
    active: sel.active,
  };
}

export function symmetricContext(m: EditMesh, preserveSeam = true, axis: SymmetryAxis = 'x'): OpContext {
  return context({ symmetry: { map: testSymmetryMap(m, { axis }), preserveSeam } });
}

/** Max distance between each vertex and the mirror image of its partner; −1 when a vertex has no partner. */
export function asymmetry(m: EditMesh, map: SymmetryMap = testSymmetryMap(m)): number {
  let worst = 0;
  const k = map.axis === 'x' ? 0 : map.axis === 'y' ? 1 : 2;
  const p = m.position;
  for (let v = 0; v < m.counts.points; v++) {
    const q = map.vertex[v] as number;
    if (q < 0) return -1;
    for (let c = 0; c < 3; c++) {
      const mirrored = c === k ? 2 * map.plane - (p[3 * q + c] as number) : (p[3 * q + c] as number);
      worst = Math.max(worst, Math.abs((p[3 * v + c] as number) - mirrored));
    }
  }
  return worst;
}

export { BitSet };
