// WP-3 stub (M1-stretch): final signature (MVP-SPEC §7 WP-3, §4.11.5); throws until it lands.
import { type AnimCurve, EkzaError, type KeyData, type RotateOrder } from '@ekza-animator/anim-core';

export function convertRotateOrderKeys(
  _curves: readonly [AnimCurve, AnimCurve, AnimCurve],
  _from: RotateOrder,
  _to: RotateOrder,
): [KeyData[], KeyData[], KeyData[]] {
  throw new EkzaError('not-implemented', 'rig.convertRotateOrderKeys');
}
