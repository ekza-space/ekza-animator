// ⑤ export targets (AUTORIG-SPEC §5.6, §5.6.3; moved from Auto-Rig ⑤ by T5b; STUDIO-TOUCH-SPEC §13.3 Share): the
// file a target saves, named before *Download* exactly as `autorig.export` names it (`fileName: ''`: io's
// `omobaSlug` of the avatar's name and `exportFileName`, mirrored here because a shell's chunk may not import io's
// values), the target a character is offered first, the first-entry preparation (a model character without a
// thumbnail gets one, `char.renderThumbnail`; one without an author gets the remembered one, `char.setVrmMeta`; one
// undo step each) and the download itself (`autorig.export {character, target, fileName: ''}`: Studio's own export
// code, so the bytes are Studio's by construction; a blocking lint saves nothing). Every change is an operator run.
import type { CharacterId, CharacterRecord } from '@ekza-studio/doc';
import type { AutoRigExportResult, AutoRigExportTarget } from '../types';
import type { AutoRigFlowHost } from './host';

/** A live model-sourced character (`isModelCharacter`, written out: shell chunks stay off the export workflow). */
const isModel = (record: CharacterRecord): boolean => record.deleted === null && record.source.kind === 'model';

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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');

/**
 * io's `omobaSlug`: lower-case `[a-z0-9-]`, accents folded, at most 64 characters; OMOBA's protected `ekza-` prefix
 * becomes `studio-ekza-`; nothing left → `avatar-<8 hex>` (empty name: `avatar`).
 */
export function exportSlugOf(name: string): string {
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
 * CHARACTER-CONTRACT-SPEC §8.5 (C2): the OMOBA hero package is `<slug>.vrm`; `dev`: the character is made for an OMOBA
 * hero, so its developer files are the package's `<slug>-omoba-dev.zip`.
 */
export function exportFileNameOf(
  target: AutoRigExportTarget,
  name: string,
  clips: number,
  firstClip: string | null,
  dev = false,
): string {
  const base = exportSlugOf(name);
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

/** The name the file is named after (as `autorig.export` names it): a model character's VRM name, else its own. */
export const exportAvatarName = (record: CharacterRecord): string =>
  (isModel(record) ? (record.vrm?.name ?? '').trim() : '') || record.name;

/** The recommended target of a character: the Ekza avatar, or the GLB for an imported glTF avatar (§5.6.1). */
export const recommendedTarget = (record: CharacterRecord): AutoRigExportTarget =>
  isModel(record) || record.format !== 'gltf' ? 'ekza-vrm' : 'glb';

/** `autorig.export`'s arguments: the operator names the file itself. */
export const exportArgs = (
  character: CharacterId,
  target: AutoRigExportTarget,
): { readonly character: CharacterId; readonly target: AutoRigExportTarget; readonly fileName: '' } => ({
  character,
  target,
  fileName: '',
});

/**
 * ⑤'s first entry for a character (§5.6.3): a model character with a skeleton and no thumbnail gets one; one with no
 * author gets `author` (the shell's remembered author, or null). Each is the person's run (one undo step).
 */
export async function prepareExport(
  host: Pick<AutoRigFlowHost, 'app' | 'run'>,
  record: CharacterRecord,
  author: string | null,
): Promise<void> {
  if (!isModel(record)) return;
  const { app } = host;
  // the joints and meshes must be there for the renderer: a character without a skeleton gets no thumbnail
  const skeleton = app.store.query.skeletonOfCharacter(record.id);
  if (skeleton !== undefined && (record.vrm?.thumbnail ?? null) === null) {
    await host.run('char.renderThumbnail', { character: record.id });
  }
  const current = app.store.get('characters', record.id);
  const authors = current?.vrm?.authors.filter((name) => name.trim() !== '') ?? [];
  if (author !== null && current !== undefined && authors.length === 0) {
    await host.run('char.setVrmMeta', { character: record.id, patch: { authors: [author] } });
  }
}

/** Whether an export saved its file (no error lint). */
export const exportSaved = (result: AutoRigExportResult): boolean =>
  !result.lints.some((lint) => lint.severity === 'error');

/** *Download* (§5.6.1): `autorig.export`; null when the run did not finish (its failure is the shell's to show). */
export async function downloadExport(
  host: Pick<AutoRigFlowHost, 'run'>,
  character: CharacterId,
  target: AutoRigExportTarget,
): Promise<{ readonly result: AutoRigExportResult; readonly saved: boolean } | null> {
  const run = await host.run('autorig.export', exportArgs(character, target));
  if (run.status !== 'finished') return null;
  const result = run.value as AutoRigExportResult;
  return { result, saved: exportSaved(result) };
}
