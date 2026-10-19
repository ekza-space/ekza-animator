// The kernel side of §5.14 for B5's `expand` ops (bevel, the UV projections): the selection an op runs on and the
// unmatched-partner warning. The runtime already hands `expand` ops the expanded selection (B7); expanding again here
// is idempotent (a partner's partner is the component itself) and lets the op run the same way when it is called
// directly (tests, scripts). Unmatched components (partner −1) stay on their own side and are counted.
import type { BitSet } from '../../bitset';
import { kernelError } from '../../kernel';
import type { ComponentKind, ComponentSelection, HiddenSet, OpWarning, SymmetryMap } from '../../types';

function expandBits(bits: BitSet, partner: Int32Array): BitSet {
  const out = bits.clone();
  bits.forEach((i) => {
    const p = i < partner.length ? (partner[i] as number) : -1;
    if (p >= 0 && p < out.size) out.add(p);
  });
  return out;
}

/** `sel` plus every matched partner (§4.3 `expandSelection` semantics); components with partner −1 stay as they are. */
export function expandForOp(sel: ComponentSelection, map: SymmetryMap): ComponentSelection {
  if (!(map.vertex instanceof Int32Array)) throw kernelError('invalid-argument', 'symmetry map without partners');
  return {
    kind: sel.kind,
    verts: expandBits(sel.verts, map.vertex),
    edges: expandBits(sel.edges, map.edge),
    faces: expandBits(sel.faces, map.face),
    order: sel.order,
    active: sel.active,
  };
}

/** The `symmetry.unmatched-partner` warning for the components of `kind` in `sel` without a partner, or null. */
export function unmatchedWarning(sel: ComponentSelection, kind: ComponentKind, map: SymmetryMap): OpWarning | null {
  const bits = kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
  const partner = kind === 'vertex' ? map.vertex : kind === 'edge' ? map.edge : map.face;
  const lonely: number[] = [];
  bits.forEach((i) => {
    if (i >= partner.length || (partner[i] as number) < 0) lonely.push(i);
  });
  if (lonely.length === 0) return null;
  return {
    code: 'symmetry.unmatched-partner',
    message: 'No mirror partner: applied to one side',
    count: lonely.length,
    elements: Uint32Array.from(lonely),
  };
}

/** True when component `i` of `kind` is hidden. */
export function isHidden(hidden: HiddenSet | null, kind: ComponentKind, i: number): boolean {
  if (hidden === null) return false;
  const bits = kind === 'vertex' ? hidden.verts : kind === 'edge' ? hidden.edges : hidden.faces;
  return bits.has(i);
}
