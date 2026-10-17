// WP-2 stub: final signature (MVP-SPEC §7 WP-2); throws until fractional indexing lands.
import { EkzaError } from '@ekza-animator/anim-core';

export function fractionalIndex(_before: string | null, _after: string | null): string {
  throw new EkzaError('not-implemented', 'doc.fractionalIndex');
}
