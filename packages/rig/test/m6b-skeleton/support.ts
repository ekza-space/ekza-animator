// Fixtures of the C2 skeleton-kernel tests (M6B-SPEC §0.4.2, §0.7): the Cube Lad and T-posed Polybot read from their
// committed GLBs (one static mesh node at identity each; a minimal GLB reader, since rig cannot import io), the
// generated humanoid body with its CR-2 rig, and the truth markers and joints of each.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HumanBoneName } from '@ekza-studio/doc';
import { humanoidBody, humanoidBodyRig, type MeshData, TriangleBvh, triangulate } from '@ekza-studio/mesh-core';
import type { QuickRigMarker } from '../../src';

export type V3 = readonly [number, number, number];

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/models/', import.meta.url));

export interface Triangles {
  readonly positions: Float64Array;
  readonly tris: Uint32Array;
}

/** POSITION and indices of the first primitive of the first mesh of a GLB whose one node sits at identity. */
export function glbTriangles(file: string): Triangles {
  const bytes = readFileSync(`${FIXTURES}${file}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number }[];
    bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
    meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  };
  const binStart = 20 + jsonLength + 8;
  const accessor = (index: number): { offset: number; count: number; type: number; stride: number } => {
    const a = json.accessors[index];
    if (a === undefined) throw new Error(`accessor ${index}`);
    const bv = json.bufferViews[a.bufferView];
    if (bv === undefined) throw new Error(`bufferView ${a.bufferView}`);
    return {
      offset: binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0),
      count: a.count,
      type: a.componentType,
      stride: bv.byteStride ?? 0,
    };
  };
  const primitive = json.meshes[0]?.primitives[0];
  if (primitive === undefined) throw new Error(`${file}: no primitive`);
  const pos = accessor(primitive.attributes.POSITION);
  const positions = new Float64Array(3 * pos.count);
  const stride = pos.stride === 0 ? 12 : pos.stride;
  for (let i = 0; i < pos.count; i++) {
    for (let c = 0; c < 3; c++) positions[3 * i + c] = view.getFloat32(pos.offset + i * stride + 4 * c, true);
  }
  const idx = accessor(primitive.indices);
  const tris = new Uint32Array(idx.count);
  for (let i = 0; i < idx.count; i++) {
    tris[i] =
      idx.type === 5125
        ? view.getUint32(idx.offset + 4 * i, true)
        : idx.type === 5123
          ? view.getUint16(idx.offset + 2 * i, true)
          : view.getUint8(idx.offset + i);
  }
  return { positions, tris };
}

/** Points (float64) and point-index triangles of a mesh-core MeshData, translated by `offset`. */
export function meshTriangles(data: MeshData, offset: V3 = [0, 0, 0]): Triangles {
  const P = data.counts.points;
  const positions = new Float64Array(3 * P);
  for (let i = 0; i < P; i++) {
    for (let c = 0; c < 3; c++) positions[3 * i + c] = (data.position[3 * i + c] as number) + (offset[c] as number);
  }
  const corners = triangulate(data).tris;
  const tris = new Uint32Array(corners.length);
  for (let i = 0; i < corners.length; i++) tris[i] = data.cornerVert[corners[i] as number] as number;
  return { positions, tris };
}

export function boundsOf(t: Triangles): [V3, V3] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = t.positions[i + c] as number;
      if (v < (lo[c] as number)) lo[c] = v;
      if (v > (hi[c] as number)) hi[c] = v;
    }
  }
  return [lo as unknown as V3, hi as unknown as V3];
}

export interface Fixture {
  readonly name: string;
  readonly triangles: Triangles;
  readonly bvh: TriangleBvh;
  readonly bounds: [V3, V3];
  readonly height: number;
  readonly ground: number;
  /** The truth humanoid joints (character space). */
  readonly joints: Readonly<Partial<Record<HumanBoneName, V3>>>;
  /** The nine truth markers. */
  readonly markers: Readonly<Record<QuickRigMarker, V3>>;
}

function fixture(name: string, triangles: Triangles, joints: Fixture['joints'], markers: Fixture['markers']): Fixture {
  const bounds = boundsOf(triangles);
  return {
    name,
    triangles,
    bvh: new TriangleBvh(triangles.positions, triangles.tris),
    bounds,
    height: bounds[1][1] - bounds[0][1],
    ground: bounds[0][1],
    joints,
    markers,
  };
}

type TruthJoint = { position: number[] };

export function cubeLad(): Fixture {
  const truth = JSON.parse(readFileSync(`${FIXTURES}cube-lad-truth.json`, 'utf8')) as {
    joints: Record<string, TruthJoint>;
    markers: Record<QuickRigMarker, number[]>;
  };
  const joints: Partial<Record<HumanBoneName, V3>> = {};
  for (const [key, joint] of Object.entries(truth.joints)) {
    if (key !== 'root') joints[key as HumanBoneName] = joint.position as unknown as V3;
  }
  return fixture('Cube Lad', glbTriangles('cube-lad.glb'), joints, truth.markers as unknown as Fixture['markers']);
}

export function polybotTPose(): Fixture {
  const truth = JSON.parse(readFileSync(`${FIXTURES}polybot-truth.json`, 'utf8')) as {
    poses: { tpose: { humanoid: Record<string, number[]>; markers: Record<QuickRigMarker, number[]> } };
  };
  return fixture(
    'Polybot (T-pose)',
    glbTriangles('polybot-unskinned-tpose.glb'),
    truth.poses.tpose.humanoid as unknown as Fixture['joints'],
    truth.poses.tpose.markers as unknown as Fixture['markers'],
  );
}

/** The smooth generated humanoid body (1.6 m) with its CR-2 rig as the truth; markers by the Polybot rule (C0). */
export function generatedBody(style: 'smooth' | 'segmented' = 'smooth', height = 1.6): Fixture {
  const data = humanoidBody({ style, height });
  const rig = humanoidBodyRig({ height });
  const joints = rig as Partial<Record<HumanBoneName, V3>>;
  const at = (bone: HumanBoneName): V3 => {
    const p = joints[bone];
    if (p === undefined) throw new Error(`humanoidBodyRig: no ${bone}`);
    return p;
  };
  const triangles = meshTriangles(data);
  const bounds = boundsOf(triangles);
  const H = bounds[1][1] - bounds[0][1];
  const head = at('head');
  const neck = at('neck');
  const markers: Record<QuickRigMarker, V3> = {
    headTop: [0, bounds[1][1], head[2]],
    chin: [0, neck[1] + 0.01 * H, neck[2]],
    pelvis: at('hips'),
    shoulder: at('rightUpperArm'),
    elbow: at('rightLowerArm'),
    wrist: at('rightHand'),
    knee: at('rightLowerLeg'),
    ankle: at('rightFoot'),
    toe: at('rightToes'),
  };
  return fixture(`generated body (${style})`, triangles, joints, markers);
}

export const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );
