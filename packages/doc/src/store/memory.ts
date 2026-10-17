// WP-2 stub: final signature (MVP-SPEC §7 WP-2); throws until the memory store lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { UserId } from '../ids';
import type { DocumentStore } from '../store';

export function createMemoryStore(_opts?: {
  readonly user?: UserId;
  readonly undoLimit?: number;
  readonly now?: () => number;
  readonly strictPut?: boolean;
}): DocumentStore {
  throw new EkzaError('not-implemented', 'doc.createMemoryStore');
}
