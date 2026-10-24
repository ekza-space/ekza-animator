// A procedural stand-in for an AI generator's output (MODELING-PLAN §7.3; M7 G-a acceptance): no network fetch, no
// third-party asset, the same bytes on every run. A dense, textured humanoid in the shape of the kernel's
// `humanoidBody` template (whose markers Auto-Rig's guess reads), subdivided to about 100k triangles, rounded by Taubin
// smoothing and roughened by hash noise like a reconstruction; one image texture on a fragmented atlas (one chart per
// template face, so every chart border is a UV seam, as in a generator's atlas) with banded clothes, skin, hair and
// eyes plus texel noise; the frame of a generator's default export: facing +X (Tripo's `export_orientation`), about
// one unit tall, centred on its bounds; vertices split along the seams (one glTF primitive, uint32 indices).
import { encodePngRgb } from '../png/encode';
import { humanoidBody, triangulate } from '../mesh/kernel';
import { GltfBuilder } from './glb';

export interface AiLikeModelOptions {
  /** Segments per template triangle edge (each template triangle becomes n² triangles; 494 template triangles). */
  readonly subdivisions?: number;
  readonly textureSize?: number;
  /** The axis the model faces in the file. */
  readonly forward?: '+x' | '+z';
  /** Height in file units. */
  readonly height?: number;
}

/** Template triangles of `humanoidBody({style: 'smooth'})` (the triangle count is 494 × subdivisions²). */
export const AI_LIKE_TEMPLATE_TRIANGLES = 494;

/** A deterministic hash in [0, 1). */
function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type RGB = readonly [number, number, number];

/** The model's "albedo" at a point of the 1.7 m template (+Y up, facing +Z). */
function albedo(x: number, y: number, z: number): RGB {
  const H = 1.7;
  const ax = Math.abs(x);
  if (y > 0.8 * H) {
    // Head: hair on top and at the back, eyes on the front, skin elsewhere.
    if (y > 0.93 * H || (z < -0.03 && y > 0.84 * H)) return [52, 36, 26];
    if (z > 0.06 && ax > 0.025 && ax < 0.06 && y > 0.86 * H && y < 0.885 * H) return [18, 18, 22];
    return [226, 182, 150];
  }
  if (ax > 0.42) return [226, 182, 150]; // hands and forearms
  if (y < 0.06 * H) return [62, 42, 30]; // shoes
  if (y < 0.47 * H) return [44, 66, 140]; // trousers
  if (y < 0.5 * H) return [30, 30, 30]; // belt
  // Shirt with white stripes.
  return (y * 24) % 1 < 0.22 ? [236, 236, 230] : [188, 52, 46];
}

/**
 * The AI-like GLB (see the module comment). Defaults: 14 subdivisions (96,824 triangles), a 1024² texture, facing
 * +X, 1 unit tall.
 */
export function makeAiLikeGlb(opts: AiLikeModelOptions = {}): Uint8Array {
  const n = Math.max(1, Math.floor(opts.subdivisions ?? 14));
  const textureSize = opts.textureSize ?? 1024;
  const base = humanoidBody({ style: 'smooth', height: 1.7 });
  const { tris, triFace } = triangulate(base);
  const T = tris.length / 3;
  const cornerPoint = (c: number): number => base.cornerVert[c] as number;
  const bp = base.position;

  // ---- subdivision: barycentric grid per template triangle, shared along template edges ----
  const points: number[] = [];
  const pointKey = new Map<string, number>();
  const pointOf = (key: string, x: number, y: number, z: number): number => {
    let p = pointKey.get(key);
    if (p === undefined) {
      p = points.length / 3;
      pointKey.set(key, p);
      points.push(x, y, z);
    }
    return p;
  };
  /** Per output triangle: its point triples and its template face (the chart). */
  const triPoints: number[] = [];
  const triChart: number[] = [];
  /** The template-space position of each output corner (for the chart projection). */
  const cornerBase: number[] = [];
  for (let t = 0; t < T; t++) {
    const pa = cornerPoint(tris[3 * t] as number);
    const pb = cornerPoint(tris[3 * t + 1] as number);
    const pc = cornerPoint(tris[3 * t + 2] as number);
    const grid: number[][] = [];
    const basePos: [number, number, number][][] = [];
    for (let i = 0; i <= n; i++) {
      grid.push([]);
      basePos.push([]);
      for (let j = 0; j <= n - i; j++) {
        const k = n - i - j;
        const wa = k / n;
        const wb = i / n;
        const wc = j / n;
        const x = wa * (bp[3 * pa] as number) + wb * (bp[3 * pb] as number) + wc * (bp[3 * pc] as number);
        const y = wa * (bp[3 * pa + 1] as number) + wb * (bp[3 * pb + 1] as number) + wc * (bp[3 * pc + 1] as number);
        const z = wa * (bp[3 * pa + 2] as number) + wb * (bp[3 * pb + 2] as number) + wc * (bp[3 * pc + 2] as number);
        let key: string;
        if (i === 0 && j === 0) key = `v${pa}`;
        else if (i === n) key = `v${pb}`;
        else if (j === n) key = `v${pc}`;
        else if (j === 0) key = pa < pb ? `e${pa}-${pb}-${i}` : `e${pb}-${pa}-${n - i}`;
        else if (i === 0) key = pa < pc ? `e${pa}-${pc}-${j}` : `e${pc}-${pa}-${n - j}`;
        else if (k === 0) key = pb < pc ? `e${pb}-${pc}-${j}` : `e${pc}-${pb}-${i}`;
        else key = `t${t}-${i}-${j}`;
        (grid[i] as number[]).push(pointOf(key, x, y, z));
        (basePos[i] as [number, number, number][]).push([x, y, z]);
      }
    }
    const chart = triFace[t] as number;
    const emit = (a: [number, number], b: [number, number], c: [number, number]): void => {
      for (const [i, j] of [a, b, c]) {
        triPoints.push((grid[i] as number[])[j] as number);
        cornerBase.push(...((basePos[i] as [number, number, number][])[j] as [number, number, number]));
      }
      triChart.push(chart);
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        emit([i, j], [i + 1, j], [i, j + 1]);
        if (j < n - i - 1) emit([i + 1, j], [i + 1, j + 1], [i, j + 1]);
      }
    }
  }
  const P = points.length / 3;
  const pos = Float64Array.from(points);

  // ---- Taubin smoothing (rounds the template's facets without shrinking) and reconstruction noise ----
  const neighbours: number[][] = Array.from({ length: P }, () => []);
  for (let t = 0; t < triPoints.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triPoints[t + k] as number;
      const b = triPoints[t + ((k + 1) % 3)] as number;
      if (!(neighbours[a] as number[]).includes(b)) (neighbours[a] as number[]).push(b);
      if (!(neighbours[b] as number[]).includes(a)) (neighbours[b] as number[]).push(a);
    }
  }
  const smooth = (factor: number): void => {
    const next = new Float64Array(pos.length);
    for (let p = 0; p < P; p++) {
      const list = neighbours[p] as number[];
      for (let c = 0; c < 3; c++) {
        let mean = 0;
        for (const q of list) mean += pos[3 * q + c] as number;
        mean /= Math.max(1, list.length);
        next[3 * p + c] = (pos[3 * p + c] as number) + factor * (mean - (pos[3 * p + c] as number));
      }
    }
    pos.set(next);
  };
  for (let iteration = 0; iteration < 8; iteration++) {
    smooth(0.5);
    smooth(-0.53);
  }
  const normals = new Float64Array(3 * P);
  for (let t = 0; t < triPoints.length; t += 3) {
    const a = triPoints[t] as number;
    const b = triPoints[t + 1] as number;
    const c = triPoints[t + 2] as number;
    const ux = (pos[3 * b] as number) - (pos[3 * a] as number);
    const uy = (pos[3 * b + 1] as number) - (pos[3 * a + 1] as number);
    const uz = (pos[3 * b + 2] as number) - (pos[3 * a + 2] as number);
    const vx = (pos[3 * c] as number) - (pos[3 * a] as number);
    const vy = (pos[3 * c + 1] as number) - (pos[3 * a + 1] as number);
    const vz = (pos[3 * c + 2] as number) - (pos[3 * a + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const p of [a, b, c]) {
      normals[3 * p] = (normals[3 * p] as number) + nx;
      normals[3 * p + 1] = (normals[3 * p + 1] as number) + ny;
      normals[3 * p + 2] = (normals[3 * p + 2] as number) + nz;
    }
  }
  for (let p = 0; p < P; p++) {
    const l = Math.hypot(normals[3 * p] as number, normals[3 * p + 1] as number, normals[3 * p + 2] as number) || 1;
    const bump = (hash01(p, 7) - 0.5) * 0.004;
    for (let c = 0; c < 3; c++) {
      normals[3 * p + c] = (normals[3 * p + c] as number) / l;
      pos[3 * p + c] = (pos[3 * p + c] as number) + bump * (normals[3 * p + c] as number);
    }
  }

  // ---- the atlas: one chart per template face, packed in a grid with padding ----
  const F = base.counts.faces;
  const grid = Math.ceil(Math.sqrt(F));
  const cell = 1 / grid;
  const pad = cell * 0.06;
  const frames = Array.from({ length: F }, (_, f) => {
    // The face plane: its first three corners' template points; u along the first edge, v in-plane.
    const c0 = base.faceCorner[f] as number;
    const c1 = base.cornerNext[c0] as number;
    const c2 = base.cornerNext[c1] as number;
    const o = [0, 1, 2].map((k) => bp[3 * cornerPoint(c0) + k] as number);
    const e1 = [0, 1, 2].map((k) => (bp[3 * cornerPoint(c1) + k] as number) - (o[k] as number));
    const e2 = [0, 1, 2].map((k) => (bp[3 * cornerPoint(c2) + k] as number) - (o[k] as number));
    const normal = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const lu = Math.hypot(...e1) || 1;
    const u = e1.map((v) => v / lu);
    const vRaw = [normal[1]! * u[2]! - normal[2]! * u[1]!, normal[2]! * u[0]! - normal[0]! * u[2]!, normal[0]! * u[1]! - normal[1]! * u[0]!];
    const lv = Math.hypot(...vRaw) || 1;
    const v = vRaw.map((x) => x / lv);
    // The face's extent in (u, v) over all its corners.
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    let c = c0;
    do {
      const p = cornerPoint(c);
      const d = [0, 1, 2].map((k) => (bp[3 * p + k] as number) - (o[k] as number));
      const s = d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!;
      const t = d[0]! * v[0]! + d[1]! * v[1]! + d[2]! * v[2]!;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
      c = base.cornerNext[c] as number;
    } while (c !== c0);
    const span = Math.max(s1 - s0, t1 - t0, 1e-6);
    const cx = (f % grid) * cell;
    const cy = Math.floor(f / grid) * cell;
    return { o, u, v, s0, t0, span, cx, cy };
  });
  const uvOf = (f: number, x: number, y: number, z: number): [number, number] => {
    const fr = frames[f] as (typeof frames)[number];
    const d = [x - fr.o[0]!, y - fr.o[1]!, z - fr.o[2]!];
    const s = (d[0]! * fr.u[0]! + d[1]! * fr.u[1]! + d[2]! * fr.u[2]! - fr.s0) / fr.span;
    const t = (d[0]! * fr.v[0]! + d[1]! * fr.v[1]! + d[2]! * fr.v[2]! - fr.t0) / fr.span;
    return [fr.cx + pad + s * (cell - 2 * pad), fr.cy + pad + t * (cell - 2 * pad)];
  };

  // ---- the texture: each texel takes the albedo of the template point its chart maps it back to ----
  const rgb = new Uint8Array(3 * textureSize * textureSize);
  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      const u = (x + 0.5) / textureSize;
      const v = (y + 0.5) / textureSize;
      const f = Math.min(F - 1, Math.floor(v / cell) * grid + Math.min(grid - 1, Math.floor(u / cell)));
      const fr = frames[f] as (typeof frames)[number];
      const s = Math.min(1, Math.max(0, (u - fr.cx - pad) / (cell - 2 * pad))) * fr.span + fr.s0;
      const t = Math.min(1, Math.max(0, (v - fr.cy - pad) / (cell - 2 * pad))) * fr.span + fr.t0;
      const px = fr.o[0]! + s * fr.u[0]! + t * fr.v[0]!;
      const py = fr.o[1]! + s * fr.u[1]! + t * fr.v[1]!;
      const pz = fr.o[2]! + s * fr.u[2]! + t * fr.v[2]!;
      const colour = albedo(px, py, pz);
      const noise = 1 + (hash01(x, y, 3) - 0.5) * 0.1;
      const o = 3 * (y * textureSize + x);
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.max(0, Math.min(255, Math.round((colour[k] as number) * noise)));
    }
  }

  // ---- vertices split along the seams: one per (point, chart) ----
  const vertexKey = new Map<number, number>();
  const vPos: number[] = [];
  const vNormal: number[] = [];
  const vUv: number[] = [];
  const indices = new Uint32Array(triPoints.length);
  // The generator's frame: facing +X (a +90° turn about +Y), `height` units tall, centred on its bounds.
  const toX = (opts.forward ?? '+x') === '+x';
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let p = 0; p < P; p++) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] as number, pos[3 * p + k] as number);
      hi[k] = Math.max(hi[k] as number, pos[3 * p + k] as number);
    }
  }
  const scale = (opts.height ?? 1) / ((hi[1] as number) - (lo[1] as number));
  const centre = [0, 1, 2].map((k) => ((lo[k] as number) + (hi[k] as number)) / 2);
  const frame = (x: number, y: number, z: number): [number, number, number] => {
    const cx = (x - centre[0]!) * scale;
    const cy = (y - centre[1]!) * scale;
    const cz = (z - centre[2]!) * scale;
    return toX ? [cz, cy, -cx] : [cx, cy, cz];
  };
  lo = [Infinity, Infinity, Infinity];
  hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triPoints.length; i++) {
    const p = triPoints[i] as number;
    const chart = triChart[Math.floor(i / 3)] as number;
    const key = p * 4096 + chart;
    let vertex = vertexKey.get(key);
    if (vertex === undefined) {
      vertex = vPos.length / 3;
      vertexKey.set(key, vertex);
      const [x, y, z] = frame(pos[3 * p] as number, pos[3 * p + 1] as number, pos[3 * p + 2] as number);
      vPos.push(x, y, z);
      const [nx, ny, nz] = (() => {
        const a = normals[3 * p] as number;
        const b = normals[3 * p + 1] as number;
        const c = normals[3 * p + 2] as number;
        return toX ? [c, b, -a] : [a, b, c];
      })();
      vNormal.push(nx, ny, nz);
      vUv.push(...uvOf(chart, cornerBase[3 * i] as number, cornerBase[3 * i + 1] as number, cornerBase[3 * i + 2] as number));
    }
    indices[i] = vertex;
  }

  const b = new GltfBuilder({ version: '2.0', generator: 'ekza-studio test kit (AI-like model)' });
  const json = b.json as Record<string, unknown>;
  const position = b.accessor(Float32Array.from(vPos), 'VEC3', { minMax: true });
  const normal = b.accessor(Float32Array.from(vNormal), 'VEC3');
  const uv = b.accessor(Float32Array.from(vUv), 'VEC2');
  const index = b.accessor(indices, 'SCALAR');
  const image = b.view(encodePngRgb(textureSize, textureSize, rgb));
  json['images'] = [{ bufferView: image, mimeType: 'image/png', name: 'albedo' }];
  json['samplers'] = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
  json['textures'] = [{ sampler: 0, source: 0 }];
  json['materials'] = [
    {
      name: 'generated',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
    },
  ];
  json['meshes'] = [
    {
      name: 'generated_model',
      primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, indices: index, material: 0 }],
    },
  ];
  json['nodes'] = [{ name: 'generated_model', mesh: 0 }];
  json['scenes'] = [{ nodes: [0] }];
  json['scene'] = 0;
  return b.build();
}
