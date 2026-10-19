// B0a stubs of B2's symmetry maps (M6A-SPEC §4.3, §5.14): throw until B2 lands `src/symmetry/**`.
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import { notImplemented } from '../kernel';
import type { ComponentSelection, EditMesh, SymmetryAxis, SymmetryMap } from '../types';

export function buildSymmetryMap(
  _m: EditMesh,
  _opts: {
    readonly axis: SymmetryAxis;
    readonly space: 'object' | 'world';
    readonly placement: ReadonlyXf;
    readonly tolerance: number;
  },
): SymmetryMap {
  throw notImplemented('buildSymmetryMap');
}
/** Adds every matched partner; components with partner −1 stay as they are (one side only, §5.14). */
export function expandSelection(_sel: ComponentSelection, _map: SymmetryMap): ComponentSelection {
  throw notImplemented('expandSelection');
}
/** §5.14 pointer rule (crossing edges map t ↦ 1 − t and snap near the plane; in-seam edges map t ↦ t). */
export function mirrorEdgePoint(
  _m: EditMesh,
  _map: SymmetryMap,
  _p: { readonly edge: number; readonly t: number },
): { readonly edge: number; readonly t: number; readonly self: boolean } | null {
  throw notImplemented('mirrorEdgePoint');
}
