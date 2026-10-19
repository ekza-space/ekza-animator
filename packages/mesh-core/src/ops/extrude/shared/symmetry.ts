// Symmetry on the op side (M6A-SPEC §5.14, B3 rows): the reflection of a `SymmetryMap` in mesh-local coordinates,
// selection expansion, the pointer rule for `{edge, t}` points, the unmatched-partner warning and the seam
// symmetrization of new vertices. The maps themselves are B2's (`buildSymmetryMap`); these helpers read only the
// map's arrays, so a B3 op runs symmetric with any map (tests build reference maps; the runtime passes B2's).
// `expandIndices` and `mirrorPoint` follow §5.14 exactly as `expandSelection`/`mirrorEdgePoint` define them (a gated
// test cross-checks them against B2's functions once `READY.b2`).
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import { KERNEL_MARKER } from '../../../kernel';
import type { ComponentKind, EditMesh, OpWarning, SymmetryContext, SymmetryMap } from '../../../types';
import type { Affine } from './affine';
import { type V3, pos } from './util';

/** The reflection of a symmetry map in mesh-local coordinates: `p ↦ M·p + b` (an involution). */
export class Mirror {
  readonly map: SymmetryMap;
  readonly preserveSeam: boolean;
  /** Row-major 3×3 linear part and translation. */
  private readonly lin: Float64Array;
  private readonly off: Float64Array;
  /** Plane: `g·p + h` = signed distance in world (object: local) metres. */
  private readonly g: V3;
  private readonly h: number;

  constructor(ctx: SymmetryContext, placement: ReadonlyXf) {
    this.map = ctx.map;
    this.preserveSeam = ctx.preserveSeam;
    const k = ctx.map.axis === 'x' ? 0 : ctx.map.axis === 'y' ? 1 : 2;
    this.lin = new Float64Array(9);
    this.off = new Float64Array(3);
    if (ctx.map.space === 'object') {
      for (let i = 0; i < 3; i++) this.lin[4 * i] = i === k ? -1 : 1;
      this.off[k] = 2 * ctx.map.plane;
      const g: V3 = [0, 0, 0];
      g[k] = 1;
      this.g = g;
      this.h = -ctx.map.plane;
      return;
    }
    // World: L(p) = t + Q·S·p; the world plane x_k = 0 maps to local as L⁻¹ ∘ S_w ∘ L.
    const [qx, qy, qz, qw] = placement.q;
    const R = [
      1 - 2 * (qy * qy + qz * qz),
      2 * (qx * qy - qz * qw),
      2 * (qx * qz + qy * qw),
      2 * (qx * qy + qz * qw),
      1 - 2 * (qx * qx + qz * qz),
      2 * (qy * qz - qx * qw),
      2 * (qx * qz - qy * qw),
      2 * (qy * qz + qx * qw),
      1 - 2 * (qx * qx + qy * qy),
    ];
    const s = placement.s;
    const t = placement.t;
    const A = (r: number, c: number): number => (R[3 * r + c] as number) * (s[c] as number); // Q·S
    const invS = (i: number): number => ((s[i] as number) === 0 ? 0 : 1 / (s[i] as number));
    // M = S⁻¹ Qᵀ S_w Q S; b = S⁻¹ Qᵀ (S_w t − t) = S⁻¹ Qᵀ (−2 t_k e_k).
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = 0; i < 3; i++) acc += (R[3 * i + r] as number) * (i === k ? -1 : 1) * A(i, c);
        this.lin[3 * r + c] = invS(r) * acc;
      }
      this.off[r] = invS(r) * (R[3 * k + r] as number) * -2 * t[k];
    }
    this.g = [A(k, 0), A(k, 1), A(k, 2)];
    this.h = t[k];
  }

  reflect(p: Readonly<V3>): V3 {
    const l = this.lin;
    const o = this.off;
    return [
      (l[0] as number) * p[0] + (l[1] as number) * p[1] + (l[2] as number) * p[2] + (o[0] as number),
      (l[3] as number) * p[0] + (l[4] as number) * p[1] + (l[5] as number) * p[2] + (o[1] as number),
      (l[6] as number) * p[0] + (l[7] as number) * p[1] + (l[8] as number) * p[2] + (o[2] as number),
    ];
  }

  /** The reflection as an affine map. */
  affine(): Affine {
    return { m: [...this.lin], t: [this.off[0] as number, this.off[1] as number, this.off[2] as number] };
  }

  /** Reflects a direction (the linear part only). */
  reflectDir(d: Readonly<V3>): V3 {
    const l = this.lin;
    return [
      (l[0] as number) * d[0] + (l[1] as number) * d[1] + (l[2] as number) * d[2],
      (l[3] as number) * d[0] + (l[4] as number) * d[1] + (l[5] as number) * d[2],
      (l[6] as number) * d[0] + (l[7] as number) * d[1] + (l[8] as number) * d[2],
    ];
  }

  /** Signed distance of `p` from the mirror plane (metres; object space: mesh-local units). */
  distance(p: Readonly<V3>): number {
    return this.g[0] * p[0] + this.g[1] * p[1] + this.g[2] * p[2] + this.h;
  }

  /** The point of the plane between `p` and its reflection (the seam projection, §5.14). */
  project(p: Readonly<V3>): V3 {
    const r = this.reflect(p);
    return [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2, (p[2] + r[2]) / 2];
  }

  /** The symmetrized pair (§5.14 seam rule): q = mean(p, S·p′); its partner gets S·q. */
  symmetrize(p: Readonly<V3>, partner: Readonly<V3>): V3 {
    const r = this.reflect(partner);
    return [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2, (p[2] + r[2]) / 2];
  }

  /** The crossing parameter t* of edge (a, b): where the plane cuts it (null when it does not). */
  crossing(a: Readonly<V3>, b: Readonly<V3>): number | null {
    const da = this.distance(a);
    const db = this.distance(b);
    if (da === db) return null;
    const t = da / (da - db);
    return t >= 0 && t <= 1 ? t : null;
  }

  partner(kind: ComponentKind, i: number): number {
    const array = kind === 'vertex' ? this.map.vertex : kind === 'edge' ? this.map.edge : this.map.face;
    return i >= 0 && i < array.length ? (array[i] as number) : -1;
  }
}

export function mirrorOf(ctx: {
  readonly symmetry: SymmetryContext | null;
  readonly placement: ReadonlyXf;
}): Mirror | null {
  return ctx.symmetry === null ? null : new Mirror(ctx.symmetry, ctx.placement);
}

/**
 * `indices` plus every matched partner (§5.14 `expandSelection`): components with partner −1 stay as they are and
 * are counted as unmatched (self-partners on the seam are matched).
 */
export function expandIndices(
  mirror: Mirror | null,
  kind: ComponentKind,
  indices: readonly number[],
): { readonly indices: number[]; readonly unmatched: number } {
  if (mirror === null) return { indices: [...indices], unmatched: 0 };
  const out = new Set(indices);
  let unmatched = 0;
  for (const i of indices) {
    const p = mirror.partner(kind, i);
    if (p === -1) unmatched++;
    else out.add(p);
  }
  return { indices: [...out].sort((a, b) => a - b), unmatched };
}

/** The `symmetry.unmatched-partner` warning (§5.14) for `count` components, or none. */
export function unmatchedWarnings(count: number): OpWarning[] {
  if (!(count > 0)) return [];
  return [
    {
      code: 'symmetry.unmatched-partner',
      message: 'No mirror partner: applied to one side',
      count,
    },
  ];
}

/**
 * §5.14 pointer rule for a point `{edge, t}` (t from `edgeVert(edge, 0)`): an ordinary edge maps to its partner at t
 * (same orientation) or 1 − t (reversed); a crossing edge maps t ↦ 1 − t and a point within tolerance of the plane is
 * one point, snapped to the crossing parameter t*; an in-seam edge maps t ↦ t (one point, never snapped). Null: no
 * partner edge.
 */
export function mirrorPoint(
  m: EditMesh,
  mirror: Mirror,
  p: { readonly edge: number; readonly t: number },
): { readonly edge: number; readonly t: number; readonly self: boolean } | null {
  const map = mirror.map;
  const partner = p.edge >= 0 && p.edge < map.edge.length ? (map.edge[p.edge] as number) : -1;
  if (partner === -1) return null;
  if (partner !== p.edge) {
    const reversed = (map.edgeReversed[p.edge] as number) === 1;
    return { edge: partner, t: reversed ? 1 - p.t : p.t, self: false };
  }
  const kind = map.edgeSelf[p.edge] as number;
  if (kind === 2) return { edge: p.edge, t: p.t, self: true };
  const a = pos(m, m.edgeVert(p.edge, 0));
  const b = pos(m, m.edgeVert(p.edge, 1));
  const point: V3 = [a[0] + (b[0] - a[0]) * p.t, a[1] + (b[1] - a[1]) * p.t, a[2] + (b[2] - a[2]) * p.t];
  if (Math.abs(mirror.distance(point)) <= map.tolerance) {
    const star = mirror.crossing(a, b);
    return { edge: p.edge, t: star ?? p.t, self: true };
  }
  return { edge: p.edge, t: 1 - p.t, self: false };
}

/** True when the marker is linked (keeps every symmetry entry in the kernel chunk's module graph). */
export const SYMMETRY_KERNEL = KERNEL_MARKER;
