// WP-1 stubs: final signatures (MVP-SPEC §7 WP-1); bodies throw until the control-shape library lands.
import { EkzaError } from '../errors';
import type { ControlShapeKind, Disposer, SplineSet } from '../types';

/** Built-in shapes are always available; extensions add more. Unit size; planar shapes in XY (normal +Z). */
export function getControlShape(_kind: ControlShapeKind): SplineSet | undefined {
  throw new EkzaError('not-implemented', 'anim-core.getControlShape');
}

export function registerControlShape(_kind: ControlShapeKind, _shape: SplineSet): Disposer {
  throw new EkzaError('not-implemented', 'anim-core.registerControlShape');
}

export function listControlShapes(): readonly ControlShapeKind[] {
  throw new EkzaError('not-implemented', 'anim-core.listControlShapes');
}

/** xyz pairs for LineSegments. */
export function tessellateSplineSet(_s: SplineSet, _segmentsPerSpan?: number): Float32Array {
  throw new EkzaError('not-implemented', 'anim-core.tessellateSplineSet');
}
