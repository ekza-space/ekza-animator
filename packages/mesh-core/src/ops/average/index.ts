// Kernel op `mesh.averageVertices {iterations, strength}` (M6A-SPEC §5.12; Maya Average Vertices; owner B4). Each of
// `iterations` Laplacian steps moves every selected (object mode: every visible) vertex toward the average of its edge
// neighbours by `strength` (Jacobi: a step reads the previous step's positions; float64 throughout, one write per
// vertex at the end). Pinned: border vertices, non-manifold vertices, loose vertices. Under symmetry (the runtime
// expands the selection) mirrored pairs are averaged then re-mirrored (each side set to the mean of its value and its
// partner's mirror image), and seam vertices stay on the plane (pinned with Preserve Seam, else projected onto it).
// Positions only; `adjust` re-runs from the pre-op positions for new `iterations`/`strength` (live preview).
import type { ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../../refusal';
import { argsOf, edgeCorners, keptSelection, num, scopeVerts, vertEdges } from '../../subset/support';
import { axisIndex, expandWarnings, mirrorCoord, partnerOf } from '../../subset/symmetry';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { AVERAGE_VERTICES } from './descriptor';

/** Vertices that never move: on a border edge, non-manifold, or without edges. */
function pinned(m: EditMesh, v: number): boolean {
  const edges = vertEdges(m, v);
  if (edges.length === 0) return true;
  if (!m.isManifoldVert(v)) return true;
  const radial: number[] = [];
  for (const e of edges) if (edgeCorners(m, e, radial).length !== 2) return true;
  return false;
}

interface Plan {
  readonly moving: Int32Array;
  readonly start: Float64Array; // 3P, pre-op positions
}

function plan(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): Plan {
  const map = ctx.symmetry?.map ?? null;
  const preserve = ctx.symmetry?.preserveSeam ?? true;
  const moving = scopeVerts(m, sel, ctx.hidden).filter((v) => {
    if (pinned(m, v)) return false;
    if (map !== null && preserve && partnerOf(map, 'vertex', v) === v) return false;
    return true;
  });
  const start = Float64Array.from(m.position.subarray(0, 3 * m.counts.points));
  return { moving: Int32Array.from(moving), start };
}

/** The averaged positions (float64, 3P) for `iterations` and `strength`. */
function solve(m: EditMesh, p: Plan, iterations: number, strength: number, ctx: OpContext): Float64Array {
  const cur = Float64Array.from(p.start);
  const next = Float64Array.from(p.start);
  const edges: number[] = [];
  const neighbours = Array.from(p.moving, (v) => vertEdges(m, v, edges).map((e) => m.edgeOther(e, v)));
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < p.moving.length; i++) {
      const v = p.moving[i] as number;
      const list = neighbours[i] as number[];
      let x = 0;
      let y = 0;
      let z = 0;
      for (const w of list) {
        x += cur[3 * w] as number;
        y += cur[3 * w + 1] as number;
        z += cur[3 * w + 2] as number;
      }
      const n = list.length;
      next[3 * v] = (cur[3 * v] as number) + strength * (x / n - (cur[3 * v] as number));
      next[3 * v + 1] = (cur[3 * v + 1] as number) + strength * (y / n - (cur[3 * v + 1] as number));
      next[3 * v + 2] = (cur[3 * v + 2] as number) + strength * (z / n - (cur[3 * v + 2] as number));
    }
    for (const v of p.moving) {
      cur[3 * v] = next[3 * v] as number;
      cur[3 * v + 1] = next[3 * v + 1] as number;
      cur[3 * v + 2] = next[3 * v + 2] as number;
    }
  }
  const map = ctx.symmetry?.map ?? null;
  if (map !== null) {
    const k = axisIndex(map.axis);
    const inSet = new Set(p.moving);
    for (const v of p.moving) {
      const q = partnerOf(map, 'vertex', v);
      if (q === v) {
        cur[3 * v + k] = map.plane; // a seam vertex stays on the plane
        continue;
      }
      if (q < 0 || !inSet.has(q) || q < v) continue;
      // Mean of v and the mirror image of q, then q = the mirror image of v.
      for (let c = 0; c < 3; c++) {
        const mirrored = c === k ? mirrorCoord(map, cur[3 * q + c] as number) : (cur[3 * q + c] as number);
        cur[3 * v + c] = ((cur[3 * v + c] as number) + mirrored) / 2;
      }
      for (let c = 0; c < 3; c++) {
        cur[3 * q + c] = c === k ? mirrorCoord(map, cur[3 * v + c] as number) : (cur[3 * v + c] as number);
      }
    }
  }
  return cur;
}

function write(m: EditMesh, p: Plan, target: Float64Array): void {
  for (const v of p.moving) {
    const x = (target[3 * v] as number) + 0;
    const y = (target[3 * v + 1] as number) + 0;
    const z = (target[3 * v + 2] as number) + 0;
    const at = m.position;
    if (
      Object.is(at[3 * v], Math.fround(x)) &&
      Object.is(at[3 * v + 1], Math.fround(y)) &&
      Object.is(at[3 * v + 2], Math.fround(z))
    ) {
      continue;
    }
    m.setPosition(v, x, y, z);
  }
}

function averagePoll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  return scopeVerts(m, sel, ctx.hidden).length > 0
    ? true
    : refuse('averageVertices.no-vertices', 'Average Vertices needs vertices: select components');
}

export const averageVertices: MeshOp = Object.freeze({
  ...AVERAGE_VERTICES,
  poll: averagePoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = averagePoll(m, sel, ctx);
    if (verdict !== true) return verdict;
    let args = argsOf(AVERAGE_VERTICES.params, raw);
    const p = plan(m, sel, ctx);
    write(m, p, solve(m, p, num(args, 'iterations', 1), num(args, 'strength', 0.5), ctx));
    return {
      selection: keptSelection(m, sel, sel?.kind ?? 'vertex'),
      warnings: expandWarnings(sel, ctx),
      resolvedArgs: args,
      adjust(patch: ParamValues): boolean {
        const keys = Object.keys(patch);
        if (!keys.every((key) => key === 'iterations' || key === 'strength')) return false;
        args = argsOf(AVERAGE_VERTICES.params, { ...args, ...patch });
        write(m, p, solve(m, p, num(args, 'iterations', 1), num(args, 'strength', 0.5), ctx));
        return true;
      },
    };
  },
});
