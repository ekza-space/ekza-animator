// The symmetry pieces the B4 ops need (M6A-SPEC §5.14): the mirror of a `SymmetryMap` in mesh-local space (Object and
// World mode), the source-side rule, the unmatched-partner warning, the pointer rule for `{edge, t}` points, a partner
// expansion for the pointer-class ops (Multi-Cut, Slide expand their own selections; the runtime expands only
// 'expand'-class ops), a vertex-partner builder for Symmetrize when no map is given, and the mirroring of vector layers
// through the mirror. B2 owns `buildSymmetryMap`, `expandSelection` and `mirrorEdgePoint` (§4.3); these helpers follow
// the same rules on a map the caller passes, so the B4 ops work and are tested before B2 merges.
// `test/ops/symmetry.test.ts` checks them against B2's functions once `READY.b2` holds (M6A-B4-2, M6A-B4-3).
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import { mirrorCornerAttributes, mirrorName, mirrorPointAttributes } from '../layers/propagate';
import type {
  AttrLayer,
  ComponentKind,
  ComponentSelection,
  EditMesh,
  OpContext,
  OpWarning,
  SymmetryAxis,
  SymmetryMap,
} from '../types';
import type { BitSet } from '../bitset';

export function axisIndex(axis: SymmetryAxis): 0 | 1 | 2 {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
}

type Vec3 = readonly [number, number, number];

/**
 * The mirror of a symmetry mode in mesh-local coordinates (§5.14; the same affine map as B2's `MirrorSpace`):
 *
 *   S(p) = p − 2·d(p)·g,   d(p) = n·p − c,   n·g = 1,
 *
 * where d(p) is the signed **world** distance (metres) of a local point to the plane — positive on the +axis side (the
 * local axis in Object mode, the world axis in World mode) — and g the local reflection direction. Object mode: the
 * local axis plane at `plane` (B2's maps put it through the object origin); World mode: the world axis plane through the
 * world origin, mapped into mesh-local space through the placement (P⁻¹·S·P; not orthogonal under a non-uniform scale,
 * but always the exact local image of the world reflection). When the reflection runs along one local axis (Object
 * mode, or a placement whose rotation maps the world axis onto a local one) `localAxis` names it and the helpers work
 * on that coordinate alone (`2·offset − x`, `offset`), so seam points land exactly on the plane.
 */
export interface MirrorPlane {
  readonly axis: SymmetryAxis;
  readonly space: 'object' | 'world';
  readonly n: Vec3;
  readonly c: number;
  readonly g: Vec3;
  /** |placement scale| per local axis (the world length of a local unit vector), each at least 1e-12. */
  readonly scale: Vec3;
  readonly minScale: number;
  /** The local axis the reflection runs along, or −1 when it is oblique in local space. */
  readonly localAxis: -1 | 0 | 1 | 2;
  /** The plane's local coordinate on `localAxis` (0 when oblique). */
  readonly offset: number;
}

/** A symmetry map with its mirror: what the B4 ops read under symmetry. */
export interface Mirror extends MirrorPlane {
  readonly map: SymmetryMap;
}

const MIN_SCALE = 1e-12;
/** Off-axis components below this fraction of the largest one are rounding noise of the placement's rotation. */
const ALIGNED = 1e-12;

function rotationRow(q: ReadonlyXf['q'], k: number): Vec3 {
  let x = q[0] ?? 0;
  let y = q[1] ?? 0;
  let z = q[2] ?? 0;
  let w = q[3] ?? 1;
  const len = Math.hypot(x, y, z, w);
  if (!(len > 0) || !Number.isFinite(len)) [x, y, z, w] = [0, 0, 0, 1];
  else [x, y, z, w] = [x / len, y / len, z / len, w / len];
  if (k === 0) return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)];
  if (k === 1) return [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)];
  return [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

/**
 * The mirror of `axis`/`space` for a mesh with `placement` (world from local); `plane` is the Object-mode plane's
 * local coordinate (World mode derives its plane from the placement).
 */
export function mirrorPlane(opts: {
  readonly axis: SymmetryAxis;
  readonly space: 'object' | 'world';
  readonly placement: ReadonlyXf;
  readonly plane?: number;
}): MirrorPlane {
  const k = axisIndex(opts.axis);
  const s = opts.placement.s;
  const signed = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1].map((v) =>
    !Number.isFinite(v) ? 1 : Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v,
  ) as [number, number, number];
  const scale = signed.map(Math.abs) as [number, number, number];
  const minScale = Math.min(scale[0], scale[1], scale[2]);
  if (opts.space === 'object') {
    const plane = Number.isFinite(opts.plane) ? (opts.plane as number) + 0 : 0;
    const n: [number, number, number] = [0, 0, 0];
    const g: [number, number, number] = [0, 0, 0];
    n[k] = scale[k];
    g[k] = 1 / scale[k];
    return {
      axis: opts.axis,
      space: 'object',
      n,
      c: plane * scale[k],
      g,
      scale,
      minScale,
      localAxis: k,
      offset: plane,
    };
  }
  // world w = R·diag(s)·p + t; d(p) = w_k = Σ_j R_kj s_j p_j + t_k; g = diag(1/s)·Rᵀ·e_k (n·g = Σ_j R_kj² = 1).
  const r = rotationRow(opts.placement.q, k);
  const t = opts.placement.t[k] ?? 0;
  const c = Number.isFinite(t) ? -t : 0;
  const nn: [number, number, number] = [0, 0, 0];
  const gg: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    nn[j] = (r[j] as number) * (signed[j] as number);
    gg[j] = (r[j] as number) / (signed[j] as number);
  }
  // A rotation that maps the world axis onto a local one (up to its rounding noise) reflects along that local axis.
  const big = [0, 1, 2].reduce((a, b) => (Math.abs(r[b] as number) > Math.abs(r[a] as number) ? b : a), 0) as 0 | 1 | 2;
  const rb = r[big];
  if ([0, 1, 2].every((j) => j === big || Math.abs(r[j] as number) <= ALIGNED * Math.abs(rb))) {
    const sign = rb < 0 ? -1 : 1;
    const n: [number, number, number] = [0, 0, 0];
    const g: [number, number, number] = [0, 0, 0];
    n[big] = sign * signed[big];
    g[big] = 1 / n[big];
    const offset = c / n[big] + 0;
    return { axis: opts.axis, space: 'world', n, c, g, scale, minScale, localAxis: big, offset };
  }
  return { axis: opts.axis, space: 'world', n: nn, c, g: gg, scale, minScale, localAxis: -1, offset: 0 };
}

/** The mirror of `map` for a mesh with `placement`. */
export function mirrorOf(map: SymmetryMap, placement: ReadonlyXf): Mirror {
  return { ...mirrorPlane({ axis: map.axis, space: map.space, placement, plane: map.plane }), map };
}

/** The mirror of the op context's symmetry (null when symmetry is off). */
export function contextMirror(ctx: OpContext): Mirror | null {
  const map = ctx.symmetry?.map;
  return map === undefined ? null : mirrorOf(map, ctx.placement);
}

/** Signed world distance (metres) of a local point to the plane (> 0 = the positive side). */
export function planeDistance(mp: MirrorPlane, x: number, y: number, z: number): number {
  const k = mp.localAxis;
  if (k !== -1) return mp.n[k] * ((k === 0 ? x : k === 1 ? y : z) - mp.offset);
  return mp.n[0] * x + mp.n[1] * y + mp.n[2] * z - mp.c;
}

/** Signed world distance of vertex `v` from the plane (metres; > 0 = the positive side). */
export function vertexSide(m: EditMesh, mp: MirrorPlane, v: number): number {
  const p = m.position;
  return planeDistance(mp, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
}

/** S(p): the mirror image of a local point, into `out` at `o`. */
export function reflectPoint(
  mp: MirrorPlane,
  x: number,
  y: number,
  z: number,
  out: Float64Array | number[],
  o = 0,
): void {
  const k = mp.localAxis;
  if (k !== -1) {
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    out[o + k] = 2 * mp.offset - (k === 0 ? x : k === 1 ? y : z);
    return;
  }
  const d2 = 2 * planeDistance(mp, x, y, z);
  out[o] = x - d2 * mp.g[0];
  out[o + 1] = y - d2 * mp.g[1];
  out[o + 2] = z - d2 * mp.g[2];
}

/** The linear part of S applied to a local vector (a delta or a direction), into `out` at `o`. */
export function reflectVector(
  mp: MirrorPlane,
  x: number,
  y: number,
  z: number,
  out: Float64Array | number[],
  o = 0,
): void {
  const k = mp.localAxis;
  if (k !== -1) {
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    out[o + k] = 0 - (k === 0 ? x : k === 1 ? y : z);
    return;
  }
  const d2 = 2 * (mp.n[0] * x + mp.n[1] * y + mp.n[2] * z);
  out[o] = x - d2 * mp.g[0];
  out[o + 1] = y - d2 * mp.g[1];
  out[o + 2] = z - d2 * mp.g[2];
}

/** The in-plane projection of a local point (the midpoint of p and S(p)), into `out` at `o`. */
export function projectOntoPlane(
  mp: MirrorPlane,
  x: number,
  y: number,
  z: number,
  out: Float64Array | number[],
  o = 0,
): void {
  const k = mp.localAxis;
  if (k !== -1) {
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    out[o + k] = mp.offset;
    return;
  }
  const d = planeDistance(mp, x, y, z);
  out[o] = x - d * mp.g[0];
  out[o + 1] = y - d * mp.g[1];
  out[o + 2] = z - d * mp.g[2];
}

/** The layer a mirrored value goes to: its `_L`/`_R` partner by name when it exists (B1's rule for point layers). */
function targetLayer(m: EditMesh, layer: AttrLayer): AttrLayer {
  if (layer.def.mirror !== 'swap-side' && !layer.def.name.startsWith('morph:')) return layer;
  const partner = mirrorName(layer.def.name);
  if (partner === null) return layer;
  const other = m.layer(partner);
  return other !== undefined && other.def.domain === layer.def.domain && other.def.comps === layer.def.comps
    ? other
    : layer;
}

const LAYER_VALUE = new Float64Array(16);

/**
 * §5.2 mirroring a vertex's point layers from `src` to `dst` through the mirror: B1's rules (`_L`/`_R` swaps, joint
 * pairs, group sides), with 'negate-axis' vectors (morph deltas) reflected by the linear part of S — the B1 helper's
 * axis negation when the reflection runs along a local axis, the full reflection when it is oblique (World mode on a
 * rotated mesh).
 */
export function mirrorPointLayers(m: EditMesh, mp: MirrorPlane, src: number, dst: number): void {
  const k = mp.localAxis;
  mirrorPointAttributes(m, src, dst, k === 0 ? 'x' : k === 1 ? 'y' : k === 2 ? 'z' : mp.axis);
  if (k !== -1 || src === dst) return;
  for (const layer of m.layers()) {
    const def = layer.def;
    if (def.domain !== 'point' || def.mirror !== 'negate-axis' || def.type !== 'f32' || def.comps < 3) continue;
    layer.read(src, LAYER_VALUE);
    reflectVector(mp, LAYER_VALUE[0] as number, LAYER_VALUE[1] as number, LAYER_VALUE[2] as number, LAYER_VALUE);
    const target = targetLayer(m, layer);
    for (let c = 0; c < 3; c++) target.set(dst, c, (LAYER_VALUE[c] as number) + 0);
  }
}

/**
 * §5.2 mirroring a corner's layers from `src` to `dst` through the mirror: B1's rules (U flipped with `flipUVs`),
 * with 'negate-axis' normals (`normal.custom`) reflected by the inverse transpose of S's linear part and renormalized
 * when the reflection is oblique (an all-zero "no custom normal" stays zero).
 */
export function mirrorCornerLayers(
  m: EditMesh,
  mp: MirrorPlane,
  src: number,
  dst: number,
  opts: { readonly flipUVs?: boolean } = {},
): void {
  const k = mp.localAxis;
  mirrorCornerAttributes(m, src, dst, k === 0 ? 'x' : k === 1 ? 'y' : k === 2 ? 'z' : mp.axis, opts);
  if (k !== -1 || src === dst) return;
  for (const layer of m.layers()) {
    const def = layer.def;
    if (def.domain !== 'corner' || def.mirror !== 'negate-axis' || def.type !== 'f32' || def.comps < 3) continue;
    layer.read(src, LAYER_VALUE);
    const x = LAYER_VALUE[0] as number;
    const y = LAYER_VALUE[1] as number;
    const z = LAYER_VALUE[2] as number;
    // (S's linear part L = I − 2·g·nᵀ is an involution, so L⁻ᵀ = Lᵀ = I − 2·n·gᵀ.)
    const d2 = 2 * (mp.g[0] * x + mp.g[1] * y + mp.g[2] * z);
    let a = x - d2 * mp.n[0];
    let b = y - d2 * mp.n[1];
    let c = z - d2 * mp.n[2];
    const len = Math.hypot(a, b, c);
    if (len > 0 && Number.isFinite(len)) {
      a /= len;
      b /= len;
      c /= len;
    } else [a, b, c] = [0, 0, 0];
    layer.set(dst, 0, a + 0);
    layer.set(dst, 1, b + 0);
    layer.set(dst, 2, c + 0);
  }
}

function partnerArray(map: SymmetryMap, kind: ComponentKind): Int32Array {
  return kind === 'vertex' ? map.vertex : kind === 'edge' ? map.edge : map.face;
}

/** The partner of a component (−1 none; itself on the seam). */
export function partnerOf(map: SymmetryMap, kind: ComponentKind, i: number): number {
  const array = partnerArray(map, kind);
  return i >= 0 && i < array.length ? (array[i] as number) : -1;
}

/** §5.14 unmatched partners: the warning every op attaches when selected components had no mirror partner. */
export function unmatchedWarning(count: number, elements?: ArrayLike<number>): OpWarning {
  return {
    code: 'symmetry.unmatched-partner',
    message: 'No mirror partner: applied to one side',
    count,
    ...(elements !== undefined ? { elements: Uint32Array.from(elements) } : {}),
  };
}

/**
 * The unmatched-partner warning of an 'expand'-class run: the selected components of `sel.kind` whose partner is −1
 * (the runtime expanded the selection; these stayed on their own side). Null without symmetry or when all matched.
 */
export function expandWarnings(sel: ComponentSelection | null, ctx: OpContext): OpWarning[] {
  const map = ctx.symmetry?.map;
  if (map === undefined || sel === null) return [];
  const set = sel.kind === 'vertex' ? sel.verts : sel.kind === 'edge' ? sel.edges : sel.faces;
  const unmatched: number[] = [];
  set.forEach((i) => {
    if (partnerOf(map, sel.kind, i) === -1) unmatched.push(i);
  });
  return unmatched.length === 0 ? [] : [unmatchedWarning(unmatched.length, unmatched)];
}

/**
 * The selection plus every matched partner (§5.14 expansion for the pointer-class ops, which the runtime does not
 * expand), with the components that had none.
 */
export function expandWithPartners(
  sel: ComponentSelection,
  map: SymmetryMap,
): { readonly selection: ComponentSelection; readonly unmatched: number[] } {
  const verts = sel.verts.clone();
  const edges = sel.edges.clone();
  const faces = sel.faces.clone();
  const unmatched: number[] = [];
  const grow = (set: BitSet, kind: ComponentKind, track: boolean): void => {
    const add: number[] = [];
    set.forEach((i) => {
      const p = partnerOf(map, kind, i);
      if (p >= 0 && p < set.size) add.push(p);
      else if (track && p === -1) unmatched.push(i);
    });
    for (const p of add) set.add(p);
  };
  grow(verts, 'vertex', sel.kind === 'vertex');
  grow(edges, 'edge', sel.kind === 'edge');
  grow(faces, 'face', sel.kind === 'face');
  return { selection: { kind: sel.kind, verts, edges, faces, order: sel.order, active: sel.active }, unmatched };
}

/** The parameter where the plane crosses edge `e` (§5.14 `t*`), or null when it does not cross it. */
export function crossingT(m: EditMesh, mirror: MirrorPlane, e: number): number | null {
  const d0 = vertexSide(m, mirror, m.edgeVert(e, 0));
  const d1 = vertexSide(m, mirror, m.edgeVert(e, 1));
  if (d0 === d1) return null;
  const t = d0 / (d0 - d1);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * §5.14 pointer rule for a point `{edge, t}`: ordinary edges map to their partner (t or 1 − t by `edgeReversed`); a
 * crossing edge maps t ↦ 1 − t, and a point within tolerance (metres) of the plane is one point snapped onto the plane
 * at the crossing parameter t*; an in-seam edge maps t ↦ t and never snaps. Null when the edge has no partner. Same
 * contract as B2's `mirrorEdgePoint`.
 */
export function mirrorEdgePointOf(
  m: EditMesh,
  mirror: Mirror,
  p: { readonly edge: number; readonly t: number },
): { readonly edge: number; readonly t: number; readonly self: boolean } | null {
  const map = mirror.map;
  const partner = partnerOf(map, 'edge', p.edge);
  if (partner === -1) return null;
  const kind = map.edgeSelf[p.edge] ?? 0;
  if (kind === 2) return { edge: p.edge, t: p.t, self: true };
  if (kind === 1) {
    const d0 = vertexSide(m, mirror, m.edgeVert(p.edge, 0));
    const d1 = vertexSide(m, mirror, m.edgeVert(p.edge, 1));
    const d = d0 + (d1 - d0) * p.t;
    if (Math.abs(d) <= map.tolerance && d0 !== d1) return { edge: p.edge, t: d0 / (d0 - d1), self: true };
    return { edge: p.edge, t: 1 - p.t, self: false };
  }
  return { edge: partner, t: (map.edgeReversed[p.edge] ?? 0) === 1 ? 1 - p.t : p.t, self: false };
}

/**
 * Vertex partners by the §5.14 rule through `mirror` (reflect across the plane, the nearest vertex within `tolerance`
 * metres in an integer spatial hash, ties to the smaller index, mutual matches only; a vertex within tolerance of the
 * plane is its own partner). Symmetrize builds this when the mode is off or on another axis.
 */
export function vertexPartners(
  m: EditMesh,
  mirror: MirrorPlane,
  tolerance: number,
): { readonly partner: Int32Array; readonly unmatched: number } {
  const P = m.counts.points;
  const p = m.position;
  const tol = Math.max(tolerance, 1e-12);
  const [sx, sy, sz] = mirror.scale;
  // A world distance ≤ tol spans at most tol / minScale local units per axis: one cell.
  const cell = tol / mirror.minScale;
  const key = (x: number, y: number, z: number): string =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const buckets = new Map<string, number[]>();
  for (let v = 0; v < P; v++) {
    const id = key(p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
    const list = buckets.get(id);
    if (list === undefined) buckets.set(id, [v]);
    else list.push(v);
  }
  const nearest = new Int32Array(P).fill(-1);
  const q = [0, 0, 0];
  for (let v = 0; v < P; v++) {
    const x = p[3 * v] as number;
    const y = p[3 * v + 1] as number;
    const z = p[3 * v + 2] as number;
    if (Math.abs(planeDistance(mirror, x, y, z)) <= tol) {
      nearest[v] = v;
      continue;
    }
    reflectPoint(mirror, x, y, z, q);
    const cx = Math.floor((q[0] as number) / cell);
    const cy = Math.floor((q[1] as number) / cell);
    const cz = Math.floor((q[2] as number) / cell);
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (list === undefined) continue;
          for (const w of list) {
            if (w === v) continue;
            const ex = ((p[3 * w] as number) - (q[0] as number)) * sx;
            const ey = ((p[3 * w + 1] as number) - (q[1] as number)) * sy;
            const ez = ((p[3 * w + 2] as number) - (q[2] as number)) * sz;
            const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
            if (d > tol) continue;
            if (d < bestD || (d === bestD && w < best)) {
              best = w;
              bestD = d;
            }
          }
        }
      }
    }
    nearest[v] = best;
  }
  const partner = new Int32Array(P).fill(-1);
  let unmatched = 0;
  for (let v = 0; v < P; v++) {
    const w = nearest[v] as number;
    if (w === v) partner[v] = v;
    else if (w >= 0 && nearest[w] === v) partner[v] = w;
    else unmatched++;
  }
  return { partner, unmatched };
}
