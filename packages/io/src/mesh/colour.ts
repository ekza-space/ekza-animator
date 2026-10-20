// Colour-space helpers of the mesh exports (M6A-SPEC §5.19, research 12 §4.5): swatches are 8-bit sRGB; `COLOR_0`
// and `baseColorFactor` are linear, converted with the exact sRGB EOTF (IEC 61966-2-1).

/** The sRGB electro-optical transfer function of an encoded value in 0…1. */
export function srgbEotf(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

/** Linear RGB of an 8-bit sRGB triple. */
export function srgb8ToLinear(srgb: readonly [number, number, number]): [number, number, number] {
  return [srgbEotf(srgb[0] / 255), srgbEotf(srgb[1] / 255), srgbEotf(srgb[2] / 255)];
}
