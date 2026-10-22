// Mesh-based measurements for the auto-rig (MVP-SPEC §4.3 SkeletonDesc.boneRadii/height, research 07 §5.4):
// bind-pose vertices are placed with their dominant joint's skinning matrix (rest world · inverse bind matrix) in
// canonical space. A joint's radius is 1.25 × P90 of the distances from its bone segment of the vertices it dominates
// (weight ≥ 0.5). Fallbacks, so every skinned joint of a readable mesh gets a value: vertices it influences with
// weight ≥ 0.1, then the nearest ancestor's radius. Compressed (meshopt/Draco) or unskinned meshes give null radii.
import { mat4Identity, mat4Multiply } from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import type { GltfReader } from '../gltf/accessor';
import { DRACO_EXTENSION, isIndex, isRecord, listField, meshesOf, nodesOf, skinsOf } from '../gltf/schema';
import { boneSegmentsOf, dominantSlot, footRegionsOf, measureSkinned, NO_NODE } from './measure';

export { RADIUS_P90_FACTOR } from './measure';

export interface MeshMeasure {
  readonly boneRadii: (number | null)[];
  /** Skinned bind-pose bounds height (canonical Y), or null when no skinned vertex could be read. */
  readonly meshHeight: number | null;
  /** M2a: per-node horizontal support function (`SkeletonDesc.boneSupport`); null without readable skinned meshes. */
  readonly boneSupport: (Float32Array | null)[] | null;
}

interface MeasureNode {
  readonly gltfIndex: number;
  readonly parent: number;
  readonly isJoint: boolean;
  readonly hasMesh: boolean;
}

interface SkinnedPrimitive {
  readonly positions: Float32Array;
  readonly joints: Uint32Array;
  readonly weights: Float32Array;
  readonly skinJoints: readonly number[];
  /** Canonical bind-pose position of every vertex (dominant joint placement). */
  readonly placed: Float32Array;
}

/**
 * @param nodes SkeletonDesc-ordered nodes
 * @param worlds canonical rest world matrices by SkeletonDesc index
 * @param indexOfGltf glTF node index → SkeletonDesc index
 * @param humanoid humanoid map (SkeletonDesc indices) or null
 */
export function measureMeshes(
  reader: GltfReader,
  nodes: readonly MeasureNode[],
  worlds: readonly Float64Array[],
  indexOfGltf: ReadonlyMap<number, number>,
  childrenOf: readonly (readonly number[])[],
  humanoid: Partial<Record<HumanBoneName, number>> | null,
): MeshMeasure {
  const unknown: MeshMeasure = { boneRadii: nodes.map(() => null), meshHeight: null, boneSupport: null };
  const primitives = readSkinnedPrimitives(reader, nodes, worlds, indexOfGltf);
  if (primitives === null || primitives.length === 0) return unknown;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of primitives) {
    for (let i = 1; i < p.placed.length; i += 3) {
      const y = p.placed[i] as number;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // M6b (C1): the radii and the support are measureSkinned's (one core for imports and own models; outputs unchanged).
  let total = 0;
  for (const p of primitives) total += p.placed.length / 3;
  const positions = new Float32Array(3 * total);
  const joints = new Uint16Array(4 * total);
  const weights = new Float32Array(4 * total);
  const skinned = new Set<number>();
  let at = 0;
  for (const p of primitives) {
    const count = p.placed.length / 3;
    positions.set(p.placed, 3 * at);
    for (let i = 0; i < 4 * count; i++) {
      const node = p.skinJoints[p.joints[i] as number];
      joints[4 * at + i] = node === undefined || node < 0 ? NO_NODE : node;
      weights[4 * at + i] = p.weights[i] as number;
    }
    for (const joint of p.skinJoints) if (joint >= 0) skinned.add(joint);
    at += count;
  }
  const nodeWorld = new Float64Array(16 * nodes.length);
  worlds.forEach((world, i) => nodeWorld.set(world, 16 * i));
  const measured = measureSkinned({
    positions,
    joints,
    weights,
    nodeWorld,
    segments: boneSegmentsOf(nodes, childrenOf, humanoid),
    parents: Int32Array.from(nodes, (node) => node.parent),
    skinned,
    feet: footRegionsOf(humanoid),
  });
  return {
    boneRadii: [...measured.radii],
    meshHeight: Number.isFinite(maxY - minY) ? maxY - minY : null,
    boneSupport: [...measured.support],
  };
}

/** Skinned primitives with their placed vertices; null when any of them is compressed (unreadable here). */
function readSkinnedPrimitives(
  reader: GltfReader,
  nodes: readonly MeasureNode[],
  worlds: readonly Float64Array[],
  indexOfGltf: ReadonlyMap<number, number>,
): SkinnedPrimitive[] | null {
  const json = reader.json;
  const nodeDefs = nodesOf(json);
  const meshes = meshesOf(json);
  const skins = skinsOf(json);
  const out: SkinnedPrimitive[] = [];
  for (const node of nodes) {
    if (!node.hasMesh) continue;
    const def = nodeDefs[node.gltfIndex];
    const mesh = def !== undefined && isIndex(def.mesh) ? meshes[def.mesh] : undefined;
    const skin = def !== undefined && isIndex(def.skin) ? skins[def.skin] : undefined;
    if (mesh === undefined || skin === undefined || !Array.isArray(skin.joints)) continue;
    const skinJoints = skin.joints.map((j) => (isIndex(j) ? (indexOfGltf.get(j) ?? -1) : -1));
    if (isIndex(skin.inverseBindMatrices) && reader.isCompressed(skin.inverseBindMatrices)) return null;
    const ibm = isIndex(skin.inverseBindMatrices) ? reader.readFloat(skin.inverseBindMatrices) : null;
    const jointMatrices = skinJoints.map((joint, k) => {
      const world = joint >= 0 ? worlds[joint] : undefined;
      if (world === undefined) return null;
      if (ibm === null || ibm.length < (k + 1) * 16) return world;
      return mat4Multiply(world, Float64Array.from(ibm.subarray(k * 16, k * 16 + 16)));
    });
    for (const primitive of listField(mesh.primitives)) {
      if (isRecord(primitive.extensions) && isRecord(primitive.extensions[DRACO_EXTENSION])) return null;
      const attributes = isRecord(primitive.attributes) ? primitive.attributes : {};
      const position = attributes['POSITION'];
      const joints0 = attributes['JOINTS_0'];
      const weights0 = attributes['WEIGHTS_0'];
      if (!isIndex(position) || !isIndex(joints0) || !isIndex(weights0)) continue;
      if ([position, joints0, weights0].some((a) => reader.isCompressed(a))) return null;
      const positions = reader.readFloat(position);
      const joints = reader.readUint(joints0);
      const weights = reader.readFloat(weights0);
      const count = Math.min(positions.length / 3, joints.length / 4, weights.length / 4);
      const placed = new Float32Array(count * 3);
      const identity = mat4Identity();
      for (let v = 0; v < count; v++) {
        const slot = dominantSlot(weights, v);
        const m = jointMatrices[joints[v * 4 + slot] as number] ?? identity;
        const x = positions[v * 3] as number;
        const y = positions[v * 3 + 1] as number;
        const z = positions[v * 3 + 2] as number;
        placed[v * 3] = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
        placed[v * 3 + 1] = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
        placed[v * 3 + 2] = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
      }
      out.push({ positions, joints, weights, skinJoints, placed });
    }
  }
  return out;
}
