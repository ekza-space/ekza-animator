// Kernel op `mesh.spinEdge {direction}` (M6A-SPEC §5.12, research 10 §4.12; owner B4): each selected edge is spun one
// vertex along the joined polygon's winding (./spin.ts). Refuses border edges (`spin.border-edge`), selections with two
// edges in one face (`spin.same-face`) and spins that would duplicate an edge. Counts never change; `selection′` = the
// spun edges. Under symmetry (the runtime expands the selection) an edge on the negative side whose mirror partner is
// spun too turns the other way, so the result stays a mirror image.
import type { ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../../refusal';
import {
  argsOf,
  collectMarkedEdges,
  edgeCorners,
  guarded,
  markEdge,
  resultSelection,
  scopeEdges,
  str,
} from '../../subset/support';
import { expandWarnings, partnerOf, vertexSide } from '../../subset/symmetry';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { SPIN_EDGE } from './descriptor';
import { planSpin, type SpinDirection, type SpinPlan, spin } from './spin';

function spinPoll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  const edges = scopeEdges(m, sel, ctx.hidden);
  if (edges.length === 0) return refuse('spin.no-edges', 'Spin Edge needs edges: select edges');
  return sameFace(m, edges)
    ? refuse('spin.same-face', 'Spin one edge per face: two selected edges share a face')
    : true;
}

/** True when two of `edges` share a face. */
export function sameFace(m: EditMesh, edges: readonly number[]): boolean {
  const seen = new Set<number>();
  const radial: number[] = [];
  for (const e of edges) {
    const faces = new Set(edgeCorners(m, e, radial).map((c) => m.cornerFace(c)));
    for (const f of faces) {
      if (seen.has(f)) return true;
      seen.add(f);
    }
  }
  return false;
}

/** The direction for edge `e`: mirrored (reversed) on the negative side when its partner is spun too. */
export function mirroredDirection(
  m: EditMesh,
  e: number,
  direction: SpinDirection,
  inSet: ReadonlySet<number>,
  ctx: OpContext,
): SpinDirection {
  const map = ctx.symmetry?.map;
  if (map === undefined) return direction;
  const p = partnerOf(map, 'edge', e);
  if (p < 0 || p === e || !inSet.has(p)) return direction;
  const side = vertexSide(m, map, m.edgeVert(e, 0)) + vertexSide(m, map, m.edgeVert(e, 1));
  if (side >= 0) return direction;
  return direction === 'forward' ? 'back' : 'forward';
}

/** Spins every planned edge (descending edge order) and returns the spun edges' final indices. */
export function spinAll(m: EditMesh, plans: readonly SpinPlan[]): number[] {
  for (const plan of [...plans].sort((x, y) => y.edge - x.edge)) markEdge(m, spin(m, plan));
  return collectMarkedEdges(m);
}

export const spinEdge: MeshOp = Object.freeze({
  ...SPIN_EDGE,
  poll: spinPoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = spinPoll(m, sel, ctx);
    if (verdict !== true) return verdict;
    const args = argsOf(SPIN_EDGE.params, raw);
    const direction = str<SpinDirection>(args, 'direction', 'forward');
    const edges = scopeEdges(m, sel, ctx.hidden);
    const inSet = new Set(edges);
    const plans: SpinPlan[] = [];
    for (const e of edges) {
      const plan = planSpin(m, e, mirroredDirection(m, e, direction, inSet, ctx));
      if ('refused' in plan) return plan;
      plans.push(plan);
    }
    return guarded('spin.failed', 'The edge could not be spun', () => ({
      selection: resultSelection(m, 'edge', spinAll(m, plans)),
      warnings: expandWarnings(sel, ctx),
      resolvedArgs: args,
    }));
  },
});
