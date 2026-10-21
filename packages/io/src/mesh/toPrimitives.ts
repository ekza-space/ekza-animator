// `meshToPrimitives` (M6A-SPEC §5.21 "meshToPrimitives", §5.19 colour outputs): an edited mesh → glTF primitives.
//
// - One primitive per used material slot (ascending); with 'material-per-colour' one per (slot, swatch); with a
//   `shaderOf` (SHADING-SPEC §4) one per (slot, shader group) for the other outputs ('' = Lambert sorts first).
// - Triangles from the shared triangulation (§5.4); corner keys (point, normal, uv0, uv1, colour) deduplicated in
//   first-use order; NORMAL always written (the one normals function, custom normals included).
// - Colour outputs: 'asset' keeps uv0/uv1/color0 as they are (made-editable meshes); 'palette-texture' gives every
//   corner of a painted face the UV of its swatch cell; 'vertex-colour' writes COLOR_0 VEC3 linear from the swatch
//   through the sRGB EOTF; 'material-per-colour' groups faces by swatch. uv0 from projections is written for the
//   last two only. A face painting a slot without a live swatch takes slot 0's colour.
// - Indices uint16 below 65,536 vertices, else uint32. JOINTS_0 u8 (u16 when the palette has more than 255 joints) and
//   WEIGHTS_0 float32 renormalized after float32 rounding.
// - Morph targets in manifest order with POSITION deltas; NORMAL deltas are derived for the targets listed in
//   `morphNormals`: geometric corner normals of base + delta minus those of the base (custom normals left out, so the
//   delta is the shape's own change on top of the stored normal; non-finite values become 0).
// - A mesh whose original primitives had TANGENT is refused unless `dropTangents` (the generator arrives in M7).
import type { ColourOutput } from '@ekza-studio/doc';
import type { MeshData } from '@ekza-studio/mesh-core';
import type { PaletteTexture, PrimitiveOut } from '../types';
import { srgb8ToLinear } from './colour';
import { computeNormals, triangulate } from './kernel';

export const TANGENT_REFUSAL =
  'This mesh had tangents: tangent generation arrives with mesh-wasm in M7. Export with "drop tangents" to continue.';

export interface MeshToPrimitivesOptions {
  readonly colourOutput: ColourOutput | 'asset';
  readonly palette: PaletteTexture | null;
  readonly paint: ReadonlyMap<number, readonly [number, number, number]> | null;
  readonly morphNormals: ReadonlySet<string>;
  readonly hadTangents: boolean;
  readonly dropTangents: boolean;
  /**
   * The shader group key of a slot (SHADING-SPEC §4; '' = Lambert): faces of different groups go to different
   * primitives (materials) for 'palette-texture' and 'vertex-colour'. Absent or null: no split.
   */
  readonly shaderOf?: ((slot: number) => string) | null;
}

/** A primitive with what the writers need beyond `PrimitiveOut`. */
export interface DetailedPrimitive extends PrimitiveOut {
  /** 'material-per-colour': the swatch slot of the group; else null. */
  readonly swatch: number | null;
  /** The shader group key of the primitive's faces ('' = Lambert or no split; SHADING-SPEC §4). */
  readonly shader: string;
  readonly vertexCount: number;
  /** Morph target names in manifest order (the order of `targets`). */
  readonly targetNames: readonly string[];
}

export type TangentRefusal = { readonly refused: true; readonly code: 'tangents'; readonly reason: string };

export function meshToPrimitives(
  data: MeshData,
  opts: MeshToPrimitivesOptions,
): { readonly primitives: readonly PrimitiveOut[]; readonly materialsUsed: readonly number[] } | TangentRefusal {
  return meshToPrimitivesDetailed(data, opts);
}

const MORPH_PREFIX = 'morph:';

export function meshToPrimitivesDetailed(
  data: MeshData,
  opts: MeshToPrimitivesOptions,
): { readonly primitives: readonly DetailedPrimitive[]; readonly materialsUsed: readonly number[] } | TangentRefusal {
  if (opts.hadTangents && !opts.dropTangents) return { refused: true, code: 'tangents', reason: TANGENT_REFUSAL };
  const mode = opts.colourOutput;
  const tri = triangulate(data);
  const normals = computeNormals(data);
  const F = data.counts.faces;
  const paintLayer = data.layers.get('paint');
  const paintOf = (f: number): number => (paintLayer === undefined ? 0 : (paintLayer.data[f] as number));
  const paint = opts.paint;
  const resolveSlot = (slot: number): number => (paint === null || paint.has(slot) || !paint.has(0) ? slot : 0);
  const colourOf = (slot: number): readonly [number, number, number] =>
    paint?.get(resolveSlot(slot)) ?? paint?.get(0) ?? [255, 255, 255];

  const uv0 = mode === 'palette-texture' ? undefined : data.layers.get('uv0');
  const uv1 = data.layers.get('uv1');
  const color0 = mode === 'asset' ? data.layers.get('color0') : undefined;
  if (mode === 'palette-texture' && opts.palette === null) {
    throw new Error('meshToPrimitives: the palette-texture output needs a palette');
  }
  const writeUv = mode === 'palette-texture' || uv0 !== undefined;
  const colourComps = mode === 'vertex-colour' ? 3 : color0 !== undefined ? 4 : 0;
  const skinJoints = data.layers.get('skin.joints');
  const skinWeights = data.layers.get('skin.weights');
  const skinned = skinJoints !== undefined && skinWeights !== undefined;
  const morphs = [...data.layers.values()].filter((layer) => layer.def.name.startsWith(MORPH_PREFIX));
  const targetNames = morphs.map((layer) => layer.def.name.slice(MORPH_PREFIX.length));

  // Group the faces' triangles by (material slot, swatch) or (material slot, shader group).
  const perColour = mode === 'material-per-colour';
  const shaderOf = !perColour && mode !== 'asset' ? (opts.shaderOf ?? null) : null;
  const groups = new Map<
    string,
    { readonly material: number; readonly swatch: number | null; readonly shader: string; readonly tris: number[] }
  >();
  for (let f = 0; f < F; f++) {
    const material = data.faceMaterial[f] as number;
    const swatch = perColour ? resolveSlot(paintOf(f)) : null;
    const shader = shaderOf === null ? '' : shaderOf(resolveSlot(paintOf(f)));
    const key = `${material}:${swatch ?? ''}:${shader}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { material, swatch, shader, tris: [] };
      groups.set(key, group);
    }
    for (let t = tri.faceTriStart[f] as number; t < (tri.faceTriStart[f + 1] as number); t++) group.tris.push(t);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      a.material - b.material ||
      (a.swatch ?? 0) - (b.swatch ?? 0) ||
      (a.shader < b.shader ? -1 : a.shader > b.shader ? 1 : 0),
  );

  // Morph normal deltas: geometric normals (custom normals left out) of the base and of each target's shape.
  const needsMorphNormals = targetNames.some((name) => wantsNormals(opts.morphNormals, name));
  let baseGeometric: Float32Array | null = null;
  const morphedNormals: (Float32Array | null)[] = morphs.map(() => null);
  if (needsMorphNormals) {
    const plain: MeshData = {
      ...data,
      layers: new Map([...data.layers].filter(([name]) => name !== 'normal.custom')),
    };
    baseGeometric = computeNormals(plain).corner;
    morphs.forEach((layer, t) => {
      if (!wantsNormals(opts.morphNormals, targetNames[t] as string)) return;
      const moved = new Float32Array(data.position.length);
      for (let i = 0; i < moved.length; i++) {
        moved[i] = (data.position[i] as number) + (layer.data[i] as number);
      }
      morphedNormals[t] = computeNormals({ ...plain, position: moved }).corner;
    });
  }

  const paletteSize = skinned ? jointPaletteSize(skinJoints.def.meta, skinJoints.data, data.counts.points) : 0;
  const cornerFace = new Uint32Array(data.counts.corners);
  for (let f = 0; f < F; f++) {
    for (let t = tri.faceTriStart[f] as number; t < (tri.faceTriStart[f + 1] as number); t++) {
      for (let i = 0; i < 3; i++) cornerFace[tri.tris[3 * t + i] as number] = f;
    }
  }

  const keyWords = 1 + 3 + (writeUv ? 2 : 0) + (uv1 !== undefined ? 2 : 0) + colourComps;
  const keyBuffer = new Float32Array(keyWords);
  const keyBits = new Uint32Array(keyBuffer.buffer);
  const uvScratch: [number, number] = [0, 0];
  const colourScratch: number[] = [0, 0, 0, 0];

  /** Fills the key of corner `c` (point, then float bits of normal, uv, uv1, colour). */
  const keyOf = (c: number): void => {
    const f = cornerFace[c] as number;
    let o = 0;
    keyBits[o++] = data.cornerVert[c] as number;
    for (let k = 0; k < 3; k++) keyBuffer[o++] = normals.corner[3 * c + k] as number;
    if (writeUv) {
      uvOfCorner(c, f, uvScratch);
      keyBuffer[o++] = uvScratch[0];
      keyBuffer[o++] = uvScratch[1];
    }
    if (uv1 !== undefined) {
      keyBuffer[o++] = uv1.data[2 * c] as number;
      keyBuffer[o++] = uv1.data[2 * c + 1] as number;
    }
    if (colourComps > 0) {
      colourOfCorner(c, f, colourScratch);
      for (let k = 0; k < colourComps; k++) keyBuffer[o++] = colourScratch[k] as number;
    }
  };
  const uvOfCorner = (c: number, f: number, out: [number, number]): void => {
    if (mode === 'palette-texture') {
      const [u, v] = (opts.palette as PaletteTexture).uvOf(paintOf(f));
      out[0] = u;
      out[1] = v;
    } else if (uv0 !== undefined) {
      out[0] = uv0.data[2 * c] as number;
      out[1] = uv0.data[2 * c + 1] as number;
    }
  };
  const linearBySlot = new Map<number, [number, number, number]>();
  const colourOfCorner = (c: number, f: number, out: number[]): void => {
    if (mode === 'vertex-colour') {
      const slot = paintOf(f);
      let linear = linearBySlot.get(slot);
      if (linear === undefined) {
        linear = srgb8ToLinear(colourOf(slot));
        linearBySlot.set(slot, linear);
      }
      out[0] = linear[0];
      out[1] = linear[1];
      out[2] = linear[2];
    } else if (color0 !== undefined) {
      for (let k = 0; k < 4; k++) out[k] = color0.data[4 * c + k] as number;
    }
  };

  const primitives: DetailedPrimitive[] = [];
  for (const group of ordered) {
    const corners = group.tris.length * 3;
    const firstCorner: number[] = [];
    const vertexOfCorner = new Uint32Array(corners);
    const keys: number[] = [];
    const heads = new Map<number, number>();
    const chain: number[] = [];
    for (let i = 0; i < corners; i++) {
      const c = tri.tris[3 * (group.tris[Math.floor(i / 3)] as number) + (i % 3)] as number;
      keyOf(c);
      let h = 0x811c9dc5;
      for (let k = 0; k < keyWords; k++) h = Math.imul(h ^ (keyBits[k] as number), 0x01000193);
      let found = -1;
      for (let u = heads.get(h) ?? -1; u !== -1; u = chain[u] as number) {
        let same = true;
        for (let k = 0; k < keyWords; k++) {
          if (keys[u * keyWords + k] !== keyBits[k]) {
            same = false;
            break;
          }
        }
        if (same) {
          found = u;
          break;
        }
      }
      if (found === -1) {
        found = firstCorner.length;
        firstCorner.push(c);
        for (let k = 0; k < keyWords; k++) keys.push(keyBits[k] as number);
        chain.push(heads.get(h) ?? -1);
        heads.set(h, found);
      }
      vertexOfCorner[i] = found;
    }
    const n = firstCorner.length;
    const attributes: Record<string, Float32Array | Uint16Array | Uint8Array> = {};
    const position = new Float32Array(3 * n);
    const normal = new Float32Array(3 * n);
    const uv = writeUv ? new Float32Array(2 * n) : null;
    const uvB = uv1 !== undefined ? new Float32Array(2 * n) : null;
    const colour = colourComps > 0 ? new Float32Array(colourComps * n) : null;
    for (let v = 0; v < n; v++) {
      const c = firstCorner[v] as number;
      const f = cornerFace[c] as number;
      const p = data.cornerVert[c] as number;
      for (let k = 0; k < 3; k++) {
        position[3 * v + k] = data.position[3 * p + k] as number;
        normal[3 * v + k] = normals.corner[3 * c + k] as number;
      }
      if (uv !== null) {
        uvOfCorner(c, f, uvScratch);
        uv[2 * v] = uvScratch[0];
        uv[2 * v + 1] = uvScratch[1];
      }
      if (uvB !== null && uv1 !== undefined) {
        uvB[2 * v] = uv1.data[2 * c] as number;
        uvB[2 * v + 1] = uv1.data[2 * c + 1] as number;
      }
      if (colour !== null) {
        colourOfCorner(c, f, colourScratch);
        for (let k = 0; k < colourComps; k++) colour[colourComps * v + k] = colourScratch[k] as number;
      }
    }
    attributes['POSITION'] = position;
    attributes['NORMAL'] = normal;
    if (uv !== null) attributes['TEXCOORD_0'] = uv;
    if (uvB !== null) attributes['TEXCOORD_1'] = uvB;
    if (colour !== null) attributes['COLOR_0'] = colour;
    if (skinned) {
      const joints = paletteSize > 255 ? new Uint16Array(4 * n) : new Uint8Array(4 * n);
      const weights = new Float32Array(4 * n);
      for (let v = 0; v < n; v++) {
        const p = data.cornerVert[firstCorner[v] as number] as number;
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          joints[4 * v + k] = skinJoints.data[4 * p + k] as number;
          const w = Math.fround(skinWeights.data[4 * p + k] as number);
          weights[4 * v + k] = w;
          sum += w;
        }
        if (sum > 0) for (let k = 0; k < 4; k++) weights[4 * v + k] = Math.fround((weights[4 * v + k] as number) / sum);
      }
      attributes['JOINTS_0'] = joints;
      attributes['WEIGHTS_0'] = weights;
    }
    const indices = n < 65_536 ? new Uint16Array(corners) : new Uint32Array(corners);
    indices.set(vertexOfCorner);
    const targets = morphs.map((layer, t) => {
      const delta = new Float32Array(3 * n);
      for (let v = 0; v < n; v++) {
        const p = data.cornerVert[firstCorner[v] as number] as number;
        for (let k = 0; k < 3; k++) delta[3 * v + k] = layer.data[3 * p + k] as number;
      }
      const target: Record<'POSITION' | 'NORMAL', Float32Array> = { POSITION: delta } as Record<
        'POSITION' | 'NORMAL',
        Float32Array
      >;
      const morphed = morphedNormals[t];
      if (morphed !== null && morphed !== undefined && baseGeometric !== null) {
        const deltaNormal = new Float32Array(3 * n);
        for (let v = 0; v < n; v++) {
          const c = firstCorner[v] as number;
          for (let k = 0; k < 3; k++) {
            const d = (morphed[3 * c + k] as number) - (baseGeometric[3 * c + k] as number);
            deltaNormal[3 * v + k] = Number.isFinite(d) ? d : 0;
          }
        }
        target.NORMAL = deltaNormal;
      }
      return target;
    });
    primitives.push({
      material: group.material,
      attributes,
      indices,
      targets,
      swatch: group.swatch,
      shader: group.shader,
      vertexCount: n,
      targetNames,
    });
  }
  const materialsUsed = [...new Set(ordered.map((group) => group.material))];
  return { primitives, materialsUsed };
}

function wantsNormals(set: ReadonlySet<string>, name: string): boolean {
  return set.has(name) || set.has(`${MORPH_PREFIX}${name}`);
}

/** Joint palette size: the skin meta's joint list, else the largest referenced joint index + 1. */
function jointPaletteSize(
  meta: Readonly<Record<string, unknown>> | undefined,
  joints: ArrayLike<number>,
  points: number,
): number {
  const listed = meta?.['joints'];
  if (Array.isArray(listed)) return listed.length;
  let max = -1;
  for (let i = 0; i < 4 * points; i++) max = Math.max(max, joints[i] as number);
  return max + 1;
}
