// WP-1 stub: final signature (MVP-SPEC §7 WP-1); throws until the curve-level Euler filter lands.
import { EkzaError } from '../errors';
import type { AnimCurve, KeyData, RotateOrder } from '../types';

export function eulerFilterCurves(
  _curves: readonly [AnimCurve, AnimCurve, AnimCurve],
  _order: RotateOrder,
): [KeyData[], KeyData[], KeyData[]] {
  throw new EkzaError('not-implemented', 'anim-core.eulerFilterCurves');
}
