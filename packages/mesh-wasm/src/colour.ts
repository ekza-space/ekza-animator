// Colour spaces of the palette bake (MODELING-PLAN §7.2 G-a, research 15 §5.9 step 9): sRGB 8-bit ↔ linear RGB (the
// exact sRGB transfer functions, as `COLOR_0` and the palette writer use them, Q-LP-11) and linear RGB ↔ OKLab
// (Björn Ottosson, 2020: perceptually uniform, so k-means distances match what the eye calls "close").

/** sRGB-encoded 8-bit value → linear [0, 1], by table (exact transfer function). */
export const SRGB_TO_LINEAR: Float64Array = (() => {
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    table[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return table;
})();

/** Linear [0, 1] → sRGB 8-bit integer (rounded, clamped). */
export function linearToSrgb8(value: number): number {
  const c = value <= 0 ? 0 : value >= 1 ? 1 : value;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** Linear RGB → OKLab, written to `out` at `offset` (L, a, b). */
export function linearToOklab(r: number, g: number, b: number, out: Float64Array, offset = 0): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[offset] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[offset + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[offset + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** OKLab → linear RGB (unclamped), written to `out` at `offset`. */
export function oklabToLinear(L: number, a: number, b: number, out: Float64Array, offset = 0): void {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  out[offset] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[offset + 1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[offset + 2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
}
