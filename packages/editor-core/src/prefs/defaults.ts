// WP-7a stub: final signature (MVP-SPEC §7 WP-7a); throws until preferences land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { Prefs } from '../types';

export function defaultPrefs(_platform: 'mac' | 'other'): Prefs {
  throw new EkzaError('not-implemented', 'editor-core.defaultPrefs');
}
