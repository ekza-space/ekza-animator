// Kernel ops of `ops/connect/` (M6A-SPEC §6.1, §5.11; B3): `mesh.connect`.
// - Vertices: every face holding two or more selected vertices that are not neighbours on its boundary is split by
//   chords between consecutive selected vertices in boundary order; selected vertices with no common face refuse
//   `connect.no-face` ("No face joins the selected vertices").
// - Edges: every face with exactly two selected edges is split between the points at `weight` on each; the weight is
//   measured from a side carried across such faces (as Insert Edge Loop's ring), so a selected ring becomes a straight
//   loop. Faces with three or more selected edges are skipped with the warning `connect.skipped`.
// Chords follow H1; `selection′` = the new edges. Symmetry (§5.14): poll and run see the expanded selection; a
// mirrored pair of edge groups measures the weight from mirrored sides (the source group, on the positive side of
// the plane, as without symmetry; its partner gets the reflected points), so the weight applies to both halves; a
// group that is its own mirror is symmetrized (a point on a crossing edge lands on the plane).
import type { ParamValues } from '@ekza-animator/anim-core';
import { allEdgesHard } from '../../normals/hard';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { pairGroups } from '../extrude/place';
import { cutChord, setChordHard, splitEdgeAt } from '../extrude/shared/split';
import { type Mirror, expandIndices, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import {
  type V3,
  cornerOnEdge,
  edgeFaces,
  faceCorners,
  num,
  opResult,
  pos,
  resolveArgs,
  selected,
  selectionResult,
  setPos,
  uniqueSorted,
  vertFaces,
  guarded,
} from '../extrude/shared/util';
import { CONNECT } from './descriptor';

/** The vertices or edges Connect runs on: the selection, expanded by its mirror partners under symmetry (§5.14). */
function connectSet(m: EditMesh, sel: ComponentSelection, ctx: OpContext) {
  const kind = sel.kind === 'edge' ? 'edge' : 'vertex';
  return { kind, ...expandIndices(mirrorOf(ctx), kind, selected(m, sel, kind, ctx.hidden)) } as const;
}

function pollConnect(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || sel.kind === 'face' || connectSet(m, sel, ctx).indices.length < 2) {
    return refuse('connect.no-selection', 'Select two or more vertices or edges to connect');
  }
  return true;
}

function connectVertices(m: EditMesh, verts: readonly number[]): { chords: number[] } {
  const chosen = new Set(verts);
  const chords: number[] = [];
  const plans: { a: number; b: number; hard: boolean }[] = [];
  for (const f of uniqueSorted(verts.flatMap((v) => vertFaces(m, v)))) {
    const corners = faceCorners(m, f);
    const picked = corners.filter((c) => chosen.has(m.cornerVert(c)));
    if (picked.length < 2) continue;
    const hard = allEdgesHard(m, f);
    const pairs: [number, number][] =
      picked.length === 2
        ? [[picked[0] as number, picked[1] as number]]
        : picked.map((c, i) => [c, picked[(i + 1) % picked.length] as number]);
    for (const [c, d] of pairs) {
      if (m.cornerNext(c) === d || m.cornerNext(d) === c) continue;
      plans.push({ a: m.cornerVert(c), b: m.cornerVert(d), hard });
    }
  }
  for (const plan of plans) {
    const e = cutChord(m, plan.a, plan.b);
    if (e === -1) continue;
    chords.push(plan.a, plan.b, plan.hard ? 1 : 0);
  }
  return { chords };
}

function connectEdges(
  m: EditMesh,
  edges: readonly number[],
  weight: number,
  mirror: Mirror | null,
): { chords: number[]; skipped: number } {
  const chosen = new Set(edges);
  // Faces with exactly two selected edges join them; three or more are skipped.
  const links: { f: number; e1: number; e2: number }[] = [];
  let skipped = 0;
  for (const f of uniqueSorted(edges.flatMap((e) => edgeFaces(m, e)))) {
    const mine = faceCorners(m, f)
      .map((c) => m.cornerEdge(c))
      .filter((e) => chosen.has(e));
    if (mine.length === 2) links.push({ f, e1: mine[0] as number, e2: mine[1] as number });
    else if (mine.length > 2) skipped++;
  }
  const byEdge = new Map<number, typeof links>();
  for (const link of links) {
    for (const e of [link.e1, link.e2]) {
      const list = byEdge.get(e) ?? [];
      list.push(link);
      byEdge.set(e, list);
    }
  }
  // Groups: edges joined through linked faces, each sorted ascending (its first edge starts the side carry).
  const groups: number[][] = [];
  const groupOf = new Map<number, number>();
  for (const start of uniqueSorted(byEdge.keys())) {
    if (groupOf.has(start)) continue;
    const group = [start];
    groupOf.set(start, groups.length);
    for (let i = 0; i < group.length; i++) {
      for (const link of byEdge.get(group[i] as number) ?? []) {
        for (const e of [link.e1, link.e2]) {
          if (groupOf.has(e)) continue;
          groupOf.set(e, groups.length);
          group.push(e);
        }
      }
    }
    groups.push(group.sort((a, b) => a - b));
  }
  // §5.14 roles: a mirrored pair of groups has a source (its centroid on the positive side of the plane) whose sides
  // are the plain run's; its partner takes the mirrored sides, so the weight means the same on both halves.
  const roles = pairGroups(groups, 'edge', mirror, (i) => {
    if (mirror === null) return 0;
    let sum = 0;
    for (const e of groups[i] as number[]) {
      const a = pos(m, m.edgeVert(e, 0));
      const b = pos(m, m.edgeVert(e, 1));
      sum += mirror.distance([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    }
    return sum / (groups[i] as number[]).length;
  });
  // Sides carried across linked faces (x → y on e1 pairs with z → w on e2 as x ↔ w, y ↔ z). The carry commutes with
  // the reflection (a mirrored face runs its edges reversed), so a group started on the mirrored side is the mirror.
  const side = new Map<number, number>();
  const carry = (start: number, from: number): void => {
    side.set(start, from);
    const stack = [start];
    while (stack.length > 0) {
      const e = stack.pop() as number;
      for (const link of byEdge.get(e) ?? []) {
        const other = link.e1 === e ? link.e2 : link.e1;
        if (side.has(other)) continue;
        const c1 = cornerOnEdge(m, link.f, e);
        const c2 = cornerOnEdge(m, link.f, other);
        const x = m.cornerVert(c1);
        const z = m.cornerVert(c2);
        const w = m.cornerVert(m.cornerNext(c2));
        side.set(other, side.get(e) === x ? w : z);
        stack.push(other);
      }
    }
  };
  groups.forEach((group, i) => {
    if (roles[i]?.kind !== 'partner') carry(group[0] as number, m.edgeVert(group[0] as number, 0));
  });
  groups.forEach((group, i) => {
    if (roles[i]?.kind !== 'partner' || mirror === null) return;
    const start = group[0] as number;
    const own = side.get(mirror.partner('edge', start));
    const mapped = own === undefined ? -1 : mirror.partner('vertex', own);
    carry(start, mapped === m.edgeVert(start, 1) ? mapped : m.edgeVert(start, 0));
  });
  const hard = new Map(links.map((link) => [link.f, allEdgesHard(m, link.f)]));
  const vertexOf = new Map<number, number>();
  for (const e of uniqueSorted(side.keys())) {
    const u = side.get(e) === m.edgeVert(e, 0) ? weight : 1 - weight;
    vertexOf.set(e, splitEdgeAt(m, e, [u]).values().next().value as number);
  }
  const chords: number[] = [];
  for (const link of links) {
    const a = vertexOf.get(link.e1) as number;
    const b = vertexOf.get(link.e2) as number;
    if (cutChord(m, a, b) !== -1) chords.push(a, b, hard.get(link.f) === true ? 1 : 0);
  }
  if (mirror !== null) {
    // A partner group's new vertices are its source's reflected (the source keeps the plain run's points); in a group
    // that is its own mirror (or one with unmatched edges) each new vertex is symmetrized with its partner's, and one
    // on a crossing edge lands on the plane.
    const placed = new Map<number, V3>();
    for (const [e, v] of vertexOf) {
      const pe = mirror.partner('edge', e);
      const pv = pe === -1 ? undefined : vertexOf.get(pe);
      if (pv === undefined) continue;
      const role = roles[groupOf.get(e) as number]?.kind;
      const p = pos(m, v);
      if (role === 'source') continue;
      if (role === 'partner') placed.set(v, mirror.reflect(pos(m, pv)));
      else if (pe === e) placed.set(v, (mirror.map.edgeSelf[e] as number) === 1 ? mirror.project(p) : p);
      else placed.set(v, mirror.symmetrize(p, pos(m, pv)));
    }
    for (const [v, p] of placed) setPos(m, v, p);
  }
  return { chords, skipped };
}

function runConnect(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollConnect(m, sel, ctx);
  if (verdict !== true) return verdict;
  const selection = sel as ComponentSelection;
  const args = resolveArgs(CONNECT, rawArgs);
  const mirror = mirrorOf(ctx);
  const expanded = connectSet(m, selection, ctx);
  const kind = expanded.kind;
  const warnings: OpWarning[] = [...unmatchedWarnings(expanded.unmatched)];
  let chords: number[];
  if (kind === 'vertex') chords = connectVertices(m, expanded.indices).chords;
  else {
    const done = connectEdges(m, expanded.indices, num(args, 'weight', 0.5), mirror);
    chords = done.chords;
    if (done.skipped > 0) {
      warnings.push({
        code: 'connect.skipped',
        message: `Skipped ${done.skipped} face${done.skipped === 1 ? '' : 's'} with three or more selected edges`,
        count: done.skipped,
      });
    }
  }
  if (chords.length === 0) {
    return kind === 'vertex'
      ? refuse('connect.no-face', 'No face joins the selected vertices')
      : refuse('connect.no-face', 'No face holds exactly two of the selected edges');
  }
  const out: number[] = [];
  for (let i = 0; i < chords.length; i += 3) {
    const e = m.findEdge(chords[i] as number, chords[i + 1] as number);
    if (e === -1) continue;
    setChordHard(m, e, chords[i + 2] === 1);
    out.push(e);
  }
  return opResult(selectionResult(m, 'edge', uniqueSorted(out)), warnings, args);
}

export const connect: MeshOp = Object.freeze({ ...CONNECT, poll: pollConnect, run: guarded(CONNECT, runConnect) });
