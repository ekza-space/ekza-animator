import type { HumanBoneName, Side } from '@ekza-animator/doc';
import type { SkeletonDesc } from '../types';
import { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT } from './bones';

// Helpers over the VRM 1.0 humanoid tables: buffer indices, present-bone lookups, side and template-key naming.

/** Index of each humanoid bone in `HUMAN_BONE_NAMES` (the `humanLocal` buffer layout). */
export const HUMAN_BONE_INDEX: ReadonlyMap<HumanBoneName, number> = new Map(
  HUMAN_BONE_NAMES.map((name, index) => [name, index]),
);

export function isHumanBoneName(name: string): name is HumanBoneName {
  return HUMAN_BONE_INDEX.has(name as HumanBoneName);
}

/** SkeletonDesc node index per `HUMAN_BONE_NAMES` slot, −1 when absent or out of range. */
export function humanNodeIndices(skeleton: SkeletonDesc): Int32Array {
  const out = new Int32Array(HUMAN_BONE_NAMES.length).fill(-1);
  const map = skeleton.humanoid;
  if (map === null) return out;
  HUMAN_BONE_NAMES.forEach((name, h) => {
    const node = map[name];
    if (node !== undefined && Number.isInteger(node) && node >= 0 && node < skeleton.nodes.length) out[h] = node;
  });
  return out;
}

/** The bone's nearest humanoid ancestor (VRM parent map) for which `present` holds, or null. */
export function nearestHumanAncestor(
  name: HumanBoneName,
  present: (bone: HumanBoneName) => boolean,
): HumanBoneName | null {
  let parent = HUMAN_BONE_PARENT[name];
  while (parent !== null) {
    if (present(parent)) return parent;
    parent = HUMAN_BONE_PARENT[parent];
  }
  return null;
}

/** Side of a humanoid bone from its VRM name. */
export function humanBoneSide(name: HumanBoneName): Side {
  if (name.startsWith('left')) return 'L';
  if (name.startsWith('right')) return 'R';
  return 'C';
}

/** The counterpart of a sided humanoid bone (`leftHand` ↔ `rightHand`), null for centre bones. */
export function mirrorHumanBone(name: HumanBoneName): HumanBoneName | null {
  if (name.startsWith('left')) return `right${name.slice(4)}` as HumanBoneName;
  if (name.startsWith('right')) return `left${name.slice(5)}` as HumanBoneName;
  return null;
}

/** The side-free part of a bone name with a lower-case first letter: `leftUpperArm` → `upperArm`. */
export function humanBoneStem(name: HumanBoneName): string {
  const stem = name.startsWith('left') ? name.slice(4) : name.startsWith('right') ? name.slice(5) : name;
  return stem.charAt(0).toLowerCase() + stem.slice(1);
}

/** Auto-rig template key of a humanoid FK control: `hips` → `fk.hips`, `leftUpperArm` → `fk.upperArm.L`. */
export function humanTemplateKey(name: HumanBoneName): string {
  const side = humanBoneSide(name);
  return side === 'C' ? `fk.${humanBoneStem(name)}` : `fk.${humanBoneStem(name)}.${side}`;
}

/** Display name of a humanoid FK control: `hips` → `Hips`, `leftUpperArm` → `L Upper Arm`. */
export function humanDisplayName(name: HumanBoneName): string {
  const side = humanBoneSide(name);
  const words = humanBoneStem(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return side === 'C' ? words : `${side} ${words}`;
}

export type HumanGroup = 'torso' | 'head' | 'jaw' | 'eye' | 'shoulder' | 'limb' | 'extremity' | 'finger';

/** Sizing and shape group of a humanoid bone (MVP-SPEC §4.11.15). */
export function humanBoneGroup(name: HumanBoneName): HumanGroup {
  switch (humanBoneStem(name)) {
    case 'hips':
    case 'spine':
    case 'chest':
    case 'upperChest':
      return 'torso';
    case 'neck':
    case 'head':
      return 'head';
    case 'jaw':
      return 'jaw';
    case 'eye':
      return 'eye';
    case 'shoulder':
      return 'shoulder';
    case 'upperArm':
    case 'lowerArm':
    case 'upperLeg':
    case 'lowerLeg':
      return 'limb';
    case 'hand':
    case 'foot':
    case 'toes':
      return 'extremity';
    default:
      return 'finger';
  }
}

/** Finger joint number along the finger (0, 1, 2) for finger bones, −1 otherwise. */
export function fingerJoint(name: HumanBoneName): number {
  if (humanBoneGroup(name) !== 'finger') return -1;
  if (name.endsWith('Metacarpal')) return 0;
  if (name.endsWith('Proximal')) return name.includes('Thumb') ? 1 : 0;
  if (name.endsWith('Intermediate')) return 1;
  return 2;
}

/**
 * Humanoid bones that continue a bone's chain, in preference order: the first present one defines the bone
 * direction and length used for control shapes (`ℓ_b`, MVP-SPEC §4.11.15).
 */
export function humanChainChildren(name: HumanBoneName): readonly HumanBoneName[] {
  const side = humanBoneSide(name);
  const p = side === 'L' ? 'left' : 'right';
  switch (humanBoneStem(name)) {
    case 'hips':
      return ['spine', 'chest', 'upperChest', 'neck'];
    case 'spine':
      return ['chest', 'upperChest', 'neck', 'head'];
    case 'chest':
      return ['upperChest', 'neck', 'head'];
    case 'upperChest':
      return ['neck', 'head'];
    case 'neck':
      return ['head'];
    case 'shoulder':
      return [`${p}UpperArm` as HumanBoneName];
    case 'upperArm':
      return [`${p}LowerArm` as HumanBoneName];
    case 'lowerArm':
      return [`${p}Hand` as HumanBoneName];
    case 'hand':
      return [
        `${p}MiddleProximal`,
        `${p}IndexProximal`,
        `${p}RingProximal`,
        `${p}LittleProximal`,
      ] as HumanBoneName[];
    case 'upperLeg':
      return [`${p}LowerLeg` as HumanBoneName];
    case 'lowerLeg':
      return [`${p}Foot` as HumanBoneName];
    case 'foot':
      return [`${p}Toes` as HumanBoneName];
    case 'thumbMetacarpal':
      return [`${p}ThumbProximal`, `${p}ThumbDistal`] as HumanBoneName[];
    case 'thumbProximal':
      return [`${p}ThumbDistal` as HumanBoneName];
    default: {
      const stem = humanBoneStem(name);
      if (stem.endsWith('Proximal')) {
        const finger = stem.slice(0, -'Proximal'.length);
        const cap = finger.charAt(0).toUpperCase() + finger.slice(1);
        return [`${p}${cap}Intermediate`, `${p}${cap}Distal`] as HumanBoneName[];
      }
      if (stem.endsWith('Intermediate')) {
        const finger = stem.slice(0, -'Intermediate'.length);
        const cap = finger.charAt(0).toUpperCase() + finger.slice(1);
        return [`${p}${cap}Distal` as HumanBoneName];
      }
      return [];
    }
  }
}
