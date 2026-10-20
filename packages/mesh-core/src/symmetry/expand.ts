// Mirrored selection (M6A-SPEC §5.6, §5.14): the stored selection holds the picks; ops, walkers and the HUD use the
// expanded set — the picks plus their matched partners in every kind. Components whose partner is −1 stay one-sided.
// The unmatched-partner helpers give every op the same `symmetry.unmatched-partner` warning.
import { BitSet } from '../bitset';
import { kernelError } from '../kernel';
import type { ComponentKind, ComponentSelection, OpWarning, SymmetryMap } from '../types';

function expandSet(set: BitSet, partners: Int32Array): BitSet {
  const out = set.clone();
  const n = Math.min(set.size, partners.length);
  set.forEach((i) => {
    if (i >= n) return;
    const p = partners[i] as number;
    if (p >= 0 && p < out.size) out.add(p);
  });
  return out;
}

/** Adds every matched partner; components with partner −1 stay as they are (one side only, §5.14). */
export function expandSelection(sel: ComponentSelection, map: SymmetryMap): ComponentSelection {
  return Object.freeze({
    kind: sel.kind,
    verts: expandSet(sel.verts, map.vertex),
    edges: expandSet(sel.edges, map.edge),
    faces: expandSet(sel.faces, map.face),
    order: sel.order === null ? null : sel.order.slice(),
    active: sel.active,
  });
}

/** The partner array of a kind. */
export function partnersOf(map: SymmetryMap, kind: ComponentKind): Int32Array {
  if (kind === 'vertex') return map.vertex;
  if (kind === 'edge') return map.edge;
  if (kind === 'face') return map.face;
  throw kernelError('invalid-argument', `component kind must be vertex, edge or face, got ${String(kind)}`);
}

/**
 * Components of `kind` in `set` without a mirror partner (partner −1; seam vertices and self-partner edges and faces
 * are matched), ascending.
 */
export function unmatchedOf(set: BitSet, map: SymmetryMap, kind: ComponentKind): Uint32Array {
  const partners = partnersOf(map, kind);
  const out: number[] = [];
  set.forEach((i) => {
    if ((partners[i] ?? -1) < 0) out.push(i);
  });
  return Uint32Array.from(out);
}

/** The help-line sentence of the unmatched-partner warning (§5.14). */
export const UNMATCHED_PARTNER_MESSAGE = 'No mirror partner: applied to one side';

/**
 * The `symmetry.unmatched-partner` warning for elements processed on their own side only, or null when there are none.
 * Pass the unmatched elements (`unmatchedOf`) or just a count (pointer args such as weld pairs or cut points).
 */
export function unmatchedPartnerWarning(elements: Uint32Array | number): OpWarning | null {
  const count = typeof elements === 'number' ? elements : elements.length;
  if (count <= 0) return null;
  return Object.freeze({
    code: 'symmetry.unmatched-partner',
    message: UNMATCHED_PARTNER_MESSAGE,
    count,
    ...(typeof elements === 'number' ? {} : { elements }),
  });
}

/** Shorthand: the warning for the components of the selection's own kind that have no partner. */
export function selectionUnmatchedWarning(sel: ComponentSelection, map: SymmetryMap): OpWarning | null {
  const set = sel.kind === 'vertex' ? sel.verts : sel.kind === 'edge' ? sel.edges : sel.faces;
  return unmatchedPartnerWarning(unmatchedOf(set, map, sel.kind));
}

/** Empty bitsets sized like the map (a convenience for ops that build expanded sets themselves). */
export function emptySetFor(map: SymmetryMap, kind: ComponentKind): BitSet {
  return new BitSet(partnersOf(map, kind).length);
}
