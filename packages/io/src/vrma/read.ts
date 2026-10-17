// WP-4 stub: final signature (MVP-SPEC §7 WP-4, §4.11.7); throws until the VRMA reader lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { HumanoidClipData } from '@ekza-animator/rig';
import type { GlbContainer } from '../types';

export function readVrma(_c: GlbContainer): HumanoidClipData {
  throw new EkzaError('not-implemented', 'io.readVrma');
}
