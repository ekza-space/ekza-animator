// Synthetic glTF meshes for the M6a mesh IO tests (B8): small triangle meshes with optional normals, UVs, colours,
// skin and morph targets, built through the shared GltfBuilder, and a minimal PNG reader for palette round trips.
import { unzlibSync } from 'fflate';
import { parseGlb } from '../../src/glb/parse';
import { GltfBuilder } from '../../src/testing/glb';
import type { GlbContainer } from '../../src/types';

type Json = Record<string, unknown>;

export interface SyntheticPrimitive {
  readonly positions: readonly number[];
  readonly indices?: readonly number[];
  readonly normals?: readonly number[];
  readonly uvs?: readonly number[];
  readonly colors?: readonly number[];
  readonly colorType?: 'VEC3' | 'VEC4';
  readonly joints?: readonly number[];
  readonly weights?: readonly number[];
  readonly targets?: readonly { readonly position?: readonly number[]; readonly normal?: readonly number[] }[];
  readonly tangents?: boolean;
  readonly mode?: number;
  readonly material?: number;
  readonly extras?: Json;
}

export interface SyntheticMesh {
  readonly primitives: readonly SyntheticPrimitive[];
  readonly name?: string;
  readonly targetNames?: readonly string[];
  /** Root extensions (e.g. a VRM block). */
  readonly extensions?: Json;
  readonly extensionsUsed?: readonly string[];
  /** Adds a skin over two joint nodes and puts it on the mesh node. */
  readonly skinned?: boolean;
  readonly materials?: number;
}

/** A GLB with one mesh on one node (plus two joints when skinned). */
export function syntheticGlb(mesh: SyntheticMesh): Uint8Array {
  const b = new GltfBuilder();
  const json = b.json as Json;
  const primitives = mesh.primitives.map((p) => {
    const attributes: Record<string, number> = {
      POSITION: b.accessor(new Float32Array(p.positions), 'VEC3', { minMax: true }),
    };
    if (p.normals !== undefined) attributes['NORMAL'] = b.accessor(new Float32Array(p.normals), 'VEC3');
    if (p.uvs !== undefined) attributes['TEXCOORD_0'] = b.accessor(new Float32Array(p.uvs), 'VEC2');
    if (p.colors !== undefined) attributes['COLOR_0'] = b.accessor(new Float32Array(p.colors), p.colorType ?? 'VEC4');
    if (p.joints !== undefined) attributes['JOINTS_0'] = b.accessor(new Uint16Array(p.joints), 'VEC4');
    if (p.weights !== undefined) attributes['WEIGHTS_0'] = b.accessor(new Float32Array(p.weights), 'VEC4');
    if (p.tangents === true) {
      const count = p.positions.length / 3;
      attributes['TANGENT'] = b.accessor(new Float32Array(count * 4).fill(1), 'VEC4');
    }
    const out: Json = { attributes };
    if (p.indices !== undefined) out['indices'] = b.accessor(new Uint16Array(p.indices), 'SCALAR');
    if (p.mode !== undefined) out['mode'] = p.mode;
    if (p.material !== undefined) out['material'] = p.material;
    if (p.targets !== undefined) {
      out['targets'] = p.targets.map((t) => {
        const target: Record<string, number> = {};
        if (t.position !== undefined) {
          target['POSITION'] = b.accessor(new Float32Array(t.position), 'VEC3', { minMax: true });
        }
        if (t.normal !== undefined) target['NORMAL'] = b.accessor(new Float32Array(t.normal), 'VEC3');
        return target;
      });
    }
    if (p.extras !== undefined) out['extras'] = p.extras;
    return out;
  });
  const meshJson: Json = { primitives };
  if (mesh.name !== undefined) meshJson['name'] = mesh.name;
  if (mesh.targetNames !== undefined) meshJson['extras'] = { targetNames: mesh.targetNames };
  json['meshes'] = [meshJson];
  if (mesh.skinned === true) {
    json['nodes'] = [
      { name: 'Body', mesh: 0, skin: 0 },
      { name: 'Root', children: [2] },
      { name: 'Child', translation: [0, 1, 0] },
    ];
    const ibm = new Float32Array(32);
    for (const j of [0, 1]) for (const d of [0, 5, 10, 15]) ibm[16 * j + d] = 1;
    ibm[16 + 13] = -1;
    json['skins'] = [{ joints: [1, 2], inverseBindMatrices: b.accessor(ibm, 'MAT4') }];
    json['scenes'] = [{ nodes: [0, 1] }];
  } else {
    json['nodes'] = [{ name: 'Body', mesh: 0 }];
    json['scenes'] = [{ nodes: [0] }];
  }
  json['scene'] = 0;
  if (mesh.materials !== undefined) {
    json['materials'] = Array.from({ length: mesh.materials }, (_, i) => ({ name: `m${i}` }));
  }
  if (mesh.extensions !== undefined) json['extensions'] = mesh.extensions;
  if (mesh.extensionsUsed !== undefined) json['extensionsUsed'] = mesh.extensionsUsed;
  return b.build();
}

export function syntheticContainer(mesh: SyntheticMesh): Promise<GlbContainer> {
  return parseGlb(syntheticGlb(mesh));
}

/** Two triangles forming the unit quad in XY (CCW from +Z), with a UV seam on the diagonal (4 + 2 vertices). */
export function quadWithSeam(opts: { readonly hardDiagonal?: boolean } = {}): SyntheticPrimitive {
  const up = [0, 0, 1];
  const tilted = [0, Math.SQRT1_2, Math.SQRT1_2];
  // Triangle A: v0 (0,0) v1 (1,0) v2 (1,1); triangle B: v3 (0,0) v4 (1,1) v5 (0,1); v3/v4 duplicate v0/v2.
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
  const second = opts.hardDiagonal === true ? tilted : up;
  return {
    positions,
    indices: [0, 1, 2, 3, 4, 5],
    normals: [...up, ...up, ...up, ...second, ...second, ...second],
    uvs: [0, 0, 1, 0, 1, 1, 0.5, 0.5, 0.6, 0.6, 0, 1],
  };
}

/** Decodes an 8-bit RGB, non-interlaced PNG written with filter type 0 (the palette writer's output). */
export function readPngRgb(png: Uint8Array): {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
  readonly chunks: readonly string[];
} {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  const chunks: string[] = [];
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset < png.length) {
    const length = dv.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push(type);
    if (type === 'IHDR') {
      width = dv.getUint32(offset + 8);
      height = dv.getUint32(offset + 12);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((sum, part) => sum + part.length, 0));
  let o = 0;
  for (const part of idat) {
    joined.set(part, o);
    o += part.length;
  }
  const raw = unzlibSync(joined);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    if (raw[y * (width * 3 + 1)] !== 0) throw new Error(`row ${y} uses filter ${raw[y * (width * 3 + 1)]}`);
    rgb.set(raw.subarray(y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1)), y * width * 3);
  }
  return { width, height, rgb, chunks };
}
