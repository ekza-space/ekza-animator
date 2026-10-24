// The open slot vocabulary (CHARACTER-CONTRACT-SPEC §8.2; ADR 0010 §5 as amended by ADR 0024): a clip's slot is a
// vocabulary-v1 name (`walk`), or a slot id of the contract its character is bound to (`base.run`). Contract slot ids
// always contain a dot, vocabulary names never do. Eager and tiny (four exports): the check of a contract slot (bound,
// in the target, open in this contract, one clip per slot) and the `animation` Validation rows live in the lazy target
// chunk, which installs them here when it loads; until then a dotted slot passes the first poll and `prepare` loads the
// chunk (the runner polls again), and the Validation service lists no target rows.
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import type { EditorApp, RigValidationRow } from '../types';
import type * as TargetChunk from './target';

/** True for a contract slot id (any game: it has a dot); vocabulary-v1 names have none. */
export function isTargetSlotId(slot: unknown): slot is string {
  return typeof slot === 'string' && slot.includes('.');
}

/** What the target chunk installs once it is loaded. */
export interface TargetHooks {
  /**
   * Why `clip` (of `character`; null: a clip about to be made) cannot take the contract slot `slot`, or null.
   * `moving`: the operator moves the slot off any other clip, so another holder is no problem.
   */
  problem(
    app: EditorApp,
    character: CharacterId,
    clip: ClipId | null,
    slot: string,
    opts?: { readonly moving?: boolean },
  ): string | null;
  /** The Validation rows of a character's target (area `animation`); strict for the OMOBA package profile (C2). */
  rows(app: Pick<EditorApp, 'store'>, character: CharacterId, profile?: string | null): RigValidationRow[];
}

let hooks: TargetHooks | null = null;

/** The installed hooks, or null while the target chunk is not loaded (the chunk's `attachTargets` sets them). */
export function targetHooks(next?: TargetHooks | null): TargetHooks | null {
  if (next !== undefined) hooks = next;
  return hooks;
}

/** The target chunk's module (a type-only import: a value import would make it eager). */
export type TargetKit = typeof TargetChunk;

/**
 * Loads the target chunk once per page and attaches it to `app` (its operators, table and checks); resolves to the
 * chunk (slot statuses, the contract service) for the panels. The runner's loader of `target.*` ids.
 */
export function loadTargetKit(app: EditorApp): Promise<TargetKit> {
  return import('./target').then((chunk) => {
    chunk.attachTargets(app);
    return chunk;
  });
}
