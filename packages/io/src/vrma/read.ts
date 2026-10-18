// readVrma (MVP-SPEC §4.11.7): reads a VRM Animation the way @pixiv/three-vrm-animation 3.5.5 does
// (`VRMAnimationLoaderPlugin`), so a file means the same in both. Rest worlds come from the VRMA's own node
// hierarchy, including non-humanoid intermediate nodes (matrices, so non-uniform scale behaves like three.js):
//   N_b(t) = q(W⁰_hp) · q_file(t) · q(W⁰_b)⁻¹      hp = nearest mapped humanoid ancestor (hips: the hips node's parent)
//   p(t)   = W⁰_parent(hips) · t_file(t)            restHipsPosition = W⁰_hips.t
// CUBICSPLINE tangents are transformed with the same linear maps. The first animation is read; eye channels,
// expressions, lookAt, non-hips translation and scale channels are ignored with a warning.
import {
  EkzaError,
  mat4Compose,
  mat4Decompose,
  mat4Identity,
  mat4Multiply,
  quatInvert,
  quatMultiply,
  quatNormalize,
  type Quat,
  type ReadonlyQuat,
} from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT, type HumanoidClipData } from '@ekza-animator/rig';
import { GltfReader } from '../gltf/accessor';
import {
  animationsOf,
  extensionsUsed,
  type GltfNodeDef,
  isIndex,
  isRecord,
  type JsonRecord,
  listField,
  nodesOf,
  numberTuple,
  rootExtensions,
} from '../gltf/schema';
import type { GlbContainer } from '../types';

export const VRMA_EXTENSION = 'VRMC_vrm_animation';
const SPEC_VERSIONS = new Set(['1.0', '1.0-draft']);
const HUMAN_BONES = new Set<string>(HUMAN_BONE_NAMES);
const EYES = new Set<HumanBoneName>(['leftEye', 'rightEye']);

type Interpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';
type Track = { readonly times: Float32Array; readonly values: Float32Array };

export interface VrmaReadResult {
  readonly data: HumanoidClipData;
  /** Ignored content and spec deviations (shown in the import summary). */
  readonly warnings: readonly string[];
}

export function readVrma(c: GlbContainer): HumanoidClipData {
  return inspectVrma(c).data;
}

/** `readVrma` plus the warnings the import summary shows. Throws EkzaError('unsupported') for non-VRMA files. */
export function inspectVrma(c: GlbContainer): VrmaReadResult {
  const json = c.json;
  const ext = rootExtensions(json)[VRMA_EXTENSION];
  if (!extensionsUsed(json).includes(VRMA_EXTENSION) || !isRecord(ext)) {
    throw new EkzaError('unsupported', 'The file is not a VRM Animation (no VRMC_vrm_animation extension)');
  }
  const warnings: string[] = [];
  const specVersion = ext['specVersion'];
  if (specVersion === undefined) {
    warnings.push('The VRMA has no specVersion; read as 1.0');
  } else if (typeof specVersion !== 'string' || !SPEC_VERSIONS.has(specVersion)) {
    throw new EkzaError('unsupported', `Unknown VRMC_vrm_animation specVersion ${JSON.stringify(specVersion)}`);
  } else if (specVersion === '1.0-draft') {
    warnings.push('The VRMA uses the draft spec version 1.0-draft');
  }

  const defs = nodesOf(json);
  const parentOf = new Map<number, number>();
  defs.forEach((def, i) => {
    for (const child of listField(def.children)) parentOf.set(child, i);
  });
  const worlds = nodeWorlds(defs, parentOf);

  const bones = new Map<HumanBoneName, number>();
  const boneOfNode = new Map<number, HumanBoneName>();
  const humanBones = isRecord(ext['humanoid']) ? ext['humanoid']['humanBones'] : undefined;
  for (const [name, bone] of Object.entries(isRecord(humanBones) ? humanBones : {})) {
    const node = isRecord(bone) ? bone['node'] : undefined;
    if (!HUMAN_BONES.has(name)) {
      warnings.push(`Unknown humanoid bone '${name}' was ignored`);
      continue;
    }
    if (!isIndex(node) || node >= defs.length) {
      warnings.push(`Humanoid bone '${name}' references a missing node`);
      continue;
    }
    bones.set(name as HumanBoneName, node);
    boneOfNode.set(node, name as HumanBoneName);
  }
  const hipsNode = bones.get('hips');
  if (hipsNode === undefined) throw new EkzaError('malformed-gltf', 'The VRMA humanoid has no hips bone');
  const hipsWorld = worlds[hipsNode] as Float64Array;
  const restHipsPosition: [number, number, number] = [
    hipsWorld[12] as number,
    hipsWorld[13] as number,
    hipsWorld[14] as number,
  ];
  if (restHipsPosition[1] < 1e-3) warnings.push('The rest hips height is about zero or below (VRM T-pose violated)');
  const hipsParent = parentOf.get(hipsNode);
  const hipsParentWorld = hipsParent === undefined ? mat4Identity() : (worlds[hipsParent] as Float64Array);
  const expressionNodes = expressionAndLookAtNodes(ext);

  const animations = animationsOf(json);
  if (animations.length === 0) throw new EkzaError('malformed-gltf', 'The VRMA has no animation');
  if (animations.length > 1) warnings.push(`The VRMA has ${animations.length} animations; only the first is read`);
  const animation = animations[0] as (typeof animations)[number];
  const reader = new GltfReader(json, c.bin);
  const samplers = listField(animation.samplers);
  const rotations: Partial<Record<HumanBoneName, Track>> = {};
  const interpolation: Partial<Record<HumanBoneName | 'hipsPosition', Interpolation>> = {};
  let hips: Track | null = null;
  let duration = 0;
  const warned = new Set<string>();
  const warnOnce = (message: string): void => {
    if (!warned.has(message)) warnings.push(message);
    warned.add(message);
  };

  for (const channel of listField(animation.channels)) {
    const target = isRecord(channel.target) ? channel.target : { path: '' };
    const node = target.node;
    if (!isIndex(node)) continue;
    const sampler = isIndex(channel.sampler) ? samplers[channel.sampler] : undefined;
    if (sampler === undefined || !isIndex(sampler.input) || !isIndex(sampler.output)) continue;
    const times = reader.readFloat(sampler.input);
    if (times.length > 0) duration = Math.max(duration, times[times.length - 1] as number);
    const bone = boneOfNode.get(node);
    if (bone === undefined) {
      if (expressionNodes.has(node)) warnOnce('Expression and lookAt tracks are not imported yet (V1)');
      else warnOnce(`Channels on non-humanoid nodes were ignored`);
      continue;
    }
    if (EYES.has(bone)) {
      warnOnce('Eye tracks were ignored (gaze uses lookAt, V1)');
      continue;
    }
    const mode: Interpolation =
      sampler.interpolation === 'STEP' || sampler.interpolation === 'CUBICSPLINE' ? sampler.interpolation : 'LINEAR';
    const values = reader.readFloat(sampler.output);
    if (target.path === 'translation') {
      if (bone !== 'hips') {
        warnOnce(`Translation of '${bone}' is not allowed in VRMA and was ignored`);
        continue;
      }
      hips = { times, values: transformPoints(values, hipsParentWorld, mode) };
      interpolation.hipsPosition = mode;
    } else if (target.path === 'rotation') {
      const parentWorld = humanParentWorld(bone, bones, worlds, hipsParentWorld);
      const pre = rotationOf(parentWorld);
      const post = quatInvert(rotationOf(worlds[node] as Float64Array));
      rotations[bone] = { times, values: transformRotations(values, pre, post) };
      interpolation[bone] = mode;
      checkIntermediateRotations(bone, node, bones, parentOf, defs, warnOnce);
    } else {
      warnOnce(`'${target.path}' channels on humanoid bones are not allowed in VRMA and were ignored`);
    }
  }

  const presentBones = HUMAN_BONE_NAMES.filter((bone) => bones.has(bone));
  return {
    data: {
      name: typeof animation.name === 'string' ? animation.name : '',
      duration,
      presentBones,
      rotations,
      hips,
      restHipsPosition,
      interpolation,
    },
    warnings,
  };
}

/** World matrices of every node from its hierarchy (TRS or matrix locals, three.js composition). */
function nodeWorlds(defs: readonly GltfNodeDef[], parentOf: ReadonlyMap<number, number>): Float64Array[] {
  const worlds: (Float64Array | undefined)[] = Array.from({ length: defs.length }, () => undefined);
  const visiting = new Set<number>();
  const world = (i: number): Float64Array => {
    const done = worlds[i];
    if (done !== undefined) return done;
    if (visiting.has(i)) throw new EkzaError('malformed-gltf', 'The node hierarchy has a cycle');
    visiting.add(i);
    const local = localMatrix(defs[i] as GltfNodeDef);
    const parent = parentOf.get(i);
    const result = parent === undefined ? local : mat4Multiply(world(parent), local);
    worlds[i] = result;
    return result;
  };
  return defs.map((_, i) => world(i));
}

function localMatrix(def: GltfNodeDef): Float64Array {
  const m = numberTuple(def.matrix, 16);
  if (m !== null) return Float64Array.from(m);
  const t = numberTuple(def.translation, 3) ?? [0, 0, 0];
  const q = numberTuple(def.rotation, 4) ?? [0, 0, 0, 1];
  const s = numberTuple(def.scale, 3) ?? [1, 1, 1];
  return mat4Compose({
    t: [t[0] as number, t[1] as number, t[2] as number],
    q: quatNormalize([q[0] as number, q[1] as number, q[2] as number, q[3] as number]),
    s: [s[0] as number, s[1] as number, s[2] as number],
  });
}

function rotationOf(m: Float64Array): Quat {
  return mat4Decompose(m).q;
}

/** World matrix of the nearest mapped humanoid ancestor of `bone` (VRMHumanBoneParentMap), else the hips parent. */
function humanParentWorld(
  bone: HumanBoneName,
  bones: ReadonlyMap<HumanBoneName, number>,
  worlds: readonly Float64Array[],
  hipsParentWorld: Float64Array,
): Float64Array {
  let parent = HUMAN_BONE_PARENT[bone];
  while (parent !== null && !bones.has(parent)) parent = HUMAN_BONE_PARENT[parent];
  return parent === null ? hipsParentWorld : (worlds[bones.get(parent) as number] as Float64Array);
}

function transformRotations(values: Float32Array, pre: ReadonlyQuat, post: ReadonlyQuat): Float32Array {
  const out = new Float32Array(values.length);
  const q: Quat = [0, 0, 0, 1];
  for (let i = 0; i + 3 < values.length; i += 4) {
    q[0] = values[i] as number;
    q[1] = values[i + 1] as number;
    q[2] = values[i + 2] as number;
    q[3] = values[i + 3] as number;
    quatMultiply(quatMultiply(pre, q, q), post, q);
    out.set(q, i);
  }
  return out;
}

function transformPoints(values: Float32Array, m: Float64Array, mode: Interpolation): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i + 2 < values.length; i += 3) {
    // CUBICSPLINE stores (in-tangent, value, out-tangent) per key: tangents are directions (no translation).
    const isTangent = mode === 'CUBICSPLINE' && (i / 3) % 3 !== 1;
    const x = values[i] as number;
    const y = values[i + 1] as number;
    const z = values[i + 2] as number;
    const w = isTangent ? 0 : 1;
    out[i] = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number) * w;
    out[i + 1] = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number) * w;
    out[i + 2] = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number) * w;
  }
  return out;
}

/** Warns when a non-humanoid node between a bone and its humanoid parent has a rest rotation (§4.11.7). */
function checkIntermediateRotations(
  bone: HumanBoneName,
  node: number,
  bones: ReadonlyMap<HumanBoneName, number>,
  parentOf: ReadonlyMap<number, number>,
  defs: readonly GltfNodeDef[],
  warn: (message: string) => void,
): void {
  const mapped = new Set(bones.values());
  let n = parentOf.get(node);
  while (n !== undefined && !mapped.has(n)) {
    const q = numberTuple(defs[n]?.rotation, 4);
    if (q !== null && 1 - Math.abs(q[3] as number) > 1e-6) {
      warn(
        `A non-humanoid node above '${bone}' has a rest rotation; it is read like three-vrm-animation, which differs from the VRM pose-transform note`,
      );
      return;
    }
    n = parentOf.get(n);
  }
}

function expressionAndLookAtNodes(ext: JsonRecord): Set<number> {
  const out = new Set<number>();
  const expressions = ext['expressions'];
  for (const group of ['preset', 'custom']) {
    const entries = isRecord(expressions) ? expressions[group] : undefined;
    for (const entry of Object.values(isRecord(entries) ? entries : {})) {
      if (isRecord(entry) && isIndex(entry['node'])) out.add(entry['node']);
    }
  }
  const lookAt = ext['lookAt'];
  if (isRecord(lookAt) && isIndex(lookAt['node'])) out.add(lookAt['node']);
  return out;
}
