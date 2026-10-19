// Kernel ops of `ops/offsetLoop/` (M6A-SPEC §6.1, §5.11; B3): `mesh.offsetLoop` — for each selected edge loop, two
// new loops on the adjacent rings at `offset` × the crossing edge's length from the loop. In every face beside a
// selected edge the chord joins the points on the face's two crossing edges (its edges at the selected edge's ends);
// an open loop ending at an interior vertex is closed round that vertex through the far faces (a point on each spoke),
// which leaves end triangles, and `deleteEnds` (default on) removes the end edges between the vertex and the spoke
// points so the end triangles become quads (Maya `polyDuplicateEdge -deleteEdge`). A face side where the loop turns
// inside the face (its crossing edge is selected too) gets no chord, with the warning `offsetLoop.corner`
// (M6A-B3-10). Chords follow H1; `selection′` = the new edges. Symmetry: the expanded selection.
import type { ParamValues } from '@ekza-animator/anim-core';
import { allEdgesHard } from '../../normals/hard';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { cutChord, setChordHard, splitEdgeAt } from '../extrude/shared/split';
import { expandIndices, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import {
  bool,
  edgeCorners,
  edgeFaces,
  isHiddenFace,
  num,
  opResult,
  resolveArgs,
  selected,
  selectionResult,
  uniqueSorted,
  vertEdges,
  guarded,
} from '../extrude/shared/util';
import { OFFSET_LOOP } from './descriptor';

function pollOffsetLoop(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || sel.kind !== 'edge' || selected(m, sel, 'edge', ctx.hidden).length === 0) {
    return refuse('offsetLoop.no-selection', 'Select an edge loop to offset');
  }
  return true;
}

/** A point on edge `e` at fraction `f` from vertex `from`. */
interface Point {
  readonly e: number;
  readonly from: number;
}

const keyOf = (p: Point): string => `${p.e}:${p.from}`;

function runOffsetLoop(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const verdict = pollOffsetLoop(m, sel, ctx);
  if (verdict !== true) return verdict;
  const args = resolveArgs(OFFSET_LOOP, rawArgs);
  const offset = Math.min(0.49, Math.max(0.01, num(args, 'offset', 0.25)));
  const mirror = mirrorOf(ctx);
  const expanded = expandIndices(mirror, 'edge', selected(m, sel, 'edge', ctx.hidden));
  const chosen = new Set(expanded.indices);
  const points = new Map<string, Point>();
  const chords: { face: number; a: Point; b: Point }[] = [];
  const endEdges: { w: number; spoke: Point }[] = [];
  let corners = 0;
  const point = (e: number, from: number): Point => {
    const p = { e, from };
    points.set(keyOf(p), p);
    return p;
  };
  for (const e of expanded.indices) {
    for (const c of edgeCorners(m, e)) {
      const f = m.cornerFace(c);
      if (isHiddenFace(ctx.hidden, f)) continue;
      const x = m.cornerVert(c);
      const y = m.cornerVert(m.cornerNext(c));
      const ex = m.cornerEdge(m.cornerPrev(c));
      const ey = m.cornerEdge(m.cornerNext(c));
      if (chosen.has(ex) || chosen.has(ey) || ex === ey) {
        corners++;
        continue;
      }
      chords.push({ face: f, a: point(ex, x), b: point(ey, y) });
    }
  }
  // Open loop ends at interior vertices: close round the vertex through the far faces.
  const selectedAt = new Map<number, number[]>();
  for (const e of expanded.indices) {
    for (const end of [0, 1] as const) {
      const v = m.edgeVert(e, end);
      const list = selectedAt.get(v) ?? [];
      list.push(e);
      selectedAt.set(v, list);
    }
  }
  for (const [w, list] of [...selectedAt].sort((a, b) => a[0] - b[0])) {
    if (list.length !== 1) continue;
    const e = list[0] as number;
    const spokes = vertEdges(m, w);
    if (spokes.some((s) => m.edgeFaceCount(s) !== 2) || !m.isManifoldVert(w)) continue;
    const [fa, fb] = edgeFaces(m, e) as [number, number];
    // Crossing edges at w in the two faces beside e.
    const otherAt = (f: number, not: number): number => {
      for (const s of spokes) if (s !== not && edgeFaces(m, s).includes(f)) return s;
      return -1;
    };
    const ca = otherAt(fa, e);
    const cb = otherAt(fb, e);
    if (ca === -1 || cb === -1 || chosen.has(ca) || chosen.has(cb)) continue;
    // Walk from ca away from e to cb.
    const far: { face: number; from: number; to: number }[] = [];
    let edge = ca;
    let face = fa;
    let guard = 0;
    let ok = true;
    while (guard++ <= spokes.length + 1) {
      const next = edgeFaces(m, edge).find((g) => g !== face) ?? -1;
      if (next === -1 || isHiddenFace(ctx.hidden, next)) {
        ok = false;
        break;
      }
      const out = otherAt(next, edge);
      if (out === -1) {
        ok = false;
        break;
      }
      far.push({ face: next, from: edge, to: out });
      if (out === cb) break;
      edge = out;
      face = next;
    }
    if (!ok || far.length === 0 || (far[far.length - 1] as { to: number }).to !== cb) continue;
    for (const step of far) {
      const a = point(step.from, w);
      const b = point(step.to, w);
      chords.push({ face: step.face, a, b });
      if (step.to !== cb) endEdges.push({ w, spoke: b });
    }
  }
  if (chords.length === 0) return refuse('offsetLoop.no-ring', 'Offset Edge Loop needs faces beside the selected loop');
  // H1 verdicts and every point's parameter before any write.
  const hard = new Map(chords.map((chord) => [chord.face, allEdgesHard(m, chord.face)]));
  const perEdge = new Map<number, number[]>();
  for (const p of points.values()) {
    const u = p.from === m.edgeVert(p.e, 0) ? offset : 1 - offset;
    const list = perEdge.get(p.e) ?? [];
    list.push(u);
    perEdge.set(p.e, list);
  }
  const vertexOf = new Map<string, number>();
  for (const [e, list] of [...perEdge].sort((a, b) => a[0] - b[0])) {
    const made = splitEdgeAt(m, e, list);
    for (const p of points.values()) {
      if (p.e !== e) continue;
      const u = p.from === m.edgeVert(e, 0) ? offset : 1 - offset;
      vertexOf.set(keyOf(p), made.get(Math.min(1, Math.max(0, u))) as number);
    }
  }
  const made: [number, number, boolean][] = [];
  for (const chord of chords) {
    const a = vertexOf.get(keyOf(chord.a)) as number;
    const b = vertexOf.get(keyOf(chord.b)) as number;
    if (cutChord(m, a, b) !== -1) made.push([a, b, hard.get(chord.face) === true]);
  }
  if (bool(args, 'deleteEnds', true)) {
    for (const end of endEdges) {
      const v = vertexOf.get(keyOf(end.spoke)) as number;
      const e = m.findEdge(end.w, v);
      if (e === -1 || m.edgeFaceCount(e) !== 2) continue;
      try {
        m.joinFaceKillEdge(e);
      } catch {
        // Faces that share another edge keep the end edge.
      }
    }
  }
  const out: number[] = [];
  for (const [a, b, isHard] of made) {
    const e = m.findEdge(a, b);
    if (e === -1) continue;
    setChordHard(m, e, isHard);
    out.push(e);
  }
  const warnings: OpWarning[] = [...unmatchedWarnings(expanded.unmatched)];
  if (corners > 0) {
    warnings.push({
      code: 'offsetLoop.corner',
      message: `No offset inside ${corners} face${corners === 1 ? '' : 's'} where the loop turns`,
      count: corners,
    });
  }
  return opResult(selectionResult(m, 'edge', uniqueSorted(out)), warnings, args);
}

export const offsetLoop: MeshOp = Object.freeze({
  ...OFFSET_LOOP,
  poll: pollOffsetLoop,
  run: guarded(OFFSET_LOOP, runOffsetLoop),
});
