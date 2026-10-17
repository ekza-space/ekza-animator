// Clip provenance at import (MVP-SPEC §4.11.6 step 7, ADR 0010 §3): embedded clips of a VRM inherit its licence
// meta, names matching /mixamo/i are never redistributable, sources without licence data are 'unknown', and bundled
// samples pass their known licence.
import type { ClipProvenance, DerivedFrom } from '@ekza-animator/doc';
import type { VrmLicenseInfo } from '../types';

const MIXAMO = /mixamo/i;

export function importProvenance(
  license: VrmLicenseInfo | null,
  opts: {
    /** SHA-256 of the source file (DerivedFrom.sourceSha256). */
    readonly sourceSha256: string | null;
    /** Clip and node names of the source; any match of /mixamo/i forces redistributable 'no'. */
    readonly names: readonly string[];
    /** Known licence of a bundled sample (e.g. Quaternius UAL, CC0-1.0). */
    readonly known?: Omit<DerivedFrom, 'sourceSha256'> | null;
  },
): ClipProvenance {
  const mixamo = opts.names.some((name) => MIXAMO.test(name));
  const sha = opts.sourceSha256?.toLowerCase() ?? null;
  if (opts.known !== undefined && opts.known !== null) {
    const derived: DerivedFrom = {
      title: opts.known.title,
      author: opts.known.author,
      license: opts.known.license,
      sourceSha256: sha,
    };
    return { derivedFrom: [derived], redistributable: mixamo ? 'no' : 'yes' };
  }
  if (license === null) return { derivedFrom: [], redistributable: mixamo ? 'no' : 'unknown' };
  const derived: DerivedFrom = {
    title: license.title ?? 'Untitled',
    author: license.authors.length > 0 ? license.authors.join(', ') : 'unknown',
    license: license.licenseName ?? 'unknown',
    sourceSha256: sha,
  };
  const redistributable =
    mixamo || license.allowRedistribution === false ? 'no' : license.allowRedistribution === true ? 'yes' : 'unknown';
  return { derivedFrom: [derived], redistributable };
}
