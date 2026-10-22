// What the Validation rules read (M6B-SPEC §5.21; C7): a character's skeleton, joints and meshes from the records, in
// the shapes the rule owners take — C2's `checkSkeleton(DocSkeletonInput)` and C6's `checkSkin(skin, {skeleton,
// review, unreachable})`. Pure functions over the store and the mesh runtimes (no caching here; the service caches).
import { mat4Compose } from '@ekza-studio/anim-core';
import type { CharacterId, JointRecord, MeshRecord, ReadView, SkeletonRecord } from '@ekza-studio/doc';
import type { MeshData, SkinSkeleton, SkinWeights } from '@ekza-studio/mesh-core';
import type { DocSkeletonInput } from '@ekza-studio/rig';
import { worldPlacement } from '../../mesh/context';
import { meshKernel } from '../../mesh/kernel';
import type { EditorApp } from '../../types';

/** Live meshes of a character (`owner: {character}`), by order then id. */
export function characterMeshes(view: ReadView, character: CharacterId): readonly MeshRecord[] {
  return view
    .list('meshes')
    .filter((mesh) => mesh.deleted === null && 'character' in mesh.owner && mesh.owner.character === character)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
}

/** The live skeleton of a character and its live joints (parents first), or null without one. */
export function characterSkeleton(
  view: ReadView,
  character: CharacterId,
): { readonly skeleton: SkeletonRecord; readonly joints: readonly JointRecord[] } | null {
  const skeleton = view.query.skeletonOfCharacter(character);
  if (skeleton === undefined) return null;
  return { skeleton, joints: view.query.jointsOfSkeleton(skeleton.id).filter((joint) => joint.deleted === null) };
}

/** The mesh data of a record (null while its runtime is not ready; the kernel is loaded once one is). */
export function meshData(app: Pick<EditorApp, 'meshes'>, mesh: MeshRecord): MeshData | null {
  const runtime = app.meshes.get(mesh.id);
  return runtime === undefined || runtime.state !== 'ready' ? null : runtime.data();
}

/** C2's input: the skeleton, its live joints and the character's meshes with data, skin and world placement. */
export function docSkeletonInput(
  app: Pick<EditorApp, 'store' | 'meshes'>,
  character: CharacterId,
): DocSkeletonInput | null {
  const found = characterSkeleton(app.store, character);
  if (found === null) return null;
  const meshes: DocSkeletonInput['meshes'][number][] = [];
  for (const mesh of characterMeshes(app.store, character)) {
    const data = meshData(app, mesh);
    if (data === null) continue;
    const skin = meshKernel()?.readSkin(data) ?? null;
    meshes.push({ id: mesh.id, data, skin, placement: mat4Compose(worldPlacement(app.store, mesh)) });
  }
  return { skeleton: found.skeleton, joints: found.joints, meshes };
}

const SIDE_CODE: Readonly<Record<string, number>> = { C: 0, L: 1, R: 2 };

/**
 * The skin skeleton of a mesh's palette context (§4.2 `SkinSkeleton`): every live joint keyed by its id (the palette
 * key), parents first. Tails follow the contract comment: the first child, else `JointRecord.tail`, else 5 % of the
 * height along the parent direction. Only `checkSkin` reads it here (keys, sides, deform flags, mirrors).
 */
export function skinSkeletonOf(joints: readonly JointRecord[]): SkinSkeleton {
  const index = new Map(joints.map((joint, i) => [joint.id as string, i]));
  const count = joints.length;
  const parent = new Int32Array(count).fill(-1);
  const head = new Float64Array(3 * count);
  const tail = new Float64Array(3 * count);
  const mirror = new Int32Array(count).fill(-1);
  const side = new Uint8Array(count);
  const deform = new Uint8Array(count);
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  joints.forEach((joint, i) => {
    parent[i] = joint.parent === null ? -1 : (index.get(joint.parent) ?? -1);
    head.set(joint.restPosition, 3 * i);
    mirror[i] = joint.mirror === null ? -1 : (index.get(joint.mirror) ?? -1);
    side[i] = SIDE_CODE[joint.side] ?? 0;
    deform[i] = joint.role === 'bone' ? 1 : 0;
    minY = Math.min(minY, joint.restPosition[1]);
    maxY = Math.max(maxY, joint.restPosition[1]);
  });
  const height = count === 0 ? 0 : Math.max(maxY - minY, 1e-6);
  joints.forEach((joint, i) => {
    const child = joints.findIndex((other) => other.parent === joint.id);
    if (child >= 0) tail.set(joints[child]?.restPosition ?? joint.restPosition, 3 * i);
    else if (joint.tail !== null) tail.set(joint.tail, 3 * i);
    else {
      const p = parent[i] ?? -1;
      const from = p < 0 ? [0, -1, 0] : [0, 1, 2].map((k) => (head[3 * i + k] ?? 0) - (head[3 * p + k] ?? 0));
      const length = Math.hypot(from[0] ?? 0, from[1] ?? 0, from[2] ?? 0) || 1;
      for (let k = 0; k < 3; k++) tail[3 * i + k] = (head[3 * i + k] ?? 0) + (0.05 * height * (from[k] ?? 0)) / length;
    }
  });
  return {
    keys: joints.map((joint) => joint.id),
    parent,
    head,
    tail,
    mirror,
    side,
    deform,
    humanBone: joints.map((joint) => joint.humanBone),
    height,
  };
}

/** The skin of a bound mesh (null: unbound or not loaded). */
export function skinOf(app: Pick<EditorApp, 'meshes'>, mesh: MeshRecord): SkinWeights | null {
  if (mesh.skin === null) return null;
  const data = meshData(app, mesh);
  return data === null ? null : (meshKernel()?.readSkin(data) ?? null);
}
