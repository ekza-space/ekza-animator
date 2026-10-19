// Kernel ops of `ops/loop/` (M6A-SPEC §6.1, §5.11; B3): `mesh.insertLoop` — Insert Edge Loop on the ring of the
// seed edge (the lowest-index selected edge when `seedEdge` is absent). Placement: `relative` = `weight` from
// `edgeVert(seed, 0)` on every ring edge (the side carried across the ring); `equal` = the distance
// `weight × length(seed)` from the same side, clamped to each edge; `multiple` = `divisions` loops at i/(divisions + 1).
// A non-quad face at a ring end gets the new vertex (triangle → quad). Cross edges follow H1; `selection′` = the new
// loop edges. Symmetry (§5.14, pointer class): the seed point is mapped by the pointer rule and the partner ring gets
// the mirrored loops; a loop whose mirror is itself (a waist ring; a crossing ring at the crossing weight, snapped onto
// the plane) is inserted once. A seed between non-quads (a triangle mesh made editable) is a ring of one edge: it is
// split and the new vertex joins its faces; only an edge without faces refuses `insertLoop.no-ring`. `adjust`
// re-places a single relative/equal loop for a new weight (positions and the interpolated layers, bit-identical to a
// fresh run); with symmetry or `multiple` it declines (the caller re-runs).
import type { ParamValue, ParamValues } from '@ekza-animator/anim-core';
import { EDGE_HARD } from '../../constants';
import { copyCornerAttributes, interpolateCornerAttributes, interpolatePointAttributes } from '../../layers/propagate';
import { allEdgesHard } from '../../normals/hard';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { type Mirror, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import {
  cornerAt,
  edgeCorners,
  length,
  lerp3,
  num,
  opResult,
  pos,
  resolveArgs,
  selected,
  selectionResult,
  setPos,
  str,
  sub,
  vertCorners,
  vertEdges,
  guarded,
} from '../extrude/shared/util';
import { INSERT_LOOP } from './descriptor';
import { type Ring, walkRing } from './ring';

/** One loop: a parameter (from edgeVert(e, 0)) on every edge of its ring. */
interface LoopPlan {
  readonly ring: Ring;
  readonly u: readonly number[];
}

/** The seed edge: the arg, else the lowest-index visible selected edge (−1: none). */
function seedOf(
  m: EditMesh,
  sel: ComponentSelection | null,
  args: Readonly<Record<string, ParamValue>>,
  ctx: OpContext,
): number {
  const arg = args['seedEdge'];
  if (typeof arg === 'number' && Number.isInteger(arg)) return arg >= 0 && arg < m.counts.edges ? arg : -1;
  if (sel === null) return -1;
  return selected(m, sel, 'edge', ctx.hidden)[0] ?? -1;
}

/** Always true: a tool run passes `seedEdge` with any selection (poll sees no args); `run` refuses without a seed. */
function pollInsertLoop(_m: EditMesh, _sel: ComponentSelection | null, _ctx: OpContext): true | Refusal {
  return true;
}

/** A ring's edge lengths and start vertices (`edgeVert(e, 0)`), read on the pre-op mesh (`adjust` runs after the splits). */
interface RingGeometry {
  readonly ring: Ring;
  readonly lengths: readonly number[];
  readonly starts: readonly number[];
}

function ringGeometry(m: EditMesh, ring: Ring): RingGeometry {
  return {
    ring,
    lengths: ring.edges.map((edge) => length(sub(pos(m, m.edgeVert(edge.e, 1)), pos(m, m.edgeVert(edge.e, 0))))),
    starts: ring.edges.map((edge) => m.edgeVert(edge.e, 0)),
  };
}

/** Side fractions of the loops of `mode` (equal: per edge, from the seed's length). */
function fractions(geometry: RingGeometry, args: Readonly<Record<string, ParamValue>>, seedLength: number): number[][] {
  const { ring } = geometry;
  const mode = str(args, 'mode', 'relative');
  const weight = num(args, 'weight', 0.5);
  if (mode === 'multiple') {
    const d = Math.max(1, Math.round(num(args, 'divisions', 2)));
    const list: number[][] = [];
    for (let i = 1; i <= d; i++) list.push(ring.edges.map(() => i / (d + 1)));
    return list;
  }
  if (mode === 'equal') {
    const distance = weight * seedLength;
    return [geometry.lengths.map((l) => (l > 0 ? Math.min(1, distance / l) : 0))];
  }
  return [ring.edges.map(() => weight)];
}

/** Side fractions → parameters from edgeVert(e, 0) (as it was before the op). */
function loopsOf(geometry: RingGeometry, sideFractions: readonly (readonly number[])[]): LoopPlan[] {
  const { ring } = geometry;
  return sideFractions.map((list) => ({
    ring,
    u: ring.edges.map((edge, i) => {
      const t = list[i] as number;
      return edge.side === geometry.starts[i] ? t : 1 - t;
    }),
  }));
}

/** Whether loop b coincides with loop a (every point of b within tolerance of a's point on the same edge). */
function sameLoop(m: EditMesh, a: LoopPlan, b: LoopPlan, tolerance: number): boolean {
  const at = new Map<number, number>();
  a.ring.edges.forEach((edge, i) => at.set(edge.e, a.u[i] as number));
  if (a.ring.edges.length !== b.ring.edges.length) return false;
  return b.ring.edges.every((edge, i) => {
    const u = at.get(edge.e);
    if (u === undefined) return false;
    const l = length(sub(pos(m, m.edgeVert(edge.e, 1)), pos(m, m.edgeVert(edge.e, 0))));
    return Math.abs(u - (b.u[i] as number)) * l <= tolerance;
  });
}

/** Snaps a self-mirrored loop's points on crossing edges onto the plane (§5.14). */
function snapped(m: EditMesh, loop: LoopPlan, mirror: Mirror): LoopPlan {
  return {
    ring: loop.ring,
    u: loop.ring.edges.map((edge, i) => {
      if ((mirror.map.edgeSelf[edge.e] as number) !== 1) return loop.u[i] as number;
      const star = mirror.crossing(pos(m, m.edgeVert(edge.e, 0)), pos(m, m.edgeVert(edge.e, 1)));
      return star ?? (loop.u[i] as number);
    }),
  };
}

/** A new loop vertex and what it was interpolated from (for `adjust`). */
interface Split {
  /** The ring edge it split (keeps its index: (a, v) after the split). */
  readonly e: number;
  readonly v: number;
  readonly a: number;
  readonly b: number;
  /** Per face side: the split corner at v, the side's corners at a and b, and the chord copies of the split corner. */
  readonly sides: { readonly corner: number; readonly ca: number; readonly cb: number; twins: number[] }[];
}

function runInsertLoop(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const args = resolveArgs(INSERT_LOOP, rawArgs);
  const seed = seedOf(m, sel, args, ctx);
  if (seed === -1) return refuse('insertLoop.no-ring', 'Select an edge of a ring of quads');
  args['seedEdge'] = seed;
  const side0 = m.edgeVert(seed, 0);
  const ring0 = walkRing(m, seed, side0, ctx.hidden);
  // A seed between non-quads (a triangle mesh made editable) has a ring of one edge: it is split and the new vertex
  // joins its faces (§5.11 termination, triangle → quad). Only an edge without faces has no ring at all.
  if (m.edgeFaceCount(seed) === 0) return refuse('insertLoop.no-ring', 'Insert Edge Loop needs an edge of a face');
  const seedLength = length(sub(pos(m, m.edgeVert(seed, 1)), pos(m, side0)));
  const geometry0 = ringGeometry(m, ring0);
  let loops = loopsOf(geometry0, fractions(geometry0, args, seedLength));
  const warnings: OpWarning[] = [];
  const mirror = mirrorOf(ctx);
  if (mirror !== null) {
    const e1 = mirror.partner('edge', seed);
    const s1 = mirror.partner('vertex', side0);
    if (e1 === -1 || s1 === -1) warnings.push(...unmatchedWarnings(1));
    else {
      const ring1 = walkRing(m, e1, s1, ctx.hidden);
      const geometry1 = ringGeometry(m, ring1);
      const mirrored = loopsOf(geometry1, fractions(geometry1, args, seedLength));
      // A loop is its own mirror when its mirrored loop (the same index) coincides with it: snapped onto the plane.
      const kept: LoopPlan[] = [];
      for (let i = 0; i < loops.length; i++) {
        const loop = loops[i] as LoopPlan;
        const own = mirrored[i];
        const self = own !== undefined && sameLoop(m, loop, own, mirror.map.tolerance);
        kept.push(self ? snapped(m, loop, mirror) : loop);
      }
      for (const other of mirrored)
        if (!loops.some((loop) => sameLoop(m, loop, other, mirror.map.tolerance))) kept.push(other);
      loops = kept;
    }
  }
  // Every crossing face's H1 verdict and every edge's sources, before any write.
  const allHard = new Map<number, boolean>();
  for (const loop of loops) for (const face of loop.ring.faces) allHard.set(face.f, allEdgesHard(m, face.f));
  const perEdge = new Map<number, { u: number; loop: number }[]>();
  loops.forEach((loop, li) =>
    loop.ring.edges.forEach((edge, i) => {
      const list = perEdge.get(edge.e) ?? [];
      list.push({ u: loop.u[i] as number, loop: li });
      perEdge.set(edge.e, list);
    }),
  );
  // Split every ring edge at its parameters (largest first, so e keeps running from edgeVert(e, 0)).
  const vertexOf = new Map<string, number>();
  const splits: Split[] = [];
  const created: number[] = [];
  for (const [e, list] of [...perEdge].sort((x, y) => x[0] - y[0])) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    const pa = pos(m, a);
    const pb = pos(m, b);
    const sorted = [...list].sort((x, y) => y.u - x.u || x.loop - y.loop);
    let span = 1;
    for (const entry of sorted) {
      const u = Math.min(1, Math.max(0, entry.u));
      const key = `${e}:${u}`;
      const existing = vertexOf.get(key);
      if (existing !== undefined) {
        vertexOf.set(`${entry.loop}:${e}`, existing);
        continue;
      }
      const sides = edgeCorners(m, e).map((c) => ({ c, face: m.cornerFace(c) }));
      const v = m.splitEdgeMakeVert(e, span > 0 ? u / span : 0);
      setPos(m, v, lerp3(pa, pb, u));
      created.push(v);
      if (sorted.length === 1) {
        // The single-split case is exactly the Euler operator's interpolation; record it for `adjust`.
        const record: Split = { e, v, a, b, sides: [] };
        for (const side of sides) {
          const corner = cornerAt(m, side.face, v);
          const ca = cornerAt(m, side.face, a);
          const cb = cornerAt(m, side.face, b);
          record.sides.push({ corner, ca, cb, twins: [] });
        }
        splits.push(record);
      }
      vertexOf.set(key, v);
      vertexOf.set(`${entry.loop}:${e}`, v);
      span = u;
    }
  }
  // Chords: each loop across each of its quads, in the piece of the quad that holds both points.
  const chords: [number, number, boolean][] = [];
  loops.forEach((loop, li) => {
    for (const face of loop.ring.faces) {
      const vin = vertexOf.get(`${li}:${(loop.ring.edges[face.a] as { e: number }).e}`) as number;
      const vout = vertexOf.get(`${li}:${(loop.ring.edges[face.b] as { e: number }).e}`) as number;
      if (vin === vout || m.findEdge(vin, vout) !== -1) continue;
      let done = false;
      for (const c of vertCorners(m, vin)) {
        const g = m.cornerFace(c);
        const d = cornerAt(m, g, vout);
        if (d === -1 || m.cornerNext(c) === d || m.cornerNext(d) === c) continue;
        const chord = m.splitFaceMakeEdge(g, c, d);
        // g keeps c's side and gains a copy of d at vout; the new piece takes d and a copy of c at vin (adjust copies
        // the split corners' values to these twins).
        const h = edgeCorners(m, chord)
          .map((corner) => m.cornerFace(corner))
          .find((face) => face !== g);
        const twinIn = h === undefined ? -1 : cornerAt(m, h, vin);
        const twinOut = cornerAt(m, g, vout);
        for (const split of splits) {
          for (const side of split.sides) {
            if (side.corner === c && twinIn !== -1) side.twins.push(twinIn);
            if (side.corner === d && twinOut !== -1) side.twins.push(twinOut);
          }
        }
        chords.push([vin, vout, allHard.get(face.f) === true]);
        done = true;
        break;
      }
      if (!done) continue;
    }
  });
  const loopEdges: number[] = [];
  for (const [vin, vout, hard] of chords) {
    const e = m.findEdge(vin, vout);
    if (e === -1) continue;
    const flags = m.edgeFlags(e);
    const next = hard ? flags | EDGE_HARD : flags & ~EDGE_HARD;
    if (next !== flags) m.setEdgeFlags(e, next);
    loopEdges.push(e);
  }
  // No quad crossed (only end faces): select the pieces of the split ring edges, so the new points show.
  if (chords.length === 0) for (const v of created) loopEdges.push(...vertEdges(m, v));
  // `adjust`: one relative/equal loop without symmetry moves its points and re-interpolates their layers.
  const single = mirror === null && loops.length === 1 && str(args, 'mode', 'relative') !== 'multiple';
  let current: Record<string, ParamValue> = args;
  const ring = ring0;
  const order = new Map<number, number>(ring.edges.map((edge, i) => [edge.e, i]));
  const adjust = single
    ? (patch: ParamValues): boolean => {
        for (const key of Object.keys(patch)) if (key !== 'weight') return false;
        const merged = resolveArgs(INSERT_LOOP, { ...current, ...patch });
        const [plan] = loopsOf(geometry0, fractions(geometry0, merged, seedLength));
        if (plan === undefined) return false;
        for (const split of splits) {
          const u = Math.min(1, Math.max(0, plan.u[order.get(split.e) ?? 0] as number));
          setPos(m, split.v, lerp3(pos(m, split.a), pos(m, split.b), u));
          interpolatePointAttributes(m, split.a, split.b, u, split.v);
          for (const side of split.sides) {
            interpolateCornerAttributes(m, side.ca, side.cb, u, side.corner);
            for (const twin of side.twins) copyCornerAttributes(m, side.corner, twin);
          }
        }
        current = merged;
        return true;
      }
    : undefined;
  return opResult(
    selectionResult(
      m,
      'edge',
      [...new Set(loopEdges)].sort((x, y) => x - y),
    ),
    warnings,
    args,
    adjust === undefined ? undefined : { adjust },
  );
}

export const insertLoop: MeshOp = Object.freeze({
  ...INSERT_LOOP,
  poll: pollInsertLoop,
  run: guarded(INSERT_LOOP, runInsertLoop),
});
