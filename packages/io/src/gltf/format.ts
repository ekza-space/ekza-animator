// WP-4 stubs: final signatures (MVP-SPEC §7 WP-4); bodies throw until format detection lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ModelFormat } from '@ekza-animator/doc';
import type { GlbContainer, GltfJson, VrmLicenseInfo } from '../types';

/** Throws EkzaError('vrm-both'). */
export function detectModelFormat(_json: GltfJson): ModelFormat {
  throw new EkzaError('not-implemented', 'io.detectModelFormat');
}

export function readVrmLicense(_c: GlbContainer): VrmLicenseInfo | null {
  throw new EkzaError('not-implemented', 'io.readVrmLicense');
}
