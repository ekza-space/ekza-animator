// What the scope-ready operators act on (MCP-SPEC §4.10 last paragraph, §5.7): the `workflows/targets` rules over the
// run's targets instead of the session. A user run reads exactly what it read before (the session's selection, the
// active character's active clip, `time.snapToFrames`) and writes the selection as before; an agent run reads its
// `RunScope` (missing parts empty, never the user's), falls back to nothing where a user run falls back to "every
// curve of the clip" (it poll-fails "No targets"), snaps to whole frames and never writes the session.
import type { ClipRecord, ControlId, ControlRecord, CurveId, CurveRecord, KeyId, ReadView } from '@ekza-studio/doc';
import { selectionOf, scopedCharacterOf, scopedClipOf, setSelectionOf } from '../scope';
import type { KeyPartSelection, OperatorContext, PollResult, Selection } from '../../types';
import { baseCurves, type SelectedKey } from '../../workflows/targets';
import { fail, isActorRun, OK } from './define';
import { pollActiveClip, pollEditable } from './polls';

/** Poll reason of an agent run whose scope names nothing to act on (§4.10: "their scope is empty"). */
export const NO_TARGETS = 'No targets: an agent run acts only on the controls, keys or channels of its context';

/** True when the scope's selection names nothing (no controls, keys or channels). */
export function emptySelection(selection: Selection): boolean {
  return selection.controls.length === 0 && selection.keys.size === 0 && selection.channels.length === 0;
}

/** Agent runs with an empty scope: "No targets"; otherwise OK. */
export function pollScopeTargets(ctx: OperatorContext): PollResult {
  return isActorRun(ctx) && emptySelection(selectionOf(ctx)) ? fail(NO_TARGETS) : OK;
}

/** The clip a scope-ready operator edits: the scope's clip for agents, the active character's active clip else. */
export function scopedClipRecord(ctx: OperatorContext, view: ReadView = ctx.app.store): ClipRecord | undefined {
  const character = scopedCharacterOf(ctx);
  if (character === null) return undefined;
  const id = scopedClipOf(ctx, character);
  const clip = id === null ? undefined : view.get('clips', id);
  return clip?.character === character ? clip : undefined;
}

/** Editable document and a clip to edit (the user's `pollClipEdit`, or the scope's clip for agents). */
export function pollScopedClipEdit(ctx: OperatorContext): PollResult {
  const editable = pollEditable(ctx.app);
  if (editable !== true) return editable;
  if (!isActorRun(ctx)) return pollActiveClip(ctx.app);
  if (scopedCharacterOf(ctx) === null) return fail('No character is loaded');
  return scopedClipRecord(ctx) === undefined ? fail('The character has no clip to edit') : OK;
}

/** Selected keys of the run's targets that still exist, in selection order. */
export function scopedSelectedKeys(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly SelectedKey[] {
  const out: SelectedKey[] = [];
  for (const [id, parts] of selectionOf(ctx).keys) {
    const key = view.get('keys', id);
    if (key !== undefined && (parts.key || parts.in || parts.out)) out.push({ key, parts });
  }
  return out;
}

/** Ids of the run's selected keys whose key part is selected. */
export function scopedSelectedKeyIds(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly KeyId[] {
  return scopedSelectedKeys(ctx, view)
    .filter((s) => s.parts.key)
    .map((s) => s.key.id);
}

/** The run's selected controls that exist, in selection order (lead last). */
export function scopedSelectedControls(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly ControlRecord[] {
  const out: ControlRecord[] = [];
  for (const id of selectionOf(ctx).controls) {
    const control = view.get('controls', id);
    if (control !== undefined) out.push(control);
  }
  return out;
}

/**
 * The controls an agent run targets: the scope's controls, else the controls of its keys and channels (a scope of
 * keys alone still names their controls). User runs: the selected controls.
 */
export function scopedTargetControls(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly ControlRecord[] {
  const selected = scopedSelectedControls(ctx, view);
  if (selected.length > 0 || !isActorRun(ctx)) return selected;
  const ids: ControlId[] = [];
  const add = (id: ControlId): void => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const { key } of scopedSelectedKeys(ctx, view)) {
    const curve = view.get('curves', key.curve);
    if (curve !== undefined) add(curve.control);
  }
  for (const ref of selectionOf(ctx).channels) add(ref.control);
  return ids.map((id) => view.get('controls', id)).filter((control) => control !== undefined);
}

/**
 * Curves the curve-level operators act on (`workflows/targets` `targetCurves` over the run's targets): the curves of
 * the selected keys; else of the selected channels; else of the selected controls; else — user runs only — every
 * base curve of the clip. Agent runs with an empty scope get none.
 */
export function scopedTargetCurves(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly CurveRecord[] {
  const keys = scopedSelectedKeys(ctx, view);
  if (keys.length > 0) {
    const seen = new Set<CurveId>();
    const curves: CurveRecord[] = [];
    for (const { key } of keys) {
      if (seen.has(key.curve)) continue;
      seen.add(key.curve);
      const curve = view.get('curves', key.curve);
      if (curve !== undefined) curves.push(curve);
    }
    return curves;
  }
  const clip = scopedClipRecord(ctx, view);
  if (clip === undefined) return [];
  const selection = selectionOf(ctx);
  if (selection.channels.length > 0) {
    const wanted = new Set(selection.channels.map((ref) => `${ref.control}\u0000${ref.channel}`));
    return baseCurves(view, clip).filter((curve) => wanted.has(`${curve.control}\u0000${curve.channel}`));
  }
  const selected = scopedSelectedControls(ctx, view);
  if (selected.length > 0) return baseCurves(view, clip, new Set(selected.map((control) => control.id)));
  return isActorRun(ctx) ? [] : baseCurves(view, clip);
}

/** Whole frames for agents (§4.10); the session's `time.snapToFrames` for users. */
export function snapOf(ctx: OperatorContext): boolean {
  return isActorRun(ctx) ? true : ctx.app.session.getState().time.snapToFrames;
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
