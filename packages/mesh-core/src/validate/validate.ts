// `validateMesh` (M6A-SPEC §5.1). Never throws for a mesh-shaped argument: every problem is reported with a code, a
// sentence and its elements.
//   1. Array lengths (attribute layers included) equal the counts; every index is in range.
//   2. Each face's cornerNext cycle has ≥ 3 corners (all owned by that face); no two consecutive corners share a vertex.
//   3. Consecutive corners are joined by an edge (EditMesh: cornerEdge[c] connects cornerVert[c] and its next).
//   4. At most one edge per unordered vertex pair, no loop edges (EditMesh: each radial cycle holds exactly the
//      corners using the edge).
//   5. EditMesh: each vertex's disk cycle holds exactly its incident edges; vertEdge = −1 iff it has none.
//   7. Skin weights ('skin.weights') sum to 1 ± 1e-6 with at most 4 non-zero influences (four components), and every
//      float — positions and float layers — is finite.
// Invariant 6 (corner values bit-equal across non-seam edges) is a property of the ops, not of a single mesh: a seam
// is *derived* from unequal values, so any stored mesh satisfies it; the propagation property (P7, test/properties)
// checks that ops keep continuous attributes continuous.
import { kernelError } from '../kernel';
import { isEditMesh } from '../core/access';
import { pairKey } from '../core/build';
import { SKIN_WEIGHTS } from '../layers/builtin';
import { domainCount, type LayerArray } from '../layers/arrays';
import type { Domain, EditMesh, LayerDef, MeshData, MeshProblem } from '../types';

type Sink = (code: string, message: string, domain: Domain, elements: Iterable<number>) => void;

/** Skin weight sums must be 1 within this tolerance (§5.1 invariant 7). */
export const SKIN_SUM_TOLERANCE = 1e-6;

export function validateMesh(m: MeshData | EditMesh): readonly MeshProblem[] {
  if (typeof m !== 'object' || m === null || typeof m.counts !== 'object' || m.counts === null) {
    throw kernelError('invalid-mesh', 'validateMesh: expected a MeshData or an EditMesh');
  }
  const problems: MeshProblem[] = [];
  const report: Sink = (code, message, domain, elements) => {
    const list = Uint32Array.from(new Set(elements)).sort();
    if (list.length > 0) problems.push({ code, message: `${message} (${list.length})`, domain, elements: list });
  };
  const edit = isEditMesh(m);
  const { points: P, edges: E, faces: F, corners: C } = m.counts;
  if (![P, E, F, C].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    problems.push({ code: 'counts.invalid', message: 'Counts must be non-negative integers' });
    return problems;
  }
  const cv = edit ? (c: number) => m.cornerVert(c) : (c: number) => m.cornerVert[c] ?? -1;
  const cn = edit ? (c: number) => m.cornerNext(c) : (c: number) => m.cornerNext[c] ?? -1;
  const fc = edit ? (f: number) => m.faceCorner(f) : (f: number) => m.faceCorner[f] ?? -1;
  const ev = edit
    ? (e: number, end: 0 | 1) => m.edgeVert(e, end)
    : (e: number, end: 0 | 1) => m.edgeVerts[2 * e + end] ?? -1;
  const layers: { readonly def: LayerDef; readonly data: ArrayLike<number> }[] = edit
    ? m.layers().map((layer) => ({ def: layer.def, data: layer.data }))
    : [...m.layers.values()];

  // 1. lengths and ranges
  const lengths: [string, number, number][] = [['position', m.position.length, 3 * P]];
  if (!edit) {
    lengths.push(
      ['edgeVerts', m.edgeVerts.length, 2 * E],
      ['edgeFlags', m.edgeFlags.length, E],
      ['cornerVert', m.cornerVert.length, C],
      ['cornerNext', m.cornerNext.length, C],
      ['faceCorner', m.faceCorner.length, F],
      ['faceMaterial', m.faceMaterial.length, F],
      ['faceFlags', m.faceFlags.length, F],
    );
  }
  for (const layer of layers) {
    lengths.push([
      `layer ${layer.def.name}`,
      layer.data.length,
      domainCount(m.counts, layer.def.domain) * layer.def.comps,
    ]);
  }
  for (const [name, actual, expected] of lengths) {
    if (actual !== expected) {
      problems.push({ code: 'counts.length', message: `${name} has ${actual} values, expected ${expected}` });
    }
  }
  if (problems.length > 0) return problems;

  // 7. finite floats and skin weights (checked early: they never depend on topology)
  const nonFinite: number[] = [];
  for (let v = 0; v < P; v++) {
    if (
      !Number.isFinite(m.position[3 * v]) ||
      !Number.isFinite(m.position[3 * v + 1]) ||
      !Number.isFinite(m.position[3 * v + 2])
    ) {
      nonFinite.push(v);
    }
  }
  report('float.non-finite', 'Vertex positions must be finite', 'point', nonFinite);
  for (const layer of layers) {
    if (layer.def.type !== 'f32') continue;
    const bad: number[] = [];
    const comps = layer.def.comps;
    const n = domainCount(m.counts, layer.def.domain);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < comps; k++) {
        if (!Number.isFinite(layer.data[i * comps + k])) {
          bad.push(i);
          break;
        }
      }
    }
    report('float.non-finite', `Layer ${layer.def.name} must hold finite values`, layer.def.domain, bad);
    if (layer.def.name === SKIN_WEIGHTS && layer.def.domain === 'point') {
      report('skin.weights', 'Skin weights must sum to 1 (± 1e-6)', 'point', skinProblems(layer.data, comps, n));
    }
  }

  const badEdges: number[] = [];
  for (let e = 0; e < E; e++) {
    for (const end of [0, 1] as const) {
      const v = ev(e, end);
      if (!Number.isInteger(v) || v < 0 || v >= P) badEdges.push(e);
    }
  }
  report('index.range', 'Edge endpoints must be vertices', 'edge', badEdges);
  const badCorners: number[] = [];
  for (let c = 0; c < C; c++) {
    const v = cv(c);
    const n = cn(c);
    if (!Number.isInteger(v) || v < 0 || v >= P || !Number.isInteger(n) || n < 0 || n >= C) badCorners.push(c);
  }
  report('index.range', 'Corner vertex and next corner must be in range', 'corner', badCorners);
  const badFaces: number[] = [];
  for (let f = 0; f < F; f++) {
    const c = fc(f);
    if (!Number.isInteger(c) || c < 0 || c >= C) badFaces.push(f);
  }
  report('index.range', 'Face first corners must be corners', 'face', badFaces);
  if (badEdges.length + badCorners.length + badFaces.length > 0) return problems;

  // 2. face cycles
  const owner = new Int32Array(C).fill(-1);
  const shared: number[] = [];
  const short: number[] = [];
  const open: number[] = [];
  const repeated: number[] = [];
  for (let f = 0; f < F; f++) {
    const start = fc(f);
    let c = start;
    let n = 0;
    do {
      if ((owner[c] as number) !== -1) {
        shared.push(c);
        break;
      }
      owner[c] = f;
      if (cv(c) === cv(cn(c))) repeated.push(f);
      c = cn(c);
      n++;
    } while (c !== start && n <= C);
    if (c !== start) open.push(f);
    else if (n < 3) short.push(f);
  }
  const orphan: number[] = [];
  for (let c = 0; c < C; c++) if ((owner[c] as number) === -1) orphan.push(c);
  report('face.cycle-open', 'Face corner cycles must close', 'face', open);
  report('face.too-short', 'Faces need at least three corners', 'face', short);
  report('face.shared-corner', 'A corner belongs to exactly one face', 'corner', shared);
  report('corner.orphan', 'Every corner belongs to a face', 'corner', orphan);
  report('face.repeated-vertex', 'Consecutive corners must not share a vertex', 'face', repeated);
  if (open.length + shared.length > 0) return problems;

  // 4. edges unique per vertex pair, no loops
  const byPair = new Map<number, number>();
  const duplicate: number[] = [];
  const loops: number[] = [];
  for (let e = 0; e < E; e++) {
    const a = ev(e, 0);
    const b = ev(e, 1);
    if (a === b) {
      loops.push(e);
      continue;
    }
    const key = pairKey(a, b, P);
    const other = byPair.get(key);
    if (other !== undefined) duplicate.push(other, e);
    else byPair.set(key, e);
  }
  report('edge.loop', 'An edge must join two different vertices', 'edge', loops);
  report('edge.duplicate', 'At most one edge per vertex pair', 'edge', duplicate);

  // 3. corner edges
  const missing: number[] = [];
  const wrongEdge: number[] = [];
  for (let c = 0; c < C; c++) {
    const a = cv(c);
    const b = cv(cn(c));
    const e = byPair.get(pairKey(a, b, P));
    if (e === undefined) missing.push(c);
    else if (edit && m.cornerEdge(c) !== e) wrongEdge.push(c);
  }
  report('corner.no-edge', 'Consecutive corners must be joined by an edge', 'corner', missing);
  report('corner.edge', 'cornerEdge must connect the corner and its next', 'corner', wrongEdge);

  if (edit) validateLinks(m, owner, report);
  return problems;
}

/** Points whose four weights do not sum to 1 ± 1e-6 (or hold a negative weight). */
function skinProblems(data: ArrayLike<number>, comps: number, n: number): number[] {
  const bad: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let negative = false;
    for (let k = 0; k < comps; k++) {
      const w = data[i * comps + k] as number;
      if (w < 0) negative = true;
      sum += w;
    }
    if (negative || !(Math.abs(sum - 1) <= SKIN_SUM_TOLERANCE)) bad.push(i);
  }
  return bad;
}

/** Invariants 2–5 on the edit links of an EditMesh. */
function validateLinks(m: EditMesh, owner: Int32Array, report: Sink): void {
  const { points: P, edges: E, corners: C } = m.counts;
  const links: number[] = [];
  for (let c = 0; c < C; c++) {
    if (m.cornerFace(c) !== owner[c] || m.cornerPrev(m.cornerNext(c)) !== c) links.push(c);
  }
  report('corner.links', 'cornerFace and cornerPrev must match the face cycles', 'corner', links);
  // radial cycles: each holds exactly the corners whose cornerEdge is the edge
  const users = new Int32Array(E);
  for (let c = 0; c < C; c++) {
    const e = m.cornerEdge(c);
    if (e >= 0 && e < E) users[e] = (users[e] as number) + 1;
  }
  const radial: number[] = [];
  for (let e = 0; e < E; e++) {
    const expected = users[e] as number;
    const start = m.edgeCorner(e);
    if (start === -1) {
      if (expected > 0) radial.push(e);
      continue;
    }
    let c = start;
    let n = 0;
    let ok = true;
    do {
      if (c < 0 || c >= C || m.cornerEdge(c) !== e) {
        ok = false;
        break;
      }
      n++;
      c = m.cornerRadialNext(c);
    } while (c !== start && n <= C);
    if (!ok || c !== start || n !== expected) radial.push(e);
  }
  report('edge.radial', 'Each radial cycle holds exactly the corners using the edge', 'edge', radial);
  // disk cycles: each holds exactly the incident edges
  const incident = new Int32Array(P);
  for (let e = 0; e < E; e++) {
    for (const end of [0, 1] as const) {
      const v = m.edgeVert(e, end);
      if (v >= 0 && v < P) incident[v] = (incident[v] as number) + 1;
    }
  }
  const disk: number[] = [];
  for (let v = 0; v < P; v++) {
    const expected = incident[v] as number;
    const start = m.vertEdge(v);
    if (start === -1) {
      if (expected > 0) disk.push(v);
      continue;
    }
    let e = start;
    let n = 0;
    let ok = true;
    do {
      if (e < 0 || e >= E || (m.edgeVert(e, 0) !== v && m.edgeVert(e, 1) !== v)) {
        ok = false;
        break;
      }
      n++;
      e = m.edgeDiskNext(e, v);
    } while (e !== start && n <= E);
    if (!ok || e !== start || n !== expected) disk.push(v);
  }
  report('vertex.disk', "Each vertex's disk cycle holds exactly its edges", 'point', disk);
}

/** The stored data of a layer as a plain record (used by tests and the revision writer). */
export type StoredLayer = { readonly def: LayerDef; readonly data: LayerArray };
