// Kernel ops of `ops/collapse/` (M6A-SPEC §6.1, §5.12; B3): `mesh.collapse` — each selected edge → its midpoint, each
// selected face → its centroid (one cube edge → 7/11/6); connected selected components collapse to one point (the
// centroid of their vertices). `selection′` = the resulting vertices. Symmetry (§5.14): the expanded selection; a group
// that is its own mirror lands on the plane.
import type { ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { expandIndices, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import { faceVerts, opResult, resolveArgs, selected, selectionResult } from '../extrude/shared/util';
import { mergeGroups } from '../merge/clusters';
import { COLLAPSE } from './descriptor';

function pollCollapse(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || sel.kind === 'vertex' || selected(m, sel, sel.kind, ctx.hidden).length === 0) {
    return refuse('collapse.no-selection', 'Select edges or faces to collapse');
  }
  return true;
}

function runCollapse(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollCollapse(m, sel, ctx);
  if (verdict !== true) return verdict;
  const selection = sel as ComponentSelection;
  const args = resolveArgs(COLLAPSE, rawArgs);
  const mirror = mirrorOf(ctx);
  const kind = selection.kind === 'edge' ? 'edge' : 'face';
  const expanded = expandIndices(mirror, kind, selected(m, selection, kind, ctx.hidden));
  // Union-find over the vertices of each component.
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    if (!parent.has(v)) parent.set(v, v);
    let r = v;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  for (const i of expanded.indices) {
    const verts = kind === 'edge' ? [m.edgeVert(i, 0), m.edgeVert(i, 1)] : faceVerts(m, i);
    for (const v of verts) union(verts[0] as number, v);
  }
  const groups = new Map<number, number[]>();
  for (const v of [...parent.keys()].sort((a, b) => a - b)) {
    const r = find(v);
    const list = groups.get(r) ?? [];
    list.push(v);
    groups.set(r, list);
  }
  const outcome = mergeGroups(
    m,
    [...groups.values()].sort((a, b) => (a[0] as number) - (b[0] as number)),
    'centroid',
    mirror,
  );
  return opResult(
    selectionResult(m, 'vertex', outcome.reps),
    [...unmatchedWarnings(expanded.unmatched), ...outcome.result.warnings],
    args,
  );
}

export const collapse: MeshOp = Object.freeze({ ...COLLAPSE, poll: pollCollapse, run: runCollapse });
