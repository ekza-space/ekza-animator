// Images of the intake chain: base colour sampling for the palette bake and the deterministic downsample of
// `mesh.textureDownsize` (MODELING-PLAN §7.2 G-a). Pixels are RGBA8, rows top to bottom, so glTF's UV (0, 0) is the
// top-left texel; colours are sRGB-encoded and every average happens in linear light.
import { linearToSrgb8, SRGB_TO_LINEAR } from './colour';
import type { RgbaImage } from './types';

/** glTF sampler wrap modes. */
export const WRAP_REPEAT = 10497;
export const WRAP_CLAMP = 33071;
export const WRAP_MIRROR = 33648;

function wrap(i: number, size: number, mode: number): number {
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

/**
 * The linear RGB of `image` at texture coordinate (u, v), bilinear between texel centres, written to `out` (3 values
 * at `offset`); alpha is ignored (the bake reads base colour only).
 */
export function sampleLinear(
  image: RgbaImage,
  u: number,
  v: number,
  wrapS: number,
  wrapT: number,
  out: Float64Array,
  offset = 0,
): void {
  const { width: W, height: H, rgba } = image;
  const x = u * W - 0.5;
  const y = v * H - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = wrap(x0, W, wrapS);
  const xb = wrap(x0 + 1, W, wrapS);
  const ya = wrap(y0, H, wrapT);
  const yb = wrap(y0 + 1, H, wrapT);
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const p00 = 4 * (ya * W + xa);
  const p10 = 4 * (ya * W + xb);
  const p01 = 4 * (yb * W + xa);
  const p11 = 4 * (yb * W + xb);
  for (let c = 0; c < 3; c++) {
    out[offset + c] =
      w00 * (SRGB_TO_LINEAR[rgba[p00 + c] as number] as number) +
      w10 * (SRGB_TO_LINEAR[rgba[p10 + c] as number] as number) +
      w01 * (SRGB_TO_LINEAR[rgba[p01 + c] as number] as number) +
      w11 * (SRGB_TO_LINEAR[rgba[p11 + c] as number] as number);
  }
}

/** The size an image takes under a longest-side limit (aspect kept, at least 1 × 1); the same size when it fits. */
export function fittedSize(width: number, height: number, maxSize: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSize) return { width, height };
  const scale = maxSize / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Downsamples `image` so that its longest side is at most `maxSize`: an area (box) filter in linear light for RGB
 * and plain area averaging for alpha. Pure integer-indexed arithmetic, so the same pixels give the same bytes on
 * every platform (unlike a browser canvas resize). Returns `image` itself when it already fits.
 */
export function downsample(image: RgbaImage, maxSize: number): RgbaImage {
  const { width: W, height: H, rgba } = image;
  const { width: w, height: h } = fittedSize(W, H, maxSize);
  if (w === W && h === H) return image;
  const out = new Uint8Array(4 * w * h);
  const sx = W / w;
  const sy = H / h;
  const acc = new Float64Array(4);
  for (let y = 0; y < h; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      acc.fill(0);
      let total = 0;
      for (let py = Math.floor(y0); py < Math.min(H, Math.ceil(y1)); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        if (wy <= 0) continue;
        for (let px = Math.floor(x0); px < Math.min(W, Math.ceil(x1)); px++) {
          const wx = Math.min(x1, px + 1) - Math.max(x0, px);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const p = 4 * (py * W + px);
          acc[0] = (acc[0] as number) + weight * (SRGB_TO_LINEAR[rgba[p] as number] as number);
          acc[1] = (acc[1] as number) + weight * (SRGB_TO_LINEAR[rgba[p + 1] as number] as number);
          acc[2] = (acc[2] as number) + weight * (SRGB_TO_LINEAR[rgba[p + 2] as number] as number);
          acc[3] = (acc[3] as number) + weight * (rgba[p + 3] as number);
          total += weight;
        }
      }
      const o = 4 * (y * w + x);
      out[o] = linearToSrgb8((acc[0] as number) / total);
      out[o + 1] = linearToSrgb8((acc[1] as number) / total);
      out[o + 2] = linearToSrgb8((acc[2] as number) / total);
      out[o + 3] = Math.max(0, Math.min(255, Math.round((acc[3] as number) / total)));
    }
  }
  return { width: w, height: h, rgba: out };
}
