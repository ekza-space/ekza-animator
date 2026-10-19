// Targets and frames of the tools (MCP-SPEC §5.1, §5.2, §5.5, §6.1): controls by name, key, VRM bone or id, body parts,
// channels (default: every keyable channel), limbs; frames checked against the clip range (out_of_range) and the
// agent's range limit; curves and keys behind a set of channel targets, for scopes and stale checks.
import type {
  ChannelId,
  CharacterId,
  ClipId,
  ClipRecord,
  ControlId,
  ControlRecord,
  CurveId,
  CurveRecord,
  KeyId,
  KeyRecord,
} from '@ekza-animator/doc';
import { attrChannelsOf, type EditorApp, isKeyable, isKeyAllChannel, isLocked } from '@ekza-animator/editor-core';
import type { LimbDesc } from '@ekza-animator/rig';
import { quoteName } from '../sanitize/sanitize';
import { AgentToolFailure, type Resolver } from '../types';
import { controlKeyOf } from './resolver';

/** The longest clip range an agent may set (§5.2, §5.5). */
export const AGENT_RANGE_MAX = 100_000;
const TRS: readonly ChannelId[] = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];

/** The `Targets` argument of §6.1 as the tools receive it. */
export interface TargetsArg {
  readonly controls?: readonly string[] | undefined;
  readonly bodyParts?: readonly string[] | undefined;
  readonly channels?: readonly string[] | undefined;
}

export interface ChannelTargetRef {
  readonly control: ControlRecord;
  readonly channel: ChannelId;
}

/**
 * Controls one call may resolve through `bodyParts` (§5.5 bounds work by key records, curves and frames; `controls`
 * itself is ≤ 100 in the schemas): a whole rig with its secondary chains fits.
 */
export const CONTROLS_MAX = 1_000;

/** Controls named by `controls` and/or `bodyParts` (deduplicated, in rig order). */
export function resolveControls(
  app: EditorApp,
  resolve: Resolver,
  character: CharacterId,
  refs: readonly string[] | undefined,
  bodyParts: readonly string[] | undefined,
  opts?: { readonly want?: 'fk' | 'ik'; readonly max?: number },
): readonly ControlRecord[] {
  const ids = new Set<ControlId>();
  for (const ref of refs ?? []) ids.add(resolve.control(character, ref, opts?.want).id);
  if (bodyParts !== undefined && bodyParts.length > 0) {
    for (const id of resolve.bodyPartControls(character, bodyParts)) ids.add(id);
  }
  const rig = app.store.query.rigOfCharacter(character);
  const ordered = rig === undefined ? [] : app.store.query.controlsOfRig(rig.id).filter((c) => ids.has(c.id));
  const max = opts?.max ?? CONTROLS_MAX;
  if (ordered.length > max) {
    throw new AgentToolFailure(
      'limit',
      `The call names ${ordered.length} controls; the limit is ${max}.`,
      'split the call by body part or controls',
      { detail: { controls: ordered.length, limit: max } },
    );
  }
  return ordered;
}

/** Every keyable channel of a control (TRS, then its keyable attributes); `keyAll: false` attributes only if named. */
export function keyableChannelsOf(control: ControlRecord, opts?: { readonly includeModes?: boolean }): ChannelId[] {
  const out: ChannelId[] = [];
  for (const channel of TRS) if (isKeyable(control, channel)) out.push(channel);
  for (const channel of attrChannelsOf(control)) {
    if (!isKeyable(control, channel)) continue;
    if (opts?.includeModes !== true && !isKeyAllChannel(control, channel)) continue;
    out.push(channel);
  }
  return out;
}

/**
 * Channel targets of controls: the named channels each control has as keyable channels (default: every keyable
 * channel). A named channel no target control can key is `not_keyable`; locked channels are kept and reported by
 * `isLocked` (the operators skip them); `skipLocked` drops them.
 */
export function channelTargets(
  controls: readonly ControlRecord[],
  channels: readonly string[] | undefined,
  opts?: { readonly skipLocked?: boolean; readonly includeModes?: boolean },
): ChannelTargetRef[] {
  const out: ChannelTargetRef[] = [];
  const named = channels === undefined || channels.length === 0 ? null : (channels as readonly ChannelId[]);
  const used = new Set<string>();
  for (const control of controls) {
    const keyable = keyableChannelsOf(control, { includeModes: named !== null || opts?.includeModes === true });
    for (const channel of named ?? keyable) {
      if (!keyable.includes(channel)) continue;
      if (opts?.skipLocked === true && isLocked(control, channel)) continue;
      used.add(channel);
      out.push({ control, channel });
    }
  }
  if (named !== null) {
    const missing = named.filter((channel) => !used.has(channel));
    if (missing.length === named.length && controls.length > 0) {
      const first = controls[0] as ControlRecord;
      throw new AgentToolFailure(
        'not_keyable',
        `${controlKeyOf(first)} has no keyable channel ${missing.map((c) => quoteName(c)).join(', ')}.`,
        `use the keyable channels of the control (rig_describe): ${keyableChannelsOf(first).join(' ')}`,
        { candidates: keyableChannelsOf(first).slice(0, 5) },
      );
    }
  }
  return out;
}

/** The base-layer curve of a channel target in a clip, if it exists. */
export function curveOf(app: EditorApp, clip: ClipId, control: ControlId, channel: ChannelId): CurveRecord | undefined {
  const layer = app.store.query.baseLayer(clip);
  return layer === undefined ? undefined : app.store.query.curveFor(clip, layer.id, control, channel);
}

/** Curve ids behind channel targets (existing curves only): what a write touches (stale check). */
export function curvesOfTargets(app: EditorApp, clip: ClipId, targets: readonly ChannelTargetRef[]): CurveId[] {
  const out: CurveId[] = [];
  for (const target of targets) {
    const curve = curveOf(app, clip, target.control.id, target.channel);
    if (curve !== undefined) out.push(curve.id);
  }
  return out;
}

/** Keys of channel targets at frames (±1e-6) or inside an inclusive range (all keys when neither is given). */
export function keysOfTargets(
  app: EditorApp,
  clip: ClipId,
  targets: readonly ChannelTargetRef[],
  where: { readonly frames?: readonly number[]; readonly range?: readonly [number, number] },
): { readonly curve: CurveRecord; readonly target: ChannelTargetRef; readonly keys: readonly KeyRecord[] }[] {
  const out: { curve: CurveRecord; target: ChannelTargetRef; keys: KeyRecord[] }[] = [];
  for (const target of targets) {
    const curve = curveOf(app, clip, target.control.id, target.channel);
    if (curve === undefined) continue;
    const keys = app.store.query.keysOfCurve(curve.id).filter((key) => {
      if (where.frames !== undefined) return where.frames.some((frame) => Math.abs(frame - key.t) <= 1e-6);
      if (where.range !== undefined) return key.t >= where.range[0] - 1e-6 && key.t <= where.range[1] + 1e-6;
      return true;
    });
    out.push({ curve, target, keys });
  }
  return out;
}

/** A selection of whole keys (key, in and out handles), for scope-ready operators. */
export function keySelection(keys: readonly KeyId[]): Map<KeyId, { key: boolean; in: boolean; out: boolean }> {
  return new Map(keys.map((key) => [key, { key: true, in: true, out: true }]));
}

/** The clip record (resolved earlier), or `not_found`. */
export function clipRecordOf(app: EditorApp, clip: ClipId): ClipRecord {
  const record = app.store.get('clips', clip);
  if (record === undefined)
    throw new AgentToolFailure('not_found', 'The clip no longer exists.', 'scene_summary lists the clips');
  return record;
}

/**
 * Frames of a write (§5.2): inside the clip range, or `out_of_range` with the range and the hint; with `extendRange`
 * the grown range must stay within the agent's 100,000-frame limit (`limit`). Returns whether the range grows.
 */
export function checkFrames(
  clip: ClipRecord,
  frames: readonly number[],
  opts: { readonly extendRange: boolean; readonly path: string },
): boolean {
  const { start, end } = clip.range;
  const outside = frames.filter((frame) => frame < start - 1e-6 || frame > end + 1e-6);
  if (outside.length === 0) return false;
  if (!opts.extendRange) {
    throw new AgentToolFailure(
      'out_of_range',
      `Frame ${outside[0]} is outside the clip range [${start}, ${end}].`,
      'pass extendRange: true or change the range with clip_update',
      { detail: { path: opts.path, rangeFrames: [start, end], frames: outside.slice(0, 10) } },
    );
  }
  const lo = Math.min(start, ...outside);
  const hi = Math.max(end, ...outside);
  if (hi - lo > AGENT_RANGE_MAX) {
    throw new AgentToolFailure(
      'limit',
      `Growing the range to [${Math.floor(lo)}, ${Math.ceil(hi)}] exceeds ${AGENT_RANGE_MAX.toLocaleString('en')} frames.`,
      'keep the frames closer together, or split the animation into several clips',
      { detail: { path: opts.path } },
    );
  }
  return true;
}

/** Frames of a read (§5.2): inside the clip range, else `out_of_range`. */
export function checkReadFrames(clip: ClipRecord, frames: readonly number[], path: string): void {
  const { start, end } = clip.range;
  const outside = frames.find((frame) => frame < start - 1e-6 || frame > end + 1e-6);
  if (outside === undefined) return;
  throw new AgentToolFailure(
    'out_of_range',
    `Frame ${outside} is outside the clip range [${start}, ${end}].`,
    `read frames inside [${start}, ${end}]`,
    { detail: { path, rangeFrames: [start, end] } },
  );
}

/** A `[start, end]` argument (start ≤ end) or `invalid_args` at `path`. */
export function rangeArg(range: readonly [number, number], path: string): readonly [number, number] {
  if (range[0] > range[1]) {
    throw new AgentToolFailure(
      'invalid_args',
      `${path}: the end comes before the start.`,
      `pass ${path} as [start, end] with start ≤ end`,
      {
        detail: { path },
      },
    );
  }
  return range;
}

/** The limb of a character by id, else `limb_missing` (the hint names rig.addLimbIk). */
export function limbOf(limbs: readonly LimbDesc[], limb: string): LimbDesc {
  const found = limbs.find((candidate) => candidate.id === limb);
  if (found === undefined) {
    throw new AgentToolFailure(
      'limb_missing',
      `The rig has no IK for ${limb}.`,
      `operator_run rig.addLimbIk {limbs: ['${limb}']} adds it (the user confirms)`,
      { retryable: false },
    );
  }
  return found;
}
