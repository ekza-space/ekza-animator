// Mesh-based measurements for the auto-rig (MVP-SPEC §4.3 SkeletonDesc.boneRadii/height, research 07 §5.4):
// bind-pose vertices are placed with their dominant joint's skinning matrix (rest world · inverse bind matrix) in
// canonical space. A joint's radius is 1.25 × P90 of the distances from its bone segment of the vertices it dominates
// (weight ≥ 0.5). Fallbacks, so every skinned joint of a readable mesh gets a value: vertices it influences with
// weight ≥ 0.1, then the nearest ancestor's radius. Compressed (meshopt/Draco) or unskinned meshes give null radii.
import { mat4Identity, mat4Multiply } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES } from '@ekza-animator/rig';
import type { GltfReader } from '../gltf/accessor';
import { DRACO_EXTENSION, isIndex, isRecord, listField, meshesOf, nodesOf, skinsOf } from '../gltf/schema';
import { boneSupportOf } from './support';

export const RADIUS_P90_FACTOR = 1.25;
const DOMINANT_WEIGHT = 0.5;
const SECONDARY_WEIGHT = 0.1;

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

/** Humanoid child that defines a bone's segment (first present wins). */
const PRIMARY_CHILD: Partial<Record<HumanBoneName, readonly HumanBoneName[]>> = buildPrimaryChildren();

function buildPrimaryChildren(): Partial<Record<HumanBoneName, readonly HumanBoneName[]>> {
  const table: Partial<Record<HumanBoneName, readonly HumanBoneName[]>> = {
    hips: ['spine'],
    spine: ['chest', 'upperChest', 'neck'],
    chest: ['upperChest', 'neck'],
    upperChest: ['neck'],
    neck: ['head'],
  };
  for (const side of ['left', 'right'] as const) {
    const b = (name: string): HumanBoneName => `${side}${name}` as HumanBoneName;
    table[b('UpperLeg')] = [b('LowerLeg')];
    table[b('LowerLeg')] = [b('Foot')];
    table[b('Foot')] = [b('Toes')];
    table[b('Shoulder')] = [b('UpperArm')];
    table[b('UpperArm')] = [b('LowerArm')];
    table[b('LowerArm')] = [b('Hand')];
    table[b('Hand')] = [b('MiddleProximal'), b('IndexProximal'), b('RingProximal'), b('LittleProximal')];
    table[b('ThumbMetacarpal')] = [b('ThumbProximal'), b('ThumbDistal')];
    table[b('ThumbProximal')] = [b('ThumbDistal')];
    for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      table[b(`${finger}Proximal`)] = [b(`${finger}Intermediate`), b(`${finger}Distal`)];
      table[b(`${finger}Intermediate`)] = [b(`${finger}Distal`)];
    }
  }
  return table;
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

  const segments = boneSegments(nodes, worlds, childrenOf, humanoid);
  const dominant = collectDistances(primitives, segments, DOMINANT_WEIGHT, true, null);
  const missing = new Set<number>();
  for (const p of primitives) for (const joint of p.skinJoints) if (!dominant.has(joint)) missing.add(joint);
  const secondary =
    missing.size > 0
      ? collectDistances(primitives, segments, SECONDARY_WEIGHT, false, missing)
      : new Map<number, number[]>();

  const radii: (number | null)[] = nodes.map((_, i) => {
    const distances = dominant.get(i) ?? secondary.get(i);
    return distances === undefined ? null : RADIUS_P90_FACTOR * percentile90(distances);
  });
  // Skinned joints without any influenced vertex inherit the nearest measured ancestor.
  const skinned = new Set<number>();
  for (const p of primitives) for (const joint of p.skinJoints) skinned.add(joint);
  for (let i = 0; i < nodes.length; i++) {
    if (radii[i] !== null || !skinned.has(i)) continue;
    let a = nodes[i]?.parent ?? -1;
    while (a !== -1 && radii[a] === null) a = nodes[a]?.parent ?? -1;
    if (a !== -1) radii[i] = radii[a] ?? null;
  }
  const origins = worlds.map((m): [number, number, number] => [m[12] as number, m[13] as number, m[14] as number]);
  return {
    boneRadii: radii,
    meshHeight: Number.isFinite(maxY - minY) ? maxY - minY : null,
    boneSupport: boneSupportOf(primitives, nodes.length, origins),
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

function dominantSlot(weights: Float32Array, v: number): number {
  let best = 0;
  for (let k = 1; k < 4; k++) if ((weights[v * 4 + k] as number) > (weights[v * 4 + best] as number)) best = k;
  return best;
}

/** Bone segment [start, end] (canonical) per node: start at the joint, end at its primary child (or the joint). */
function boneSegments(
  nodes: readonly MeasureNode[],
  worlds: readonly Float64Array[],
  childrenOf: readonly (readonly number[])[],
  humanoid: Partial<Record<HumanBoneName, number>> | null,
): Float64Array {
  const seg = new Float64Array(nodes.length * 6);
  const boneOf = new Map<number, HumanBoneName>();
  if (humanoid !== null)
    for (const name of HUMAN_BONE_NAMES) if (humanoid[name] !== undefined) boneOf.set(humanoid[name], name);
  nodes.forEach((node, i) => {
    let end = -1;
    const bone = boneOf.get(i);
    if (bone !== undefined && humanoid !== null) {
      for (const child of PRIMARY_CHILD[bone] ?? []) {
        if (humanoid[child] !== undefined) {
          end = humanoid[child];
          break;
        }
      }
    }
    if (end === -1) end = (childrenOf[i] ?? []).find((c) => nodes[c]?.isJoint === true) ?? -1;
    const a = worlds[i] as Float64Array;
    const b = end === -1 ? a : (worlds[end] as Float64Array);
    seg.set(
      [a[12] as number, a[13] as number, a[14] as number, b[12] as number, b[13] as number, b[14] as number],
      i * 6,
    );
  });
  return seg;
}

/** Distances from their joint's segment of the vertices influenced with at least `threshold` weight. */
function collectDistances(
  primitives: readonly SkinnedPrimitive[],
  segments: Float64Array,
  threshold: number,
  dominantOnly: boolean,
  only: ReadonlySet<number> | null,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const p of primitives) {
    const count = p.placed.length / 3;
    for (let v = 0; v < count; v++) {
      const slots = dominantOnly ? [dominantSlot(p.weights, v)] : [0, 1, 2, 3];
      for (const slot of slots) {
        if ((p.weights[v * 4 + slot] as number) < threshold) continue;
        const joint = p.skinJoints[p.joints[v * 4 + slot] as number];
        if (joint === undefined || joint < 0 || (only !== null && !only.has(joint))) continue;
        let list = out.get(joint);
        if (list === undefined) {
          list = [];
          out.set(joint, list);
        }
        list.push(segmentDistance(segments, joint, p.placed, v));
      }
    }
  }
  return out;
}

function segmentDistance(seg: Float64Array, joint: number, placed: Float32Array, v: number): number {
  const o = joint * 6;
  const ax = seg[o] as number;
  const ay = seg[o + 1] as number;
  const az = seg[o + 2] as number;
  const dx = (seg[o + 3] as number) - ax;
  const dy = (seg[o + 4] as number) - ay;
  const dz = (seg[o + 5] as number) - az;
  const px = (placed[v * 3] as number) - ax;
  const py = (placed[v * 3 + 1] as number) - ay;
  const pz = (placed[v * 3 + 2] as number) - az;
  const lenSq = dx * dx + dy * dy + dz * dz;
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / lenSq));
  return Math.hypot(px - t * dx, py - t * dy, pz - t * dz);
}

/** Nearest-rank 90th percentile. */
function percentile90(values: number[]): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.max(0, Math.ceil(0.9 * sorted.length) - 1)] as number;
}
