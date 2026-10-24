// The file name a target saves (AUTORIG-SPEC §5.6, §5.6.4; D6), shown before *Download* ("cube-lad.vrm · ready",
// "2 clips → cube-lad-animations.zip"). `autorig.export` names the file itself (io's `omobaSlug` and `exportFileName`,
// called with `fileName: ''`); the wizard may not import io's values (§4.1), so this mirrors those two rules for the
// hint, and E2E-AR-07 checks the hint against the saved file's name.
import type { AutoRigExportTarget } from '@ekza-studio/editor-core';

/** FNV-1a (32 bit) of the UTF-8 bytes of a text, 8 hex digits (io's `omobaSlug` fallback hash). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const slugText = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');

/**
 * io's `omobaSlug`: lower-case `[a-z0-9-]`, accents folded, at most 64 characters; OMOBA's protected `ekza-` prefix
 * becomes `studio-ekza-`; nothing left → `avatar-<8 hex>` (empty name: `avatar`).
 */
export function slugOf(name: string): string {
  const slug = slugText(name);
  if (slug === '') {
    const trimmed = name.trim().normalize('NFC');
    return trimmed === '' ? 'avatar' : `avatar-${fnv1a(trimmed)}`;
  }
  return slug.startsWith('ekza-') ? slugText(`studio-${slug}`) : slug;
}

/** io's `exportFileName` sanitizing of a base name. */
const sanitized = (base: string): string =>
  base
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '') || 'export';

/**
 * The saved file of a target for an avatar name: `<slug>.vrm`, `<slug>.glb`, `<slug>-omoba-kit.zip`, and for VRMA one
 * `<slug>-<clip>.vrma` or `<slug>-animations.zip`. `firstClip` is the export name of the only clip (its slot or name).
 * `dev`: the character is made for an OMOBA hero, so the developer files are the package's `<slug>-omoba-dev.zip` (C2).
 */
export function expectedFileName(
  target: AutoRigExportTarget,
  name: string,
  clips: number,
  firstClip: string | null,
  dev = false,
): string {
  const base = slugOf(name);
  switch (target) {
    case 'ekza-vrm':
    case 'omoba-hero':
      return `${base}.vrm`;
    case 'glb':
      return `${base}.glb`;
    case 'omoba-kit':
      return `${base}-omoba-${dev ? 'dev' : 'kit'}.zip`;
    case 'vrma':
      return clips === 1 && firstClip !== null ? `${sanitized(`${base}-${firstClip}`)}.vrma` : `${base}-animations.zip`;
  }
}
