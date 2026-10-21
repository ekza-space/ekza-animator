// Shared helpers of io's C1 tests: a records copy of a skinned glTF (joints from its joint nodes in canonical space,
// meshes made editable with their palettes re-keyed to the joint ids) and the joint-subset comparison of the §5.1
// equality gate (names, parent names, rest locals within 1e-6, the humanoid map by name, jointsFingerprint, radii by
// joint name within 1e-4 H).
import { mat4Compose, mat4Multiply } from '@ekza-studio/anim-core';
import type { HumanBoneName, JointId, JointRecord, SkeletonRecord } from '@ekza-studio/doc';
import { makeTestJoint, makeTestSkeleton } from '@ekza-studio/doc/testing';
import { type MeshData, readSkin, type SkinWeights } from '@ekza-studio/mesh-core';
import type { DocSkeletonInput, SkeletonDesc } from '@ekza-studio/rig';
import { expect } from 'vitest';
import { jointsFingerprint } from '../../../src';
import { GltfReader } from '../../../src/gltf/accessor';
import { meshFromGltf } from '../../../src/mesh';
import type { DocVertices } from '../../../src/skeleton/fromDoc';
import { restWorlds } from '../../../src/skeleton/rest';
import type { GlbContainer } from '../../../src/types';

export const IDENTITY16 = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);

export const order = (i: number): string => `a${String(i).padStart(5, '0')}`;

/** `skin.joints`/`skin.weights` of a MeshData as SkinWeights (palette = the layer meta). */
export function skinOfData(data: MeshData): SkinWeights | null {
  return readSkin(data);
}

/** Re-keys a MeshData's skin palette (layer meta) with `key(oldKey)`. */
export function rekeyPalette(data: MeshData, key: (old: string) => string): MeshData {
  const joints = data.layers.get('skin.joints');
  if (joints === undefined) return data;
  const meta = (joints.def.meta?.['joints'] ?? []) as readonly { id: unknown }[];
  const layers = new Map(data.layers);
  layers.set('skin.joints', {
    def: { ...joints.def, meta: { joints: meta.map((entry) => ({ id: key(String(entry.id)), parent: null })) } },
    data: joints.data,
  });
  return { ...data, layers };
}

export interface DocCopy {
  readonly input: DocSkeletonInput;
  readonly gltf: SkeletonDesc;
  /** The original file's skinned vertices, placed in the rest pose (skeletonFromDoc's `vertices`). */
  readonly vertices: Map<string, DocVertices>;
  /** Names of the transform nodes between joints that the copy turned into helper joints. */
  readonly helpers: ReadonlySet<string>;
}

/**
 * A records copy of a skinned glTF: every joint node (and every transform node between two joints, as a helper) a
 * JointRecord in canonical rest space; every skinned mesh made editable with its palette re-keyed to the joint ids
 * and its vertices placed like skeletonFromGltf places them (dominant joint's rest world · inverse bind).
 */
export async function docCopyOf(container: GlbContainer, gltf: SkeletonDesc): Promise<DocCopy> {
  const skeleton: SkeletonRecord = makeTestSkeleton('skl_copy', 'chr_copy', { preset: 'custom' });
  const worlds = restWorlds(gltf);
  const boneOf = new Map<number, HumanBoneName>();
  for (const [bone, node] of Object.entries(gltf.humanoid ?? {}) as [HumanBoneName, number][]) boneOf.set(node, bone);
  const idOf = (index: number): JointId => `jnt_${String(index).padStart(4, '0')}` as JointId;
  // Joints plus the nodes between joints (a transform node under a joint with a joint below it).
  const below = new Set<number>();
  for (const node of [...gltf.nodes].reverse()) {
    if (node.isJoint || below.has(node.index)) if (node.parent !== -1) below.add(node.parent);
  }
  const hasJointAbove = (index: number): boolean => {
    let parent = gltf.nodes[index]?.parent ?? -1;
    while (parent !== -1) {
      if (gltf.nodes[parent]?.isJoint === true) return true;
      parent = gltf.nodes[parent]?.parent ?? -1;
    }
    return false;
  };
  const kept = new Set(
    gltf.nodes
      .filter((node) => node.isJoint || (below.has(node.index) && hasJointAbove(node.index)))
      .map((n) => n.index),
  );
  const helpers = new Set(gltf.nodes.filter((n) => kept.has(n.index) && !n.isJoint).map((n) => n.name));
  const nearestKept = (index: number): number => {
    let parent = gltf.nodes[index]?.parent ?? -1;
    while (parent !== -1 && !kept.has(parent)) parent = gltf.nodes[parent]?.parent ?? -1;
    return parent;
  };
  const joints: JointRecord[] = [];
  const keys = new Set<string>();
  for (const node of gltf.nodes) {
    if (!kept.has(node.index)) continue;
    const world = worlds[node.index];
    if (world === undefined) continue;
    const parent = nearestKept(node.index);
    let key = node.name.replace(/[^A-Za-z0-9_-]/g, '_') || 'node';
    for (let k = 1; keys.has(key); k++) key = `${key}#${k}`;
    keys.add(key);
    joints.push(
      makeTestJoint(idOf(node.index), skeleton.id, {
        parent: parent === -1 ? null : idOf(parent),
        order: order(node.index),
        name: node.name,
        humanBone: boneOf.get(node.index) ?? null,
        restPosition: [world.t[0], world.t[1], world.t[2]],
        restRotation: [world.q[0], world.q[1], world.q[2], world.q[3]],
        role: node.isJoint ? 'bone' : 'helper',
        key,
      }),
    );
  }
  const nodeOfGltf = new Map(gltf.nodes.map((node) => [node.gltfIndex, node.index]));
  const meshes: DocSkeletonInput['meshes'][number][] = [];
  const vertices = new Map<string, DocVertices>();
  const json = container.json as Record<string, unknown>;
  const meshDefs = (json['meshes'] ?? []) as { primitives: { attributes: Record<string, number> }[] }[];
  const nodeDefs = (json['nodes'] ?? []) as { mesh?: number; skin?: number }[];
  const skinDefs = (json['skins'] ?? []) as { joints: number[]; inverseBindMatrices?: number }[];
  const reader = new GltfReader(container.json, container.bin);
  const worldMatrices = worlds.map((world) => mat4Compose(world));
  for (let m = 0; m < meshDefs.length; m++) {
    const result = await meshFromGltf(container, m);
    if ('refused' in result) throw new Error(result.reason);
    const data = rekeyPalette(result.data, (old) => idOf(nodeOfGltf.get(Number(old.slice('node:'.length))) ?? -1));
    const id = `msh_${m}`;
    meshes.push({ id: id as never, data, skin: skinOfData(data), placement: IDENTITY16 });
    const user = nodeDefs.find((node) => node.mesh === m && node.skin !== undefined);
    const skin = user?.skin === undefined ? undefined : skinDefs[user.skin];
    if (skin === undefined) continue;
    const ibm = skin.inverseBindMatrices === undefined ? null : reader.readFloat(skin.inverseBindMatrices);
    const matrices = skin.joints.map((joint, k) => {
      const world = worldMatrices[nodeOfGltf.get(joint) ?? -1];
      if (world === undefined) return null;
      return ibm === null ? world : mat4Multiply(world, Float64Array.from(ibm.subarray(16 * k, 16 * k + 16)));
    });
    const parts: { p: Float32Array; j: Uint32Array; w: Float32Array }[] = [];
    for (const primitive of meshDefs[m]?.primitives ?? []) {
      const a = primitive.attributes;
      if (a['POSITION'] === undefined || a['JOINTS_0'] === undefined || a['WEIGHTS_0'] === undefined) continue;
      const pos = reader.readFloat(a['POSITION']);
      const j = reader.readUint(a['JOINTS_0']);
      const w = reader.readFloat(a['WEIGHTS_0']);
      const count = Math.min(pos.length / 3, j.length / 4, w.length / 4);
      const p = new Float32Array(3 * count);
      for (let v = 0; v < count; v++) {
        let slot = 0;
        for (let k = 1; k < 4; k++) if ((w[4 * v + k] as number) > (w[4 * v + slot] as number)) slot = k;
        const matrix = matrices[j[4 * v + slot] as number] ?? IDENTITY16;
        const x = pos[3 * v] as number;
        const y = pos[3 * v + 1] as number;
        const z = pos[3 * v + 2] as number;
        for (let r = 0; r < 3; r++) {
          p[3 * v + r] =
            (matrix[r] as number) * x +
            (matrix[4 + r] as number) * y +
            (matrix[8 + r] as number) * z +
            (matrix[12 + r] as number);
        }
      }
      parts.push({ p, j: j.subarray(0, 4 * count), w: w.subarray(0, 4 * count) });
    }
    const total = parts.reduce((sum, part) => sum + part.p.length / 3, 0);
    const out = {
      positions: new Float32Array(3 * total),
      joints: new Uint16Array(4 * total),
      weights: new Float32Array(4 * total),
    };
    let at = 0;
    for (const part of parts) {
      out.positions.set(part.p, 3 * at);
      out.joints.set(part.j, 4 * at);
      out.weights.set(part.w, 4 * at);
      at += part.p.length / 3;
    }
    vertices.set(id, out);
  }
  return { input: { skeleton, joints, meshes }, gltf, vertices, helpers };
}

/**
 * The §5.1 joint-subset equality: names, parent names, rest locals (1e-6), the humanoid map by name, jointsFingerprint
 * and radii by joint name (1e-4 H). `helpers` = names the doc side has as joints that the glTF side has as plain
 * transform nodes: their radii and their parents' are not compared (a helper child shortens the doc side's bone
 * segment, which glTF ends at the first *joint* child); the fingerprint counts them as joints on both sides.
 * `unitScale`: JointRecords carry no scale (bind = rest at scale 1), so a copy of a file with scaled joints is
 * fingerprinted against the file's skeleton with its rest scales set to 1.
 */
export function expectJointSubsetEqual(
  doc: SkeletonDesc,
  gltf: SkeletonDesc,
  opts: { readonly radii: boolean; readonly helpers?: ReadonlySet<string>; readonly unitScale?: boolean },
): void {
  const helpers = opts.helpers ?? new Set<string>();
  const subset = (desc: SkeletonDesc, widen: boolean) => {
    const out = new Map<
      string,
      { parent: string; t: readonly number[]; q: readonly number[]; radius: number | null }
    >();
    for (const node of desc.nodes) {
      if (!node.isJoint && !(widen && helpers.has(node.name))) continue;
      out.set(node.name, {
        parent: node.parent === -1 ? '' : (desc.nodes[node.parent]?.name ?? ''),
        t: node.restLocal.t,
        q: node.restLocal.q,
        radius: desc.boneRadii[node.index] ?? null,
      });
    }
    return out;
  };
  const helperParents = new Set(
    doc.nodes
      .filter((node) => helpers.has(node.name) && node.parent !== -1)
      .map((node) => doc.nodes[node.parent]?.name),
  );
  const a = subset(doc, false);
  const b = subset(gltf, true);
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  const problems: string[] = [];
  const H = gltf.height;
  for (const [name, x] of a) {
    const y = b.get(name);
    if (y === undefined) continue;
    if (x.parent !== y.parent) problems.push(`${name}: parent ${x.parent} ≠ ${y.parent}`);
    const dt = Math.max(...x.t.map((v, i) => Math.abs(v - (y.t[i] as number))));
    // q and −q are the same rotation.
    const sign = x.q.reduce((s, v, i) => s + v * (y.q[i] as number), 0) < 0 ? -1 : 1;
    const dq = Math.max(...x.q.map((v, i) => Math.abs(sign * v - (y.q[i] as number))));
    if (dt > 1e-6) problems.push(`${name}: t off by ${dt}`);
    if (dq > 1e-6) problems.push(`${name}: q off by ${dq}`);
    if (opts.radii && !helpers.has(name) && !helperParents.has(name)) {
      if ((x.radius === null) !== (y.radius === null)) problems.push(`${name}: radius ${x.radius} vs ${y.radius}`);
      else if (x.radius !== null && y.radius !== null && Math.abs(x.radius - y.radius) > 1e-4 * H) {
        problems.push(`${name}: radius ${x.radius} vs ${y.radius}`);
      }
    }
  }
  expect(problems).toEqual([]);
  const byName = (desc: SkeletonDesc) =>
    Object.fromEntries(Object.entries(desc.humanoid ?? {}).map(([bone, node]) => [bone, desc.nodes[node]?.name]));
  expect(byName(doc)).toEqual(byName(gltf));
  const widened = gltf.nodes.map((node) => ({
    ...node,
    isJoint: node.isJoint || helpers.has(node.name),
    restLocal:
      opts.unitScale === true ? { ...node.restLocal, s: [1, 1, 1] as [number, number, number] } : node.restLocal,
  }));
  expect(jointsFingerprint(doc.nodes)).toBe(jointsFingerprint(widened));
}

// ---------- the Cube Lad truth skeleton and simple weights ----------

interface TruthJoint {
  readonly position: readonly [number, number, number];
  readonly parent: string | null;
  readonly tail: readonly [number, number, number] | null;
}

/** The Standard 33 joints of `fixtures/models/cube-lad-truth.json` (34 with the root helper) as records. */
export function truthJoints(
  truth: { readonly joints: Readonly<Record<string, TruthJoint>> },
  skeleton = 'skl_truth',
): JointRecord[] {
  const keys = Object.keys(truth.joints);
  return keys.map((key, i) => {
    const joint = truth.joints[key] as TruthJoint;
    const side = key.startsWith('left') ? 'L' : key.startsWith('right') ? 'R' : 'C';
    const partner = side === 'L' ? key.replace(/^left/, 'right') : side === 'R' ? key.replace(/^right/, 'left') : null;
    return makeTestJoint(`jnt_${key}`, skeleton, {
      parent: joint.parent === null ? null : (`jnt_${joint.parent}` as JointId),
      order: order(i),
      name: key,
      humanBone: key === 'root' ? null : (key as HumanBoneName),
      restPosition: [...joint.position],
      restRotation: [0, 0, 0, 1],
      tail: joint.tail === null ? null : [...joint.tail],
      side,
      mirror: partner === null ? null : (`jnt_${partner}` as JointId),
      role: key === 'root' ? 'helper' : 'bone',
      key,
    });
  });
}

/**
 * Weights of every point between its two nearest bone segments (head → first child, leaves a point; helpers never
 * weighted), inverse-distance blended and normalized: a deterministic stand-in for a bind.
 */
export function nearestBoneWeights(data: MeshData, joints: readonly JointRecord[]): SkinWeights {
  const live = joints.filter((joint) => joint.role === 'bone');
  const child = new Map<string, JointRecord>();
  for (const joint of live) if (joint.parent !== null && !child.has(joint.parent)) child.set(joint.parent, joint);
  const P = data.counts.points;
  const out = { joints: new Uint16Array(4 * P), weights: new Float32Array(4 * P) };
  for (let p = 0; p < P; p++) {
    const x = data.position[3 * p] as number;
    const y = data.position[3 * p + 1] as number;
    const z = data.position[3 * p + 2] as number;
    const ranked = live
      .map((joint, j) => {
        const a = joint.restPosition;
        const b = child.get(joint.id)?.restPosition ?? a;
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
        const len = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
        const t =
          len === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / len));
        return { j, dist: Math.hypot(x - a[0] - t * d[0], y - a[1] - t * d[1], z - a[2] - t * d[2]) };
      })
      .sort((u, v) => u.dist - v.dist || u.j - v.j);
    const [first, second] = ranked as [{ j: number; dist: number }, { j: number; dist: number }];
    const w1 = 1 / Math.max(first.dist, 1e-4);
    const w2 = 1 / Math.max(second.dist, 1e-4);
    const a = Math.fround(w1 / (w1 + w2));
    out.joints[4 * p] = first.j;
    out.weights[4 * p] = a;
    out.joints[4 * p + 1] = second.j;
    out.weights[4 * p + 1] = Math.fround(1 - a);
  }
  return {
    points: P,
    palette: live.map((joint) => ({ key: joint.id, parent: joint.parent, mirror: joint.mirror })),
    ...out,
  };
}
