// `measureSkinned` (M6B-SPEC §4.4, §5.1; C1): the typed-array core of the mesh measurements of a skeleton — bone radii
// (1.25 × P90 of the distances of a joint's dominated vertices from its bone segment, research 07 §5.4) and the M2a
// foot support (`SkeletonDesc.boneSupport`, M2A-SPEC §5.2.3). Imports (`measureMeshes`, skeletonFromGltf) and own
// models (`skeletonFromDoc`) both measure through it, so the two agree on the same vertices.
//
// Rules (unchanged from M2a's measureMeshes, which now delegates here and keeps its outputs byte for byte):
// - a vertex belongs to the joint of its largest weight (the first of equal weights); with that weight ≥ 0.5 its
//   distance from the joint's segment counts for the joint's radius;
// - a skinned joint without such a vertex measures the vertices it influences with weight ≥ 0.1;
// - a skinned joint with neither inherits the nearest measured ancestor's radius;
// - a joint's segment runs from its rest position to its primary child's (the humanoid chain child, else the first
//   joint child), else to its explicit tail, else it is the point itself.
import type { HumanBoneName } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES } from '@ekza-studio/rig';
import { boneSupportOf, type FootRegion } from './support';

export const RADIUS_P90_FACTOR = 1.25;
const DOMINANT_WEIGHT = 0.5;
const SECONDARY_WEIGHT = 0.1;
/** `joints` value of a slot whose joint is not a node of the skeleton. */
export const NO_NODE = 0xffff;

/** One node's bone segment: to `child`'s rest position, else to `tail`, else the rest position itself. */
export interface BoneSegment {
  readonly node: number;
  readonly child: number | null;
  readonly tail: readonly number[] | null;
}

export interface MeasureSkinnedInput {
  readonly positions: Float32Array | Float64Array; // 3V bind-pose positions, character space
  readonly joints: Uint16Array; // 4V node indices (after palette mapping); NO_NODE = not a node
  readonly weights: Float32Array; // 4V
  readonly nodeWorld: Float64Array; // 16 × nodes rest worlds
  readonly segments: readonly BoneSegment[];
  /** C1 (additive): parent node per node (−1 root), for the ancestor fallback; absent = no inheritance. */
  readonly parents?: Int32Array;
  /** C1 (additive): the nodes of the skins (they get a radius by inheritance); absent = every node a vertex names. */
  readonly skinned?: ReadonlySet<number>;
  /** C1 (additive): humanoid lower leg → foot pairs (vertices of the lower leg below the foot count for the foot). */
  readonly feet?: readonly FootRegion[];
}

export interface MeasureSkinnedResult {
  readonly radii: readonly (number | null)[];
  readonly support: readonly (Float32Array | null)[];
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
 * The bone segment of every node: the humanoid chain child (PRIMARY_CHILD, first mapped), else the first joint child,
 * else none (`child` null, `tail` null: the segment is the point).
 */
export function boneSegmentsOf(
  nodes: readonly { readonly isJoint: boolean }[],
  childrenOf: readonly (readonly number[])[],
  humanoid: Readonly<Partial<Record<HumanBoneName, number>>> | null,
): BoneSegment[] {
  const boneOf = new Map<number, HumanBoneName>();
  if (humanoid !== null) {
    for (const name of HUMAN_BONE_NAMES) {
      const node = humanoid[name];
      if (node !== undefined) boneOf.set(node, name);
    }
  }
  return nodes.map((_, i): BoneSegment => {
    let end = -1;
    const bone = boneOf.get(i);
    if (bone !== undefined && humanoid !== null) {
      for (const child of PRIMARY_CHILD[bone] ?? []) {
        const node = humanoid[child];
        if (node !== undefined) {
          end = node;
          break;
        }
      }
    }
    if (end === -1) end = (childrenOf[i] ?? []).find((c) => nodes[c]?.isJoint === true) ?? -1;
    return { node: i, child: end === -1 ? null : end, tail: null };
  });
}

/** Humanoid lower leg → foot regions of a humanoid map (left, then right). */
export function footRegionsOf(humanoid: Readonly<Partial<Record<HumanBoneName, number>>> | null): FootRegion[] {
  const feet: FootRegion[] = [];
  for (const side of ['left', 'right'] as const) {
    const lowerLeg = humanoid?.[`${side}LowerLeg`];
    const foot = humanoid?.[`${side}Foot`];
    if (lowerLeg !== undefined && foot !== undefined) feet.push({ lowerLeg, foot });
  }
  return feet;
}

/** Typed-array core of measureMeshes (MVP-SPEC §4.11.15): radii and the M2a foot support, in character space. */
export function measureSkinned(input: MeasureSkinnedInput): MeasureSkinnedResult {
  const nodeCount = Math.floor(input.nodeWorld.length / 16);
  const { positions, joints, weights } = input;
  const count = Math.min(
    Math.floor(positions.length / 3),
    Math.floor(joints.length / 4),
    Math.floor(weights.length / 4),
  );
  const seg = segmentArray(input.segments, input.nodeWorld, nodeCount);

  const dominant = new Map<number, number[]>();
  for (let v = 0; v < count; v++) {
    const slot = dominantSlot(weights, v);
    if ((weights[v * 4 + slot] as number) < DOMINANT_WEIGHT) continue;
    const node = joints[v * 4 + slot] as number;
    if (node >= nodeCount) continue;
    push(dominant, node, segmentDistance(seg, node, positions, v));
  }
  const skinned = input.skinned ?? referencedNodes(joints, weights, count, nodeCount);
  const missing = new Set<number>();
  for (const node of skinned) if (!dominant.has(node)) missing.add(node);
  const secondary = new Map<number, number[]>();
  if (missing.size > 0) {
    for (let v = 0; v < count; v++) {
      for (let slot = 0; slot < 4; slot++) {
        if ((weights[v * 4 + slot] as number) < SECONDARY_WEIGHT) continue;
        const node = joints[v * 4 + slot] as number;
        if (node >= nodeCount || !missing.has(node)) continue;
        push(secondary, node, segmentDistance(seg, node, positions, v));
      }
    }
  }
  const radii: (number | null)[] = Array.from({ length: nodeCount }, (_, i) => {
    const distances = dominant.get(i) ?? secondary.get(i);
    return distances === undefined ? null : RADIUS_P90_FACTOR * percentile90(distances);
  });
  // Skinned joints without any influenced vertex inherit the nearest measured ancestor.
  const parents = input.parents;
  if (parents !== undefined) {
    for (let i = 0; i < nodeCount; i++) {
      if (radii[i] !== null || !skinned.has(i)) continue;
      let a = parents[i] ?? -1;
      while (a !== -1 && radii[a] === null) a = parents[a] ?? -1;
      if (a !== -1) radii[i] = radii[a] ?? null;
    }
  }

  const origins = Array.from({ length: nodeCount }, (_, i): [number, number, number] => [
    input.nodeWorld[i * 16 + 12] as number,
    input.nodeWorld[i * 16 + 13] as number,
    input.nodeWorld[i * 16 + 14] as number,
  ]);
  const placed = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  const identity = Array.from({ length: nodeCount }, (_, i) => i);
  const support = boneSupportOf(
    [{ joints, weights, skinJoints: identity, placed: placed.subarray(0, 3 * count) }],
    nodeCount,
    origins,
    input.feet ?? [],
  );
  return { radii, support };
}

function push(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** Nodes any vertex weights (> 0) in any slot. */
function referencedNodes(joints: Uint16Array, weights: Float32Array, count: number, nodeCount: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < 4 * count; i++) {
    const node = joints[i] as number;
    if ((weights[i] as number) > 0 && node < nodeCount) out.add(node);
  }
  return out;
}

/** Segment [start, end] per node (6 values), start at the node's rest position. */
function segmentArray(segments: readonly BoneSegment[], world: Float64Array, nodeCount: number): Float64Array {
  const seg = new Float64Array(nodeCount * 6);
  for (let i = 0; i < nodeCount; i++) {
    const a = i * 16;
    seg.set([world[a + 12] as number, world[a + 13] as number, world[a + 14] as number], i * 6);
    seg.set([world[a + 12] as number, world[a + 13] as number, world[a + 14] as number], i * 6 + 3);
  }
  for (const segment of segments) {
    const i = segment.node;
    if (!(i >= 0 && i < nodeCount)) continue;
    if (segment.child !== null && segment.child >= 0 && segment.child < nodeCount) {
      const b = segment.child * 16;
      seg.set([world[b + 12] as number, world[b + 13] as number, world[b + 14] as number], i * 6 + 3);
    } else if (segment.tail !== null) {
      seg.set([segment.tail[0] ?? 0, segment.tail[1] ?? 0, segment.tail[2] ?? 0], i * 6 + 3);
    }
  }
  return seg;
}

export function dominantSlot(weights: ArrayLike<number>, v: number): number {
  let best = 0;
  for (let k = 1; k < 4; k++) if ((weights[v * 4 + k] as number) > (weights[v * 4 + best] as number)) best = k;
  return best;
}

function segmentDistance(seg: Float64Array, joint: number, placed: ArrayLike<number>, v: number): number {
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
