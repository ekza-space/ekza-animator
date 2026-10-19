// Kernel op `mesh.cut {points}` — Multi-Cut (M6A-SPEC §5.11, research 10 §4.6, 13 §5.5; owner B4; the tool is B12b's).
// `points` is the pointer-bound path `{kind: 'edge', edge, t} | {kind: 'vertex', vertex}`[]:
// 1. Points within ε (ctx.epsilon) of an edge's end become that vertex; consecutive duplicates are dropped.
// 2. Each pair of consecutive points must share a face (`cut.no-common-face`, "Click on each face the cut crosses");
//    the chord is checked inside that face exactly: the face's polygon — with every cut point on its edges inserted at
//    the float32 position it will be stored at — is projected on its Newell plane, and the chord must cross no polygon
//    edge (`orient2d`, `segmentsCross2d`), pass through no other polygon vertex, and have its midpoint strictly inside
//    (exact winding number); chords in one face must not cross each other. Otherwise `cut.outside-face` ("That cut
//    would leave the face"). Two points on one edge (or an edge and its end) run along the boundary: nothing to cut.
// 3. Edges are split at the points (ascending t per edge; the new vertex gets the exact lerp of the original ends and
//    is inserted into both adjacent faces, which become n+1-gons; no fix), then each chord splits its face (or the piece
//    of it an earlier chord made) with `splitFaceMakeEdge`. Chord edges follow H1. `selection′` = the chord edges.
// 4. Symmetry (pointer class: mapped here, §5.14): every point is mapped by the pointer rule (crossing edges t ↦ 1 − t
//    with snapping at t*, in-seam edges t ↦ t); a path that stays on one side gets its mirrored path as a second cut in
//    the same run; a path that reaches the plane (a point on it) or crosses it (a chord between the two sides) is
//    clipped there and its kept half is mirrored back to the start: one symmetric cut. Points without a partner are not
//    mirrored (`symmetry.unmatched-partner`).
// No removals happen, so every index is stable during the run.
import type { JsonValue, ParamValues } from '@ekza-animator/anim-core';
import { kernelError } from '../../kernel';
import { orient2d, segmentsCross2d } from '../../predicates';
import { refuse } from '../../refusal';
import {
  argsOf,
  edgeCorners,
  faceCorners,
  guarded,
  newellNormal,
  resultSelection,
  vertFaces,
} from '../../subset/support';
import { mirrorEdgePointOf, partnerOf, unmatchedWarning, vertexSide } from '../../subset/symmetry';
import type {
  ComponentSelection,
  EditMesh,
  MeshOp,
  OpContext,
  OpResult,
  OpWarning,
  Refusal,
  SymmetryMap,
} from '../../types';
import { CUT } from './descriptor';

/** A path point: on an edge at t (0 < t < 1 after normalization) or at a vertex. */
interface Pt {
  readonly kind: 'edge' | 'vertex';
  readonly edge: number;
  readonly t: number;
  readonly vertex: number;
}

const vertexPt = (vertex: number): Pt => ({ kind: 'vertex', edge: -1, t: 0, vertex });
const keyOf = (p: Pt): string => (p.kind === 'vertex' ? `v${p.vertex}` : `e${p.edge}:${p.t}`);

function edgeLength(m: EditMesh, e: number): number {
  const p = m.position;
  const a = 3 * m.edgeVert(e, 0);
  const b = 3 * m.edgeVert(e, 1);
  return Math.hypot(
    (p[b] as number) - (p[a] as number),
    (p[b + 1] as number) - (p[a + 1] as number),
    (p[b + 2] as number) - (p[a + 2] as number),
  );
}

/** Points as given, validated and normalized (ends within ε become vertices); null when malformed. */
function parsePoints(value: JsonValue | undefined, m: EditMesh, epsilon: number): Pt[] | null {
  if (!Array.isArray(value)) return null;
  const out: Pt[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const point = raw as {
      readonly kind?: unknown;
      readonly edge?: unknown;
      readonly t?: unknown;
      readonly vertex?: unknown;
    };
    if (point.kind === 'vertex') {
      const v = point.vertex;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= m.counts.points) return null;
      out.push(vertexPt(v));
    } else if (point.kind === 'edge') {
      const e = point.edge;
      const t = point.t;
      if (typeof e !== 'number' || !Number.isInteger(e) || e < 0 || e >= m.counts.edges) return null;
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 1) return null;
      out.push(normalize(m, { kind: 'edge', edge: e, t, vertex: -1 }, epsilon));
    } else return null;
  }
  return out;
}

function normalize(m: EditMesh, p: Pt, epsilon: number): Pt {
  if (p.kind === 'vertex') return p;
  const length = edgeLength(m, p.edge);
  if (p.t * length <= epsilon) return vertexPt(m.edgeVert(p.edge, 0));
  if ((1 - p.t) * length <= epsilon) return vertexPt(m.edgeVert(p.edge, 1));
  return p;
}

function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) if (out.length === 0 || keyOf(out[out.length - 1] as Pt) !== keyOf(p)) out.push(p);
  return out;
}

// ---------- symmetry ----------

/** −1 / 0 / +1: the side of the plane a point is on (0 = on it, within tolerance; seam vertices and in-seam edges). */
function sideOfPoint(m: EditMesh, map: SymmetryMap, p: Pt): number {
  if (p.kind === 'vertex') {
    if (partnerOf(map, 'vertex', p.vertex) === p.vertex) return 0;
    const d = vertexSide(m, map, p.vertex);
    return Math.abs(d) <= map.tolerance ? 0 : Math.sign(d);
  }
  if ((map.edgeSelf[p.edge] ?? 0) === 2) return 0;
  const d0 = vertexSide(m, map, m.edgeVert(p.edge, 0));
  const d1 = vertexSide(m, map, m.edgeVert(p.edge, 1));
  const d = d0 + (d1 - d0) * p.t;
  return Math.abs(d) <= map.tolerance ? 0 : Math.sign(d);
}

/** A point snapped onto the plane when the pointer rule says so (a crossing edge near t*). */
function snap(m: EditMesh, map: SymmetryMap, p: Pt, epsilon: number): Pt {
  if (p.kind !== 'edge' || (map.edgeSelf[p.edge] ?? 0) !== 1) return p;
  const mapped = mirrorEdgePointOf(m, map, p);
  return mapped !== null && mapped.self ? normalize(m, { ...p, t: mapped.t }, epsilon) : p;
}

function mirrored(m: EditMesh, map: SymmetryMap, p: Pt, epsilon: number): Pt | null {
  if (p.kind === 'vertex') {
    const q = partnerOf(map, 'vertex', p.vertex);
    return q < 0 ? null : vertexPt(q);
  }
  const q = mirrorEdgePointOf(m, map, p);
  return q === null ? null : normalize(m, { kind: 'edge', edge: q.edge, t: q.t, vertex: -1 }, epsilon);
}

/** The paths one symmetric run cuts (§5.14 Multi-Cut row) and how many points had no partner. */
function symmetricPaths(
  m: EditMesh,
  map: SymmetryMap,
  path: readonly Pt[],
  epsilon: number,
): { readonly paths: Pt[][]; readonly unmatched: number } {
  const points = path.map((p) => snap(m, map, p, epsilon));
  const sides = points.map((p) => sideOfPoint(m, map, p));
  let lastSide = 0;
  let clipEnd = -1; // the half is points[0..clipEnd]
  let turn: 'touch' | 'cross' | null = null;
  for (let i = 0; i < points.length; i++) {
    const s = sides[i] as number;
    if (s === 0) {
      if (lastSide !== 0) {
        clipEnd = i;
        turn = 'touch';
        break;
      }
      continue;
    }
    if (lastSide !== 0 && s !== lastSide) {
      clipEnd = i - 1;
      turn = 'cross';
      break;
    }
    lastSide = s;
  }
  const mirrorAll = (list: readonly Pt[]): { readonly out: Pt[]; readonly missing: number } => {
    const out: Pt[] = [];
    let missing = 0;
    for (const p of list) {
      const q = mirrored(m, map, p, epsilon);
      if (q === null) missing++;
      else out.push(q);
    }
    return { out, missing };
  };
  if (turn === null) {
    if (sides.every((s) => s === 0)) return { paths: [points], unmatched: 0 };
    const { out, missing } = mirrorAll(points);
    return missing > 0 ? { paths: [points], unmatched: missing } : { paths: [points, out], unmatched: 0 };
  }
  const half = points.slice(0, clipEnd + 1);
  const back = turn === 'touch' ? half.slice(0, half.length - 1) : half;
  const { out, missing } = mirrorAll(back);
  if (missing > 0) return { paths: [half], unmatched: missing };
  return { paths: [[...half, ...out.reverse()]], unmatched: 0 };
}

// ---------- geometry ----------

interface Polygon {
  readonly keys: string[];
  readonly xs: number[];
  readonly ys: number[];
}

const N = new Float64Array(3);

/** Projects onto face f's Newell plane (dropping the largest component, winding kept counterclockwise). */
function projector(m: EditMesh, f: number): (x: number, y: number, z: number) => [number, number] {
  newellNormal(m, f, N);
  const ax = Math.abs(N[0] as number);
  const ay = Math.abs(N[1] as number);
  const az = Math.abs(N[2] as number);
  if (ax >= ay && ax >= az) {
    const s = (N[0] as number) < 0 ? -1 : 1;
    return (_x, y, z) => [y, s * z];
  }
  if (ay >= az) {
    const s = (N[1] as number) < 0 ? -1 : 1;
    return (x, _y, z) => [z, s * x];
  }
  const s = (N[2] as number) < 0 ? -1 : 1;
  return (x, y) => [x, s * y];
}

/** The stored (float32) position of a point. */
function pointPosition(m: EditMesh, p: Pt): [number, number, number] {
  const pos = m.position;
  if (p.kind === 'vertex') {
    return [pos[3 * p.vertex] as number, pos[3 * p.vertex + 1] as number, pos[3 * p.vertex + 2] as number];
  }
  const a = 3 * m.edgeVert(p.edge, 0);
  const b = 3 * m.edgeVert(p.edge, 1);
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const x = pos[a + k] as number;
    out[k] = Math.fround(x + ((pos[b + k] as number) - x) * p.t);
  }
  return out;
}

/** Face f's boundary with the given edge points inserted in order (the face as it will be after the edge splits). */
function virtualPolygon(m: EditMesh, f: number, onEdges: ReadonlyMap<number, readonly Pt[]>): Polygon {
  const project = projector(m, f);
  const keys: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const push = (p: Pt): void => {
    const [x, y, z] = pointPosition(m, p);
    const [u, w] = project(x, y, z);
    keys.push(keyOf(p));
    xs.push(u);
    ys.push(w);
  };
  for (const c of faceCorners(m, f)) {
    const v = m.cornerVert(c);
    push(vertexPt(v));
    const e = m.cornerEdge(c);
    const list = onEdges.get(e);
    if (list === undefined) continue;
    const forward = m.edgeVert(e, 0) === v;
    const ordered = forward ? list : [...list].reverse();
    for (const p of ordered) push(p);
  }
  return { keys, xs, ys };
}

function strictlyBetween(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  return (px - ax) * dx + (py - ay) * dy > 0 && (px - bx) * -dx + (py - by) * -dy > 0;
}

function onSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean {
  if (orient2d(ax, ay, bx, by, px, py) !== 0) return false;
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by);
}

/** Whether the chord between polygon vertices i and j lies inside the polygon (exact predicates). */
function chordInside(poly: Polygon, i: number, j: number): boolean {
  const { xs, ys } = poly;
  const n = xs.length;
  const ax = xs[i] as number;
  const ay = ys[i] as number;
  const bx = xs[j] as number;
  const by = ys[j] as number;
  if (ax === bx && ay === by) return false;
  for (let k = 0; k < n; k++) {
    const l = (k + 1) % n;
    if (segmentsCross2d(ax, ay, bx, by, xs[k] as number, ys[k] as number, xs[l] as number, ys[l] as number))
      return false;
  }
  for (let k = 0; k < n; k++) {
    if (k === i || k === j) continue;
    const px = xs[k] as number;
    const py = ys[k] as number;
    if (orient2d(ax, ay, bx, by, px, py) === 0 && strictlyBetween(ax, ay, bx, by, px, py)) return false;
  }
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  let winding = 0;
  for (let k = 0; k < n; k++) {
    const l = (k + 1) % n;
    const px = xs[k] as number;
    const py = ys[k] as number;
    const qx = xs[l] as number;
    const qy = ys[l] as number;
    if (onSegment(px, py, qx, qy, mx, my)) return false;
    if (py <= my) {
      if (qy > my && orient2d(px, py, qx, qy, mx, my) > 0) winding++;
    } else if (qy <= my && orient2d(px, py, qx, qy, mx, my) < 0) winding--;
  }
  return winding !== 0;
}

/** The faces a point lies on (ascending). */
function facesOf(m: EditMesh, p: Pt): number[] {
  if (p.kind === 'vertex') return vertFaces(m, p.vertex);
  return [...new Set(edgeCorners(m, p.edge).map((c) => m.cornerFace(c)))].sort((a, b) => a - b);
}

/** Two points on one edge (or an edge point and that edge's end): the segment runs along the boundary. */
function alongEdge(m: EditMesh, p: Pt, q: Pt): boolean {
  if (p.kind === 'edge' && q.kind === 'edge') return p.edge === q.edge;
  if (p.kind === 'edge' && q.kind === 'vertex')
    return m.edgeVert(p.edge, 0) === q.vertex || m.edgeVert(p.edge, 1) === q.vertex;
  if (p.kind === 'vertex' && q.kind === 'edge') return alongEdge(m, q, p);
  return m.findEdge(p.vertex, q.vertex) !== -1;
}

interface Chord {
  readonly face: number;
  readonly a: Pt;
  readonly b: Pt;
}

// ---------- the op ----------

const CUT_POLL = (m: EditMesh): true | Refusal =>
  m.counts.faces > 0 ? true : refuse('cut.no-faces', 'Multi-Cut needs a mesh with faces');

export const cut: MeshOp = Object.freeze({
  ...CUT,
  poll: (m: EditMesh) => CUT_POLL(m),
  run(m: EditMesh, _sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = CUT_POLL(m);
    if (verdict !== true) return verdict;
    const args = argsOf(CUT.params, raw);
    const epsilon = Math.max(ctx.epsilon, 1e-12);
    const parsed = parsePoints(args['points'], m, epsilon);
    if (parsed === null)
      return refuse('cut.invalid-points', 'Multi-Cut points must lie on edges or vertices of the mesh');
    const path = dedupe(parsed);
    if (path.length < 2) return refuse('cut.too-few-points', 'Place at least two points to cut');
    const warnings: OpWarning[] = [];
    const map = ctx.symmetry?.map ?? null;
    let paths: Pt[][] = [path];
    if (map !== null) {
      const sym = symmetricPaths(m, map, path, epsilon);
      paths = sym.paths.map(dedupe);
      if (sym.unmatched > 0) warnings.push(unmatchedWarning(sym.unmatched));
    }

    // Every edge point, by edge (ascending t); points within ε of each other on one edge become one point.
    const onEdges = new Map<number, Pt[]>();
    paths = paths.map((list) =>
      dedupe(
        list.map((p) => {
          if (p.kind !== 'edge') return p;
          const points = onEdges.get(p.edge) ?? [];
          const length = edgeLength(m, p.edge);
          const same = points.find((q) => Math.abs(q.t - p.t) * length <= epsilon);
          if (same !== undefined) return same;
          points.push(p);
          onEdges.set(p.edge, points);
          return p;
        }),
      ),
    );
    for (const points of onEdges.values()) points.sort((a, b) => a.t - b.t);

    // Chords and their faces (validated on the pre-op mesh).
    const chords: Chord[] = [];
    const chordKeys = new Set<string>();
    const polygons = new Map<number, Polygon>();
    const polygonOf = (f: number): Polygon => {
      let poly = polygons.get(f);
      if (poly === undefined) {
        poly = virtualPolygon(m, f, onEdges);
        polygons.set(f, poly);
      }
      return poly;
    };
    for (const list of paths) {
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i] as Pt;
        const b = list[i + 1] as Pt;
        if (alongEdge(m, a, b)) continue;
        const fa = facesOf(m, a);
        const fb = new Set(facesOf(m, b));
        const common = fa.filter((f) => fb.has(f));
        if (common.length === 0) {
          return refuse('cut.no-common-face', 'Click on each face the cut crosses (the points share no face)');
        }
        let chosen = -1;
        for (const f of common) {
          const poly = polygonOf(f);
          const ia = poly.keys.indexOf(keyOf(a));
          const ib = poly.keys.indexOf(keyOf(b));
          if (ia === -1 || ib === -1) continue;
          const n = poly.keys.length;
          if ((ia + 1) % n === ib || (ib + 1) % n === ia) continue;
          if (chordInside(poly, ia, ib)) {
            chosen = f;
            break;
          }
        }
        if (chosen === -1) return refuse('cut.outside-face', 'That cut would leave the face');
        const key = [chosen, ...[keyOf(a), keyOf(b)].sort()].join('|');
        if (chordKeys.has(key)) continue;
        chordKeys.add(key);
        chords.push({ face: chosen, a, b });
      }
    }
    // Chords in one face must not cross.
    for (let i = 0; i < chords.length; i++) {
      for (let j = i + 1; j < chords.length; j++) {
        const c1 = chords[i] as Chord;
        const c2 = chords[j] as Chord;
        if (c1.face !== c2.face) continue;
        const poly = polygonOf(c1.face);
        const at = (p: Pt): number => poly.keys.indexOf(keyOf(p));
        const [p1, p2, q1, q2] = [at(c1.a), at(c1.b), at(c2.a), at(c2.b)] as [number, number, number, number];
        if (
          segmentsCross2d(
            poly.xs[p1] as number,
            poly.ys[p1] as number,
            poly.xs[p2] as number,
            poly.ys[p2] as number,
            poly.xs[q1] as number,
            poly.ys[q1] as number,
            poly.xs[q2] as number,
            poly.ys[q2] as number,
          )
        ) {
          return refuse('cut.crossing', 'The cut crosses itself inside a face');
        }
      }
    }
    if (chords.length === 0) return refuse('cut.nothing', 'The points run along existing edges: nothing to cut');

    return guarded('cut.failed', 'That cut would leave the face', () => {
      // Split the edges (ascending t per edge; the remaining piece is the edge just created).
      const vertexOf = new Map<string, number>();
      const pos = m.position;
      for (const [e, points] of onEdges) {
        const a = m.edgeVert(e, 0);
        const b = m.edgeVert(e, 1);
        const pa = [pos[3 * a] as number, pos[3 * a + 1] as number, pos[3 * a + 2] as number];
        const pb = [pos[3 * b] as number, pos[3 * b + 1] as number, pos[3 * b + 2] as number];
        let current = e;
        let before = 0;
        for (const p of points) {
          const v = m.splitEdgeMakeVert(current, (p.t - before) / (1 - before));
          m.setPosition(
            v,
            (pa[0] as number) + ((pb[0] as number) - (pa[0] as number)) * p.t + 0,
            (pa[1] as number) + ((pb[1] as number) - (pa[1] as number)) * p.t + 0,
            (pa[2] as number) + ((pb[2] as number) - (pa[2] as number)) * p.t + 0,
          );
          vertexOf.set(keyOf(p), v);
          current = m.counts.edges - 1;
          before = p.t;
        }
      }
      const vertexAt = (p: Pt): number => (p.kind === 'vertex' ? p.vertex : (vertexOf.get(keyOf(p)) as number));
      // Split the faces; pieces of each original face are tracked (no removals: indices are stable).
      const pieces = new Map<number, number[]>();
      const created: number[] = [];
      for (const chord of chords) {
        const va = vertexAt(chord.a);
        const vb = vertexAt(chord.b);
        const list = pieces.get(chord.face) ?? [chord.face];
        let done = false;
        for (const f of list) {
          let ca = -1;
          let cb = -1;
          for (const c of faceCorners(m, f)) {
            if (m.cornerVert(c) === va && ca === -1) ca = c;
            if (m.cornerVert(c) === vb && cb === -1) cb = c;
          }
          if (ca === -1 || cb === -1 || m.cornerNext(ca) === cb || m.cornerNext(cb) === ca) continue;
          if (m.findEdge(va, vb) !== -1) throw kernelError('mesh-euler', 'cut: the chord duplicates an existing edge');
          created.push(m.splitFaceMakeEdge(f, ca, cb));
          list.push(m.counts.faces - 1);
          pieces.set(chord.face, list);
          done = true;
          break;
        }
        if (!done) throw kernelError('mesh-euler', 'cut: no piece of the face holds the chord');
      }
      return { selection: resultSelection(m, 'edge', created), warnings, resolvedArgs: args };
    });
  },
});
