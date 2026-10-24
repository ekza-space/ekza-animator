// The public UI wrappers of the AI-only operators (STUDIO-TOUCH-SPEC §20.3 item 7, T5a): a lazy chunk that
// `loadUiWrappers` (`uiWrapperChunk.ts`, which also declares their argument types) registers once per app.
//
// A wrapper is thin. Its poll checks its own arguments in plain words, fills the explicit targets of the operator it
// wraps from the user's session (the active clip, the playhead, the time band, the selection, the copied pose) and
// asks that operator's own poll. Its `prepare` runs the wrapped operator's `prepare` (loading its implementation) and
// its full poll; its `apply` runs the wrapped operator's `apply` inside the wrapper's single transaction, so a run is
// one undo step under the wrapper's label (`tx.annotate` after the wrapped apply, which may annotate its own). The
// wrapped operators, their agent contract and Studio Pro's menus are unchanged; the wrappers declare no ParamDefs, so
// they never become Repeat Last or Adjust Last runs (their touch forms live in `forms/`, read by the touch shell only).
// Agent runs are refused here as well as by the agent-tools policy (§14).
import { EkzaError, type Frame, type Quat, type Vec3 } from '@ekza-studio/anim-core';
import type { ChannelId, ChannelValues, ClipRecord, ControlId, ImagePlaneRecord } from '@ekza-studio/doc';
import { applyPoseClipboard, type LimbDesc, type LimbId, type PoseClipboard } from '@ekza-studio/rig';
import {
  type ApplyContext,
  type CharacterRuntime,
  type EditorApp,
  GLOBAL_SCOPE,
  type OperatorArgs,
  type OperatorContext,
  type OperatorReturn,
  type PollResult,
} from '../../types';
import { applyIkGoal, type ChannelFilter, type GoalState } from '../../workflows/goals';
import { boneNode, IK_FROM, ikFkIn, limbOfNode, REACHED_M } from '../../workflows/goalTargets';
import { LIMB_NAME, LIMB_ORDER, limbOfControlIn } from '../../workflows/ik';
import { clipboardAttrValues, mergeChannelValues, selectedChannelsOf } from '../../workflows/pose';
import { activeClipRecord, controlsOfCharacter } from '../../workflows/targets';
import type { ChannelTarget } from '../args';
import { keyedChannels, skipOf } from './agentPoseChecks';
import {
  type AnyOperator,
  defineOperator,
  fail,
  isActorRun,
  isFiniteNumber,
  isRecord,
  OK,
  optionalArgs,
} from './define';
import { imageBytesOf, imageExt, LOCKED_REASON, MAX_IMAGE_BYTES } from './imagePlane';
import { ANIMATE_ONLY_REASON } from './keymapShadows';
import { pollEditable } from './polls';
import { pasteClipboard } from './poseBodies';
import type { UiKeyScopeArgs, UiLoopMethod, UiLoopTravel, UiScalePivot, UiWrapperId } from './uiWrapperChunk';

type AnyArgs = Readonly<Record<string, unknown>>;

/** Why an agent run of a wrapper is refused (the agent-tools policy denies them first, §14). */
export const AGENT_REFUSAL = 'This is a touch-shell command; agents call the operator it wraps';
const LOOP_METHODS: readonly UiLoopMethod[] = ['matchEnds', 'blend', 'cycleOnly'];
const LOOP_TRAVEL: readonly UiLoopTravel[] = ['cycleOffset', 'inPlace', 'keep'];
const SCALE_PIVOTS: readonly UiScalePivot[] = ['rest', 'mean', 'rangeStart'];
/** The neck/head share of a head aim (the agent tools' default, MCP `pose_aim`). */
const HEAD_SPLIT = { neck: 0.4, head: 0.6 } as const;

// ---------- the session targets ----------

/** The clip a wrapper edits: `args.clip`, else the active clip of the active character. */
function clipOf(app: EditorApp, args: AnyArgs): ClipRecord | string {
  const id = args['clip'];
  if (id !== undefined) {
    if (typeof id !== 'string') return 'clip must be a clip id';
    return app.store.get('clips', id as ClipRecord['id']) ?? 'The animation does not exist';
  }
  if (app.session.getState().activeCharacter === null) return 'No character is loaded';
  return activeClipRecord(app) ?? 'The character has no active animation';
}

/** True when `clip` is the active clip of the active character (the playhead and the band are its frames). */
function isActive(app: EditorApp, clip: ClipRecord): boolean {
  const state = app.session.getState();
  return state.activeCharacter === clip.character && state.activeClip[clip.character] === clip.id;
}

function frameProblem(value: unknown, name: string): string | null {
  return isFiniteNumber(value) && Math.abs(value) <= 100_000 ? null : `${name} must be a frame`;
}

/** `args[name]`, else the playhead (active clip only). */
function frameOf(app: EditorApp, clip: ClipRecord, args: AnyArgs, name = 'frame'): Frame | string {
  const value = args[name];
  if (value !== undefined) return frameProblem(value, name) ?? (value as Frame);
  const frame = isActive(app, clip) ? app.evaluation.clipFrame(clip.character) : null;
  return frame ?? `Pass a ${name}: the animation is not the one playing`;
}

/** The time band of the active clip (null: none, or another clip). */
function bandOf(app: EditorApp, clip: ClipRecord): { readonly start: Frame; readonly end: Frame } | null {
  return isActive(app, clip) ? app.session.getState().time.band : null;
}

function runtimeOf(app: EditorApp, clip: ClipRecord): CharacterRuntime | string {
  return app.characters.get(clip.character) ?? 'The character is still loading';
}

function vec3Problem(value: unknown, name: string): string | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) return `${name} must be [x, y, z]`;
  return value.some((v: number) => Math.abs(v) > 1000) ? `${name} must lie within 1000 m` : null;
}

function controlIdsProblem(app: EditorApp, clip: ClipRecord, value: unknown): string | null {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) return 'controls must be control ids';
  const rig = app.store.query.rigOfCharacter(clip.character);
  for (const id of value as readonly string[]) {
    if (app.store.get('controls', id as ControlId)?.rig !== rig?.id) return 'A control is not one of the character';
  }
  return null;
}

/** The selected controls of the clip's character, else every control of it. */
function controlsOf(app: EditorApp, clip: ClipRecord): readonly ControlId[] {
  const all = controlsOfCharacter(app.store, clip.character);
  const ids = new Set(all.map((control) => control.id));
  const selected = app.session.getState().selection.controls.filter((id) => ids.has(id));
  return selected.length > 0 ? selected : all.map((control) => control.id);
}

/** The limb a goal moves: `args.limb`, else the limb of the lead selected control. */
function limbOf(app: EditorApp, runtime: CharacterRuntime, args: AnyArgs): LimbDesc | string {
  const id = args['limb'];
  if (id !== undefined) {
    if (!LIMB_ORDER.includes(id as LimbId)) return `limb is one of ${LIMB_ORDER.join(', ')}`;
    const limb = runtime.program.limbs.find((candidate) => candidate.id === id);
    return limb ?? `The character has no ${LIMB_NAME[id as LimbId]} IK`;
  }
  const lead = app.session.getState().selection.controls.at(-1);
  const limb = lead === undefined ? null : limbOfControlIn(runtime.program, lead);
  return limb ?? 'Select a hand or a foot first';
}

/** An IK goal at `frame`: kept in IK, or switched to IK over the time band when the limb is FK there. */
function ikGoalOf(
  app: EditorApp,
  clip: ClipRecord,
  runtime: CharacterRuntime,
  limb: LimbDesc,
  frame: Frame,
  goal: { readonly position: Vec3; readonly rotation?: Quat },
): NonNullable<OperatorArgs<'pose.goals'>['ik']> | string {
  if (ikFkIn(limb, keyedChannels(runtime, clip, frame)) >= IK_FROM)
    return [{ limb: limb.id, ...goal, ensureIk: 'never' }];
  const band = bandOf(app, clip);
  if (band === null || frame < band.start || frame > band.end) {
    return `The ${LIMB_NAME[limb.id]} is FK here: switch it to IK first, or pick a time range around the frame`;
  }
  return [{ limb: limb.id, ...goal, ensureIk: 'auto', switchRange: band }];
}

/** Keyable, unlocked channels of solved values (the goal solve keeps locked channels as they are). */
function writable(app: EditorApp): ChannelFilter {
  return (id, values) => {
    const control = app.store.get('controls', id);
    if (control === undefined) return {};
    const out: Partial<Record<ChannelId, number>> = {};
    for (const [channel, value] of Object.entries(values) as [ChannelId, number | undefined][]) {
      if (value !== undefined && Number.isFinite(value) && skipOf(control, channel) === null) out[channel] = value;
    }
    return out;
  };
}

/**
 * The limb's IK goal solved on the keyed pose at `frame`, without writing anything: the channel values per control
 * and whether the goal is in reach. The touch shell previews a Reach drag with these values (as session overrides).
 */
export function solveReach(
  app: EditorApp,
  clip: ClipRecord,
  limb: LimbId,
  frame: Frame,
  goal: { readonly position: Vec3; readonly rotation?: Quat },
): { readonly values: ReadonlyMap<ControlId, ChannelValues>; readonly reached: boolean } {
  const runtime = app.characters.get(clip.character);
  const desc = runtime?.program.limbs.find((candidate) => candidate.id === limb);
  if (runtime === undefined || desc === undefined) throw new EkzaError('unsupported', `No ${limb} IK to reach with`);
  const program = runtime.program;
  const state: GoalState = {
    program,
    ch: keyedChannels(runtime, clip, frame),
    pose: program.allocPose(),
    solved: new Map(),
  };
  program.evaluate(state.ch, state.pose);
  const error = applyIkGoal(app, state, desc, { limb, ...goal }, writable(app));
  return { values: state.solved, reached: error <= REACHED_M };
}

/** The channels a value wrapper adjusts and where: given, else the selected keys, channels or controls. */
function keyScopeOf(
  app: EditorApp,
  clip: ClipRecord,
  args: AnyArgs,
):
  | { readonly targets: readonly ChannelTarget[]; readonly where: Pick<UiKeyScopeArgs, 'range'> & { frames?: Frame[] } }
  | string {
  const range = args['range'];
  if (range !== undefined) {
    if (
      !isRecord(range) ||
      frameProblem(range['start'], 'range.start') !== null ||
      frameProblem(range['end'], 'range.end') !== null
    ) {
      return 'range must be { start, end } frames';
    }
    if ((range['start'] as number) > (range['end'] as number)) return 'range must start before it ends';
  }
  const explicit = args['targets'];
  const targets: ChannelTarget[] = [];
  const seen = new Set<string>();
  const add = (control: ControlId, channel: ChannelId): void => {
    const key = `${control}\u0000${channel}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ control, channel });
  };
  let frames: Frame[] | null = null;
  const selection = app.session.getState().selection;
  const layer = app.store.query.baseLayer(clip.id);
  if (explicit !== undefined) {
    if (!Array.isArray(explicit)) return 'targets must be a list of { control, channel }';
    for (const target of explicit as readonly unknown[]) {
      if (!isRecord(target) || typeof target['control'] !== 'string' || typeof target['channel'] !== 'string') {
        return 'targets must be a list of { control, channel }';
      }
      add(target['control'] as ControlId, target['channel'] as ChannelId);
    }
  } else if (selection.keys.size > 0) {
    frames = [];
    for (const id of selection.keys.keys()) {
      const key = app.store.get('keys', id);
      const curve = key === undefined ? undefined : app.store.get('curves', key.curve);
      if (key === undefined || curve === undefined || curve.clip !== clip.id || curve.layer !== layer?.id) continue;
      add(curve.control, curve.channel);
      if (!frames.includes(key.t)) frames.push(key.t);
    }
  } else if (selection.channels.length > 0) {
    for (const ref of selection.channels) add(ref.control, ref.channel);
  } else {
    for (const control of selection.controls) {
      for (const curve of app.store.query.curvesOfControl(clip.id, control)) {
        if (curve.layer === layer?.id && app.store.query.keysOfCurve(curve.id).length > 0) {
          add(curve.control, curve.channel);
        }
      }
    }
  }
  if (targets.length === 0) return 'Select keys, channels or animated controls first';
  if (isRecord(range)) return { targets, where: { range: range as unknown as { start: Frame; end: Frame } } };
  const band = bandOf(app, clip);
  if (band !== null && explicit === undefined && frames === null) return { targets, where: { range: band } };
  return { targets, where: frames === null ? {} : { frames: frames.sort((a, b) => a - b) } };
}

// ---------- the wrapper machinery ----------

/** A call of a wrapped operator with explicit arguments. */
interface Call {
  readonly op: string;
  readonly args: unknown;
}
/** What a wrapper resolved from its arguments and the session. */
interface Plan<X = undefined> {
  readonly calls: readonly Call[];
  readonly label: string;
  readonly extra: X;
}
interface Prepared<X> {
  readonly plan: Plan<X>;
  readonly steps: readonly { readonly def: AnyOperator; readonly args: unknown; readonly prepared: unknown }[];
}

/** The wrapped operator's own poll (registered with the M-AI chunk `loadUiWrappers` loads first). */
function pollCall(ctx: OperatorContext, call: Call): PollResult {
  const def = ctx.app.operators.get(call.op);
  if (def === undefined) return fail(`${call.op} is not loaded`);
  return def.poll?.(ctx, call.args) ?? OK;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';

/** The wrapped operators' `prepare`, then their full polls (their implementation has loaded): refusals fail the run. */
async function prepareCalls<X>(ctx: OperatorContext, plan: Plan<X>): Promise<Prepared<X>> {
  const steps: Prepared<X>['steps'][number][] = [];
  for (const call of plan.calls) {
    const def = ctx.app.operators.get(call.op);
    if (def === undefined) throw new EkzaError('unavailable', `${call.op} is not loaded`);
    let prepared = def.prepare?.(ctx, call.args);
    if (isThenable(prepared)) prepared = await prepared;
    const poll = def.poll?.(ctx, call.args) ?? OK;
    if (poll !== true) throw new EkzaError('unsupported', poll.reason);
    steps.push({ def, args: call.args, prepared });
  }
  return { plan, steps };
}

interface WrapperSpec<K extends UiWrapperId, X> {
  readonly id: K;
  readonly label: string;
  readonly description: string;
  readonly category: string;
  readonly aliases: readonly string[];
  /** Keys or edits curves: refused in Rig & Skin like Studio Pro's keying operators. */
  readonly keys: boolean;
  readonly undoLabel: (args: AnyArgs) => string;
  /** Resolves the calls; null: not decidable without `prepare` (the system clipboard), the poll answers OK. */
  readonly plan: (app: EditorApp, args: AnyArgs) => Plan<X> | string | null;
  /** `prepare`'s resolution when it differs from `plan` (reads the system clipboard). */
  readonly planAsync?: (ctx: OperatorContext, args: AnyArgs) => Promise<Plan<X> | string>;
  readonly result: (values: readonly unknown[], plan: Plan<X>) => OperatorReturn<K>;
}

function argsOf(raw: unknown): AnyArgs | null {
  return optionalArgs(raw);
}

/** The common poll of every wrapper: agents, Rig & Skin and read-only projects first, then its own checks. */
function pollCommon(ctx: OperatorContext, keys: boolean): PollResult {
  if (isActorRun(ctx)) return fail(AGENT_REFUSAL);
  if (keys && ctx.app.session.getState().workspace === 'rig') return fail(ANIMATE_ONLY_REASON);
  return pollEditable(ctx.app);
}

/**
 * The label a run's `prepare` resolved, by its args object: the runner asks `undoLabel` after `prepare` with the same
 * args, so a step that only leaves unkeyed edits (no transaction to annotate) still gets the resolved label.
 */
const resolvedLabels = new WeakMap<object, string>();

function wrapper<K extends UiWrapperId, X = undefined>(spec: WrapperSpec<K, X>): AnyOperator {
  return defineOperator<K, Prepared<X>>({
    id: spec.id,
    label: spec.label,
    description: spec.description,
    category: spec.category,
    scope: GLOBAL_SCOPE,
    flags: { undo: true },
    aliases: spec.aliases,
    undoLabel: (args) => (isRecord(args) ? resolvedLabels.get(args) : undefined) ?? spec.undoLabel(argsOf(args) ?? {}),
    poll(ctx, raw) {
      const common = pollCommon(ctx, spec.keys);
      if (common !== true) return common;
      const args = argsOf(raw);
      if (args === null) return fail(`expects { … } (${spec.label})`);
      const plan = spec.plan(ctx.app, args);
      if (plan === null) return OK;
      if (typeof plan === 'string') return fail(plan);
      for (const call of plan.calls) {
        const result = pollCall(ctx, call);
        if (result !== true) return result;
      }
      return OK;
    },
    async prepare(ctx, raw) {
      const args = argsOf(raw) ?? {};
      const plan = spec.planAsync === undefined ? spec.plan(ctx.app, args) : await spec.planAsync(ctx, args);
      if (plan === null) throw new EkzaError('unsupported', `${spec.label}: nothing to do`);
      if (typeof plan === 'string') throw new EkzaError('unsupported', plan);
      if (isRecord(raw)) resolvedLabels.set(raw, plan.label);
      return prepareCalls(ctx, plan);
    },
    apply(ctx: ApplyContext, _args, prepared) {
      const values = prepared.steps.map((step) => step.def.apply(ctx, step.args, step.prepared));
      ctx.tx?.annotate({ label: prepared.plan.label });
      return spec.result(values, prepared.plan);
    },
  });
}

const plan = <X = undefined>(calls: readonly Call[], label: string, extra?: X): Plan<X> => ({
  calls,
  label,
  extra: extra as X,
});

// ---------- pose ----------

const hold = wrapper({
  id: 'pose.hold',
  label: 'Hold Pose',
  description: 'Key the pose of the start of the time range at its end (or at the given frames), so the pose holds.',
  category: 'pose',
  aliases: ['Hold', 'Hold Key'],
  keys: true,
  undoLabel: () => 'Hold Pose',
  plan(app, args) {
    const clip = clipOf(app, args);
    if (typeof clip === 'string') return clip;
    const band = bandOf(app, clip);
    const from =
      args['from'] !== undefined ? frameOf(app, clip, args, 'from') : (band?.start ?? frameOf(app, clip, args, 'from'));
    if (typeof from === 'string') return from;
    const to = args['to'] ?? band?.end;
    if (to === undefined) return 'Pick a time range to hold the pose over';
    const list = Array.isArray(to) ? (to as readonly unknown[]) : [to];
    for (const frame of list) {
      const problem = frameProblem(frame, 'to');
      if (problem !== null) return problem;
    }
    const toFrames = [...new Set(list as readonly Frame[])].filter((frame) => frame !== from);
    if (toFrames.length === 0) return 'Pick a time range to hold the pose over';
    if (args['controls'] !== undefined) {
      const problem = controlIdsProblem(app, clip, args['controls']);
      if (problem !== null) return problem;
    }
    const controls = (args['controls'] as readonly ControlId[] | undefined) ?? controlsOf(app, clip);
    const call: OperatorArgs<'pose.transfer'> = { clip: clip.id, fromFrame: from, toFrames, controls, mirror: 'none' };
    return plan([{ op: 'pose.transfer', args: call }], 'Hold Pose');
  },
  result: ([value]) => ({ keyed: (value as OperatorReturn<'pose.transfer'>).keyed }),
});

/** The copied pose as `pose.setAt` edits on the clip's character (selected controls only when they overlap). */
function pasteEdits(
  app: EditorApp,
  clip: ClipRecord,
  runtime: CharacterRuntime,
  clipboard: PoseClipboard,
  mirrored: boolean,
): OperatorArgs<'pose.setAt'>['edits'] {
  const values = mergeChannelValues(
    applyPoseClipboard(clipboard, runtime.program, mirrored ? 'mirrored' : 'local'),
    clipboardAttrValues(app.store, clipboard, controlsOfCharacter(app.store, clip.character), mirrored, (id) =>
      selectedChannelsOf(app, id),
    ),
  );
  const selected = new Set(app.session.getState().selection.controls);
  const overlaps = [...values.keys()].some((id) => selected.has(id));
  const edits: { control: ControlId; channel: ChannelId; value: number }[] = [];
  for (const [control, channels] of values) {
    if (overlaps && !selected.has(control)) continue;
    const record = app.store.get('controls', control);
    if (record === undefined) continue;
    for (const [channel, value] of Object.entries(channels) as [ChannelId, number | undefined][]) {
      if (value !== undefined && Number.isFinite(value) && skipOf(record, channel) === null) {
        edits.push({ control, channel, value });
      }
    }
  }
  return edits;
}

function pasteAtPlan(app: EditorApp, args: AnyArgs, clipboard: PoseClipboard | null): Plan | string | null {
  const clip = clipOf(app, args);
  if (typeof clip === 'string') return clip;
  const frame = frameOf(app, clip, args);
  if (typeof frame === 'string') return frame;
  const mirrored = args['mirrored'];
  if (mirrored !== undefined && typeof mirrored !== 'boolean') return 'mirrored must be true or false';
  const runtime = runtimeOf(app, clip);
  if (typeof runtime === 'string') return runtime;
  if (clipboard === null) return null;
  const edits = pasteEdits(app, clip, runtime, clipboard, mirrored === true);
  if (edits.length === 0) return 'The copied pose has no channels this character can key';
  const call: OperatorArgs<'pose.setAt'> = { clip: clip.id, frame, edits, mode: 'key' };
  const label = `${mirrored === true ? 'Paste Pose Mirrored' : 'Paste Pose'} at Frame ${frame}`;
  return plan([{ op: 'pose.setAt', args: call }], label);
}

const pasteAt = wrapper({
  id: 'pose.pasteAt',
  label: 'Paste Pose at Frame',
  description: 'Key the copied pose at a frame without moving the playhead (mirrored on request).',
  category: 'pose',
  aliases: ['Paste Pose at', 'Paste Pose at Time'],
  keys: true,
  undoLabel: (args) => (args['mirrored'] === true ? 'Paste Pose Mirrored at Frame' : 'Paste Pose at Frame'),
  plan: (app, args) => pasteAtPlan(app, args, app.session.getState().clipboard.pose),
  async planAsync(ctx, args) {
    const first = pasteAtPlan(ctx.app, args, ctx.app.session.getState().clipboard.pose);
    if (first !== null) return first;
    return pasteAtPlan(ctx.app, args, await pasteClipboard(ctx)) ?? 'There is no copied pose';
  },
  result: ([value]) => {
    const set = value as OperatorReturn<'pose.setAt'>;
    return { keyed: set.keyed + set.synced };
  },
});

/** `pose.placeGoal` and `pose.reach` {key}: one IK goal through `pose.goals`. */
/** Why a goal's position or rotation is malformed, or null. */
function goalProblem(args: AnyArgs): string | null {
  const problem = vec3Problem(args['position'], 'position');
  if (problem !== null) return problem;
  const rotation = args['rotation'];
  if (rotation === undefined) return null;
  if (!Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(isFiniteNumber)) {
    return 'rotation must be a quaternion [x, y, z, w]';
  }
  return Math.hypot(...rotation) < 1e-9 ? 'rotation must not be zero' : null;
}

function goalPlan(app: EditorApp, args: AnyArgs, name: 'position'): Plan<{ readonly limb: LimbId }> | string {
  const problem = goalProblem(args);
  if (problem !== null) return problem;
  const clip = clipOf(app, args);
  if (typeof clip === 'string') return clip;
  const frame = frameOf(app, clip, args);
  if (typeof frame === 'string') return frame;
  const runtime = runtimeOf(app, clip);
  if (typeof runtime === 'string') return runtime;
  const limb = limbOf(app, runtime, args);
  if (typeof limb === 'string') return limb;
  const goal = {
    position: args[name] as Vec3,
    ...(args['rotation'] === undefined ? {} : { rotation: args['rotation'] as Quat }),
  };
  const ik = ikGoalOf(app, clip, runtime, limb, frame, goal);
  if (typeof ik === 'string') return ik;
  const call: OperatorArgs<'pose.goals'> = { clip: clip.id, frame, ik };
  return plan([{ op: 'pose.goals', args: call }], '', { limb: limb.id });
}

function goalResult(value: unknown): { readonly keyed: number; readonly reached: boolean } {
  const goals = value as OperatorReturn<'pose.goals'>;
  return { keyed: goals.keyed, reached: goals.ik.every((goal) => goal.reached) };
}

const placeGoal = wrapper({
  id: 'pose.placeGoal',
  label: 'Place IK Goal',
  description: "Put a hand's or a foot's IK goal at a point, keyed at the frame; the limb follows.",
  category: 'pose',
  aliases: ['Place Goal', 'IK Goal', 'Move IK Goal'],
  keys: true,
  undoLabel: (args) => (typeof args['limb'] === 'string' ? `Place Goal (${limbName(args['limb'])})` : 'Place Goal'),
  plan(app, args) {
    const resolved = goalPlan(app, args, 'position');
    if (typeof resolved === 'string') return resolved;
    return { ...resolved, label: `Place Goal (${LIMB_NAME[resolved.extra.limb]})` };
  },
  result: ([value]) => goalResult(value),
});

function limbName(limb: unknown): string {
  return LIMB_ORDER.includes(limb as LimbId) ? LIMB_NAME[limb as LimbId] : String(limb);
}

const reach = wrapper<'pose.reach', { readonly limb: LimbId; readonly proposed: number; readonly reached: boolean }>({
  id: 'pose.reach',
  label: 'Reach',
  description: 'Move a hand or a foot to a point and let the limb follow: keyed at the playhead with auto key on.',
  category: 'pose',
  aliases: ['Reach Pose', 'Drag IK'],
  keys: true,
  undoLabel: (args) => (typeof args['limb'] === 'string' ? `Reach (${limbName(args['limb'])})` : 'Reach'),
  plan(app, args) {
    const key = args['key'] ?? app.prefs.getState().autoKey;
    if (typeof key !== 'boolean') return 'key must be true or false';
    if (key) {
      const resolved = goalPlan(app, args, 'position');
      if (typeof resolved === 'string') return resolved;
      const label = `Reach (${LIMB_NAME[resolved.extra.limb]})`;
      return { ...resolved, label, extra: { limb: resolved.extra.limb, proposed: 0, reached: true } };
    }
    // Unkeyed: the solved channels become overrides at the playhead (`pose.setAt {propose}`).
    const problem = goalProblem(args);
    if (problem !== null) return problem;
    const clip = clipOf(app, args);
    if (typeof clip === 'string') return clip;
    const frame = frameOf(app, clip, args);
    if (typeof frame === 'string') return frame;
    const runtime = runtimeOf(app, clip);
    if (typeof runtime === 'string') return runtime;
    const limb = limbOf(app, runtime, args);
    if (typeof limb === 'string') return limb;
    if (ikFkIn(limb, keyedChannels(runtime, clip, frame)) < IK_FROM) {
      return `The ${LIMB_NAME[limb.id]} is FK here: switch it to IK first`;
    }
    const goal = {
      position: args['position'] as Vec3,
      ...(args['rotation'] === undefined ? {} : { rotation: args['rotation'] as Quat }),
    };
    const { values, reached } = solveReach(app, clip, limb.id, frame, goal);
    const edits: { control: ControlId; channel: ChannelId; value: number }[] = [];
    for (const [control, channels] of values) {
      for (const [channel, value] of Object.entries(channels) as [ChannelId, number | undefined][]) {
        if (value !== undefined) edits.push({ control, channel, value });
      }
    }
    if (edits.length === 0) return 'Nothing to move: the limb is locked';
    const call: OperatorArgs<'pose.setAt'> = { clip: clip.id, frame, edits, mode: 'propose' };
    return plan([{ op: 'pose.setAt', args: call }], `Reach (${LIMB_NAME[limb.id]})`, {
      limb: limb.id,
      proposed: edits.length,
      reached,
    });
  },
  result: ([value], resolved) => {
    if (resolved.extra.proposed > 0)
      return { keyed: 0, proposed: resolved.extra.proposed, reached: resolved.extra.reached };
    const goals = goalResult(value);
    return { keyed: goals.keyed, proposed: 0, reached: goals.reached };
  },
});

const lookAt = wrapper({
  id: 'pose.lookAt',
  label: 'Look At',
  description: 'Turn the head (shared with the neck), or another bone, toward a point, keyed at the frame.',
  category: 'pose',
  aliases: ['Aim', 'Aim At', 'Look'],
  keys: true,
  undoLabel: () => 'Look At',
  plan(app, args) {
    const problem = vec3Problem(args['target'], 'target');
    if (problem !== null) return problem;
    const bone = args['bone'] ?? 'head';
    if (typeof bone !== 'string') return 'bone must be a bone name';
    const weight = args['weight'] ?? 1;
    if (!isFiniteNumber(weight) || weight < 0 || weight > 1) return 'weight must lie in 0…1';
    const keepTwist = args['keepTwist'] ?? true;
    if (typeof keepTwist !== 'boolean') return 'keepTwist must be true or false';
    const clip = clipOf(app, args);
    if (typeof clip === 'string') return clip;
    const frame = frameOf(app, clip, args);
    if (typeof frame === 'string') return frame;
    const runtime = runtimeOf(app, clip);
    if (typeof runtime === 'string') return runtime;
    const node = boneNode(runtime, bone);
    if (node < 0) return `The character has no ${bone}`;
    const program = runtime.program;
    const ch = keyedChannels(runtime, clip, frame);
    const limb = limbOfNode(program, node);
    if (limb !== null && ikFkIn(limb, ch) > 1e-9) return `The ${bone} follows its IK goal: use Place Goal`;
    const pose = program.allocPose();
    program.evaluate(ch, pose);
    const at = [0, 1, 2].map((i) => pose.boneWorld[node * 16 + 12 + i] as number);
    const target = args['target'] as Vec3;
    const toward = [target[0] - (at[0] ?? 0), target[1] - (at[1] ?? 0), target[2] - (at[2] ?? 0)];
    const length = Math.hypot(...toward);
    if (length < 1e-6) return `The point is where the ${bone} is`;
    const direction = toward.map((v) => v / length) as unknown as Vec3;
    const aim = { bone, direction, keepTwist, weight, ...(bone === 'head' ? { split: HEAD_SPLIT } : {}) };
    const call: OperatorArgs<'pose.goals'> = { clip: clip.id, frame, aims: [aim] };
    return plan([{ op: 'pose.goals', args: call }], 'Look At');
  },
  result: ([value]) => ({ keyed: (value as OperatorReturn<'pose.goals'>).keyed }),
});

// ---------- clips ----------

const loop = wrapper<'clip.loop', { readonly name: string }>({
  id: 'clip.loop',
  label: 'Make Loop',
  description: 'Make the animation loop seamlessly: match its ends (or blend them), keeping root travel.',
  category: 'clip',
  aliases: ['Loop', 'Loop It', 'Seamless Loop', 'Cycle'],
  keys: true,
  undoLabel: () => 'Make Loop',
  plan(app, args) {
    const method = args['method'] ?? 'matchEnds';
    if (!LOOP_METHODS.includes(method as UiLoopMethod)) return `method is one of ${LOOP_METHODS.join(', ')}`;
    const rootTravel = args['rootTravel'] ?? 'cycleOffset';
    if (!LOOP_TRAVEL.includes(rootTravel as UiLoopTravel)) return `rootTravel is one of ${LOOP_TRAVEL.join(', ')}`;
    const clip = clipOf(app, args);
    if (typeof clip === 'string') return clip;
    const blendFrames = args['blendFrames'];
    if (blendFrames !== undefined && !isFiniteNumber(blendFrames)) return 'blendFrames must be a number of frames';
    const call: OperatorArgs<'clip.makeLoop'> = {
      clip: clip.id,
      method: method as UiLoopMethod,
      rootTravel: rootTravel as UiLoopTravel,
      ...(blendFrames === undefined ? {} : { blendFrames }),
    };
    return plan([{ op: 'clip.makeLoop', args: call }], `Make Loop "${clip.name}"`, { name: clip.name });
  },
  result: ([value]) => {
    const made = value as OperatorReturn<'clip.makeLoop'>;
    return { curvesChanged: made.curvesChanged, seamBefore: made.before.maxC0, seamAfter: made.after.maxC0 };
  },
});

// ---------- keys ----------

function adjustResult(value: unknown): { readonly keys: number; readonly curves: number } {
  const adjusted = value as OperatorReturn<'key.adjust'>;
  return { keys: adjusted.keys, curves: adjusted.curves };
}

const scaleValues = wrapper({
  id: 'key.scaleValues',
  label: 'Scale Key Values',
  description: 'Scale the values of the selected keys (or of the time range) about the rest pose, their mean or start.',
  category: 'key',
  aliases: ['Scale Values', 'Exaggerate', 'Scale Animation'],
  keys: true,
  undoLabel: () => 'Scale Values',
  plan(app, args) {
    const factor = args['factor'];
    if (!isFiniteNumber(factor) || factor < 0.01 || factor > 100) return 'factor must lie in 0.01…100';
    if (factor === 1) return 'Nothing to scale: the factor is 1';
    const pivot = args['pivot'] ?? 'rest';
    if (!SCALE_PIVOTS.includes(pivot as UiScalePivot)) return `pivot is one of ${SCALE_PIVOTS.join(', ')}`;
    const clip = clipOf(app, args);
    if (typeof clip === 'string') return clip;
    const scope = keyScopeOf(app, clip, args);
    if (typeof scope === 'string') return scope;
    const call: OperatorArgs<'key.adjust'> = {
      clip: clip.id,
      targets: scope.targets,
      ...scope.where,
      factor,
      pivot: { kind: pivot as UiScalePivot },
    };
    return plan([{ op: 'key.adjust', args: call }], `Scale Values ×${factor}`);
  },
  result: ([value]) => adjustResult(value),
});

const OFFSET_KINDS = ['rotate', 'translate', 'scale', 'attr'] as const;

const offsetValues = wrapper({
  id: 'key.offsetValues',
  label: 'Offset Key Values',
  description:
    'Add an offset to the values of the selected keys (or of the time range): turn, move, scale or attribute.',
  category: 'key',
  aliases: ['Offset Values', 'Shift Values'],
  keys: true,
  undoLabel: () => 'Offset Values',
  plan(app, args) {
    const offset: Partial<Record<(typeof OFFSET_KINDS)[number], number>> = {};
    for (const kind of OFFSET_KINDS) {
      const value = args[kind];
      if (value === undefined) continue;
      if (!isFiniteNumber(value)) return `${kind} must be a number`;
      if (value !== 0) offset[kind] = value;
    }
    if (Object.keys(offset).length === 0) return 'Nothing to offset: every offset is 0';
    const clip = clipOf(app, args);
    if (typeof clip === 'string') return clip;
    const scope = keyScopeOf(app, clip, args);
    if (typeof scope === 'string') return scope;
    const call: OperatorArgs<'key.adjust'> = { clip: clip.id, targets: scope.targets, ...scope.where, offset };
    return plan([{ op: 'key.adjust', args: call }], 'Offset Values');
  },
  result: ([value]) => adjustResult(value),
});

const offsetInLoop = wrapper({
  id: 'key.offsetInLoop',
  label: 'Offset in Loop',
  description: 'Shift the selected channels in time, wrapping around the loop (a looping animation only).',
  category: 'key',
  aliases: ['Cycle Offset', 'Offset Cycle', 'Phase'],
  keys: true,
  undoLabel: () => 'Offset in Loop',
  plan(app, args) {
    const offset = args['offset'];
    if (!isFiniteNumber(offset) || Math.abs(offset) > 100_000) return 'offset must be a number of frames';
    if (offset === 0) return 'Nothing to offset: the offset is 0';
    if (args['range'] !== undefined) return 'Offset in Loop moves whole curves: pass no range';
    const clip = clipOf(app, args);
    if (typeof clip === 'string') return clip;
    if (!clip.loop) return 'The animation does not loop: turn Loop on first';
    const scope = keyScopeOf(app, clip, args);
    if (typeof scope === 'string') return scope;
    const call: OperatorArgs<'key.retime'> = {
      clip: clip.id,
      targets: scope.targets,
      mode: 'offset',
      offset,
      wrap: true,
    };
    return plan([{ op: 'key.retime', args: call }], `Offset in Loop (${offset > 0 ? '+' : ''}${offset} frames)`);
  },
  result: ([value]) => ({ moved: (value as OperatorReturn<'key.retime'>).moved }),
});

// ---------- image planes ----------

interface Replaced {
  readonly plane: ImagePlaneRecord;
  readonly steps: readonly { readonly def: AnyOperator; readonly prepared: unknown }[];
  readonly importArgs: OperatorArgs<'imagePlane.import'>;
}

/** The plane to replace and the new image's bytes, or why not. */
function replaceTargets(app: EditorApp, raw: unknown): { plane: ImagePlaneRecord; bytes: Uint8Array } | string {
  if (!isRecord(raw)) return 'expects { id, bytes }';
  if (typeof raw['id'] !== 'string') return 'Pick the image plane to replace';
  const plane = app.store.get('imagePlanes', raw['id'] as ImagePlaneRecord['id']);
  if (plane === undefined) return 'The image plane does not exist';
  if (plane.locked) return LOCKED_REASON;
  const bytes = imageBytesOf(raw['bytes']);
  if (bytes === null) return 'Pick the new image (a PNG or JPEG file)';
  if (bytes.byteLength > MAX_IMAGE_BYTES) return 'The image is larger than 32 MB';
  if (imageExt(bytes) === null) return 'Reference images must be PNG or JPEG files';
  if (raw['name'] !== undefined && typeof raw['name'] !== 'string') return 'name must be text';
  return { plane, bytes };
}

const replaceImage = defineOperator<'imagePlane.replace', Replaced>({
  id: 'imagePlane.replace',
  label: 'Replace Image',
  description: "Swap an image plane's picture; its view, placement, opacity, depth and visibility stay.",
  category: 'imagePlane',
  scope: 'model',
  workspaces: ['model'],
  flags: { undo: true },
  extraArgs: ['id', 'bytes', 'name'],
  aliases: ['Replace Reference Image', 'Change Image'],
  undoLabel: () => 'Replace Image',
  poll(ctx, raw) {
    const common = pollCommon(ctx, false);
    if (common !== true) return common;
    const targets = replaceTargets(ctx.app, raw);
    if (typeof targets === 'string') return fail(targets);
    for (const op of ['imagePlane.delete', 'imagePlane.import', 'imagePlane.set']) {
      if (ctx.app.operators.get(op) === undefined) return fail(`${op} is not loaded`);
    }
    return pollCall(ctx, { op: 'imagePlane.delete', args: { id: targets.plane.id } });
  },
  async prepare(ctx, raw) {
    const targets = replaceTargets(ctx.app, raw);
    if (typeof targets === 'string') throw new EkzaError('unsupported', targets);
    const { plane, bytes } = targets;
    const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : plane.name;
    const importArgs: OperatorArgs<'imagePlane.import'> = { camera: plane.camera, name, bytes };
    const steps: { def: AnyOperator; prepared: unknown }[] = [];
    for (const [op, args] of [
      ['imagePlane.delete', { id: plane.id }],
      ['imagePlane.import', importArgs],
      ['imagePlane.set', { id: plane.id, patch: { opacity: plane.opacity } }],
    ] as const) {
      const def = ctx.app.operators.get(op);
      if (def === undefined) throw new EkzaError('unavailable', `${op} is not loaded`);
      let prepared = def.prepare?.(ctx, args);
      if (isThenable(prepared)) prepared = await prepared;
      steps.push({ def, prepared });
    }
    return { plane, steps, importArgs };
  },
  apply(ctx, _args, { plane, steps, importArgs }) {
    const [remove, add, set] = steps as [
      Replaced['steps'][number],
      Replaced['steps'][number],
      Replaced['steps'][number],
    ];
    remove.def.apply(ctx, { id: plane.id }, remove.prepared);
    const { id } = add.def.apply(ctx, importArgs, add.prepared) as OperatorReturn<'imagePlane.import'>;
    const patch: Partial<ImagePlaneRecord> = {
      name: plane.name,
      offset: plane.offset,
      size: plane.size,
      opacity: plane.opacity,
      depth: plane.depth,
      visible: plane.visible,
    };
    set.def.apply(ctx, { id, patch }, set.prepared);
    ctx.tx?.annotate({ label: 'Replace Image' });
    return { id };
  },
});

/** Every wrapper, in the order of `UI_WRAPPER_IDS`. */
export const UI_WRAPPER_OPERATORS: readonly AnyOperator[] = [
  hold,
  pasteAt,
  placeGoal,
  lookAt,
  reach,
  loop,
  scaleValues,
  offsetValues,
  offsetInLoop,
  replaceImage,
];
