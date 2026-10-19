// B3 test support (M6A-SPEC §9 B3, §5.29): op contexts, a checked op runner (P1 validity, P4 orientation, P5 exact
// undo/redo on the same and on rebuilt meshes, abort exactness on refusals, P8 incremental revisions, canonical links
// and dead slots, the delta's remap), reference symmetry maps (§5.14 definition, brute force) and small geometry
// helpers. No Node APIs: the Chromium run imports it too.
import type { ParamValues, ReadonlyXf } from '@ekza-animator/anim-core';
import { expect } from 'vitest';
import {
  type ComponentKind,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  type MeshData,
  type MeshDelta,
  type MeshOp,
  MESH_OPS,
  type OpContext,
  type OpResult,
  primitive,
  type Refusal,
  selectionOf,
  type SymmetryAxis,
  type SymmetryMap,
  validateMesh,
  writeRevision,
} from '../../src';
import { diffStored, firstDifference, linkArray } from '../../src/testing';
import { deadSlotProblem } from '../properties/harness';

export const IDENTITY_XF: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };

export function ctxOf(
  opts: Partial<Omit<OpContext, 'symmetry'>> & {
    readonly symmetry?: SymmetryMap | null;
    readonly preserveSeam?: boolean;
  } = {},
): OpContext {
  return {
    symmetry:
      opts.symmetry === undefined || opts.symmetry === null
        ? null
        : { map: opts.symmetry, preserveSeam: opts.preserveSeam ?? true },
    hidden: opts.hidden ?? null,
    placement: opts.placement ?? IDENTITY_XF,
    faceted: opts.faceted ?? true,
    soft: null,
    curves: { compile: () => ({}) as never, evaluate: () => 0 },
    epsilon: opts.epsilon ?? 1e-9,
  };
}

export function op(id: string): MeshOp {
  const found = MESH_OPS[id];
  if (found === undefined) throw new Error(`no op ${id}`);
  return found;
}

export const cube = (): EditMesh => editMeshFrom(primitive('cube', {}));
export const counts = (m: EditMesh | MeshData): string => `${m.counts.points}/${m.counts.edges}/${m.counts.faces}`;
export const sel = (m: EditMesh, kind: ComponentKind, indices: readonly number[]): ComponentSelection =>
  selectionOf(kind, indices, m.counts);

export function position(m: EditMesh, v: number): [number, number, number] {
  const p = m.position;
  return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
}

/** The face whose Newell normal is closest to `dir`. */
export function faceToward(m: EditMesh, dir: readonly [number, number, number]): number {
  let best = -1;
  let bestDot = -Infinity;
  for (let f = 0; f < m.counts.faces; f++) {
    const n = newellOf(m, f);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const d = (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]) / l;
    if (d > bestDot + 1e-12) {
      bestDot = d;
      best = f;
    }
  }
  return best;
}

export function faceVerts(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  do {
    out.push(m.cornerVert(c));
    c = m.cornerNext(c);
  } while (c !== start && out.length <= m.counts.corners);
  return out;
}

export function newellOf(m: EditMesh, f: number): [number, number, number] {
  const vs = faceVerts(m, f);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < vs.length; i++) {
    const a = position(m, vs[i] as number);
    const b = position(m, vs[(i + 1) % vs.length] as number);
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

export function faceCentroid(m: EditMesh, f: number): [number, number, number] {
  const vs = faceVerts(m, f);
  const c: [number, number, number] = [0, 0, 0];
  for (const v of vs) {
    const p = position(m, v);
    c[0] += p[0] / vs.length;
    c[1] += p[1] / vs.length;
    c[2] += p[2] / vs.length;
  }
  return c;
}

export function faceArea(m: EditMesh, f: number): number {
  const n = newellOf(m, f);
  return Math.hypot(n[0], n[1], n[2]) / 2;
}

/** The edge from a to b (−1 none). */
export const edgeOf = (m: EditMesh, a: number, b: number): number => m.findEdge(a, b);

/** P4: every edge with exactly two faces is run in opposite directions by them. */
export function windingProblems(m: EditMesh): number[] {
  const bad: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) {
    if (m.edgeFaceCount(e) !== 2) continue;
    const c = m.edgeCorner(e);
    const d = m.cornerRadialNext(c);
    if (m.cornerVert(c) === m.cornerVert(d)) bad.push(e);
  }
  return bad;
}

export interface Checked {
  readonly result: OpResult | Refusal;
  readonly delta: MeshDelta | null;
}

/**
 * Runs `op` in its own transaction with every kernel check: a refusal aborts to the exact pre-op state; a result
 * passes validateMesh, keeps canonical links and dead slots, writes an incremental revision equal to the full one,
 * and its delta undoes and redoes exactly on the same mesh and on meshes rebuilt from either state.
 */
export function runChecked(
  m: EditMesh,
  meshOp: MeshOp,
  selection: ComponentSelection | null,
  args: ParamValues,
  ctx: OpContext,
): Checked {
  const before = m.snapshot();
  const beforeLinks = linkArray(m);
  const revision = writeRevision(m);
  m.begin(meshOp.id);
  let result: OpResult | Refusal;
  try {
    result = meshOp.run(m, selection, args, ctx);
  } catch (error) {
    m.abort();
    throw error;
  }
  if (isRefusal(result)) {
    m.abort();
    expect(diffStored(m, before), `${meshOp.id}: abort after a refusal`).toBeNull();
    expect(firstDifference(linkArray(m), beforeLinks), `${meshOp.id}: links after abort`).toBe(-1);
    return { result, delta: null };
  }
  const delta = m.end();
  expect(
    validateMesh(m).map((p) => p.message),
    `${meshOp.id}: validateMesh`,
  ).toEqual([]);
  const after = m.snapshot();
  const afterLinks = linkArray(m);
  expect(firstDifference(afterLinks, linkArray(editMeshFrom(after))), `${meshOp.id}: canonical links`).toBe(-1);
  expect(deadSlotProblem(m), `${meshOp.id}: dead slots`).toBeNull();
  const full = writeRevision(m);
  const incremental = writeRevision(m, { previous: revision.manifest, dirty: delta.dirty });
  expect(incremental.manifestId, `${meshOp.id}: incremental revision`).toBe(full.manifestId);
  // P5 on the same mesh and on rebuilt runtimes.
  m.apply(delta, 'backward');
  expect(diffStored(m, before), `${meshOp.id}: undo`).toBeNull();
  expect(firstDifference(linkArray(m), beforeLinks), `${meshOp.id}: undo links`).toBe(-1);
  m.apply(delta, 'forward');
  expect(diffStored(m, after), `${meshOp.id}: redo`).toBeNull();
  const rebuiltAfter = editMeshFrom(after);
  rebuiltAfter.apply(delta, 'backward');
  expect(diffStored(rebuiltAfter, before), `${meshOp.id}: undo on a rebuilt mesh`).toBeNull();
  const rebuiltBefore = editMeshFrom(before);
  rebuiltBefore.apply(delta, 'forward');
  expect(diffStored(rebuiltBefore, after), `${meshOp.id}: redo on a rebuilt mesh`).toBeNull();
  // The result selection is in range.
  const s = result.selection;
  expect(s.verts.size, `${meshOp.id}: selection size`).toBe(m.counts.points);
  expect(s.edges.size).toBe(m.counts.edges);
  expect(s.faces.size).toBe(m.counts.faces);
  return { result, delta };
}

/** Runs and expects a result. */
export function runOk(
  m: EditMesh,
  id: string,
  selection: ComponentSelection | null,
  args: ParamValues = {},
  ctx: OpContext = ctxOf(),
): OpResult {
  const { result } = runChecked(m, op(id), selection, args, ctx);
  if (isRefusal(result)) throw new Error(`${id} refused: ${result.code} ${result.reason}`);
  return result;
}

/** Runs and expects a refusal with `code`. */
export function runRefused(
  m: EditMesh,
  id: string,
  selection: ComponentSelection | null,
  code: string,
  args: ParamValues = {},
  ctx: OpContext = ctxOf(),
): Refusal {
  const { result } = runChecked(m, op(id), selection, args, ctx);
  if (!isRefusal(result)) throw new Error(`${id} ran; expected the refusal ${code}`);
  expect(result.code).toBe(code);
  expect(result.reason.length).toBeGreaterThan(0);
  return result;
}

// ---------- reference symmetry maps (§5.14) ----------

const AXIS: Readonly<Record<SymmetryAxis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };

/**
 * A symmetry map by the §5.14 definition (object space): reflect, nearest within `tolerance` (ties to the smaller
 * index), mutual matches only, seam vertices are their own partners; edges by endpoint partners; faces by sorted vertex
 * tuples. Brute force, for tests.
 */
export function referenceSymmetryMap(m: EditMesh, axis: SymmetryAxis = 'x', tolerance = 0.001, plane = 0): SymmetryMap {
  const k = AXIS[axis];
  const P = m.counts.points;
  const near = new Int32Array(P).fill(-1);
  for (let v = 0; v < P; v++) {
    const p = position(m, v);
    if (Math.abs(p[k] - plane) <= tolerance) {
      near[v] = v;
      continue;
    }
    const r = [...p] as [number, number, number];
    r[k] = 2 * plane - r[k];
    let best = -1;
    let bestD = Infinity;
    for (let u = 0; u < P; u++) {
      const q = position(m, u);
      const d = Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]);
      if (d <= tolerance && d < bestD) {
        best = u;
        bestD = d;
      }
    }
    near[v] = best;
  }
  const vertex = new Int32Array(P).fill(-1);
  let unmatched = 0;
  for (let v = 0; v < P; v++) {
    const u = near[v] as number;
    if (u === v) vertex[v] = v;
    else if (u !== -1 && near[u] === v) vertex[v] = u;
    else unmatched++;
  }
  const E = m.counts.edges;
  const edge = new Int32Array(E).fill(-1);
  const edgeReversed = new Uint8Array(E);
  const edgeSelf = new Uint8Array(E);
  for (let e = 0; e < E; e++) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    const pa = vertex[a] as number;
    const pb = vertex[b] as number;
    if (pa === -1 || pb === -1) continue;
    const pe = m.findEdge(pa, pb);
    if (pe === -1) continue;
    edge[e] = pe;
    edgeReversed[e] = m.edgeVert(pe, 0) === pb ? 1 : 0;
    if (pe === e) edgeSelf[e] = pa === a && pb === b ? 2 : 1;
  }
  const F = m.counts.faces;
  const face = new Int32Array(F).fill(-1);
  const byKey = new Map<string, number>();
  const keyOf = (vs: readonly number[]) => [...vs].sort((x, y) => x - y).join(',');
  for (let f = 0; f < F; f++) byKey.set(keyOf(faceVerts(m, f)), f);
  for (let f = 0; f < F; f++) {
    const mapped = faceVerts(m, f).map((v) => vertex[v] as number);
    if (mapped.some((v) => v === -1)) continue;
    face[f] = byKey.get(keyOf(mapped)) ?? -1;
  }
  return { axis, space: 'object', plane, tolerance, vertex, edge, edgeReversed, edgeSelf, face, unmatched };
}

/**
 * P10: every vertex has a mirror image among the vertices within `tol` (coincident vertices — a zero-length wall,
 * two caps meeting — may share their partner), so the vertex set is symmetric.
 */
export function symmetryProblems(m: EditMesh, axis: SymmetryAxis = 'x', tol = 1e-6): string[] {
  const k = AXIS[axis];
  const problems: string[] = [];
  const P = m.counts.points;
  for (let v = 0; v < P; v++) {
    const r = position(m, v);
    r[k] = -r[k];
    let found = false;
    for (let u = 0; u < P && !found; u++) {
      const q = position(m, u);
      if (Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) <= tol) found = true;
    }
    if (!found) problems.push(`vertex ${v} has no mirror image`);
  }
  return problems;
}
