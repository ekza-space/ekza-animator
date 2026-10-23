// Grader primitives (MCP-SPEC §9.3.4): minimal implementations of their own on raw bone worlds from `evaluateAt` and
// on raw curve keys — never the tools' outputs or motion-analysis, so a bug there cannot make the agent and the grader
// agree on a wrong number.
import {
  compileAnimCurve,
  evaluateAnimCurve,
  mat4Decompose,
  type Quat,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type Vec3,
  xfIdentity,
} from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ControlId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';

export const DEG = Math.PI / 180;

export interface World {
  readonly position: Vec3;
  readonly rotation: Quat;
}

export const range = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = length(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The skeleton node of a humanoid bone name (`leftHand`) or a node name. */
export function nodeOf(app: EditorApp, character: CharacterId, bone: string): number {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const humanoid = runtime.skeleton.humanoid?.[bone as 'hips'];
  if (humanoid !== undefined) return humanoid;
  const node = runtime.skeleton.nodes.find((n) => n.name === bone);
  if (node === undefined) throw new Error(`no bone ${bone}`);
  return node.index;
}

/** World transforms of bones at a clip frame (no overrides). */
export function bonesAt(
  app: EditorApp,
  character: CharacterId,
  clip: ClipId,
  bones: readonly string[],
  frame: number,
): World[] {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const pose = runtime.program.allocPose();
  app.evaluation.evaluateAt(character, clip, frame, pose);
  return bones.map((bone) => {
    const node = nodeOf(app, character, bone);
    const xf = mat4Decompose(pose.boneWorld.subarray(node * 16, node * 16 + 16), xfIdentity());
    return { position: [xf.t[0], xf.t[1], xf.t[2]], rotation: [xf.q[0], xf.q[1], xf.q[2], xf.q[3]] };
  });
}

export function boneWorld(app: EditorApp, character: CharacterId, clip: ClipId, bone: string, frame: number): World {
  return bonesAt(app, character, clip, [bone], frame)[0] as World;
}

export function restWorld(app: EditorApp, character: CharacterId, bone: string): World {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const node = nodeOf(app, character, bone);
  const pose = runtime.program.allocPose();
  runtime.program.evaluate(runtime.program.allocChannels(), pose);
  const xf = mat4Decompose(pose.boneWorld.subarray(node * 16, node * 16 + 16), xfIdentity());
  return { position: [xf.t[0], xf.t[1], xf.t[2]], rotation: [xf.q[0], xf.q[1], xf.q[2], xf.q[3]] };
}

/** The geodesic angle between two rotations, degrees. */
export function angleDeg(a: Quat, b: Quat): number {
  const d = quatMultiply(a, quatInvert(b));
  return (2 * Math.acos(Math.min(1, Math.abs(d[3])))) / DEG;
}

/** `now · rest⁻¹`: the rotation that took a bone from its rest orientation to `now`. */
export function relativeRotation(now: Quat, rest: Quat): Quat {
  return quatMultiply(now, quatInvert(rest));
}

/** A rotation applied to a vector. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  return quatRotateVec3(q, v);
}

/** First principal component of points (power iteration on the covariance). */
export function principal(points: readonly Vec3[]): { axis: Vec3; values: number[] } {
  const mean: Vec3 = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) mean[i] = (mean[i] as number) + (p[i] as number) / points.length;
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = sub(p, mean);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) c[i * 3 + j] = (c[i * 3 + j] as number) + (d[i] as number) * (d[j] as number);
  }
  let v: Vec3 = [1, 0.5, 0.25];
  for (let k = 0; k < 64; k++) {
    v = norm([
      (c[0] as number) * v[0] + (c[1] as number) * v[1] + (c[2] as number) * v[2],
      (c[3] as number) * v[0] + (c[4] as number) * v[1] + (c[5] as number) * v[2],
      (c[6] as number) * v[0] + (c[7] as number) * v[1] + (c[8] as number) * v[2],
    ]);
  }
  return { axis: v, values: points.map((p) => dot(sub(p, mean), v)) };
}

/** Oscillation cycles: zero crossings of the detrended, centred signal with 10 % hysteresis, halved. */
export function cycles(values: readonly number[]): number {
  const n = values.length;
  const slope = ((values[n - 1] as number) - (values[0] as number)) / (n - 1);
  const detrended = values.map((v, i) => v - (values[0] as number) - slope * i);
  const mean = detrended.reduce((s, v) => s + v, 0) / n;
  const centred = detrended.map((v) => v - mean);
  const band = 0.1 * (Math.max(...centred) - Math.min(...centred));
  let state = 0;
  let crossings = 0;
  for (const v of centred) {
    const next = v > band ? 1 : v < -band ? -1 : state;
    if (state !== 0 && next !== state) crossings++;
    state = next;
  }
  return Math.floor(crossings / 2);
}

/** The value of a control channel's base curve at a frame, from the raw keys (0 without keys). */
export function channelAt(app: EditorApp, clip: ClipId, control: ControlId, channel: string, frame: number): number {
  const layer = app.store.query.baseLayer(clip);
  const curve = layer === undefined ? undefined : app.store.query.curveFor(clip, layer.id, control, channel as never);
  if (curve === undefined) return 0;
  const keys = app.store.query.keysOfCurve(curve.id);
  if (keys.length === 0) return curve.staticValue ?? 0;
  return evaluateAnimCurve(compileAnimCurve({ keys, weighted: curve.weighted, pre: curve.pre, post: curve.post }), frame);
}

/** The id of a control by template key. */
export function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

/** Key times of a control channel's base curve. */
export function keyFrames(app: EditorApp, clip: ClipId, control: ControlId, channel: string): number[] {
  const layer = app.store.query.baseLayer(clip);
  const curve = layer === undefined ? undefined : app.store.query.curveFor(clip, layer.id, control, channel as never);
  return curve === undefined ? [] : app.store.query.keysOfCurve(curve.id).map((key) => key.t);
}
