// Run scope helpers (MCP-SPEC §4.1, §5.7): what a selection-driven operator targets. A user run reads and writes the
// session; an actor (agent) run reads the per-call `RunScope` the tool layer passed — missing parts are empty, never
// the user's — and never writes the user's selection. The names stay apart from `evaluation/time.ts`'s `activeClipOf`.
import type { CharacterId, ClipId, KeyId } from '@ekza-animator/doc';
import type { ChannelRef, KeyPartSelection, OperatorContext, Selection } from '../types';

const NO_CONTROLS: readonly never[] = Object.freeze([]);
const NO_CHANNELS: readonly ChannelRef[] = Object.freeze([]);
const NO_KEYS: ReadonlyMap<KeyId, KeyPartSelection> = new Map();

function isActor(ctx: OperatorContext): boolean {
  return ctx.actor !== undefined && ctx.actor !== null;
}

/** Actor runs: the scope's selection (missing parts empty; M6a fields `objects` empty). Others: the session's. */
export function selectionOf(ctx: OperatorContext): Selection {
  if (!isActor(ctx)) return ctx.app.session.getState().selection;
  const scoped = ctx.runScope?.selection;
  // M6a adds `objects` to Selection; an actor's scope never names objects, so the part stays empty when it exists.
  return {
    controls: scoped?.controls ?? NO_CONTROLS,
    keys: scoped?.keys ?? NO_KEYS,
    channels: scoped?.channels ?? NO_CHANNELS,
  };
}

/** Actor runs: runScope.character ?? session.activeCharacter. Others: session.activeCharacter. */
export function scopedCharacterOf(ctx: OperatorContext): CharacterId | null {
  const active = ctx.app.session.getState().activeCharacter;
  if (!isActor(ctx)) return active;
  return ctx.runScope?.character ?? active;
}

/** Actor runs: runScope.clip when it belongs to `character`, else the character's active clip (the tool layer always
 *  passes `runScope.clip` for live edits, §5.1, so the fallback serves headless projects only). */
export function scopedClipOf(ctx: OperatorContext, character: CharacterId): ClipId | null {
  const active = ctx.app.session.getState().activeClip[character] ?? null;
  if (!isActor(ctx)) return active;
  const clip = ctx.runScope?.clip;
  if (clip !== undefined && ctx.app.store.get('clips', clip)?.character === character) return clip;
  return active;
}

/** Actor runs: a no-op (the scope lives for one call). Others: session.setState({ selection: next }). */
export function setSelectionOf(ctx: OperatorContext, next: Selection): void {
  if (isActor(ctx)) return;
  ctx.app.session.setState({ selection: next });
}
