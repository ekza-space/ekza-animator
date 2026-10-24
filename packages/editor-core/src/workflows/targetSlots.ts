// The open slot vocabulary (CHARACTER-CONTRACT-SPEC §8.2; ADR 0010 §5 as amended by ADR 0024): a clip's slot is a
// vocabulary-v1 name (`walk`), or a slot id of the contract its character is bound to (`base.run`). Contract slot ids
// always contain a dot, vocabulary names never do. Eager and tiny: the check of a contract slot (bound, in the
// character's view, open in this contract, one clip per slot) lives in the lazy target chunk, which installs it here
// when it loads; until then a dotted slot passes the first poll and `prepare` loads the chunk (the runner polls again).
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import type { EditorApp, RigValidationRow } from '../types';
import type * as TargetChunk from './target';

/** True for a contract slot id (any game: it has a dot); vocabulary-v1 names have none. */
export function isTargetSlotId(slot: unknown): slot is string {
  return typeof slot === 'string' && slot.includes('.');
}

/** What the target chunk answers for a contract slot on a clip. */
export interface TargetSlotCheck {
  /**
   * Why `clip` (of `character`; null: a clip about to be made) cannot take `slot`, or null. `moving`: the operator
   * moves the slot off any other clip, so another holder is no problem.
   */
  problem(
    app: EditorApp,
    character: CharacterId,
    clip: ClipId | null,
    slot: string,
    opts?: { readonly moving?: boolean },
  ): string | null;
}

let check: TargetSlotCheck | null = null;

/** Installed by the target chunk (`workflows/target`), never by anything else. */
export function setTargetSlotCheck(next: TargetSlotCheck | null): void {
  check = next;
}

/** True once the target chunk can check contract slots. */
export function targetSlotsLoaded(): boolean {
  return check !== null;
}

/** Why `clip` cannot take the contract slot `slot`; null when it can, or while the chunk is not loaded yet. */
export function targetSlotProblem(
  app: EditorApp,
  character: CharacterId,
  clip: ClipId | null,
  slot: string,
  opts?: { readonly moving?: boolean },
): string | null {
  return check === null ? null : check.problem(app, character, clip, slot, opts);
}

/** The Validation rows of a character's target (area `animation`), installed by the target chunk; [] until then. */
type RowSource = (app: Pick<EditorApp, 'store'>, character: CharacterId) => RigValidationRow[];
let rows: RowSource | null = null;

export function setTargetValidationRows(next: RowSource | null): void {
  rows = next;
}

export function targetValidationRowsOf(app: Pick<EditorApp, 'store'>, character: CharacterId): RigValidationRow[] {
  return rows === null ? [] : rows(app, character);
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
