// Synthetic glTF meshes for the M6a mesh IO tests (B8): small triangle meshes with optional normals, UVs, colours,
// skin and morph targets, built through the shared GltfBuilder, and a minimal PNG reader for palette round trips.
import type { LayerDef, MeshData } from '@ekza-studio/mesh-core';
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

/**
 * A stand-in for a topology edit until the kernel's Euler operators land (READY.b1): every listed face is split into
 * a fan around a new point at its centroid. Point layers of the new point average the face's points (skin layers copy
 * the first point's, which stays normalized), corner layers of its corners average the face's corners
 * (`normal.custom` 0, the kernel's 'clear' rule); edge flags of kept edges survive, new edges are soft.
 */
export function splitFaces(data: MeshData, split: readonly number[]): MeshData {
  const { faces: F, points: P } = data.counts;
  const splitSet = new Set(split);
  const faceCorners = (f: number): number[] => {
    const out: number[] = [];
    let c = data.faceCorner[f] as number;
    do {
      out.push(c);
      c = data.cornerNext[c] as number;
    } while (c !== data.faceCorner[f]);
    return out;
  };
  // New faces as lists of (point, source corner | -1 for the new centre point) with their source face.
  const faces: { readonly verts: number[]; readonly corners: number[]; readonly face: number }[] = [];
  const centres: { readonly face: number; readonly corners: readonly number[] }[] = [];
  for (let f = 0; f < F; f++) {
    const corners = faceCorners(f);
    if (!splitSet.has(f)) {
      faces.push({ verts: corners.map((c) => data.cornerVert[c] as number), corners, face: f });
      continue;
    }
    const centre = P + centres.length;
    centres.push({ face: f, corners });
    corners.forEach((c, i) => {
      const next = corners[(i + 1) % corners.length] as number;
      faces.push({
        verts: [data.cornerVert[c] as number, data.cornerVert[next] as number, centre],
        corners: [c, next, -1 - (centres.length - 1)],
        face: f,
      });
    });
  }
  const P2 = P + centres.length;
  const position = new Float32Array(3 * P2);
  position.set(data.position);
  centres.forEach(({ corners }, i) => {
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (const c of corners) sum += data.position[3 * (data.cornerVert[c] as number) + k] as number;
      position[3 * (P + i) + k] = sum / corners.length;
    }
  });
  const C2 = faces.reduce((sum, face) => sum + face.verts.length, 0);
  const cornerVert = new Uint32Array(C2);
  const cornerNext = new Uint32Array(C2);
  const faceCorner = new Uint32Array(faces.length);
  const faceMaterial = new Uint16Array(faces.length);
  const sourceCorner: number[] = [];
  let c2 = 0;
  faces.forEach((face, f) => {
    faceCorner[f] = c2;
    faceMaterial[f] = data.faceMaterial[face.face] as number;
    face.verts.forEach((v, i) => {
      cornerVert[c2 + i] = v;
      cornerNext[c2 + i] = c2 + ((i + 1) % face.verts.length);
      sourceCorner.push(face.corners[i] as number);
    });
    c2 += face.verts.length;
  });
  const oldEdges = new Map<string, number>();
  for (let e = 0; e < data.counts.edges; e++) {
    const a = data.edgeVerts[2 * e] as number;
    const b = data.edgeVerts[2 * e + 1] as number;
    oldEdges.set(a < b ? `${a},${b}` : `${b},${a}`, data.edgeFlags[e] as number);
  }
  const edgeIndex = new Map<string, number>();
  const edgeVerts: number[] = [];
  const edgeFlags: number[] = [];
  for (let c = 0; c < C2; c++) {
    const a = cornerVert[c] as number;
    const b = cornerVert[cornerNext[c] as number] as number;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (edgeIndex.has(key)) continue;
    edgeIndex.set(key, edgeVerts.length / 2);
    edgeVerts.push(a, b);
    edgeFlags.push(oldEdges.get(key) ?? 0);
  }
  const layers = new Map<
    string,
    { readonly def: LayerDef; readonly data: Float32Array | Uint8Array | Uint16Array | Uint32Array }
  >();
  for (const [name, layer] of data.layers) {
    const comps = layer.def.comps;
    const Ctor = layer.data.constructor as new (n: number) => Float32Array | Uint8Array | Uint16Array | Uint32Array;
    if (layer.def.domain === 'point') {
      const out = new Ctor(P2 * comps);
      out.set(layer.data);
      centres.forEach(({ corners }, i) => {
        const first = data.cornerVert[corners[0] as number] as number;
        for (let k = 0; k < comps; k++) {
          if (name.startsWith('skin.')) {
            out[(P + i) * comps + k] = layer.data[first * comps + k] as number;
          } else {
            let sum = 0;
            for (const c of corners) sum += layer.data[(data.cornerVert[c] as number) * comps + k] as number;
            out[(P + i) * comps + k] = sum / corners.length;
          }
        }
      });
      layers.set(name, { def: layer.def, data: out });
    } else if (layer.def.domain === 'corner') {
      const out = new Ctor(C2 * comps);
      sourceCorner.forEach((source, c) => {
        if (source >= 0) {
          for (let k = 0; k < comps; k++) out[c * comps + k] = layer.data[source * comps + k] as number;
          return;
        }
        if (name === 'normal.custom') return;
        const centre = centres[-1 - source] as { readonly corners: readonly number[] };
        for (let k = 0; k < comps; k++) {
          let sum = 0;
          for (const s of centre.corners) sum += layer.data[s * comps + k] as number;
          out[c * comps + k] = sum / centre.corners.length;
        }
      });
      layers.set(name, { def: layer.def, data: out });
    } else if (layer.def.domain === 'face') {
      const out = new Ctor(faces.length * comps);
      faces.forEach((face, f) => {
        for (let k = 0; k < comps; k++) out[f * comps + k] = layer.data[face.face * comps + k] as number;
      });
      layers.set(name, { def: layer.def, data: out });
    }
  }
  return {
    counts: { points: P2, edges: edgeVerts.length / 2, faces: faces.length, corners: C2 },
    position,
    edgeVerts: Uint32Array.from(edgeVerts),
    edgeFlags: Uint8Array.from(edgeFlags),
    cornerVert,
    cornerNext,
    faceCorner,
    faceMaterial,
    faceFlags: new Uint8Array(faces.length),
    layers,
  };
}

/**
 * A stand-in for Delete Faces until the kernel's ops land (READY.b3): keeps the faces `keep` accepts and only the
 * points, edges and corners they use (points in their old order). Point, corner and face layers follow their
 * elements; edge flags of kept edges survive.
 */
export function keepFaces(data: MeshData, keep: (face: number) => boolean): MeshData {
  const { faces: F, points: P } = data.counts;
  const kept: number[][] = [];
  const keptFaces: number[] = [];
  for (let f = 0; f < F; f++) {
    if (!keep(f)) continue;
    const corners: number[] = [];
    let c = data.faceCorner[f] as number;
    do {
      corners.push(c);
      c = data.cornerNext[c] as number;
    } while (c !== data.faceCorner[f]);
    kept.push(corners);
    keptFaces.push(f);
  }
  const used = new Uint8Array(P);
  for (const corners of kept) for (const c of corners) used[data.cornerVert[c] as number] = 1;
  const pointMap = new Int32Array(P).fill(-1);
  const points: number[] = [];
  for (let p = 0; p < P; p++) {
    if (used[p] === 0) continue;
    pointMap[p] = points.length;
    points.push(p);
  }
  const sourceCorner = kept.flat();
  const C2 = sourceCorner.length;
  const cornerVert = new Uint32Array(C2);
  const cornerNext = new Uint32Array(C2);
  const faceCorner = new Uint32Array(kept.length);
  const faceMaterial = new Uint16Array(kept.length);
  const faceFlags = new Uint8Array(kept.length);
  let c2 = 0;
  kept.forEach((corners, f) => {
    faceCorner[f] = c2;
    faceMaterial[f] = data.faceMaterial[keptFaces[f] as number] as number;
    faceFlags[f] = data.faceFlags[keptFaces[f] as number] as number;
    corners.forEach((c, i) => {
      cornerVert[c2 + i] = pointMap[data.cornerVert[c] as number] as number;
      cornerNext[c2 + i] = c2 + ((i + 1) % corners.length);
    });
    c2 += corners.length;
  });
  const oldEdges = new Map<string, number>();
  for (let e = 0; e < data.counts.edges; e++) {
    const a = pointMap[data.edgeVerts[2 * e] as number] as number;
    const b = pointMap[data.edgeVerts[2 * e + 1] as number] as number;
    if (a >= 0 && b >= 0) oldEdges.set(a < b ? `${a},${b}` : `${b},${a}`, data.edgeFlags[e] as number);
  }
  const edgeIndex = new Set<string>();
  const edgeVerts: number[] = [];
  const edgeFlags: number[] = [];
  for (let c = 0; c < C2; c++) {
    const a = cornerVert[c] as number;
    const b = cornerVert[cornerNext[c] as number] as number;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (edgeIndex.has(key)) continue;
    edgeIndex.add(key);
    edgeVerts.push(a, b);
    edgeFlags.push(oldEdges.get(key) ?? 0);
  }
  const layers = new Map<
    string,
    { readonly def: LayerDef; readonly data: Float32Array | Uint8Array | Uint16Array | Uint32Array }
  >();
  for (const [name, layer] of data.layers) {
    const comps = layer.def.comps;
    const Ctor = layer.data.constructor as new (n: number) => Float32Array | Uint8Array | Uint16Array | Uint32Array;
    const sources =
      layer.def.domain === 'point'
        ? points
        : layer.def.domain === 'corner'
          ? sourceCorner
          : layer.def.domain === 'face'
            ? keptFaces
            : null;
    if (sources === null) continue;
    const out = new Ctor(sources.length * comps);
    sources.forEach((source, i) => {
      for (let k = 0; k < comps; k++) out[i * comps + k] = layer.data[source * comps + k] as number;
    });
    layers.set(name, { def: layer.def, data: out });
  }
  const position = new Float32Array(3 * points.length);
  points.forEach((p, i) => position.set(data.position.subarray(3 * p, 3 * p + 3), 3 * i));
  return {
    counts: { points: points.length, edges: edgeVerts.length / 2, faces: kept.length, corners: C2 },
    position,
    edgeVerts: Uint32Array.from(edgeVerts),
    edgeFlags: Uint8Array.from(edgeFlags),
    cornerVert,
    cornerNext,
    faceCorner,
    faceMaterial,
    faceFlags,
    layers,
  };
}
