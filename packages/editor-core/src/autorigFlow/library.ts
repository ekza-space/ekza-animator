// ④ library use (AUTORIG-SPEC §5.5.2–§5.5.4; moved from Auto-Rig ④ by T5b; STUDIO-TOUCH-SPEC J1/J5 *Add
// animations*): a library clip is previewed with its parameters (`library.preview {character, clip, params}`, U
// state) and added through `autorig.clip.add {character, clip, params, replace?}` — C12's Use Clip, one undo step,
// the parameters applied to the VRMA bytes before the import, `replace` swapping a ✎-edited clip in place. Identity
// parameters are Use Clip exactly.
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import { IDENTITY_CLIP_PARAMS } from '../library/params';
import type { ClipParams } from '../types';
import type { AutoRigFlowHost } from './host';

/** The parameters of a plain Use Clip (speed 1, no trim, no mirror, not in place, arms 0°). */
export const IDENTITY_FLOW_CLIP_PARAMS: ClipParams = IDENTITY_CLIP_PARAMS;

/** `autorig.clip.add`'s arguments. */
export function clipAddArgs(
  character: CharacterId,
  clip: string,
  params: ClipParams = IDENTITY_CLIP_PARAMS,
  replace: ClipId | null = null,
): {
  readonly character: CharacterId;
  readonly clip: string;
  readonly params: ClipParams;
  readonly replace?: ClipId;
} {
  return { character, clip, params, ...(replace === null ? {} : { replace }) };
}

/** + Add to character / Update (§5.5.4): one Use Clip step (the person's run); resolves with the run's result. */
export function addLibraryClip(
  host: Pick<AutoRigFlowHost, 'run'>,
  character: CharacterId,
  clip: string,
  params: ClipParams = IDENTITY_CLIP_PARAMS,
  replace: ClipId | null = null,
): ReturnType<AutoRigFlowHost['run']> {
  return host.run('autorig.clip.add', clipAddArgs(character, clip, params, replace));
}

/** §5.5.2: previews a library clip with its parameters (the person's run; no document write). */
export function previewLibraryClip(
  host: Pick<AutoRigFlowHost, 'run'>,
  character: CharacterId,
  clip: string,
  params: ClipParams = IDENTITY_CLIP_PARAMS,
): ReturnType<AutoRigFlowHost['run']> {
  return host.run('library.preview', { character, clip, params });
}
