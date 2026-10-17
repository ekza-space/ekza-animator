// WP-7a stub: final signature (MVP-SPEC §7 WP-7a); throws until the session store lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { UserId } from '@ekza-animator/doc';
import type { SessionState } from '../types';

export function defaultSession(_user?: UserId): SessionState {
  throw new EkzaError('not-implemented', 'editor-core.defaultSession');
}
