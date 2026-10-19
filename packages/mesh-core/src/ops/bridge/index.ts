// Kernel ops of `ops/bridge/` (M6A-SPEC §6.1, §5.12; B3): `mesh.bridge` — two border-edge chains (open or closed) on
// one mesh, from `loops` (selection-bound: the two chains in pick order; resolved from the selected border edges) or
// two selected faces (deleted first, their boundaries bridged). Counts must match (`bridge.unequal-counts`). Each new
// quad runs both border edges against their existing faces, which fixes the pairing direction (M6A-B3-8); closed
// loops take the start offset minimizing the summed squared distances (ties: the smaller offset), shifted by
// `twist + offset` whole steps. `divisions` rings at k/(divisions + 1), linear, scaled about the interpolated centroid
// by 1 + (taper − 1)·4s(1 − s) (M6A-B3-9). Corner layers interpolate between the bounding corners; faces take the
// lower-index adjacent face's layers and material; strip edges follow H2. `selection′` = the new faces.
// Symmetry (pointer class): the mirrored pair is bridged too (pairing and rings mirrored exactly, so twist and offset
// act mirrored); a pair that is its own mirror bridges once; a pair with an unpaired loop bridges once with
// `symmetry.unmatched-partner`.
import type { ParamValue, ParamValues } from '@ekza-animator/anim-core';
import { interpolateCornerAttributes, interpolatePointAttributes } from '../../layers/propagate';
import { applySmoothingAngle } from '../../normals/hard';
import { resolveSmoothingAngle } from '../../normals/normals';
import { refuse } from '../../refusal';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, OpWarning, Refusal } from '../../types';
import { type Mirror, mirrorOf, unmatchedWarnings } from '../extrude/shared/symmetry';
import {
  type V3,
  add,
  faceCorners,
  faceVerts,
  lerp3,
  num,
  opResult,
  pickOrder,
  pos,
  resolveArgs,
  scale,
  selected,
  selectionResult,
  setPos,
  sub,
  uniqueSorted,
  guarded,
} from '../extrude/shared/util';
import { type BorderLoop, borderChains } from '../fill';
import { BRIDGE } from './descriptor';

/** Always true: `loops` may come from args (poll sees none); `run` refuses unusable input. */
function pollBridge(_m: EditMesh, _sel: ComponentSelection | null, _ctx: OpContext): true | Refusal {
  return true;
}

/** The column pairing of two chains: for each vertex of A (fill order) the paired vertex of B. */
interface Pairing {
  readonly a: BorderLoop;
  readonly b: BorderLoop;
  /** b vertex index paired with A's vertex i. */
  readonly j: readonly number[];
}

function pairChains(m: EditMesh, a: BorderLoop, b: BorderLoop, shift: number): Pairing {
  const n = a.verts.length;
  if (!a.closed) {
    // Open: a_0 ↔ b_last, … (the winding fixes the direction).
    return { a, b, j: a.verts.map((_, i) => n - 1 - i) };
  }
  let best = 0;
  let bestCost = Infinity;
  for (let s = 0; s < n; s++) {
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const p = pos(m, a.verts[i] as number);
      const q = pos(m, b.verts[(((s - i) % n) + n) % n] as number);
      const d = sub(p, q);
      cost += d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    }
    if (cost < bestCost - 1e-12 * Math.max(1, bestCost)) {
      bestCost = cost;
      best = s;
    }
  }
  const s = (((best + shift) % n) + n) % n;
  return { a, b, j: a.verts.map((_, i) => (((s - i) % n) + n) % n) };
}

function centroid(m: EditMesh, verts: readonly number[]): V3 {
  let c: V3 = [0, 0, 0];
  for (const v of verts) c = add(c, pos(m, v));
  return scale(c, 1 / Math.max(1, verts.length));
}

/** Builds the strip of a pairing; returns the new faces and the strip edges' vertex pairs. */
function buildStrip(
  m: EditMesh,
  pairing: Pairing,
  divisions: number,
  taper: number,
  ringPositions: ((column: number, k: number) => V3) | null,
): { faces: number[]; pairs: [number, number][]; rings: number[][]; positions: V3[][] } {
  const { a, b, j } = pairing;
  const n = a.verts.length;
  const columns = n;
  const segments = a.closed ? n : n - 1;
  const ca = centroid(m, a.verts);
  const cb = centroid(m, b.verts);
  const rows: number[][] = [[...a.verts]];
  const positions: V3[][] = [];
  for (let k = 1; k <= divisions; k++) {
    const s = k / (divisions + 1);
    const sigma = 1 + (taper - 1) * 4 * s * (1 - s);
    const c = lerp3(ca, cb, s);
    const row: number[] = [];
    const rowPos: V3[] = [];
    for (let i = 0; i < columns; i++) {
      const av = a.verts[i] as number;
      const bv = b.verts[j[i] as number] as number;
      const p = ringPositions?.(i, k) ?? add(c, scale(sub(lerp3(pos(m, av), pos(m, bv), s), c), sigma));
      const v = m.makeVert(p[0], p[1], p[2]);
      interpolatePointAttributes(m, av, bv, s, v);
      setPos(m, v, p);
      row.push(v);
      rowPos.push(p);
    }
    rows.push(row);
    positions.push(rowPos);
  }
  rows.push(a.verts.map((_, i) => b.verts[j[i] as number] as number));
  const faces: number[] = [];
  const pairs: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const i1 = (i + 1) % columns;
    // The bounding corners: A's face corners on edge (a_i, a_i+1), B's on (b_j(i+1), b_j(i)).
    const aFace = a.faces[i] as number;
    const bEdgeIndex = (() => {
      const from = j[i1] as number;
      // B's chain runs b_x → b_x+1 in fill order; the strip runs b_j(i+1) → b_j(i), the edge leaving b_j(i+1).
      return b.closed ? from : Math.min(from, b.verts.length - 2);
    })();
    const bFace = b.faces[bEdgeIndex] as number;
    const corner = (face: number, v: number): number => faceCorners(m, face).find((c) => m.cornerVert(c) === v) ?? -1;
    const a0 = corner(aFace, a.verts[i] as number);
    const a1 = corner(aFace, a.verts[i1] as number);
    const b0 = corner(bFace, b.verts[j[i] as number] as number);
    const b1 = corner(bFace, b.verts[j[i1] as number] as number);
    const example = Math.min(aFace, bFace);
    for (let k = 0; k <= divisions; k++) {
      const lo = rows[k] as number[];
      const hi = rows[k + 1] as number[];
      const quad: [number, number, number, number] = [
        lo[i] as number,
        lo[i1] as number,
        hi[i1] as number,
        hi[i] as number,
      ];
      const f = m.makeFace(quad, { example });
      const s0 = k / (divisions + 1);
      const s1 = (k + 1) / (divisions + 1);
      for (const c of faceCorners(m, f)) {
        const v = m.cornerVert(c);
        const [from, to, s] =
          v === quad[0] ? [a0, b0, s0] : v === quad[1] ? [a1, b1, s0] : v === quad[2] ? [a1, b1, s1] : [a0, b0, s1];
        if (from !== -1 && to !== -1) interpolateCornerAttributes(m, from, to, s, c);
      }
      if (m.faceFlags(f) !== 0) m.setFaceFlags(f, 0);
      faces.push(f);
      pairs.push([quad[0], quad[1]], [quad[1], quad[2]], [quad[2], quad[3]], [quad[3], quad[0]]);
    }
  }
  return { faces, pairs, rings: rows.slice(1, -1), positions };
}

/** Resolves the two chains (edge mode or `loops`); faces mode deletes the faces first. */
function resolveChains(
  m: EditMesh,
  sel: ComponentSelection | null,
  args: Record<string, ParamValue>,
  ctx: OpContext,
  mirror: Mirror | null,
): { chains: BorderLoop[] } | Refusal {
  const loops = args['loops'];
  let groups: number[][] | null = null;
  if (Array.isArray(loops)) {
    groups = [];
    for (const list of loops) {
      if (!Array.isArray(list)) return refuse('bridge.needs-two', 'Bridge needs two border loops');
      const edges = list.filter(
        (e): e is number => typeof e === 'number' && Number.isInteger(e) && e >= 0 && e < m.counts.edges,
      );
      if (edges.length !== list.length) return refuse('bridge.needs-two', 'Bridge needs two border loops');
      groups.push(uniqueSorted(edges));
    }
  } else if (sel?.kind === 'face') {
    const faces = selected(m, sel, 'face', ctx.hidden);
    if (faces.length !== 2) return refuse('bridge.needs-two', 'Select two faces or two border loops to bridge');
    const [f0, f1] = faces as [number, number];
    const v0 = new Set(faceVerts(m, f0));
    if (faceVerts(m, f1).some((v) => v0.has(v))) {
      return refuse('bridge.needs-two', 'Bridge needs two faces that do not touch');
    }
    for (const f of faces) {
      for (const c of faceCorners(m, f)) {
        if (m.edgeFaceCount(m.cornerEdge(c)) !== 2)
          return refuse('bridge.needs-two', 'Bridge needs two faces inside the mesh');
      }
    }
    groups = faces.map((f) => uniqueSorted(faceCorners(m, f).map((c) => m.cornerEdge(c))));
    // Under symmetry the mirrored faces go too (unless the pair is its own mirror or a face has no partner).
    const doomed = new Set(faces);
    if (mirror !== null) {
      const partners = faces.map((f) => mirror.partner('face', f));
      if (partners.every((f) => f !== -1)) for (const f of partners) doomed.add(f);
    }
    for (const f of [...doomed].sort((x, y) => y - x)) m.killFace(f);
  } else if (sel !== null) {
    const edges = selected(m, sel, 'edge', ctx.hidden).filter((e) => m.edgeFaceCount(e) === 1);
    const chains = borderChains(m, edges, true);
    if (chains.length !== 2) return refuse('bridge.needs-two', 'Select two border loops or two faces to bridge');
    // Pick order: the chain holding the first-picked edge first.
    const first = pickOrder(sel, edges)[0];
    const ordered =
      first !== undefined && (chains[1] as BorderLoop).edges.includes(first) ? [chains[1], chains[0]] : chains;
    args['loops'] = ordered.map((chain) => [...(chain as BorderLoop).edges].sort((x, y) => x - y));
    return { chains: ordered as BorderLoop[] };
  }
  if (groups === null || groups.length !== 2)
    return refuse('bridge.needs-two', 'Select two border loops or two faces to bridge');
  const chains: BorderLoop[] = [];
  for (const group of groups) {
    if (group.some((e) => m.edgeFaceCount(e) !== 1)) return refuse('bridge.needs-two', 'Bridge needs border edges');
    const found = borderChains(m, group, true);
    if (found.length !== 1) return refuse('bridge.needs-two', 'Each bridge side must be one connected border chain');
    chains.push(found[0] as BorderLoop);
  }
  return { chains };
}

/** The mirrored chain of `chain` (its edges' partners), or null when an edge has none. */
function mirrorChain(m: EditMesh, mirror: Mirror, chain: BorderLoop): BorderLoop | null {
  const edges = chain.edges.map((e) => mirror.partner('edge', e));
  if (edges.some((e) => e === -1)) return null;
  const found = borderChains(m, edges, true);
  return found.length === 1 ? (found[0] as BorderLoop) : null;
}

function runBridge(
  m: EditMesh,
  sel: ComponentSelection | null,
  rawArgs: ParamValues,
  ctx: OpContext,
): OpResult | Refusal {
  const args = resolveArgs(BRIDGE, rawArgs);
  const mirror = mirrorOf(ctx);
  const resolved = resolveChains(m, sel, args, ctx, mirror);
  if ('refused' in resolved) return resolved;
  const [a, b] = resolved.chains as [BorderLoop, BorderLoop];
  if (a.edges.length !== b.edges.length) {
    return refuse(
      'bridge.unequal-counts',
      `Bridge needs the same number of edges on both sides (${a.edges.length} vs ${b.edges.length})`,
    );
  }
  if (a.closed !== b.closed) return refuse('bridge.needs-two', 'Bridge needs two closed loops or two open chains');
  const divisions = Math.max(0, Math.round(num(args, 'divisions', 0)));
  const taper = num(args, 'taper', 1);
  const shift = Math.round(num(args, 'twist')) + Math.round(num(args, 'offset'));
  const smoothing = resolveSmoothingAngle(null, ctx.faceted);
  const warnings: OpWarning[] = [];
  // The mirrored pair (§5.14 Bridge row).
  let mirrored: [BorderLoop, BorderLoop] | null = null;
  if (mirror !== null) {
    const ma = mirrorChain(m, mirror, a);
    const mb = mirrorChain(m, mirror, b);
    if (ma === null || mb === null) warnings.push(...unmatchedWarnings(1));
    else {
      const key = (chain: BorderLoop) => [...chain.edges].sort((x, y) => x - y).join(',');
      const own = new Set([key(a), key(b)]);
      if (!(own.has(key(ma)) && own.has(key(mb)))) mirrored = [ma, mb];
    }
  }
  const pairing = pairChains(m, a, b, shift);
  const strip = buildStrip(m, pairing, divisions, taper, null);
  const faces = [...strip.faces];
  const pairs = [...strip.pairs];
  if (mirrored !== null && mirror !== null) {
    // Exact mirror: B′ pairs with the partners of A's pairs; rings are the reflections of A's rings.
    const [ma] = mirrored;
    const mb = mirrored[1];
    const columnOf = new Map<number, number>(a.verts.map((v, i) => [v, i]));
    const bIndex = new Map<number, number>(mb.verts.map((v, i) => [v, i]));
    const j: number[] = [];
    const sourceColumn: number[] = [];
    for (const v of ma.verts) {
      const src = columnOf.get(mirror.partner('vertex', v));
      const target =
        src === undefined
          ? undefined
          : bIndex.get(mirror.partner('vertex', b.verts[pairing.j[src] as number] as number));
      j.push(target ?? 0);
      sourceColumn.push(src ?? 0);
    }
    const mirroredStrip = buildStrip(m, { a: ma, b: mb, j }, divisions, taper, (column, k) =>
      mirror.reflect((strip.positions[k - 1] as V3[])[sourceColumn[column] as number] as V3),
    );
    faces.push(...mirroredStrip.faces);
    pairs.push(...mirroredStrip.pairs);
  }
  const hard = uniqueSorted(pairs.map(([x, y]) => m.findEdge(x, y)).filter((e) => e !== -1));
  applySmoothingAngle(m, hard, smoothing);
  return opResult(selectionResult(m, 'face', faces), warnings, args);
}

export const bridge: MeshOp = Object.freeze({ ...BRIDGE, poll: pollBridge, run: guarded(BRIDGE, runBridge) });
