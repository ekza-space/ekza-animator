// WP-2 stubs: final signatures (MVP-SPEC §7 WP-2); bodies throw until snapshots land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { DocSnapshot } from '../store';

/** Core document format version written by this build. */
export const SCHEMA_VERSION = 1;

export function emptySnapshot(_projectName?: string): DocSnapshot {
  throw new EkzaError('not-implemented', 'doc.emptySnapshot');
}

/** Sorted keys, deterministic. */
export function serializeSnapshot(_snapshot: DocSnapshot): string {
  throw new EkzaError('not-implemented', 'doc.serializeSnapshot');
}

export function parseSnapshot(_text: string): unknown {
  throw new EkzaError('not-implemented', 'doc.parseSnapshot');
}
