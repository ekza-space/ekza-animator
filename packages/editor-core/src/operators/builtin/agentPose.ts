// M-AI explicit-target pose operators (MCP-SPEC §4.10): `pose.setAt`, `pose.goals`, `pose.transfer`. Stored units,
// explicit clip and frame; only `pose.setAt {mode: 'propose'}` reads the session (the user's current frame) and writes
// it (unkeyed overrides, View access). One transaction each; `internal`.
import { EkzaError, type Frame, type Quat, type TangentType, type Vec3 } from '@ekza-animator/anim-core';
import type { ChannelId, ChannelValues, ClipRecord, ControlId, ControlRecord, KeyRecord, Tx } from '@ekza-animator/doc';
import { type LimbDesc, type LimbId, type MirrorMode, mirrorPose, writeControlChannels } from '@ekza-animator/rig';
import {
  attrChannelsOf,
  isKeyable,
  isKeyAllChannel,
  isLocked,
  newKeyTangents,
  ROTATE_CHANNELS,
} from '../../edit/channelMeta';
import { compileInTx, SAME_FRAME_EPS } from '../../edit/context';
import { ensureCurve, writeKeyAt } from '../../edit/keys';
import { internalsOf } from '../../app/internals';
import { type CharacterRuntime, type EditorApp, GLOBAL_SCOPE, type OperatorContext } from '../../types';
import {
  type AimRequest,
  aimResult,
  applyAim,
  applyIkGoal,
  boneNode,
  type ChannelFilter,
  drivingControl,
  type GoalState,
  IK_FROM,
  ikFkIn,
  limbOfNode,
  REACHED_M,
  restPoseOf,
  SPLIT_BONE,
} from '../../workflows/goals';
import { channelsAt, LIMB_NAME, LIMB_ORDER, limbContext, matchAt, matchEdits } from '../../workflows/ik';
import type { ChannelTarget } from '../args';
import {
  AGENT_WRITE_LIMIT,
  baseCurveIn,
  clipArg,
  controlOfClip,
  extendClipRange,
  frameProblem,
  framesProblem,
  hiddenByOverrides,
  isChannelOf,
  keyedValuesAt,
  labelOf,
  labelProblem,
  pollAgentClip,
  rangeExtensionProblem,
  rangeProblem,
  runtimeOfClip,
} from './agentCommon';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK } from './define';

const AGENT = { category: 'pose', scope: GLOBAL_SCOPE, flags: { undo: true, internal: true } } as const;
const MODES = ['key', 'static', 'propose'] as const;
const TANGENTS: readonly TangentType[] = [
  'auto',
  'autoEase',
  'autoMix',
  'spline',
  'clamped',
  'plateau',
  'linear',
  'flat',
  'step',
  'stepNext',
  'fixed',
];

function txOf(tx: Tx | null, id: string): Tx {
  if (tx === null) throw new EkzaError('internal', `${id} runs in a transaction`);
  return tx;
}

function requireClipIn(tx: Tx, clip: ClipRecord['id']): ClipRecord {
  const record = tx.get('clips', clip);
  if (record === undefined) throw new EkzaError('invalid-record', `Clip ${clip} does not exist`);
  return record;
}

function requireRuntime(app: EditorApp, clip: ClipRecord): CharacterRuntime {
  const runtime = runtimeOfClip(app, clip);
  if (typeof runtime === 'string') throw new EkzaError('unsupported', runtime);
  return runtime;
}

/** Writes a key and, when `tangent` is given, also sets it on a key that was already there. */
function keyAt(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  control: ControlRecord,
  channel: ChannelId,
  frame: Frame,
  value: number,
  tangent?: TangentType,
): void {
  const curve = ensureCurve(app, tx, clip.id, control.id, channel);
  const defaults = newKeyTangents(control, channel, app.prefs.getState().defaultTangents);
  const tangents = tangent === undefined ? defaults : { in: tangent, out: tangent };
  const id = writeKeyAt(app, tx, curve, frame, value, tangents);
  if (tangent === undefined) return;
  const key = tx.get('keys', id);
  if (key !== undefined && (key.inType !== tangent || key.outType !== tangent)) {
    tx.put('keys', { ...key, inType: tangent, outType: tangent });
  }
}

// ---------- pose.setAt ----------

interface SetAtArgs {
  readonly clip: ClipRecord['id'];
  readonly frame: Frame;
  readonly edits: readonly { readonly control: ControlId; readonly channel: ChannelId; readonly value: number }[];
  readonly mode: 'key' | 'static' | 'propose';
  readonly tangent?: TangentType;
  readonly syncRotation?: boolean;
  readonly extendRange?: boolean;
}

type Skip = ChannelTarget & { readonly reason: 'locked' | 'non-keyable' | 'animated' };

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

function skipOf(control: ControlRecord, channel: ChannelId): Skip['reason'] | null {
  if (!isKeyable(control, channel)) return 'non-keyable';
  if (isLocked(control, channel)) return 'locked';
  return null;
}

const poseSetAt = defineOperator({
  ...AGENT,
  id: 'pose.setAt',
  label: 'Set Pose',
  description: 'Set channel values of controls at one clip frame and key them (or set static values, or propose).',
  undoLabel: (args) => labelOf(args, args.mode === 'propose' ? 'Propose Pose' : 'Set Pose'),
  poll({ app }, raw) {
    const base = pollAgentClip(app, raw);
    if (base !== true) return base;
    const problem = setAtProblem(
      app,
      clipArg(app.store, raw) as ClipRecord,
      raw as unknown as Readonly<Record<string, unknown>>,
    );
    return problem === null ? OK : fail(problem);
  },
  apply(ctx, args) {
    const { app } = ctx;
    const tx = txOf(ctx.tx, 'pose.setAt');
    const clip = requireClipIn(tx, args.clip);
    const skipped: Skip[] = [];
    const usable: { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[] = [];
    for (const edit of args.edits) {
      const control = tx.get('controls', edit.control);
      if (control === undefined) throw new EkzaError('invalid-record', `Control ${edit.control} does not exist`);
      const reason = skipOf(control, edit.channel);
      if (reason !== null) skipped.push({ control: control.id, channel: edit.channel, reason });
      else usable.push({ control, channel: edit.channel, value: edit.value });
    }
    if (args.mode === 'propose') return propose(ctx, usable, skipped);
    if (args.mode === 'static') return setStatics(app, tx, clip, usable, skipped);
    return setKeys(app, tx, clip, args, usable, skipped);
  },
});

/** `{mode: 'key'}`: always keys (`key: 'force'` semantics) and, with `syncRotation`, the other rotation axes. */
function setKeys(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  args: SetAtArgs,
  usable: readonly { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[],
  skipped: readonly Skip[],
) {
  if (args.extendRange === true) extendClipRange(tx, clip, [args.frame]);
  const edited = new Map<ControlId, Set<ChannelId>>();
  for (const { control, channel } of usable) {
    const set = edited.get(control.id) ?? new Set<ChannelId>();
    set.add(channel);
    edited.set(control.id, set);
  }
  // The other rotation axes key at their keyed values at the frame (read before any write).
  const synced: { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[] = [];
  if (args.syncRotation !== false) {
    const runtime = requireRuntime(app, clip);
    const rotated = usable.filter((edit) => (ROTATE_CHANNELS as readonly string[]).includes(edit.channel));
    const controls = [...new Map(rotated.map((edit) => [edit.control.id, edit.control])).values()];
    const values = keyedValuesAt(
      runtime,
      clip,
      args.frame,
      controls.map((control) => control.id),
      tx,
    );
    for (const control of controls) {
      for (const channel of ROTATE_CHANNELS) {
        if (edited.get(control.id)?.has(channel) === true || skipOf(control, channel) !== null) continue;
        const value = values.get(control.id)?.[channel];
        if (value !== undefined) synced.push({ control, channel, value });
      }
    }
  }
  for (const edit of [...usable, ...synced]) {
    keyAt(app, tx, clip, edit.control, edit.channel, args.frame, edit.value, args.tangent);
  }
  return {
    keyed: usable.length,
    synced: synced.length,
    statics: 0,
    skipped,
    hiddenByOverrides: hiddenByOverrides(
      app,
      clip,
      [...usable, ...synced].map((edit) => ({ control: edit.control.id, channel: edit.channel, frame: args.frame })),
    ),
  };
}

/** `{mode: 'static'}`: the base value of channels without keys; animated channels are skipped. */
function setStatics(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  usable: readonly { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[],
  skippedSoFar: readonly Skip[],
) {
  const skipped = [...skippedSoFar];
  let statics = 0;
  for (const { control, channel, value } of usable) {
    const existing = baseCurveIn(tx, clip, control.id, channel);
    if (existing !== undefined && tx.query.keysOfCurve(existing.id).length > 0) {
      skipped.push({ control: control.id, channel, reason: 'animated' });
      continue;
    }
    const curve = existing?.id ?? ensureCurve(app, tx, clip.id, control.id, channel);
    if (tx.get('curves', curve)?.staticValue !== value) tx.patch('curves', curve, { staticValue: value });
    statics++;
  }
  return { keyed: 0, synced: 0, statics, skipped, hiddenByOverrides: [] };
}

/**
 * `{mode: 'propose'}` (View access): unkeyed overrides at the user's current frame, which the user keys with `S` or
 * discards by changing frame. Every edited channel becomes an override (also an unanimated one, where the editor's
 * `key: 'none'` policy would set a static value): a proposal never changes the document.
 */
function propose(
  ctx: OperatorContext,
  usable: readonly { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[],
  skipped: readonly Skip[],
) {
  const session = ctx.app.session;
  const overrides = new Map(session.getState().overrides);
  for (const { control, channel, value } of usable) {
    overrides.set(control.id, { ...overrides.get(control.id), [channel]: value });
  }
  if (usable.length > 0) session.setState({ overrides });
  return { keyed: 0, synced: 0, statics: 0, skipped, hiddenByOverrides: [] };
}

// ---------- pose.transfer ----------

const MIRRORS: readonly (MirrorMode | 'none')[] = ['none', 'flip', 'leftToRight', 'rightToLeft'];

interface TransferArgs {
  readonly clip: ClipRecord['id'];
  readonly fromClip?: ClipRecord['id'];
  readonly fromFrame: Frame;
  readonly toFrames: readonly Frame[];
  readonly controls: readonly ControlId[];
  readonly mirror: MirrorMode | 'none';
  readonly extendRange?: boolean;
}

/** Pose channels of a control the transfer keys: keyable, unlocked TRS channels and `keyAll` attributes. */
function transferChannels(control: ControlRecord): readonly ChannelId[] {
  const trs = (['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const).filter(
    (channel) => isKeyable(control, channel) && !isLocked(control, channel),
  );
  const attrs = attrChannelsOf(control).filter(
    (channel) => isKeyable(control, channel) && isKeyAllChannel(control, channel),
  );
  return [...trs, ...attrs];
}

/** The values the transfer keys per control: the source pose, mirrored when asked. */
function transferValues(
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

const poseTransfer = defineOperator({
  ...AGENT,
  id: 'pose.transfer',
  label: 'Transfer Pose',
  description: 'Key the pose of one frame (optionally mirrored, optionally of another clip) at other frames.',
  undoLabel: (args) => labelOf(args, 'Transfer Pose'),
  poll({ app }, raw) {
    const base = pollAgentClip(app, raw);
    if (base !== true) return base;
    const clip = clipArg(app.store, raw) as ClipRecord;
    const problem = transferProblem(app, clip, raw as unknown as Readonly<Record<string, unknown>>);
    if (problem !== null) return fail(problem);
    const args = raw as unknown as TransferArgs;
    let count = 0;
    for (const id of transferValues(app, app.store, args).keys()) {
      const control = app.store.get('controls', id);
      if (control !== undefined) count += transferChannels(control).length * new Set(args.toFrames).size;
    }
    if (count === 0) return fail('Nothing to transfer: the controls have no keyable channels');
    return count > AGENT_WRITE_LIMIT ? fail(`The transfer would write more than ${AGENT_WRITE_LIMIT} keys`) : OK;
  },
  apply({ app, tx: maybe }, args) {
    const tx = txOf(maybe, 'pose.transfer');
    const clip = requireClipIn(tx, args.clip);
    const values = transferValues(app, tx, args);
    if (args.extendRange === true) extendClipRange(tx, clip, args.toFrames);
    let keyed = 0;
    for (const frame of new Set(args.toFrames)) {
      for (const [id, pose] of values) {
        const control = tx.get('controls', id);
        if (control === undefined) continue;
        for (const channel of transferChannels(control)) {
          const value = pose[channel];
          if (value === undefined || !Number.isFinite(value)) continue;
          if (baseCurveIn(tx, clip, id, channel)?.locked === true) continue;
          keyAt(app, tx, clip, control, channel, frame, value);
          keyed++;
        }
      }
    }
    return { keyed };
  },
});

// ---------- pose.goals ----------

interface GoalsArgs {
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
function keyedChannels(runtime: CharacterRuntime, clip: ClipRecord, frame: Frame) {
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

/** Keyable, unlocked channels of `values` (a control's solved channels); locked ones keep their values. */
function writableChannels(app: EditorApp): ChannelFilter {
  return (id, values) => {
    const control = app.store.get('controls', id);
    if (control === undefined) return {};
    const out: Record<string, number> = {};
    for (const [channel, value] of Object.entries(values) as [ChannelId, number | undefined][]) {
      if (value === undefined || !Number.isFinite(value) || skipOf(control, channel) !== null) continue;
      out[channel] = value;
    }
    return out;
  };
}

/** A channel's value at a frame as the transaction sees it (the curves written so far). */
function txValue(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  control: ControlRecord,
  channel: ChannelId,
  frame: Frame,
): number | null {
  const curve = baseCurveIn(tx, clip, control.id, channel);
  if (curve === undefined) return null;
  const { keys, compiled } = compileInTx(app, tx, curve);
  if (keys.length === 0) return curve.staticValue;
  return internalsOf(app).deps.curves.engine.evaluate(compiled, frame);
}

/**
 * `ensureIk: 'auto'` (§4.10): switches only `range` to IK. The IK control (and pole) match the FK pose at the range
 * ends and are keyed there; `@ikFk` keys 1 at both ends and 0 at `start − 1` and `end + 1` when those frames lie in
 * the clip (step tangents), its keys strictly between are removed, so FK keys outside `[start − 1, end + 1]` keep
 * playing unchanged. Returns the keys written.
 */
function switchRangeToIk(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  limb: LimbDesc,
  range: { readonly start: Frame; readonly end: Frame },
): number {
  let keyed = 0;
  for (const frame of new Set([range.start, range.end])) {
    const limbCtx = limbContext(app, limb.id, clip.character, { clip: clip.id, frame });
    if (typeof limbCtx === 'string') throw new EkzaError('unsupported', limbCtx);
    const matched = matchAt(app, limbCtx, 'ik', channelsAt(app, limbCtx, frame, false));
    for (const edit of matchEdits(app, matched.values)) {
      const control = tx.get('controls', edit.control);
      if (control === undefined) continue;
      keyAt(app, tx, clip, control, edit.channel, frame, edit.value);
      keyed++;
    }
  }
  const ikControl = tx.get('controls', limb.params.ikControl);
  if (ikControl === undefined) return keyed;
  const curve = ensureCurve(app, tx, clip.id, ikControl.id, '@ikFk');
  for (const key of tx.query.keysOfCurve(curve)) {
    const between = key.t > range.start - 1 + SAME_FRAME_EPS && key.t < range.end + 1 - SAME_FRAME_EPS;
    const atEnd = Math.abs(key.t - range.start) < SAME_FRAME_EPS || Math.abs(key.t - range.end) < SAME_FRAME_EPS;
    if (between && !atEnd) tx.remove('keys', key.id);
  }
  const writes: [Frame, number][] = [
    [range.start, 1],
    [range.end, 1],
  ];
  if (range.start - 1 >= clip.range.start - SAME_FRAME_EPS) writes.push([range.start - 1, 0]);
  if (range.end + 1 <= clip.range.end + SAME_FRAME_EPS) writes.push([range.end + 1, 0]);
  for (const [frame, value] of writes) {
    const id = writeKeyAt(app, tx, curve, frame, value, { in: 'flat', out: 'step' });
    const key = tx.get('keys', id) as KeyRecord;
    if (key.outType !== 'step') tx.put('keys', { ...key, outType: 'step' });
    keyed++;
  }
  return keyed;
}

const poseGoals = defineOperator({
  ...AGENT,
  id: 'pose.goals',
  label: 'Goal Pose',
  description: 'Aim FK bones in character-space directions and place IK effectors, keyed at one clip frame.',
  undoLabel: (args) => labelOf(args, 'Goal Pose'),
  poll({ app }, raw) {
    const base = pollAgentClip(app, raw);
    if (base !== true) return base;
    const problem = goalsProblem(
      app,
      clipArg(app.store, raw) as ClipRecord,
      raw as unknown as Readonly<Record<string, unknown>>,
    );
    return problem === null ? OK : fail(problem);
  },
  apply({ app, tx: maybe }, args: GoalsArgs) {
    const tx = txOf(maybe, 'pose.goals');
    const clip = requireClipIn(tx, args.clip);
    const runtime = requireRuntime(app, clip);
    const program = runtime.program;
    if (args.extendRange === true) extendClipRange(tx, clip, [args.frame]);
    const state: GoalState = {
      program,
      ch: keyedChannels(runtime, clip, args.frame),
      pose: program.allocPose(),
      solved: new Map(),
    };
    program.evaluate(state.ch, state.pose);
    const rest = restPoseOf(program);
    const filter = writableChannels(app);
    // Aims, parents first (node indices are topological).
    const aims: AimRequest[] = (args.aims ?? [])
      .map((aim) => ({
        node: boneNode(runtime, aim.bone),
        bone: aim.bone,
        direction: aim.direction,
        keepTwist: aim.keepTwist,
        weight: aim.weight,
        ...(aim.split === undefined ? {} : { split: aim.split }),
      }))
      .sort((a, b) => a.node - b.node);
    for (const aim of aims) applyAim(state, rest, runtime, aim, filter);
    const aimResults = aims.map((aim) => {
      const result = aimResult(state, rest, runtime, aim);
      return { bone: aim.bone, control: drivingControl(program, aim.node) as ControlId, ...result };
    });
    // IK goals, after any range switch they need.
    let keyed = 0;
    const ikResults: {
      limb: LimbId;
      reached: boolean;
      errorM: number;
      switched: { start: Frame; end: Frame } | null;
    }[] = [];
    for (const goal of args.ik ?? []) {
      const limb = program.limbs.find((candidate) => candidate.id === goal.limb) as LimbDesc;
      let switched: { start: Frame; end: Frame } | null = null;
      if (goal.ensureIk === 'auto' && ikFkIn(limb, state.ch) < IK_FROM && goal.switchRange !== undefined) {
        keyed += switchRangeToIk(app, tx, clip, limb, goal.switchRange);
        switched = { start: goal.switchRange.start, end: goal.switchRange.end };
        // The IK side at the frame as the switch keyed it (the pole interpolates between the matched ends).
        for (const id of [limb.params.ikControl, limb.params.pole]) {
          const control = tx.get('controls', id);
          if (control === undefined) continue;
          const values: Partial<Record<ChannelId, number>> = {};
          for (const channel of ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const) {
            const value = txValue(app, tx, clip, control, channel, args.frame);
            if (value !== null) values[channel] = value;
          }
          writeChannels(state, id, values);
        }
      }
      const errorM = applyIkGoal(app, state, limb, goal, filter);
      ikResults.push({ limb: goal.limb, reached: errorM <= REACHED_M, errorM, switched });
    }
    // Key every solved channel at the frame.
    for (const [id, values] of state.solved) {
      const control = tx.get('controls', id);
      if (control === undefined) continue;
      for (const [channel, value] of Object.entries(values) as [ChannelId, number | undefined][]) {
        if (value === undefined) continue;
        keyAt(app, tx, clip, control, channel, args.frame, value);
        keyed++;
      }
    }
    return { aims: aimResults, ik: ikResults, keyed };
  },
});

function writeChannels(state: GoalState, control: ControlId, values: ChannelValues): void {
  if (state.program.controlIndex.has(control)) writeControlChannels(state.program, state.ch, control, values);
}

export const AGENT_POSE_OPERATORS: readonly AnyOperator[] = [poseSetAt, poseGoals, poseTransfer];
