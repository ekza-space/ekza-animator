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
  isHiddenVert,
  num,
  bool,
  opResult,
  pickOrder,
  resolveArgs,
  selected,
  selectionResult,
  touchedVerts,
  guarded,
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

/** Orders a group by pick order (the position in `priority`), then index. */
function ordered(group: readonly number[], priority: ReadonlyMap<number, number>): number[] {
  return [...group].sort((a, b) => (priority.get(a) ?? Infinity) - (priority.get(b) ?? Infinity) || a - b);
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
  if (picked.length === 2 && bool(args, 'alwaysMergeTwo', true)) {
    const [a, b] = picked as [number, number];
    const pair = new Set([a, b]);
    const mirrored = mirror === null ? null : new Set([mirror.partner('vertex', a), mirror.partner('vertex', b)]);
    const together = (g: readonly number[]) => g.some((v) => pair.has(v));
    const mirrorTogether = (g: readonly number[]) => mirrored !== null && g.some((v) => mirrored.has(v));
    const joined = groups.filter(together).flat();
    const joinedMirror = groups.filter((g) => !together(g) && mirrorTogether(g)).flat();
    groups = [
      ...groups.filter((g) => !together(g) && !mirrorTogether(g)),
      joined,
      ...(joinedMirror.length > 0 ? [joinedMirror] : []),
    ].filter((g) => g.length > 0);
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
  let groups: number[][] = [picked];
  if (mirror !== null) {
    const partners = picked.map((v) => mirror.partner('vertex', v)).filter((v) => v !== -1);
    const own = new Set(picked);
    if (partners.some((v) => own.has(v))) groups = [[...new Set([...picked, ...partners])]];
    else if (partners.length > 0) groups = [picked, partners];
  }
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
