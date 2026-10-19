// Kernel ops of `ops/delete/` (M6A-SPEC §6.1, §5.12; B3): the delete family.
// - `mesh.delete` (Maya plain Delete): vertex mode deletes only winged vertices (valence 2; each dissolved into the
//   edge joining its neighbours) and refuses `delete.not-winged` otherwise; edge mode removes each edge and merges its
//   two faces into one polygon, end vertices stay (cube edge → 8/11/5), a border edge goes with its face; face mode
//   removes the faces and the edges and vertices only they used.
// - `mesh.deleteEdgeVertex` (Delete Edge/Vertex, Mod+Delete): edge mode as plain Delete, then every vertex the deletion
//   left with valence 2 is dissolved (cube edge → 6/9/5); border edges refuse `delete.border-edge`; vertex mode removes
//   each vertex with its edges and merges its faces into one n-gon (cube corner → 7/9/4; a border vertex joins its
//   two border neighbours).
// Merged faces are made over the boundary of their union (each corner keeps its values; the smallest face's layers and
// material); a union that would need a hole refuses `delete.hole`. `selection′` is empty. Symmetry: the expanded
// selection (§5.14). Nothing is kept unused (§5.1 orphan cleanup).
import type { ParamValues } from '@ekza-animator/anim-core';
import type { ComponentKind, ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { refuse } from '../../refusal';
import { copyCornerRaw } from '../extrude/shared/rewire';
import { expandIndices, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import {
  edgeFaces,
  faceCorners,
  opResult,
  removalMap,
  resolveArgs,
  selected,
  selectionResult,
  uniqueSorted,
  vertEdges,
  vertFaces,
} from '../extrude/shared/util';
import { DELETE, DELETE_EDGE_VERTEX } from './descriptor';

/** A group of faces merged into one polygon over the boundary of their union. */
interface MergeGroup {
  readonly faces: readonly number[];
  /** Vertex cycle and the corner each new corner copies. */
  readonly verts: readonly number[];
  readonly corners: readonly number[];
}

/**
 * The boundary cycle of a face group: corners whose edge is not internal, chained; vertices in `removed` are skipped
 * and an open path is closed. Null when the boundary is not one simple cycle (a hole, a pinch).
 */
function unionCycle(
  m: EditMesh,
  faces: readonly number[],
  internal: (e: number) => boolean,
  removed: ReadonlySet<number>,
): { verts: number[]; corners: number[] } | null {
  const out = new Map<number, number[]>(); // vertex → corners leaving it
  let count = 0;
  for (const f of faces) {
    for (const c of faceCorners(m, f)) {
      if (internal(m.cornerEdge(c))) continue;
      const from = m.cornerVert(c);
      const list = out.get(from) ?? [];
      list.push(c);
      out.set(from, list);
      count++;
    }
  }
  if (count === 0) return null;
  for (const list of out.values()) if (list.length > 1) return null;
  const nextOf = (c: number): number => m.cornerVert(m.cornerNext(c));
  // Path starts: corners whose start vertex no corner reaches (open paths after removed vertices).
  const reached = new Set<number>();
  for (const list of out.values()) for (const c of list) reached.add(nextOf(c));
  const starts = [...out.keys()].filter((v) => !reached.has(v));
  if (starts.length > 1) return null;
  const first = starts[0] ?? Math.min(...out.keys());
  const verts: number[] = [];
  const corners: number[] = [];
  let v = first;
  const seen = new Set<number>();
  while (out.has(v) && !seen.has(v)) {
    seen.add(v);
    const c = (out.get(v) as number[])[0] as number;
    if (!removed.has(v)) {
      verts.push(v);
      corners.push(c);
    }
    v = nextOf(c);
  }
  // An open path ends at a vertex with no outgoing boundary corner: its corner comes from the last corner's next.
  if (starts.length === 1 && !removed.has(v) && !seen.has(v)) {
    verts.push(v);
    const last = corners[corners.length - 1];
    corners.push(
      last === undefined ? -1 : (faceCorners(m, m.cornerFace(last)).find((c) => m.cornerVert(c) === v) ?? last),
    );
  }
  if (seen.size !== out.size) return null;
  if (new Set(verts).size !== verts.length || verts.length < 3) return null;
  return { verts, corners };
}

/** Union-find groups of `faces` joined across the given edges (only faces in `faces`). */
function faceGroups(m: EditMesh, faces: readonly number[], joins: readonly number[]): number[][] {
  const inSet = new Set(faces);
  const parent = new Map<number, number>(faces.map((f) => [f, f]));
  const find = (f: number): number => {
    let r = f;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const e of joins) {
    const fs = edgeFaces(m, e).filter((f) => inSet.has(f));
    for (let i = 1; i < fs.length; i++) {
      const a = find(fs[0] as number);
      const b = find(fs[i] as number);
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
    }
  }
  const groups = new Map<number, number[]>();
  for (const f of faces) {
    const r = find(f);
    const list = groups.get(r) ?? [];
    list.push(f);
    groups.set(r, list);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a - b)).sort((a, b) => (a[0] as number) - (b[0] as number));
}

/**
 * Makes each group's polygon, then removes `killFaces` (the groups' faces and others), the edges left without faces
 * (never pre-op wire edges outside `killEdges`), `killEdges`, and the vertices left without edges. Returns the old →
 * new vertex map.
 */
function applyDeletion(
  m: EditMesh,
  groups: readonly MergeGroup[],
  killFaces: ReadonlySet<number>,
  killEdges: ReadonlySet<number>,
  killVerts: ReadonlySet<number>,
): Int32Array {
  const P = m.counts.points;
  const edgeCandidates = new Set<number>(killEdges);
  const vertCandidates = new Set<number>(killVerts);
  const wire = new Set<number>();
  for (const f of killFaces) for (const c of faceCorners(m, f)) edgeCandidates.add(m.cornerEdge(c));
  for (const e of edgeCandidates) if (m.edgeFaceCount(e) === 0) wire.add(e);
  for (const group of groups) {
    const example = group.faces[0] as number;
    const g = m.makeFace(group.verts, { example });
    const corners = faceCorners(m, g);
    corners.forEach((corner, i) => {
      const src = group.corners[i] as number;
      if (src !== -1) copyCornerRaw(m, src, corner);
    });
    if (m.faceFlags(g) !== 0) m.setFaceFlags(g, 0);
  }
  for (const f of [...killFaces].sort((a, b) => b - a)) m.killFace(f);
  const deadEdges = [...edgeCandidates]
    .filter((e) => killEdges.has(e) || (m.edgeFaceCount(e) === 0 && !wire.has(e)))
    .sort((a, b) => b - a);
  for (const e of deadEdges) {
    vertCandidates.add(m.edgeVert(e, 0));
    vertCandidates.add(m.edgeVert(e, 1));
  }
  for (const e of deadEdges) m.killEdge(e);
  const deadVerts = [...vertCandidates].filter((v) => killVerts.has(v) || m.vertValence(v) === 0).sort((a, b) => b - a);
  for (const v of deadVerts) m.killVert(v);
  return removalMap(P, deadVerts);
}

function pollDelete(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || selected(m, sel, sel.kind, ctx.hidden).length === 0) {
    return refuse('delete.no-selection', 'Select components to delete');
  }
  return true;
}

function emptyResult(m: EditMesh, kind: ComponentKind, args: ParamValues, unmatched: number): OpResult {
  return opResult(selectionResult(m, kind, []), unmatchedWarnings(unmatched), args);
}

/** Edge-mode deletion shared by both ops; returns the vertex map or a refusal. */
function deleteEdges(m: EditMesh, edges: readonly number[], dissolveAfter: boolean): Int32Array | Refusal {
  const border: number[] = [];
  const interior: number[] = [];
  const wire: number[] = [];
  for (const e of edges) {
    const n = m.edgeFaceCount(e);
    if (n === 0) wire.push(e);
    else if (n === 1) border.push(e);
    else if (n === 2) interior.push(e);
    else return refuse('delete.non-manifold', 'Delete cannot remove an edge with more than two faces');
  }
  if (dissolveAfter && border.length > 0) {
    return refuse(
      'delete.border-edge',
      'Delete Edge/Vertex needs edges with two faces; a border edge goes with its face (Delete)',
    );
  }
  const outright = new Set<number>(border.flatMap((e) => edgeFaces(m, e)));
  const joinFaces = uniqueSorted(interior.flatMap((e) => edgeFaces(m, e)));
  const grouped = faceGroups(m, joinFaces, interior);
  // A group touching a face deleted outright goes with it.
  const groups: MergeGroup[] = [];
  const killFaces = new Set<number>(outright);
  for (const faces of grouped) {
    if (faces.some((f) => outright.has(f))) {
      for (const f of faces) killFaces.add(f);
      continue;
    }
    if (faces.length < 2) continue;
    const inGroup = new Set(faces);
    const internal = (e: number): boolean => edgeFaces(m, e).every((f) => inGroup.has(f));
    const cycle = unionCycle(m, faces, internal, new Set());
    if (cycle === null) return refuse('delete.hole', 'Deleting these edges would leave a face with a hole');
    groups.push({ faces, verts: cycle.verts, corners: cycle.corners });
    for (const f of faces) killFaces.add(f);
  }
  // Vertices Delete Edge/Vertex dissolves afterwards: endpoints left with valence 2 by this deletion.
  const endpoints = uniqueSorted(edges.flatMap((e) => [m.edgeVert(e, 0), m.edgeVert(e, 1)]));
  const valenceBefore = new Map<number, number>(endpoints.map((v) => [v, m.vertValence(v)]));
  const map = applyDeletion(m, groups, killFaces, new Set([...interior, ...wire]), new Set());
  if (dissolveAfter) {
    const dissolve = endpoints
      .filter((v) => (valenceBefore.get(v) ?? 0) > 2)
      .map((v) => map[v] as number)
      .filter((v) => v !== -1 && m.vertValence(v) === 2)
      .sort((a, b) => b - a);
    const P = m.counts.points;
    const dissolved: number[] = [];
    for (const v of dissolve) {
      try {
        m.joinEdgeKillVert(v);
        dissolved.push(v);
      } catch {
        // A dissolve that would collapse a face keeps the vertex (Maya keeps it too).
      }
    }
    const second = removalMap(P, dissolved);
    return Int32Array.from(map, (v) => (v === -1 ? -1 : (second[v] as number)));
  }
  return map;
}

function runDelete(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollDelete(m, sel, ctx);
  if (verdict !== true) return verdict;
  const selection = sel as ComponentSelection;
  const args = resolveArgs(DELETE, rawArgs);
  const mirror = mirrorOf(ctx);
  const kind = selection.kind;
  const expanded = expandIndices(mirror, kind, selected(m, selection, kind, ctx.hidden));
  if (kind === 'face') {
    applyDeletion(m, [], new Set(expanded.indices), new Set(), new Set());
    return emptyResult(m, 'face', args, expanded.unmatched);
  }
  if (kind === 'edge') {
    const done = deleteEdges(m, expanded.indices, false);
    if (!(done instanceof Int32Array)) return done;
    return emptyResult(m, 'edge', args, expanded.unmatched);
  }
  // Vertex mode: winged vertices only.
  for (const v of expanded.indices) {
    if (m.vertValence(v) > 2) return refuse('delete.not-winged', 'Use Delete Edge/Vertex (Mod+Delete)');
  }
  for (const v of [...expanded.indices].sort((a, b) => b - a)) {
    if (m.vertValence(v) === 2) {
      try {
        m.joinEdgeKillVert(v);
      } catch {
        return refuse('delete.degenerate', 'Deleting this vertex would collapse a face');
      }
    } else m.killVert(v);
  }
  return emptyResult(m, 'vertex', args, expanded.unmatched);
}

function pollDeleteEdgeVertex(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || sel.kind === 'face' || selected(m, sel, sel.kind, ctx.hidden).length === 0) {
    return refuse('delete.no-selection', 'Select edges or vertices to delete');
  }
  return true;
}

function runDeleteEdgeVertex(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollDeleteEdgeVertex(m, sel, ctx);
  if (verdict !== true) return verdict;
  const selection = sel as ComponentSelection;
  const args = resolveArgs(DELETE_EDGE_VERTEX, rawArgs);
  const mirror = mirrorOf(ctx);
  const kind = selection.kind;
  const expanded = expandIndices(mirror, kind, selected(m, selection, kind, ctx.hidden));
  if (kind === 'edge') {
    const done = deleteEdges(m, expanded.indices, true);
    if (!(done instanceof Int32Array)) return done;
    return emptyResult(m, 'edge', args, expanded.unmatched);
  }
  // Vertex mode: each vertex goes with its edges; its faces merge into one n-gon.
  const removed = new Set(expanded.indices);
  const faces = uniqueSorted(expanded.indices.flatMap((v) => vertFaces(m, v)));
  const spokes = uniqueSorted(expanded.indices.flatMap((v) => vertEdges(m, v)));
  const grouped = faceGroups(m, faces, spokes);
  const groups: MergeGroup[] = [];
  const killFaces = new Set<number>(faces);
  for (const group of grouped) {
    const inGroup = new Set(group);
    const internal = (e: number): boolean =>
      removed.has(m.edgeVert(e, 0)) || removed.has(m.edgeVert(e, 1)) || edgeFaces(m, e).every((f) => inGroup.has(f));
    const cycle = unionCycle(m, group, internal, removed);
    if (cycle === null) {
      // Nothing left of the group (all its vertices removed) just goes; anything else would need a hole.
      const keeps = group.some((f) => faceCorners(m, f).some((c) => !removed.has(m.cornerVert(c))));
      const boundary = group.some((f) => faceCorners(m, f).some((c) => !internal(m.cornerEdge(c))));
      if (keeps && boundary) return refuse('delete.hole', 'Deleting these vertices would leave a face with a hole');
      continue;
    }
    groups.push({ faces: group, verts: cycle.verts, corners: cycle.corners });
  }
  applyDeletion(m, groups, killFaces, new Set(spokes), removed);
  return emptyResult(m, 'vertex', args, expanded.unmatched);
}

export const meshDelete: MeshOp = Object.freeze({ ...DELETE, poll: pollDelete, run: runDelete });
export const deleteEdgeVertex: MeshOp = Object.freeze({
  ...DELETE_EDGE_VERTEX,
  poll: pollDeleteEdgeVertex,
  run: runDeleteEdgeVertex,
});
