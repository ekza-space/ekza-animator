// Swatch shaders → glTF PBR (SHADING-SPEC §4, ADR 0019). Pure functions shared by the author writer and editor-core
// (budget lints count the materials an export writes):
//
// - Lambert (and a swatch without a shader): `metallicFactor` 0, `roughnessFactor` 1, no extension — exactly the
//   factors every static export wrote before shaders.
// - Blinn: `metallicFactor` 0, `roughnessFactor` = clamp(1 − glossiness, 0, 1); `KHR_materials_specular` with
//   `specularFactor` = the largest channel of the linear specular colour and `specularColorFactor` = the linear colour
//   divided by it (white → 1 and [1, 1, 1], the glTF defaults: the standard 4 % dielectric reflectance; black → 0,
//   no specular). The viewport's Blinn-Phong exponent derives from the same roughness (mesh-view shaders).
import { srgb8ToLinear } from '../../mesh/colour';
import type { SwatchShading } from '../../types';

export interface ShaderFactors {
  readonly metallic: number;
  readonly roughness: number;
  /** `KHR_materials_specular` (Blinn only); null writes no extension. */
  readonly specular: { readonly factor: number; readonly colour: readonly [number, number, number] } | null;
}

const LAMBERT: ShaderFactors = { metallic: 0, roughness: 1, specular: null };

/** The glTF factors of a swatch shader (undefined = Lambert). */
export function shaderFactors(shader: SwatchShading | undefined): ShaderFactors {
  if (shader === undefined || shader.shader !== 'blinn') return LAMBERT;
  const gloss = Number.isFinite(shader.glossiness) ? shader.glossiness : 0.5;
  const roughness = Math.min(1, Math.max(0, 1 - gloss));
  const linear = srgb8ToLinear([shader.specular[0], shader.specular[1], shader.specular[2]]);
  const factor = Math.max(linear[0], linear[1], linear[2]);
  const colour: readonly [number, number, number] =
    factor > 0 ? [linear[0] / factor, linear[1] / factor, linear[2] / factor] : [1, 1, 1];
  return { metallic: 0, roughness, specular: { factor, colour } };
}

/**
 * The material group key of a swatch shader: '' for Lambert (one material, as before shaders), else the exported
 * parameters, so swatches with equal shaders share a material.
 */
export function shaderKey(shader: SwatchShading | undefined): string {
  if (shader === undefined || shader.shader !== 'blinn') return '';
  return `blinn:${shader.glossiness}:${shader.specular.join(',')}`;
}

/** The material name suffix of a shader group: 'blinn g50', plus the specular hex when it is not white. */
export function shaderLabel(shader: SwatchShading | undefined): string {
  if (shader === undefined || shader.shader !== 'blinn') return '';
  const hex = shader.specular.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
  return `blinn g${Math.round(shader.glossiness * 100)}${hex === 'ffffff' ? '' : ` #${hex}`}`;
}
