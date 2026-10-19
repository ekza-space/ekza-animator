// The mirrored partners a symmetry expansion adds to a selection (M6A-SPEC §5.6 "expanded minus stored"), for
// `EditMeshView.setState(…, mirrored)` and the hover partner. A view-side helper over `SymmetryMap`'s partner arrays,
// so hosts do not need the kernel's `expandSelection` to draw; it agrees with it by construction (partner −1 = none,
// self = on the seam).
import { BitSet, type ComponentKind, type ComponentSelection, type SymmetryMap } from '@ekza-animator/mesh-core';

function partners(map: SymmetryMap, kind: ComponentKind): Int32Array {
  return kind === 'vertex' ? map.vertex : kind === 'edge' ? map.edge : map.face;
}

/**
 * The partners of `sel`'s components of every kind that are not themselves selected (null when none, or when the map
 * does not match the selection's sizes).
 */
export function mirroredOf(sel: ComponentSelection, map: SymmetryMap | null): ComponentSelection | null {
  if (map === null) return null;
  const kinds: readonly [ComponentKind, BitSet][] = [
    ['vertex', sel.verts],
    ['edge', sel.edges],
    ['face', sel.faces],
  ];
  const out: BitSet[] = [];
  let any = false;
  for (const [kind, set] of kinds) {
    const p = partners(map, kind);
    const mirrored = new BitSet(set.size);
    if (p.length !== set.size) return null;
    set.forEach((i) => {
      const partner = p[i] as number;
      if (partner >= 0 && partner !== i && !set.has(partner)) {
        mirrored.add(partner);
        any = true;
      }
    });
    out.push(mirrored);
  }
  if (!any) return null;
  return {
    kind: sel.kind,
    verts: out[0] as BitSet,
    edges: out[1] as BitSet,
    faces: out[2] as BitSet,
    order: null,
    active: -1,
  };
}

/** The partner of one component (−1 none or on the seam itself), for `setState`'s hover partner. */
export function partnerOf(map: SymmetryMap | null, kind: ComponentKind, index: number): number {
  if (map === null || index < 0) return -1;
  const p = partners(map, kind)[index];
  return p === undefined || p === index ? -1 : p;
}
