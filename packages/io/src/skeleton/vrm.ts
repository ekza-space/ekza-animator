// VRM-specific parts of skeletonFromGltf: the humanoid map (VRM 1.0 object form, VRM 0.x array form with thumb
// aliases), spring-bone joints (VRMC_springBone joints; VRM 0.x secondaryAnimation chains = each listed root and all
// of its descendants, as three-vrm imports them) and VRMC_node_constraint entries. Inputs are glTF node indices;
// outputs are SkeletonDesc node indices.
import type { HumanBoneName, ModelFormat } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES, type NodeConstraintDesc, VRM0_BONE_ALIASES } from '@ekza-studio/rig';
import type { GltfJson } from '../types';
import { isIndex, isRecord, type JsonRecord, nodesOf, rootExtensions, unknownList } from '../gltf/schema';

const HUMAN_BONES = new Set<string>(HUMAN_BONE_NAMES);

export interface VrmSkeletonParts {
  readonly humanoid: Partial<Record<HumanBoneName, number>> | null;
  readonly springJoints: number[];
  readonly nodeConstraints: NodeConstraintDesc[];
  readonly constrainedNodes: number[];
  readonly warnings: string[];
}

/**
 * @param indexOfGltf glTF node index → SkeletonDesc index
 * @param childrenOf SkeletonDesc index → child SkeletonDesc indices
 */
export function readVrmParts(
  json: GltfJson,
  format: ModelFormat,
  indexOfGltf: ReadonlyMap<number, number>,
  childrenOf: readonly (readonly number[])[],
): VrmSkeletonParts {
  const warnings: string[] = [];
  const extensions = rootExtensions(json);
  if (format === 'gltf') {
    return { humanoid: null, springJoints: [], nodeConstraints: [], constrainedNodes: [], warnings };
  }
  const humanoid: Partial<Record<HumanBoneName, number>> = {};
  const used = new Map<number, HumanBoneName>();
  const assign = (rawName: string, gltfNode: unknown): void => {
    const name = (format === 'vrm0' ? (VRM0_BONE_ALIASES[rawName] ?? rawName) : rawName) as HumanBoneName;
    if (!HUMAN_BONES.has(name)) {
      warnings.push(`Unknown VRM humanoid bone '${rawName}' was ignored`);
      return;
    }
    const node = isIndex(gltfNode) ? indexOfGltf.get(gltfNode) : undefined;
    if (node === undefined) {
      warnings.push(`Humanoid bone '${name}' references a missing node`);
      return;
    }
    if (humanoid[name] !== undefined) {
      warnings.push(`Humanoid bone '${name}' is mapped more than once; the first mapping is used`);
      return;
    }
    const other = used.get(node);
    if (other !== undefined) {
      warnings.push(`Humanoid bones '${other}' and '${name}' map to the same node; '${name}' was ignored`);
      return;
    }
    humanoid[name] = node;
    used.set(node, name);
  };

  if (format === 'vrm1') {
    const vrm = extensions['VRMC_vrm'] as JsonRecord;
    const bones = isRecord(vrm['humanoid']) ? vrm['humanoid']['humanBones'] : undefined;
    for (const [name, bone] of Object.entries(isRecord(bones) ? bones : {})) {
      assign(name, isRecord(bone) ? bone['node'] : undefined);
    }
  } else {
    const vrm = extensions['VRM'] as JsonRecord;
    const bones = isRecord(vrm['humanoid']) ? vrm['humanoid']['humanBones'] : undefined;
    for (const bone of unknownList(bones)) {
      if (isRecord(bone) && typeof bone['bone'] === 'string') assign(bone['bone'], bone['node']);
    }
  }

  const springJoints = new Set<number>();
  if (format === 'vrm1') {
    const spring = extensions['VRMC_springBone'];
    const springs = isRecord(spring) ? spring['springs'] : undefined;
    for (const chain of unknownList(springs)) {
      const joints = isRecord(chain) ? chain['joints'] : undefined;
      for (const joint of unknownList(joints)) {
        const node = isRecord(joint) && isIndex(joint['node']) ? indexOfGltf.get(joint['node']) : undefined;
        if (node !== undefined) springJoints.add(node);
      }
    }
  } else {
    const secondary = (extensions['VRM'] as JsonRecord)['secondaryAnimation'];
    const groups = isRecord(secondary) ? secondary['boneGroups'] : undefined;
    for (const group of unknownList(groups)) {
      const roots = isRecord(group) ? group['bones'] : undefined;
      for (const root of unknownList(roots)) {
        const start = isIndex(root) ? indexOfGltf.get(root) : undefined;
        if (start === undefined) continue;
        const stack = [start];
        while (stack.length > 0) {
          const n = stack.pop() as number;
          if (springJoints.has(n)) continue;
          springJoints.add(n);
          stack.push(...(childrenOf[n] ?? []));
        }
      }
    }
  }

  const nodeConstraints: NodeConstraintDesc[] = [];
  if (format === 'vrm1') {
    nodesOf(json).forEach((def, gltfIndex) => {
      const ext = isRecord(def.extensions) ? def.extensions['VRMC_node_constraint'] : undefined;
      const constraint = isRecord(ext) ? ext['constraint'] : undefined;
      if (!isRecord(constraint)) return;
      const destination = indexOfGltf.get(gltfIndex);
      for (const type of ['roll', 'aim', 'rotation'] as const) {
        const entry = constraint[type];
        if (!isRecord(entry)) continue;
        const source = isIndex(entry['source']) ? indexOfGltf.get(entry['source']) : undefined;
        if (source === undefined || destination === undefined) {
          warnings.push(`VRMC_node_constraint on node ${gltfIndex} references a missing source node`);
          continue;
        }
        const weight = typeof entry['weight'] === 'number' && Number.isFinite(entry['weight']) ? entry['weight'] : 1;
        nodeConstraints.push({ type, source, destination, weight });
      }
    });
  }
  nodeConstraints.sort((a, b) => a.destination - b.destination || a.source - b.source);
  const constrainedNodes = [...new Set(nodeConstraints.map((c) => c.destination))].sort((a, b) => a - b);
  return {
    humanoid,
    springJoints: [...springJoints].sort((a, b) => a - b),
    nodeConstraints,
    constrainedNodes,
    warnings,
  };
}
