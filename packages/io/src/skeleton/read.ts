// WP-4 stub: final signature (MVP-SPEC §7 WP-4); throws until skeleton extraction lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { SkeletonDesc } from '@ekza-animator/rig';
import type { GlbContainer } from '../types';

export function skeletonFromGltf(_c: GlbContainer): SkeletonDesc {
  throw new EkzaError('not-implemented', 'io.skeletonFromGltf');
}
