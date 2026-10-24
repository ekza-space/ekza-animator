// Clip provenance at import (MVP-SPEC §4.11.6 step 7, ADR 0010 §3): embedded clips of a VRM inherit its licence
// meta, names that carry a web auto-rigging service's marker are never redistributable, sources without licence data
// are 'unknown', and bundled samples pass their known licence.
import type { ClipProvenance, DerivedFrom } from '@ekza-studio/doc';
import type { VrmLicenseInfo } from '../types';

/**
 * The marker a web auto-rigging service writes into clip and node names (`<marker>.com` clips, `<marker>rig:*` bones);
 * its terms forbid redistributing those motions as standalone files. This pattern is the only spelling of the
 * service's name in the source tree (DECISIONS-OPEN TM-1): it matches third-party data, it does not refer to the
 * product. Tests build their sample names from `NON_REDISTRIBUTABLE_NAME.source`.
 */
export const NON_REDISTRIBUTABLE_NAME = /mixamo/i;

/** True when any name carries the auto-rigging service's marker (not redistributable as a standalone animation). */
export function isNonRedistributableSource(names: Iterable<string>): boolean {
  for (const name of names) if (NON_REDISTRIBUTABLE_NAME.test(name)) return true;
  return false;
}

export function importProvenance(
  license: VrmLicenseInfo | null,
  opts: {
    /** SHA-256 of the source file (DerivedFrom.sourceSha256). */
    readonly sourceSha256: string | null;
    /** Clip and node names of the source; a name with the auto-rigging service's marker forces redistributable 'no'. */
    readonly names: readonly string[];
    /** Known licence of a bundled sample (e.g. Quaternius UAL, CC0-1.0). */
    readonly known?: Omit<DerivedFrom, 'sourceSha256'> | null;
  },
): ClipProvenance {
  const restricted = isNonRedistributableSource(opts.names);
  const sha = opts.sourceSha256?.toLowerCase() ?? null;
  if (opts.known !== undefined && opts.known !== null) {
    const derived: DerivedFrom = {
      title: opts.known.title,
      author: opts.known.author,
      license: opts.known.license,
      sourceSha256: sha,
    };
    return { derivedFrom: [derived], redistributable: restricted ? 'no' : 'yes' };
  }
  if (license === null) return { derivedFrom: [], redistributable: restricted ? 'no' : 'unknown' };
  const derived: DerivedFrom = {
    title: license.title ?? 'Untitled',
    author: license.authors.length > 0 ? license.authors.join(', ') : 'unknown',
    license: license.licenseName ?? 'unknown',
    sourceSha256: sha,
  };
  const redistributable =
    restricted || license.allowRedistribution === false
      ? 'no'
      : license.allowRedistribution === true
        ? 'yes'
        : 'unknown';
  return { derivedFrom: [derived], redistributable };
}
