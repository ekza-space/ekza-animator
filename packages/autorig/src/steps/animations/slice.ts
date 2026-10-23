// The `animations` slice's reducers (AUTORIG-SPEC §4.3; D5): the parameters per library clip before Add (`draft`),
// *Skip* (④ done without clips) and the clip a ✎ is editing. U state: written through the session store's generic
// `patch`, never the document.
import type { ClipId } from '@ekza-studio/doc';
import type { AutoRigSessionStore } from '../../session';
import type { AutoRigAnimationsSlice, ClipParams } from '../../types';

export type { AutoRigAnimationsSlice, ClipParams };

/** What the reducers need of the session store. */
export type AutoRigSessionStoreLike = Pick<AutoRigSessionStore, 'getState' | 'patch'>;

/** Sets the parameters of library clip `clip` (before Add). */
export function setDraft(store: AutoRigSessionStoreLike, clip: string, params: ClipParams): void {
  store.patch('animations', { draft: { ...store.getState().animations.draft, [clip]: params } });
}

/** Forgets the parameters of library clip `clip` (back to the identity). */
export function clearDraft(store: AutoRigSessionStoreLike, clip: string): void {
  const { [clip]: _gone, ...rest } = store.getState().animations.draft;
  store.patch('animations', { draft: rest });
}

/** *Skip*: ④ is done without clips (§4.3). */
export function markSkipped(store: AutoRigSessionStoreLike, skipped = true): void {
  store.patch('animations', { skipped });
}

/** ✎ on a document clip: its library clip's parameters into the editor, the clip remembered for *Update*. */
export function editClip(store: AutoRigSessionStoreLike, clipId: ClipId, clip: string, params: ClipParams): void {
  store.patch('animations', { editing: clipId, draft: { ...store.getState().animations.draft, [clip]: params } });
}

/** Leaves the ✎ edit (after *Update* or *Cancel*). */
export function endEdit(store: AutoRigSessionStoreLike): void {
  store.patch('animations', { editing: null });
}
