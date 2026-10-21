// The export vertex layout of a character's meshes (M6B-SPEC §5.1, §5.22; C1): the primitives exactly as the character
// writer emits them (`meshToPrimitives` with the mesh's colour output and palette), and `characterVertices`, their
// skinned vertices for `skeletonFromDoc(input, {vertices})`. No glTF Transform here: the character-runtime chunk
// measures with it, the writer (behind `io/write`) emits with it.
import { EkzaError } from '@ekza-studio/anim-core';
import type * as MeshIoModule from '../mesh';
import type { DocVertices } from '../skeleton/fromDoc';
import type { CharacterMeshIn, CharacterWriteInput, PaletteTexture } from '../types';

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

/** A mesh's primitives exactly as the writer emits them (one function for the writer and `characterVertices`). */
export function primitivesOf(io: MeshIo, palettes: PaletteCache, source: CharacterMeshIn) {
  const swatches = source.paletteId === null ? [] : (palettes.swatches.get(source.paletteId) ?? []);
  let output = source.colourOutput;
  let palette: PaletteTexture | null = null;
  if (output === 'palette-texture') {
    palette = palettes.get(source.paletteId);
    if (palette === null) output = 'vertex-colour';
  }
  const paint = new Map(swatches.map((swatch) => [swatch.slot, swatch.srgb] as const));
  const result = io.meshToPrimitivesDetailed(source.data, {
    colourOutput: output,
    palette,
    paint: swatches.length === 0 && output === 'vertex-colour' ? null : paint,
    morphNormals: new Set(),
    hadTangents: false,
    dropTangents: false,
  });
  if ('refused' in result) throw new EkzaError('unsupported', result.reason);
  return { primitives: result.primitives, output, paint };
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
