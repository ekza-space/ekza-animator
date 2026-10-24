// Atlas coverage for the palette bake (MODELING-PLAN §7.2 G-a; DECISIONS M7-GA-15): which texels of a base colour
// image lie inside a UV chart. A generator's atlas packs its charts on a background — black, transparent or a dilated
// copy of the chart borders — and a sample whose texels fall there reads a colour the model does not have. The
// coverage is rasterized from the UV triangles of the meshes **as imported** (before the reduce: a reduced triangle can
// reach across a concave chart's gap), one bit per texel whose centre lies inside a triangle; wrap modes map texels
// outside [0, 1] back into the image.
import type { MeshData } from '@ekza-studio/mesh-core';
import { triangulate } from '@ekza-studio/mesh-core';
import { WRAP_CLAMP, WRAP_MIRROR } from './image';

/** One bit (byte) per texel, rows top to bottom: 1 = inside a UV chart. */
export interface Coverage {
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;
  /** Texels inside a chart. */
  readonly covered: number;
}

function wrapIndex(i: number, size: number, mode: number): number {
  if (mode === WRAP_CLAMP) return i < 0 ? 0 : i >= size ? size - 1 : i;
  if (mode === WRAP_MIRROR) {
    const period = 2 * size;
    let k = i % period;
    if (k < 0) k += period;
    return k < size ? k : period - 1 - k;
  }
  let k = i % size;
  if (k < 0) k += size;
  return k;
}

/** The faces of `data` that read the image (their material slot maps to the source) and their UV layer. */
export interface CoverageInput {
  readonly data: MeshData;
  /** Face-material slots whose base colour is the image. */
  readonly slots: ReadonlySet<number>;
  /** `uv0` or `uv1`. */
  readonly layer: string;
}

/**
 * The texels inside the UV triangles of `inputs` on a `width` × `height` image (texel centres at
 * ((x + 0.5) / width, (y + 0.5) / height), glTF's UV origin top-left).
 */
export function uvCoverage(
  width: number,
  height: number,
  inputs: readonly CoverageInput[],
  wrapS: number,
  wrapT: number,
): Coverage {
  const mask = new Uint8Array(width * height);
  let covered = 0;
  for (const { data, slots, layer } of inputs) {
    const uv = data.layers.get(layer);
    if (uv === undefined || uv.def.domain !== 'corner' || uv.def.comps !== 2) continue;
    const uvs = uv.data;
    const { tris, triFace } = triangulate(data);
    for (let t = 0; t < tris.length / 3; t++) {
      if (!slots.has(data.faceMaterial[triFace[t] as number] as number)) continue;
      const c0 = tris[3 * t] as number;
      const c1 = tris[3 * t + 1] as number;
      const c2 = tris[3 * t + 2] as number;
      // Texel space (continuous): x = u·W, y = v·H; centres at k + 0.5.
      const x0 = (uvs[2 * c0] as number) * width;
      const y0 = (uvs[2 * c0 + 1] as number) * height;
      const x1 = (uvs[2 * c1] as number) * width;
      const y1 = (uvs[2 * c1 + 1] as number) * height;
      const x2 = (uvs[2 * c2] as number) * width;
      const y2 = (uvs[2 * c2 + 1] as number) * height;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (!(Math.abs(area) > 1e-12)) continue;
      const sign = area > 0 ? 1 : -1;
      const xmin = Math.floor(Math.min(x0, x1, x2) - 0.5);
      const xmax = Math.ceil(Math.max(x0, x1, x2) - 0.5);
      const ymin = Math.floor(Math.min(y0, y1, y2) - 0.5);
      const ymax = Math.ceil(Math.max(y0, y1, y2) - 0.5);
      // Guard against UVs far outside the image (a broken file): at most four image spans per axis.
      if (xmax - xmin > 4 * width || ymax - ymin > 4 * height) continue;
      for (let y = ymin; y <= ymax; y++) {
        const py = y + 0.5;
        for (let x = xmin; x <= xmax; x++) {
          const px = x + 0.5;
          const e0 = sign * ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0));
          const e1 = sign * ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1));
          const e2 = sign * ((x0 - x2) * (py - y2) - (y0 - y2) * (px - x2));
          if (e0 < 0 || e1 < 0 || e2 < 0) continue;
          const index = wrapIndex(y, height, wrapT) * width + wrapIndex(x, width, wrapS);
          if (mask[index] === 0) {
            mask[index] = 1;
            covered++;
          }
        }
      }
    }
  }
  return { width, height, mask, covered };
}
