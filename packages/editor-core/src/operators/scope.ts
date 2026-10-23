// Run scope helpers (MCP-SPEC §4.1, §5.7): what a selection-driven operator targets. A user run reads and writes the
// session; an actor (agent) run reads the per-call `RunScope` the tool layer passed — missing parts are empty, never
// the user's — and never writes the user's selection. The names stay apart from `evaluation/time.ts`'s `activeClipOf`.
//
// M-AI B5 (`check:size`): the actor side is the lazy `actorScope.ts`, loaded with the runner's actor rules
// (`actorRun.ts`) by `loadActorKit`: the runner awaits it before an actor run's first poll, `loadAgentOperators` when
// an agent runtime or a headless app attaches. An actor context that reaches these helpers before then throws.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, ClipId } from '@ekza-studio/doc';
import type { OperatorContext, Selection } from '../types';
import type * as ActorRunModule from './actorRun';
import type * as ActorScopeModule from './actorScope';

export type ActorKit = typeof ActorRunModule;
export type ActorScope = typeof ActorScopeModule;

let installed: ActorScope | null = null;
let kit: Promise<ActorKit> | null = null;

/** The actor-only runner helpers and the actor scope: loaded once, retried after a failure. */
export function loadActorKit(): Promise<ActorKit> {
  if (kit === null) {
    const attempt = import('./actorRun').then((module) => {
      installed = module.ACTOR_SCOPE;
      return module;
    });
    kit = attempt;
    attempt.catch(() => {
      if (kit === attempt) kit = null;
    });
  }
  return kit;
}

/** Installs the actor scope synchronously (headless hosts, which import it up front). */
export function installActorScope(module: ActorScope): void {
  installed = module;
}

/** The loaded actor scope (an actor run has awaited `loadActorKit` before it polls). */
export function actorScope(): ActorScope {
  if (installed === null) throw new EkzaError('unavailable', 'The agent run helpers have not loaded yet');
  return installed;
}

function isActor(ctx: OperatorContext): boolean {
  return ctx.actor !== undefined && ctx.actor !== null;
}

/** Actor runs: the scope's selection (missing parts empty; the M6a/M6b parts `objects`, `joints` and `constraints`
 *  are always empty: an actor's scope never names them). Others: the session's. */
export function selectionOf(ctx: OperatorContext): Selection {
  return isActor(ctx) ? actorScope().selection(ctx) : ctx.app.session.getState().selection;
}

/** Actor runs: runScope.character ?? session.activeCharacter. Others: session.activeCharacter. */
export function scopedCharacterOf(ctx: OperatorContext): CharacterId | null {
  return isActor(ctx) ? actorScope().characterOf(ctx) : ctx.app.session.getState().activeCharacter;
}

/** Actor runs: runScope.clip when it belongs to `character`, else the character's active clip (the tool layer always
 *  passes `runScope.clip` for live edits, §5.1, so the fallback serves headless projects only). */
export function scopedClipOf(ctx: OperatorContext, character: CharacterId): ClipId | null {
  return isActor(ctx)
    ? actorScope().clipOf(ctx, character)
    : (ctx.app.session.getState().activeClip[character] ?? null);
}

/** Actor runs: a no-op (the scope lives for one call). Others: session.setState({ selection: next }). */
export function setSelectionOf(ctx: OperatorContext, next: Selection): void {
  if (!isActor(ctx)) ctx.app.session.setState({ selection: next });
}
