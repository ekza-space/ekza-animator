// Kernel op `mesh.slide {percent, reference}` (M6A-SPEC §5.12; DCC-standard Slide Edge Tool; owner B4). Selected edges
// (edge mode) or vertices (vertex mode) slide along their **rails**, so every moved vertex stays on an edge of the
// pre-slide surface (the silhouette is kept):
// - edge mode: the selected edges form chains; each chain has two sides (the faces left and right of its edges,
//   oriented consistently along the chain). A chain vertex's rail on a side is the one unselected edge next to a chain
//   edge in that side's faces — for a loop on a quad strip, the two "ring" edges up and down; a vertex with no such
//   edge, or with two different ones (a pole), has no rail on that side and stays;
// - vertex mode: a vertex's rails are its own edges: positive = the edge best aligned with the reference direction,
//   negative = the one best aligned against it;
// - `percent` in −1…1: each vertex moves that fraction of its rail toward the rail's far end on the positive side
//   (negative percent: the other side), clamped to the rail;
// - `reference` (pointer-bound, the Slide tool's first drag): `{vertex, rail}` — a selected vertex and one of its rails;
//   the side holding that rail is positive. Other chains, and every chain without a reference, take the side whose
//   rails point most along the reference direction (null reference: the left side of the chain through the
//   lowest-index edge, oriented from its first vertex);
// - symmetry (pointer class: the op expands the selection itself): partners slide by the same percent along mirrored
//   rails (the reference direction mirrored on the other side of the plane, through the map's mirror in mesh-local
//   space: Object, or World mapped through the placement); seam vertices slide only along rails that lie in the plane;
//   components without a partner slide on their own side with `symmetry.unmatched-partner`, and so does a vertex whose
//   partner's rail has no mirror image among its own edges (asymmetric topology: it keeps its own rails, so it never
//   leaves the pre-slide surface).
// Not repeatable (pointer-bound reference). `adjust` re-solves new percents from the pre-slide positions.
import type { JsonValue, ParamValues } from '@ekza-studio/anim-core';
import { refuse } from '../../refusal';
import { argsOf, edgeCorners, keptSelection, num, scopeEdges, scopeVerts, vertEdges } from '../../subset/support';
import {
  contextMirror,
  expandWithPartners,
  type Mirror,
  partnerOf,
  reflectVector,
  unmatchedWarning,
  vertexSide,
} from '../../subset/symmetry';
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
import { SLIDE } from './descriptor';

/** A vertex and the far ends of its rails on the positive and negative sides (−1 = no rail). */
interface Slider {
  readonly v: number;
  readonly pos: number;
  readonly neg: number;
}

interface Reference {
  readonly vertex: number;
  readonly rail: number;
}

function referenceOf(value: JsonValue | undefined, m: EditMesh): Reference | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return null;
  const { vertex, rail } = value as { readonly vertex?: unknown; readonly rail?: unknown };
  if (typeof vertex !== 'number' || typeof rail !== 'number') return null;
  if (!Number.isInteger(vertex) || !Number.isInteger(rail)) return null;
  if (vertex < 0 || vertex >= m.counts.points || rail < 0 || rail >= m.counts.edges) return null;
  if (m.edgeOther(rail, vertex) === -1) return null;
  return { vertex, rail };
}

function dir(m: EditMesh, from: number, to: number): [number, number, number] {
  const p = m.position;
  const x = (p[3 * to] as number) - (p[3 * from] as number);
  const y = (p[3 * to + 1] as number) - (p[3 * from + 1] as number);
  const z = (p[3 * to + 2] as number) - (p[3 * from + 2] as number);
  const l = Math.hypot(x, y, z);
  return l > 0 ? [x / l, y / l, z / l] : [0, 0, 0];
}

const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);

/** The reference direction as seen from a vertex on the given side of the symmetry plane. */
function directionFor(
  d: readonly [number, number, number],
  originSide: number,
  side: number,
  mirror: Mirror | null,
): readonly [number, number, number] {
  if (mirror === null || originSide === 0 || side === 0 || Math.sign(originSide) === Math.sign(side)) return d;
  const out: [number, number, number] = [0, 0, 0];
  reflectVector(mirror, d[0], d[1], d[2], out);
  return out;
}

/** A seam vertex (its own partner) may only use rails whose far end is on the seam too (rails in the plane). */
function railAllowed(map: SymmetryMap | null, v: number, far: number): boolean {
  if (map === null || partnerOf(map, 'vertex', v) !== v) return true;
  return partnerOf(map, 'vertex', far) === far;
}

// ---------- edge mode ----------

interface Chain {
  readonly verts: number[];
  /** Per vertex (index into verts): far ends of the rails on the left and right sides (−1 none). */
  readonly left: Int32Array;
  readonly right: Int32Array;
}

function chains(m: EditMesh, edges: readonly number[], map: SymmetryMap | null): Chain[] {
  const selected = new Set(edges);
  const orient = new Map<number, readonly [number, number]>(); // edge → (s, t)
  const out: Chain[] = [];
  const radial: number[] = [];
  const diskTmp: number[] = [];
  for (const seed of edges) {
    if (orient.has(seed)) continue;
    const order: number[] = [seed];
    orient.set(seed, [m.edgeVert(seed, 0), m.edgeVert(seed, 1)]);
    for (let head = 0; head < order.length; head++) {
      const e = order[head] as number;
      const [s, t] = orient.get(e) as readonly [number, number];
      for (const v of [t, s]) {
        for (const f of vertEdges(m, v, diskTmp)) {
          if (!selected.has(f) || orient.has(f)) continue;
          const other = m.edgeOther(f, v);
          // Keep the direction of travel: leaving t continues forward, arriving at s comes from behind.
          orient.set(f, v === t ? [v, other] : [other, v]);
          order.push(f);
        }
      }
    }
    // Rail candidates per vertex and side.
    const candidates = new Map<number, { left: Set<number>; right: Set<number> }>();
    const add = (v: number, side: 'left' | 'right', e: number): void => {
      if (e === -1 || selected.has(e)) return;
      let entry = candidates.get(v);
      if (entry === undefined) {
        entry = { left: new Set(), right: new Set() };
        candidates.set(v, entry);
      }
      entry[side].add(e);
    };
    const touch = (v: number): void => {
      if (!candidates.has(v)) candidates.set(v, { left: new Set(), right: new Set() });
    };
    for (const e of order) {
      const [s, t] = orient.get(e) as readonly [number, number];
      touch(s);
      touch(t);
      for (const c of edgeCorners(m, e, radial)) {
        const runsForward = m.cornerVert(c) === s; // c runs s → t: the face is on the left
        if (runsForward) {
          add(s, 'left', m.cornerEdge(m.cornerPrev(c)));
          add(t, 'left', m.cornerEdge(m.cornerNext(c)));
        } else {
          add(t, 'right', m.cornerEdge(m.cornerPrev(c)));
          add(s, 'right', m.cornerEdge(m.cornerNext(c)));
        }
      }
    }
    const verts = [...candidates.keys()].sort((a, b) => a - b);
    const left = new Int32Array(verts.length).fill(-1);
    const right = new Int32Array(verts.length).fill(-1);
    verts.forEach((v, i) => {
      const entry = candidates.get(v) as { left: Set<number>; right: Set<number> };
      if (entry.left.size === 1) {
        const far = m.edgeOther([...entry.left][0] as number, v);
        if (railAllowed(map, v, far)) left[i] = far;
      }
      if (entry.right.size === 1) {
        const far = m.edgeOther([...entry.right][0] as number, v);
        if (railAllowed(map, v, far)) right[i] = far;
      }
    });
    out.push({ verts, left, right });
  }
  return out;
}

function edgeSliders(
  m: EditMesh,
  edges: readonly number[],
  reference: Reference | null,
  mirror: Mirror | null,
): Slider[] {
  const list = chains(m, edges, mirror?.map ?? null);
  if (list.length === 0) return [];
  // The reference chain, its positive side and the reference direction.
  let refChain = 0;
  let refLeft = true;
  let d: [number, number, number] = [0, 0, 0];
  let origin = 0;
  const sideOf = (v: number): number => (mirror === null ? 0 : vertexSide(m, mirror, v));
  const meanDir = (chain: Chain, rails: Int32Array): [number, number, number] => {
    const acc: [number, number, number] = [0, 0, 0];
    chain.verts.forEach((v, i) => {
      const far = rails[i] as number;
      if (far === -1) return;
      const u = dir(m, v, far);
      acc[0] += u[0];
      acc[1] += u[1];
      acc[2] += u[2];
    });
    return acc;
  };
  const chainSide = (chain: Chain): number => {
    let sum = 0;
    for (const v of chain.verts) sum += sideOf(v);
    return sum;
  };
  const found = reference === null ? -1 : list.findIndex((c) => c.verts.includes(reference.vertex));
  if (reference !== null) {
    // The reference rail's direction, seen from the reference vertex's side of the plane.
    const far = m.edgeOther(reference.rail, reference.vertex);
    d = dir(m, reference.vertex, far);
    origin = sideOf(reference.vertex);
    refChain = found;
    if (found !== -1) {
      const chain = list[found] as Chain;
      const i = chain.verts.indexOf(reference.vertex);
      if (chain.left[i] === far) refLeft = true;
      else if (chain.right[i] === far) refLeft = false;
      else refLeft = dot(meanDir(chain, chain.left), d) >= dot(meanDir(chain, chain.right), d);
    }
  } else {
    // The chain through the lowest-index selected edge; its left side is positive, and its rails' mean direction
    // decides the other chains (mirrored on the other side of the plane).
    const v0 = m.edgeVert(Math.min(...edges), 0);
    refChain = Math.max(
      0,
      list.findIndex((c) => c.verts.includes(v0)),
    );
    const chain = list[refChain] as Chain;
    d = meanDir(chain, chain.left);
    origin = chainSide(chain);
    refLeft = true;
  }
  const out: Slider[] = [];
  list.forEach((chain, ci) => {
    let leftPositive = refLeft;
    if (ci !== refChain) {
      const dd = directionFor(d, origin, chainSide(chain), mirror);
      leftPositive = dot(meanDir(chain, chain.left), dd) >= dot(meanDir(chain, chain.right), dd);
    }
    chain.verts.forEach((v, i) => {
      const l = chain.left[i] as number;
      const r = chain.right[i] as number;
      out.push({ v, pos: leftPositive ? l : r, neg: leftPositive ? r : l });
    });
  });
  return out;
}

// ---------- vertex mode ----------

function vertexSliders(
  m: EditMesh,
  verts: readonly number[],
  reference: Reference | null,
  mirror: Mirror | null,
  ctx: OpContext,
): Slider[] {
  if (verts.length === 0) return [];
  const map = mirror?.map ?? null;
  const sideOf = (v: number): number => (mirror === null ? 0 : vertexSide(m, mirror, v));
  let ref = reference;
  if (ref === null || !verts.includes(ref.vertex)) {
    const v0 = Math.min(...verts);
    const e0 = vertEdges(m, v0).find((e) => !ctx.hidden?.edges.has(e));
    ref = e0 === undefined ? null : { vertex: v0, rail: e0 };
  }
  if (ref === null) return [];
  const d = dir(m, ref.vertex, m.edgeOther(ref.rail, ref.vertex));
  const origin = sideOf(ref.vertex);
  const out: Slider[] = [];
  const disk: number[] = [];
  for (const v of verts) {
    const rails = vertEdges(m, v, disk)
      .filter((e) => !ctx.hidden?.edges.has(e))
      .map((e) => m.edgeOther(e, v))
      .filter((far) => railAllowed(map, v, far));
    if (v === ref.vertex) {
      const far = m.edgeOther(ref.rail, v);
      const pos = rails.includes(far) ? far : -1;
      let neg = -1;
      let best = 0;
      for (const w of rails) {
        if (w === pos) continue;
        const s = -dot(dir(m, v, w), d);
        if (s > best) {
          best = s;
          neg = w;
        }
      }
      out.push({ v, pos, neg });
      continue;
    }
    const dd = directionFor(d, origin, sideOf(v), mirror);
    let pos = -1;
    let bestPos = 0;
    for (const w of rails) {
      const s = dot(dir(m, v, w), dd);
      if (s > bestPos) {
        bestPos = s;
        pos = w;
      }
    }
    let neg = -1;
    let bestNeg = 0;
    for (const w of rails) {
      if (w === pos) continue;
      const s = -dot(dir(m, v, w), dd);
      if (s > bestNeg) {
        bestNeg = s;
        neg = w;
      }
    }
    out.push({ v, pos, neg });
  }
  return out;
}

/**
 * §5.14: partner vertices slide along mirrored rails. A vertex on the negative side whose partner slides takes the
 * partner's rails mirrored (whatever its own chain decided), so the result is an exact mirror image — when the mirrored
 * rails are edges of its own. Where the topology differs between the sides (a one-sided triangulate, cut,
 * spin or connect), a mirrored rail end may not be joined to the vertex at all: sliding toward it would leave the
 * pre-slide surface, so the vertex keeps its own rails and is listed in `unmatched` (`symmetry.unmatched-partner`).
 */
function mirrorSliders(m: EditMesh, sliders: readonly Slider[], mirror: Mirror | null, unmatched: number[]): Slider[] {
  if (mirror === null) return [...sliders];
  const map = mirror.map;
  const byVertex = new Map(sliders.map((s) => [s.v, s]));
  const mirrorOf = (far: number): number => (far < 0 ? -1 : partnerOf(map, 'vertex', far));
  /** Whether the mirror image `far` of a source rail end (−1: none) is the far end of an edge of v. */
  const isRail = (v: number, far: number): boolean => far >= 0 && m.findEdge(v, far) !== -1;
  return sliders.map((s) => {
    const p = partnerOf(map, 'vertex', s.v);
    if (p < 0 || p === s.v || vertexSide(m, mirror, s.v) >= 0) return s;
    const source = byVertex.get(p);
    if (source === undefined) return s;
    const pos = mirrorOf(source.pos);
    const neg = mirrorOf(source.neg);
    // A rail end without a partner (−1 from a slid-to vertex that has none) or not joined to v: own rails.
    if ((source.pos !== -1 && !isRail(s.v, pos)) || (source.neg !== -1 && !isRail(s.v, neg))) {
      unmatched.push(s.v);
      return s;
    }
    return { v: s.v, pos, neg };
  });
}

// ---------- the op ----------

function slidePoll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal {
  if (sel === null || sel.kind === 'face')
    return refuse('slide.no-components', 'Slide needs edges or vertices: select them');
  const n = sel.kind === 'edge' ? scopeEdges(m, sel, ctx.hidden).length : scopeVerts(m, sel, ctx.hidden).length;
  return n > 0 ? true : refuse('slide.no-components', 'Slide needs edges or vertices: select them');
}

function apply(m: EditMesh, start: Float64Array, sliders: readonly Slider[], percent: number): void {
  const t = Math.max(-1, Math.min(1, percent));
  for (const s of sliders) {
    const far = t >= 0 ? s.pos : s.neg;
    const f = Math.abs(t);
    let x = start[3 * s.v] as number;
    let y = start[3 * s.v + 1] as number;
    let z = start[3 * s.v + 2] as number;
    if (far !== -1 && f > 0) {
      x += f * ((start[3 * far] as number) - x);
      y += f * ((start[3 * far + 1] as number) - y);
      z += f * ((start[3 * far + 2] as number) - z);
    }
    const p = m.position;
    if (
      Object.is(p[3 * s.v], Math.fround(x + 0)) &&
      Object.is(p[3 * s.v + 1], Math.fround(y + 0)) &&
      Object.is(p[3 * s.v + 2], Math.fround(z + 0))
    ) {
      continue;
    }
    m.setPosition(s.v, x + 0, y + 0, z + 0);
  }
}

export const slide: MeshOp = Object.freeze({
  ...SLIDE,
  poll: slidePoll,
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, ctx: OpContext): OpResult | Refusal {
    const verdict = slidePoll(m, sel, ctx);
    if (verdict !== true || sel === null) return verdict as Refusal;
    let args = argsOf(SLIDE.params, raw);
    const reference = referenceOf(args['reference'], m);
    const mirror = contextMirror(ctx);
    const warnings: OpWarning[] = [];
    let working = sel;
    let unmatched: number[] = [];
    if (mirror !== null) {
      const expanded = expandWithPartners(sel, mirror.map);
      working = expanded.selection;
      unmatched = expanded.unmatched;
    }
    const sliders =
      sel.kind === 'edge'
        ? edgeSliders(m, scopeEdges(m, working, ctx.hidden), reference, mirror)
        : vertexSliders(m, scopeVerts(m, working, ctx.hidden), reference, mirror, ctx);
    // A vertex reached by two chains keeps its first slider.
    const seen = new Set<number>();
    const ownRails: number[] = [];
    const unique = mirrorSliders(
      m,
      sliders.filter((s) => (seen.has(s.v) ? false : (seen.add(s.v), true))),
      mirror,
      ownRails,
    );
    if (ownRails.length > 0) {
      // Reported in the selection's kind: the vertices themselves, or the selected edges that hold them.
      const listed = new Set(unmatched);
      if (sel.kind === 'vertex') for (const v of ownRails) listed.add(v);
      else {
        const edges = new Set(scopeEdges(m, working, ctx.hidden));
        for (const v of ownRails) for (const e of vertEdges(m, v)) if (edges.has(e)) listed.add(e);
      }
      unmatched = [...listed].sort((a, b) => a - b);
    }
    if (unmatched.length > 0) warnings.push(unmatchedWarning(unmatched.length, unmatched));
    const start = Float64Array.from(m.position.subarray(0, 3 * m.counts.points));
    apply(m, start, unique, num(args, 'percent', 0));
    return {
      selection: keptSelection(m, sel, sel.kind),
      warnings,
      resolvedArgs: args,
      adjust(patch: ParamValues): boolean {
        if (!Object.keys(patch).every((key) => key === 'percent')) return false;
        args = argsOf(SLIDE.params, { ...args, ...patch });
        apply(m, start, unique, num(args, 'percent', 0));
        return true;
      },
    };
  },
});
