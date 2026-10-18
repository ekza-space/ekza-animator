// Clip provenance on import (MVP-SPEC §4.11.6 step 7, ADR 0010 §3): embedded clips of a VRM inherit the avatar's
// VRM meta (title, authors, licence, `allowRedistribution`); clip or node names matching /mixamo/i force
// `redistributable: 'no'`; GLB and VRMA files without licence data are 'unknown'; bundled samples pass their known
// licence; a VRMA written by the Animator carries its clips' provenance in `ekza_animation_v1`, which is kept.
import type { ClipProvenance, DerivedFrom, Redistributable } from '@ekza-animator/doc';
import type { GlbContainer, VrmLicenseInfo } from '@ekza-animator/io';
import { isRecord, parseDerivedFrom } from './util';

/** A licence known in advance (bundled samples). */
export interface KnownLicense {
  readonly title: string;
  readonly author: string;
  /** SPDX identifier or `LicenseRef-…`. */
  readonly license: string;
  readonly redistributable: Redistributable;
}

const MIXAMO = /mixamo/i;

/** True when any name marks the motion as Mixamo's (not redistributable as a standalone animation). */
export function isMixamo(names: Iterable<string>): boolean {
  for (const name of names) if (MIXAMO.test(name)) return true;
  return false;
}

/** Names of every animation and node of a glTF file (the Mixamo rule looks at both). */
export function animationAndNodeNames(container: GlbContainer): readonly string[] {
  const names: string[] = [];
  for (const key of ['animations', 'nodes'] as const) {
    const list = container.json[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list as readonly unknown[]) {
      if (isRecord(entry) && typeof entry['name'] === 'string') names.push(entry['name']);
    }
  }
  return names;
}

/** Text that is really a value: VRM converters write the literal 'undefined' into empty meta fields. */
function meaningful(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  return trimmed === '' || trimmed === 'undefined' || trimmed === 'null' ? null : trimmed;
}

/** Provenance of the source file as a whole (before the per-clip Mixamo rule). */
export function sourceProvenance(source: {
  readonly fileTitle: string;
  readonly sha256: string;
  readonly license: VrmLicenseInfo | null;
  readonly known?: KnownLicense;
}): ClipProvenance {
  if (source.known !== undefined) {
    const known = source.known;
    return {
      derivedFrom: [{ title: known.title, author: known.author, license: known.license, sourceSha256: source.sha256 }],
      redistributable: known.redistributable,
    };
  }
  const license = source.license;
  if (license === null) {
    return {
      derivedFrom: [{ title: source.fileTitle, author: 'unknown', license: 'unknown', sourceSha256: source.sha256 }],
      redistributable: 'unknown',
    };
  }
  const authors = license.authors.map((author) => meaningful(author)).filter((author) => author !== null);
  const entry: DerivedFrom = {
    title: meaningful(license.title) ?? source.fileTitle,
    author: authors.length > 0 ? authors.join(', ') : 'unknown',
    license: meaningful(license.licenseName) ?? 'unknown',
    sourceSha256: source.sha256,
  };
  const redistributable: Redistributable =
    license.allowRedistribution === true ? 'yes' : license.allowRedistribution === false ? 'no' : 'unknown';
  return { derivedFrom: [entry], redistributable };
}

/** Per-clip provenance: the source's, forced to 'no' when the clip or its animated nodes are Mixamo's. */
export function clipProvenance(source: ClipProvenance, names: Iterable<string>): ClipProvenance {
  return isMixamo(names) ? { derivedFrom: source.derivedFrom, redistributable: 'no' } : source;
}

/** True when the VRM meta forbids modifying or redistributing the avatar (export licence gate, ADR 0012 §5). */
export function isRestrictedLicense(license: VrmLicenseInfo | null): boolean {
  return license !== null && (license.modification === 'prohibited' || license.allowRedistribution === false);
}

const REDISTRIBUTABLE: ReadonlySet<string> = new Set(['yes', 'no', 'unknown']);

/**
 * Provenance recorded by the Animator in a file it wrote (`asset.extras.ekza_animation_v1`): the entry of the glTF
 * animation `index` (its `index` field), or the first entry when `index` is omitted (a VRMA holds one clip). Null
 * when the file carries none for that animation or it is malformed.
 */
export function embeddedEkzaProvenance(container: GlbContainer, index?: number): ClipProvenance | null {
  const extras = container.json.asset.extras;
  const meta = isRecord(extras) ? extras['ekza_animation_v1'] : undefined;
  if (!isRecord(meta) || !Array.isArray(meta['clips'])) return null;
  const clips = meta['clips'] as readonly unknown[];
  const clip: unknown =
    index === undefined ? clips[0] : clips.find((entry) => isRecord(entry) && entry['index'] === index);
  if (!isRecord(clip) || !Array.isArray(clip['derivedFrom'])) return null;
  const redistributable = clip['redistributable'];
  if (typeof redistributable !== 'string' || !REDISTRIBUTABLE.has(redistributable)) return null;
  const derivedFrom: DerivedFrom[] = [];
  for (const entry of clip['derivedFrom'] as readonly unknown[]) {
    const parsed = parseDerivedFrom(entry);
    if (parsed === null) return null;
    derivedFrom.push(parsed);
  }
  return { derivedFrom, redistributable: redistributable as Redistributable };
}
