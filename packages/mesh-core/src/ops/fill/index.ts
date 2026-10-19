// Kernel ops of `ops/fill/` (M6A-SPEC §6.1, §5.12; B3): `mesh.fillHole` — every border loop touched by the selection
// (any mode: a selected vertex on it, an edge or face touching it) gets one n-gon whose vertices run opposite to the
// existing faces' traversal (consistent winding). The new face takes the lowest-index adjacent face's layers and
// material and, on every corner, the average of the loop's corners (§5.2 fill row). `selection′` = the new faces.
// Loops that touch at a bow-tie vertex are separate holes: each simple loop is filled on its own, and only when one
// of its own vertices is touched (M6A-B3-26). Symmetry: the expanded selection (a hole across the seam is one loop,
// filled once).
import type { ParamValues } from '@ekza-animator/anim-core';
import { averageCornerAttributes } from '../../layers/propagate';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { expandIndices, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import {
  edgeCorners,
  faceCorners,
  opResult,
  resolveArgs,
  selected,
  selectionResult,
  touchedVerts,
  guarded,
} from '../extrude/shared/util';
import { FILL_HOLE } from './descriptor';

export interface BorderLoop {
  /** Vertices in fill order (opposite to the existing faces). */
  readonly verts: readonly number[];
  /** One existing face corner at each vertex (the corner values a fill or a bridge interpolates). */
  readonly corners: readonly number[];
  readonly edges: readonly number[];
  readonly faces: readonly number[];
  readonly closed: boolean;
}

/**
 * Border chains through the given border edges (each edge with exactly one face), in fill order: closed loops, or
 * open paths when `edges` does not cover a whole loop (Bridge). `restrict` limits the walk to those edges.
 */
export function borderChains(m: EditMesh, edges: readonly number[], restrict: boolean): BorderLoop[] {
  const isBorder = (e: number): boolean => m.edgeFaceCount(e) === 1;
  // Fill half-edges: a border corner a → b gives the fill step b → a.
  const leave = new Map<number, { to: number; e: number; corner: number }[]>();
  const add = (e: number): void => {
    const c = edgeCorners(m, e)[0] as number;
    const a = m.cornerVert(c);
    const b = m.cornerVert(m.cornerNext(c));
    const list = leave.get(b) ?? [];
    if (!list.some((x) => x.e === e)) list.push({ to: a, e, corner: m.cornerNext(c) });
    leave.set(b, list);
  };
  const pool = new Set<number>();
  if (restrict) {
    for (const e of edges) if (isBorder(e)) pool.add(e);
  } else {
    // Whole loops: flood the border through shared vertices from the given edges.
    const stack = edges.filter(isBorder);
    for (const e of stack) pool.add(e);
    while (stack.length > 0) {
      const e = stack.pop() as number;
      for (const end of [0, 1] as const) {
        const v = m.edgeVert(e, end);
        let x = m.vertEdge(v);
        const start = x;
        let guard = 0;
        do {
          if (x !== -1 && isBorder(x) && !pool.has(x)) {
            pool.add(x);
            stack.push(x);
          }
          x = m.edgeDiskNext(x, v);
        } while (x !== start && x !== -1 && ++guard <= m.counts.edges);
      }
    }
  }
  for (const e of [...pool].sort((x, y) => x - y)) add(e);
  for (const list of leave.values()) list.sort((x, y) => x.e - y.e);
  const used = new Set<number>();
  const reached = new Map<number, number>();
  for (const list of leave.values()) for (const step of list) reached.set(step.to, (reached.get(step.to) ?? 0) + 1);
  const out: BorderLoop[] = [];
  const walk = (start: number, first: { to: number; e: number; corner: number }): BorderLoop => {
    const verts = [start];
    const corners: number[] = [first.corner];
    const loopEdges: number[] = [];
    const faces: number[] = [];
    let step: { to: number; e: number; corner: number } | undefined = first;
    let closed = false;
    while (step !== undefined) {
      used.add(step.e);
      loopEdges.push(step.e);
      faces.push(m.cornerFace(step.corner));
      if (step.to === start) {
        closed = true;
        break;
      }
      verts.push(step.to);
      const next: { to: number; e: number; corner: number } | undefined = (leave.get(step.to) ?? []).find(
        (x) => !used.has(x.e),
      );
      if (next === undefined) {
        // An open path: the last vertex's corner is the face corner at it on the last edge.
        const c = edgeCorners(m, step.e)[0] as number;
        corners.push(c);
        break;
      }
      corners.push(next.corner);
      step = next;
    }
    return { verts, corners, edges: loopEdges, faces, closed };
  };
  // Open paths first (from vertices nothing reaches), then closed loops from the smallest edge.
  const starts = [...leave.keys()].filter((v) => !reached.has(v)).sort((a, b) => a - b);
  for (const v of starts) {
    const first = (leave.get(v) ?? []).find((x) => !used.has(x.e));
    if (first !== undefined) out.push(walk(v, first));
  }
  for (const e of [...pool].sort((x, y) => x - y)) {
    if (used.has(e)) continue;
    const c = edgeCorners(m, e)[0] as number;
    const b = m.cornerVert(m.cornerNext(c));
    const first = (leave.get(b) ?? []).find((x) => x.e === e);
    if (first !== undefined) out.push(walk(b, first));
  }
  return out;
}

/**
 * A closed border walk split into simple loops at the vertices it visits twice: border loops that touch at a bow-tie
 * vertex (two holes meeting at a corner, a hole touching the outer border) are walked as one figure-eight when the
 * walk turns into the other loop there; each simple loop is its own hole.
 */
function simpleLoops(loop: BorderLoop): BorderLoop[] {
  const out: BorderLoop[] = [];
  const stack: number[] = [];
  const at = new Map<number, number>();
  const cut = (from: number): void => {
    const steps = stack.splice(from);
    for (const i of steps) at.delete(loop.verts[i] as number);
    out.push({
      verts: steps.map((i) => loop.verts[i] as number),
      corners: steps.map((i) => loop.corners[i] as number),
      edges: steps.map((i) => loop.edges[i] as number),
      faces: steps.map((i) => loop.faces[i] as number),
      closed: true,
    });
  };
  for (let i = 0; i < loop.verts.length; i++) {
    const seen = at.get(loop.verts[i] as number);
    if (seen !== undefined) cut(seen);
    at.set(loop.verts[i] as number, stack.length);
    stack.push(i);
  }
  if (stack.length > 0) cut(0);
  return out;
}

function pollFill(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || selected(m, sel, sel.kind, ctx.hidden).length === 0) {
    return refuse('fillHole.no-border', 'Select a component on a hole border');
  }
  return true;
}

function runFill(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollFill(m, sel, ctx);
  if (verdict !== true) return verdict;
  const selection = sel as ComponentSelection;
  const args = resolveArgs(FILL_HOLE, rawArgs);
  const mirror = mirrorOf(ctx);
  const expanded = expandIndices(mirror, selection.kind, selected(m, selection, selection.kind, ctx.hidden));
  const verts = touchedVerts(m, selection.kind, expanded.indices);
  const seeds = new Set<number>();
  for (const v of verts) {
    let e = m.vertEdge(v);
    const start = e;
    let guard = 0;
    while (e !== -1 && guard++ <= m.counts.edges) {
      if (m.edgeFaceCount(e) === 1) seeds.add(e);
      e = m.edgeDiskNext(e, v);
      if (e === start) break;
    }
  }
  // A loop is touched through its own vertices only: the flood through a bow-tie vertex reaches the loops touching
  // there, which are filled only when the selection touches them too.
  const touched = new Set(verts);
  const loops = borderChains(m, [...seeds], false)
    .filter((loop) => loop.closed)
    .flatMap(simpleLoops)
    .filter((loop) => loop.verts.length >= 3 && loop.verts.some((v) => touched.has(v)));
  if (loops.length === 0) return refuse('fillHole.no-border', 'No hole border touches the selection');
  const created: number[] = [];
  for (const loop of loops) {
    const example = Math.min(...loop.faces);
    const f = m.makeFace(loop.verts, { example });
    for (const corner of faceCorners(m, f)) averageCornerAttributes(m, loop.corners, corner);
    if (m.faceFlags(f) !== 0) m.setFaceFlags(f, 0);
    created.push(f);
  }
  return opResult(selectionResult(m, 'face', created), unmatchedWarnings(expanded.unmatched), args);
}

export const fillHole: MeshOp = Object.freeze({ ...FILL_HOLE, poll: pollFill, run: guarded(FILL_HOLE, runFill) });
