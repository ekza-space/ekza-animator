// Shared steps of the task-level tools (MCP-SPEC §5.1, §5.3, §5.6, §5.12): resolve the character and clip a call
// addresses, describe the clip in the result (`clip`, which marks it seen), check staleness before a write, run one
// operator and shape the result (`undo`, warnings). Tool owners outside P2 (operator_run, files, analysis, see) may use
// these too.
import type { CharacterId, ClipId, ClipRecord, CurveId } from '@ekza-animator/doc';
import type { CharacterRuntime } from '@ekza-animator/editor-core';
import { finishedValue } from '../envelope/errors';
import { runtimeOf } from '../units/pose';
import { fpsNumber } from '../units/units';
import type { AgentToolContext, AgentToolResult, ClipInfo, OperatorRun, UndoInfo } from '../types';
import { AgentToolFailure } from '../types';

export interface Addressed {
  readonly character: { readonly id: CharacterId; readonly name: string };
  readonly clip: { readonly id: ClipId; readonly name: string };
  readonly record: ClipRecord;
  readonly runtime: CharacterRuntime;
}

/** The character and clip of a project-scoped call (§5.1: edits with a user session must name the clip). */
export function addressed(
  ctx: AgentToolContext,
  args: { readonly character?: string | undefined; readonly clip?: string | undefined },
): Addressed {
  const character = ctx.resolve.character(args.character);
  const clip = ctx.resolve.clip(character.id, args.clip);
  const record = ctx.app.store.get('clips', clip.id);
  if (record === undefined)
    throw new AgentToolFailure('not_found', 'The clip no longer exists.', 'scene_summary lists the clips');
  return { character, clip, record, runtime: runtimeOf(ctx.app, character.id) };
}

/** The `clip` of a result (§5.3): names, fps, range, loop and revision; marks the revision as seen (§5.12). */
export function clipInfo(ctx: AgentToolContext, clip: ClipId): ClipInfo {
  const record = ctx.app.store.get('clips', clip);
  if (record === undefined)
    throw new AgentToolFailure('not_found', 'The clip no longer exists.', 'scene_summary lists the clips');
  const character = ctx.app.store.get('characters', record.character);
  ctx.revisions.markSeen(clip);
  return {
    character: character?.name ?? record.character,
    name: record.name,
    fps: fpsNumber(record.fps),
    rangeFrames: [record.range.start, record.range.end],
    loop: record.loop,
    revision: ctx.revisions.revision(clip),
  };
}

/**
 * The stale check before a write (§5.12): strict with `ifClipRevision`, else automatic over the curves (and the clip
 * record) the write touches. Returns a warning when only other curves changed.
 */
export function staleCheck(
  ctx: AgentToolContext,
  clip: ClipId,
  ifClipRevision: number | undefined,
  touches: { readonly curves: readonly CurveId[] | 'all'; readonly clipRecord: boolean },
): string | null {
  return ctx.revisions.check(clip, ifClipRevision, touches);
}

/** The value of a finished operator run, else the mapped tool error (§5.4). */
export function valueOf<T>(operator: string, run: OperatorRun): T {
  return finishedValue(operator, run.result) as T;
}

/** The `undo` of a write that recorded a step. */
export function undoOf(run: OperatorRun): { readonly undo?: UndoInfo } {
  return run.step === null ? {} : { undo: { step: run.step.id, label: run.step.label } };
}

/** The success envelope of a write: data, clip (seen), undo, warnings (deduplicated, empty ones dropped). */
export function writeResult<D>(
  ctx: AgentToolContext,
  clip: ClipId | null,
  run: OperatorRun | null,
  data: D,
  warnings: readonly (string | null | undefined)[] = [],
  next?: string,
): AgentToolResult<D> {
  const list = [...new Set(warnings.filter((w): w is string => typeof w === 'string' && w !== ''))];
  return {
    ok: true,
    data,
    ...(clip === null ? {} : { clip: clipInfo(ctx, clip) }),
    ...(run === null ? {} : undoOf(run)),
    ...(list.length === 0 ? {} : { warnings: list }),
    ...(next === undefined ? {} : { next }),
  };
}

/** `@ f12` (§5.6 labels). */
export function atFrame(frame: number): string {
  return `@ f${Number.isInteger(frame) ? frame : frame.toFixed(2)}`;
}

/** `3 controls`, `1 control`. */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

/** `"walk"` for a clip name in a label (≤ 24 characters). */
export function labelName(name: string): string {
  return `"${name.length > 24 ? `${name.slice(0, 23)}…` : name}"`;
}
