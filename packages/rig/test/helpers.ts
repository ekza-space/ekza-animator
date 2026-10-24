import {
  EkzaError,
  type Mat4,
  mat4Compose,
  mat4Decompose,
  type Quat,
  quatAngle,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  quatShortestArc,
  type ReadonlyQuat,
  type Vec3,
} from '@ekza-studio/anim-core';
import type { CharacterId, HumanBoneName, ModelFormat, RigId } from '@ekza-studio/doc';
import { readSyntheticFixture } from '@ekza-studio/doc/testing';
import type { SkeletonDesc, SkeletonNode } from '../src';

export const IDS = {
  character: 'chr_TestCharacter001' as CharacterId,
  rig: 'rig_TestRigRecord001' as RigId,
};

/** The shared synthetic humanoid (fixtures/synthetic/humanoid-skeleton.json): 25 humanoid bones + `Root`. */
export function syntheticSkeleton(): SkeletonDesc {
  return readSyntheticFixture('humanoid-skeleton.json') as SkeletonDesc;
}

export interface RestPoseFixture {
  readonly bones: readonly { readonly node: number; readonly t: Vec3; readonly q: Quat; readonly world: number[] }[];
}

export function restPoseFixture(): RestPoseFixture {
  return readSyntheticFixture('rest-pose.json') as RestPoseFixture;
}

/**
 * True when calling `probe` hits a stub of an unmerged work package (EkzaError 'not-implemented'). Stubs throw
 * synchronously; a promise returned by a real async implementation is marked handled so a rejection on the bogus
 * probe input cannot fail the run as an unhandled rejection.
 */
export function pendingStub(probe: () => unknown): boolean {
  try {
    const result = probe();
    if (result instanceof Promise) result.catch(() => undefined);
    return false;
  } catch (error) {
    return error instanceof EkzaError && error.code === 'not-implemented';
  }
}

// ---------- math helpers ----------

/** Rotation angle between two orientations (sign-insensitive; atan2 keeps precision near 0). */
export function quatAngleBetween(a: ReadonlyQuat, b: ReadonlyQuat): number {
  const na = Math.hypot(a[0], a[1], a[2], a[3]);
  const nb = Math.hypot(b[0], b[1], b[2], b[3]);
  return quatAngle([a[0] / na, a[1] / na, a[2] / na, a[3] / na], [b[0] / nb, b[1] / nb, b[2] / nb, b[3] / nb]);
}

export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    max = Math.max(max, Math.abs((a[i] ?? Number.NaN) - (b[i] ?? Number.NaN)));
  }
  return Number.isNaN(max) ? Number.POSITIVE_INFINITY : max;
}

export function subarray16(buffer: Float64Array, index: number): Mat4 {
  return buffer.slice(index * 16, index * 16 + 16);
}

export function quatAt(buffer: Float64Array, offset: number): Quat {
  return [
    buffer[offset] as number,
    buffer[offset + 1] as number,
    buffer[offset + 2] as number,
    buffer[offset + 3] as number,
  ];
}

export function vecAt(buffer: Float64Array, offset: number): Vec3 {
  return [buffer[offset] as number, buffer[offset + 1] as number, buffer[offset + 2] as number];
}

export function worldQuat(m: Mat4): Quat {
  return mat4Decompose(m).q;
}

export function worldPos(m: Mat4): Vec3 {
  return [m[12] as number, m[13] as number, m[14] as number];
}

export function axisAngle(axis: Vec3, angle: number): Quat {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  const s = Math.sin(angle / 2) / len;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function xfMat(t: Vec3, q: Quat, s: Vec3 = [1, 1, 1]): Mat4 {
  return mat4Compose({ t, q, s });
}

/** Deterministic pseudo-random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- synthetic skeletons built from rest WORLD poses ----------

export interface BoneSpec {
  /** Spec identifier (parents and aims refer to it); also the node name unless `nodeName` is given. */
  readonly name: string;
  readonly nodeName?: string;
  readonly humanoid?: HumanBoneName;
  readonly parent: string | null;
  /** Rest world position (canonical space). */
  readonly t: Vec3;
  /** Rest world rotation (canonical); default: Y-aim (+Y towards `aim`, else the parent's rotation). */
  readonly q?: Quat;
  readonly aim?: string;
  readonly joint?: boolean;
  readonly spring?: boolean;
  readonly radius?: number | null;
  readonly scale?: number;
}

/**
 * Builds a SkeletonDesc from canonical rest WORLD transforms. `facing: 'vrm0'` stores the nodes in VRM 0.x file
 * space (π yaw) with the matching `facing`, so canonical rest worlds equal the specs either way.
 */
export function skeletonFromWorld(
  specs: readonly BoneSpec[],
  opts: { readonly format?: ModelFormat; readonly vrm0?: boolean; readonly height?: number } = {},
): SkeletonDesc {
  const index = new Map(specs.map((spec, i) => [spec.name, i]));
  const worldQ: Quat[] = [];
  specs.forEach((spec, i) => {
    if (spec.q !== undefined) {
      worldQ.push(spec.q);
      return;
    }
    const target = spec.aim === undefined ? undefined : specs[index.get(spec.aim) as number];
    if (target !== undefined) {
      const dir: Vec3 = [target.t[0] - spec.t[0], target.t[1] - spec.t[1], target.t[2] - spec.t[2]];
      worldQ.push(quatShortestArc([0, 1, 0], dir));
      return;
    }
    const parent = spec.parent === null ? undefined : index.get(spec.parent);
    worldQ.push(parent === undefined || parent >= i ? [0, 0, 0, 1] : (worldQ[parent] as Quat));
  });
  const facing: Quat = opts.vrm0 === true ? [0, 1, 0, 0] : [0, 0, 0, 1];
  const facingInverse = quatInvert(facing);
  const worldScale = specs.map((spec) => spec.scale ?? 1);
  const nodes: SkeletonNode[] = specs.map((spec, i) => {
    const parent = spec.parent === null ? -1 : (index.get(spec.parent) ?? -1);
    let t: Vec3;
    let q: Quat;
    let s = worldScale[i] as number;
    if (parent === -1) {
      // Root: canonical = F · L ⇒ L = F⁻¹ · canonical.
      t = quatRotateVec3(facingInverse, spec.t);
      q = quatMultiply(facingInverse, worldQ[i] as Quat);
    } else {
      const parentQ = worldQ[parent] as Quat;
      const parentSpec = specs[parent] as BoneSpec;
      const inverse = quatInvert(parentQ);
      const ps = worldScale[parent] as number;
      const d: Vec3 = [spec.t[0] - parentSpec.t[0], spec.t[1] - parentSpec.t[1], spec.t[2] - parentSpec.t[2]];
      const local = quatRotateVec3(inverse, d);
      t = [local[0] / ps, local[1] / ps, local[2] / ps];
      q = quatMultiply(inverse, worldQ[i] as Quat);
      s = s / ps;
    }
    return {
      index: i,
      gltfIndex: i,
      name: spec.nodeName ?? spec.name,
      parent,
      restLocal: { t, q, s: [s, s, s] },
      hasMatrix: false,
      isJoint: spec.joint ?? true,
      hasMesh: false,
    };
  });
  const humanoid: Partial<Record<HumanBoneName, number>> = {};
  specs.forEach((spec, i) => {
    if (spec.humanoid !== undefined) humanoid[spec.humanoid] = i;
  });
  const springJoints = specs.flatMap((spec, i) => (spec.spring === true ? [i] : []));
  return {
    format: opts.format ?? (opts.vrm0 === true ? 'vrm0' : 'vrm1'),
    facing,
    nodes,
    humanoid: Object.keys(humanoid).length === 0 ? null : humanoid,
    springJoints,
    nodeConstraints: [],
    constrainedNodes: [],
    boneRadii: specs.map((spec) => spec.radius ?? null),
    height: opts.height ?? 1.7,
    heightSource: 'joints',
    fingerprint: 'sha256:synthetic',
    ekzaHeightScale: null,
    warnings: [],
  };
}

type SideName = 'left' | 'right';

function armSpecs(side: SideName): BoneSpec[] {
  const s = side === 'left' ? 1 : -1;
  const p = side;
  const n = (bone: string): HumanBoneName => `${p}${bone}` as HumanBoneName;
  const fingers: BoneSpec[] = [];
  const finger = (
    name: string,
    joints: readonly [string, string, string],
    base: Vec3,
    step: Vec3,
    parent: string,
  ): void => {
    joints.forEach((joint, j) => {
      const bone = n(`${name}${joint}`);
      const next = j < 2 ? n(`${name}${joints[j + 1] as string}`) : undefined;
      fingers.push({
        name: bone,
        humanoid: bone,
        parent: j === 0 ? parent : n(`${name}${joints[j - 1] as string}`),
        t: [s * (base[0] + step[0] * j), base[1] + step[1] * j, base[2] + step[2] * j],
        ...(next === undefined ? {} : { aim: next }),
        radius: 0.008,
      });
    });
  };
  finger('Thumb', ['Metacarpal', 'Proximal', 'Distal'], [0.66, 1.38, 0.025], [0.025, -0.006, 0.02], n('Hand'));
  finger('Index', ['Proximal', 'Intermediate', 'Distal'], [0.72, 1.39, 0.022], [0.035, -0.002, 0], n('Hand'));
  finger('Middle', ['Proximal', 'Intermediate', 'Distal'], [0.725, 1.39, 0.002], [0.038, -0.002, 0], n('Hand'));
  finger('Ring', ['Proximal', 'Intermediate', 'Distal'], [0.72, 1.39, -0.018], [0.034, -0.002, 0], n('Hand'));
  finger('Little', ['Proximal', 'Intermediate', 'Distal'], [0.71, 1.388, -0.036], [0.027, -0.002, 0], n('Hand'));
  const twist = `${side}ForeArmTwist`;
  return [
    {
      name: n('Shoulder'),
      humanoid: n('Shoulder'),
      parent: 'upperChest',
      t: [s * 0.04, 1.39, -0.01],
      aim: n('UpperArm'),
      radius: 0.05,
    },
    {
      name: n('UpperArm'),
      humanoid: n('UpperArm'),
      parent: n('Shoulder'),
      t: [s * 0.14, 1.39, -0.01],
      aim: n('LowerArm'),
      radius: 0.05,
    },
    {
      name: n('LowerArm'),
      humanoid: n('LowerArm'),
      parent: n('UpperArm'),
      t: [s * 0.4, 1.39, -0.01],
      aim: twist,
      radius: 0.04,
    },
    { name: twist, parent: n('LowerArm'), t: [s * 0.52, 1.39, -0.01], aim: n('Hand'), radius: 0.035 },
    {
      name: n('Hand'),
      humanoid: n('Hand'),
      parent: twist,
      t: [s * 0.64, 1.39, -0.01],
      aim: n('MiddleProximal'),
      radius: 0.035,
    },
    ...fingers,
  ];
}

function legSpecs(side: SideName, opts: { readonly toes: boolean }): BoneSpec[] {
  const s = side === 'left' ? 1 : -1;
  const n = (bone: string): HumanBoneName => `${side}${bone}` as HumanBoneName;
  const specs: BoneSpec[] = [
    {
      name: n('UpperLeg'),
      humanoid: n('UpperLeg'),
      parent: 'hips',
      t: [s * 0.09, 0.9, 0],
      aim: n('LowerLeg'),
      radius: 0.08,
    },
    {
      name: n('LowerLeg'),
      humanoid: n('LowerLeg'),
      parent: n('UpperLeg'),
      t: [s * 0.09, 0.49, 0.012],
      aim: n('Foot'),
      radius: 0.06,
    },
    {
      name: n('Foot'),
      humanoid: n('Foot'),
      parent: n('LowerLeg'),
      t: [s * 0.09, 0.08, 0],
      ...(opts.toes ? { aim: n('Toes') } : { q: [0, 0, 0, 1] }),
      radius: 0.045,
    },
  ];
  if (opts.toes)
    specs.push({ name: n('Toes'), humanoid: n('Toes'), parent: n('Foot'), t: [s * 0.09, 0.02, 0.12], radius: 0.035 });
  return specs;
}

/**
 * A richer synthetic humanoid: full fingers, a non-humanoid twist joint between each lower arm and hand, eyes, jaw,
 * paired hair joints and a skirt joint (secondary controls), a spring-bone ponytail, Y-aim rest rotations (+Y down the
 * bone) and slightly bent knees. `leftToes: false` drops the left toes (like Polybot).
 */
export function richHumanoidSpecs(opts: { readonly leftToes?: boolean } = {}): BoneSpec[] {
  return [
    { name: 'Root', parent: null, t: [0, 0, 0], joint: false },
    { name: 'hips', humanoid: 'hips', parent: 'Root', t: [0, 0.95, 0], aim: 'spine', radius: 0.14 },
    { name: 'skirt_front', parent: 'hips', t: [0, 0.85, 0.12], radius: 0.05 },
    { name: 'spine', humanoid: 'spine', parent: 'hips', t: [0, 1.05, 0], aim: 'chest', radius: 0.13 },
    { name: 'chest', humanoid: 'chest', parent: 'spine', t: [0, 1.17, 0], aim: 'upperChest', radius: 0.14 },
    { name: 'upperChest', humanoid: 'upperChest', parent: 'chest', t: [0, 1.29, 0], aim: 'neck', radius: 0.14 },
    { name: 'neck', humanoid: 'neck', parent: 'upperChest', t: [0, 1.43, 0], aim: 'head', radius: 0.06 },
    { name: 'head', humanoid: 'head', parent: 'neck', t: [0, 1.53, 0], radius: 0.11 },
    { name: 'leftEye', humanoid: 'leftEye', parent: 'head', t: [0.03, 1.6, 0.08] },
    { name: 'rightEye', humanoid: 'rightEye', parent: 'head', t: [-0.03, 1.6, 0.08] },
    { name: 'jaw', humanoid: 'jaw', parent: 'head', t: [0, 1.51, 0.05], radius: 0.05 },
    { name: 'hair_L', parent: 'head', t: [0.06, 1.66, -0.04], radius: null },
    { name: 'hair_R', parent: 'head', t: [-0.06, 1.66, -0.04], radius: null },
    { name: 'ponytail', parent: 'head', t: [0, 1.62, -0.1], aim: 'ponytail_end', spring: true },
    { name: 'ponytail_end', parent: 'ponytail', t: [0, 1.5, -0.14], spring: true },
    ...armSpecs('left'),
    ...armSpecs('right'),
    ...legSpecs('left', { toes: opts.leftToes ?? true }),
    ...legSpecs('right', { toes: true }),
  ];
}

export function richHumanoid(opts: { readonly vrm0?: boolean; readonly leftToes?: boolean } = {}): SkeletonDesc {
  return skeletonFromWorld(richHumanoidSpecs(opts), { vrm0: opts.vrm0 ?? false });
}

/** A generic (non-humanoid) skinned chain with a scaled, rotated armature node above the joints. */
export function genericSkeleton(): SkeletonDesc {
  return skeletonFromWorld(
    [
      { name: 'Armature', parent: null, t: [0, 0, 0], q: axisAngle([1, 0, 0], -Math.PI / 2), joint: false, scale: 1 },
      { name: 'root', parent: 'Armature', t: [0, 0.9, 0], aim: 'spine' },
      { name: 'spine', parent: 'root', t: [0, 1.1, 0.02], aim: 'neck' },
      { name: 'neck', parent: 'spine', t: [0, 1.45, 0] },
      { name: 'upperarm_l', parent: 'spine', t: [0.2, 1.4, 0], aim: 'lowerarm_l' },
      { name: 'lowerarm_l', parent: 'upperarm_l', t: [0.45, 1.4, 0] },
      { name: 'upperarm_r', parent: 'spine', t: [-0.2, 1.4, 0], aim: 'lowerarm_r' },
      { name: 'lowerarm_r', parent: 'upperarm_r', t: [-0.45, 1.4, 0] },
      { name: 'tail1', nodeName: 'tail', parent: 'root', t: [0, 0.85, -0.2], aim: 'tail2' },
      { name: 'tail2', nodeName: 'tail', parent: 'tail1', t: [0, 0.8, -0.4] },
      { name: 'acc_a', nodeName: 'acc', parent: 'spine', t: [0.05, 1.2, 0.1] },
      { name: 'acc_b', nodeName: 'acc', parent: 'spine', t: [-0.05, 1.2, 0.1] },
    ],
    { format: 'gltf' },
  );
}
