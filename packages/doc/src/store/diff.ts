// WP-2 stubs: final signatures (MVP-SPEC §7 WP-2); bodies throw until the store lands.
import { EkzaError } from '@ekza-animator/anim-core';

export function deepEqual(_a: unknown, _b: unknown): boolean {
  throw new EkzaError('not-implemented', 'doc.deepEqual');
}

export function diffFields(_before: object, _after: object): readonly string[] {
  throw new EkzaError('not-implemented', 'doc.diffFields');
}
