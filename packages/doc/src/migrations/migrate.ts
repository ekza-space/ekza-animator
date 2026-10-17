// WP-2 stubs: final signatures (MVP-SPEC §7 WP-2); bodies throw until migrations land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { DocSnapshot } from '../store';

export function migrateSnapshot(_raw: unknown): {
  readonly snapshot: DocSnapshot;
  readonly migratedFrom: number;
  readonly readOnly: boolean;
} {
  throw new EkzaError('not-implemented', 'doc.migrateSnapshot');
}

/** hash(oldId + ':' + purpose), same prefix. */
export function deriveMigratedId(_oldId: string, _purpose: string): string {
  throw new EkzaError('not-implemented', 'doc.deriveMigratedId');
}
