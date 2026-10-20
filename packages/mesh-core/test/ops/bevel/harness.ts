// The op harness of B5's tests (bevel, cleanup, UV projections; M6A-SPEC §5.1, §5.29): runs one `MeshOp` the way the
// runtime does (poll, begin, run, end or abort on a refusal) and checks, after every run:
// - P1: a refusal leaves the mesh bit-identical; a result passes `validateMesh` (and the debug validation in `end()`);
// - canonical edit links: the edited mesh traverses exactly like `editMeshFrom(snapshot())` (P6 across reloads);
// - P5: `apply(delta, 'backward')` restores the stored arrays and links bit-identically and `forward` re-yields the
//   result, on the same mesh and on runtimes rebuilt from the after- and before-states;
// - P8: the incremental revision (`previous` + `dirty`) equals the full one, after the run and after its undo;
// - P4 helpers: consistent winding of every two-face edge, positive signed volume for closed outward meshes.
// No Node APIs here (the Chromium run imports it too).
import type { ParamValues } from '@ekza-animator/anim-core';
import {
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  isRefusal,
  type MeshData,
  type MeshDelta,
  type MeshOp,
  type OpContext,
  type OpResult,
  type Refusal,
  validateMesh,
  writeRevision,
} from '../../../src';
import { diffStored, firstDifference, linkArray } from '../../../src/testing';

/** The scale-relative epsilon the runtime passes (§4.3): 1e-6 × the bounding-box diagonal, at least 1e-9 m. */
export function epsilonOf(m: EditMesh | MeshData): number {
  const p = m.position;
  const n = m.counts.points;
  if (n === 0) return 1e-9;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = p[3 * i + k] as number;
      if (v < (lo[k] as number)) lo[k] = v;
      if (v > (hi[k] as number)) hi[k] = v;
    }
  }
  return Math.max(1e-9, 1e-6 * Math.hypot(...hi.map((h, k) => h - (lo[k] as number))));
}

export function ctxOf(m: EditMesh, patch: Partial<OpContext> = {}): OpContext {
  return {
    symmetry: null,
    hidden: null,
    placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    faceted: true,
    soft: null,
    curves: { compile: () => ({}) as never, evaluate: () => 0 },
    epsilon: epsilonOf(m),
    ...patch,
  };
}

export interface Ran {
  readonly result: OpResult | Refusal;
  readonly delta: MeshDelta | null;
  readonly before: MeshData;
}

function fail(label: string, what: string): never {
  throw new Error(`${label}: ${what}`);
}

/** Runs `op` like the runtime and checks P1, canonical links, P5 and P8 (see the header). */
export function runChecked(
  op: MeshOp,
  m: EditMesh,
  sel: ComponentSelection | null,
  args: ParamValues,
  ctx: OpContext = ctxOf(m),
): Ran {
  const label = `${op.id} ${JSON.stringify(args)}`;
  const before = m.snapshot();
  const beforeLinks = linkArray(m);
  const previous = writeRevision(m);
  const verdict = op.poll(m, sel, ctx);
  if (verdict !== true) return { result: verdict, delta: null, before };
  m.begin(op.id);
  let result: OpResult | Refusal;
  try {
    result = op.run(m, sel, args, ctx);
  } catch (error) {
    m.abort();
    throw error;
  }
  if (isRefusal(result)) {
    m.abort();
    const diff = diffStored(m, before);
    if (diff !== null) fail(label, `a refusal changed the mesh: ${diff}`);
    if (firstDifference(linkArray(m), beforeLinks) !== -1) fail(label, 'a refusal changed the edit links');
    return { result, delta: null, before };
  }
  const delta = m.end();
  const problems = validateMesh(m);
  if (problems.length > 0) fail(label, problems.map((p) => p.message).join('; '));
  const after = m.snapshot();
  const afterLinks = linkArray(m);
  if (firstDifference(afterLinks, linkArray(editMeshFrom(after))) !== -1) {
    fail(label, 'edit links differ from editMeshFrom(snapshot())');
  }
  const full = writeRevision(m);
  const incremental = writeRevision(m, { previous: previous.manifest, dirty: delta.dirty });
  if (incremental.manifestId !== full.manifestId) fail(label, 'incremental revision ≠ full revision');
  const check = (mesh: EditMesh, state: MeshData, links: Int32Array, when: string): void => {
    const diff = diffStored(mesh, state);
    if (diff !== null) fail(label, `${when}: ${diff}`);
    if (firstDifference(linkArray(mesh), links) !== -1) fail(label, `${when}: links differ`);
  };
  m.apply(delta, 'backward');
  check(m, before, beforeLinks, 'undo');
  const back = writeRevision(m, { previous: full.manifest, dirty: delta.dirty });
  if (back.manifestId !== previous.manifestId) fail(label, 'undo: incremental revision ≠ the before revision');
  m.apply(delta, 'forward');
  check(m, after, afterLinks, 'redo');
  const rebuiltAfter = editMeshFrom(after);
  rebuiltAfter.apply(delta, 'backward');
  check(rebuiltAfter, before, beforeLinks, 'undo on a rebuilt runtime');
  const rebuiltBefore = editMeshFrom(before);
  rebuiltBefore.apply(delta, 'forward');
  check(rebuiltBefore, after, afterLinks, 'redo on a runtime rebuilt from the before-state');
  return { result, delta, before };
}

/** Runs and expects a result (not a refusal). */
export function runOk(
  op: MeshOp,
  m: EditMesh,
  sel: ComponentSelection | null,
  args: ParamValues,
  ctx?: OpContext,
): OpResult {
  const { result } = runChecked(op, m, sel, args, ctx);
  if (isRefusal(result)) throw new Error(`${op.id} refused: ${result.code} ${result.reason}`);
  return result;
}

/** P4: every edge with two faces is traversed in opposite directions. */
export function consistentlyWound(m: EditMesh): boolean {
  for (let e = 0; e < m.counts.edges; e++) {
    if (m.edgeFaceCount(e) !== 2) continue;
    const c = m.edgeCorner(e);
    if (m.cornerVert(c) === m.cornerVert(m.cornerRadialNext(c))) return false;
  }
  return true;
}

/** Position of vertex v. */
export function at(m: EditMesh | MeshData, v: number): [number, number, number] {
  const p = m.position;
  return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
}

/** The vertices of face f in winding order. */
export function faceVerts(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  do {
    out.push(m.cornerVert(c));
    c = m.cornerNext(c);
  } while (c !== start);
  return out;
}

/** The edge of `m` joining two positions (within `tol`), or −1. */
export function edgeBetween(m: EditMesh, a: readonly number[], b: readonly number[], tol = 1e-6): number {
  const near = (v: number, p: readonly number[]): boolean => {
    const q = at(m, v);
    return Math.hypot(q[0] - (p[0] as number), q[1] - (p[1] as number), q[2] - (p[2] as number)) <= tol;
  };
  for (let e = 0; e < m.counts.edges; e++) {
    const x = m.edgeVert(e, 0);
    const y = m.edgeVert(e, 1);
    if ((near(x, a) && near(y, b)) || (near(x, b) && near(y, a))) return e;
  }
  return -1;
}

/** Minimum distance between two distinct vertices (no coincident points when > 0). */
export function minVertexGap(m: EditMesh): number {
  let best = Infinity;
  for (let a = 0; a < m.counts.points; a++) {
    const p = at(m, a);
    for (let b = a + 1; b < m.counts.points; b++) {
      const q = at(m, b);
      best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    }
  }
  return best;
}
