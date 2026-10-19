// `validateMesh` (M6A-SPEC §5.1 invariants 1–5 and the finite-float part of 7; reference implementation of B0a, B1
// adds 6–7 for layers). Never throws: every problem is reported with a code, a sentence and its elements.
//   1. Array lengths (attribute layers included) equal the counts; every index is in range; positions are finite.
//   2. Each face's cornerNext cycle has ≥ 3 corners (all owned by that face); no two consecutive corners share a vertex.
//   3. Consecutive corners are joined by an edge (EditMesh: cornerEdge[c] connects cornerVert[c] and its next).
//   4. At most one edge per unordered vertex pair, no loop edges (EditMesh: each radial cycle holds exactly the
//      corners using the edge).
//   5. EditMesh: each vertex's disk cycle holds exactly its incident edges; vertEdge = −1 iff it has none.
import { kernelError } from '../kernel';
import type { Domain, EditMesh, MeshData, MeshProblem } from '../types';
import { isEditMesh } from './access';
import { pairKey } from './build';
import { domainCount } from './layers';

type Sink = (code: string, message: string, domain: Domain, elements: Iterable<number>) => void;

export function validateMesh(m: MeshData | EditMesh): readonly MeshProblem[] {
  if (typeof m !== 'object' || m === null || typeof m.counts !== 'object') {
    throw kernelError('invalid-mesh', 'validateMesh: expected a MeshData or an EditMesh');
  }
  const problems: MeshProblem[] = [];
  const report: Sink = (code, message, domain, elements) => {
    const list = Uint32Array.from(new Set(elements)).sort();
    if (list.length > 0) problems.push({ code, message: `${message} (${list.length})`, domain, elements: list });
  };
  const edit = isEditMesh(m);
  const { points: P, edges: E, faces: F, corners: C } = m.counts;
  const counts = [P, E, F, C];
  if (!counts.every((n) => Number.isSafeInteger(n) && n >= 0)) {
    problems.push({ code: 'counts.invalid', message: 'Counts must be non-negative integers' });
    return problems;
  }
  const cv = edit ? (c: number) => m.cornerVert(c) : (c: number) => m.cornerVert[c] ?? -1;
  const cn = edit ? (c: number) => m.cornerNext(c) : (c: number) => m.cornerNext[c] ?? -1;
  const fc = edit ? (f: number) => m.faceCorner(f) : (f: number) => m.faceCorner[f] ?? -1;
  const ev = edit
    ? (e: number, end: 0 | 1) => m.edgeVert(e, end)
    : (e: number, end: 0 | 1) => m.edgeVerts[2 * e + end] ?? -1;

  // 1. lengths and ranges
  if (!edit) {
    const lengths: [string, number, number][] = [
      ['position', m.position.length, 3 * P],
      ['edgeVerts', m.edgeVerts.length, 2 * E],
      ['edgeFlags', m.edgeFlags.length, E],
      ['cornerVert', m.cornerVert.length, C],
      ['cornerNext', m.cornerNext.length, C],
      ['faceCorner', m.faceCorner.length, F],
      ['faceMaterial', m.faceMaterial.length, F],
      ['faceFlags', m.faceFlags.length, F],
    ];
    // Attribute layers hold count × comps values of their domain.
    for (const [name, layer] of m.layers) {
      lengths.push([`layer ${name}`, layer.data.length, domainCount(m.counts, layer.def.domain) * layer.def.comps]);
    }
    for (const [name, actual, expected] of lengths) {
      if (actual !== expected)
        problems.push({ code: 'counts.length', message: `${name} has ${actual} values, expected ${expected}` });
    }
    if (problems.length > 0) return problems;
  } else if (m.position.length < 3 * P) {
    problems.push({ code: 'counts.length', message: `position has ${m.position.length} values, expected ${3 * P}` });
    return problems;
  }
  const nonFinite: number[] = [];
  for (let v = 0; v < P; v++) {
    for (let k = 0; k < 3; k++) if (!Number.isFinite(m.position[3 * v + k])) nonFinite.push(v);
  }
  report('float.non-finite', 'Vertex positions must be finite', 'point', nonFinite);
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

/** Invariants 2–5 on the edit links of an EditMesh. */
function validateLinks(m: EditMesh, owner: Int32Array, report: Sink): void {
  const { points: P, edges: E, corners: C } = m.counts;
  const links: number[] = [];
  for (let c = 0; c < C; c++) {
    if (m.cornerFace(c) !== owner[c] || m.cornerPrev(m.cornerNext(c)) !== c) links.push(c);
  }
  report('corner.links', 'cornerFace and cornerPrev must match the face cycles', 'corner', links);
  // radial cycles
  const users = new Map<number, number[]>();
  for (let c = 0; c < C; c++) {
    const e = m.cornerEdge(c);
    const list = users.get(e);
    if (list === undefined) users.set(e, [c]);
    else list.push(c);
  }
  const radial: number[] = [];
  for (let e = 0; e < E; e++) {
    const expected = users.get(e) ?? [];
    const start = m.edgeCorner(e);
    if (start === -1) {
      if (expected.length > 0) radial.push(e);
      continue;
    }
    const seen = new Set<number>();
    let c = start;
    while (!seen.has(c) && seen.size <= C) {
      seen.add(c);
      c = m.cornerRadialNext(c);
    }
    if (c !== start || seen.size !== expected.length || expected.some((x) => !seen.has(x))) radial.push(e);
  }
  report('edge.radial', 'Each radial cycle holds exactly the corners using the edge', 'edge', radial);
  // disk cycles
  const incident = new Map<number, number[]>();
  for (let e = 0; e < E; e++) {
    for (const end of [0, 1] as const) {
      const v = m.edgeVert(e, end);
      const list = incident.get(v);
      if (list === undefined) incident.set(v, [e]);
      else list.push(e);
    }
  }
  const disk: number[] = [];
  for (let v = 0; v < P; v++) {
    const expected = incident.get(v) ?? [];
    const start = m.vertEdge(v);
    if (start === -1) {
      if (expected.length > 0) disk.push(v);
      continue;
    }
    const seen = new Set<number>();
    let e = start;
    while (e !== -1 && !seen.has(e) && seen.size <= E) {
      seen.add(e);
      e = m.edgeDiskNext(e, v);
    }
    if (e !== start || seen.size !== expected.length || expected.some((x) => !seen.has(x))) disk.push(v);
  }
  report('vertex.disk', "Each vertex's disk cycle holds exactly its edges", 'point', disk);
}
