// Skeletons from records (M6B-SPEC §4.4, §5.1; C1). C0 working baselines: `skeletonFromDoc` for a skeleton without
// skinned meshes (rest data only: radii null, joint-based height, no support) and `jointsFingerprint`; `measureSkinned`
// is a stub. C1 adds the measurement from the character's meshes (radii, support, mesh height) with `measureSkinned`.
import {
  EkzaError,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  type ReadonlyQuat,
  type ReadonlyVec3,
  type Xf,
} from '@ekza-studio/anim-core';
import type { HumanBoneName, JointRecord } from '@ekza-studio/doc';
import type { DocSkeletonInput, SkeletonDesc, SkeletonNode } from '@ekza-studio/rig';
import { sha256HexSync } from '../hash/sha256';
import { JOINT_HEIGHT_FACTOR } from './read';

const IDENTITY_FACING: ReadonlyQuat = [0, 0, 0, 1];
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Live joints in topological order: parents first, siblings by `order` then id; a missing parent makes a root. */
function topological(joints: readonly JointRecord[]): JointRecord[] {
  const byId = new Map(joints.map((joint) => [joint.id as string, joint]));
  const children = new Map<string | null, JointRecord[]>();
  for (const joint of joints) {
    const parent = joint.parent !== null && byId.has(joint.parent) && joint.parent !== joint.id ? joint.parent : null;
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [joint]);
    else list.push(joint);
  }
  for (const list of children.values()) list.sort((a, b) => compare(a.order, b.order) || compare(a.id, b.id));
  const out: JointRecord[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null): void => {
    for (const joint of children.get(parent) ?? []) {
      if (seen.has(joint.id)) continue;
      seen.add(joint.id);
      out.push(joint);
      visit(joint.id);
    }
  };
  visit(null);
  // Joints on a parent cycle never reach a root: append them as roots in id order (repaired content stays readable).
  for (const joint of [...joints].sort((a, b) => compare(a.id, b.id))) {
    if (!seen.has(joint.id)) {
      seen.add(joint.id);
      out.push(joint);
      visit(joint.id);
    }
  }
  return out;
}

/** The rest local of a joint from its character-space rest position and rotation and its parent's. */
function restLocal(joint: JointRecord, parent: JointRecord | undefined): Xf {
  const q = quatNormalize(joint.restRotation);
  if (parent === undefined) return { t: [...joint.restPosition] as Xf['t'], q, s: [1, 1, 1] };
  const parentInverse = quatInvert(quatNormalize(parent.restRotation));
  const delta: ReadonlyVec3 = [
    joint.restPosition[0] - parent.restPosition[0],
    joint.restPosition[1] - parent.restPosition[1],
    joint.restPosition[2] - parent.restPosition[2],
  ];
  return { t: quatRotateVec3(parentInverse, delta), q: quatMultiply(parentInverse, q), s: [1, 1, 1] };
}

/** Joint nodes only (`isJoint` true, `hasMesh` false); equal on its joint subset to what skeletonFromGltf gives for
 *  the writer's output of these records (§5.1, gate §10.2); `fingerprint` = `jointsFingerprint`. In `io` because it
 *  needs `measureSkinned` and io's SHA-256 (`io → rig`, never the reverse). */
export function skeletonFromDoc(input: DocSkeletonInput): SkeletonDesc {
  const live = input.joints.filter((joint) => joint.deleted === null && joint.skeleton === input.skeleton.id);
  const ordered = topological(live);
  const index = new Map(ordered.map((joint, i) => [joint.id as string, i]));
  const byId = new Map(ordered.map((joint) => [joint.id as string, joint]));
  const nodes: SkeletonNode[] = ordered.map((joint, i) => {
    const parent = joint.parent === null ? undefined : byId.get(joint.parent);
    return {
      index: i,
      gltfIndex: i,
      name: joint.name,
      parent: parent === undefined ? -1 : (index.get(parent.id) as number),
      restLocal: restLocal(joint, parent),
      hasMatrix: false,
      isJoint: true,
      hasMesh: false,
    };
  });
  const humanoid: Partial<Record<HumanBoneName, number>> = {};
  for (const [i, joint] of ordered.entries()) {
    if (joint.humanBone !== null && humanoid[joint.humanBone] === undefined) humanoid[joint.humanBone] = i;
  }
  let minY = 0;
  let maxY = 0;
  for (const joint of ordered) {
    minY = Math.min(minY, joint.restPosition[1]);
    maxY = Math.max(maxY, joint.restPosition[1]);
  }
  const jointHeight = (maxY - minY) * JOINT_HEIGHT_FACTOR;
  const humanoidTemplate = input.skeleton.template === 'vrm-humanoid';
  return {
    format: humanoidTemplate ? 'vrm1' : 'gltf',
    facing: IDENTITY_FACING,
    nodes,
    humanoid: humanoidTemplate ? humanoid : null,
    springJoints: [],
    nodeConstraints: [],
    constrainedNodes: [],
    boneRadii: nodes.map(() => null),
    height: jointHeight > 0 ? jointHeight : 1,
    heightSource: 'joints',
    fingerprint: jointsFingerprint(nodes),
    ekzaHeightScale: null,
    warnings: [],
    props: ordered.flatMap((joint, i) => (joint.role === 'prop' ? [i] : [])),
    helpers: ordered.flatMap((joint, i) => (joint.role === 'helper' ? [i] : [])),
    jointKeys: ordered.map((joint) => joint.key),
  };
}

/** skeletonFingerprint's lines (name | parentName | t | q | s, rounded to 1e-5, sorted) over the **joint** nodes only
 *  (`isJoint`), parent names resolved over the full node list. Mesh nodes, their order and their names never change
 *  it. skeletonFromDoc's `fingerprint` and the writer read-back (§5.22) use it; skeletonFromGltf is unchanged. */
export function jointsFingerprint(nodes: readonly SkeletonNode[]): string {
  const round = (x: number): string => (Math.round(x * 1e5) / 1e5).toFixed(5);
  const lines = nodes
    .filter((node) => node.isJoint)
    .map((node) => {
      const parent = node.parent === -1 ? '' : (nodes[node.parent]?.name ?? '');
      const { t, q, s } = node.restLocal;
      return [node.name, parent, ...t.map(round), ...q.map(round), ...s.map(round)].join('|');
    })
    .sort();
  return `sha256:${sha256HexSync(new TextEncoder().encode(lines.join('\n')))}`;
}

/** Typed-array core of measureMeshes (MVP-SPEC §4.11.15): radii (1.25 × P90 of dominated points' distance to the
 *  bone segment) and the M2a foot support, in character space. measureMeshes delegates to it; outputs unchanged. */
export function measureSkinned(_input: {
  readonly positions: Float32Array | Float64Array; // 3V bind-pose positions, character space
  readonly joints: Uint16Array; // 4V node indices (after palette mapping)
  readonly weights: Float32Array; // 4V
  readonly nodeWorld: Float64Array; // 16 × nodes rest worlds
  readonly segments: readonly {
    readonly node: number;
    readonly child: number | null;
    readonly tail: readonly number[] | null;
  }[];
}): { readonly radii: readonly (number | null)[]; readonly support: readonly (Float32Array | null)[] } {
  throw new EkzaError('not-implemented', 'io.measureSkinned');
}
