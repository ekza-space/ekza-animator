// Shared checks and reads of the M-AI explicit-target operators (MCP-SPEC §4.10, §5.5): range bounds, `extendRange`,
// channel targets, the keyed pose of a clip at a frame (never the user's overrides) and the `hiddenByOverrides` report
// (§5.12). Loaded with the implementation (`agentLoad.ts`); nothing here writes the session.
import { EkzaError, type Frame } from '@ekza-studio/anim-core';
import type { ChannelId, ChannelValues, ClipRecord, ControlId, ControlRecord, ReadView, Tx } from '@ekza-studio/doc';
import { readControlChannels } from '@ekza-studio/rig';
import { attrChannelsOf, attrDefOf, isTrsChannel } from '../../edit/channelMeta';
import { SAME_FRAME_EPS } from '../../edit/context';
import type { CharacterRuntime, EditorApp } from '../../types';
import type { ChannelTarget } from '../args';
import { AGENT_SPAN_LIMIT, AGENT_WRITE_LIMIT, frameProblem } from './agentLoad';
import { isRecord } from './define';

/** The transaction of an undoable operator's apply. */
export function txOf(tx: Tx | null, id: string): Tx {
  if (tx === null) throw new EkzaError('internal', `${id} runs in a transaction`);
  return tx;
}

/** The clip record as the transaction sees it. */
export function requireClipIn(tx: Tx, clip: ClipRecord['id']): ClipRecord {
  const record = tx.get('clips', clip);
  if (record === undefined) throw new EkzaError('invalid-record', `Clip ${clip} does not exist`);
  return record;
}

/** The runtime of the clip's character (the operators' polls checked it). */
export function requireRuntime(app: EditorApp, clip: ClipRecord): CharacterRuntime {
  const runtime = runtimeOfClip(app, clip);
  if (typeof runtime === 'string') throw new EkzaError('unsupported', runtime);
  return runtime;
}

/** Why a `label` argument is malformed, or null. */
export function labelProblem(args: Readonly<Record<string, unknown>>): string | null {
  const label = args['label'];
  return label === undefined || typeof label === 'string' ? null : 'label must be a string';
}

/** The runtime (rig program, sampler) of the clip's character, or why there is none. */
export function runtimeOfClip(app: EditorApp, clip: ClipRecord): CharacterRuntime | string {
  const runtime = app.characters.get(clip.character);
  return runtime === undefined ? 'The character is still loading' : runtime;
}

/** Why a `{start, end}` range argument is malformed, or null. */
export function rangeProblem(value: unknown, name = 'range'): string | null {
  if (!isRecord(value)) return `${name} must be { start, end }`;
  const start = frameProblem(value['start'], `${name}.start`);
  if (start !== null) return start;
  const end = frameProblem(value['end'], `${name}.end`);
  if (end !== null) return end;
  return (value['end'] as number) < (value['start'] as number) ? `${name} ends before it starts` : null;
}

function rangeText(clip: ClipRecord): string {
  return `${clip.range.start}…${clip.range.end}`;
}

/** The clip range grown to include `frames`. */
export function grownRange(clip: ClipRecord, frames: Iterable<Frame>): { readonly start: Frame; readonly end: Frame } {
  let { start, end } = clip.range;
  for (const frame of frames) {
    if (frame < start) start = frame;
    if (frame > end) end = frame;
  }
  return { start, end };
}

/**
 * Frames outside the clip range poll-fail unless `extendRange` (§4.10 `key.write`); a grown range stays ≤ 100,000
 * frames (§5.5). Null when the frames may be written.
 */
export function rangeExtensionProblem(clip: ClipRecord, frames: Iterable<Frame>, extendRange: boolean): string | null {
  const list = [...frames];
  const outside = list.find(
    (frame) => frame < clip.range.start - SAME_FRAME_EPS || frame > clip.range.end + SAME_FRAME_EPS,
  );
  if (outside === undefined) return null;
  if (!extendRange)
    return `Frame ${outside} is outside the clip range ${rangeText(clip)} (pass extendRange to grow it)`;
  const range = grownRange(clip, list);
  return range.end - range.start > AGENT_SPAN_LIMIT
    ? `The clip range would grow beyond ${AGENT_SPAN_LIMIT} frames`
    : null;
}

/** Grows the clip range in `tx` to include `frames` (whole frames outward); true when it changed. */
export function extendClipRange(tx: Tx, clip: ClipRecord, frames: Iterable<Frame>): boolean {
  const range = grownRange(clip, frames);
  const start = Math.floor(range.start + SAME_FRAME_EPS);
  const end = Math.ceil(range.end - SAME_FRAME_EPS);
  if (start === clip.range.start && end === clip.range.end) return false;
  tx.patch('clips', clip.id, {
    range: { start: Math.min(start, clip.range.start), end: Math.max(end, clip.range.end) },
  });
  return true;
}

/** A control of the clip's character, or undefined. */
export function controlOfClip(view: ReadView, clip: ClipRecord, control: unknown): ControlRecord | undefined {
  if (typeof control !== 'string') return undefined;
  const record = view.get('controls', control as ControlId);
  if (record === undefined) return undefined;
  return view.get('rigs', record.rig)?.character === clip.character ? record : undefined;
}

/** A channel the control has: a TRS channel or one of its '@name' attributes. */
export function isChannelOf(control: ControlRecord, channel: unknown): channel is ChannelId {
  if (typeof channel !== 'string') return false;
  if (channel.startsWith('@')) return attrDefOf(control, channel as ChannelId) !== undefined;
  return isTrsChannel(channel as ChannelId);
}

/** Why a `{control, channel}` target does not name a channel of the clip's character, or null. */
export function targetProblem(view: ReadView, clip: ClipRecord, target: unknown, name: string): string | null {
  if (!isRecord(target)) return `${name} must be { control, channel }`;
  const control = controlOfClip(view, clip, target['control']);
  if (control === undefined) return `${name}: the control is not one of the clip's character`;
  return isChannelOf(control, target['channel'])
    ? null
    : `${name}: ${control.key} has no channel ${String(target['channel'])}`;
}

/** Why a target list is malformed, or null. */
export function targetsProblem(view: ReadView, clip: ClipRecord, value: unknown, name = 'targets'): string | null {
  if (!Array.isArray(value)) return `${name} must be a list of { control, channel }`;
  const list = value as readonly unknown[];
  if (list.length > AGENT_WRITE_LIMIT) return `${name} has more than ${AGENT_WRITE_LIMIT} entries`;
  for (let i = 0; i < list.length; i++) {
    const problem = targetProblem(view, clip, list[i], `${name}[${i}]`);
    if (problem !== null) return problem;
  }
  return null;
}

/** Targets without duplicates, in first-seen order. */
export function uniqueTargets<T extends ChannelTarget>(targets: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const target of targets) {
    const id = `${target.control}\u0000${target.channel}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(target);
  }
  return out;
}

/** The base-layer curve of a control channel in a clip (no curve: undefined). */
export function baseCurveIn(view: ReadView, clip: ClipRecord, control: ControlId, channel: ChannelId) {
  const layer = view.query.baseLayer(clip.id);
  return layer === undefined ? undefined : view.query.curveFor(clip.id, layer.id, control, channel);
}

/**
 * The keyed pose of `controls` in `clip` at a clip frame: the committed curves, static values and defaults through
 * the clip sampler, never the user's overrides (`evaluateAt(…, {withOverrides: false})` in channel form). TRS
 * channels and every '@name' attribute the program knows.
 */
export function keyedValuesAt(
  runtime: CharacterRuntime,
  clip: ClipRecord,
  frame: Frame,
  controls: Iterable<ControlId>,
  view: ReadView,
): Map<ControlId, ChannelValues> {
  const program = runtime.program;
  const ch = program.allocChannels();
  runtime.sampler(clip.id).sample(frame, ch);
  const out = new Map<ControlId, ChannelValues>();
  for (const id of controls) {
    if (!program.controlIndex.has(id)) continue;
    const values: Record<string, number> = { ...readControlChannels(program, ch, id) };
    for (const channel of attrChannelsOf(view.get('controls', id))) {
      const slot = program.attrIndex.get(`${id}/${channel}`);
      if (slot !== undefined) values[channel] = ch.attrs[slot] as number;
    }
    out.set(id, values);
  }
  return out;
}

/**
 * §5.12: the written channels the user's unkeyed overrides hide, i.e. where the clip is its character's active clip,
 * the frame is the character's current clip frame and the user has an override on that channel. Reads the session
 * (for the report only); never writes it.
 */
export function hiddenByOverrides(
  app: EditorApp,
  clip: ClipRecord,
  written: Iterable<ChannelTarget & { readonly frame: Frame }>,
): ChannelTarget[] {
  const state = app.session.getState();
  if (state.overrides.size === 0 || state.activeClip[clip.character] !== clip.id) return [];
  const current = app.evaluation.clipFrame(clip.character);
  if (current === null) return [];
  const hidden: ChannelTarget[] = [];
  for (const item of written) {
    if (Math.abs(item.frame - current) >= SAME_FRAME_EPS) continue;
    if (state.overrides.get(item.control)?.[item.channel] === undefined) continue;
    hidden.push({ control: item.control, channel: item.channel });
  }
  return uniqueTargets(hidden);
}
