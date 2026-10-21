// C4 (auto-skin; M6B-SPEC §4.2, §5.9): the skin pipeline's geometry. C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { EditMesh, MeshData } from '../../types';
import type { SkinGeometry } from '../types';

/** The partner map is **fixed and session-independent**: `buildSymmetryMap(edit, {axis: 'x', space: 'object',
 *  placement: identity, tolerance: 1e-4·height})` (M6a B2), cached per revision manifest. It never reads a user's
 *  Model symmetry settings or `MeshRuntime.symmetry()`, so the same args give the same weights for every user, after
 *  a reload and on adjust-last (P-S4, P-S5, M3 replay). */
export function skinGeometryOf(_m: MeshData | EditMesh, _height: number): SkinGeometry {
  throw new EkzaError('not-implemented', 'mesh-core.skinGeometryOf');
}
