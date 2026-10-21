// The export vertex layout of a character's meshes (M6B-SPEC §5.1, §5.22; C1): the primitives exactly as the character
// writer emits them (`meshToPrimitives` with the mesh's colour output and palette), and `characterVertices`, their
// skinned vertices for `skeletonFromDoc(input, {vertices})`. No glTF Transform here: the character-runtime chunk
// measures with it, the writer (behind `io/write`) emits with it.
import { EkzaError } from '@ekza-studio/anim-core';
import type * as MeshIoModule from '../mesh';
import type { DocVertices } from '../skeleton/fromDoc';
import { shaderKey } from '../export/author/shading';
import type { CharacterMeshIn, CharacterWriteInput, PaletteTexture, StaticSwatch, SwatchShading } from '../types';

export type MeshIo = typeof MeshIoModule;

/** The palette PNGs of a character's palettes, written once per palette (`writePaletteTexture`). */
export class PaletteCache {
  private readonly cache = new Map<string, PaletteTexture | null>();

  constructor(
    private readonly io: MeshIo,
    readonly swatches: CharacterWriteInput['palettes'],
  ) {}

  get(id: string | null): PaletteTexture | null {
    if (id === null) return null;
    let palette = this.cache.get(id);
    if (palette === undefined) {
      const swatches = this.swatches.get(id);
      palette = swatches === undefined ? null : this.io.writePaletteTexture(swatches);
      this.cache.set(id, palette);
    }
    return palette;
  }
}

/** The swatch shader of every live slot of a palette (SHADING-SPEC §4; a slot listed twice keeps its first entry). */
export function shadingOf(swatches: readonly StaticSwatch[]): Map<number, SwatchShading | undefined> {
  const shading = new Map<number, SwatchShading | undefined>();
  for (const swatch of swatches) if (!shading.has(swatch.slot)) shading.set(swatch.slot, swatch.shader);
  return shading;
}

/**
 * A mesh's primitives exactly as the writer emits them (one function for the writer and `characterVertices`).
 * - `forcePalette` (the VRM writer, §5.22): a mesh with a palette writes the palette texture whatever its colour
 *   output (MToon ignores vertex colours). The vertex split is the same for every output (one vertex per point, slot
 *   and normal), so the measured radii do not change.
 * - Lit meshes split their faces per swatch shader (SHADING-SPEC §4); the palettes' swatches carry `shader` when the
 *   caller passes `StaticSwatch`es (C1's display container passes none: one Lambert group).
 */
export function primitivesOf(
  io: MeshIo,
  palettes: PaletteCache,
  source: CharacterMeshIn,
  opts: { readonly forcePalette?: boolean } = {},
) {
  const swatches: readonly StaticSwatch[] =
    source.paletteId === null ? [] : (palettes.swatches.get(source.paletteId) ?? []);
  let output = source.colourOutput;
  if (opts.forcePalette === true && source.paletteId !== null) output = 'palette-texture';
  let palette: PaletteTexture | null = null;
  if (output === 'palette-texture') {
    palette = palettes.get(source.paletteId);
    if (palette === null) output = 'vertex-colour';
  }
  const paint = new Map(swatches.map((swatch) => [swatch.slot, swatch.srgb] as const));
  const shading = shadingOf(swatches);
  const shaderOfSlot = (slot: number): SwatchShading | undefined =>
    shading.has(slot) ? shading.get(slot) : shading.get(0);
  const lit = source.materials.some((material) => material.preset === 'lit');
  const result = io.meshToPrimitivesDetailed(source.data, {
    colourOutput: output,
    palette,
    paint: swatches.length === 0 && output === 'vertex-colour' ? null : paint,
    morphNormals: new Set(),
    hadTangents: false,
    dropTangents: false,
    shaderOf: lit ? (slot) => shaderKey(shaderOfSlot(slot)) : null,
  });
  if ('refused' in result) throw new EkzaError('unsupported', result.reason);
  return { primitives: result.primitives, output, paint, shaderOfSlot };
}

/**
 * The export vertices of each skinned mesh (POSITION, JOINTS_0 as palette indices, WEIGHTS_0) in the writer's layout,
 * for `skeletonFromDoc(input, {vertices})`: the radii then equal what skeletonFromGltf measures on the written file.
 * Synchronous once the `io/mesh` module is loaded (pass it in).
 */
export function characterVertices(
  io: MeshIo,
  meshes: readonly CharacterMeshIn[],
  palettes: CharacterWriteInput['palettes'],
): Map<string, DocVertices> {
  const cache = new PaletteCache(io, palettes);
  const out = new Map<string, DocVertices>();
  for (const source of meshes) {
    if (source.skin === null) continue;
    const { primitives } = primitivesOf(io, cache, source);
    let count = 0;
    for (const primitive of primitives)
      if (primitive.attributes['JOINTS_0'] !== undefined) count += primitive.vertexCount;
    const positions = new Float32Array(3 * count);
    const joints = new Uint16Array(4 * count);
    const weights = new Float32Array(4 * count);
    let at = 0;
    for (const primitive of primitives) {
      const j = primitive.attributes['JOINTS_0'];
      const w = primitive.attributes['WEIGHTS_0'];
      const p = primitive.attributes['POSITION'];
      if (j === undefined || w === undefined || p === undefined) continue;
      positions.set(p.subarray(0, 3 * primitive.vertexCount), 3 * at);
      joints.set(j.subarray(0, 4 * primitive.vertexCount), 4 * at);
      weights.set(w.subarray(0, 4 * primitive.vertexCount), 4 * at);
      at += primitive.vertexCount;
    }
    out.set(source.id, { positions, joints, weights });
  }
  return out;
}
