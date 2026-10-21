// skeletonFromGltf (MVP-SPEC §4.3 SkeletonDesc, §7 WP-4): pure data from glTF JSON and BIN, no three.js.
import {
  mat4Compose,
  mat4Decompose,
  quatNormalize,
  type Quat,
  type ReadonlyQuat,
  type Xf,
  xfIdentity,
} from '@ekza-studio/anim-core';
import { type SkeletonDesc, type SkeletonNode, VRM_REQUIRED_BONES } from '@ekza-studio/rig';
import { GltfReader } from '../gltf/accessor';
import { readEmbeddedAvatarHeightScale } from '../gltf/ekzaMeta';
import { detectModelFormat } from '../gltf/format';
import { type GltfNodeDef, isIndex, listField, nodesOf, numberTuple, skinsOf } from '../gltf/schema';
import { sha256HexSync } from '../hash/sha256';
import type { GlbContainer } from '../types';
import { skeletonNodeOrder } from './order';
import { measureMeshes } from './radii';
import { restWorldsOf } from './rest';
import { readVrmParts } from './vrm';

/** VRM 0.x models face −Z: a π yaw maps them to canonical (+Z) space (§4.11.9). */
export const VRM0_FACING: ReadonlyQuat = [0, 1, 0, 0];
const IDENTITY_FACING: ReadonlyQuat = [0, 0, 0, 1];

/**
 * Ratio of standing height to the height of the highest joint, used when no skinned vertex can be read: the head
 * joint of a humanoid sits at about 0.87 of the body height (and generic skeletons rarely have a joint at the top).
 */
export const JOINT_HEIGHT_FACTOR = 1.15;

export function skeletonFromGltf(c: GlbContainer): SkeletonDesc {
  const json = c.json;
  const format = detectModelFormat(json);
  const facing = format === 'vrm0' ? VRM0_FACING : IDENTITY_FACING;
  const defs = nodesOf(json);
  const order = skeletonNodeOrder(json as unknown as Parameters<typeof skeletonNodeOrder>[0]);
  const indexOfGltf = new Map(order.map((gltfIndex, index) => [gltfIndex, index]));
  const warnings: string[] = [];

  const jointSet = new Set<number>();
  for (const skin of skinsOf(json)) {
    for (const joint of listField(skin.joints)) if (isIndex(joint)) jointSet.add(joint);
  }
  const parentOfGltf = new Map<number, number>();
  defs.forEach((def, i) => {
    for (const child of listField(def.children)) parentOfGltf.set(child, i);
  });

  const nodes: SkeletonNode[] = order.map((gltfIndex, index) => {
    const def = defs[gltfIndex] as GltfNodeDef;
    const name = typeof def.name === 'string' ? def.name : '';
    const parentGltf = parentOfGltf.get(gltfIndex);
    const { restLocal, hasMatrix } = readRestLocal(def, name, warnings);
    const isJoint = jointSet.has(gltfIndex);
    if (isJoint) checkJointScale(restLocal, name, warnings);
    return {
      index,
      gltfIndex,
      name,
      parent: parentGltf === undefined ? -1 : (indexOfGltf.get(parentGltf) as number),
      restLocal,
      hasMatrix,
      isJoint,
      hasMesh: isIndex(def.mesh),
    };
  });
  const childrenOf: number[][] = nodes.map(() => []);
  for (const node of nodes) if (node.parent !== -1) childrenOf[node.parent]?.push(node.index);

  const vrm = readVrmParts(json, format, indexOfGltf, childrenOf);
  warnings.push(...vrm.warnings);
  if (vrm.humanoid !== null) {
    const missing = VRM_REQUIRED_BONES.filter((bone) => vrm.humanoid?.[bone] === undefined);
    if (missing.length > 0) warnings.push(`The VRM humanoid lacks required bones: ${missing.join(', ')}`);
  }

  const worlds = restWorldsOf(nodes, facing);
  const worldMatrices = worlds.map((xf) => mat4Compose(xf));
  const reader = new GltfReader(json, c.bin);
  const measure = measureMeshes(reader, nodes, worldMatrices, indexOfGltf, childrenOf, vrm.humanoid);
  const jointHeight = estimateHeightFromJoints(nodes, worlds);
  const fromMesh = measure.meshHeight !== null && measure.meshHeight > 0;

  return {
    format,
    facing,
    nodes,
    humanoid: vrm.humanoid,
    springJoints: vrm.springJoints,
    nodeConstraints: vrm.nodeConstraints,
    constrainedNodes: vrm.constrainedNodes,
    boneRadii: measure.boneRadii,
    height: fromMesh ? measure.meshHeight : jointHeight,
    heightSource: fromMesh ? 'mesh' : 'joints',
    fingerprint: skeletonFingerprint(nodes),
    ekzaHeightScale: readEmbeddedAvatarHeightScale(json),
    warnings,
    // M2A-SPEC §4.3: absent without mesh data (compressed or unskinned meshes).
    ...(measure.boneSupport === null ? {} : { boneSupport: measure.boneSupport }),
  };
}

function readRestLocal(def: GltfNodeDef, name: string, warnings: string[]): { restLocal: Xf; hasMatrix: boolean } {
  const label = name === '' ? 'An unnamed node' : `Node '${name}'`;
  const matrix = numberTuple(def.matrix, 16);
  if (matrix !== null) {
    const m = Float64Array.from(matrix);
    const xf = mat4Decompose(m);
    const back = mat4Compose(xf);
    const scale = Math.max(1, ...m.map(Math.abs));
    if (back.some((v, i) => Math.abs(v - (m[i] as number)) > 1e-5 * scale)) {
      warnings.push(`${label} uses a matrix with shear or projection; the shear is dropped`);
    }
    return { restLocal: xf, hasMatrix: true };
  }
  const xf = xfIdentity();
  const t = numberTuple(def.translation, 3);
  const q = numberTuple(def.rotation, 4);
  const s = numberTuple(def.scale, 3);
  if (t !== null) xf.t = [t[0] as number, t[1] as number, t[2] as number];
  if (q !== null) {
    const raw: Quat = [q[0] as number, q[1] as number, q[2] as number, q[3] as number];
    const length = Math.hypot(...raw);
    if (Math.abs(length - 1) > 1e-5) warnings.push(`${label} has a non-unit rotation (|q| = ${length}); normalized`);
    xf.q = quatNormalize(raw);
  }
  if (s !== null) xf.s = [s[0] as number, s[1] as number, s[2] as number];
  return { restLocal: xf, hasMatrix: false };
}

function checkJointScale(xf: Xf, name: string, warnings: string[]): void {
  const [x, y, z] = xf.s;
  const max = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (x <= 0 || y <= 0 || z <= 0 || max - Math.min(x, y, z) > 1e-4 * max) {
    warnings.push(`Joint '${name}' has a non-uniform or non-positive rest scale (${x}, ${y}, ${z})`);
  }
}

/** Highest joint above the ground (or the floor below the lowest joint), scaled by JOINT_HEIGHT_FACTOR. */
function estimateHeightFromJoints(nodes: readonly SkeletonNode[], worlds: readonly Xf[]): number {
  const joints = nodes.some((n) => n.isJoint) ? nodes.filter((n) => n.isJoint) : nodes;
  let minY = 0;
  let maxY = 0;
  for (const node of joints) {
    const y = (worlds[node.index] as Xf).t[1];
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const height = (maxY - minY) * JOINT_HEIGHT_FACTOR;
  return height > 0 ? height : 1;
}

/** 'sha256:<hex>' over the sorted lines `name|parentName|t|q|s` with components rounded to 1e-5. */
export function skeletonFingerprint(nodes: readonly SkeletonNode[]): string {
  const round = (x: number): string => (Math.round(x * 1e5) / 1e5).toFixed(5);
  const lines = nodes
    .map((node) => {
      const parent = node.parent === -1 ? '' : (nodes[node.parent]?.name ?? '');
      const { t, q, s } = node.restLocal;
      return [node.name, parent, ...t.map(round), ...q.map(round), ...s.map(round)].join('|');
    })
    .sort();
  return `sha256:${sha256HexSync(new TextEncoder().encode(lines.join('\n')))}`;
}
