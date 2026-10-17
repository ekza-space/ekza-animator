// bakeClip (MVP-SPEC §4.11.10 step 3, ADR 0005 §2–5): samples a PoseSource at integer clip frames and turns the pose
// buffers into glTF-ready tracks.
//
// - raw target: node locals (`boneLocal`). Rotation for every driven node; translation for the humanoid hips and for
//   driven nodes whose translation leaves its rest value; scale only for non-humanoid driven nodes whose scale leaves
//   rest. humanoid target: `N_b` (`humanLocal`) for every present humanoid bone except the eyes, plus the absolute
//   hips position (`hipsPosition`). Tracks in `requiredTracks` are always written.
// - LINEAR at every frame; STEP at the frames of `stepSchedule` for fully stepped tracks. Unit quaternions with
//   hemisphere continuity; loop closure copies the first pose to the last sample; constant tracks collapse to 2 keys.
// - rootMotion 'in-place' locks X/Z of `inPlaceNode` to its rest position in canonical space before the conversion to
//   a raw local (humanoid target: the hips position).
import {
  EkzaError,
  type Frame,
  mat4Compose,
  mat4Invert,
  quatAngle,
  RAD2DEG,
  type ReadonlyQuat,
} from '@ekza-animator/anim-core';
import type { DerivedFrom } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES, type PoseBuffers, type RigProgram, type TrackKey } from '@ekza-animator/rig';
import { restWorlds } from '../skeleton/rest';
import type {
  BakedClip,
  BakedTrack,
  BakeOptions,
  EkzaAnimationV1,
  EkzaClipMetaV1,
  LintIssue,
  PoseSource,
} from '../types';

type TrackPath = BakedTrack['path'];
const PATHS: readonly TrackPath[] = ['translation', 'rotation', 'scale'];
const PATH_ORDER: Readonly<Record<TrackPath, number>> = { translation: 0, rotation: 1, scale: 2 };
const COMPONENTS: Readonly<Record<TrackPath, number>> = { translation: 3, rotation: 4, scale: 3 };

/** A translation or scale track is written when it leaves its rest value by more than this (metres / unitless). */
export const REST_EPSILON = 1e-6;
/** Samples equal within this (per component, after continuity) make a constant track. */
export const CONSTANT_EPSILON = 1e-7;
/** `bake.large-rotation-step` fires above this angle between consecutive samples. */
export const LARGE_STEP_RAD = Math.PI / 2;

export const TOOL_VERSION = '0.1.0';

export function clipFramesToSeconds(frames: Frame, fps: { readonly num: number; readonly den: number }): number {
  return (frames * fps.den) / fps.num;
}

/** `${node}/${path}` (rig TrackKey). */
export function trackKey(node: number, path: TrackPath): TrackKey {
  return `${node}/${path}`;
}

export function parseTrackKey(key: string): { readonly node: number; readonly path: TrackPath } | null {
  const [node, path] = key.split('/');
  const index = Number(node);
  if (!Number.isInteger(index) || index < 0 || !PATHS.includes(path as TrackPath)) return null;
  return { node: index, path: path as TrackPath };
}

interface TrackPlan {
  readonly node: number;
  readonly path: TrackPath;
  readonly step: readonly Frame[] | null;
}

/** Reads one track's value at the current pose into `out` (float64, unnormalized for rotations). */
type Reader = (pose: PoseBuffers, node: number, path: TrackPath, out: Float64Array) => void;

export function bakeClip(source: PoseSource, opts: BakeOptions): BakedClip {
  const program = source.program;
  const skeleton = program.skeleton;
  const { start, end } = opts.range;
  validate(opts, program);
  const frameCount = end - start + 1;
  const duration = clipFramesToSeconds(end - start, opts.fps);
  const humanoid = opts.target === 'humanoid';
  const worldsAtRest = restWorlds(skeleton);
  const hipsNode = skeleton.humanoid?.hips;
  const restHipsPosition: [number, number, number] | null =
    humanoid && hipsNode !== undefined ? [...(worldsAtRest[hipsNode]?.t ?? [0, 0, 0])] : null;
  const inPlace = opts.rootMotion === 'in-place';

  // Dense samples of every candidate track (float64), one evaluation per frame.
  const candidates = candidateTracks(program, opts);
  const read = humanoid ? readHumanoid(restHipsPosition, inPlace) : readRaw(program, inPlace ? opts.inPlaceNode : null);
  const pose = program.allocPose();
  const dense = candidates.map((c) => new Float64Array(frameCount * COMPONENTS[c.path]));
  const scratch = new Float64Array(4);
  for (let f = 0; f < frameCount; f++) {
    source.evaluate(start + f, pose);
    candidates.forEach((c, i) => {
      read(pose, c.node, c.path, scratch);
      (dense[i] as Float64Array).set(scratch.subarray(0, COMPONENTS[c.path]), f * COMPONENTS[c.path]);
    });
  }

  const plans: TrackPlan[] = [];
  const planData: Float64Array[] = [];
  candidates.forEach((c, i) => {
    const key = trackKey(c.node, c.path);
    const data = dense[i] as Float64Array;
    if (!c.always && !opts.requiredTracks.has(key) && !leavesRest(data, c, program, humanoid)) return;
    plans.push({ node: c.node, path: c.path, step: stepFrames(opts.stepSchedule.get(key), start, end) });
    planData.push(data);
  });

  const warnings: LintIssue[] = [];
  const extraPoses = new Map<Frame, PoseBuffers>();
  const tracks = plans.map((plan, i) =>
    buildTrack(
      plan,
      planData[i] as Float64Array,
      opts,
      (frame) => {
        // Sub-frame STEP times are evaluated on demand.
        let p = extraPoses.get(frame);
        if (p === undefined) {
          p = program.allocPose();
          source.evaluate(frame, p);
          extraPoses.set(frame, p);
        }
        const out = new Float64Array(4);
        read(p, plan.node, plan.path, out);
        return out;
      },
      warnings,
      humanoid,
    ),
  );
  tracks.sort((a, b) => a.node - b.node || PATH_ORDER[a.path] - PATH_ORDER[b.path]);

  return {
    name: opts.name,
    target: opts.target,
    fps: opts.fps,
    frameCount,
    duration,
    tracks,
    restHipsPosition,
    meta: normalizeClipMeta({
      ...opts.meta,
      name: opts.name,
      loop: opts.loop,
      fps: opts.fps.num / opts.fps.den,
      durationSeconds: duration,
      rootMotion: opts.rootMotion,
    }),
    warnings,
  };
}

function validate(opts: BakeOptions, program: RigProgram): void {
  const { start, end } = opts.range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    throw new EkzaError('unsupported', `Bake range ${start}..${end} must be integer clip frames with end ≥ start`);
  }
  if (!(opts.fps.num > 0) || !(opts.fps.den > 0)) throw new EkzaError('unsupported', 'Bake fps must be positive');
  if (opts.target === 'humanoid' && program.skeleton.humanoid?.hips === undefined) {
    throw new EkzaError('unsupported', 'A humanoid bake needs a skeleton with a hips bone');
  }
  if (opts.rootMotion === 'in-place' && opts.target === 'raw' && opts.inPlaceNode === null) {
    throw new EkzaError('unsupported', "Root motion 'in-place' needs an inPlaceNode");
  }
}

interface Candidate {
  readonly node: number;
  readonly path: TrackPath;
  /** Written regardless of the data (rotations of driven bones, hips translation). */
  readonly always: boolean;
}

function candidateTracks(program: RigProgram, opts: BakeOptions): Candidate[] {
  const skeleton = program.skeleton;
  const out = new Map<TrackKey, Candidate>();
  const add = (node: number, path: TrackPath, always: boolean): void => {
    const key = trackKey(node, path);
    const existing = out.get(key);
    if (existing === undefined || (always && !existing.always)) out.set(key, { node, path, always });
  };
  if (opts.target === 'humanoid') {
    const humanoid = skeleton.humanoid ?? {};
    HUMAN_BONE_NAMES.forEach((bone, index) => {
      if (humanoid[bone] === undefined || bone === 'leftEye' || bone === 'rightEye') return;
      add(index, 'rotation', true);
      if (bone === 'hips') add(index, 'translation', true);
    });
  } else {
    const humanBones = new Set(Object.values(skeleton.humanoid ?? {}));
    const hips = skeleton.humanoid?.hips;
    for (const node of program.drivenNodes) {
      add(node, 'rotation', true);
      add(node, 'translation', node === hips);
      if (!humanBones.has(node)) add(node, 'scale', false);
    }
    if (hips !== undefined && program.drivenNodes.includes(hips)) add(hips, 'translation', true);
  }
  for (const key of opts.requiredTracks) {
    const parsed = parseTrackKey(key);
    const limit = opts.target === 'humanoid' ? HUMAN_BONE_NAMES.length : program.nodeCount;
    if (parsed !== null && parsed.node < limit) add(parsed.node, parsed.path, true);
  }
  return [...out.values()];
}

function readRaw(program: RigProgram, inPlaceNode: number | null): Reader {
  const nodes = program.skeleton.nodes;
  const rest = restWorlds(program.skeleton);
  const facing = mat4Compose({ t: [0, 0, 0], q: program.skeleton.facing, s: [1, 1, 1] });
  const parentWorld = new Float64Array(16);
  const inverse = new Float64Array(16);
  return (pose, node, path, out) => {
    const o = node * 10;
    const b = pose.boneLocal;
    if (path === 'translation') {
      out[0] = b[o] as number;
      out[1] = b[o + 1] as number;
      out[2] = b[o + 2] as number;
      if (node === inPlaceNode)
        lockInPlace(pose, node, nodes[node]?.parent ?? -1, rest, facing, parentWorld, inverse, out);
    } else if (path === 'rotation') {
      out[0] = b[o + 3] as number;
      out[1] = b[o + 4] as number;
      out[2] = b[o + 5] as number;
      out[3] = b[o + 6] as number;
    } else {
      out[0] = b[o + 7] as number;
      out[1] = b[o + 8] as number;
      out[2] = b[o + 9] as number;
    }
  };
}

/** Replaces `out` (the node's local translation) with the local translation whose canonical X/Z are at rest. */
function lockInPlace(
  pose: PoseBuffers,
  node: number,
  parent: number,
  rest: readonly { readonly t: readonly number[] }[],
  facing: Float64Array,
  parentWorld: Float64Array,
  inverse: Float64Array,
  out: Float64Array,
): void {
  const w = pose.boneWorld;
  const x = rest[node]?.t[0] ?? 0;
  const y = w[node * 16 + 13] as number;
  const z = rest[node]?.t[2] ?? 0;
  if (parent === -1) parentWorld.set(facing);
  else parentWorld.set(w.subarray(parent * 16, parent * 16 + 16));
  if (mat4Invert(parentWorld, inverse) === null) return;
  out[0] =
    (inverse[0] as number) * x + (inverse[4] as number) * y + (inverse[8] as number) * z + (inverse[12] as number);
  out[1] =
    (inverse[1] as number) * x + (inverse[5] as number) * y + (inverse[9] as number) * z + (inverse[13] as number);
  out[2] =
    (inverse[2] as number) * x + (inverse[6] as number) * y + (inverse[10] as number) * z + (inverse[14] as number);
}

function readHumanoid(restHips: readonly number[] | null, inPlace: boolean): Reader {
  return (pose, bone, path, out) => {
    if (path === 'translation') {
      out[0] = inPlace ? (restHips?.[0] ?? 0) : (pose.hipsPosition[0] as number);
      out[1] = pose.hipsPosition[1] as number;
      out[2] = inPlace ? (restHips?.[2] ?? 0) : (pose.hipsPosition[2] as number);
    } else if (path === 'rotation') {
      out[0] = pose.humanLocal[bone * 4] as number;
      out[1] = pose.humanLocal[bone * 4 + 1] as number;
      out[2] = pose.humanLocal[bone * 4 + 2] as number;
      out[3] = pose.humanLocal[bone * 4 + 3] as number;
    } else {
      out[0] = 1;
      out[1] = 1;
      out[2] = 1;
    }
  };
}

function leavesRest(data: Float64Array, c: Candidate, program: RigProgram, humanoid: boolean): boolean {
  if (humanoid) return true;
  const restLocal = program.skeleton.nodes[c.node]?.restLocal;
  if (restLocal === undefined) return true;
  const rest = c.path === 'translation' ? restLocal.t : c.path === 'scale' ? restLocal.s : null;
  if (rest === null) return true;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs((data[i] as number) - (rest[i % 3] as number)) > REST_EPSILON) return true;
  }
  return false;
}

/** Sorted, unique schedule frames inside the range, always including both ends; null for LINEAR tracks. */
function stepFrames(schedule: readonly Frame[] | undefined, start: Frame, end: Frame): Frame[] | null {
  if (schedule === undefined) return null;
  const frames = new Set<Frame>([start, end]);
  for (const f of schedule) if (Number.isFinite(f) && f >= start && f <= end) frames.add(f);
  return [...frames].sort((a, b) => a - b);
}

function buildTrack(
  plan: TrackPlan,
  dense: Float64Array,
  opts: BakeOptions,
  sampleAt: (frame: Frame) => Float64Array,
  warnings: LintIssue[],
  humanoid: boolean,
): BakedTrack {
  const n = COMPONENTS[plan.path];
  const { start, end } = opts.range;
  const frames = plan.step ?? Array.from({ length: end - start + 1 }, (_, f) => start + f);
  const values = new Float64Array(frames.length * n);
  frames.forEach((frame, k) => {
    const f = frame - start;
    const sample = Number.isInteger(f) ? dense.subarray(f * n, f * n + n) : sampleAt(frame).subarray(0, n);
    values.set(sample, k * n);
  });
  const rotation = plan.path === 'rotation';
  if (rotation) normalizeContinuous(values);
  if (opts.closeLoop && opts.loop && frames.length > 1) {
    values.copyWithin((frames.length - 1) * n, 0, n);
    if (rotation) hemisphere(values, frames.length - 1);
  }
  if (rotation) largeStepLint(plan, values, frames, warnings, humanoid);

  const times = frames.map((frame) => Math.fround(clipFramesToSeconds(frame - start, opts.fps)));
  const constant = isConstant(values, n);
  const keep = constant ? [0, frames.length - 1].filter((v, i, a) => a.indexOf(v) === i) : strictlyIncreasing(times);
  const outTimes = new Float32Array(keep.length);
  const outValues = new Float32Array(keep.length * n);
  keep.forEach((src, dst) => {
    outTimes[dst] = times[src] as number;
    // Constant tracks repeat the first sample (a closed loop's last sample equals it anyway).
    const from = constant ? 0 : src;
    for (let c = 0; c < n; c++) outValues[dst * n + c] = values[from * n + c] as number;
  });
  return {
    node: plan.node,
    path: plan.path,
    interpolation: plan.step === null ? 'LINEAR' : 'STEP',
    times: outTimes,
    values: outValues,
  };
}

/** Normalizes every quaternion (float64) and makes each one share the hemisphere of its predecessor. */
function normalizeContinuous(values: Float64Array): void {
  const count = values.length / 4;
  for (let k = 0; k < count; k++) {
    const o = k * 4;
    const len = Math.hypot(
      values[o] as number,
      values[o + 1] as number,
      values[o + 2] as number,
      values[o + 3] as number,
    );
    if (len === 0 || !Number.isFinite(len)) {
      values.set([0, 0, 0, 1], o);
    } else {
      for (let c = 0; c < 4; c++) values[o + c] = (values[o + c] as number) / len;
    }
    if (k > 0) hemisphere(values, k);
  }
}

function hemisphere(values: Float64Array, k: number): void {
  const o = k * 4;
  const p = o - 4;
  let dot = 0;
  for (let c = 0; c < 4; c++) dot += (values[o + c] as number) * (values[p + c] as number);
  if (dot < 0) for (let c = 0; c < 4; c++) values[o + c] = -(values[o + c] as number);
}

function largeStepLint(
  plan: TrackPlan,
  values: Float64Array,
  frames: readonly Frame[],
  warnings: LintIssue[],
  humanoid: boolean,
): void {
  for (let k = 1; k < frames.length; k++) {
    const a = values.subarray((k - 1) * 4, k * 4) as unknown as ReadonlyQuat;
    const b = values.subarray(k * 4, k * 4 + 4) as unknown as ReadonlyQuat;
    const angle = quatAngle(a, b);
    if (angle > LARGE_STEP_RAD) {
      const target = humanoid ? `humanoid bone ${HUMAN_BONE_NAMES[plan.node] ?? plan.node}` : `node ${plan.node}`;
      warnings.push({
        code: 'bake.large-rotation-step',
        severity: 'warning',
        message: `The rotation of ${target} turns ${(angle * RAD2DEG).toFixed(1)}° between frames ${frames[k - 1]} and ${frames[k]}; players interpolate the short way`,
      });
      return;
    }
  }
}

function isConstant(values: Float64Array, n: number): boolean {
  for (let i = n; i < values.length; i++) {
    if (Math.abs((values[i] as number) - (values[i % n] as number)) > CONSTANT_EPSILON) return false;
  }
  return true;
}

/** Indices of the times to keep so float32 times strictly increase; on a collision the later sample wins. */
function strictlyIncreasing(times: readonly number[]): number[] {
  const keep: number[] = [];
  for (let i = 0; i < times.length; i++) {
    while (keep.length > 0 && (times[keep[keep.length - 1] as number] as number) >= (times[i] as number)) keep.pop();
    keep.push(i);
  }
  return keep;
}

/** Clip metadata with a fixed key order (deterministic JSON) and lowercase-hex hashes. */
export function normalizeClipMeta(meta: EkzaClipMetaV1): EkzaClipMetaV1 {
  return {
    index: meta.index,
    name: meta.name,
    slot: meta.slot,
    loop: meta.loop,
    fps: meta.fps,
    durationSeconds: meta.durationSeconds,
    rootMotion: meta.rootMotion,
    contactSeconds: meta.contactSeconds,
    tags: [...meta.tags],
    derivedFrom: meta.derivedFrom.map(normalizeDerivedFrom),
    redistributable: meta.redistributable,
  };
}

function normalizeDerivedFrom(d: DerivedFrom): DerivedFrom {
  return {
    title: d.title,
    author: d.author,
    license: d.license,
    sourceSha256: d.sourceSha256 === null ? null : d.sourceSha256.toLowerCase(),
  };
}

/** `asset.extras.ekza_animation_v1` for the given clips (ADR 0010 §2); clip indices follow the array order. */
export function ekzaAnimationMeta(
  clips: readonly BakedClip[],
  rig: 'vrm-humanoid' | 'gltf-nodes',
  provenance: Omit<EkzaAnimationV1['provenance'], 'tool' | 'derivedFrom'>,
): EkzaAnimationV1 {
  const metas = clips.map((clip, index) => normalizeClipMeta({ ...clip.meta, index }));
  const seen = new Set<string>();
  const derivedFrom: DerivedFrom[] = [];
  for (const meta of metas) {
    for (const d of meta.derivedFrom) {
      const key = JSON.stringify(d);
      if (!seen.has(key)) {
        seen.add(key);
        derivedFrom.push(d);
      }
    }
  }
  return {
    schema: 1,
    rig,
    clips: metas,
    provenance: {
      tool: 'ekza-animator',
      toolVersion: provenance.toolVersion,
      projectSha256: provenance.projectSha256?.toLowerCase() ?? null,
      baseSha256: provenance.baseSha256?.toLowerCase() ?? null,
      derivedFrom,
    },
  };
}
