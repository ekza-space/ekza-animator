// The clips an Ekza VRM leaves out (AR-D8-2; D8): a model character's VRM carries the clips with a slot, an imported
// avatar's bake the clips whose export name (the slot, else the sanitized name) is an Ekza clip name — editor-core's
// `inEkzaVrm`, mirrored here so ⑤'s chunk does not pull the wizard operators. ⑤ lists every other clip with a slot fix
// (the shipped `clip.setSettings`): a suggested free slot in one click, or any free slot from the list. Pure.
import { SLOT_VOCABULARY } from '../animations/data';

/** An Ekza clip name (ADR 0010 §5; `ekza.slot-name`). */
const EKZA_CLIP_NAME = /^[a-z][a-z0-9_]{0,31}$/;

export interface ClipLike {
  readonly id: string;
  readonly name: string;
  readonly slot: string | null;
}

/** A clip's export name as io writes it (`clipExportName`: the slot, else the sanitized name). */
export const clipName = (clip: Pick<ClipLike, 'name' | 'slot'>): string =>
  clip.slot !== null && clip.slot.trim() !== ''
    ? clip.slot.trim()
    : clip.name
        .trim()
        .replace(/[^A-Za-z0-9_.-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64) || 'clip';

/** Whether the clip goes into the character's Ekza VRM (editor-core's `inEkzaVrm`). */
export function inVrm(model: boolean, clip: ClipLike): boolean {
  if (model) return (clip.slot ?? '').trim() !== '';
  const name = clipName(clip);
  return EKZA_CLIP_NAME.test(name) && name !== 'tpose';
}

/** Name words → the slot a clip like it plays (first match wins). */
const SUGGEST: readonly (readonly [RegExp, string])[] = [
  [/idle|stand|breath/i, 'idle'],
  [/walk/i, 'walk'],
  [/run|jog|sprint/i, 'run'],
  [/punch|kick|attack|sword|slash|shoot|pistol|gun|strike/i, 'attack'],
  [/cast|spell|magic/i, 'cast'],
  [/death|die|dead/i, 'death'],
  [/jump|leap|hop/i, 'jump'],
  [/hit|hurt|damage/i, 'hit'],
  [/dance/i, 'dance'],
  [/wave|hello/i, 'wave'],
  [/crouch|sneak/i, 'crouch'],
  [/cheer|celebrat|victory/i, 'celebrate'],
];

/** The slots no other clip of the character uses (in the vocabulary's order). */
export function freeSlots(clips: readonly ClipLike[]): readonly string[] {
  const used = new Set(clips.map((clip) => clipName(clip)));
  return SLOT_VOCABULARY.filter((slot) => !used.has(slot));
}

/** The free slot a clip's name suggests, or null (then only the list is offered). */
export function suggestedSlot(clip: ClipLike, free: readonly string[]): string | null {
  for (const [pattern, slot] of SUGGEST) if (pattern.test(clip.name)) return free.includes(slot) ? slot : null;
  return null;
}

/** The clips the VRM leaves out, in the document's order. */
export function leftOutClips<T extends ClipLike>(model: boolean, clips: readonly T[]): readonly T[] {
  return clips.filter((clip) => !inVrm(model, clip));
}
