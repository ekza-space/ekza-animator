// Evaluation helpers of the tools (MCP-SPEC §5.2, §5.7): poses and channel values of any clip at any clip frame
// without moving the user's playhead (`evaluateAt` is re-entrant), in canonical character space; the user's unkeyed
// overrides only where the user sees them (the user's current frame of the character's active clip).
import { mat4Decompose, type Quat, type Vec3, xfIdentity } from '@ekza-studio/anim-core';
import type { ChannelId, CharacterId, ClipId, ControlId, HumanBoneName } from '@ekza-studio/doc';
import type { CharacterRuntime, EditorApp } from '@ekza-studio/editor-core';
import { applyOverrides, type ChannelBuffer, type PoseBuffers, readAttr, type RigProgram } from '@ekza-studio/rig';
import { AgentToolFailure } from '../types';

/** The character's runtime (rig program, skeleton), or `busy` while it is still loading. */
export function runtimeOf(app: EditorApp, character: CharacterId): CharacterRuntime {
  const runtime = app.characters.get(character);
  if (runtime === undefined) {
    throw new AgentToolFailure('busy', 'The character is still loading.', 'retry in a moment', { retryable: true });
  }
  return runtime;
}

/** The user's current clip frame of `clip` when it is the character's active clip, else null (§5.7). */
export function userFrameOf(app: EditorApp, character: CharacterId, clip: ClipId): number | null {
  const state = app.session.getState();
  if (state.activeClip[character] !== clip) return null;
  return app.evaluation.clipFrame(character);
}

/** True when `frame` is the frame the user sees of `clip` (overrides apply there only). */
export function isUserFrame(app: EditorApp, character: CharacterId, clip: ClipId, frame: number): boolean {
  const current = userFrameOf(app, character, clip);
  return current !== null && Math.abs(current - frame) < 1e-6;
}

/** The user's unkeyed overrides on the character's controls (channels counted). */
export function overridesOn(app: EditorApp, character: CharacterId): number {
  const runtime = app.characters.get(character);
  if (runtime === undefined) return 0;
  let count = 0;
  for (const [control, values] of app.session.getState().overrides) {
    if (!runtime.program.controlIndex.has(control)) continue;
    count += Object.keys(values).length;
  }
  return count;
}

/** The overridden channels of `control` (the user's unkeyed edits), or null. */
export function overrideOf(app: EditorApp, control: ControlId): Readonly<Record<string, number>> | null {
  const values = app.session.getState().overrides.get(control);
  return values === undefined ? null : (values as Readonly<Record<string, number>>);
}

/**
 * Sampled channels of a clip at a clip frame (curves; the user's overrides only with `withOverrides` and only at the
 * user's frame of the active clip). A new buffer per call.
 */
export function channelsAt(
  app: EditorApp,
  runtime: CharacterRuntime,
  clip: ClipId,
  frame: number,
  withOverrides = false,
): ChannelBuffer {
  const channels = runtime.program.allocChannels();
  runtime.sampler(clip).sample(frame, channels);
  if (withOverrides && isUserFrame(app, runtime.id, clip, frame)) {
    applyOverrides(runtime.program, channels, app.session.getState().overrides);
  }
  return channels;
}

/** The evaluated pose of a clip at a clip frame (new buffers; the user's playhead and pose are untouched). */
export function poseAt(
  app: EditorApp,
  runtime: CharacterRuntime,
  clip: ClipId,
  frame: number,
  withOverrides = false,
): PoseBuffers {
  const out = runtime.program.allocPose();
  app.evaluation.evaluateAt(runtime.id, clip, frame, out, {
    withOverrides: withOverrides && isUserFrame(app, runtime.id, clip, frame),
  });
  return out;
}

const REST_POSES = new WeakMap<RigProgram, PoseBuffers>();

/** The rest pose of a rig program (default channel values), cached per program. */
export function restPoseOf(program: RigProgram): PoseBuffers {
  let pose = REST_POSES.get(program);
  if (pose === undefined) {
    pose = program.allocPose();
    program.evaluate(program.allocChannels(), pose);
    REST_POSES.set(program, pose);
  }
  return pose;
}

/** Position and rotation of a node's world matrix (canonical character space). */
export function nodeXf(pose: PoseBuffers, node: number): { readonly position: Vec3; readonly rotation: Quat } {
  const m = pose.boneWorld.subarray(node * 16, node * 16 + 16);
  const xf = mat4Decompose(m, xfIdentity());
  return { position: [xf.t[0], xf.t[1], xf.t[2]], rotation: [xf.q[0], xf.q[1], xf.q[2], xf.q[3]] };
}

/** Position and rotation of a control's world matrix (canonical character space). */
export function controlXf(
  program: RigProgram,
  pose: PoseBuffers,
  control: ControlId,
): { readonly position: Vec3; readonly rotation: Quat } | null {
  const slot = program.controlIndex.get(control);
  if (slot === undefined) return null;
  const m = pose.controlWorld.subarray(slot * 16, slot * 16 + 16);
  const xf = mat4Decompose(m, xfIdentity());
  return { position: [xf.t[0], xf.t[1], xf.t[2]], rotation: [xf.q[0], xf.q[1], xf.q[2], xf.q[3]] };
}

/** The node index of a humanoid bone (or a node by name), −1 when absent. */
export function nodeOfBone(runtime: CharacterRuntime, bone: string): number {
  const humanoid = runtime.skeleton.humanoid ?? {};
  if (Object.hasOwn(humanoid, bone)) return humanoid[bone as HumanBoneName] ?? -1;
  return runtime.skeleton.nodes.find((node) => node.name === bone)?.index ?? -1;
}

/** The first child node of a node (skeleton order), −1 when it has none. */
export function firstChildOf(runtime: CharacterRuntime, node: number): number {
  for (const candidate of runtime.skeleton.nodes) if (candidate.parent === node) return candidate.index;
  return -1;
}

/** A custom attribute value of a clip at a clip frame (curves only; the attribute's default without a curve). */
export function attrAt(
  runtime: CharacterRuntime,
  clip: ClipId,
  control: ControlId,
  name: string,
  frame: number,
  fallback: number,
): number {
  const sampled = runtime.sampler(clip).value(control, `@${name}` as ChannelId, frame);
  if (sampled !== undefined) return sampled;
  const channels = runtime.program.allocChannels();
  runtime.sampler(clip).sample(frame, channels);
  return readAttr(runtime.program, channels, control, name) ?? fallback;
}
