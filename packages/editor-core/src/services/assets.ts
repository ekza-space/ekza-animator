// WP-7a stub: final signature (MVP-SPEC §7 WP-7a); throws until the memory asset store lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetStore } from '../types';

export function createMemoryAssetStore(): AssetStore {
  throw new EkzaError('not-implemented', 'editor-core.createMemoryAssetStore');
}
