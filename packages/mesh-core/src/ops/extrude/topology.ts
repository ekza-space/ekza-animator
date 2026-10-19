// The topology of a face extrusion (M6A-SPEC §5.8 steps 1–3; inset §5.9 reuses it with one division):
// regions of the selected faces, the region boundary, one duplicate per boundary vertex and region fan (a bow-tie
// vertex gets one per fan), the region's corners moved onto the duplicates (the cap keeps its face indices,
// ./shared/rewire.ts), `divisions − 1` rings and `divisions` side quads per boundary edge, and the edges left without
// a face removed. Positions are the caller's (./geometry.ts): every new vertex starts at its source's position.
//
// Winding (M6A-B3-1): for a boundary edge that its region face runs a → b, the side quads run (A_k, B_k, B_k+1, A_k+1)
// from the base (A_0 = a, outside faces) to the cap (A_n = a′), so each quad runs the base edge a → b against the
// outside face's b → a and the cap edge b′ → a′ against the cap's a′ → b′ (§5.29 P4). §5.8 step 3 writes the
// quad as (b, a, a′, b′), the reverse cycle; P4 decides.
import { copyCornerAttributes, copyEdgeAttributes, copyPointAttributes } from '../../layers/propagate';
import type { EditMesh } from '../../types';
import { swapCorner } from './shared/rewire';
import { cornerAt, edgeFaces, faceCorners, faceVerts, uniqueSorted, vertEdges, vertFaces } from './shared/util';

/** A vertex of the cap as planned on the pre-op mesh. */
export interface PlanCap {
  /** The original vertex. */
  readonly src: number;
  readonly region: number;
  /** The region faces of its fan (all region faces at an interior vertex), ascending. */
  readonly faces: readonly number[];
  /** Boundary neighbours for the offset bisector: u of the boundary edge u → v and w of v → w (−1: none). */
  readonly prev: number;
  readonly next: number;
  /** A boundary vertex of the region: duplicated; otherwise it moves with the cap. */
  readonly dup: boolean;
}

export interface PlanRegion {
  readonly faces: readonly number[];
  readonly caps: readonly PlanCap[];
  /** face → (vertex → index into `caps`). */
  readonly byFace: ReadonlyMap<number, ReadonlyMap<number, number>>;
  /** Boundary edges a → b as their region face runs them. */
  readonly sides: readonly { readonly face: number; readonly a: number; readonly b: number }[];
}

export interface ExtrusionPlan {
  readonly regions: readonly PlanRegion[];
  readonly preWire: ReadonlySet<number>;
}

/** A cap vertex after the build: `out` is the duplicate (or `src`), `ring` the division vertices base → cap. */
export interface CapVertex extends PlanCap {
  readonly out: number;
  readonly ring: readonly number[];
}

export interface SideEdge {
  readonly region: number;
  readonly face: number;
  readonly a: CapVertex;
  readonly b: CapVertex;
}

export interface Extrusion {
  readonly regions: readonly { readonly faces: readonly number[]; readonly caps: readonly CapVertex[] }[];
  readonly sides: readonly SideEdge[];
  readonly divisions: number;
}

/** Connected components of `faces` through shared edges (each face alone when `together` is false), ascending. */
export function faceRegions(m: EditMesh, faces: readonly number[], together: boolean): number[][] {
  if (!together) return faces.map((f) => [f]);
  const inSet = new Set(faces);
  const seen = new Set<number>();
  const regions: number[][] = [];
  for (const start of faces) {
    if (seen.has(start)) continue;
    const region: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const f = stack.pop() as number;
      region.push(f);
      for (const c of faceCorners(m, f)) {
        for (const g of edgeFaces(m, m.cornerEdge(c))) {
          if (inSet.has(g) && !seen.has(g)) {
            seen.add(g);
            stack.push(g);
          }
        }
      }
    }
    regions.push(region.sort((a, b) => a - b));
  }
  return regions.sort((a, b) => (a[0] as number) - (b[0] as number));
}

/** Region edges that are neither two-face interior edges nor one-region-face boundary edges (non-manifold). */
export function regionNonManifold(m: EditMesh, region: readonly number[]): number[] {
  const inSet = new Set(region);
  const bad = new Set<number>();
  for (const f of region) {
    for (const c of faceCorners(m, f)) {
      const e = m.cornerEdge(c);
      const faces = edgeFaces(m, e);
      const inside = faces.filter((g) => inSet.has(g)).length;
      if (inside >= 2 && faces.length !== 2) bad.add(e);
    }
    // A face that runs one vertex twice has no single fan corner there.
    const verts = faceVerts(m, f);
    if (new Set(verts).size !== verts.length) for (const c of faceCorners(m, f)) bad.add(m.cornerEdge(c));
  }
  return [...bad].sort((a, b) => a - b);
}

function isBoundary(m: EditMesh, e: number, inSet: ReadonlySet<number>): boolean {
  let inside = 0;
  for (const g of edgeFaces(m, e)) if (inSet.has(g)) inside++;
  return inside === 1;
}

/** The region fans at vertex v: groups of region faces around v joined by region-interior edges at v. */
function fansAt(m: EditMesh, v: number, inSet: ReadonlySet<number>): number[][] {
  const faces = vertFaces(m, v).filter((f) => inSet.has(f));
  const parent = new Map<number, number>(faces.map((f) => [f, f]));
  const find = (f: number): number => {
    let r = f;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (const e of vertEdges(m, v)) {
    const all = edgeFaces(m, e);
    const fs = all.filter((f) => inSet.has(f));
    if (fs.length === 2 && all.length === 2) {
      const a = find(fs[0] as number);
      const b = find(fs[1] as number);
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
    }
  }
  const groups = new Map<number, number[]>();
  for (const f of faces) {
    const root = find(f);
    const list = groups.get(root) ?? [];
    list.push(f);
    groups.set(root, list);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a - b)).sort((a, b) => (a[0] as number) - (b[0] as number));
}

/** Plans the extrusion of `regions` on the pre-op mesh (read-only). */
export function planExtrusion(m: EditMesh, regions: readonly (readonly number[])[]): ExtrusionPlan {
  const touched = new Set<number>();
  const out: PlanRegion[] = [];
  for (let r = 0; r < regions.length; r++) {
    const faces = regions[r] as readonly number[];
    const inSet = new Set(faces);
    const caps: PlanCap[] = [];
    const byFace = new Map<number, Map<number, number>>();
    for (const v of uniqueSorted(faces.flatMap((f) => faceVerts(m, f)))) {
      touched.add(v);
      for (const fan of fansAt(m, v, inSet)) {
        let prev = -1;
        let next = -1;
        let dup = false;
        for (const f of fan) {
          const c = cornerAt(m, f, v);
          if (isBoundary(m, m.cornerEdge(c), inSet)) {
            dup = true;
            if (next === -1) next = m.cornerVert(m.cornerNext(c));
          }
          if (isBoundary(m, m.cornerEdge(m.cornerPrev(c)), inSet)) {
            dup = true;
            if (prev === -1) prev = m.cornerVert(m.cornerPrev(c));
          }
        }
        const index = caps.length;
        caps.push({ src: v, region: r, faces: fan, prev, next, dup });
        for (const f of fan) {
          const map = byFace.get(f) ?? new Map<number, number>();
          map.set(v, index);
          byFace.set(f, map);
        }
      }
    }
    const sides: { face: number; a: number; b: number }[] = [];
    for (const f of faces) {
      for (const c of faceCorners(m, f)) {
        if (isBoundary(m, m.cornerEdge(c), inSet)) {
          sides.push({ face: f, a: m.cornerVert(c), b: m.cornerVert(m.cornerNext(c)) });
        }
      }
    }
    out.push({ faces, caps, byFace, sides });
  }
  const preWire = new Set<number>();
  for (const v of touched) for (const e of vertEdges(m, v)) if (m.edgeFaceCount(e) === 0) preWire.add(e);
  return { regions: out, preWire };
}

/** Builds a planned extrusion with `divisions` side quads per boundary edge (positions are the caller's). */
export function buildExtrusion(m: EditMesh, plan: ExtrusionPlan, divisions: number): Extrusion {
  const n = Math.max(1, Math.floor(divisions));
  // Phase 1: duplicates (at their sources, with the sources' point layers), then the region's corners onto them.
  const regions = plan.regions.map((region) => ({
    faces: region.faces,
    caps: region.caps.map((cap): CapVertex & { ring: number[] } => {
      if (!cap.dup) return { ...cap, out: cap.src, ring: [] };
      const p = m.position;
      const v = cap.src;
      const out = m.makeVert(p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
      copyPointAttributes(m, v, out);
      return { ...cap, out, ring: [] };
    }),
  }));
  for (let r = 0; r < plan.regions.length; r++) {
    const planned = plan.regions[r] as PlanRegion;
    const caps = (regions[r] as (typeof regions)[number]).caps;
    for (const f of planned.faces) {
      for (const [v, index] of planned.byFace.get(f) ?? []) {
        const cap = caps[index] as CapVertex;
        if (cap.dup) swapCorner(m, f, v, cap.out);
      }
    }
  }
  // Cap edges made by the swaps take their source edge's flags and layers (H5: the edge moved with the cap).
  for (const region of regions) {
    const srcOf = new Map<number, number>();
    for (const cap of region.caps) srcOf.set(cap.out, cap.src);
    for (const f of region.faces) {
      for (const c of faceCorners(m, f)) {
        const x = m.cornerVert(c);
        const y = m.cornerVert(m.cornerNext(c));
        const sx = srcOf.get(x) ?? x;
        const sy = srcOf.get(y) ?? y;
        if (sx === x && sy === y) continue;
        const old = m.findEdge(sx, sy);
        if (old === -1) continue;
        const e = m.cornerEdge(c);
        if (m.edgeFlags(e) !== m.edgeFlags(old)) m.setEdgeFlags(e, m.edgeFlags(old));
        copyEdgeAttributes(m, old, e);
      }
    }
  }

  // Phase 2: rings and side quads (side corners take the cap corner's values, faces the region face's layers).
  const sides: SideEdge[] = [];
  for (let r = 0; r < plan.regions.length; r++) {
    const planned = plan.regions[r] as PlanRegion;
    const caps = (regions[r] as (typeof regions)[number]).caps;
    for (const cap of caps) {
      if (!cap.dup) continue;
      for (let k = 1; k < n; k++) {
        const p = m.position;
        const v = m.makeVert(p[3 * cap.src] as number, p[3 * cap.src + 1] as number, p[3 * cap.src + 2] as number);
        copyPointAttributes(m, cap.src, v);
        cap.ring.push(v);
      }
    }
    for (const side of planned.sides) {
      const a = caps[planned.byFace.get(side.face)?.get(side.a) as number] as CapVertex;
      const b = caps[planned.byFace.get(side.face)?.get(side.b) as number] as CapVertex;
      sides.push({ region: r, face: side.face, a, b });
      const chainA = [a.src, ...a.ring, a.out];
      const chainB = [b.src, ...b.ring, b.out];
      const capA = cornerAt(m, side.face, a.out);
      const capB = cornerAt(m, side.face, b.out);
      for (let k = 0; k < n; k++) {
        const quad = [chainA[k], chainB[k], chainB[k + 1], chainA[k + 1]] as number[];
        const q = m.makeFace(quad, { example: side.face });
        for (const corner of faceCorners(m, q)) {
          const vert = m.cornerVert(corner);
          copyCornerAttributes(m, vert === quad[0] || vert === quad[3] ? capA : capB, corner);
        }
        if (m.faceFlags(q) !== 0) m.setFaceFlags(q, 0);
      }
    }
  }

  // Phase 3: edges left without a face (old region-interior edges, superseded cap edges), never pre-op wire edges.
  const candidates = new Set<number>();
  for (const region of regions) {
    for (const cap of region.caps) {
      for (const e of vertEdges(m, cap.src)) candidates.add(e);
      for (const e of vertEdges(m, cap.out)) candidates.add(e);
    }
  }
  const dead = [...candidates].filter((e) => m.edgeFaceCount(e) === 0 && !plan.preWire.has(e)).sort((a, b) => b - a);
  for (const e of dead) m.killEdge(e);
  return { regions, sides, divisions: n };
}

/** The side, ring and rim edges of an extrusion (H2: walls, where walls meet the cap and the mesh), ascending. */
export function sideEdges(m: EditMesh, x: Extrusion): number[] {
  const out = new Set<number>();
  for (const side of x.sides) {
    const chainA = [side.a.src, ...side.a.ring, side.a.out];
    const chainB = [side.b.src, ...side.b.ring, side.b.out];
    for (let k = 0; k < chainA.length; k++) {
      const ring = m.findEdge(chainA[k] as number, chainB[k] as number);
      if (ring !== -1) out.add(ring);
      if (k + 1 < chainA.length) {
        const wa = m.findEdge(chainA[k] as number, chainA[k + 1] as number);
        const wb = m.findEdge(chainB[k] as number, chainB[k + 1] as number);
        if (wa !== -1) out.add(wa);
        if (wb !== -1) out.add(wb);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}
