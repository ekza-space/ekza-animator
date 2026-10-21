// C4 (auto-skin; M6B-SPEC §4.2): the shared sparse kit (C5 reuses it). C0 stubs.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CsrMatrix, SkinGeometry } from '../types';

/** The positive semi-definite cotangent Laplacian Lpsd = −Δ (see `CsrMatrix`). */
export function cotLaplacian(_geom: SkinGeometry, _opts: { readonly clamp: boolean }): CsrMatrix {
  throw new EkzaError('not-implemented', 'mesh-core.cotLaplacian');
}

/** Voronoi areas per point. */
export function lumpedMass(_geom: SkinGeometry): Float64Array {
  throw new EkzaError('not-implemented', 'mesh-core.lumpedMass');
}
