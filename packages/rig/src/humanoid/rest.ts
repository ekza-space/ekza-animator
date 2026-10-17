// WP-3 stubs: final signatures (MVP-SPEC §7 WP-3); bodies throw until the humanoid helpers land.
import { EkzaError, type ReadonlyVec3 } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import type { SkeletonDesc } from '../types';

/** Canonical (+Z) rest WORLD positions of the humanoid bones (VRMA writer derives parent-relative offsets). */
export function humanoidRestWorldPositions(
  _skeleton: SkeletonDesc,
): Readonly<Partial<Record<HumanBoneName, ReadonlyVec3>>> {
  throw new EkzaError('not-implemented', 'rig.humanoidRestWorldPositions');
}

/** vrm0 three-vrm mapping (§4.11.9). */
export function flipYawHumanLocal(_humanLocal: Float64Array, _out: Float64Array): void {
  throw new EkzaError('not-implemented', 'rig.flipYawHumanLocal');
}
