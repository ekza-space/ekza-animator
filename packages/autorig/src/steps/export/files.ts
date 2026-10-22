// The file name a target saves (AUTORIG-SPEC §5.6, §5.6.4; D6), shown before *Download* ("cube-lad.vrm · ready",
// "2 clips → cube-lad-animations.zip"). `autorig.export` names the file itself (io's `omobaSlug` and `exportFileName`,
// called with `fileName: ''`); the wizard may not import io's values (§4.1), so this mirrors those two rules for the
// hint, and E2E-AR-07 checks the hint against the saved file's name.
import type { AutoRigExportTarget } from '@ekza-studio/editor-core';

/** io's `omobaSlug`: lower-case `[a-z0-9-]`, accents folded, at most 64 characters, `avatar` when empty. */
export function slugOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug === '' ? 'avatar' : slug;
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
 */
export function expectedFileName(
  target: AutoRigExportTarget,
  name: string,
  clips: number,
  firstClip: string | null,
): string {
  const base = slugOf(name);
  switch (target) {
    case 'ekza-vrm':
      return `${base}.vrm`;
    case 'glb':
      return `${base}.glb`;
    case 'omoba-kit':
      return `${base}-omoba-kit.zip`;
    case 'vrma':
      return clips === 1 && firstClip !== null ? `${sanitized(`${base}-${firstClip}`)}.vrma` : `${base}-animations.zip`;
  }
}
