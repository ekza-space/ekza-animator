import type { BoneRef } from '@ekza-animator/doc';
import { HUMAN_BONE_INDEX, humanNodeIndices } from '../humanoid/map';
import type { SkeletonDesc } from '../types';

// Semantic bone references (never glTF indices in the document): a VRM humanoid name, or a node name plus its
// parent's name and an occurrence index among nodes sharing both (SkeletonDesc order).

function nameKey(name: string, parentName: string | null): string {
  return parentName === null ? `${name}\u0000` : `${name}\u0000\u0001${parentName}`;
}

function parentNameOf(skeleton: SkeletonDesc, node: number): string | null {
  const parent = skeleton.nodes[node]?.parent ?? -1;
  return parent >= 0 && parent < skeleton.nodes.length ? (skeleton.nodes[parent]?.name ?? null) : null;
}

export type BoneResolver = (ref: BoneRef) => number;

/** Resolves bone references to SkeletonDesc node indices (−1 when absent). */
export function createBoneResolver(skeleton: SkeletonDesc): BoneResolver {
  const human = humanNodeIndices(skeleton);
  const byName = new Map<string, number[]>();
  skeleton.nodes.forEach((node, i) => {
    const key = nameKey(node.name, parentNameOf(skeleton, i));
    const list = byName.get(key);
    if (list === undefined) byName.set(key, [i]);
    else list.push(i);
  });
  return (ref: BoneRef): number => {
    if ('humanoid' in ref) {
      const index = HUMAN_BONE_INDEX.get(ref.humanoid);
      return index === undefined ? -1 : (human[index] as number);
    }
    if (typeof ref.name !== 'string') return -1;
    const list = byName.get(nameKey(ref.name, ref.parentName ?? null));
    const occurrence = ref.occurrence ?? 0;
    if (list === undefined || !Number.isInteger(occurrence) || occurrence < 0) return -1;
    return list[occurrence] ?? -1;
  };
}

/** A name-based reference to `node` that `createBoneResolver` resolves back to it. */
export function nameBoneRef(skeleton: SkeletonDesc, node: number): BoneRef {
  const name = skeleton.nodes[node]?.name ?? '';
  const parentName = parentNameOf(skeleton, node);
  let occurrence = 0;
  for (let i = 0; i < node; i++) {
    if (skeleton.nodes[i]?.name === name && parentNameOf(skeleton, i) === parentName) occurrence++;
  }
  return occurrence === 0 ? { name, parentName } : { name, parentName, occurrence };
}

/** Stable label of a bone reference for warnings. */
export function boneRefLabel(ref: BoneRef): string {
  if ('humanoid' in ref) return `humanoid:${ref.humanoid}`;
  const suffix = ref.occurrence === undefined || ref.occurrence === 0 ? '' : `#${ref.occurrence}`;
  return `${ref.parentName ?? ''}/${ref.name}${suffix}`;
}
