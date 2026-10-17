// WP-0b stub: final signature (MVP-SPEC §7 WP-8); throws until the shared test kit lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { PanelRegistry } from './types';

export function createPanelRegistry(): PanelRegistry {
  throw new EkzaError('not-implemented', 'editor.createPanelRegistry');
}
