// pose_read (MCP-SPEC §6.2 tool 8, §5.2, §5.7): the pose at frames or sampled over a range — Channel Box values in
// exactly pose_set's item shape (plus the rotate order), so a read can be changed and written back as it is, and/or
// bone positions, directions and named orientation angles in character space. The keyed animation by default; the
// user's unkeyed overrides with `withUserOverrides` (they exist only at the user's frame of the active clip).
import { quatInvert, quatMultiply, quatRotateVec3, type Vec3 } from '@ekza-animator/anim-core';
import type { ControlRecord } from '@ekza-animator/doc';
import { attrChannelsOf, type CharacterRuntime, isKeyable } from '@ekza-animator/editor-core';
import { readAttr } from '@ekza-animator/rig';
import { controlKeyOf } from '../../resolve/resolver';
import { conciseFolding } from '../rig/describe';
import { checkReadFrames, rangeArg, resolveControls } from '../../resolve/targets';
import type { TargetsArg } from '../../resolve/targets';
import { addressed, clipInfo } from '../../runtime/toolkit';
import {
  channelsAt,
  firstChildOf,
  isUserFrame,
  nodeXf,
  overridesOn,
  poseAt,
  restPoseOf,
  userFrameOf,
} from '../../units/pose';
import {
  normalize,
  orientRelativeToRest,
  outFrame,
  outValue,
  outVec,
  roundTo,
  toToolValue,
  unitOfChannel,
} from '../../units/units';
import { AgentToolFailure, type AgentToolContext, type AgentToolResult } from '../../types';

/** Samples of a range read at most (§6.2). */
export const POSE_SAMPLES_MAX = 64;
const AXES = ['x', 'y', 'z'] as const;

export interface PoseReadArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly frames?: readonly number[] | undefined;
  readonly rangeFrames?: readonly [number, number] | undefined;
  readonly stepFrames?: number | undefined;
  readonly space: 'channels' | 'world' | 'both';
  readonly targets?: TargetsArg | undefined;
  readonly bones?: readonly string[] | undefined;
  readonly withUserOverrides: boolean;
}

type Xyz = { x?: number; y?: number; z?: number };
export interface PoseControlRow {
  control: string;
  rotateDeg?: Xyz;
  translateM?: Xyz;
  scaleFactor?: Xyz;
  attrs?: Record<string, number>;
  rotateOrder: string;
}

/** The frames a read covers: explicit, sampled over a range, or the user's frame (else the range start). */
export function readFrames(
  ctx: AgentToolContext,
  target: ReturnType<typeof addressed>,
  args: Pick<PoseReadArgs, 'frames' | 'rangeFrames' | 'stepFrames'>,
): number[] {
  if (args.frames !== undefined) {
    checkReadFrames(target.record, args.frames, 'frames');
    return [...args.frames];
  }
  if (args.rangeFrames !== undefined) {
    const [start, end] = rangeArg(args.rangeFrames, 'rangeFrames');
    checkReadFrames(target.record, [start, end], 'rangeFrames');
    const span = end - start;
    const step = args.stepFrames ?? Math.max(1, Math.ceil(span / (POSE_SAMPLES_MAX - 1)));
    const count = Math.floor(span / step + 1e-9) + 1;
    if (count > POSE_SAMPLES_MAX) {
      throw new AgentToolFailure(
        'limit',
        `rangeFrames with stepFrames ${step} gives ${count} samples; the limit is ${POSE_SAMPLES_MAX}.`,
        'pass a larger stepFrames or a shorter rangeFrames',
        { detail: { path: 'stepFrames' } },
      );
    }
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(roundTo(start + i * step, 1e-6));
    return out;
  }
  const user = userFrameOf(ctx.app, target.character.id, target.clip.id);
  return [user ?? target.record.range.start];
}

/** Channel Box values of controls at one frame, in pose_set's item shape (tool units, rounded). */
export function controlRows(
  runtime: CharacterRuntime,
  values: { readonly values: Float64Array; readonly attrs: Float64Array },
  controls: readonly ControlRecord[],
  channels: readonly string[] | undefined,
): PoseControlRow[] {
  const wanted = channels === undefined || channels.length === 0 ? null : new Set(channels);
  const rows: PoseControlRow[] = [];
  for (const control of controls) {
    const slot = runtime.program.controlIndex.get(control.id);
    if (slot === undefined) continue;
    const row: PoseControlRow = { control: controlKeyOf(control), rotateOrder: control.rotateOrder };
    const group = (prefix: 't' | 'r' | 's', base: number): Xyz | undefined => {
      const out: Xyz = {};
      let any = false;
      AXES.forEach((axis, i) => {
        const channel = `${prefix}${axis}` as 'tx';
        if (!isKeyable(control, channel) || (wanted !== null && !wanted.has(channel))) return;
        const unit = unitOfChannel(control, channel);
        out[axis] = outValue(unit, toToolValue(unit, values.values[slot * 9 + base + i] as number));
        any = true;
      });
      return any ? out : undefined;
    };
    const t = group('t', 0);
    const r = group('r', 3);
    const s = group('s', 6);
    if (r !== undefined) row.rotateDeg = r;
    if (t !== undefined) row.translateM = t;
    if (s !== undefined) row.scaleFactor = s;
    const attrs: Record<string, number> = {};
    for (const channel of attrChannelsOf(control)) {
      if (!isKeyable(control, channel) || (wanted !== null && !wanted.has(channel))) continue;
      const value = readAttr(runtime.program, values, control.id, channel.slice(1));
      if (value === undefined) continue;
      const unit = unitOfChannel(control, channel);
      attrs[channel.slice(1)] = outValue(unit, toToolValue(unit, value));
    }
    if (Object.keys(attrs).length > 0) row.attrs = attrs;
    if (
      row.rotateDeg === undefined &&
      row.translateM === undefined &&
      row.scaleFactor === undefined &&
      row.attrs === undefined
    )
      continue;
    rows.push(row);
  }
  return rows;
}

/** The rest direction of a node: toward its first child, else along its parent → node segment. */
export function restDirectionOf(runtime: CharacterRuntime, node: number): Vec3 {
  const rest = restPoseOf(runtime.program);
  const at = nodeXf(rest, node).position;
  const child = firstChildOf(runtime, node);
  if (child !== -1) {
    const tip = nodeXf(rest, child).position;
    const dir = normalize([tip[0] - at[0], tip[1] - at[1], tip[2] - at[2]]);
    if (dir !== null) return dir;
  }
  const parent = runtime.skeleton.nodes[node]?.parent ?? -1;
  if (parent !== -1) {
    const base = nodeXf(rest, parent).position;
    const dir = normalize([at[0] - base[0], at[1] - base[1], at[2] - base[2]]);
    if (dir !== null) return dir;
  }
  return [0, 1, 0];
}

/** Bones a world read lists by default: the targets' driven bones, else every humanoid bone (else driven nodes). */
function defaultBones(
  runtime: CharacterRuntime,
  controls: readonly ControlRecord[] | null,
): { name: string; node: number }[] {
  const humanoid = runtime.skeleton.humanoid ?? {};
  const nameOf = (node: number): string => {
    const human = Object.entries(humanoid).find(([, index]) => index === node)?.[0];
    return human ?? runtime.skeleton.nodes[node]?.name ?? String(node);
  };
  if (controls !== null) {
    const out: { name: string; node: number }[] = [];
    for (const control of controls) {
      const bone = control.drives?.bone;
      if (bone === undefined) continue;
      const node =
        'humanoid' in bone
          ? (humanoid[bone.humanoid] ?? -1)
          : (runtime.skeleton.nodes.find((n) => n.name === bone.name)?.index ?? -1);
      if (node !== -1) out.push({ name: nameOf(node), node });
    }
    return out;
  }
  const entries: [string, number][] = [];
  for (const [name, index] of Object.entries(humanoid)) if (index !== undefined) entries.push([name, index]);
  if (entries.length > 0) return entries.map(([name, node]) => ({ name, node }));
  return runtime.program.drivenNodes.map((node) => ({ name: nameOf(node), node }));
}

export function poseRead(ctx: AgentToolContext, args: PoseReadArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const { runtime } = target;
  const frames = readFrames(ctx, target, args);
  ctx.focus(
    { character: target.character.id, clip: target.clip.id, controls: [], frame: frames.length === 1 ? (frames[0] as number) : null },
    `Read the pose (${frames.length === 1 ? `f${frames[0]}` : `${frames.length} frames`})`,
  );
  const wantChannels = args.space !== 'world';
  const wantWorld = args.space !== 'channels';
  const named =
    args.targets === undefined
      ? null
      : resolveControls(ctx.app, ctx.resolve, target.character.id, args.targets.controls, args.targets.bodyParts);
  // Default: the controls rig_describe lists concisely (§5.5 read budget): secondary and finger controls, and the
  // ones a limb's mode hides, only when named.
  const controls =
    named ??
    (() => {
      const rig = ctx.app.store.query.rigOfCharacter(target.character.id);
      const fold = conciseFolding(ctx.app, target.character.id);
      return (rig === undefined ? [] : ctx.app.store.query.controlsOfRig(rig.id)).filter(
        (control) => fold(control) === null,
      );
    })();
  const bones = wantWorld
    ? args.bones !== undefined
      ? args.bones.map((ref) => {
          const bone = ctx.resolve.bone(target.character.id, ref);
          const humanoid = runtime.skeleton.humanoid ?? {};
          const node =
            bone.humanoid !== null
              ? (humanoid[bone.humanoid as keyof typeof humanoid] ?? -1)
              : (runtime.skeleton.nodes.find((n) => n.name === bone.name)?.index ?? -1);
          return { name: bone.humanoid ?? bone.name, node };
        })
      : defaultBones(runtime, named)
    : [];
  const rest = restPoseOf(runtime.program);
  const out = frames.map((frame) => {
    const row: {
      frame: number;
      controls?: PoseControlRow[];
      bones?: Record<
        string,
        { positionM: Vec3; direction: Vec3; orientDeg: { pitchDeg: number; yawDeg: number; rollDeg: number } }
      >;
    } = { frame: outFrame(frame) };
    if (wantChannels) {
      const values = channelsAt(ctx.app, runtime, target.clip.id, frame, args.withUserOverrides);
      row.controls = controlRows(runtime, values, controls, args.targets?.channels);
    }
    if (wantWorld) {
      const pose = poseAt(ctx.app, runtime, target.clip.id, frame, args.withUserOverrides);
      const record: NonNullable<typeof row.bones> = {};
      for (const bone of bones) {
        if (bone.node === -1) continue;
        const now = nodeXf(pose, bone.node);
        const before = nodeXf(rest, bone.node);
        const orient = orientRelativeToRest(now.rotation, before.rotation);
        // the rest direction turned by the bone's world rotation since rest
        const delta = quatMultiply(now.rotation, quatInvert(before.rotation));
        const direction = quatRotateVec3(delta, restDirectionOf(runtime, bone.node));
        Object.defineProperty(record, bone.name, {
          value: {
            positionM: outVec(now.position),
            direction: outVec(direction),
            orientDeg: {
              pitchDeg: roundTo(orient.pitchDeg, 0.01),
              yawDeg: roundTo(orient.yawDeg, 0.01),
              rollDeg: roundTo(orient.rollDeg, 0.01),
            },
          },
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      row.bones = record;
    }
    return row;
  });
  const atUser = frames.some((frame) => isUserFrame(ctx.app, target.character.id, target.clip.id, frame));
  const userOverrides = atUser ? overridesOn(ctx.app, target.character.id) : 0;
  return Promise.resolve({
    ok: true,
    data: { frames: out, userOverrides },
    clip: clipInfo(ctx, target.clip.id),
    ...(userOverrides > 0 && !args.withUserOverrides
      ? {
          warnings: [
            `the user has ${userOverrides} unkeyed edits at frame ${outFrame(frames.find((f) => isUserFrame(ctx.app, target.character.id, target.clip.id, f)) ?? 0)}; this read shows the keyed animation (withUserOverrides: true shows what the user sees)`,
          ],
        }
      : {}),
  });
}
