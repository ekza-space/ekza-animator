// Kernel ops of `ops/targetWeld/` (M6A-SPEC §6.1, §5.12, §5.14; B3): `mesh.targetWeld {pairs, mode}` — each pair
// [source, target] (pointer-bound; vertices, or edges in edge mode welded endpoint to endpoint by proximity) merges the
// source into the target at the target (`mode: 'target'`, the target's layers) or at their midpoint (`'center'`).
// `selection′` = the target vertices. Symmetry (pointer class) by the §5.14 seam table: s → g also welds p(s) → p(g);
// g on the seam: both s and p(s) weld onto g; g = p(s): both merge to their centre on the plane; s on the seam and g
// off it: refused with Preserve Seam (`symmetry.seam`); a missing partner welds once with
// `symmetry.unmatched-partner`.
import type { ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { unmatchedWarnings, mirrorOf } from '../extrude/shared/symmetry';
import { type V3, guarded, lerp3, opResult, pos, resolveArgs, selectionResult, str } from '../extrude/shared/util';
import { mergeGroups } from '../merge/clusters';
import { TARGET_WELD } from './descriptor';

/** Always true: the tool supplies `pairs` (poll sees no args); `run` refuses missing or invalid pairs. */
function pollTargetWeld(_m: EditMesh, _sel: ComponentSelection | null, _ctx: OpContext): true | Refusal {
  return true;
}

/** Vertex pairs of the args: vertex pairs as given; edge pairs endpoint to the nearest endpoint. */
function vertexPairs(m: EditMesh, raw: unknown, edges: boolean): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  const out: [number, number][] = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [s, g] = pair as [unknown, unknown];
    if (typeof s !== 'number' || typeof g !== 'number' || !Number.isInteger(s) || !Number.isInteger(g)) return null;
    const limit = edges ? m.counts.edges : m.counts.points;
    if (s < 0 || g < 0 || s >= limit || g >= limit || s === g) return null;
    if (!edges) {
      out.push([s, g]);
      continue;
    }
    const s0 = m.edgeVert(s, 0);
    const s1 = m.edgeVert(s, 1);
    const g0 = m.edgeVert(g, 0);
    const g1 = m.edgeVert(g, 1);
    const d = (a: number, b: number): number => {
      const p = pos(m, a);
      const q = pos(m, b);
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    const straight = d(s0, g0) + d(s1, g1);
    const crossed = d(s0, g1) + d(s1, g0);
    const ends: [number, number][] =
      straight <= crossed
        ? [
            [s0, g0],
            [s1, g1],
          ]
        : [
            [s0, g1],
            [s1, g0],
          ];
    for (const [a, b] of ends) if (a !== b) out.push([a, b]);
  }
  return out;
}

function runTargetWeld(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const args = resolveArgs(TARGET_WELD, rawArgs);
  const pairs = vertexPairs(m, args['pairs'], sel?.kind === 'edge');
  if (pairs === null || pairs.length === 0) {
    return refuse('targetWeld.no-pairs', 'Drag a vertex onto the vertex to weld it to');
  }
  const center = str(args, 'mode', 'target') === 'center';
  const mirror = mirrorOf(ctx);
  let unmatched = 0;
  // Welds as (source, target) with optional midpoint groups; then merged into groups by target.
  const welds: [number, number][] = [];
  const centres: number[][] = [];
  for (const [s, g] of pairs) {
    if (mirror === null) {
      if (center) centres.push([g, s]);
      else welds.push([s, g]);
      continue;
    }
    const ps = mirror.partner('vertex', s);
    const pg = mirror.partner('vertex', g);
    if (ps === -1 || pg === -1) {
      unmatched++;
      if (center) centres.push([g, s]);
      else welds.push([s, g]);
      continue;
    }
    if (g === ps) {
      centres.push([g, s]);
      continue;
    }
    const gOnSeam = pg === g;
    const sOnSeam = ps === s;
    if (sOnSeam && !gOnSeam) {
      if (mirror.preserveSeam) {
        return refuse('symmetry.seam', 'This would pull the centre line off the mirror plane');
      }
      welds.push([s, g]);
      continue;
    }
    if (gOnSeam) {
      welds.push([s, g]);
      if (ps !== s) welds.push([ps, g]);
      continue;
    }
    if (center) centres.push([g, s], [pg, ps]);
    else welds.push([s, g], [ps, pg]);
  }
  // Group by final target (chains s → g → h resolve to h).
  const to = new Map<number, number>();
  for (const [s, g] of welds) to.set(s, g);
  const resolve = (v: number): number => {
    let r = v;
    const seen = new Set<number>();
    while (to.has(r) && !seen.has(r)) {
      seen.add(r);
      r = to.get(r) as number;
    }
    return r;
  };
  const groups = new Map<number, number[]>();
  const add = (rep: number, v: number): void => {
    const list = groups.get(rep) ?? [rep];
    if (!list.includes(v)) list.push(v);
    groups.set(rep, list);
  };
  for (const [s] of welds) add(resolve(s), s);
  const centreOf = new Map<string, V3>();
  for (const group of centres) {
    const [g, s] = group as [number, number];
    const rep = resolve(g);
    add(rep, s);
    for (const v of group) if (v !== rep) add(rep, v);
    const list = groups.get(rep) as number[];
    // Midpoint of the dragged pair (on the plane when it is a mirror pair, by mergeGroups' snap).
    centreOf.set(list.join(','), lerp3(pos(m, s), pos(m, g), 0.5));
  }
  const ordered = [...groups.values()].sort((a, b) => (a[0] as number) - (b[0] as number));
  const outcome = mergeGroups(m, ordered, 'target', mirror, (group) => centreOf.get(group.join(',')) ?? null);
  return opResult(
    selectionResult(m, 'vertex', outcome.reps),
    [...unmatchedWarnings(unmatched), ...outcome.result.warnings],
    args,
  );
}

export const targetWeld: MeshOp = Object.freeze({
  ...TARGET_WELD,
  poll: pollTargetWeld,
  run: guarded(TARGET_WELD, runTargetWeld),
});
