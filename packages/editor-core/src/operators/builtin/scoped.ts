// What the scope-ready operators act on (MCP-SPEC §4.10 last paragraph, §5.7): the `workflows/targets` rules over the
// run's targets instead of the session. A user run reads exactly what it read before (the session's selection, the
// active character's active clip, `time.snapToFrames`) and writes the selection as before; an agent run reads its
// `RunScope` (missing parts empty, never the user's), falls back to nothing where a user run falls back to "every
// curve of the clip" (it poll-fails "No targets"), snaps to whole frames and never writes the session.
//
// M-AI B5 (`check:size`): user runs call the shipped `workflows/targets` rules; agent runs the lazy `actorScope.ts`
// (loaded before any actor run polls, see `scope.ts`).
import type { ClipRecord, ControlRecord, CurveRecord, KeyId, ReadView } from '@ekza-studio/doc';
import { type ActorScope, actorScope, selectionOf, setSelectionOf } from '../scope';
import type { KeyPartSelection, OperatorContext, PollResult } from '../../types';
import {
  activeClipRecord,
  type SelectedKey,
  selectedControls,
  selectedKeyIds,
  selectedKeys,
  targetCurves,
} from '../../workflows/targets';
import { isActorRun, OK } from './define';
import { pollClipEdit } from './polls';

/** The actor scope of an agent run, null for user runs. */
function actorOf(ctx: OperatorContext): ActorScope | null {
  return isActorRun(ctx) ? actorScope() : null;
}

/** Agent runs with an empty scope: "No targets"; otherwise OK. */
export function pollScopeTargets(ctx: OperatorContext): PollResult {
  return actorOf(ctx)?.pollTargets(ctx) ?? OK;
}

/** The clip a scope-ready operator edits: the scope's clip for agents, the active character's active clip else. */
export function scopedClipRecord(ctx: OperatorContext, view: ReadView = ctx.app.store): ClipRecord | undefined {
  const actor = actorOf(ctx);
  return actor === null ? activeClipRecord(ctx.app, view) : actor.clipRecord(ctx, view);
}

/** Editable document and a clip to edit (the user's `pollClipEdit`, or the scope's clip for agents). */
export function pollScopedClipEdit(ctx: OperatorContext): PollResult {
  return actorOf(ctx)?.pollClipEdit(ctx) ?? pollClipEdit(ctx.app);
}

/** Selected keys of the run's targets that still exist, in selection order. */
export function scopedSelectedKeys(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly SelectedKey[] {
  const actor = actorOf(ctx);
  return actor === null ? selectedKeys(ctx.app, view) : actor.selectedKeys(ctx, view);
}

/** Ids of the run's selected keys whose key part is selected. */
export function scopedSelectedKeyIds(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly KeyId[] {
  const actor = actorOf(ctx);
  return actor === null ? selectedKeyIds(ctx.app, view) : actor.selectedKeyIds(ctx, view);
}

/**
 * The controls an agent run targets: the scope's controls, else the controls of its keys and channels (a scope of
 * keys alone still names their controls). User runs: the selected controls.
 */
export function scopedTargetControls(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly ControlRecord[] {
  const actor = actorOf(ctx);
  return actor === null ? selectedControls(ctx.app, view) : actor.targetControls(ctx, view);
}

/**
 * Curves the curve-level operators act on (`workflows/targets` `targetCurves` over the run's targets): the curves of
 * the selected keys; else of the selected channels; else of the selected controls; else — user runs only — every
 * base curve of the clip. Agent runs with an empty scope get none.
 */
export function scopedTargetCurves(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly CurveRecord[] {
  const actor = actorOf(ctx);
  return actor === null ? targetCurves(ctx.app, view) : actor.targetCurves(ctx, view);
}

/** Whole frames for agents (§4.10); the session's `time.snapToFrames` for users. */
export function snapOf(ctx: OperatorContext): boolean {
  return isActorRun(ctx) || ctx.app.session.getState().time.snapToFrames;
}

/** Drops deleted keys from the user's key selection (agent runs: nothing; the session keeper prunes after commit). */
export function forgetScopedKeys(ctx: OperatorContext, deleted: readonly KeyId[]): void {
  if (deleted.length === 0 || isActorRun(ctx)) return;
  const selection = selectionOf(ctx);
  if (!deleted.some((id) => selection.keys.has(id))) return;
  const keys = new Map(selection.keys);
  for (const id of deleted) keys.delete(id);
  setSelectionOf(ctx, { ...selection, keys });
}

/** Selects exactly these keys (key parts) for users; agent runs leave the selection alone. */
export function selectScopedKeysOnly(ctx: OperatorContext, ids: readonly KeyId[]): void {
  if (isActorRun(ctx)) return;
  const selection = selectionOf(ctx);
  const keys = new Map<KeyId, KeyPartSelection>(ids.map((id) => [id, { key: true, in: false, out: false }]));
  setSelectionOf(ctx, { ...selection, keys });
}
