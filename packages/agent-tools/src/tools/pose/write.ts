// Posing tools (MCP-SPEC §6.3 tools 9–13, §4.10, §5.2): pose_set (pose.setAt: always keys, synchronised rotation axes;
// static values; an unkeyed proposal at the user's frame under View), pose_aim and pose_ik_target (pose.goals: aims in
// character space, IK effectors with named orientation angles, an FK limb switched to IK over a given range only),
// pose_transfer (pose.transfer: copy or mirror without the clipboard) and pose_reset (key.write of rest values).
import type { Quat, Vec3 } from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, ControlRecord, CurveId } from '@ekza-animator/doc';
import { attrDefOf, channelDefaultOf, isKeyable, isLocked } from '@ekza-animator/editor-core';
import { type LimbDesc, readAttr } from '@ekza-animator/rig';
import { controlKeyOf } from '../../resolve/resolver';
import {
  type ChannelTargetRef,
  channelTargets,
  checkFrames,
  curveOf,
  curvesOfTargets,
  keyableChannelsOf,
  limbOf,
  resolveControls,
} from '../../resolve/targets';
import { addressed, atFrame, plural, staleCheck, valueOf, writeResult } from '../../runtime/toolkit';
import { quoteName } from '../../sanitize/sanitize';
import { AgentToolFailure, type AgentToolContext, type AgentToolResult, type ConfirmPrompt } from '../../types';
import { attrAt, channelsAt, isUserFrame, nodeOfBone, nodeXf, poseAt, restPoseOf, userFrameOf } from '../../units/pose';
import {
  directionOf,
  isRotationChannel,
  keyTime,
  looksLikeRadians,
  normalize,
  orientFromRest,
  outValue,
  outVec,
  RADIANS_WARNING,
  roundTo,
  toStoredValue,
  toToolValue,
  type ToolUnit,
  unitOfChannel,
} from '../../units/units';
import { hiddenWarnings, targetNames, WRITE_KEYS_MAX } from '../keys/write';

const AXES = ['x', 'y', 'z'] as const;
/** Half the output rounding step per unit: a pose_read value written back unchanged is the same value (§6.2). */
const SAME_VALUE: Readonly<Record<ToolUnit, number>> = { deg: 0.005, m: 0.00005, factor: 0.00005, none: 0.00005 };

function humanoidOnly(
  ctx: AgentToolContext,
  character: Parameters<typeof ctx.app.store.query.rigOfCharacter>[0],
  what: string,
): void {
  const rig = ctx.app.store.query.rigOfCharacter(character);
  if (rig?.generator.name !== 'ekza-autorig-humanoid') {
    throw new AgentToolFailure(
      'humanoid_only',
      `${what} works on humanoid rigs only.`,
      'pose this rig with pose_set or keys_set on its controls',
      { retryable: false },
    );
  }
}

// ---------- pose_set ----------
export interface PoseSetItem {
  readonly control: string;
  readonly rotateDeg?:
    | { readonly x?: number | undefined; readonly y?: number | undefined; readonly z?: number | undefined }
    | undefined;
  readonly translateM?:
    | { readonly x?: number | undefined; readonly y?: number | undefined; readonly z?: number | undefined }
    | undefined;
  readonly scaleFactor?:
    | { readonly x?: number | undefined; readonly y?: number | undefined; readonly z?: number | undefined }
    | undefined;
  readonly attrs?: Readonly<Record<string, number>> | undefined;
  readonly rotateOrder?: string | undefined;
}
export interface PoseSetArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly frame: number;
  readonly set: readonly PoseSetItem[];
  readonly mode: 'absolute' | 'relative';
  readonly key: 'key' | 'static' | 'pose_only';
  readonly syncRotation: boolean;
  readonly tangent?: string | undefined;
  readonly extendRange: boolean;
}

interface PlannedEdit {
  readonly control: ControlRecord;
  readonly channel: ChannelId;
  readonly unit: ToolUnit;
  readonly before: number; // tool units
  readonly after: number; // tool units
  readonly stored: number;
}

export async function poseSet(ctx: AgentToolContext, args: PoseSetArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const { runtime } = target;
  const proposal = args.key === 'pose_only';
  const frame = keyTime(args.frame);
  if (proposal) {
    // §6.3: only at the user's current frame of the character's active clip.
    if (
      userFrameOf(ctx.app, target.character.id, target.clip.id) === null ||
      !isUserFrame(ctx.app, target.character.id, target.clip.id, frame)
    ) {
      throw new AgentToolFailure(
        'invalid_args',
        "pose_only proposes a pose at the user's current frame of the clip the user is looking at.",
        'read the user’s clip and frame with scene_summary and pass them, or key the pose (key: "key")',
        { detail: { path: 'frame' } },
      );
    }
  } else if (args.key === 'key') {
    checkFrames(target.record, [frame], { extendRange: args.extendRange, path: 'frame' });
  }
  const keyed = channelsAt(ctx.app, runtime, target.clip.id, frame, false);
  const warnings: (string | null)[] = [];
  const rotations: number[] = [];
  const edits: PlannedEdit[] = [];
  const unchanged = new Set<string>();
  args.set.forEach((item, i) => {
    const resolved = ctx.resolve.control(target.character.id, item.control);
    const control = ctx.app.store.get('controls', resolved.id) as ControlRecord;
    if (item.rotateOrder !== undefined && item.rotateOrder !== control.rotateOrder) {
      throw new AgentToolFailure(
        'invalid_args',
        `${resolved.key} has rotate order ${control.rotateOrder}, not ${item.rotateOrder}.`,
        'read the control with pose_read and pass its rotateOrder (or leave it out)',
        { detail: { path: `set[${i}].rotateOrder` } },
      );
    }
    const slot = runtime.program.controlIndex.get(control.id);
    if (slot === undefined) return;
    const add = (channel: ChannelId, value: number, current: number): void => {
      const unit = unitOfChannel(control, channel);
      const before = toToolValue(unit, current);
      const after = args.mode === 'relative' ? before + value : value;
      edits.push({ control, channel, unit, before, after, stored: toStoredValue(unit, after) });
    };
    const groups: readonly ['t' | 'r' | 's', number, PoseSetItem['rotateDeg']][] = [
      ['t', 0, item.translateM],
      ['r', 3, item.rotateDeg],
      ['s', 6, item.scaleFactor],
    ];
    for (const [prefix, base, values] of groups) {
      if (values === undefined) continue;
      AXES.forEach((axis, k) => {
        const value = values[axis];
        if (value === undefined) return;
        if (prefix === 'r') rotations.push(value);
        add(`${prefix}${axis}` as ChannelId, value, keyed.values[slot * 9 + base + k] as number);
      });
    }
    for (const [name, value] of Object.entries(item.attrs ?? {})) {
      const channel = `@${name}` as ChannelId;
      if (attrDefOf(control, channel) === undefined) {
        throw new AgentToolFailure(
          'not_keyable',
          `${resolved.key} has no attribute ${quoteName(name)}.`,
          `its attributes: ${Object.keys(control.attrs).join(', ') || 'none'}`,
          { candidates: Object.keys(control.attrs).slice(0, 5), detail: { path: `set[${i}].attrs.${name}` } },
        );
      }
      if (unitOfChannel(control, channel) === 'deg') rotations.push(value);
      add(channel, value, readAttr(runtime.program, keyed, control.id, name) ?? channelDefaultOf(control, channel));
    }
  });
  if (looksLikeRadians(rotations)) warnings.push(RADIANS_WARNING);
  // A value written back unchanged onto a key at that frame changes nothing (pose_read → pose_set): it is left out.
  // Every other edit keys, equal values included — blocking a rest pose at f0 must keep it when f10 gets keyed.
  const writes = edits.filter((edit) => {
    if (args.key !== 'key' || Math.abs(edit.after - edit.before) > SAME_VALUE[edit.unit]) return true;
    const curve = curveOf(ctx.app, target.clip.id, edit.control.id, edit.channel);
    const keyed =
      curve !== undefined && ctx.app.store.query.keysOfCurve(curve.id).some((key) => Math.abs(key.t - frame) <= 1e-6);
    if (!keyed) return true;
    unchanged.add(`${edit.control.id} ${edit.channel}`);
    return false;
  });
  const touched: ChannelTargetRef[] = writes.map((edit) => ({ control: edit.control, channel: edit.channel }));
  if (args.syncRotation && args.key === 'key') {
    for (const edit of writes) {
      if (!isRotationChannel(edit.channel)) continue;
      for (const channel of ['rx', 'ry', 'rz'] as const) touched.push({ control: edit.control, channel });
    }
  }
  const stale = proposal
    ? null
    : staleCheck(ctx, target.clip.id, args.ifClipRevision, {
        curves: curvesOfTargets(ctx.app, target.clip.id, touched),
        clipRecord: args.key === 'key' && args.extendRange,
      });
  warnings.push(stale);
  const controls = [...new Set(edits.map((edit) => edit.control.id))];
  const changed = (list: readonly PlannedEdit[]) =>
    list.slice(0, 60).map((edit) => ({
      control: controlKeyOf(edit.control),
      channel: edit.channel,
      before: outValue(edit.unit, edit.before),
      after: outValue(edit.unit, edit.after),
      unit: edit.unit === 'none' ? ('factor' as const) : edit.unit,
    }));
  if (writes.length === 0) {
    return writeResult(
      ctx,
      target.clip.id,
      null,
      { frame, changed: [], changedCount: 0, keyed: 0, synced: 0, statics: 0, skipped: [] },
      [...warnings, edits.length > 0 ? 'every value equals the keyed value at this frame; nothing changed' : null],
    );
  }
  const verb = proposal ? 'Propose pose' : args.key === 'static' ? 'Set static pose' : 'Set pose';
  const label = `${verb} (${plural(controls.length, 'control')}) ${atFrame(frame)}`;
  ctx.focus({ character: target.character.id, clip: target.clip.id, controls, frame }, label);
  const run = await ctx.run(
    'pose.setAt',
    {
      clip: target.clip.id,
      frame,
      edits: writes.map((edit) => ({ control: edit.control.id, channel: edit.channel, value: edit.stored })),
      mode: proposal ? 'propose' : args.key,
      ...(args.tangent === undefined ? {} : { tangent: args.tangent }),
      syncRotation: args.syncRotation,
      extendRange: args.extendRange,
      label,
    },
    proposal ? { access: 'view' } : undefined,
  );
  const value = valueOf<{
    readonly keyed: number;
    readonly synced: number;
    readonly statics: number;
    readonly skipped: readonly {
      readonly control: ControlId;
      readonly channel: ChannelId;
      readonly reason: 'locked' | 'non-keyable' | 'animated';
    }[];
    readonly hiddenByOverrides: readonly { readonly control: ControlId; readonly channel: ChannelId }[];
  }>('pose.setAt', run);
  const skippedKeys = new Set(value.skipped.map((skip) => `${skip.control} ${skip.channel}`));
  const applied = writes.filter((edit) => !skippedKeys.has(`${edit.control.id} ${edit.channel}`));
  return writeResult(
    ctx,
    target.clip.id,
    run,
    {
      frame,
      changed: changed(applied),
      changedCount: applied.length,
      keyed: value.keyed,
      synced: value.synced,
      statics: value.statics,
      skipped: value.skipped.slice(0, 60).map((skip) => {
        const control = ctx.app.store.get('controls', skip.control);
        return {
          control: control === undefined ? skip.control : controlKeyOf(control),
          channel: skip.channel,
          reason: skip.reason === 'non-keyable' ? ('not_keyable' as const) : skip.reason,
        };
      }),
    },
    [...warnings, ...hiddenWarnings(targetNames(ctx, value.hiddenByOverrides), frame)],
  );
}

// ---------- shared by pose_aim and pose_ik_target ----------
/** ikFk of a limb in a clip at a frame (keyed; the attribute's default without a curve). */
export function ikFkAt(
  ctx: AgentToolContext,
  target: ReturnType<typeof addressed>,
  limb: LimbDesc,
  frame: number,
): number {
  const control = ctx.app.store.get('controls', limb.params.ikControl);
  const fallback = control === undefined ? 0 : channelDefaultOf(control, '@ikFk');
  return attrAt(target.runtime, target.clip.id, limb.params.ikControl, 'ikFk', frame, fallback);
}

const LIMB_NODES = (limb: LimbDesc): number[] => [limb.nodes.upper, limb.nodes.mid, limb.nodes.end];

/** Curves of a control's keyable channels in a clip (what a goal write touches). */
function curvesOfControls(
  ctx: AgentToolContext,
  clip: Parameters<typeof curveOf>[1],
  controls: readonly ControlRecord[],
): CurveId[] {
  return curvesOfTargets(
    ctx.app,
    clip,
    controls.flatMap((control) =>
      keyableChannelsOf(control, { includeModes: true }).map((channel) => ({ control, channel })),
    ),
  );
}

// ---------- pose_aim ----------
export interface PoseAimArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly frame: number;
  readonly aims: readonly {
    readonly bone: string;
    readonly direction?: string | readonly number[] | undefined;
    readonly towardBone?: string | undefined;
    readonly towardPointM?: readonly number[] | undefined;
    readonly keepTwist: boolean;
    readonly weight: number;
    readonly split?: { readonly neck: number; readonly head: number } | undefined;
  }[];
  readonly extendRange: boolean;
}

export async function poseAim(ctx: AgentToolContext, args: PoseAimArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const { runtime } = target;
  humanoidOnly(ctx, target.character.id, 'pose_aim');
  const frame = keyTime(args.frame);
  checkFrames(target.record, [frame], { extendRange: args.extendRange, path: 'frame' });
  const pose = poseAt(
    ctx.app,
    runtime,
    target.clip.id,
    Math.min(Math.max(frame, target.record.range.start), target.record.range.end),
  );
  const drivers: ControlRecord[] = [];
  const aims = args.aims.map((aim, i) => {
    const bone = ctx.resolve.bone(target.character.id, aim.bone);
    const node = nodeOfBone(runtime, bone.humanoid ?? bone.name);
    const limb = runtime.program.limbs.find((candidate) => LIMB_NODES(candidate).includes(node));
    if (limb !== undefined && ikFkAt(ctx, target, limb, frame) > 1e-6) {
      throw new AgentToolFailure(
        'limb_mode',
        `${bone.humanoid ?? bone.name} is IK-driven at frame ${frame} (${limb.id}).`,
        `use pose_ik_target {limb: '${limb.id}'} to place the ${limb.id.startsWith('leg') ? 'foot' : 'hand'}`,
        { detail: { path: `aims[${i}].bone` } },
      );
    }
    const at = nodeXf(pose, node).position;
    let direction: Vec3;
    if (aim.direction !== undefined) {
      direction = directionOf(aim.direction, `aims[${i}].direction`);
    } else {
      const point =
        aim.towardBone !== undefined
          ? (() => {
              const other = ctx.resolve.bone(target.character.id, aim.towardBone);
              return nodeXf(pose, nodeOfBone(runtime, other.humanoid ?? other.name)).position;
            })()
          : ([aim.towardPointM?.[0] ?? 0, aim.towardPointM?.[1] ?? 0, aim.towardPointM?.[2] ?? 0] as Vec3);
      const toward = normalize([point[0] - at[0], point[1] - at[1], point[2] - at[2]]);
      if (toward === null) {
        throw new AgentToolFailure(
          'invalid_args',
          `aims[${i}]: the target is where the bone is.`,
          'aim at another point or bone',
          {
            detail: { path: `aims[${i}]` },
          },
        );
      }
      direction = toward;
    }
    const driver = ctx.app.store.query.controlsOfRig(runtime.program.rigId).find((control) => {
      const b = control.drives?.bone;
      return b !== undefined && ('humanoid' in b ? b.humanoid === bone.humanoid : b.name === bone.name);
    });
    if (driver !== undefined) drivers.push(driver);
    const head = (bone.humanoid ?? '') === 'head';
    return {
      bone: bone.humanoid ?? bone.name,
      direction,
      keepTwist: aim.keepTwist,
      weight: aim.weight,
      ...(head ? { split: aim.split ?? { neck: 0.4, head: 0.6 } } : {}),
    };
  });
  const neck = aims.some((aim) => aim.split !== undefined)
    ? ctx.app.store.query.controlsOfRig(runtime.program.rigId).find((c) => c.key === 'fk.neck')
    : undefined;
  if (neck !== undefined) drivers.push(neck);
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curvesOfControls(ctx, target.clip.id, drivers),
    clipRecord: args.extendRange,
  });
  const label = `Aim pose (${plural(aims.length, 'bone')}) ${atFrame(frame)}`;
  ctx.focus({ character: target.character.id, clip: target.clip.id, controls: drivers.map((c) => c.id), frame }, label);
  const run = await ctx.run('pose.goals', {
    clip: target.clip.id,
    frame,
    aims,
    extendRange: args.extendRange,
    label,
  });
  const value = valueOf<{
    readonly aims: readonly {
      readonly bone: string;
      readonly control: ControlId;
      readonly achieved: Vec3;
      readonly errorRad: number;
    }[];
    readonly keyed: number;
  }>('pose.goals', run);
  return writeResult(
    ctx,
    target.clip.id,
    run,
    {
      frame,
      aims: value.aims.map((aim) => {
        const control = ctx.app.store.get('controls', aim.control);
        return {
          bone: aim.bone,
          control: control === undefined ? aim.control : controlKeyOf(control),
          achievedDirection: outVec(aim.achieved),
          errorDeg: roundTo((aim.errorRad * 180) / Math.PI, 0.01),
        };
      }),
      keyed: value.keyed,
    },
    [stale],
  );
}

// ---------- pose_ik_target ----------
export interface PoseIkTargetArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly frame: number;
  readonly limb: 'leg.L' | 'leg.R' | 'arm.L' | 'arm.R';
  readonly positionM?: readonly number[] | undefined;
  readonly offsetM?: readonly number[] | undefined;
  readonly nearBone?: { readonly bone: string; readonly offsetM?: readonly number[] | undefined } | undefined;
  readonly orientDeg?:
    | {
        readonly pitchDeg?: number | undefined;
        readonly yawDeg?: number | undefined;
        readonly rollDeg?: number | undefined;
      }
    | undefined;
  readonly poleDirection?: string | readonly number[] | undefined;
  readonly ensureIk: 'never' | 'auto';
  readonly switchRangeFrames?: readonly [number, number] | undefined;
  readonly extendRange: boolean;
}

interface IkPlan {
  readonly target: ReturnType<typeof addressed>;
  readonly limb: LimbDesc;
  readonly frame: number;
  readonly fk: boolean;
  readonly switchRange: readonly [number, number] | null;
}

function ikPlan(ctx: AgentToolContext, args: PoseIkTargetArgs): IkPlan {
  const target = addressed(ctx, args);
  humanoidOnly(ctx, target.character.id, 'pose_ik_target');
  const limb = limbOf(target.runtime.program.limbs, args.limb);
  const frame = keyTime(args.frame);
  checkFrames(target.record, [frame], { extendRange: args.extendRange, path: 'frame' });
  const fk = ikFkAt(ctx, target, limb, frame) <= 1e-6;
  if (fk && args.ensureIk === 'never') {
    throw new AgentToolFailure(
      'limb_mode',
      `${args.limb} is FK at frame ${frame}.`,
      `use pose_aim (or pose_set on the FK controls), or pass ensureIk: 'auto' with switchRangeFrames to switch only that range to IK`,
    );
  }
  let switchRange: readonly [number, number] | null = null;
  if (args.ensureIk === 'auto' && fk) {
    const range = args.switchRangeFrames as readonly [number, number];
    if (range[0] > range[1] || frame < range[0] || frame > range[1]) {
      throw new AgentToolFailure(
        'invalid_args',
        `switchRangeFrames must contain frame ${frame}.`,
        'pass switchRangeFrames as [start, end] around the frame',
        { detail: { path: 'switchRangeFrames' } },
      );
    }
    checkFrames(target.record, [range[0], range[1]], { extendRange: false, path: 'switchRangeFrames' });
    switchRange = range;
  }
  return { target, limb, frame, fk, switchRange };
}

/** The FK keys of a limb inside a switch range stop showing there: the user confirms (live, §5.9). */
export function ikTargetConfirm(ctx: AgentToolContext, args: PoseIkTargetArgs): ConfirmPrompt | null {
  if (args.ensureIk !== 'auto' || !ctx.host.capabilities.has('confirm')) return null;
  const plan = ikPlan(ctx, args);
  if (plan.switchRange === null) return null;
  const [start, end] = plan.switchRange;
  let keys = 0;
  for (const id of plan.limb.fkControls) {
    for (const curve of ctx.app.store.query.curvesOfControl(plan.target.clip.id, id)) {
      keys += ctx.app.store.query.keysOfCurve(curve.id).filter((key) => key.t >= start && key.t <= end).length;
    }
  }
  if (keys === 0) return null;
  return {
    title: `AI wants to switch ${args.limb} to IK over frames ${start}–${end}`,
    detail: `${keys} FK keys of the limb there stop showing (FK keys outside keep playing). Undo restores the FK.`,
    danger: false,
  };
}

export async function poseIkTarget(ctx: AgentToolContext, args: PoseIkTargetArgs): Promise<AgentToolResult<unknown>> {
  const plan = ikPlan(ctx, args);
  const { target, limb, frame } = plan;
  const { runtime } = target;
  const pose = poseAt(
    ctx.app,
    runtime,
    target.clip.id,
    Math.min(Math.max(frame, target.record.range.start), target.record.range.end),
  );
  const end = nodeXf(pose, limb.nodes.end);
  let position: Vec3;
  if (args.positionM !== undefined) {
    position = [args.positionM[0] ?? 0, args.positionM[1] ?? 0, args.positionM[2] ?? 0];
  } else if (args.offsetM !== undefined) {
    position = [
      end.position[0] + (args.offsetM[0] ?? 0),
      end.position[1] + (args.offsetM[1] ?? 0),
      end.position[2] + (args.offsetM[2] ?? 0),
    ];
  } else {
    const near = args.nearBone as NonNullable<PoseIkTargetArgs['nearBone']>;
    const bone = ctx.resolve.bone(target.character.id, near.bone);
    const at = nodeXf(pose, nodeOfBone(runtime, bone.humanoid ?? bone.name)).position;
    position = [at[0] + (near.offsetM?.[0] ?? 0), at[1] + (near.offsetM?.[1] ?? 0), at[2] + (near.offsetM?.[2] ?? 0)];
  }
  let rotation: Quat | undefined;
  if (args.orientDeg !== undefined) {
    const rest = nodeXf(restPoseOf(runtime.program), limb.nodes.end).rotation;
    rotation = orientFromRest(rest, {
      pitchDeg: args.orientDeg.pitchDeg ?? 0,
      yawDeg: args.orientDeg.yawDeg ?? 0,
      rollDeg: args.orientDeg.rollDeg ?? 0,
    });
  }
  let pole: Vec3 | undefined;
  if (args.poleDirection !== undefined) {
    const dir = directionOf(args.poleDirection, 'poleDirection');
    const mid = nodeXf(pose, limb.nodes.mid).position;
    const distance = Math.max(limb.lengths.upper, 0.1);
    pole = [mid[0] + dir[0] * distance, mid[1] + dir[1] * distance, mid[2] + dir[2] * distance];
  }
  const controls = [limb.params.ikControl, limb.params.pole, ...(plan.switchRange === null ? [] : limb.fkControls)]
    .map((id) => ctx.app.store.get('controls', id))
    .filter((c): c is ControlRecord => c !== undefined);
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curvesOfControls(ctx, target.clip.id, controls),
    clipRecord: args.extendRange,
  });
  const label = `Place ${limb.id} IK ${atFrame(frame)}${plan.switchRange === null ? '' : ` (IK ${plan.switchRange[0]}–${plan.switchRange[1]})`}`;
  ctx.focus(
    { character: target.character.id, clip: target.clip.id, controls: controls.map((c) => c.id), frame },
    label,
  );
  const run = await ctx.run('pose.goals', {
    clip: target.clip.id,
    frame,
    ik: [
      {
        limb: limb.id,
        position,
        ...(rotation === undefined ? {} : { rotation }),
        ...(pole === undefined ? {} : { pole }),
        ensureIk: args.ensureIk,
        ...(plan.switchRange === null ? {} : { switchRange: { start: plan.switchRange[0], end: plan.switchRange[1] } }),
      },
    ],
    extendRange: args.extendRange,
    label,
  });
  const value = valueOf<{
    readonly ik: readonly {
      readonly limb: string;
      readonly reached: boolean;
      readonly errorM: number;
      readonly switched: { readonly start: number; readonly end: number } | null;
    }[];
    readonly keyed: number;
  }>('pose.goals', run);
  const result = value.ik[0];
  return writeResult(
    ctx,
    target.clip.id,
    run,
    {
      limb: limb.id,
      reached: result?.reached ?? false,
      errorM: roundTo(result?.errorM ?? 0, 0.0001),
      switchedToIk:
        result?.switched === null || result?.switched === undefined
          ? null
          : { rangeFrames: [result.switched.start, result.switched.end] },
      keyed: value.keyed,
    },
    [
      stale,
      result !== undefined && !result.reached
        ? `the ${limb.id.startsWith('leg') ? 'foot' : 'hand'} cannot reach that point; it stops ${roundTo(result.errorM * 100, 0.1)} cm short`
        : null,
    ],
  );
}

// ---------- pose_transfer ----------
export interface PoseTransferArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly fromFrame: number;
  readonly fromClip?: string | undefined;
  readonly toFrames: readonly number[];
  readonly controls?: readonly string[] | undefined;
  readonly bodyParts?: readonly string[] | undefined;
  readonly mirror: 'none' | 'flip' | 'left_to_right' | 'right_to_left';
  readonly extendRange: boolean;
}

const MIRROR = { none: 'none', flip: 'flip', left_to_right: 'leftToRight', right_to_left: 'rightToLeft' } as const;

function allOrNamed(
  ctx: AgentToolContext,
  target: ReturnType<typeof addressed>,
  controls: readonly string[] | undefined,
  bodyParts: readonly string[] | undefined,
): readonly ControlRecord[] {
  if (controls === undefined && bodyParts === undefined) {
    const rig = ctx.app.store.query.rigOfCharacter(target.character.id);
    return rig === undefined ? [] : ctx.app.store.query.controlsOfRig(rig.id);
  }
  return resolveControls(ctx.app, ctx.resolve, target.character.id, controls, bodyParts);
}

export async function poseTransfer(ctx: AgentToolContext, args: PoseTransferArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  if (args.mirror !== 'none') humanoidOnly(ctx, target.character.id, 'Mirroring');
  const from = args.fromClip === undefined ? target.clip : ctx.resolve.clip(target.character.id, args.fromClip);
  const fromRecord = ctx.app.store.get('clips', from.id);
  if (fromRecord !== undefined && (args.fromFrame < fromRecord.range.start || args.fromFrame > fromRecord.range.end)) {
    throw new AgentToolFailure(
      'out_of_range',
      `fromFrame ${args.fromFrame} is outside the range of ${quoteName(from.name)} [${fromRecord.range.start}, ${fromRecord.range.end}].`,
      'pick a frame inside the source clip',
      { detail: { path: 'fromFrame' } },
    );
  }
  const toFrames = [...new Set(args.toFrames.map(keyTime))];
  checkFrames(target.record, toFrames, { extendRange: args.extendRange, path: 'toFrames' });
  const controls = allOrNamed(ctx, target, args.controls, args.bodyParts);
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curvesOfControls(ctx, target.clip.id, controls),
    clipRecord: args.extendRange,
  });
  const label = `${args.mirror === 'none' ? 'Copy' : 'Mirror'} pose f${args.fromFrame} → ${plural(toFrames.length, 'frame')}`;
  ctx.focus(
    {
      character: target.character.id,
      clip: target.clip.id,
      controls: controls.map((c) => c.id),
      frame: toFrames.length === 1 ? (toFrames[0] as number) : null,
    },
    label,
  );
  const run = await ctx.run('pose.transfer', {
    clip: target.clip.id,
    ...(args.fromClip === undefined ? {} : { fromClip: from.id }),
    fromFrame: args.fromFrame,
    toFrames,
    controls: controls.map((c) => c.id),
    mirror: MIRROR[args.mirror],
    extendRange: args.extendRange,
    label,
  });
  const value = valueOf<{ readonly keyed: number }>('pose.transfer', run);
  return writeResult(ctx, target.clip.id, run, { keyed: value.keyed, frames: toFrames }, [stale]);
}

// ---------- pose_reset ----------
export interface PoseResetArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly frames: readonly number[];
  readonly controls?: readonly string[] | undefined;
  readonly bodyParts?: readonly string[] | undefined;
}

export async function poseReset(ctx: AgentToolContext, args: PoseResetArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const frames = [...new Set(args.frames.map(keyTime))];
  checkFrames(target.record, frames, { extendRange: false, path: 'frames' });
  const controls = allOrNamed(ctx, target, args.controls, args.bodyParts);
  // Rest values of every keyable, unlocked channel (modes such as ikFk only when the control is named).
  const targets = channelTargets(controls, undefined, { skipLocked: true }).filter(
    (t) => isKeyable(t.control, t.channel) && !isLocked(t.control, t.channel),
  );
  const count = targets.length * frames.length;
  if (count > WRITE_KEYS_MAX) {
    throw new AgentToolFailure(
      'limit',
      `The call writes ${count} keys; the limit is ${WRITE_KEYS_MAX}.`,
      'split it by frames or body parts',
    );
  }
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curvesOfTargets(ctx.app, target.clip.id, targets),
    clipRecord: false,
  });
  const label = `Reset pose (${plural(controls.length, 'control')})${frames.length === 1 ? ` ${atFrame(frames[0] as number)}` : ''}`;
  ctx.focus(
    {
      character: target.character.id,
      clip: target.clip.id,
      controls: controls.map((c) => c.id),
      frame: frames.length === 1 ? (frames[0] as number) : null,
    },
    label,
  );
  const run = await ctx.run('key.write', {
    clip: target.clip.id,
    keys: frames.flatMap((frame) =>
      targets.map((t) => ({
        control: t.control.id,
        channel: t.channel,
        frame,
        value: channelDefaultOf(t.control, t.channel),
      })),
    ),
    label,
  });
  const value = valueOf<{ readonly written: number }>('key.write', run);
  return writeResult(ctx, target.clip.id, run, { keyed: value.written, frames }, [stale]);
}
