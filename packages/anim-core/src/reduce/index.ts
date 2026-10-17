// WP-1 stub: final signature (MVP-SPEC §7 WP-1); throws until key reduction lands.
import { EkzaError } from '../errors';
import type { AnimCurve, ReduceOptions, ReduceResult } from '../types';

export function reduceKeys(_curve: AnimCurve, _opts: ReduceOptions): ReduceResult {
  throw new EkzaError('not-implemented', 'anim-core.reduceKeys');
}
