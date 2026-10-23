// The actor (agent) side of the run-scope helpers (MCP-SPEC §4.1, §4.10, §5.5, §5.7): what an agent run targets. A
// lazy chunk with the runner's actor rules (`actorRun.ts`, loaded by `loadActorKit` in `scope.ts`): the runner loads
// it before an actor run's first poll, an agent runtime when it attaches (`loadAgentOperators`), so the shipped
// operators' eager files only carry their user paths and a dispatch to this module (M-AI B5, `check:size`).
//
// An agent run reads its `RunScope` — missing parts are empty, never the user's — falls back to nothing where a user
// run falls back to "every curve of the clip" (it poll-fails "No targets"), snaps to whole frames and never writes the
// session.
import type {
  CharacterId,
  ClipId,
  ClipRecord,
  ControlId,
  ControlRecord,
  CurveId,
  CurveRecord,
  KeyId,
  KeyRecord,
  ReadView,
} from '@ekza-studio/doc';
import { planTween } from '../edit/tween';
import type { ChannelRef, CharacterRuntime, KeyPartSelection, OperatorContext, PollResult, Selection } from '../types';
import { baseCurves, type SelectedKey } from '../workflows/targets';
import { AGENT_SPAN_LIMIT } from './builtin/agentBase';
import { fail, OK } from './builtin/define';
import { pollEditable } from './builtin/polls';
import type { TweenRunPlan } from './builtin/tween';

const NONE: readonly never[] = Object.freeze([]);
const NO_CHANNELS: readonly ChannelRef[] = Object.freeze([]);
const NO_KEYS: ReadonlyMap<KeyId, KeyPartSelection> = new Map();

/** Poll reason of an agent run whose scope names nothing to act on (§4.10: "their scope is empty"). */
export const NO_TARGETS = 'No targets: an agent run acts only on the controls, keys or channels of its context';

/** The scope's selection (missing parts empty; the M6a/M6b parts `objects`, `joints` and `constraints` are always
 *  empty: an actor's scope never names them). */
export function selection(ctx: OperatorContext): Selection {
  const scoped = ctx.runScope?.selection;
  return {
    controls: scoped?.controls ?? NONE,
    keys: scoped?.keys ?? NO_KEYS,
    channels: scoped?.channels ?? NO_CHANNELS,
    objects: NONE,
    joints: NONE,
    constraints: NONE,
  };
}

/** runScope.character ?? session.activeCharacter. */
export function characterOf(ctx: OperatorContext): CharacterId | null {
  return ctx.runScope?.character ?? ctx.app.session.getState().activeCharacter;
}

/** runScope.clip when it belongs to `character`, else the character's active clip (the tool layer always passes
 *  `runScope.clip` for live edits, §5.1, so the fallback serves headless projects only). */
export function clipOf(ctx: OperatorContext, character: CharacterId): ClipId | null {
  const clip = ctx.runScope?.clip;
  if (clip !== undefined && ctx.app.store.get('clips', clip)?.character === character) return clip;
  return ctx.app.session.getState().activeClip[character] ?? null;
}

/** The scope's clip record. */
export function clipRecord(ctx: OperatorContext, view: ReadView): ClipRecord | undefined {
  const character = characterOf(ctx);
  if (character === null) return undefined;
  const id = clipOf(ctx, character);
  const clip = id === null ? undefined : view.get('clips', id);
  return clip?.character === character ? clip : undefined;
}

/** True when the scope's selection names nothing (no controls, keys or channels). */
function emptySelection(scoped: Selection): boolean {
  return scoped.controls.length === 0 && scoped.keys.size === 0 && scoped.channels.length === 0;
}

/** An empty scope: "No targets"; otherwise OK. */
export function pollTargets(ctx: OperatorContext): PollResult {
  return emptySelection(selection(ctx)) ? fail(NO_TARGETS) : OK;
}

/** Editable document and the scope's clip to edit. */
export function pollClipEdit(ctx: OperatorContext): PollResult {
  const editable = pollEditable(ctx.app);
  if (editable !== true) return editable;
  if (characterOf(ctx) === null) return fail('No character is loaded');
  return clipRecord(ctx, ctx.app.store) === undefined ? fail('The character has no clip to edit') : OK;
}

/** The scope's selected keys that still exist, in selection order. */
export function selectedKeys(ctx: OperatorContext, view: ReadView): readonly SelectedKey[] {
  const out: SelectedKey[] = [];
  for (const [id, parts] of selection(ctx).keys) {
    const key = view.get('keys', id);
    if (key !== undefined && (parts.key || parts.in || parts.out)) out.push({ key, parts });
  }
  return out;
}

/** Ids of the scope's selected keys whose key part is selected. */
export function selectedKeyIds(ctx: OperatorContext, view: ReadView): readonly KeyId[] {
  return selectedKeys(ctx, view)
    .filter((s) => s.parts.key)
    .map((s) => s.key.id);
}

/** The scope's controls that exist, in selection order (lead last). */
function selectedControls(ctx: OperatorContext, view: ReadView): readonly ControlRecord[] {
  const out: ControlRecord[] = [];
  for (const id of selection(ctx).controls) {
    const control = view.get('controls', id);
    if (control !== undefined) out.push(control);
  }
  return out;
}

/** The scope's controls, else the controls of its keys and channels (a scope of keys alone still names them). */
export function targetControls(ctx: OperatorContext, view: ReadView): readonly ControlRecord[] {
  const selected = selectedControls(ctx, view);
  if (selected.length > 0) return selected;
  const ids: ControlId[] = [];
  const add = (id: ControlId): void => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const { key } of selectedKeys(ctx, view)) {
    const curve = view.get('curves', key.curve);
    if (curve !== undefined) add(curve.control);
  }
  for (const ref of selection(ctx).channels) add(ref.control);
  return ids.map((id) => view.get('controls', id)).filter((control) => control !== undefined);
}

/** The curves of the scope's keys; else of its channels; else of its controls; an empty scope gets none. */
export function targetCurves(ctx: OperatorContext, view: ReadView): readonly CurveRecord[] {
  const keys = selectedKeys(ctx, view);
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
  const clip = clipRecord(ctx, view);
  if (clip === undefined) return [];
  const scoped = selection(ctx);
  if (scoped.channels.length > 0) {
    const wanted = new Set(scoped.channels.map((ref) => `${ref.control}\u0000${ref.channel}`));
    return baseCurves(view, clip).filter((curve) => wanted.has(`${curve.control}\u0000${curve.channel}`));
  }
  const selected = selectedControls(ctx, view);
  return selected.length > 0 ? baseCurves(view, clip, new Set(selected.map((control) => control.id))) : [];
}

/** `key.tween` without `frames`: the scope's selected keys (an agent never tweens at the user's playhead). */
export function tweenPlan(ctx: OperatorContext, target: 'frame' | 'keys' | undefined): TweenRunPlan | string {
  if (target === 'frame') return 'An agent tween at a pose needs frames (the playhead is the user’s)';
  const plan = planTween(ctx.app, { kind: 'keys', keys: selectedKeyIds(ctx, ctx.app.store) });
  return { plans: [plan], empty: 'Nothing to tween: the selected keys need unselected keys before and after them' };
}

/**
 * §5.5: Simplify measures every frame between a curve's first and last key, so an agent run poll-fails when a target
 * curve spans more than 100,000 frames (a synchronous loop cannot be interrupted).
 */
export function pollSimplifySpan(ctx: OperatorContext): PollResult {
  for (const curve of targetCurves(ctx, ctx.app.store)) {
    const keys = ctx.app.store.query.keysOfCurve(curve.id);
    const first = keys[0];
    const last = keys.at(-1);
    if (first !== undefined && last !== undefined && last.t - first.t > AGENT_SPAN_LIMIT) {
      return fail(`A curve spans more than ${AGENT_SPAN_LIMIT} frames; simplify a shorter clip`);
    }
  }
  return OK;
}

/** `rig.ikFk.matchRange`: an agent run names its clip and range (it never reads the session) within the span. */
export function matchRangeProblem(clip: unknown, range: { readonly start: number; readonly end: number } | null) {
  if (clip === undefined || range === null) return 'An agent Match Range needs its clip and range';
  return range.end - range.start > AGENT_SPAN_LIMIT ? `The range spans more than ${AGENT_SPAN_LIMIT} frames` : null;
}

/** The runtime of the scope's character. */
export function runtimeOf(ctx: OperatorContext): CharacterRuntime | undefined {
  const character = characterOf(ctx);
  return character === null ? undefined : ctx.app.characters.get(character);
}

/** `pose.mirrorAnimation`: the scope's character has a runtime. */
export function pollRuntime(ctx: OperatorContext): PollResult {
  return runtimeOf(ctx) === undefined ? fail('The character is still loading') : OK;
}

/** `pose.mirrorAnimation`: agent runs never fall back to "the whole character": they name controls. */
export function pollMirrorTargets(ctx: OperatorContext, controls: readonly ControlId[] | undefined): PollResult {
  return (controls ?? targetControls(ctx, ctx.app.store)).length === 0 ? fail(NO_TARGETS) : OK;
}

/** `key.convert`: the scope's selected keys only — never the playhead, the key target or the user's selection. */
export function convertTargets(
  ctx: OperatorContext,
  view: ReadView,
  editable: (view: ReadView, key: KeyRecord) => boolean,
): readonly KeyRecord[] {
  const out: KeyRecord[] = [];
  for (const id of selectedKeyIds(ctx, view)) {
    const key = view.get('keys', id);
    if (key !== undefined && editable(view, key)) out.push(key);
  }
  return out;
}
