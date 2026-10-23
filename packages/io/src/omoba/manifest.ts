// The OMOBA local test kit's names and manifest entry (AUTORIG-SPEC §5.6.4; D6): the slug OMOBA stages an avatar under
// (`<asset root>/avatars/<slug>.glb`), the licence text of a VRM licence preset, and one `manifest-entry.json` in the
// field names of OMOBA's avatar manifest (`omoba-bevy` `passport/src/avatars.rs` `AvatarDefinition`, read as
// `client/assets/avatars/manifest.json` or through `OMOBA_AVATAR_MANIFEST`). Pure; no OMOBA checkout is read.
import type { VrmLicensePreset } from '@ekza-studio/doc';

/** The collection every Studio-made avatar is listed under. */
export const OMOBA_KIT_COLLECTION = 'Ekza Studio';

/** The longest slug the kit writes (file names stay short on every platform). */
export const OMOBA_SLUG_MAX = 64;

/** The slug of an empty name; a name without Latin letters or digits gets `avatar-<8 hex>` (FNV-1a of the name). */
export const OMOBA_SLUG_FALLBACK = 'avatar';

/**
 * OMOBA's protected slug prefix: its roster loader skips an `ekza-…` entry without a passport boundary (omoba-bevy
 * `passport/src/avatars.rs` `roster_entry_problem`, "protected-looking slug without a passport boundary"). A kit never
 * writes one; such a slug gets {@link OMOBA_KIT_PREFIX} in front (`Ekza Bot` → `studio-ekza-bot`).
 */
export const OMOBA_PROTECTED_PREFIX = 'ekza-';

/** What a would-be protected slug is prefixed with. */
export const OMOBA_KIT_PREFIX = 'studio-';

/** FNV-1a (32 bit) of the UTF-8 bytes of a text, as 8 lower-case hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** `[a-z0-9-]` runs of a text: no leading, trailing or doubled hyphen, at most 64 characters. */
function slugText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, OMOBA_SLUG_MAX)
    .replace(/-+$/g, '');
}

/**
 * The OMOBA slug of a display name: lower case `[a-z0-9-]`, accents folded, every other run of characters one hyphen,
 * no leading, trailing or doubled hyphen, at most 64 characters. Never OMOBA's protected `ekza-` prefix (it becomes
 * `studio-ekza-…`, which OMOBA's local roster accepts). A name with nothing left is `avatar-<8 hex>` (a stable hash of
 * the trimmed NFC name, so two non-Latin names do not share a file), an empty name `avatar`. Idempotent.
 */
export function omobaSlug(name: string): string {
  const slug = slugText(name);
  if (slug === '') {
    const trimmed = name.trim().normalize('NFC');
    return trimmed === '' ? OMOBA_SLUG_FALLBACK : `${OMOBA_SLUG_FALLBACK}-${fnv1a(trimmed)}`;
  }
  return slug.startsWith(OMOBA_PROTECTED_PREFIX) ? slugText(`${OMOBA_KIT_PREFIX}${slug}`) : slug;
}

/** OMOBA's licence text for a VRM licence preset (the roster writes `CC0`). */
export function omobaLicense(preset: VrmLicensePreset | null): string {
  switch (preset) {
    case 'cc0':
      return 'CC0';
    case 'cc-by-4.0':
      return 'CC-BY-4.0';
    case 'personal':
      return 'Personal use only (VRM: only the author)';
    case 'custom':
      return 'Custom (see the VRM meta)';
    case null:
      return 'Not chosen';
  }
}

/** What the kit says about the avatar (the character's VRM meta). */
export interface OmobaKitMeta {
  /** The avatar's name (`display_name`). */
  readonly displayName: string;
  /** The authors (joined into OMOBA's single `author`; empty → null). */
  readonly authors: readonly string[];
  /** OMOBA's licence text (`omobaLicense(preset)` for a model character). */
  readonly license: string;
  /** The slug; default `omobaSlug(displayName)`. */
  readonly slug?: string;
  /** Where the avatar comes from; default '' (a local file has no URL; OMOBA's `source_url` is a required string). */
  readonly sourceUrl?: string;
  /** The thumbnail's file type when the kit carries one; default `png` (an imported VRM's own may be a JPEG). */
  readonly thumbnailExtension?: 'png' | 'jpg';
  /** The VRM version of the avatar file; default `1.0` (an imported VRM 0.x avatar keeps its version, AR-D10-9). */
  readonly vrmVersion?: '0.x' | '1.0';
}

/**
 * One avatar of OMOBA's manifest, in its field names and key order (`AvatarDefinition`: `author` and `thumbnail`
 * optional, `source_url` a required string).
 */
export interface OmobaManifestEntry {
  readonly author: string | null;
  readonly collection: string;
  readonly display_name: string;
  readonly license: string;
  readonly slug: string;
  readonly source_url: string;
  readonly thumbnail: string | null;
}

/** The OMOBA field names, in the order the kit writes them. */
export const OMOBA_MANIFEST_FIELDS = [
  'author',
  'collection',
  'display_name',
  'license',
  'slug',
  'source_url',
  'thumbnail',
] as const satisfies readonly (keyof OmobaManifestEntry)[];

/** The kit's slug for a meta (its own, sanitized, or the display name's). */
export function omobaKitSlug(meta: OmobaKitMeta): string {
  return omobaSlug(meta.slug ?? meta.displayName);
}

/** The manifest entry of a kit; `thumbnail` names `<slug>.png` (or `.jpg`) when the kit carries one. */
export function omobaManifestEntry(meta: OmobaKitMeta, hasThumbnail: boolean): OmobaManifestEntry {
  const slug = omobaKitSlug(meta);
  const authors = meta.authors.map((author) => author.trim()).filter((author) => author !== '');
  const name = meta.displayName.trim();
  return {
    author: authors.length === 0 ? null : authors.join(', '),
    collection: OMOBA_KIT_COLLECTION,
    display_name: name === '' ? slug : name,
    license: meta.license,
    slug,
    source_url: meta.sourceUrl ?? '',
    thumbnail: hasThumbnail ? `${slug}.${meta.thumbnailExtension ?? 'png'}` : null,
  };
}

/** `manifest-entry.json`: the entry with two-space indentation and a final newline. */
export function omobaManifestJson(entry: OmobaManifestEntry): string {
  const ordered: Record<string, unknown> = {};
  for (const field of OMOBA_MANIFEST_FIELDS) ordered[field] = entry[field];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
