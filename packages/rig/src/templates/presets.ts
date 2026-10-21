// The four VRM humanoid skeleton presets (M6B-SPEC §5.2; C2): their bone sets, the template hierarchy (the non-humanoid
// `root` → `hips` → the VRM parent map resolved to the nearest present ancestor, so the shoulders hang under the
// topmost chest bone) and the shared vector helpers of the template and Quick Rig maths.
import type { HumanBoneName } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT, VRM_REQUIRED_BONES } from '../humanoid/bones';
import type { SkeletonPreset, TemplateJoint } from '../types';

export type Vec3 = readonly [number, number, number];
export type TemplateKey = TemplateJoint['key'];

const SIDES = ['left', 'right'] as const;
const sided = (stems: readonly string[]): HumanBoneName[] =>
  SIDES.flatMap((side) => stems.map((stem) => `${side}${stem}` as HumanBoneName));

const LITE: readonly HumanBoneName[] = [...VRM_REQUIRED_BONES, 'chest', 'neck'];
const CORE: readonly HumanBoneName[] = [...LITE, ...sided(['Shoulder', 'Toes'])];
const MITTEN = [
  'ThumbMetacarpal',
  'ThumbProximal',
  'ThumbDistal',
  'MiddleProximal',
  'MiddleIntermediate',
  'MiddleDistal',
];
const STANDARD: readonly HumanBoneName[] = [...CORE, ...sided(MITTEN)];
const FULL_FINGERS = ['Index', 'Ring', 'Little'].flatMap((f) => [`${f}Proximal`, `${f}Intermediate`, `${f}Distal`]);
const FULL: readonly HumanBoneName[] = [...STANDARD, 'upperChest', ...sided(FULL_FINGERS)];

/** The humanoid bones of a preset, in the VRM humanoid table order (`HUMAN_BONE_NAMES`, parents first). */
export const PRESET_BONES: Readonly<Record<SkeletonPreset, readonly HumanBoneName[]>> = Object.freeze({
  lite17: order(LITE),
  core21: order(CORE),
  standard33: order(STANDARD),
  full52: order(FULL),
});

function order(bones: readonly HumanBoneName[]): readonly HumanBoneName[] {
  const set = new Set(bones);
  return Object.freeze(HUMAN_BONE_NAMES.filter((bone) => set.has(bone)));
}

export const SKELETON_PRESETS: readonly SkeletonPreset[] = Object.freeze(['lite17', 'core21', 'standard33', 'full52']);

export function isSkeletonPreset(value: unknown): value is SkeletonPreset {
  return typeof value === 'string' && (SKELETON_PRESETS as readonly string[]).includes(value);
}

/** The template parent of a bone within a bone set: the nearest present VRM ancestor; `hips` hangs under `root`. */
export function templateParent(bone: HumanBoneName, present: ReadonlySet<HumanBoneName>): TemplateKey {
  let parent = HUMAN_BONE_PARENT[bone];
  while (parent !== null && !present.has(parent)) parent = HUMAN_BONE_PARENT[parent];
  return parent ?? 'root';
}

/** The preset a set of humanoid bones matches exactly, else null. */
export function presetOfBones(bones: ReadonlySet<HumanBoneName>): SkeletonPreset | null {
  for (const preset of SKELETON_PRESETS) {
    const list = PRESET_BONES[preset];
    if (list.length === bones.size && list.every((bone) => bones.has(bone))) return preset;
  }
  return null;
}

// ---------- vectors (float64, plain tuples) ----------
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export function normalize(a: Vec3, fallback: Vec3 = [1, 0, 0]): Vec3 {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback;
}
/** The YZ-plane mirror `(−x, y, z)`; x = 0 stays +0 (never −0), so centre joints compare equal. */
export const mirrorX = (a: Vec3): Vec3 => [a[0] === 0 ? 0 : -a[0], a[1], a[2]];
