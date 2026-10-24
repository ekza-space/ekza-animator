// `mesh.paletteBake` (MODELING-PLAN §7.2 G-a, research 15 §5.9 step 9, research 12 L2): the stylized low-poly look
// from a textured model. The base colour (texture × factor, or a palette mesh's swatch) is sampled at a fixed
// low-discrepancy pattern of points per triangle, pulled toward the triangle's centroid, each sample weighted by its
// triangle's area. Texture samples take the nearest texel (no filtering: every sample is a colour the image holds) and
// only texels inside the atlas's charts (rasterized from the UV triangles of the meshes as imported) that are not
// transparent: the background between charts — black, transparent or a packer's padding — never votes (M7-GA-15). The valid samples of every mesh of the job are clustered by k-means in
// OKLab into at most `colours` clusters; each face's `paint` slot is the cluster its samples cover most (its dominant
// colour: a striped face keeps a stripe colour instead of their average); a face with no valid sample takes its
// nearest valid neighbour's. Clusters closer than `MERGE_DISTANCE` (noise splits of one colour) merge into the
// heavier; the palette keeps the colours some face uses, ordered by covered area (slot 0 = the largest). Deterministic: no random seeding (greedy weighted
// k-means++), fixed iteration order.
import type { MeshData } from '@ekza-studio/mesh-core';
import { BUILTIN_LAYERS, triangulate } from '@ekza-studio/mesh-core';
import { linearToOklab, linearToSrgb8, oklabToLinear, SRGB_TO_LINEAR } from './colour';
import { type CoverageInput, uvCoverage } from './coverage';
import { sampleNearest } from './image';
import type { BaseColourSource, PaletteBakeArgs } from './types';

/** Lloyd iterations at most (stops earlier when no assignment changes). */
export const MAX_KMEANS_ITERATIONS = 64;
/** OKLab distance under which two clusters are one colour split by texture noise (≈ a just-noticeable step). */
export const MERGE_DISTANCE = 0.03;
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
    /** Samples whose texels were all atlas background (outside the charts or transparent): ignored. */
    readonly backgroundSamples: number;
    /** Faces with no valid sample, coloured from their nearest valid neighbour. */
    readonly filledFaces: number;
    /** k-means clusters no face chose (blends, noise): left out of the palette. */
    readonly unusedClusters: number;
  };
}

/** How far the sample points are pulled toward each triangle's centroid (0 = the whole triangle). */
export const SAMPLE_INSET = 0.25;

/**
 * Barycentric sample points of a triangle: the R2 sequence folded into the triangle, shrunk toward its centroid by
 * `inset`, so no sample sits on an edge (where a UV chart borders the atlas background).
 */
export function samplePattern(count: number, inset = SAMPLE_INSET): Float64Array {
  const n = Math.max(1, Math.floor(count));
  const out = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    let r1 = (0.5 + (i + 1) * A1) % 1;
    let r2 = (0.5 + (i + 1) * A2) % 1;
    if (r1 + r2 > 1) {
      r1 = 1 - r1;
      r2 = 1 - r2;
    }
    const keep = 1 - inset;
    out[3 * i] = keep * (1 - r1 - r2) + inset / 3;
    out[3 * i + 1] = keep * r1 + inset / 3;
    out[3 * i + 2] = keep * r2 + inset / 3;
  }
  return out;
}

/** The base-colour samples of a mesh: OKLab colour, weight (triangle area / samples), face and validity of each. */
interface Samples {
  readonly lab: Float64Array;
  readonly weight: Float64Array;
  readonly face: Uint32Array;
  /** 0 where every texel under the sample is atlas background (outside the charts, or transparent). */
  readonly valid: Uint8Array;
}

/**
 * Base colour (texture × factor, or the face's palette swatch) at the pattern's points of every triangle; texture
 * samples read only texels inside the atlas's charts (`masks`, per source) that are not transparent.
 */
function faceSamples(
  mesh: PaletteMeshIn,
  sources: readonly BaseColourSource[],
  pattern: Float64Array,
  masks: readonly (Uint8Array | null)[],
): Samples {
  const { data } = mesh;
  const { tris, triFace } = triangulate(data);
  const T = tris.length / 3;
  const n = pattern.length / 3;
  const lab = new Float64Array(3 * T * n);
  const weight = new Float64Array(T * n);
  const face = new Uint32Array(T * n);
  const valid = new Uint8Array(T * n);
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
    const mask = index === null ? null : (masks[index] ?? null);
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
        const uvs = uv.data;
        const w0 = pattern[3 * i] as number;
        const w1 = pattern[3 * i + 1] as number;
        const w2 = pattern[3 * i + 2] as number;
        const u = w0 * (uvs[2 * c0] as number) + w1 * (uvs[2 * c1] as number) + w2 * (uvs[2 * c2] as number);
        const v =
          w0 * (uvs[2 * c0 + 1] as number) + w1 * (uvs[2 * c1 + 1] as number) + w2 * (uvs[2 * c2 + 1] as number);
        face[s] = f;
        if (!sampleNearest(texture.image, u, v, texture.wrapS, texture.wrapT, mask, sample)) continue;
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
      valid[s] = 1;
    }
  }
  return { lab, weight, face, valid };
}

/**
 * Faces without a valid sample (all on the atlas background) take the slot of their nearest valid neighbour: a
 * breadth-first fill over shared edges from every assigned face, in face order (deterministic). Returns the faces
 * filled; a mesh with no assigned face at all takes `fallback`.
 */
function fillFromNeighbours(data: MeshData, paint: Int32Array, fallback: number): number {
  const F = data.counts.faces;
  const P = data.counts.points;
  const byEdge = new Map<number, number[]>();
  for (let f = 0; f < F; f++) {
    const first = data.faceCorner[f] as number;
    let c = first;
    let guard = 0;
    do {
      const next = data.cornerNext[c] as number;
      const a = data.cornerVert[c] as number;
      const b = data.cornerVert[next] as number;
      const key = a < b ? a * P + b : b * P + a;
      const list = byEdge.get(key);
      if (list === undefined) byEdge.set(key, [f]);
      else list.push(f);
      c = next;
    } while (c !== first && ++guard <= data.counts.corners);
  }
  const neighbours: number[][] = Array.from({ length: F }, () => []);
  for (const list of byEdge.values()) {
    for (const a of list) for (const b of list) if (a !== b) (neighbours[a] as number[]).push(b);
  }
  const queue: number[] = [];
  for (let f = 0; f < F; f++) if ((paint[f] as number) >= 0) queue.push(f);
  let filled = 0;
  for (let head = 0; head < queue.length; head++) {
    const f = queue[head] as number;
    const near = (neighbours[f] as number[]).slice().sort((x, y) => x - y);
    for (const g of near) {
      if ((paint[g] as number) >= 0) continue;
      paint[g] = paint[f] as number;
      filled++;
      queue.push(g);
    }
  }
  for (let f = 0; f < F; f++) {
    if ((paint[f] as number) < 0) {
      paint[f] = fallback;
      filled++;
    }
  }
  return filled;
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

/** The chart masks of the textured sources: rasterized from `reference` (the meshes as imported). */
function chartMasks(
  meshes: readonly PaletteMeshIn[],
  reference: readonly MeshData[],
  sources: readonly BaseColourSource[],
): (Uint8Array | null)[] {
  return sources.map((source, index) => {
    const texture = source.texture;
    if (texture === null) return null;
    const layer = texture.texCoord === 1 ? 'uv1' : 'uv0';
    const inputs: CoverageInput[] = [];
    meshes.forEach((mesh, m) => {
      const slots = new Set<number>();
      mesh.materials.forEach((source, slot) => {
        if (source === index) slots.add(slot);
      });
      const data = reference[m] ?? mesh.data;
      if (slots.size > 0) inputs.push({ data, slots, layer });
    });
    const coverage = uvCoverage(texture.image.width, texture.image.height, inputs, texture.wrapS, texture.wrapT);
    // No chart at all (no UVs): nothing to mask by.
    return coverage.covered > 0 ? coverage.mask : null;
  });
}

/**
 * Bakes the palette of the meshes of one model together (see the module comment). `reference` holds the meshes as
 * imported (the job's input, before a reduce), whose UV triangles define the atlas's charts; default: `meshes`.
 */
export function paletteBake(
  meshes: readonly PaletteMeshIn[],
  sources: readonly BaseColourSource[],
  args: PaletteBakeArgs,
  reference: readonly MeshData[] = meshes.map((mesh) => mesh.data),
): PaletteOutcome {
  const pattern = samplePattern(args.samples);
  const masks = chartMasks(meshes, reference, sources);
  let perMesh = meshes.map((mesh) => faceSamples(mesh, sources, pattern, masks));
  let invalid = 0;
  for (const samples of perMesh) for (const v of samples.valid) if (v === 0) invalid++;
  if (perMesh.every((samples) => samples.valid.every((v) => v === 0))) {
    // Nothing inside a chart (UVs that do not match the texture): read the texels as they are rather than nothing.
    const none = sources.map(() => null);
    perMesh = meshes.map((mesh) => faceSamples(mesh, sources, pattern, none));
  }
  // A histogram of quantized sample colours (summed weights, mean colour per bin) is what k-means clusters.
  const bins = new Map<number, number>();
  const binSum: number[] = [];
  const binWeight: number[] = [];
  const NO_BIN = 0xffffffff;
  const binOf = perMesh.map(({ lab, weight, valid }) => {
    const S = weight.length;
    const out = new Uint32Array(S).fill(NO_BIN);
    for (let s = 0; s < S; s++) {
      if (valid[s] === 0) continue;
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
  // Candidate swatches: live clusters by covered area (ties: darker first), merged when they round to one 8-bit
  // colour.
  const live = Array.from({ length: k }, (_, j) => j).filter((j) => (weight[j] as number) > 0);
  live.sort(
    (a, b) => (weight[b] as number) - (weight[a] as number) || (centres[3 * a] as number) - (centres[3 * b] as number),
  );
  const rgb = new Float64Array(3);
  const candidates: [number, number, number][] = [];
  const candidateOfLive = new Int32Array(live.length);
  /** The live cluster each candidate keeps its colour from (the heaviest of the clusters merged into it). */
  const keptLive: number[] = [];
  live.forEach((j, i) => {
    // A cluster within a just-noticeable step of a heavier one is the same colour split by texture noise: merged.
    const into = keptLive.findIndex((k) => Math.sqrt(dist2(centres, j, centres, live[k] as number)) < MERGE_DISTANCE);
    if (into !== -1) {
      candidateOfLive[i] = into;
      return;
    }
    oklabToLinear(centres[3 * j] as number, centres[3 * j + 1] as number, centres[3 * j + 2] as number, rgb);
    const srgb: [number, number, number] = [
      linearToSrgb8(rgb[0] as number),
      linearToSrgb8(rgb[1] as number),
      linearToSrgb8(rgb[2] as number),
    ];
    const same = candidates.findIndex((c) => c[0] === srgb[0] && c[1] === srgb[1] && c[2] === srgb[2]);
    if (same !== -1) {
      candidateOfLive[i] = same;
      return;
    }
    candidateOfLive[i] = candidates.length;
    candidates.push(srgb);
    keptLive.push(i);
  });
  const liveCentres = new Float64Array(3 * Math.max(1, live.length));
  live.forEach((j, i) => liveCentres.set(centres.subarray(3 * j, 3 * j + 3), 3 * i));
  // Each histogram bin's candidate, then each face's: the candidate its valid samples cover most (the dominant
  // colour, so a striped face takes its stripe's colour, not their pink average). Faces whose samples all fell on the
  // atlas background take their nearest valid neighbour's.
  const candidateOfBin = new Int32Array(N);
  for (let i = 0; i < N; i++)
    candidateOfBin[i] = candidateOfLive[nearest(points, i, liveCentres, live.length)] as number;
  const votes = new Float64Array(Math.max(1, candidates.length));
  let filled = 0;
  const assigned = meshes.map(({ data }, m) => {
    const F = data.counts.faces;
    const samples = perMesh[m] as Samples;
    const bins = binOf[m] as Uint32Array;
    const paint = new Int32Array(F).fill(-1);
    let s = 0;
    const S = samples.face.length;
    for (let f = 0; f < F; f++) {
      votes.fill(0);
      let any = false;
      for (; s < S && samples.face[s] === f; s++) {
        const bin = bins[s] as number;
        if (bin === NO_BIN) continue;
        const slot = candidateOfBin[order[bin] as number] as number;
        votes[slot] = (votes[slot] as number) + Math.max(samples.weight[s] as number, 1e-12);
        any = true;
      }
      if (!any) continue;
      let best = 0;
      for (let j = 1; j < candidates.length; j++) if ((votes[j] as number) > (votes[best] as number)) best = j;
      paint[f] = best;
    }
    filled += fillFromNeighbours(data, paint, 0);
    return paint;
  });
  // The palette: the candidates some face uses, in their order (unused clusters — blends, noise — are dropped).
  const used = new Uint8Array(candidates.length);
  for (const paint of assigned) for (const slot of paint) used[slot] = 1;
  const slotOfCandidate = new Int32Array(candidates.length).fill(-1);
  const palette: [number, number, number][] = [];
  candidates.forEach((srgb, i) => {
    if (used[i] === 1) {
      slotOfCandidate[i] = palette.length;
      palette.push(srgb);
    }
  });
  let faces = 0;
  const out = meshes.map(({ data }, m) => {
    const F = data.counts.faces;
    faces += F;
    const from = assigned[m] as Int32Array;
    const paint = new Uint16Array(F);
    for (let f = 0; f < F; f++) paint[f] = slotOfCandidate[from[f] as number] as number;
    const layers = new Map(data.layers);
    layers.set('paint', { def: data.layers.get('paint')?.def ?? BUILTIN_LAYERS.paint, data: paint });
    return { ...data, layers } satisfies MeshData;
  });
  return {
    meshes: out,
    palette,
    facts: {
      colours: palette.length,
      faces,
      distinct: N,
      iterations,
      samples: pattern.length / 3,
      backgroundSamples: invalid,
      filledFaces: filled,
      unusedClusters: candidates.length - palette.length,
    },
  };
}
