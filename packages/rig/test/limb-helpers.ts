import { getHeapSpaceStatistics } from 'node:v8';
import { mat4Decompose, type Quat, quatAngle, type Vec3 } from '@ekza-animator/anim-core';
import { type ChannelValues, type ControlId, controlId } from '@ekza-animator/doc';
import {
  autoRig,
  type ChannelBuffer,
  compileRig,
  type LimbId,
  type PoseBuffers,
  type RigDefinition,
  type RigProgram,
  type SkeletonDesc,
  writeAttr,
  writeControlChannels,
} from '../src';
import { type BoneSpec, IDS, richHumanoidSpecs, skeletonFromWorld } from './helpers';

export const id = (key: string): ControlId => controlId(IDS.rig, key);
export const ALL_IK: { readonly legs: boolean; readonly arms: boolean } = { legs: true, arms: true };
export const DEG = Math.PI / 180;

export function ikDef(skeleton: SkeletonDesc, ik = ALL_IK): RigDefinition {
  return autoRig(skeleton, IDS, { ik });
}

export function ikRig(skeleton: SkeletonDesc, ik = ALL_IK): RigProgram {
  return compileRig(ikDef(skeleton, ik), skeleton);
}

/** Channels: every limb's ikFk at `ikFk` (default 1), then the given values (attributes as '@name'). */
export function channels(
  program: RigProgram,
  values: ReadonlyMap<ControlId, ChannelValues> = new Map(),
  ikFk = 1,
): ChannelBuffer {
  const ch = program.allocChannels();
  for (const limb of program.limbs) writeAttr(program, ch, limb.params.ikControl, 'ikFk', ikFk);
  for (const [control, v] of values) writeControlChannels(program, ch, control, v);
  return ch;
}

export function evaluate(program: RigProgram, ch: ChannelBuffer): PoseBuffers {
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  return pose;
}

export function nodeOf(skeleton: SkeletonDesc, bone: string): number {
  const node = (skeleton.humanoid as Record<string, number | undefined> | null)?.[bone];
  if (node === undefined) throw new Error(`no ${bone}`);
  return node;
}

export function bonePos(pose: PoseBuffers, node: number): Vec3 {
  return [
    pose.boneWorld[node * 16 + 12] as number,
    pose.boneWorld[node * 16 + 13] as number,
    pose.boneWorld[node * 16 + 14] as number,
  ];
}

export function boneQuat(pose: PoseBuffers, node: number): Quat {
  return mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16)).q;
}

export function controlPos(program: RigProgram, pose: PoseBuffers, control: ControlId): Vec3 {
  const slot = program.controlIndex.get(control) as number;
  return [
    pose.controlWorld[slot * 16 + 12] as number,
    pose.controlWorld[slot * 16 + 13] as number,
    pose.controlWorld[slot * 16 + 14] as number,
  ];
}

export function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );
}

/** Largest translation (m) and rotation (rad, atan2-exact) difference of every bone local against the rest locals. */
export function restError(
  program: RigProgram,
  pose: PoseBuffers,
): { translation: number; rotation: number; worst: string } {
  let translation = 0;
  let rotation = 0;
  let worst = '';
  program.skeleton.nodes.forEach((node, i) => {
    const q = node.restLocal.q;
    for (let k = 0; k < 3; k++) {
      const t = Math.abs((pose.boneLocal[i * 10 + k] as number) - (node.restLocal.t[k] as number));
      const s = Math.abs((pose.boneLocal[i * 10 + 7 + k] as number) - (node.restLocal.s[k] as number));
      if (Math.max(t, s) > translation) {
        translation = Math.max(t, s);
        worst = `${node.name} t/s`;
      }
    }
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    const r = quatAngle(
      [
        pose.boneLocal[i * 10 + 3] as number,
        pose.boneLocal[i * 10 + 4] as number,
        pose.boneLocal[i * 10 + 5] as number,
        pose.boneLocal[i * 10 + 6] as number,
      ],
      [q[0] / n, q[1] / n, q[2] / n, q[3] / n],
    );
    if (r > rotation) {
      rotation = r;
      worst = `${node.name} q`;
    }
  });
  return { translation, rotation, worst };
}

/** Largest difference of the bone locals of two poses (rotation via quatAngle, translation and scale). */
export function localDifference(a: PoseBuffers, b: PoseBuffers, nodes?: readonly number[]): number {
  const count = a.boneLocal.length / 10;
  let worst = 0;
  for (const i of nodes ?? Array.from({ length: count }, (_, k) => k)) {
    for (const k of [0, 1, 2, 7, 8, 9]) {
      worst = Math.max(worst, Math.abs((a.boneLocal[i * 10 + k] as number) - (b.boneLocal[i * 10 + k] as number)));
    }
    const qa: Quat = [
      a.boneLocal[i * 10 + 3] as number,
      a.boneLocal[i * 10 + 4] as number,
      a.boneLocal[i * 10 + 5] as number,
      a.boneLocal[i * 10 + 6] as number,
    ];
    const qb: Quat = [
      b.boneLocal[i * 10 + 3] as number,
      b.boneLocal[i * 10 + 4] as number,
      b.boneLocal[i * 10 + 5] as number,
      b.boneLocal[i * 10 + 6] as number,
    ];
    worst = Math.max(worst, quatAngle(qa, qb));
  }
  return worst;
}

const rotateY = (v: Vec3, angle: number): Vec3 => [
  v[0] * Math.cos(angle) + v[2] * Math.sin(angle),
  v[1],
  -v[0] * Math.sin(angle) + v[2] * Math.cos(angle),
];

/**
 * Variants of the rich synthetic humanoid (helpers.ts) for limb IK:
 * - `toeOut`: both feet turned outward by that angle (toes rotate about the ankle's vertical);
 * - `hyperElbow`: the elbows sit that far in front of the shoulder–hand line (a hyperextended rest);
 * - `splayedLegs`: thighs going out and down to a vertical shin (a rest bent off the knee hinge, like Polybot).
 */
export function limbHumanoid(
  opts: {
    readonly toeOut?: number;
    readonly hyperElbow?: number;
    readonly splayedLegs?: boolean;
    readonly bentArms?: boolean;
    readonly vrm0?: boolean;
  } = {},
): SkeletonDesc {
  const specs = richHumanoidSpecs().map((spec): BoneSpec => {
    const side = spec.humanoid?.startsWith('left') === true ? 1 : spec.humanoid?.startsWith('right') === true ? -1 : 0;
    const name = spec.humanoid ?? '';
    if (opts.toeOut !== undefined && name.endsWith('Toes')) {
      const ankle: Vec3 = [side * 0.09, 0.08, 0];
      const offset: Vec3 = [spec.t[0] - ankle[0], spec.t[1] - ankle[1], spec.t[2] - ankle[2]];
      const turned = rotateY(offset, side * opts.toeOut);
      return { ...spec, t: [ankle[0] + turned[0], ankle[1] + turned[1], ankle[2] + turned[2]] };
    }
    if (opts.hyperElbow !== undefined && name.endsWith('LowerArm')) {
      return { ...spec, t: [spec.t[0], spec.t[1], spec.t[2] + opts.hyperElbow] };
    }
    if (opts.bentArms === true && name.endsWith('LowerArm')) {
      return { ...spec, t: [spec.t[0], spec.t[1], spec.t[2] - 0.03] };
    }
    if (opts.splayedLegs === true && (name.endsWith('LowerLeg') || name.endsWith('Foot') || name.endsWith('Toes'))) {
      return { ...spec, t: [spec.t[0] + side * 0.06, spec.t[1], spec.t[2]] };
    }
    return spec;
  });
  return skeletonFromWorld(specs, { vrm0: opts.vrm0 ?? false });
}

export const LEGS: readonly LimbId[] = ['leg.L', 'leg.R'];
export const ARMS: readonly LimbId[] = ['arm.L', 'arm.R'];

/** Deterministic pseudo-random numbers in [−0.5, 0.5). */
export function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647 - 0.5;
  };
}

/** Bytes in use in V8's young generation (new space). */
function newSpaceUsed(): number {
  return getHeapSpaceStatistics().find((space) => space.space_name === 'new_space')?.space_used_size ?? Number.NaN;
}

/**
 * Bytes V8 allocates per call of `run`, counted: the least growth of the young generation over `rounds` runs of
 * `calls` calls (after one uncounted round that lets the optimizer settle the measuring loop), less the least growth
 * over as many calls of an empty function (the reading's own allocation, a few kB), divided by `calls`. Exact to the
 * byte while no collection runs in between, so run it inside `collectionsDuring` and expect 0 collections (every V8
 * heap object takes ≥ 16 bytes, so an allocation per call shows up as ≥ 16).
 */
export function allocatedBytesPerCall(run: () => void, calls: number, rounds = 3): number {
  const empty = (): void => undefined;
  let least = Number.POSITIVE_INFINITY;
  let overhead = Number.POSITIVE_INFINITY;
  for (let round = -1; round < rounds; round++) {
    for (const [fn, isRun] of [
      [empty, false],
      [run, true],
    ] as const) {
      const before = newSpaceUsed();
      for (let i = 0; i < calls; i++) fn();
      const delta = newSpaceUsed() - before;
      if (round < 0) continue;
      if (isRun) least = Math.min(least, delta);
      else overhead = Math.min(overhead, delta);
    }
  }
  return (least - overhead) / calls;
}
