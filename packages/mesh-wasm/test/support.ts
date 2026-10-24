// Test meshes of the intake chain: a dense UV sphere whose texture atlas is cut into many charts (the seams of an AI
// generator's atlas), a banded texture with a little noise, and the checks the acceptance asks for (closed topology =
// no cracks; corner values that exist in the source).
import type { MeshData } from '@ekza-studio/mesh-core';
import { BUILTIN_LAYERS } from '@ekza-studio/mesh-core';
import type { RgbaImage } from '../src';

/** Six flat bands (sRGB) from bottom to top: the colours a palette bake must find. */
export const BANDS: readonly (readonly [number, number, number])[] = [
  [40, 30, 20],
  [30, 60, 160],
  [200, 40, 40],
  [240, 240, 240],
  [230, 180, 140],
  [20, 20, 20],
];

/** A deterministic hash in [0, 1). */
export function hash01(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A sphere of about `triangles` triangles (quads count twice) whose `uv0` is cut into `charts × charts` charts packed in
 * a grid with padding: every chart border is a UV seam, as in a generator's atlas.
 */
export function chartedSphere(triangles: number, charts: number): MeshData {
  // Segments a multiple of the chart count, so chart borders run along face edges (no face straddles two charts).
  const n = Math.max(8, charts * Math.ceil(Math.round(Math.sqrt(triangles / 2)) / charts));
  const base = gridSphere(n, n);
  const uv = base.layers.get('uv0');
  if (uv === undefined) throw new Error('the sphere has no uv0');
  const out = new Float32Array(uv.data.length);
  const cell = 1 / charts;
  const pad = cell * 0.04;
  for (let f = 0; f < base.counts.faces; f++) {
    // The face's chart: from its centroid's original UV.
    let c = base.faceCorner[f] as number;
    const first = c;
    let u = 0;
    let v = 0;
    let k = 0;
    do {
      u += uv.data[2 * c] as number;
      v += uv.data[2 * c + 1] as number;
      k++;
      c = base.cornerNext[c] as number;
    } while (c !== first);
    const cu = Math.min(charts - 1, Math.floor((u / k) * charts));
    const cv = Math.min(charts - 1, Math.floor((v / k) * charts));
    // Charts are re-packed in reverse order, so neighbours in 3D are far apart in the atlas.
    const pu = charts - 1 - cu;
    const pv = cv;
    c = first;
    do {
      const lu = ((uv.data[2 * c] as number) - cu * cell) / cell;
      const lv = ((uv.data[2 * c + 1] as number) - cv * cell) / cell;
      out[2 * c] = pu * cell + pad + lu * (cell - 2 * pad);
      out[2 * c + 1] = pv * cell + pad + lv * (cell - 2 * pad);
      c = base.cornerNext[c] as number;
    } while (c !== first);
  }
  const layers = new Map(base.layers);
  layers.set('uv0', { def: uv.def, data: out });
  return { ...base, layers };
}

/**
 * The texture of `chartedSphere`: each texel takes the band of the 3D height its chart maps back to (charts follow the
 * sphere's own UVs, so the original v of a texel is recovered from its chart), with ±3 % noise; with `gutter`, the
 * padding between the charts is that RGBA (an atlas background) instead of the chart's colours.
 */
export function bandTexture(
  size: number,
  charts: number,
  gutter: readonly [number, number, number, number] | null = null,
): RgbaImage {
  const rgba = new Uint8Array(4 * size * size);
  const cell = 1 / charts;
  const pad = cell * 0.04;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const o = 4 * (y * size + x);
      // The atlas background between the charts (their padding), with no dilation: the worst case.
      const pu = Math.min(charts - 1, Math.floor(u / cell));
      const inU = (u - pu * cell - pad) / (cell - 2 * pad);
      const inV = (v - Math.min(charts - 1, Math.floor(v / cell)) * cell - pad) / (cell - 2 * pad);
      if (gutter !== null && (inU < 0 || inU > 1 || inV < 0 || inV > 1)) {
        rgba.set(gutter, o);
        continue;
      }
      const pv = Math.min(charts - 1, Math.floor(v / cell));
      const lv = Math.min(1, Math.max(0, (v - pv * cell - pad) / (cell - 2 * pad)));
      const originalV = (pv + lv) * cell;
      const band = BANDS[Math.min(BANDS.length - 1, Math.floor(originalV * BANDS.length))] as readonly number[];
      const noise = (hash01(x, y) - 0.5) * 0.06;
      for (let c = 0; c < 3; c++)
        rgba[o + c] = Math.max(0, Math.min(255, Math.round((band[c] as number) * (1 + noise))));
      rgba[o + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

/** Open borders and non-manifold edges of a stored mesh (a crack shows up as an open border). */
export function openEdges(data: MeshData): { readonly border: number; readonly nonManifold: number } {
  const uses = new Map<number, number>();
  const P = data.counts.points;
  for (let f = 0; f < data.counts.faces; f++) {
    const first = data.faceCorner[f] as number;
    let c = first;
    do {
      const n = data.cornerNext[c] as number;
      const a = data.cornerVert[c] as number;
      const b = data.cornerVert[n] as number;
      const key = a < b ? a * P + b : b * P + a;
      uses.set(key, (uses.get(key) ?? 0) + 1);
      c = n;
    } while (c !== first);
  }
  let border = 0;
  let nonManifold = 0;
  for (const count of uses.values()) {
    if (count === 1) border++;
    else if (count > 2) nonManifold++;
  }
  return { border, nonManifold };
}

/** Every array of a stored mesh, for byte comparisons. */
export function meshBytes(data: MeshData): Uint8Array[] {
  const arrays: ArrayBufferView[] = [
    data.position,
    data.edgeVerts,
    data.edgeFlags,
    data.cornerVert,
    data.cornerNext,
    data.faceCorner,
    data.faceMaterial,
    data.faceFlags,
    ...[...data.layers.keys()].sort().map((name) => data.layers.get(name)?.data as ArrayBufferView),
  ];
  return arrays.map((array) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice());
}

/**
 * A UV sphere of radius 0.5 built directly as stored data (the kernel primitive caps its segments): `nu` segments
 * around, `nv` rings from the south pole up, quads between rings and triangles at the poles, `uv0` cylindrical (u
 * around with its seam at u = 0 / 1, v from bottom to top, one UV at each pole, or one per pole triangle with
 * `fanPoles`: hundreds of UV charts meeting at one point), every face counterclockwise seen from outside.
 */
export function gridSphere(nu: number, nv: number, fanPoles = false): MeshData {
  const points: number[] = [0, -0.5, 0];
  for (let j = 1; j < nv; j++) {
    const phi = -Math.PI / 2 + (Math.PI * j) / nv;
    for (let i = 0; i < nu; i++) {
      const theta = (2 * Math.PI * i) / nu;
      points.push(0.5 * Math.cos(phi) * Math.sin(theta), 0.5 * Math.sin(phi), 0.5 * Math.cos(phi) * Math.cos(theta));
    }
  }
  points.push(0, 0.5, 0);
  const P = points.length / 3;
  const ring = (j: number, i: number): number => 1 + (j - 1) * nu + (i % nu);
  const faces: { verts: number[]; uvs: number[] }[] = [];
  for (let i = 0; i < nu; i++) {
    const u0 = i / nu;
    const u1 = (i + 1) / nu;
    faces.push({
      verts: [0, ring(1, i + 1), ring(1, i)],
      uvs: [fanPoles ? (u0 + u1) / 2 : 0.5, 0, u1, 1 / nv, u0, 1 / nv],
    });
    for (let j = 1; j < nv - 1; j++) {
      const v0 = j / nv;
      const v1 = (j + 1) / nv;
      faces.push({
        verts: [ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j + 1, i)],
        uvs: [u0, v0, u1, v0, u1, v1, u0, v1],
      });
    }
    faces.push({
      verts: [ring(nv - 1, i), ring(nv - 1, i + 1), P - 1],
      uvs: [u0, (nv - 1) / nv, u1, (nv - 1) / nv, fanPoles ? (u0 + u1) / 2 : 0.5, 1],
    });
  }
  const C = faces.reduce((sum, face) => sum + face.verts.length, 0);
  const cornerVert = new Uint32Array(C);
  const cornerNext = new Uint32Array(C);
  const faceCorner = new Uint32Array(faces.length);
  const uv = new Float32Array(2 * C);
  const edgeIndex = new Map<number, number>();
  const edgeVerts: number[] = [];
  let c = 0;
  faces.forEach((face, f) => {
    faceCorner[f] = c;
    const n = face.verts.length;
    face.verts.forEach((v, k) => {
      cornerVert[c + k] = v;
      cornerNext[c + k] = c + ((k + 1) % n);
      uv[2 * (c + k)] = face.uvs[2 * k] as number;
      uv[2 * (c + k) + 1] = face.uvs[2 * k + 1] as number;
      const a = v;
      const b = face.verts[(k + 1) % n] as number;
      const key = a < b ? a * P + b : b * P + a;
      if (!edgeIndex.has(key)) {
        edgeIndex.set(key, edgeVerts.length / 2);
        edgeVerts.push(a, b);
      }
    });
    c += n;
  });
  const F = faces.length;
  return {
    counts: { points: P, edges: edgeVerts.length / 2, faces: F, corners: C },
    position: Float32Array.from(points),
    edgeVerts: Uint32Array.from(edgeVerts),
    edgeFlags: new Uint8Array(edgeVerts.length / 2),
    cornerVert,
    cornerNext,
    faceCorner,
    faceMaterial: new Uint16Array(F),
    faceFlags: new Uint8Array(F),
    layers: new Map([['uv0', { def: BUILTIN_LAYERS.uv0, data: uv }]]),
  };
}
