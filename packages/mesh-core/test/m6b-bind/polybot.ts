// Polybot for P-S7 (Node only: reads the fixtures): the welded mesh of `polybot-unskinned-tpose.glb` (or the A-pose
// file), the artist's skeleton from `polybot-truth.json` (positions) and `polybot.vrm` (hierarchy), and
// the artist's dominant joint per welded point. A minimal GLB reader (POSITION and indices only) keeps mesh-core free
// of io.
import { readFileSync } from 'node:fs';
import type { MeshData, SkinSkeleton } from '../../src';
import { buildMeshData } from '../../src/testing';
import { type JointRow, skeletonOf, type Vec3 } from './fixtures';

const MODELS = new URL('../../../../fixtures/models/', import.meta.url);

interface Gltf {
  readonly nodes: readonly { readonly name?: string; readonly children?: readonly number[] }[];
  readonly meshes: readonly {
    readonly primitives: readonly { readonly attributes: Record<string, number>; readonly indices?: number }[];
  }[];
  readonly accessors: readonly {
    readonly bufferView: number;
    readonly byteOffset?: number;
    readonly componentType: number;
    readonly count: number;
    readonly type: string;
  }[];
  readonly bufferViews: readonly { readonly byteOffset?: number; readonly byteStride?: number }[];
}

function readGlb(file: string): { readonly json: Gltf; readonly bin: Uint8Array } {
  const bytes = readFileSync(new URL(file, MODELS));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  return { json, bin: bytes.subarray(binStart + 8, binStart + 8 + binLength) };
}

function accessor(gltf: { readonly json: Gltf; readonly bin: Uint8Array }, index: number): number[] {
  const acc = gltf.json.accessors[index];
  if (acc === undefined) throw new Error(`accessor ${index}`);
  const bv = gltf.json.bufferViews[acc.bufferView];
  const comps = acc.type === 'VEC3' ? 3 : acc.type === 'VEC2' ? 2 : 1;
  const size = acc.componentType === 5126 || acc.componentType === 5125 ? 4 : 2;
  const stride = bv?.byteStride ?? comps * size;
  const base = (bv?.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const view = new DataView(gltf.bin.buffer, gltf.bin.byteOffset, gltf.bin.byteLength);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      const at = base + i * stride + c * size;
      out.push(
        acc.componentType === 5126
          ? view.getFloat32(at, true)
          : acc.componentType === 5125
            ? view.getUint32(at, true)
            : view.getUint16(at, true),
      );
    }
  }
  return out;
}

interface PolybotTruth {
  readonly points: number;
  readonly vertexPoint: readonly number[];
  readonly joints: readonly string[];
  readonly dominantJoint: readonly number[];
  readonly poses: Readonly<Record<'apose' | 'tpose', { readonly nodes: Readonly<Record<string, Vec3>> }>>;
}

export interface Polybot {
  readonly mesh: MeshData;
  readonly skeleton: SkinSkeleton;
  /** The artist's dominant joint per welded point, as a skeleton index. */
  readonly dominant: Int32Array;
}

export function polybot(pose: 'tpose' | 'apose'): Polybot {
  const truth = JSON.parse(readFileSync(new URL('polybot-truth.json', MODELS), 'utf8')) as PolybotTruth;
  const glb = readGlb(pose === 'tpose' ? 'polybot-unskinned-tpose.glb' : 'polybot-unskinned.glb');
  const prim = glb.json.meshes[0]?.primitives[0];
  if (prim === undefined || prim.indices === undefined) throw new Error('polybot: no primitive');
  const vertexPositions = accessor(glb, prim.attributes['POSITION'] as number);
  const indices = accessor(glb, prim.indices);
  const positions = Array.from({ length: 3 * truth.points }, () => 0);
  const seen = new Uint8Array(truth.points);
  truth.vertexPoint.forEach((point, vertex) => {
    if (seen[point] === 1) return;
    seen[point] = 1;
    for (let d = 0; d < 3; d++) positions[3 * point + d] = vertexPositions[3 * vertex + d] as number;
  });
  const faces: number[][] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [0, 1, 2].map((k) => truth.vertexPoint[indices[t + k] as number] as number);
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    faces.push(tri);
  }
  const mesh = buildMeshData({ positions, faces });

  // The artist's skeleton: truth node positions, hierarchy and human bones from polybot.vrm.
  const vrm = readGlb('polybot.vrm');
  const nodeIndex = new Map<string, number>();
  vrm.json.nodes.forEach((node, i) => nodeIndex.set(node.name ?? `#${i}`, i));
  const parentNode = new Int32Array(vrm.json.nodes.length).fill(-1);
  vrm.json.nodes.forEach((node, i) => {
    for (const c of node.children ?? []) parentNode[c] = i;
  });
  // The truth lists its joints (`joints`, VRM 1.0 human bones or `node:<name>`) in the order of its node table.
  const names = Object.keys(truth.poses[pose].nodes);
  const keyByName = new Map(names.map((name, i) => [name, truth.joints[i] as string]));
  const keyOf = (name: string): string => keyByName.get(name) ?? `node:${name}`;
  const inSkeleton = new Set(names);
  const rows: JointRow[] = names.map((name) => {
    let p = parentNode[nodeIndex.get(name) ?? -1] ?? -1;
    while (p >= 0 && !inSkeleton.has(vrm.json.nodes[p]?.name ?? '')) p = parentNode[p] as number;
    const parentName = p >= 0 ? (vrm.json.nodes[p]?.name ?? null) : null;
    // End nodes carry no weight in the artist's skin: helpers (never automatic candidates).
    const end = name.endsWith('_End');
    return {
      key: keyOf(name),
      parent: parentName === null ? null : keyOf(parentName),
      head: truth.poses[pose].nodes[name] as Vec3,
      deform: !end,
      humanBone: keyOf(name).startsWith('node:') ? null : keyOf(name),
    };
  });
  const skeleton = skeletonOf(rows);
  const index = new Map(skeleton.keys.map((key, j) => [key, j]));
  const dominant = Int32Array.from(truth.dominantJoint.map((d) => index.get(truth.joints[d] as string) ?? -1));
  return { mesh, skeleton, dominant };
}
