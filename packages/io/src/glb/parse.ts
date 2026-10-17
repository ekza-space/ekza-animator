// WP-4 stubs: final signatures (MVP-SPEC §7 WP-4); bodies throw until the GLB container lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { GlbContainer } from '../types';

export function sha256Hex(_bytes: Uint8Array): Promise<string> {
  throw new EkzaError('not-implemented', 'io.sha256Hex');
}

/** Throws EkzaError('not-glb'). */
export function parseGlb(_bytes: Uint8Array): Promise<GlbContainer> {
  throw new EkzaError('not-implemented', 'io.parseGlb');
}
