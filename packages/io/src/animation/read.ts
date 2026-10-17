// WP-4 stub: final signature (MVP-SPEC §7 WP-4); throws until the animation reader lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { RawClip, SkeletonDesc } from '@ekza-animator/rig';
import type { GlbContainer } from '../types';

/** Throws EkzaError('compressed-animation') for meshopt/Draco-compressed animation data. */
export function readAnimations(_c: GlbContainer, _skeleton: SkeletonDesc): RawClip[] {
  throw new EkzaError('not-implemented', 'io.readAnimations');
}
