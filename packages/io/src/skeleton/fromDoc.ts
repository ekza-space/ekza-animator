// Skeletons from records (M6B-SPEC §4.4, §5.1; C1): `skeletonFromDoc` (joint nodes only, rest locals derived from
// the character-space rest positions and rotations, radii, foot support and height measured from the character's bound
// meshes through `measureSkinned`), `jointsFingerprint` and the re-export of `measureSkinned` (./measure.ts).
//
// The measurement mirrors what skeletonFromGltf measures on the character writer's output (§5.1 equality gate): the
// writer emits one skin listing every joint, so every joint is "skinned" (radius inheritance), the segments follow the
// humanoid chain child else the first child (never `JointRecord.tail`, which glTF cannot carry), and the height is the
// bound meshes' bounds height. The radii are a percentile over vertices, so they depend on how the writer splits points
// into vertices (by normal, UV and material): callers that know the export layout pass it (`opts.vertices`, built by
// io's `characterVertices`) and get the written file's radii exactly; without it the points are measured.
import type { SkinWeights } from '@ekza-studio/mesh-core';
import {
  mat4Compose,
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
import { boneSegmentsOf, footRegionsOf, measureSkinned, NO_NODE } from './measure';
import { JOINT_HEIGHT_FACTOR } from './read';
import { restWorldsOf } from './rest';

export { measureSkinned } from './measure';

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
export function skeletonFromDoc(input: DocSkeletonInput, opts: SkeletonFromDocOptions = {}): SkeletonDesc {
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
  const humanoidMap = humanoidTemplate ? humanoid : null;
  const measured = measureDoc(nodes, ordered, humanoidMap, input.meshes, opts.vertices ?? null);
  const meshHeight = measured?.height ?? null;
  const fromMesh = meshHeight !== null && meshHeight > 0;
  return {
    format: humanoidTemplate ? 'vrm1' : 'gltf',
    facing: IDENTITY_FACING,
    nodes,
    humanoid: humanoidMap,
    springJoints: [],
    nodeConstraints: [],
    constrainedNodes: [],
    boneRadii: measured === null ? nodes.map(() => null) : [...measured.radii],
    height: fromMesh ? meshHeight : jointHeight > 0 ? jointHeight : 1,
    heightSource: fromMesh ? 'mesh' : 'joints',
    fingerprint: jointsFingerprint(nodes),
    ekzaHeightScale: null,
    warnings: [],
    ...(measured === null ? {} : { boneSupport: [...measured.support] }),
    props: ordered.flatMap((joint, i) => (joint.role === 'prop' ? [i] : [])),
    helpers: ordered.flatMap((joint, i) => (joint.role === 'helper' ? [i] : [])),
    jointKeys: ordered.map((joint) => joint.key),
  };
}

type DocMesh = DocSkeletonInput['meshes'][number];

/** The export vertices of a bound mesh (the writer's layout, `characterVertices`): `joints` index its skin palette. */
export interface DocVertices {
  readonly positions: Float32Array;
  readonly joints: Uint8Array | Uint16Array | Uint32Array;
  readonly weights: Float32Array;
}

/** C1 (additive): what skeletonFromDoc measures besides the records. */
export interface SkeletonFromDocOptions {
  /** Per bound mesh (MeshId), its export vertices; a mesh without an entry is measured on its points. With the
   *  writer's layout the radii equal what skeletonFromGltf measures on the written file (the §5.1 gate). */
  readonly vertices?: ReadonlyMap<string, DocVertices> | null;
}

/**
 * Radii, support and bounds height over the bound meshes' export vertices (`vertices`) or points, placed by their
 * `placement`, or null without a bound mesh. Palette keys are JointIds; a key that names no live joint of the skeleton weighs nothing here.
 */
function measureDoc(
  nodes: readonly SkeletonNode[],
  ordered: readonly JointRecord[],
  humanoid: Readonly<Partial<Record<HumanBoneName, number>>> | null,
  meshes: readonly DocMesh[],
  vertices: ReadonlyMap<string, DocVertices> | null,
): {
  readonly radii: readonly (number | null)[];
  readonly support: readonly (Float32Array | null)[];
  readonly height: number | null;
} | null {
  const bound = meshes.filter(
    (mesh): mesh is DocMesh & { readonly skin: SkinWeights } => mesh.skin !== null && mesh.skin.points > 0,
  );
  if (bound.length === 0 || nodes.length === 0) return null;
  const nodeOf = new Map(ordered.map((joint, i) => [joint.id as string, i]));
  const sources = bound.map((mesh) => {
    const given = vertices?.get(mesh.id);
    if (given !== undefined) {
      const count = Math.min(given.positions.length / 3, given.joints.length / 4, given.weights.length / 4);
      return { mesh, count, positions: given.positions, joints: given.joints, weights: given.weights };
    }
    const count = Math.min(mesh.skin.points, mesh.data.counts.points);
    return { mesh, count, positions: mesh.data.position, joints: mesh.skin.joints, weights: mesh.skin.weights };
  });
  let total = 0;
  for (const source of sources) total += source.count;
  const positions = new Float32Array(3 * total);
  const joints = new Uint16Array(4 * total);
  const weights = new Float32Array(4 * total);
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let at = 0;
  for (const source of sources) {
    const { mesh, count } = source;
    const palette = mesh.skin.palette.map((entry) => nodeOf.get(entry.key) ?? NO_NODE);
    placePoints(source.positions, mesh.placement, count, positions, 3 * at);
    for (let i = 0; i < 4 * count; i++) {
      joints[4 * at + i] = palette[source.joints[i] as number] ?? NO_NODE;
      weights[4 * at + i] = source.weights[i] as number;
    }
    for (let v = 0; v < count; v++) {
      const y = positions[3 * (at + v) + 1] as number;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    at += count;
  }
  const worlds = restWorldsOf(nodes, IDENTITY_FACING);
  const nodeWorld = new Float64Array(16 * nodes.length);
  worlds.forEach((world, i) => nodeWorld.set(mat4Compose(world), 16 * i));
  const childrenOf: number[][] = nodes.map(() => []);
  for (const node of nodes) if (node.parent !== -1) childrenOf[node.parent]?.push(node.index);
  // The writer's one skin lists every joint, so every joint is skinned (§5.22).
  const skinned = new Set(nodes.map((node) => node.index));
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
  return { ...measured, height: Number.isFinite(maxY - minY) ? maxY - minY : null };
}

/** Writes `count` points placed by the column-major `placement` (float32, like the writer's POSITION). */
function placePoints(
  p: ArrayLike<number>,
  placement: Float64Array,
  count: number,
  out: Float32Array,
  offset: number,
): void {
  const m = placement;
  const identity =
    m.length < 16 ||
    (m[0] === 1 &&
      m[5] === 1 &&
      m[10] === 1 &&
      m[15] === 1 &&
      m[12] === 0 &&
      m[13] === 0 &&
      m[14] === 0 &&
      m[1] === 0 &&
      m[2] === 0 &&
      m[4] === 0 &&
      m[6] === 0 &&
      m[8] === 0 &&
      m[9] === 0);
  for (let v = 0; v < count; v++) {
    const x = p[3 * v] as number;
    const y = p[3 * v + 1] as number;
    const z = p[3 * v + 2] as number;
    if (identity) {
      out[offset + 3 * v] = x;
      out[offset + 3 * v + 1] = y;
      out[offset + 3 * v + 2] = z;
      continue;
    }
    out[offset + 3 * v] = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
    out[offset + 3 * v + 1] = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
    out[offset + 3 * v + 2] = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
  }
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
