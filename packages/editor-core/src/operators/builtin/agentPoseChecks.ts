// The polls of the M-AI explicit-target pose operators (MCP-SPEC §4.10, §5.5) and the reads they share with the
// applies: `pose.setAt` (stored values per channel; `propose` needs the user's active clip at its current frame),
// `pose.transfer` (the source pose, mirrored when asked) and `pose.goals` (aims and IK goals checked against the keyed
// pose at the frame). Loaded with the implementation (`agentLoad.ts`); the definitions live in `agentPose.ts`.
import type { Frame, Quat, TangentType, Vec3 } from '@ekza-animator/anim-core';
import type { ChannelId, ChannelValues, ClipRecord, ControlId, ControlRecord, Tx } from '@ekza-animator/doc';
import { type LimbId, type MirrorMode, mirrorPose } from '@ekza-animator/rig';
import { attrChannelsOf, isKeyable, isKeyAllChannel, isLocked } from '../../edit/channelMeta';
import { SAME_FRAME_EPS } from '../../edit/context';
import type { CharacterRuntime, EditorApp, OperatorContext, PollResult } from '../../types';
import { boneNode, drivingControl, IK_FROM, ikFkIn, limbOfNode, SPLIT_BONE } from '../../workflows/goalTargets';
import { LIMB_NAME, LIMB_ORDER } from '../../workflows/ik';
import type { ChannelTarget } from '../args';
import {
  controlOfClip,
  isChannelOf,
  keyedValuesAt,
  labelProblem,
  rangeExtensionProblem,
  rangeProblem,
  requireRuntime,
  runtimeOfClip,
} from './agentCommon';
import { TANGENTS } from './agentKeyChecks';
import { AGENT_WRITE_LIMIT, clipArg, frameProblem, framesProblem, pollAgentClip } from './agentLoad';
import { fail, isFiniteNumber, isRecord, OK } from './define';

const MODES = ['key', 'static', 'propose'] as const;

// ---------- pose.setAt ----------

export interface SetAtArgs {
  readonly clip: ClipRecord['id'];
  readonly frame: Frame;
  readonly edits: readonly { readonly control: ControlId; readonly channel: ChannelId; readonly value: number }[];
  readonly mode: 'key' | 'static' | 'propose';
  readonly tangent?: TangentType;
  readonly syncRotation?: boolean;
  readonly extendRange?: boolean;
}

export type Skip = ChannelTarget & { readonly reason: 'locked' | 'non-keyable' | 'animated' };

/** Why a `propose` cannot run: it needs the user's active clip at its current frame on the active character. */
function proposeProblem(app: EditorApp, clip: ClipRecord, frame: Frame): string | null {
  const state = app.session.getState();
  if (state.activeCharacter !== clip.character || state.activeClip[clip.character] !== clip.id) {
    return "A proposal needs the user's active clip";
  }
  const current = app.evaluation.clipFrame(clip.character);
  if (current === null || Math.abs(current - frame) >= SAME_FRAME_EPS) {
    return `A proposal needs the user's current frame (${current ?? 'none'})`;
  }
  return null;
}

function setAtProblem(app: EditorApp, clip: ClipRecord, args: Readonly<Record<string, unknown>>): string | null {
  const problem = labelProblem(args) ?? frameProblem(args['frame'], 'frame');
  if (problem !== null) return problem;
  if (!MODES.includes(args['mode'] as (typeof MODES)[number])) return `mode is one of ${MODES.join(', ')}`;
  if (args['tangent'] !== undefined && !TANGENTS.includes(args['tangent'] as TangentType)) return 'unknown tangent';
  for (const flag of ['syncRotation', 'extendRange'] as const) {
    if (args[flag] !== undefined && typeof args[flag] !== 'boolean') return `${flag} must be a boolean`;
  }
  const edits = args['edits'];
  if (!Array.isArray(edits)) return 'edits must be a list of { control, channel, value }';
  const list = edits as readonly unknown[];
  if (list.length === 0) return 'Nothing to set: edits is empty';
  if (list.length > AGENT_WRITE_LIMIT) return `edits has more than ${AGENT_WRITE_LIMIT} entries`;
  for (let i = 0; i < list.length; i++) {
    const edit = list[i];
    if (!isRecord(edit)) return `edits[${i}] must be { control, channel, value }`;
    const control = controlOfClip(app.store, clip, edit['control']);
    if (control === undefined) return `edits[${i}]: the control is not one of the clip's character`;
    if (!isChannelOf(control, edit['channel']))
      return `edits[${i}]: ${control.key} has no channel ${String(edit['channel'])}`;
    if (!isFiniteNumber(edit['value'])) return `edits[${i}].value must be a finite number`;
  }
  const frame = args['frame'] as Frame;
  if (args['mode'] === 'propose') return proposeProblem(app, clip, frame);
  if (args['mode'] === 'key') {
    const range = rangeExtensionProblem(clip, [frame], args['extendRange'] === true);
    if (range !== null) return range;
    if (args['syncRotation'] !== false && typeof runtimeOfClip(app, clip) === 'string')
      return 'The character is still loading';
  }
  return null;
}

export function skipOf(control: ControlRecord, channel: ChannelId): Skip['reason'] | null {
  if (!isKeyable(control, channel)) return 'non-keyable';
  if (isLocked(control, channel)) return 'locked';
  return null;
}

export function pollPoseSetAt({ app }: OperatorContext, raw: unknown): PollResult {
  const base = pollAgentClip(app, raw);
  if (base !== true) return base;
  const problem = setAtProblem(app, clipArg(app.store, raw) as ClipRecord, raw as Readonly<Record<string, unknown>>);
  return problem === null ? OK : fail(problem);
}

// ---------- pose.transfer ----------

const MIRRORS: readonly (MirrorMode | 'none')[] = ['none', 'flip', 'leftToRight', 'rightToLeft'];

export interface TransferArgs {
  readonly clip: ClipRecord['id'];
  readonly fromClip?: ClipRecord['id'];
  readonly fromFrame: Frame;
  readonly toFrames: readonly Frame[];
  readonly controls: readonly ControlId[];
  readonly mirror: MirrorMode | 'none';
  readonly extendRange?: boolean;
}

/** Pose channels of a control the transfer keys: keyable, unlocked TRS channels and `keyAll` attributes. */
export function transferChannels(control: ControlRecord): readonly ChannelId[] {
  const trs = (['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const).filter(
    (channel) => isKeyable(control, channel) && !isLocked(control, channel),
  );
  const attrs = attrChannelsOf(control).filter(
    (channel) => isKeyable(control, channel) && isKeyAllChannel(control, channel),
  );
  return [...trs, ...attrs];
}

/** The values the transfer keys per control: the source pose, mirrored when asked. */
export function transferValues(
  app: EditorApp,
  view: Tx | EditorApp['store'],
  args: TransferArgs,
): Map<ControlId, ChannelValues> {
  const clip = view.get('clips', args.clip) as ClipRecord;
  const source = args.fromClip === undefined ? clip : (view.get('clips', args.fromClip) as ClipRecord);
  const runtime = requireRuntime(app, clip);
  if (args.mirror === 'none') return keyedValuesAt(runtime, source, args.fromFrame, args.controls, view);
  const all = keyedValuesAt(runtime, source, args.fromFrame, runtime.program.controlIds, view);
  return mirrorPose(runtime.program, all, args.mirror, new Set(args.controls)).values;
}

function transferProblem(app: EditorApp, clip: ClipRecord, args: Readonly<Record<string, unknown>>): string | null {
  const problem =
    labelProblem(args) ?? frameProblem(args['fromFrame'], 'fromFrame') ?? framesProblem(args['toFrames'], 'toFrames');
  if (problem !== null) return problem;
  if (args['extendRange'] !== undefined && typeof args['extendRange'] !== 'boolean')
    return 'extendRange must be a boolean';
  if (!MIRRORS.includes(args['mirror'] as MirrorMode | 'none')) return `mirror is one of ${MIRRORS.join(', ')}`;
  if (args['fromClip'] !== undefined) {
    const from = clipArg(app.store, args, 'fromClip');
    if (from === undefined) return 'The source clip does not exist';
    if (from.character !== clip.character) return 'The source clip belongs to another character';
  }
  const controls = args['controls'];
  if (!Array.isArray(controls) || (controls as readonly unknown[]).length === 0)
    return 'controls must name at least one control';
  for (const control of controls as readonly unknown[]) {
    if (controlOfClip(app.store, clip, control) === undefined)
      return "controls: a control is not one of the clip's character";
  }
  const runtime = runtimeOfClip(app, clip);
  if (typeof runtime === 'string') return runtime;
  const range = rangeExtensionProblem(clip, args['toFrames'] as readonly Frame[], args['extendRange'] === true);
  if (range !== null) return range;
  return null;
}

export function pollPoseTransfer({ app }: OperatorContext, raw: unknown): PollResult {
  const base = pollAgentClip(app, raw);
  if (base !== true) return base;
  const clip = clipArg(app.store, raw) as ClipRecord;
  const problem = transferProblem(app, clip, raw as Readonly<Record<string, unknown>>);
  if (problem !== null) return fail(problem);
  const args = raw as TransferArgs;
  let count = 0;
  for (const id of transferValues(app, app.store, args).keys()) {
    const control = app.store.get('controls', id);
    if (control !== undefined) count += transferChannels(control).length * new Set(args.toFrames).size;
  }
  if (count === 0) return fail('Nothing to transfer: the controls have no keyable channels');
  return count > AGENT_WRITE_LIMIT ? fail(`The transfer would write more than ${AGENT_WRITE_LIMIT} keys`) : OK;
}

// ---------- pose.goals ----------

export interface GoalsArgs {
  readonly clip: ClipRecord['id'];
  readonly frame: Frame;
  readonly aims?: readonly {
    readonly bone: string;
    readonly direction: Vec3;
    readonly keepTwist: boolean;
    readonly weight: number;
    readonly split?: { readonly neck: number; readonly head: number };
  }[];
  readonly ik?: readonly {
    readonly limb: LimbId;
    readonly position?: Vec3;
    readonly rotation?: Quat;
    readonly pole?: Vec3;
    readonly ensureIk: 'never' | 'auto';
    readonly switchRange?: { readonly start: Frame; readonly end: Frame };
  }[];
  readonly extendRange?: boolean;
}

function vec3Problem(value: unknown, name: string, unit: boolean): string | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) return `${name} must be [x, y, z]`;
  if (unit && Math.hypot(...value) < 1e-9) return `${name} must not be zero`;
  if (!unit && value.some((v: number) => Math.abs(v) > 1000)) return `${name} must lie within ±1000 m`;
  return null;
}

/** The keyed channel buffer of a clip frame (no overrides). */
export function keyedChannels(runtime: CharacterRuntime, clip: ClipRecord, frame: Frame) {
  const ch = runtime.program.allocChannels();
  runtime.sampler(clip.id).sample(frame, ch);
  return ch;
}

function goalsProblem(app: EditorApp, clip: ClipRecord, args: Readonly<Record<string, unknown>>): string | null {
  const problem = labelProblem(args) ?? frameProblem(args['frame'], 'frame');
  if (problem !== null) return problem;
  if (args['extendRange'] !== undefined && typeof args['extendRange'] !== 'boolean')
    return 'extendRange must be a boolean';
  const runtime = runtimeOfClip(app, clip);
  if (typeof runtime === 'string') return runtime;
  const aims = args['aims'] ?? [];
  const ik = args['ik'] ?? [];
  if (!Array.isArray(aims) || !Array.isArray(ik)) return 'aims and ik must be lists';
  if ((aims as unknown[]).length + (ik as unknown[]).length === 0) return 'Nothing to pose: pass aims or ik';
  if ((aims as unknown[]).length > 64 || (ik as unknown[]).length > LIMB_ORDER.length) return 'too many goals';
  const frame = args['frame'] as Frame;
  const range = rangeExtensionProblem(clip, [frame], args['extendRange'] === true);
  if (range !== null) return range;
  const program = runtime.program;
  const ch = keyedChannels(runtime, clip, frame);
  const seen = new Set<number>();
  for (let i = 0; i < (aims as unknown[]).length; i++) {
    const aim = (aims as unknown[])[i];
    const name = `aims[${i}]`;
    if (!isRecord(aim) || typeof aim['bone'] !== 'string')
      return `${name} must be { bone, direction, keepTwist, weight }`;
    const node = boneNode(runtime, aim['bone']);
    if (node < 0) return `${name}: no bone ${aim['bone']}`;
    if (seen.has(node)) return `${name}: ${aim['bone']} is aimed twice`;
    seen.add(node);
    if (drivingControl(program, node) === null) return `${name}: no control rotates ${aim['bone']}`;
    const direction = vec3Problem(aim['direction'], `${name}.direction`, true);
    if (direction !== null) return direction;
    if (typeof aim['keepTwist'] !== 'boolean') return `${name}.keepTwist must be a boolean`;
    if (!isFiniteNumber(aim['weight']) || aim['weight'] < 0 || aim['weight'] > 1)
      return `${name}.weight must lie in 0…1`;
    const split = aim['split'];
    if (split !== undefined) {
      if (aim['bone'] !== SPLIT_BONE) return `${name}.split is for head aims only`;
      if (!isRecord(split) || !isFiniteNumber(split['neck']) || !isFiniteNumber(split['head'])) {
        return `${name}.split must be { neck, head }`;
      }
      if (split['neck'] < 0 || split['head'] < 0 || split['neck'] + split['head'] <= 0) {
        return `${name}.split shares must be ≥ 0 and not both 0`;
      }
    }
    const limb = limbOfNode(program, node);
    if (limb !== null && ikFkIn(limb, ch) > 1e-9) {
      return `${aim['bone']} is IK-driven (${LIMB_NAME[limb.id] ?? limb.id}); use pose_ik_target`;
    }
  }
  const limbs = new Set<string>();
  for (let i = 0; i < (ik as unknown[]).length; i++) {
    const goal = (ik as unknown[])[i];
    const name = `ik[${i}]`;
    if (!isRecord(goal) || !LIMB_ORDER.includes(goal['limb'] as LimbId))
      return `${name}.limb is one of ${LIMB_ORDER.join(', ')}`;
    const limbId = goal['limb'] as LimbId;
    if (limbs.has(limbId)) return `${name}: ${limbId} is placed twice`;
    limbs.add(limbId);
    const limb = program.limbs.find((candidate) => candidate.id === limbId);
    if (limb === undefined) return `${name}: the character has no ${LIMB_NAME[limbId] ?? limbId} IK`;
    if (goal['position'] === undefined && goal['rotation'] === undefined && goal['pole'] === undefined) {
      return `${name} needs position, rotation or pole`;
    }
    for (const field of ['position', 'pole'] as const) {
      if (goal[field] !== undefined) {
        const problemOf = vec3Problem(goal[field], `${name}.${field}`, false);
        if (problemOf !== null) return problemOf;
      }
    }
    const rotation = goal['rotation'];
    if (rotation !== undefined) {
      if (!Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(isFiniteNumber)) {
        return `${name}.rotation must be a quaternion [x, y, z, w]`;
      }
      if (Math.hypot(...rotation) < 1e-9) return `${name}.rotation must not be zero`;
    }
    if (goal['ensureIk'] !== 'never' && goal['ensureIk'] !== 'auto') return `${name}.ensureIk is 'never' or 'auto'`;
    const isIk = ikFkIn(limb, ch) >= IK_FROM;
    if (goal['ensureIk'] === 'never') {
      if (!isIk) return "the limb is FK at this frame; use pose_aim, or pass ensureIk 'auto' with a switch range";
      continue;
    }
    const switchRange = goal['switchRange'];
    if (switchRange === undefined) return `${name}: ensureIk 'auto' needs switchRange`;
    const rangeIssue = rangeProblem(switchRange, `${name}.switchRange`);
    if (rangeIssue !== null) return rangeIssue;
    const { start, end } = switchRange as { readonly start: Frame; readonly end: Frame };
    if (frame < start - SAME_FRAME_EPS || frame > end + SAME_FRAME_EPS)
      return `${name}.switchRange must contain the frame`;
    if (start < clip.range.start - SAME_FRAME_EPS || end > clip.range.end + SAME_FRAME_EPS) {
      return `${name}.switchRange must lie inside the clip range ${clip.range.start}…${clip.range.end}`;
    }
  }
  return null;
}

export function pollPoseGoals({ app }: OperatorContext, raw: unknown): PollResult {
  const base = pollAgentClip(app, raw);
  if (base !== true) return base;
  const problem = goalsProblem(app, clipArg(app.store, raw) as ClipRecord, raw as Readonly<Record<string, unknown>>);
  return problem === null ? OK : fail(problem);
}
