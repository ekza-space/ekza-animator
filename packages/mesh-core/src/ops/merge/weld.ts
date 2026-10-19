// The weld engine of the merge family (M6A-SPEC §5.12 merge family, §5.1 orphan cleanup, §5.2 merging row, §5.3 H3):
// every vertex maps to a representative; faces through merged vertices are re-made over the mapped cycle (repeated
// consecutive corners dropped, spikes x → y → x removed, faces left with fewer than three distinct vertices killed),
// each surviving corner keeping its own values (seams survive, `normal.custom` cleared); merged edges carry the OR of
// the flags that map onto them (H3); exactly coincident duplicate faces are merged (the larger index dies); edges and
// vertices left unused are removed; edges with more than two faces after the merge are reported
// (`merge.non-manifold`). Representatives take their cluster's position and point layers ('average' for merge and
// collapse, 'target' for weld).
//
// Index bookkeeping: faces and edges are re-found by vertex cycles; the merge creates no vertex, so the final index of
// every surviving vertex follows from the kernel's removal rule (`removalMap`, run as the first writer of the
// transaction, M6A-B3-5).
import { copyCornerAttributes, copyEdgeAttributes, mergePointAttributes } from '../../layers/propagate';
import { mergeEdgeFlags } from '../../normals/hard';
import type { EditMesh, OpWarning } from '../../types';
import {
  type V3,
  edgeFaces,
  faceCorners,
  faceVerts,
  removalMap,
  setPos,
  uniqueSorted,
  vertEdges,
  vertFaces,
} from '../extrude/shared/util';

export interface WeldPlan {
  /** Vertex → representative (itself when the vertex stays). */
  readonly target: Int32Array;
  /** Representative → its new position. */
  readonly positions: ReadonlyMap<number, V3>;
  /** Representative → the vertices merged into it (itself included) for the point layers. */
  readonly sources: ReadonlyMap<number, readonly number[]>;
  /** Point layers of each representative: averaged (merge, collapse, midpoints) or the target's (weld). */
  readonly attributes: ReadonlyMap<number, 'average' | 'target'>;
}

export interface WeldResult {
  /** Old vertex index → new index (−1 removed). */
  readonly vertexMap: Int32Array;
  readonly warnings: readonly OpWarning[];
  /** Vertices removed by the merge (merged away or left unused). */
  readonly removed: number;
}

/** Collapses a mapped corner cycle: consecutive repeats, then spikes; returns the kept entries. */
function cleanCycle(
  entries: { v: number; corner: number; own: boolean }[],
): { v: number; corner: number; own: boolean }[] {
  let list = entries;
  let changed = true;
  while (changed && list.length > 0) {
    changed = false;
    // Consecutive repeats (cyclic): keep the entry at the representative's own corner, else the first.
    const out: typeof list = [];
    for (const entry of list) {
      const last = out[out.length - 1];
      if (last !== undefined && last.v === entry.v) {
        if (!last.own && entry.own) out[out.length - 1] = entry;
        changed = true;
        continue;
      }
      out.push(entry);
    }
    while (out.length > 1 && (out[0] as (typeof out)[number]).v === (out[out.length - 1] as (typeof out)[number]).v) {
      const tail = out.pop() as (typeof out)[number];
      if (!(out[0] as (typeof out)[number]).own && tail.own) out[0] = tail;
      changed = true;
    }
    list = out;
    // Spikes x → y → x: drop y and the second x.
    if (list.length >= 3) {
      for (let i = 0; i < list.length; i++) {
        const prev = list[(i + list.length - 1) % list.length] as (typeof list)[number];
        const next = list[(i + 1) % list.length] as (typeof list)[number];
        if (prev.v === next.v) {
          const drop = new Set([i, (i + 1) % list.length]);
          list = list.filter((_, j) => !drop.has(j));
          changed = true;
          break;
        }
      }
    }
  }
  return list;
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

export function weld(m: EditMesh, plan: WeldPlan): WeldResult {
  const P = m.counts.points;
  const E0 = m.counts.edges;
  const target = plan.target;
  const merged: number[] = [];
  for (let v = 0; v < P; v++) if ((target[v] as number) !== v) merged.push(v);
  // Positions and point layers of the representatives first (indices are still the pre-op ones).
  for (const [rep, p] of plan.positions) {
    const sources = plan.sources.get(rep) ?? [rep];
    if (sources.length > 1) mergePointAttributes(m, sources, rep, plan.attributes.get(rep) ?? 'average', rep);
    setPos(m, rep, p);
  }
  const mapped = (v: number): number => target[v] as number;
  // Flags and layer sources of the edges merged edges map onto (H3).
  const edgeOr = new Map<string, { flags: number; source: number }>();
  const touchedEdges = new Set<number>();
  for (const v of merged) for (const e of vertEdges(m, v)) touchedEdges.add(e);
  for (const e of [...touchedEdges].sort((a, b) => a - b)) {
    const a = mapped(m.edgeVert(e, 0));
    const b = mapped(m.edgeVert(e, 1));
    if (a === b) continue;
    const key = pairKey(a, b);
    const entry = edgeOr.get(key);
    if (entry === undefined) edgeOr.set(key, { flags: m.edgeFlags(e), source: e });
    else entry.flags = mergeEdgeFlags(entry.flags, m.edgeFlags(e));
  }
  for (const [key, entry] of edgeOr) {
    const [a, b] = key.split(':').map(Number) as [number, number];
    const existing = m.findEdge(a, b);
    if (existing !== -1 && !touchedEdges.has(existing))
      entry.flags = mergeEdgeFlags(entry.flags, m.edgeFlags(existing));
  }
  // Re-make every face through a merged vertex.
  const affected = uniqueSorted(merged.flatMap((v) => vertFaces(m, v)));
  const preWire = new Set<number>();
  for (const e of touchedEdges) if (m.edgeFaceCount(e) === 0) preWire.add(e);
  const killFaces = new Set<number>();
  const edgeCandidates = new Set<number>(touchedEdges);
  const newCycles: number[][] = [];
  for (const f of affected) {
    const entries = faceCorners(m, f).map((corner) => {
      const v = m.cornerVert(corner);
      return { v: mapped(v), corner, own: mapped(v) === v };
    });
    const cycle = cleanCycle(entries);
    killFaces.add(f);
    for (const c of faceCorners(m, f)) edgeCandidates.add(m.cornerEdge(c));
    if (cycle.length < 3 || new Set(cycle.map((entry) => entry.v)).size < 3) continue;
    const verts = cycle.map((entry) => entry.v);
    const g = m.makeFace(verts, { example: f });
    const corners = faceCorners(m, g);
    corners.forEach((corner, i) => copyCornerAttributes(m, (cycle[i] as (typeof cycle)[number]).corner, corner));
    const flags = verts.length === faceVerts(m, f).length ? m.faceFlags(f) : 0;
    if (m.faceFlags(g) !== flags) m.setFaceFlags(g, flags);
    newCycles.push(verts);
  }
  // Wire edges through merged vertices follow their endpoints.
  for (const e of preWire) {
    const a = mapped(m.edgeVert(e, 0));
    const b = mapped(m.edgeVert(e, 1));
    if (a !== b) m.makeEdge(a, b);
  }
  // Merged edges: OR of the flags mapping onto them; new edges take their first source's layers.
  for (const [key, entry] of edgeOr) {
    const [a, b] = key.split(':').map(Number) as [number, number];
    const e = m.findEdge(a, b);
    if (e === -1 || touchedEdges.has(e)) continue;
    if (m.edgeFlags(e) !== entry.flags) m.setEdgeFlags(e, entry.flags);
    if (e >= E0) copyEdgeAttributes(m, entry.source, e);
  }
  // Lamina: a re-made face over the same vertex set as another face dies (the larger index).
  const keyOfFace = (f: number): string =>
    faceVerts(m, f)
      .sort((x, y) => x - y)
      .join(',');
  for (const verts of newCycles) {
    const anchor = verts[0] as number;
    const faces = vertFaces(m, anchor).filter((f) => !killFaces.has(f));
    const groups = new Map<string, number[]>();
    for (const f of faces) {
      const key = keyOfFace(f);
      const list = groups.get(key) ?? [];
      list.push(f);
      groups.set(key, list);
    }
    for (const list of groups.values()) for (const f of list.slice(1)) killFaces.add(f);
  }
  // Removals: faces, then edges and vertices left unused (descending; pre-op wire edges and isolated vertices stay).
  for (const f of [...killFaces].sort((a, b) => b - a)) {
    for (const c of faceCorners(m, f)) edgeCandidates.add(m.cornerEdge(c));
    m.killFace(f);
  }
  const vertCandidates = new Set<number>(merged);
  const deadEdges = [...edgeCandidates]
    .filter((e) => e < m.counts.edges && m.edgeFaceCount(e) === 0 && !preWire.has(e))
    .sort((a, b) => b - a);
  for (const e of deadEdges) {
    vertCandidates.add(m.edgeVert(e, 0));
    vertCandidates.add(m.edgeVert(e, 1));
  }
  for (const e of preWire) {
    // A wire edge through a merged vertex was replaced by its mapped copy.
    if (merged.includes(m.edgeVert(e, 0)) || merged.includes(m.edgeVert(e, 1))) deadEdges.push(e);
  }
  for (const e of uniqueSorted(deadEdges).reverse()) m.killEdge(e);
  const deadVerts = [...vertCandidates].filter((v) => m.vertValence(v) === 0).sort((a, b) => b - a);
  for (const v of deadVerts) m.killVert(v);
  const vertexMap = removalMap(P, deadVerts);
  // Non-manifold edges around the representatives.
  let nonManifold = 0;
  const reps = uniqueSorted(plan.positions.keys());
  const seen = new Set<number>();
  for (const rep of reps) {
    const v = vertexMap[rep] as number;
    if (v === -1) continue;
    for (const e of vertEdges(m, v)) {
      if (seen.has(e)) continue;
      seen.add(e);
      if (edgeFaces(m, e).length > 2) nonManifold++;
    }
  }
  const warnings: OpWarning[] =
    nonManifold > 0
      ? [
          {
            code: 'merge.non-manifold',
            message: `The merge left ${nonManifold} non-manifold edge${nonManifold === 1 ? '' : 's'}`,
            count: nonManifold,
          },
        ]
      : [];
  return { vertexMap, warnings, removed: deadVerts.length };
}
