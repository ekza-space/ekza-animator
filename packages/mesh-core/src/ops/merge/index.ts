// Kernel ops of `ops/merge/` (M6A-SPEC §6.1, §5.12; B3): the merge family.
// - `mesh.merge {distance, alwaysMergeTwo}`: the selection's touched vertices clustered within `distance` (0 =
//   coincident only); each cluster becomes its first-selected vertex (pick order, else the smallest index) at the
//   cluster centroid; exactly two selected vertices with `alwaysMergeTwo` merge regardless of distance.
// - `mesh.mergeToCenter`: the selected vertices → one vertex at their centroid (cube top face → 5/8/5).
// - `mesh.mergeByDistance {distance}`: every visible vertex of the mesh (Blender's name; Maya's Merge on a whole mesh),
//   with the merged count as a warning.
// Symmetry (§5.14): merge and merge to center run on the expanded selection — the picked group and its mirror merge
// separately; a group that is its own mirror merges once with its centre snapped onto the plane. Nothing to merge is
// a refusal (`<op>.nothing`), so no empty step is recorded.
import type { ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../../refusal';
import type { ComponentKind, ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { expandIndices, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import {
  bool,
  guarded,
  isHiddenVert,
  num,
  opResult,
  pickOrder,
  pos,
  resolveArgs,
  selected,
  selectionResult,
  touchedVerts,
} from '../extrude/shared/util';
import { clusterByDistance, countWarning, mergeGroups, mergesAnything } from './clusters';
import { MERGE, MERGE_BY_DISTANCE, MERGE_TO_CENTER } from './descriptor';

/** The touched vertices of the selection's kind (unexpanded), in pick order where the kind is vertex. */
function pickedVerts(m: EditMesh, sel: ComponentSelection, ctx: OpContext): number[] {
  const kind: ComponentKind = sel.kind;
  const indices = selected(m, sel, kind, ctx.hidden);
  const verts = touchedVerts(m, kind, indices).filter((v) => !isHiddenVert(ctx.hidden, v));
  return kind === 'vertex' ? pickOrder(sel, verts) : verts;
}

function pollSelection(code: string, sentence: string) {
  return (m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal => {
    if (sel === null || selected(m, sel, sel.kind, ctx.hidden).length === 0) return refuse(code, sentence);
    return true;
  };
}

/** Groups with the members of each join pair in one group (union of the groups that hold them). */
function joinGroups(groups: readonly number[][], joins: readonly (readonly [number, number])[]): number[][] {
  const owner = new Map<number, number>();
  groups.forEach((g, i) => {
    for (const v of g) owner.set(v, i);
  });
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  for (const [x, y] of joins) {
    const gx = owner.get(x);
    const gy = owner.get(y);
    if (gx === undefined || gy === undefined) continue;
    const rx = find(gx);
    const ry = find(gy);
    if (rx !== ry) parent[Math.max(rx, ry)] = Math.min(rx, ry);
  }
  const out = new Map<number, number[]>();
  groups.forEach((g, i) => {
    const r = find(i);
    out.set(r, [...(out.get(r) ?? []), ...g]);
  });
  return [...out.values()].map((g) => g.sort((x, y) => x - y)).sort((x, y) => (x[0] as number) - (y[0] as number));
}

/** Orders a group by pick order (the position in `priority`), then index. */
function ordered(group: readonly number[], priority: ReadonlyMap<number, number>): number[] {
  return [...group].sort((a, b) => (priority.get(a) ?? Infinity) - (priority.get(b) ?? Infinity) || a - b);
}

/** The picks without the mirror partners of earlier picks (pick order kept; seam vertices are their own partner). */
function oneSide(picked: readonly number[], mirror: NonNullable<ReturnType<typeof mirrorOf>>): number[] {
  const kept = new Set<number>();
  const out: number[] = [];
  for (const v of picked) {
    const p = mirror.partner('vertex', v);
    if (p !== -1 && p !== v && kept.has(p)) continue;
    kept.add(v);
    out.push(v);
  }
  return out;
}

const pollMerge = pollSelection('merge.no-selection', 'Select vertices to merge');

function runMerge(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollMerge(m, sel, ctx);
  if (verdict !== true) return verdict;
  const args = resolveArgs(MERGE, rawArgs);
  const mirror = mirrorOf(ctx);
  const picked = pickedVerts(m, sel as ComponentSelection, ctx);
  const expanded = expandIndices(mirror, 'vertex', picked);
  const priority = new Map<number, number>(picked.map((v, i) => [v, i]));
  let groups = clusterByDistance(m, expanded.indices, Math.max(0, num(args, 'distance', 0.001)));
  // One pick per mirror pair (§5.14: each side merges separately): the runtime expands the selection before the run,
  // so a single picked vertex arrives with its mirror, and that pair is never "two vertices" to merge.
  const sides = mirror === null ? picked : oneSide(picked, mirror);
  if (sides.length === 2 && bool(args, 'alwaysMergeTwo', true)) {
    // The two picks merge whatever their distance, and so do their mirror images; groups that meet merge into one
    // (a pick on the seam joins both sides: one self-mirrored group, §5.14).
    const [a, b] = sides as [number, number];
    const joins: [number, number][] = [[a, b]];
    if (mirror !== null) {
      const pa = mirror.partner('vertex', a);
      const pb = mirror.partner('vertex', b);
      if (pa !== -1 && pb !== -1) joins.push([pa, pb]);
    }
    groups = joinGroups(groups, joins);
  }
  if (!mergesAnything(groups)) return refuse('merge.nothing', 'No vertices are within the merge threshold');
  // Mirror groups take the mirrored pick order (their partners' priorities).
  const order = new Map(priority);
  if (mirror !== null) {
    for (const [v, i] of priority) {
      const p = mirror.partner('vertex', v);
      if (p !== -1 && !order.has(p)) order.set(p, i);
    }
  }
  const outcome = mergeGroups(
    m,
    groups.map((g) => ordered(g, order)),
    'centroid',
    mirror,
  );
  return opResult(
    selectionResult(m, 'vertex', outcome.reps),
    [...unmatchedWarnings(expanded.unmatched), ...outcome.result.warnings],
    args,
  );
}

const pollMergeToCenter = pollSelection('mergeToCenter.no-selection', 'Select the components to merge');

/**
 * Merge to Center's groups under symmetry (§5.14): the picks and their partners, split into connected components (by
 * the mesh's edges between members). A component that holds a member's partner is its own mirror: then everything
 * merges once, onto the plane. Otherwise the components on one side of the plane merge into one point and their
 * mirrors into the mirrored point. Reading the side from the plane, not from which vertices were picked, gives the same
 * groups for the user's picks and for the runtime's expanded selection (§5.14: the runtime expands 'expand' ops'
 * input before the run, M6A-INT-16: both hands' end caps merged into one point at the body's centre).
 */
function mirrorGroups(
  m: EditMesh,
  picked: readonly number[],
  mirror: NonNullable<ReturnType<typeof mirrorOf>>,
): number[][] {
  const members = new Set<number>(picked);
  for (const v of picked) {
    const p = mirror.partner('vertex', v);
    if (p !== -1) members.add(p);
  }
  // Connected components through the edges whose ends are both members.
  const component = new Map<number, number>();
  const components: number[][] = [];
  for (const start of [...members].sort((a, b) => a - b)) {
    if (component.has(start)) continue;
    const id = components.length;
    const list: number[] = [];
    const stack = [start];
    component.set(start, id);
    while (stack.length > 0) {
      const v = stack.pop() as number;
      list.push(v);
      const first = m.vertEdge(v);
      if (first === -1) continue;
      let e = first;
      do {
        const w = m.edgeOther(e, v);
        if (members.has(w) && !component.has(w)) {
          component.set(w, id);
          stack.push(w);
        }
        e = m.edgeDiskNext(e, v);
      } while (e !== first && e !== -1);
    }
    components.push(list.sort((a, b) => a - b));
  }
  const selfMirrored = components.some((list, id) =>
    list.some((v) => {
      const p = mirror.partner('vertex', v);
      return p !== -1 && component.get(p) === id;
    }),
  );
  if (selfMirrored) return [[...members].sort((a, b) => a - b)];
  // One side's components merge together, the other side's into the mirrored point.
  const side = (list: readonly number[]): number => list.reduce((sum, v) => sum + mirror.distance(pos(m, v)), 0);
  const positive = components.filter((list) => side(list) >= 0).flat();
  const negative = components.filter((list) => side(list) < 0).flat();
  return [positive, negative].filter((group) => group.length > 0);
}

function runMergeToCenter(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollMergeToCenter(m, sel, ctx);
  if (verdict !== true) return verdict;
  const args = resolveArgs(MERGE_TO_CENTER, rawArgs);
  const mirror = mirrorOf(ctx);
  const picked = pickedVerts(m, sel as ComponentSelection, ctx);
  const expanded = expandIndices(mirror, 'vertex', picked);
  const groups = mirror === null ? [picked] : mirrorGroups(m, picked, mirror);
  if (!mergesAnything(groups)) return refuse('mergeToCenter.nothing', 'Select at least two vertices to merge');
  const outcome = mergeGroups(m, groups, 'centroid', mirror);
  return opResult(
    selectionResult(m, 'vertex', outcome.reps),
    [...unmatchedWarnings(expanded.unmatched), ...outcome.result.warnings],
    args,
  );
}

function pollMergeByDistance(m: EditMesh, _sel: ComponentSelection | null, _ctx: OpContext): true | Refusal {
  if (m.counts.points < 2) return refuse('mergeByDistance.nothing', 'The mesh has nothing to merge');
  return true;
}

function runMergeByDistance(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollMergeByDistance(m, sel, ctx);
  if (verdict !== true) return verdict;
  const args = resolveArgs(MERGE_BY_DISTANCE, rawArgs);
  const visible: number[] = [];
  for (let v = 0; v < m.counts.points; v++) if (!isHiddenVert(ctx.hidden, v)) visible.push(v);
  const groups = clusterByDistance(m, visible, Math.max(0, num(args, 'distance', 0.0001)));
  if (!mergesAnything(groups)) return refuse('mergeByDistance.nothing', 'No vertices are within the merge distance');
  const merging = groups.filter((g) => g.length > 1);
  const outcome = mergeGroups(m, merging, 'centroid', null);
  return opResult(
    selectionResult(m, 'vertex', outcome.reps),
    [...countWarning('mergeByDistance.merged', outcome.result.removed), ...outcome.result.warnings],
    args,
  );
}

export const merge: MeshOp = Object.freeze({ ...MERGE, poll: pollMerge, run: guarded(MERGE, runMerge) });
export const mergeToCenter: MeshOp = Object.freeze({
  ...MERGE_TO_CENTER,
  poll: pollMergeToCenter,
  run: guarded(MERGE_TO_CENTER, runMergeToCenter),
});
export const mergeByDistance: MeshOp = Object.freeze({
  ...MERGE_BY_DISTANCE,
  poll: pollMergeByDistance,
  run: guarded(MERGE_BY_DISTANCE, runMergeByDistance),
});
