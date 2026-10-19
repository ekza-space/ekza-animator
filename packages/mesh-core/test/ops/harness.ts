// The B4 op harness (M6A-SPEC §5.29): runs one kernel op the way the runtime does (poll, begin, run, end — or abort
// on a refusal) and checks, after every run:
// - P1: no throw; a refusal leaves the mesh bit-identical after the abort; a result passes `validateMesh`;
// - canonical edit links (the mesh traverses like `editMeshFrom(snapshot())`) and canonical dead slots;
// - no temporary flag mark (`TEMP_MARK`) survives; the returned selection is sized to the new counts;
// - P5: `apply(delta, 'backward')` restores the stored arrays and links bit-identically and `forward` re-yields the
//   after-state — on the same mesh and on runtimes rebuilt from the after- and the before-state;
// - P8: the incremental revision (`previous` + `dirty`) has the full write's manifest id; after the undo the
//   incremental write gives the before id;
// - P7-hard: an all-hard mesh stays all-hard (unless the caller says the op may soften).
// No Node APIs: shared by the Node and the Chromium runs.
import type { ParamValues, ReadonlyXf } from '@ekza-animator/anim-core';
import { expect } from 'vitest';
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
} from '../../src';
import { isAllHard } from '../../src/normals/hard';
import { TEMP_MARK } from '../../src/subset/support';
import { diffStored, firstDifference, linkArray } from '../../src/testing';
import { deadSlotProblem } from '../properties/harness';

export const IDENTITY: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };

export function context(patch: Partial<OpContext> = {}): OpContext {
  return {
    symmetry: null,
    hidden: null,
    placement: IDENTITY,
    faceted: true,
    soft: null,
    curves: { compile: () => ({}) as never, evaluate: () => 0 },
    epsilon: 1e-9,
    ...patch,
  };
}

export interface OpRun {
  readonly result: OpResult | Refusal;
  readonly before: MeshData;
  readonly after: MeshData;
  readonly delta: MeshDelta | null;
}

function fail(label: string, what: string): never {
  throw new Error(`${label}: ${what}`);
}

function checkState(m: EditMesh, state: MeshData, links: Int32Array, label: string, when: string): void {
  const diff = diffStored(m, state);
  if (diff !== null) fail(label, `${when}: ${diff}`);
  const at = firstDifference(linkArray(m), links);
  if (at !== -1) fail(label, `${when}: links differ at ${at}`);
  const dead = deadSlotProblem(m);
  if (dead !== null) fail(label, `${when}: ${dead}`);
}

/** Runs `op` on `m` with every check of the header; the mesh is left in the after-state (or untouched on a refusal). */
export function runOp(
  m: EditMesh,
  op: MeshOp,
  sel: ComponentSelection | null,
  args: ParamValues = {},
  ctx: OpContext = context(),
  opts: { readonly maySoften?: boolean } = {},
): OpRun {
  const label = op.id;
  const before = m.snapshot();
  const beforeLinks = linkArray(m);
  const allHard = before.counts.edges > 0 && isAllHard(m);
  const previous = writeRevision(m);
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
    checkState(m, before, beforeLinks, label, 'after a refusal');
    return { result, before, after: before, delta: null };
  }
  const delta = m.end();
  const problems = validateMesh(m);
  if (problems.length > 0) fail(label, problems.map((p) => `${p.code}: ${p.message}`).join('; '));
  const after = m.snapshot();
  const afterLinks = linkArray(m);
  const canonical = firstDifference(afterLinks, linkArray(editMeshFrom(after)));
  if (canonical !== -1) fail(label, `links differ from editMeshFrom(snapshot()) at ${canonical}`);
  const dead = deadSlotProblem(m);
  if (dead !== null) fail(label, dead);
  for (let e = 0; e < after.counts.edges; e++) {
    if (((after.edgeFlags[e] as number) & TEMP_MARK) !== 0) fail(label, `edge ${e} kept the temporary mark`);
  }
  for (let f = 0; f < after.counts.faces; f++) {
    if (((after.faceFlags[f] as number) & TEMP_MARK) !== 0) fail(label, `face ${f} kept the temporary mark`);
  }
  const sel2 = result.selection;
  expect([sel2.verts.size, sel2.edges.size, sel2.faces.size], `${label}: selection sizes`).toEqual([
    after.counts.points,
    after.counts.edges,
    after.counts.faces,
  ]);
  if (allHard && opts.maySoften !== true && !isAllHard(m)) fail(label, 'P7-hard: an all-hard mesh lost a hard edge');
  // P8
  const full = writeRevision(m);
  const incremental = writeRevision(m, { previous: previous.manifest, dirty: delta.dirty });
  if (incremental.manifestId !== full.manifestId) fail(label, 'incremental revision ≠ full revision');
  // P5
  m.apply(delta, 'backward');
  checkState(m, before, beforeLinks, label, 'undo');
  const back = writeRevision(m, { previous: full.manifest, dirty: delta.dirty });
  if (back.manifestId !== previous.manifestId) fail(label, 'undo: incremental revision ≠ the before revision');
  m.apply(delta, 'forward');
  checkState(m, after, afterLinks, label, 'redo');
  const rebuiltAfter = editMeshFrom(after);
  rebuiltAfter.apply(delta, 'backward');
  checkState(rebuiltAfter, before, beforeLinks, label, 'undo on a rebuilt runtime');
  const rebuiltBefore = editMeshFrom(before);
  rebuiltBefore.apply(delta, 'forward');
  checkState(rebuiltBefore, after, afterLinks, label, 'redo on a runtime rebuilt from the before-state');
  return { result, before, after, delta };
}

/** `runOp` that expects a result (fails the test with the refusal's reason otherwise). */
export function runOk(
  m: EditMesh,
  op: MeshOp,
  sel: ComponentSelection | null,
  args: ParamValues = {},
  ctx: OpContext = context(),
  opts: { readonly maySoften?: boolean } = {},
): OpResult {
  const run = runOp(m, op, sel, args, ctx, opts);
  if (isRefusal(run.result)) throw new Error(`${op.id} refused: ${run.result.code} — ${run.result.reason}`);
  return run.result;
}

/** `runOp` that expects a refusal; returns its code. */
export function refusedCode(
  m: EditMesh,
  op: MeshOp,
  sel: ComponentSelection | null,
  args: ParamValues = {},
  ctx: OpContext = context(),
): string {
  const run = runOp(m, op, sel, args, ctx);
  if (!isRefusal(run.result)) throw new Error(`${op.id} ran; a refusal was expected`);
  return run.result.code;
}

// ---------- small geometry helpers for assertions ----------

export function position(m: EditMesh | MeshData, v: number): [number, number, number] {
  const p = m.position;
  return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
}

export function faceVertList(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  do {
    out.push(m.cornerVert(c));
    c = m.cornerNext(c);
  } while (c !== start);
  return out;
}

/** The face whose vertex set equals `verts` (any rotation/direction), or −1. */
export function findFace(m: EditMesh, verts: readonly number[]): number {
  const key = [...verts].sort((a, b) => a - b).join(',');
  for (let f = 0; f < m.counts.faces; f++) {
    if ([...faceVertList(m, f)].sort((a, b) => a - b).join(',') === key) return f;
  }
  return -1;
}

/** Faces whose centroid satisfies `pred`. */
export function facesWhere(m: EditMesh, pred: (c: [number, number, number]) => boolean): number[] {
  const out: number[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    const verts = faceVertList(m, f);
    const c: [number, number, number] = [0, 0, 0];
    for (const v of verts) {
      const p = position(m, v);
      c[0] += p[0] / verts.length;
      c[1] += p[1] / verts.length;
      c[2] += p[2] / verts.length;
    }
    if (pred(c)) out.push(f);
  }
  return out;
}

/** The edge joining the vertices at the given positions (exact), or −1. */
export function edgeAt(m: EditMesh, a: readonly number[], b: readonly number[]): number {
  const find = (q: readonly number[]): number => {
    for (let v = 0; v < m.counts.points; v++) {
      const p = position(m, v);
      if (
        Math.abs(p[0] - (q[0] as number)) < 1e-6 &&
        Math.abs(p[1] - (q[1] as number)) < 1e-6 &&
        Math.abs(p[2] - (q[2] as number)) < 1e-6
      )
        return v;
    }
    return -1;
  };
  const va = find(a);
  const vb = find(b);
  return va === -1 || vb === -1 ? -1 : m.findEdge(va, vb);
}

export function vertexAt(m: EditMesh, q: readonly number[]): number {
  for (let v = 0; v < m.counts.points; v++) {
    const p = position(m, v);
    if (
      Math.abs(p[0] - (q[0] as number)) < 1e-6 &&
      Math.abs(p[1] - (q[1] as number)) < 1e-6 &&
      Math.abs(p[2] - (q[2] as number)) < 1e-6
    )
      return v;
  }
  return -1;
}
