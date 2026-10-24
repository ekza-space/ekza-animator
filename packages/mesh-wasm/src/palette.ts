// `mesh.paletteBake` (MODELING-PLAN §7.2 G-a, research 15 §5.9 step 9, research 12 L2): the stylized low-poly look
// from a textured model. The base colour (texture × factor, or a palette mesh's swatch) is sampled at a fixed
// low-discrepancy pattern of points per triangle, each sample weighted by its triangle's area; the samples of every
// mesh of the job are clustered by k-means in OKLab into at most `colours` swatches; each face's `paint` slot is the
// swatch its samples cover most (its dominant colour: a striped face keeps a stripe colour instead of their average).
// The palette is ordered by covered area (slot 0 = the largest), and swatches that round to the same 8-bit colour
// merge. Deterministic: no random seeding (greedy weighted k-means++), fixed iteration order.
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

/** The base-colour samples of a mesh: OKLab colour, weight (triangle area / samples) and face of each. */
interface Samples {
  readonly lab: Float64Array;
  readonly weight: Float64Array;
  readonly face: Uint32Array;
}

/** Base colour (texture × factor, or the face's palette swatch) at the pattern's points of every triangle. */
function faceSamples(mesh: PaletteMeshIn, sources: readonly BaseColourSource[], pattern: Float64Array): Samples {
  const { data } = mesh;
  const { tris, triFace } = triangulate(data);
  const T = tris.length / 3;
  const n = pattern.length / 3;
  const lab = new Float64Array(3 * T * n);
  const weight = new Float64Array(T * n);
  const face = new Uint32Array(T * n);
  const sample = new Float64Array(3);
  const paintLayer = data.layers.get('paint');
  const paintSlots =
    mesh.paint !== null && mesh.paint !== undefined && paintLayer?.def.domain === 'face' ? paintLayer.data : null;
  const pos = data.position;
  for (let t = 0; t < T; t++) {
    const f = triFace[t] as number;
    const c0 = tris[3 * t] as number;
    const c1 = tris[3 * t + 1] as number;
    const c2 = tris[3 * t + 2] as number;
    const p0 = data.cornerVert[c0] as number;
    const p1 = data.cornerVert[c1] as number;
    const p2 = data.cornerVert[c2] as number;
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
    const swatch = paintSlots === null ? undefined : (mesh.paint?.[paintSlots[f] as number] ?? null);
    const textured =
      swatch === undefined && texture !== null && uv !== undefined && uv.def.domain === 'corner' && uv.def.comps === 2;
    for (let i = 0; i < n; i++) {
      const s = t * n + i;
      let r: number;
      let g: number;
      let b: number;
      if (swatch !== undefined) {
        r = swatch === null ? 1 : (SRGB_TO_LINEAR[swatch[0]] as number);
        g = swatch === null ? 1 : (SRGB_TO_LINEAR[swatch[1]] as number);
        b = swatch === null ? 1 : (SRGB_TO_LINEAR[swatch[2]] as number);
      } else if (textured) {
        const uvs = (uv as NonNullable<typeof uv>).data;
        const w0 = pattern[3 * i] as number;
        const w1 = pattern[3 * i + 1] as number;
        const w2 = pattern[3 * i + 2] as number;
        const u = w0 * (uvs[2 * c0] as number) + w1 * (uvs[2 * c1] as number) + w2 * (uvs[2 * c2] as number);
        const v =
          w0 * (uvs[2 * c0 + 1] as number) + w1 * (uvs[2 * c1 + 1] as number) + w2 * (uvs[2 * c2 + 1] as number);
        const tex = texture as NonNullable<typeof texture>;
        sampleLinear(tex.image, u, v, tex.wrapS, tex.wrapT, sample);
        r = (sample[0] as number) * factor[0];
        g = (sample[1] as number) * factor[1];
        b = (sample[2] as number) * factor[2];
      } else {
        r = factor[0];
        g = factor[1];
        b = factor[2];
      }
      linearToOklab(r, g, b, lab, 3 * s);
      weight[s] = triArea / n;
      face[s] = f;
    }
  }
  return { lab, weight, face };
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
  const perMesh = meshes.map((mesh) => faceSamples(mesh, sources, pattern));
  // A histogram of quantized sample colours (summed weights, mean colour per bin) is what k-means clusters.
  const bins = new Map<number, number>();
  const binSum: number[] = [];
  const binWeight: number[] = [];
  const binOf = perMesh.map(({ lab, weight }) => {
    const S = weight.length;
    const out = new Uint32Array(S);
    for (let s = 0; s < S; s++) {
      const L = lab[3 * s] as number;
      const a = lab[3 * s + 1] as number;
      const b = lab[3 * s + 2] as number;
      const key =
        (Math.round(L * QUANT) + 1024) * 4194304 +
        (Math.round(a * QUANT) + 1024) * 2048 +
        (Math.round(b * QUANT) + 1024);
      let bin = bins.get(key);
      if (bin === undefined) {
        bin = binWeight.length;
        bins.set(key, bin);
        binWeight.push(0);
        binSum.push(0, 0, 0);
      }
      // Degenerate triangles still vote, with a tiny weight.
      const w = Math.max(weight[s] as number, 1e-12);
      binWeight[bin] = (binWeight[bin] as number) + w;
      binSum[3 * bin] = (binSum[3 * bin] as number) + w * L;
      binSum[3 * bin + 1] = (binSum[3 * bin + 1] as number) + w * a;
      binSum[3 * bin + 2] = (binSum[3 * bin + 2] as number) + w * b;
      out[s] = bin;
    }
    return out;
  });
  // Bins in key order (the clustering's input order is then a function of the colours alone).
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const N = keys.length;
  const order = new Uint32Array(binWeight.length);
  const points = new Float64Array(3 * N);
  const weights = new Float64Array(N);
  keys.forEach((key, i) => {
    const bin = bins.get(key) as number;
    order[bin] = i;
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
  const slotOfLive = new Int32Array(live.length);
  const slotOfColour = new Map<number, number>();
  live.forEach((j, i) => {
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
    slotOfLive[i] = slot;
  });
  const liveCentres = new Float64Array(3 * Math.max(1, live.length));
  live.forEach((j, i) => liveCentres.set(centres.subarray(3 * j, 3 * j + 3), 3 * i));
  // Each histogram bin's swatch, then each face's: the swatch its samples cover most (the dominant colour, so a
  // striped face takes its stripe's colour, not their pink average).
  const slotOfBin = new Int32Array(N);
  for (let i = 0; i < N; i++) slotOfBin[i] = slotOfLive[nearest(points, i, liveCentres, live.length)] as number;
  let faces = 0;
  const votes = new Float64Array(Math.max(1, palette.length));
  const out = meshes.map(({ data }, m) => {
    const F = data.counts.faces;
    faces += F;
    const samples = perMesh[m] as Samples;
    const bins = binOf[m] as Uint32Array;
    const paint = new Uint16Array(F);
    let s = 0;
    const S = samples.face.length;
    for (let f = 0; f < F; f++) {
      votes.fill(0);
      for (; s < S && samples.face[s] === f; s++) {
        const slot = slotOfBin[order[bins[s] as number] as number] as number;
        votes[slot] = (votes[slot] as number) + Math.max(samples.weight[s] as number, 1e-12);
      }
      let best = 0;
      for (let j = 1; j < palette.length; j++) if ((votes[j] as number) > (votes[best] as number)) best = j;
      paint[f] = best;
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
