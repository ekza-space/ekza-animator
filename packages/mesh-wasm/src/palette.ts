// `mesh.paletteBake` (MODELING-PLAN §7.2 G-a, research 15 §5.9 step 9, research 12 L2): the stylized low-poly look
// from a textured model. Every face gets the area-weighted mean of its base colour (texture × factor, averaged in
// linear light at a fixed low-discrepancy pattern of points per triangle); the face colours of every mesh of the job,
// weighted by area, are clustered by k-means in OKLab into at most `colours` swatches; each face's `paint` slot is its
// nearest swatch. The palette is ordered by covered area (slot 0 = the largest), and swatches that round to the same
// 8-bit colour merge. Deterministic: no random seeding (greedy weighted k-means++), fixed iteration order.
import type { MeshData } from '@ekza-studio/mesh-core';
import { BUILTIN_LAYERS, triangulate } from '@ekza-studio/mesh-core';
import { linearToOklab, linearToSrgb8, oklabToLinear, SRGB_TO_LINEAR } from './colour';
import { sampleLinear } from './image';
import type { BaseColourSource, PaletteBakeArgs } from './types';

/** Lloyd iterations at most (stops earlier when no assignment changes). */
export const MAX_KMEANS_ITERATIONS = 64;
/** OKLab quantization step of the histogram the clustering runs on (1/256 per unit: far below a visible step). */
const QUANT = 256;
/** The plastic number's R2 sequence (Roberts 2018): even, deterministic sample points. */
const G = 1.324717957244746;
const A1 = 1 / G;
const A2 = 1 / (G * G);

export interface PaletteMeshIn {
  readonly data: MeshData;
  /** Per face-material slot: the index of its base colour in `sources`, or null (white). */
  readonly materials: readonly (number | null)[];
  /** sRGB per palette slot for a palette-coloured mesh (faces take their `paint` slot's colour), else null. */
  readonly paint?: readonly (readonly [number, number, number] | null)[] | null;
}

export interface PaletteOutcome {
  readonly meshes: readonly MeshData[];
  /** sRGB 8-bit colours by slot. */
  readonly palette: readonly (readonly [number, number, number])[];
  readonly facts: {
    readonly colours: number;
    readonly faces: number;
    readonly distinct: number;
    readonly iterations: number;
    readonly samples: number;
  };
}

/** Barycentric sample points of a triangle (the R2 sequence folded into the triangle). */
export function samplePattern(count: number): Float64Array {
  const n = Math.max(1, Math.floor(count));
  const out = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    let r1 = (0.5 + (i + 1) * A1) % 1;
    let r2 = (0.5 + (i + 1) * A2) % 1;
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    out[3 * i] = 1 - r1 - r2;
    out[3 * i + 1] = r1;
    out[3 * i + 2] = r2;
  }
  return out;
}

/** Area-weighted mean linear base colour of every face (3 per face) and the face areas. */
function faceColours(
  mesh: PaletteMeshIn,
  sources: readonly BaseColourSource[],
  pattern: Float64Array,
): { readonly colour: Float64Array; readonly area: Float64Array } {
  const { data } = mesh;
  const F = data.counts.faces;
  const { tris, triFace } = triangulate(data);
  const colour = new Float64Array(3 * F);
  const area = new Float64Array(F);
  const plain = new Float64Array(3 * F);
  const plainCount = new Uint32Array(F);
  const sample = new Float64Array(3);
  const n = pattern.length / 3;
  const paintLayer = data.layers.get('paint');
  const paintSlots =
    mesh.paint !== null && mesh.paint !== undefined && paintLayer?.def.domain === 'face' ? paintLayer.data : null;
  for (let t = 0; t < tris.length / 3; t++) {
    const f = triFace[t] as number;
    const c0 = tris[3 * t] as number;
    const c1 = tris[3 * t + 1] as number;
    const c2 = tris[3 * t + 2] as number;
    const p0 = data.cornerVert[c0] as number;
    const p1 = data.cornerVert[c1] as number;
    const p2 = data.cornerVert[c2] as number;
    const pos = data.position;
    const ux = (pos[3 * p1] as number) - (pos[3 * p0] as number);
    const uy = (pos[3 * p1 + 1] as number) - (pos[3 * p0 + 1] as number);
    const uz = (pos[3 * p1 + 2] as number) - (pos[3 * p0 + 2] as number);
    const vx = (pos[3 * p2] as number) - (pos[3 * p0] as number);
    const vy = (pos[3 * p2 + 1] as number) - (pos[3 * p0 + 1] as number);
    const vz = (pos[3 * p2 + 2] as number) - (pos[3 * p0 + 2] as number);
    const triArea = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const slot = data.faceMaterial[f] as number;
    const index = mesh.materials[slot] ?? null;
    const source = index === null ? null : (sources[index] ?? null);
    const factor = source?.factor ?? [1, 1, 1, 1];
    const texture = source?.texture ?? null;
    const uv = texture === null ? undefined : data.layers.get(texture.texCoord === 1 ? 'uv1' : 'uv0');
    let r = 0;
    let g = 0;
    let b = 0;
    const swatch = paintSlots === null ? undefined : (mesh.paint?.[paintSlots[f] as number] ?? null);
    if (swatch !== undefined) {
      r = swatch === null ? 1 : (SRGB_TO_LINEAR[swatch[0]] as number);
      g = swatch === null ? 1 : (SRGB_TO_LINEAR[swatch[1]] as number);
      b = swatch === null ? 1 : (SRGB_TO_LINEAR[swatch[2]] as number);
    } else if (texture !== null && uv !== undefined && uv.def.domain === 'corner' && uv.def.comps === 2) {
      const uvs = uv.data;
      for (let i = 0; i < n; i++) {
        const w0 = pattern[3 * i] as number;
        const w1 = pattern[3 * i + 1] as number;
        const w2 = pattern[3 * i + 2] as number;
        const u = w0 * (uvs[2 * c0] as number) + w1 * (uvs[2 * c1] as number) + w2 * (uvs[2 * c2] as number);
        const v =
          w0 * (uvs[2 * c0 + 1] as number) + w1 * (uvs[2 * c1 + 1] as number) + w2 * (uvs[2 * c2 + 1] as number);
        sampleLinear(texture.image, u, v, texture.wrapS, texture.wrapT, sample);
        r += sample[0] as number;
        g += sample[1] as number;
        b += sample[2] as number;
      }
      r = (r / n) * factor[0];
      g = (g / n) * factor[1];
      b = (b / n) * factor[2];
    } else {
      r = factor[0];
      g = factor[1];
      b = factor[2];
    }
    colour[3 * f] = (colour[3 * f] as number) + triArea * r;
    colour[3 * f + 1] = (colour[3 * f + 1] as number) + triArea * g;
    colour[3 * f + 2] = (colour[3 * f + 2] as number) + triArea * b;
    area[f] = (area[f] as number) + triArea;
    plain[3 * f] = (plain[3 * f] as number) + r;
    plain[3 * f + 1] = (plain[3 * f + 1] as number) + g;
    plain[3 * f + 2] = (plain[3 * f + 2] as number) + b;
    plainCount[f] = (plainCount[f] as number) + 1;
  }
  for (let f = 0; f < F; f++) {
    const a = area[f] as number;
    for (let k = 0; k < 3; k++) {
      colour[3 * f + k] =
        a > 0 ? (colour[3 * f + k] as number) / a : (plain[3 * f + k] as number) / Math.max(1, plainCount[f] as number);
    }
  }
  return { colour, area };
}

/** Squared OKLab distance between entry `i` of `a` and entry `j` of `b`. */
const dist2 = (a: Float64Array, i: number, b: Float64Array, j: number): number => {
  const dL = (a[3 * i] as number) - (b[3 * j] as number);
  const da = (a[3 * i + 1] as number) - (b[3 * j + 1] as number);
  const db = (a[3 * i + 2] as number) - (b[3 * j + 2] as number);
  return dL * dL + da * da + db * db;
};

function nearest(points: Float64Array, i: number, centres: Float64Array, k: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let j = 0; j < k; j++) {
    const d = dist2(points, i, centres, j);
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

/**
 * Weighted k-means of OKLab points: greedy k-means++ seeding (the heaviest point first, then the point with the
 * largest weight × squared distance to its nearest centre), Lloyd iterations until no assignment changes.
 */
export function kmeans(
  points: Float64Array,
  weights: Float64Array,
  k: number,
): { readonly centres: Float64Array; readonly weight: Float64Array; readonly iterations: number } {
  const N = weights.length;
  const K = Math.max(1, Math.min(k, N));
  const centres = new Float64Array(3 * K);
  const nearestD = new Float64Array(N).fill(Infinity);
  let first = 0;
  for (let i = 1; i < N; i++) if ((weights[i] as number) > (weights[first] as number)) first = i;
  centres.set(points.subarray(3 * first, 3 * first + 3), 0);
  for (let j = 1; j < K; j++) {
    let pick = -1;
    let score = -1;
    for (let i = 0; i < N; i++) {
      const d = Math.min(nearestD[i] as number, dist2(points, i, centres, j - 1));
      nearestD[i] = d;
      const s = (weights[i] as number) * d;
      if (s > score) {
        score = s;
        pick = i;
      }
    }
    centres.set(points.subarray(3 * pick, 3 * pick + 3), 3 * j);
  }
  const assign = new Int32Array(N).fill(-1);
  const sums = new Float64Array(3 * K);
  const weight = new Float64Array(K);
  let iterations = 0;
  for (; iterations < MAX_KMEANS_ITERATIONS; iterations++) {
    let changed = 0;
    for (let i = 0; i < N; i++) {
      const j = nearest(points, i, centres, K);
      if (assign[i] !== j) {
        assign[i] = j;
        changed++;
      }
    }
    sums.fill(0);
    weight.fill(0);
    for (let i = 0; i < N; i++) {
      const j = assign[i] as number;
      const w = weights[i] as number;
      weight[j] = (weight[j] as number) + w;
      for (let c = 0; c < 3; c++) sums[3 * j + c] = (sums[3 * j + c] as number) + w * (points[3 * i + c] as number);
    }
    for (let j = 0; j < K; j++) {
      const w = weight[j] as number;
      if (w > 0) for (let c = 0; c < 3; c++) centres[3 * j + c] = (sums[3 * j + c] as number) / w;
    }
    if (changed === 0) break;
  }
  return { centres, weight, iterations };
}

/** Bakes the palette of the meshes of one model together (see the module comment). */
export function paletteBake(
  meshes: readonly PaletteMeshIn[],
  sources: readonly BaseColourSource[],
  args: PaletteBakeArgs,
): PaletteOutcome {
  const pattern = samplePattern(args.samples);
  const perMesh = meshes.map((mesh) => faceColours(mesh, sources, pattern));
  // Face colours in OKLab, then a histogram of quantized colours (summed areas, mean colour per bin).
  const bins = new Map<number, number>();
  const binSum: number[] = [];
  const binWeight: number[] = [];
  const lab = new Float64Array(3);
  const faceLab = perMesh.map(({ colour, area }) => {
    const F = area.length;
    const out = new Float64Array(3 * F);
    for (let f = 0; f < F; f++) {
      linearToOklab(colour[3 * f] as number, colour[3 * f + 1] as number, colour[3 * f + 2] as number, lab);
      out.set(lab, 3 * f);
      const key =
        (Math.round((lab[0] as number) * QUANT) + 1024) * 4194304 +
        (Math.round((lab[1] as number) * QUANT) + 1024) * 2048 +
        (Math.round((lab[2] as number) * QUANT) + 1024);
      let bin = bins.get(key);
      if (bin === undefined) {
        bin = binWeight.length;
        bins.set(key, bin);
        binWeight.push(0);
        binSum.push(0, 0, 0);
      }
      const w = Math.max(area[f] as number, 1e-12);
      binWeight[bin] = (binWeight[bin] as number) + w;
      for (let c = 0; c < 3; c++) binSum[3 * bin + c] = (binSum[3 * bin + c] as number) + w * (lab[c] as number);
    }
    return out;
  });
  // Bins in key order (insertion order depends on face order only, which is fixed; sorting makes it explicit).
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const N = keys.length;
  const points = new Float64Array(3 * N);
  const weights = new Float64Array(N);
  keys.forEach((key, i) => {
    const bin = bins.get(key) as number;
    const w = binWeight[bin] as number;
    weights[i] = w;
    for (let c = 0; c < 3; c++) points[3 * i + c] = (binSum[3 * bin + c] as number) / w;
  });
  const k = Math.max(1, Math.min(Math.floor(args.colours), N));
  const { centres, weight, iterations } =
    N === 0 ? { centres: new Float64Array(3), weight: new Float64Array(1), iterations: 0 } : kmeans(points, weights, k);
  // Swatches: live clusters by covered area (ties: darker first), merged when they round to one 8-bit colour.
  const live = Array.from({ length: k }, (_, j) => j).filter((j) => (weight[j] as number) > 0);
  live.sort(
    (a, b) => (weight[b] as number) - (weight[a] as number) || (centres[3 * a] as number) - (centres[3 * b] as number),
  );
  const rgb = new Float64Array(3);
  const palette: [number, number, number][] = [];
  const slotOfCluster = new Int32Array(k).fill(-1);
  const slotOfColour = new Map<number, number>();
  for (const j of live) {
    oklabToLinear(centres[3 * j] as number, centres[3 * j + 1] as number, centres[3 * j + 2] as number, rgb);
    const srgb: [number, number, number] = [
      linearToSrgb8(rgb[0] as number),
      linearToSrgb8(rgb[1] as number),
      linearToSrgb8(rgb[2] as number),
    ];
    const key = srgb[0] * 65536 + srgb[1] * 256 + srgb[2];
    let slot = slotOfColour.get(key);
    if (slot === undefined) {
      slot = palette.length;
      palette.push(srgb);
      slotOfColour.set(key, slot);
    }
    slotOfCluster[j] = slot;
  }
  const liveCentres = new Float64Array(3 * live.length);
  live.forEach((j, i) => liveCentres.set(centres.subarray(3 * j, 3 * j + 3), 3 * i));
  let faces = 0;
  const out = meshes.map(({ data }, m) => {
    const F = data.counts.faces;
    faces += F;
    const labs = faceLab[m] as Float64Array;
    const paint = new Uint16Array(F);
    for (let f = 0; f < F; f++) {
      const i = nearest(labs, f, liveCentres, live.length);
      paint[f] = slotOfCluster[live[i] as number] as number;
    }
    const layers = new Map(data.layers);
    layers.set('paint', { def: data.layers.get('paint')?.def ?? BUILTIN_LAYERS.paint, data: paint });
    return { ...data, layers } satisfies MeshData;
  });
  return {
    meshes: out,
    palette,
    facts: { colours: palette.length, faces, distinct: N, iterations, samples: pattern.length / 3 },
  };
}
