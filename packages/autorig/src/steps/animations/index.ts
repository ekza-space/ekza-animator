// ④ Animations step (AUTORIG-SPEC §5.5; D5): the step module the frame reads (`shell/steps.ts`) — the lazy view (the
// library grid, search and categories, the preview with the clip parameters, the clips on the character), the step's
// own start (the clip-library chunk and its manifest, the import chunk the parameters use), the `.vrma` drop, and the
// `animations` slice with its reducers. Eager on `/autorig` (the frame imports it), so it holds only the slice and
// loaders; everything else is in the view's chunk.
import { preloadImportPath } from '@ekza-studio/editor-core';
import type { ComponentType } from 'react';
import type { WizardContext } from '../../shell/context';
import type { StepViewProps } from '../../shell/steps';
import type { AutoRigAnimationsSlice, ClipParams } from './slice';

export {
  clearDraft,
  editClip,
  endEdit,
  markSkipped,
  setDraft,
  type AutoRigSessionStoreLike,
} from './slice';

export const IDENTITY_CLIP_PARAMS: ClipParams = { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 };

export const ANIMATIONS_SLICE: AutoRigAnimationsSlice = { draft: {}, skipped: false, editing: null };

/** The view (its own chunk): `slot: 'panel'` the library and the character's clips, `'overlay'` the preview bar. */
export const stepView = (): Promise<{ readonly default: ComponentType<StepViewProps> }> => import('./AnimationsStep');

/** §4.2: the step's own start — the clip library (chunk and manifest) and the import chunk, fetched on entry. */
export function stepEnter(ctx: WizardContext): void {
  void ctx.app.library.service.manifest().catch(() => {});
  void preloadImportPath().catch(() => {});
}

/** True for a file name the step takes (a VRM Animation). */
export const isVrmaFile = (name: string): boolean => /\.vrma$/i.test(name);

/**
 * Files dropped while ④ is open (§5.5.4): `.vrma` files go to the character through the shipped
 * `file.importAnimation`; anything else is ①'s (returns false).
 */
export function stepFiles(ctx: WizardContext, files: readonly File[]): boolean {
  if (files.length === 0 || !files.every((file) => isVrmaFile(file.name))) return false;
  void import('./actions').then((actions) => actions.importVrmaFiles(ctx, files));
  return true;
}
