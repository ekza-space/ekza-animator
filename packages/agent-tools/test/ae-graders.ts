// Graders of P2's copies of the evaluation tasks (MCP-SPEC §9.3.3, §9.3.4): minimal implementations of their own on
// raw bone worlds from `evaluateAt` (and on raw curve keys), never the tools' outputs or motion-analysis.
import {
  compileAnimCurve,
  evaluateAnimCurve,
  mat4Decompose,
  quatInvert,
  quatMultiply,
  type Quat,
  type Vec3,
  xfIdentity,
} from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ControlId, CurveRecord } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';

export const DEG = Math.PI / 180;

export interface World {
  readonly position: Vec3;
  readonly rotation: Quat;
}

/** The skeleton node of a humanoid bone name (`leftHand`) or a node name (`DEF-hand.L`). */
export function nodeOf(app: EditorApp, character: CharacterId, bone: string): number {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const humanoid = runtime.skeleton.humanoid?.[bone as 'hips'];
  if (humanoid !== undefined) return humanoid;
  const node = runtime.skeleton.nodes.find((n) => n.name === bone);
  if (node === undefined) throw new Error(`no bone ${bone}`);
  return node.index;
}

/** World transforms of bones at a clip frame (no overrides), one evaluation for all of them. */
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

/** Every bone of the skeleton (node names), for collateral and hold checks. */
export function allBones(app: EditorApp, character: CharacterId): string[] {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  return runtime.skeleton.nodes.map((n) => n.name);
}

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = length(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const range = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);

/** The geodesic angle between two rotations, degrees. */
export function angleDeg(a: Quat, b: Quat): number {
  const d = quatMultiply(a, quatInvert(b));
  return (2 * Math.acos(Math.min(1, Math.abs(d[3])))) / DEG;
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

/** Zero crossings of the detrended, centred signal with 10 % hysteresis (indices where the state flips). */
function crossings(values: readonly number[]): number[] {
  const n = values.length;
  const slope = ((values[n - 1] as number) - (values[0] as number)) / (n - 1);
  const detrended = values.map((v, i) => v - (values[0] as number) - slope * i);
  const mean = detrended.reduce((s, v) => s + v, 0) / n;
  const centred = detrended.map((v) => v - mean);
  const band = 0.1 * (Math.max(...centred) - Math.min(...centred));
  let state = 0;
  const out: number[] = [];
  centred.forEach((v, i) => {
    const next = v > band ? 1 : v < -band ? -1 : state;
    if (state !== 0 && next !== state) out.push(i);
    state = next;
  });
  return out;
}

/** Oscillation cycles of a signal (§5.16): crossings / 2, rounded down. */
export function cycles(values: readonly number[]): number {
  return Math.floor(crossings(values).length / 2);
}

/** Oscillation period in samples (§5.16): mean distance between crossings × 2; null with fewer than two. */
export function period(values: readonly number[]): number | null {
  const at = crossings(values);
  if (at.length < 2) return null;
  return (((at.at(-1) as number) - (at[0] as number)) / (at.length - 1)) * 2;
}

/**
 * Pops of a bone (§5.16): ω(f) = the angle between its rotations at f and f+1; a pop is ω > max(3·median₉(ω),
 * 30°·30/F) or an angular-acceleration spike |ω(f+1) − ω(f)| > 15°·(30/F)². Returns the frames.
 */
export function pops(rotations: readonly Quat[], fps: number): number[] {
  const omega = rotations.slice(0, -1).map((q, f) => angleDeg(rotations[f + 1] as Quat, q));
  const out: number[] = [];
  omega.forEach((w, f) => {
    const window = omega.slice(Math.max(0, f - 4), f + 5).sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)] as number;
    const spike = f + 1 < omega.length && Math.abs((omega[f + 1] as number) - w) > 15 * (30 / fps) ** 2;
    if (w > Math.max(3 * median, (30 * 30) / fps) || spike) out.push(f);
  });
  return out;
}

/**
 * Dead holds (§5.16): runs of ≥ 3 frame steps where every bone changes less than 0.05° and 0.1 mm per frame. Returns
 * the runs as [first, last] frame steps within `frames` (consecutive frames).
 */
export function deadHolds(poses: readonly (readonly World[])[], frames: readonly number[]): [number, number][] {
  const still = poses.slice(0, -1).map((pose, i) =>
    pose.every((bone, b) => {
      const next = (poses[i + 1] as readonly World[])[b] as World;
      return angleDeg(next.rotation, bone.rotation) < 0.05 && length(sub(next.position, bone.position)) < 0.0001;
    }),
  );
  const runs: [number, number][] = [];
  let start = -1;
  still.forEach((s, i) => {
    if (s && start === -1) start = i;
    if ((!s || i === still.length - 1) && start !== -1) {
      const end = s ? i : i - 1;
      if (end - start + 1 >= 3) runs.push([frames[start] as number, frames[end] as number]);
      start = -1;
    }
  });
  return runs;
}

/** The value of a control channel's base curve at a frame, from the raw keys (the channel's default without keys). */
export function channelAt(
  app: EditorApp,
  clip: ClipId,
  control: ControlId,
  channel: string,
  frame: number,
  fallback = 0,
): number {
  const layer = app.store.query.baseLayer(clip);
  const curve = layer === undefined ? undefined : app.store.query.curveFor(clip, layer.id, control, channel as never);
  if (curve === undefined) return fallback;
  const keys = app.store.query.keysOfCurve(curve.id);
  if (keys.length === 0) return curve.staticValue ?? fallback;
  return evaluateAnimCurve(
    compileAnimCurve({ keys, weighted: curve.weighted, pre: curve.pre, post: curve.post }),
    frame,
  );
}

/** Every animated base curve of a clip: the record and the compiled curve. */
export function animatedCurves(
  app: EditorApp,
  clip: ClipId,
): { readonly curve: CurveRecord; readonly compiled: ReturnType<typeof compileAnimCurve> }[] {
  const layer = app.store.query.baseLayer(clip);
  if (layer === undefined) return [];
  return app.store.query
    .curvesOfClip(clip)
    .filter((curve) => curve.layer === layer.id)
    .map((curve) => ({ curve, keys: app.store.query.keysOfCurve(curve.id) }))
    .filter((entry) => entry.keys.length > 0)
    .map(({ curve, keys }) => ({
      curve,
      compiled: compileAnimCurve({ keys, weighted: curve.weighted, pre: curve.pre, post: curve.post }),
    }));
}

/**
 * Seam of a loop clip per animated channel (§5.16): C0 = |v(e) − v(s)|, C1 = the slope mismatch, the one-sided
 * slopes measured on the curve with a small step (stored units per frame).
 */
export function channelSeam(app: EditorApp, clip: ClipId): { maxC0: number; maxC1: number } {
  const record = app.store.get('clips', clip);
  if (record === undefined) throw new Error('no clip');
  const { start, end } = record.range;
  const h = 1e-3;
  let maxC0 = 0;
  let maxC1 = 0;
  for (const { compiled } of animatedCurves(app, clip)) {
    const v = (f: number) => evaluateAnimCurve(compiled, f);
    maxC0 = Math.max(maxC0, Math.abs(v(end) - v(start)));
    const left = (v(end) - v(end - h)) / h;
    const right = (v(start + h) - v(start)) / h;
    maxC1 = Math.max(maxC1, Math.abs(left - right));
  }
  return { maxC0, maxC1 };
}

/** Cyclic cross-correlation lag (frames) of `b` against `a` within ±maxLag: b(f) ≈ a(f − lag). */
export function lagOf(a: readonly number[], b: readonly number[], maxLag: number): number {
  const n = a.length;
  const mean = (x: readonly number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a);
  const mb = mean(b);
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let f = 0; f < n; f++) {
      const g = (((f - lag) % n) + n) % n;
      score += ((b[f] as number) - mb) * ((a[g] as number) - ma);
    }
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}
