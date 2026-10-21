// C5 (weights kernel; deferred after the MVP, M6B-SPEC §0.3): joint removal folds (§5.4). C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { SkinWeights } from '../types';

/** Joint removal: weights of `removed` keys fold onto `survivorOf(key)` — the nearest surviving **deforming** ancestor,
 *  else the nearest surviving ancestor — renormalized (§5.4). */
export function foldJoints(
  _skin: SkinWeights,
  _removed: ReadonlySet<string>,
  _survivorOf: (key: string) => string | null,
): SkinWeights {
  throw new EkzaError('not-implemented', 'mesh-core.foldJoints');
}
