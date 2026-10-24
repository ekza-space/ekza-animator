// `mesh.reduce`'s Decimator (MODELING-PLAN §7.2 G-a, research 15 §5.9 step 5, research 13 §5.17): meshoptimizer
// `simplifyWithAttributes` on the triangulated mesh, index-only, so every kept vertex keeps its exact position, UVs,
// colours, skin weights and morph deltas.
//
// 1. Wedges: the corners of one point with equal material, paint slot, `uv0`, `uv1` and `color0` become one simplifier
//    vertex; corners that differ there become separate vertices at the same position, which meshoptimizer treats as
//    an attribute seam (it infers seams from coincident positions): a seam only collapses along itself, so UV seams,
//    material borders and palette borders never crack or smear.
// 2. Attributes: the texture coordinates (`uvWeight`), the smooth point normal (`normalWeight`) and the vertex colour.
// 3. `vertex_lock`: palette/material-border vertices (`lockPalette`) and UV-seam vertices (`lockSeams`) never move.
// 4. Flags: `Regularize` for skinned meshes (or on request), `LockBorder`, `Prune` on request; no error limit.
// 5. Exact target by search: meshoptimizer lands at or a little under the requested index count; when it lands under,
//    a bisection over the requested count finds the largest result that is still within the budget.
// 6. Back to a stored mesh: one triangle face per output triangle; corner layers from the wedge's first corner, face
//    layers and material from its face, `normal.custom` dropped (the geometry changed) and hard edges re-derived from
//    `hardAngle` (plus the source's own hard edges between kept points).
import type { MeshData } from '@ekza-studio/mesh-core';
import { triangulate } from '@ekza-studio/mesh-core';
import { buildTriangleMesh, cornerFaces, nonManifoldEdges, smoothPointNormals, triangleCount } from './meshdata';
import type { Simplifier } from './simplifier';
import type { IntakeWarning, ReduceArgs } from './types';

/** "No error limit": meshoptimizer stops at the triangle target, not at an error bound (relative units). */
const UNLIMITED_ERROR = 1e6;
/** Simplifier runs of the exact-target search (the first run included). */
export const MAX_SEARCH_RUNS = 10;
/** Lock-and-retry rounds when the result pinches an edge (see `reduceMesh`). */
export const MAX_REPAIRS = 2;
/** Corner layers whose values split wedges (attribute seams). */
const SEAM_LAYERS = ['uv0', 'uv1', 'color0'] as const;

export interface ReduceOutcome {
  readonly data: MeshData;
  readonly facts: {
    readonly trianglesBefore: number;
    readonly trianglesAfter: number;
    readonly target: number;
    /** Simplifier vertices (wedges) and how many `vertex_lock` froze. */
    readonly wedges: number;
    readonly locked: number;
    readonly seamPoints: number;
    readonly borderPoints: number;
    /** meshoptimizer's relative error and the same in metres (× its scale). */
    readonly error: number;
    readonly errorMetres: number;
    readonly runs: number;
    readonly regularized: boolean;
    /** Searches re-run after locking the one-ring of pinched points. */
    readonly repairs: number;
  };
  readonly warnings: readonly IntakeWarning[];
}

const floatKey = (bits: number): number => (bits === 0x80000000 ? 0 : bits);

/** Wedges of the corners: the simplifier's vertex per corner and each wedge's first corner. */
function wedgesOf(
  data: MeshData,
  cornerFace: Uint32Array,
): { readonly wedgeOfCorner: Uint32Array; readonly wedgeCorner: Uint32Array; readonly group: Float64Array } {
  const C = data.counts.corners;
  const paint = data.layers.get('paint');
  const paintData = paint !== undefined && paint.def.domain === 'face' ? paint.data : null;
  const seamLayers = SEAM_LAYERS.map((name) => data.layers.get(name)).filter(
    (layer): layer is NonNullable<typeof layer> =>
      layer !== undefined && layer.def.domain === 'corner' && layer.data instanceof Float32Array,
  );
  const bits = seamLayers.map((layer) => {
    const array = layer.data as Float32Array;
    return { comps: layer.def.comps, words: new Uint32Array(array.buffer, array.byteOffset, array.length) };
  });
  const K = 2 + bits.reduce((sum, layer) => sum + layer.comps, 0);
  const keys = new Uint32Array(K * C);
  const groupOfCorner = new Float64Array(C);
  for (let c = 0; c < C; c++) {
    const f = cornerFace[c] as number;
    const material = data.faceMaterial[f] as number;
    const slot = paintData === null ? 0 : (paintData[f] as number);
    groupOfCorner[c] = material * 65536 + slot;
    let o = K * c;
    keys[o++] = data.cornerVert[c] as number;
    keys[o++] = (material << 16) | (slot & 0xffff);
    for (const layer of bits) {
      for (let k = 0; k < layer.comps; k++) keys[o++] = floatKey(layer.words[layer.comps * c + k] as number);
    }
  }
  const wedgeOfCorner = new Uint32Array(C);
  const wedgeCorner: number[] = [];
  const heads = new Map<number, number>();
  const chain: number[] = [];
  for (let c = 0; c < C; c++) {
    let h = 0x811c9dc5;
    for (let i = K * c; i < K * (c + 1); i++) h = Math.imul(h ^ (keys[i] as number), 0x01000193);
    let w = heads.get(h) ?? -1;
    while (w !== -1) {
      const first = wedgeCorner[w] as number;
      let same = true;
      for (let i = 0; i < K; i++) {
        if (keys[K * first + i] !== keys[K * c + i]) {
          same = false;
          break;
        }
      }
      if (same) break;
      w = chain[w] as number;
    }
    if (w === -1) {
      w = wedgeCorner.length;
      wedgeCorner.push(c);
      chain.push(heads.get(h) ?? -1);
      heads.set(h, w);
    }
    wedgeOfCorner[c] = w;
  }
  const group = new Float64Array(wedgeCorner.length);
  wedgeCorner.forEach((c, w) => {
    group[w] = groupOfCorner[c] as number;
  });
  return { wedgeOfCorner, wedgeCorner: Uint32Array.from(wedgeCorner), group };
}

/**
 * Reduces `data` to at most `target` triangles (see the module comment). A mesh already within the budget comes back
 * unchanged. `skinned` turns `Regularize` on unless `args.regularize` says otherwise.
 */
export function reduceMesh(
  simplifier: Simplifier,
  data: MeshData,
  target: number,
  args: ReduceArgs,
  skinned: boolean,
): ReduceOutcome {
  const before = triangleCount(data);
  const regularized = args.regularize ?? skinned;
  const warnings: IntakeWarning[] = [];
  const unchanged = (): ReduceOutcome => ({
    data,
    facts: {
      trianglesBefore: before,
      trianglesAfter: before,
      target,
      wedges: 0,
      locked: 0,
      seamPoints: 0,
      borderPoints: 0,
      error: 0,
      errorMetres: 0,
      runs: 0,
      regularized,
      repairs: 0,
    },
    warnings,
  });
  if (before <= target || data.counts.faces === 0) return unchanged();

  const cornerFace = cornerFaces(data);
  const { tris } = triangulate(data);
  const { wedgeOfCorner, wedgeCorner, group } = wedgesOf(data, cornerFace);
  const W = wedgeCorner.length;
  const P = data.counts.points;

  // Seam and border points: more wedges than (material, paint) groups → a UV/colour seam; more groups → a border.
  const wedgesAt = new Uint32Array(P);
  const groupsAt = new Uint32Array(P);
  const seen = new Set<number>();
  for (let w = 0; w < W; w++) {
    const p = data.cornerVert[wedgeCorner[w] as number] as number;
    wedgesAt[p] = (wedgesAt[p] as number) + 1;
    const key = p * 4294967296 + (group[w] as number);
    if (!seen.has(key)) {
      seen.add(key);
      groupsAt[p] = (groupsAt[p] as number) + 1;
    }
  }
  let seamPoints = 0;
  let borderPoints = 0;
  for (let p = 0; p < P; p++) {
    if ((wedgesAt[p] as number) > (groupsAt[p] as number)) seamPoints++;
    if ((groupsAt[p] as number) > 1) borderPoints++;
  }

  // Simplifier vertex streams.
  const triPoints = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) triPoints[i] = data.cornerVert[tris[i] as number] as number;
  const normals = smoothPointNormals(data.position, P, triPoints);
  const uv0 = data.layers.get('uv0');
  const colour = data.layers.get('color0');
  const hasUv = uv0 !== undefined && uv0.def.domain === 'corner' && uv0.def.comps === 2;
  const hasColour = colour !== undefined && colour.def.domain === 'corner' && colour.def.comps === 4;
  const A = (hasUv ? 2 : 0) + 3 + (hasColour ? 3 : 0);
  const weights: number[] = [
    ...(hasUv ? [args.uvWeight, args.uvWeight] : []),
    args.normalWeight,
    args.normalWeight,
    args.normalWeight,
    ...(hasColour ? [1, 1, 1] : []),
  ];
  const positions = new Float32Array(3 * W);
  const attributes = new Float32Array(A * W);
  const lock = new Uint8Array(W);
  let locked = 0;
  for (let w = 0; w < W; w++) {
    const c = wedgeCorner[w] as number;
    const p = data.cornerVert[c] as number;
    positions[3 * w] = data.position[3 * p] as number;
    positions[3 * w + 1] = data.position[3 * p + 1] as number;
    positions[3 * w + 2] = data.position[3 * p + 2] as number;
    let o = A * w;
    if (hasUv) {
      attributes[o++] = uv0.data[2 * c] as number;
      attributes[o++] = uv0.data[2 * c + 1] as number;
    }
    attributes[o++] = normals[3 * p] as number;
    attributes[o++] = normals[3 * p + 1] as number;
    attributes[o++] = normals[3 * p + 2] as number;
    if (hasColour) {
      attributes[o++] = colour.data[4 * c] as number;
      attributes[o++] = colour.data[4 * c + 1] as number;
      attributes[o++] = colour.data[4 * c + 2] as number;
    }
    const seam = (wedgesAt[p] as number) > (groupsAt[p] as number);
    const border = (groupsAt[p] as number) > 1;
    if ((args.lockSeams && seam) || (args.lockPalette && border)) {
      lock[w] = 1;
      locked++;
    }
  }
  const indices = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) indices[i] = wedgeOfCorner[tris[i] as number] as number;

  const flags: ('Regularize' | 'LockBorder' | 'Prune')[] = [];
  if (regularized) flags.push('Regularize');
  if (args.lockBorder) flags.push('LockBorder');
  if (args.prune) flags.push('Prune');
  let runs = 0;
  const run = (triangles: number): [Uint32Array, number] => {
    runs++;
    return simplifier.simplifyWithAttributes(
      indices,
      positions,
      3,
      attributes,
      A,
      weights,
      lock,
      3 * triangles,
      UNLIMITED_ERROR,
      flags,
    );
  };
  const count = (result: [Uint32Array, number]): number => result[0].length / 3;

  // Exact target by search: the largest result within the budget.
  const search = (): [Uint32Array, number] => {
    let best = run(target);
    if (count(best) >= target) return best;
    let lo = target;
    let hi = Math.min(before, target + Math.max(2, 2 * (target - count(best))));
    let over = false;
    while (runs < searchLimit && !over && hi > lo) {
      const result = run(hi);
      if (count(result) > target) over = true;
      else {
        if (count(result) > count(best)) best = result;
        lo = hi;
        if (hi >= before) break;
        hi = Math.min(before, hi + Math.max(2, 2 * (target - count(best))));
      }
    }
    while (over && runs < searchLimit && hi - lo > 1 && count(best) < target) {
      const mid = Math.floor((lo + hi) / 2);
      const result = run(mid);
      if (count(result) <= target) {
        lo = mid;
        if (count(result) > count(best)) best = result;
      } else {
        hi = mid;
      }
    }
    return best;
  };
  const toMesh = (result: [Uint32Array, number]): MeshData => {
    const [out] = result;
    const corners = new Uint32Array(out.length);
    const faces = new Uint32Array(out.length / 3);
    for (let i = 0; i < out.length; i++) corners[i] = wedgeCorner[out[i] as number] as number;
    for (let t = 0; t < faces.length; t++) faces[t] = cornerFace[corners[3 * t] as number] as number;
    return buildTriangleMesh({
      source: data,
      corners,
      faces,
      hardAngle: args.hardAngle,
      dropCornerLayers: new Set(['normal.custom']),
    });
  };

  let searchLimit = MAX_SEARCH_RUNS;
  let best = search();
  let reduced = toMesh(best);
  // Repair: meshoptimizer keeps attribute topology, not the link condition of the welded mesh, so a vertex where many
  // UV charts meet can end up pinched (an edge with more than two faces). When that happens on a source without such
  // edges, the one-ring of the pinched points is locked and the search runs again (at most twice).
  const sourcePinched = nonManifoldEdges(data).length > 0;
  let repairs = 0;
  for (; !sourcePinched && repairs < MAX_REPAIRS; repairs++) {
    const pinched = nonManifoldEdges(reduced);
    if (pinched.length === 0) break;
    const ring = new Set<number>();
    for (const [a, b] of pinched) for (const p of [a, b]) ring.add(sourcePointOf(reduced, data, p));
    const around = new Set(ring);
    for (let e = 0; e < data.counts.edges; e++) {
      const a = data.edgeVerts[2 * e] as number;
      const b = data.edgeVerts[2 * e + 1] as number;
      if (ring.has(a)) around.add(b);
      if (ring.has(b)) around.add(a);
    }
    for (let w = 0; w < W; w++) {
      if (lock[w] === 0 && around.has(data.cornerVert[wedgeCorner[w] as number] as number)) {
        lock[w] = 1;
        locked++;
      }
    }
    searchLimit = runs + MAX_SEARCH_RUNS;
    best = search();
    reduced = toMesh(best);
  }
  const error = best[1];
  if (!sourcePinched && nonManifoldEdges(reduced).length > 0) {
    warnings.push({
      code: 'reduce.non-manifold',
      message: `${nonManifoldEdges(reduced).length} edges have more than two faces after the reduce (Mesh Check lists them)`,
    });
  }
  if (count(best) > target) {
    warnings.push({
      code: 'reduce.target-unreached',
      message:
        `Reduced to ${count(best).toLocaleString('en-US')} triangles, not ${target.toLocaleString('en-US')}: ` +
        'locked vertices or seams stop further collapses (untick Lock seams or Lock palette borders)',
    });
  }
  return {
    data: reduced,
    facts: {
      trianglesBefore: before,
      trianglesAfter: triangleCount(reduced),
      target,
      wedges: W,
      locked,
      seamPoints,
      borderPoints,
      error,
      errorMetres: error * simplifier.getScale(positions, 3),
      runs,
      regularized,
      repairs,
    },
    warnings,
  };
}

/**
 * Splits a triangle budget over meshes in proportion to their triangle counts (water-filling: a mesh already within
 * its share keeps its count and leaves the rest to the others). Deterministic: the smaller meshes are settled first,
 * ties by input order.
 */
export function splitBudget(counts: readonly number[], budget: number): number[] {
  const order = counts.map((count, i) => ({ count, i })).sort((a, b) => a.count - b.count || a.i - b.i);
  const out = Array.from({ length: counts.length }, () => 0);
  let remaining = Math.max(0, Math.floor(budget));
  let rest = counts.reduce((sum, count) => sum + count, 0);
  for (const { count, i } of order) {
    const share = rest <= 0 ? 0 : Math.floor((remaining * count) / rest);
    const given = Math.min(count, Math.max(share, Math.min(count, 4)));
    out[i] = given;
    remaining = Math.max(0, remaining - given);
    rest -= count;
  }
  return out;
}

/** The source point a point of a reduced mesh came from (positions are copied exactly; ascending source order). */
function sourcePointOf(reduced: MeshData, source: MeshData, point: number): number {
  // buildTriangleMesh keeps used source points in ascending order: binary search would need the map; the position
  // match is exact, so a linear scan over the (rare) pinched points is enough.
  const x = reduced.position[3 * point];
  const y = reduced.position[3 * point + 1];
  const z = reduced.position[3 * point + 2];
  for (let p = 0; p < source.counts.points; p++) {
    if (source.position[3 * p] === x && source.position[3 * p + 1] === y && source.position[3 * p + 2] === z) return p;
  }
  return -1;
}
