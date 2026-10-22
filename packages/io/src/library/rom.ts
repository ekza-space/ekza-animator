// The range-of-motion test clip (AUTORIG-SPEC §5.4.1; D5, the M6B §5.17 pose list): a procedurally generated
// normalized humanoid clip in the VRM frame (+Y up, the character faces +Z, its left is +X; rest = T-pose = identity
// normalized locals), MIT, built in memory — never a file. One pose every 4 frames at 30 fps, linear between poses,
// looping back to the rest pose. `writeHumanoidVrma(romClip(), …)` turns it into VRMA bytes for the library preview's
// `bytes` source (§5.5.3 step 5). When M6b's post-MVP `skin.test.rom` is built it SHOULD read `ROM_POSES`.
import { type Quat, quatFromAxisAngle, quatMultiply } from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES, type HumanoidClipData } from '@ekza-studio/rig';

/** Frames per pose and the clip rate (M6B §5.17). */
export const ROM_FRAMES_PER_POSE = 4;
export const ROM_FPS = 30;

type Axis = 'x' | 'y' | 'z';
/** A rotation of one bone in a pose: about the parent's normalized axis, degrees; left-side values (the right side
 *  mirrors them: about X unchanged, about Y and Z negated). */
type Turn = readonly [Axis, number];
/** One pose: turns per bone family (`UpperArm` = both upper arms; centre bones by their own name). */
export interface RomPose {
  readonly name: string;
  readonly turns: Readonly<Partial<Record<string, readonly Turn[]>>>;
}

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;
const PHALANGES = ['Metacarpal', 'Proximal', 'Intermediate', 'Distal'] as const;

/** Finger curls: every finger bone about Z toward the palm (−Y in the T-pose), the thumb about Y toward +Z. */
const fingerCurl: Readonly<Record<string, readonly Turn[]>> = Object.fromEntries(
  FINGERS.flatMap((finger) =>
    PHALANGES.map((phalanx) => [
      `${finger}${phalanx}`,
      finger === 'Thumb' ? ([['y', -40]] as const) : phalanx === 'Metacarpal' ? [] : ([['z', -70]] as const),
    ]),
  ),
);

/**
 * The pose table (M6B §5.17): arms down / forward / up, elbows 0–140°, wrists ±60°, spine and neck twist and bend
 * ±40°, legs forward / side / back, knees 0–130°, feet ±30°, finger curls. The first and the last pose are the rest.
 */
export const ROM_POSES: readonly RomPose[] = [
  { name: 'rest', turns: {} },
  { name: 'arms down', turns: { UpperArm: [['z', -80]] } },
  { name: 'arms forward', turns: { UpperArm: [['y', -90]] } },
  { name: 'arms up', turns: { UpperArm: [['z', 80]] } },
  { name: 'elbows 140', turns: { LowerArm: [['y', -140]] } },
  { name: 'wrists up', turns: { Hand: [['z', 60]] } },
  { name: 'wrists down', turns: { Hand: [['z', -60]] } },
  { name: 'spine twist left', turns: { spine: [['y', 40]] } },
  { name: 'spine twist right', turns: { spine: [['y', -40]] } },
  { name: 'spine bend forward', turns: { spine: [['x', 40]] } },
  { name: 'spine bend back', turns: { spine: [['x', -40]] } },
  { name: 'neck twist', turns: { neck: [['y', 40]] } },
  { name: 'neck bend', turns: { neck: [['x', 40]] } },
  { name: 'legs forward', turns: { UpperLeg: [['x', -60]] } },
  { name: 'legs side', turns: { UpperLeg: [['z', 45]] } },
  { name: 'legs back', turns: { UpperLeg: [['x', 30]] } },
  { name: 'knees 130', turns: { LowerLeg: [['x', 130]] } },
  { name: 'feet up', turns: { Foot: [['x', -30]] } },
  { name: 'feet down', turns: { Foot: [['x', 30]] } },
  { name: 'finger curls', turns: fingerCurl },
  { name: 'rest', turns: {} },
];

const AXES: Readonly<Record<Axis, readonly [number, number, number]>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const DEG = Math.PI / 180;

/** The family key of a bone (`leftUpperArm` → `UpperArm`, `spine` → `spine`) and its side sign (right = mirrored). */
function familyOf(bone: HumanBoneName): { readonly family: string; readonly right: boolean } {
  if (bone.startsWith('left')) return { family: bone.slice(4), right: false };
  if (bone.startsWith('right')) return { family: bone.slice(5), right: true };
  return { family: bone, right: false };
}

/** The normalized local rotation of `bone` in `pose` (identity when the pose does not turn it). */
export function romRotation(pose: RomPose, bone: HumanBoneName): Quat {
  const { family, right } = familyOf(bone);
  let q: Quat = [0, 0, 0, 1];
  for (const [axis, degrees] of pose.turns[family] ?? []) {
    // reflection across the YZ plane: about X unchanged, about Y and Z negated
    const angle = (right && axis !== 'x' ? -degrees : degrees) * DEG;
    q = quatMultiply(quatFromAxisAngle(AXES[axis], angle), q);
  }
  return q;
}

/** Bones the ROM moves: every humanoid bone but the eyes and the jaw (a target without a bone ignores its track). */
const ROM_BONES: readonly HumanBoneName[] = HUMAN_BONE_NAMES.filter(
  (bone) => bone !== 'leftEye' && bone !== 'rightEye' && bone !== 'jaw',
);

/**
 * The range-of-motion clip: one LINEAR rotation track per bone the table ever turns, a key every 4 frames at 30 fps
 * (the pose of that index), no hips translation (the hips stay at the target's rest). `fingers: false` leaves the
 * finger bones out (a body without fingers). Deterministic.
 */
export function romClip(opts: { readonly fingers?: boolean } = {}): HumanoidClipData {
  const fingers = opts.fingers ?? true;
  const bones = ROM_BONES.filter(
    (bone) => fingers || !FINGERS.some((finger) => familyOf(bone).family.startsWith(finger)),
  );
  const times = Float32Array.from(ROM_POSES.map((_, i) => (i * ROM_FRAMES_PER_POSE) / ROM_FPS));
  const rotations: Partial<Record<HumanBoneName, { times: Float32Array; values: Float32Array }>> = {};
  const interpolation: Partial<Record<HumanBoneName | 'hipsPosition', 'LINEAR'>> = {};
  for (const bone of bones) {
    const quats = ROM_POSES.map((pose) => romRotation(pose, bone));
    if (quats.every((q) => q[3] === 1)) continue;
    rotations[bone] = { times, values: Float32Array.from(quats.flat()) };
    interpolation[bone] = 'LINEAR';
  }
  return {
    name: 'Range_Test_Loop',
    duration: times[times.length - 1] as number,
    presentBones: bones,
    rotations,
    hips: null,
    restHipsPosition: [0, 0.9, 0],
    interpolation,
  };
}

/** VRMA bytes of `romClip(opts)` (MIT, Ekza Studio); the writer loads on the first call. Deterministic. */
export async function romVrma(opts: { readonly fingers?: boolean } = {}): Promise<Uint8Array> {
  const { writeHumanoidVrma } = await import('./vrma');
  return writeHumanoidVrma(romClip(opts), {
    generator: 'ekza-studio range test v1',
    license: 'MIT',
    credit: 'Ekza Studio',
    source: 'Range test',
  });
}

/** The clip frame (at 30 fps) of the pose named `name` (the first one). */
export function romFrameOf(name: string): number {
  const index = ROM_POSES.findIndex((pose) => pose.name === name);
  if (index < 0) throw new Error(`no ROM pose '${name}'`);
  return index * ROM_FRAMES_PER_POSE;
}
