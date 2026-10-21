// Placing extruded geometry (M6A-SPEC §5.8 step 5, §5.14): every group (a face region or an edge chain) moves its
// new vertices with its own transform, a mirrored partner group with the conjugate of its source's transform (the
// reflected frame S·F: identical numbers give an exact mirror), and a group that is its own mirror is symmetrized
// afterwards (each vertex and its partner set to the mean of p and S·p(partner); seam vertices onto the plane).
// Division rings lie at i/n between the base and the placed cap (linear). The same function serves the first run and
// the `adjust` fast path, so both write bit-identical positions.
import type { ParamValue, ReadonlyXf } from '@ekza-studio/anim-core';
import type { EditMesh, OpFrame, OpWarning } from '../../types';
import { type CapData, capTransform, offsetAndThickness, opFrame } from './geometry';
import { type Affine, apply, compose } from './shared/affine';
import type { Mirror } from './shared/symmetry';
import { type V3, lerp3, num, setPos } from './shared/util';

/** How a group relates to the mirror (§5.14). */
export type GroupRole =
  | { readonly kind: 'own' }
  | { readonly kind: 'self' }
  | { readonly kind: 'source'; readonly partner: number }
  | { readonly kind: 'partner'; readonly source: number };

export interface PlacedVertex {
  /** The pre-op vertex it comes from (its base position is `data.p`). */
  readonly src: number;
  /** The vertex that moves to the cap. */
  readonly out: number;
  /** Division vertices base → cap. */
  readonly ring: readonly number[];
  readonly data: CapData;
  /** Identity of the vertex within its group and of its mirror partner (self-mirrored groups), or null. */
  readonly key: string;
  readonly partnerKey: string | null;
}

export interface PlaceGroup {
  readonly role: GroupRole;
  readonly frame: { readonly pivot: V3; readonly x: V3; readonly y: V3; readonly z: V3 };
  readonly verts: readonly PlacedVertex[];
  /** Edge chains ignore offset and thickness (§5.8 step 7: the local args apply). */
  readonly edges: boolean;
}

export interface Placement {
  readonly frame: OpFrame | null;
  readonly warnings: readonly OpWarning[];
}

/** Writes the positions of every group for `args`; returns the first group's frame and the clamp warning. */
export function placeGroups(
  m: EditMesh,
  groups: readonly PlaceGroup[],
  args: Readonly<Record<string, ParamValue>>,
  placement: ReadonlyXf,
  mirror: Mirror | null,
  clampCode: string,
): Placement {
  const offset = Math.max(0, num(args, 'offset'));
  const thickness = num(args, 'thickness');
  const transforms: Affine[] = groups.map((g) => capTransform(args, g.frame, placement));
  const reflect = mirror?.affine() ?? null;
  const effective = (index: number): Affine => {
    const group = groups[index] as PlaceGroup;
    if (group.role.kind === 'partner' && reflect !== null) {
      return compose(reflect, compose(transforms[group.role.source] as Affine, reflect));
    }
    return transforms[index] as Affine;
  };
  const clamped = { count: 0, max: 0 };
  let first: OpFrame | null = null;
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi] as PlaceGroup;
    const T = effective(gi);
    const placed = new Map<string, V3>();
    for (const vert of group.verts) {
      const q = group.edges ? vert.data.p : offsetAndThickness(vert.data, offset, thickness, clamped);
      placed.set(vert.key, apply(T, q));
    }
    if (group.role.kind === 'self' && mirror !== null) {
      const symmetric = new Map<string, V3>();
      for (const vert of group.verts) {
        const q = placed.get(vert.key) as V3;
        const partner = vert.partnerKey === null ? undefined : placed.get(vert.partnerKey);
        if (partner === undefined) symmetric.set(vert.key, q);
        else if (vert.partnerKey === vert.key) symmetric.set(vert.key, mirror.project(q));
        else symmetric.set(vert.key, mirror.symmetrize(q, partner));
      }
      for (const [key, value] of symmetric) placed.set(key, value);
    }
    for (const vert of group.verts) {
      const q = placed.get(vert.key) as V3;
      setPos(m, vert.out, q);
      const n = vert.ring.length + 1;
      for (let k = 0; k < vert.ring.length; k++) setPos(m, vert.ring[k] as number, lerp3(vert.data.p, q, (k + 1) / n));
    }
    // A partner group carries its source's reflected frame (§5.14 S·F).
    if (first === null) first = opFrame(group.frame, T, group.edges ? 0 : thickness);
  }
  const warnings: OpWarning[] = [];
  if (clamped.count > 0) {
    warnings.push({
      code: clampCode,
      message: `Offset clamped at ${clamped.count} vertex${clamped.count === 1 ? '' : 'es'} (by up to ${clamped.max.toFixed(3)} m)`,
      count: clamped.count,
    });
  }
  return { frame: first, warnings };
}

/**
 * §5.14 roles of component groups (face regions or edge chains, each sorted ascending): a group whose partner set is
 * itself is 'self'; two groups that are each other's partner set pair up, the one whose centroid lies on the positive
 * side of the plane (`side(i)`, ties: the smaller first component) is the 'source'; any component without a partner
 * leaves its group 'own' (processed on its own side, §5.14 unmatched partners).
 */
export function pairGroups(
  groups: readonly (readonly number[])[],
  kind: 'face' | 'edge',
  mirror: Mirror | null,
  side: (index: number) => number,
): GroupRole[] {
  const roles: GroupRole[] = groups.map(() => ({ kind: 'own' }));
  if (mirror === null) return roles;
  const keyOf = (list: readonly number[]): string => list.join(',');
  const byKey = new Map<string, number>();
  groups.forEach((g, i) => byKey.set(keyOf(g), i));
  for (let i = 0; i < groups.length; i++) {
    if (roles[i]?.kind !== 'own') continue;
    const g = groups[i] as readonly number[];
    const partners = g.map((c) => mirror.partner(kind, c));
    if (partners.some((p) => p === -1)) continue;
    const key = keyOf([...new Set(partners)].sort((a, b) => a - b));
    const j = byKey.get(key);
    if (j === undefined) continue;
    if (j === i) {
      roles[i] = { kind: 'self' };
      continue;
    }
    const si = side(i);
    const sj = side(j);
    const sourceIsI = si > sj || (si === sj && (g[0] as number) < ((groups[j] as readonly number[])[0] as number));
    const [s, p] = sourceIsI ? [i, j] : [j, i];
    roles[s] = { kind: 'source', partner: p };
    roles[p] = { kind: 'partner', source: s };
  }
  return roles;
}
