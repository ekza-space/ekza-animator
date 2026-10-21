// The author GLB writer for static models (M6A-SPEC §4.5, §5.19, §5.22; research 12 §10.1), lazy `io/write` entry:
// a fresh glTF Transform document (never three's exporter) with one buffer, one scene, TRS nodes, and per mesh one
// primitive per material slot (per slot and swatch for 'material-per-colour'), written from `meshToPrimitives`:
//
// - 'palette-texture' (default): one material per (slot preset, palette) with the palette PNG as base colour texture
//   (NEAREST/LINEAR, CLAMP_TO_EDGE) and every painted face's corners at its cell centre;
// - 'vertex-colour': COLOR_0 linear, base colour white, no texture;
// - 'material-per-colour': one material per used swatch, base colour factor = its linear colour.
//
// Materials: preset 'unlit' (default; KHR_materials_unlit in extensionsUsed, never required; metallic 0, roughness 1)
// or 'lit', where each swatch's shader applies (SHADING-SPEC §4, `./shading`): Lambert metallic 0 / roughness 1,
// Blinn roughness 1 − glossiness with KHR_materials_specular (in extensionsUsed, never required); faces of different
// shaders split into one material per shader group (sharing the palette PNG for 'palette-texture'). Lambert-only
// scenes write exactly the bytes they wrote before shaders. Skin layers are not written (static models). `asset.extras` carries `ekza_model_v1` and, for a handheld
// export root, `ekza_handheld_v1`. Deterministic: the same scene always gives the same bytes.
import type { ColourOutput } from '@ekza-studio/doc';
import { type Buffer, Document, type Material, type Node, type Texture, Logger, WebIO } from '@gltf-transform/core';
import { KHRMaterialsSpecular, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import type { DetailedPrimitive } from '../../mesh/toPrimitives';
import { HANDHELD_META_KEY, handheldBlock, MODEL_META_KEY, modelBlock } from '../../provenance/model';
import type { PaletteTexture, StaticMaterial, StaticNode, StaticScene, StaticSwatch, SwatchShading } from '../../types';
import { shaderFactors, shaderKey, shaderLabel } from './shading';

/** Attributes a static model writes (skin layers stay out). */
const STATIC_ATTRIBUTES = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'] as const;
const TYPES = ['SCALAR', 'VEC2', 'VEC3', 'VEC4'] as const;
/** Palette sampler (§5.19): magFilter NEAREST, minFilter LINEAR, wrapS/T CLAMP_TO_EDGE. */
const NEAREST = 9728;
const LINEAR = 9729;
const CLAMP_TO_EDGE = 33071;

type Swatches = readonly StaticSwatch[];

export async function writeStaticGlb(scene: StaticScene, opts: { readonly generator: string }): Promise<Uint8Array> {
  const mesh = await import('../../mesh');
  const doc = new Document();
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const asset = doc.getRoot().getAsset();
  asset.generator = opts.generator;
  asset.extras = {
    [MODEL_META_KEY]: modelBlock(scene.model),
    ...(scene.handheld === null ? {} : { [HANDHELD_META_KEY]: handheldBlock(scene.handheld) }),
  };
  const buffer = doc.createBuffer();
  const root = doc.createScene('Scene');
  doc.getRoot().setDefaultScene(root);
  let unlit: KHRMaterialsUnlit | null = null;
  let specular: KHRMaterialsSpecular | null = null;
  const textures = new Map<string, { readonly texture: Texture; readonly palette: PaletteTexture }>();
  const materials = new Map<string, Material>();

  const paletteOf = (id: string): { readonly texture: Texture; readonly palette: PaletteTexture } | null => {
    const known = textures.get(id);
    if (known !== undefined) return known;
    const swatches = scene.palettes.get(id);
    if (swatches === undefined) return null;
    const palette = mesh.writePaletteTexture(swatches);
    const texture = doc.createTexture(`palette ${textures.size}`).setImage(palette.png).setMimeType('image/png');
    const entry = { texture, palette };
    textures.set(id, entry);
    return entry;
  };

  const materialOf = (
    preset: StaticMaterial,
    output: ColourOutput,
    palette: { readonly id: string; readonly texture: Texture } | null,
    colour: readonly [number, number, number] | null,
    swatch: number | null,
    shading: SwatchShading | undefined,
  ): Material => {
    // Shaders apply to lit materials only (SHADING-SPEC §4); '' keeps the pre-shader key, name and factors.
    const shader = preset.preset === 'lit' ? shading : undefined;
    const group = shaderKey(shader);
    const key = JSON.stringify([preset.preset, preset.name, output, palette?.id ?? null, swatch, colour]) + group;
    const known = materials.get(key);
    if (known !== undefined) return known;
    const label = shaderLabel(shader);
    const name =
      swatch === null ? (label === '' ? preset.name : `${preset.name} ${label}`) : `${preset.name} swatch ${swatch}`;
    const factors = shaderFactors(shader);
    const material = doc
      .createMaterial(name)
      .setBaseColorFactor(colour === null ? [1, 1, 1, 1] : [colour[0], colour[1], colour[2], 1])
      .setMetallicFactor(factors.metallic)
      .setRoughnessFactor(factors.roughness);
    if (factors.specular !== null) {
      specular ??= doc.createExtension(KHRMaterialsSpecular);
      const c = factors.specular.colour;
      material.setExtension(
        'KHR_materials_specular',
        specular.createSpecular().setSpecularFactor(factors.specular.factor).setSpecularColorFactor([c[0], c[1], c[2]]),
      );
    }
    if (palette !== null) {
      material.setBaseColorTexture(palette.texture);
      material
        .getBaseColorTextureInfo()
        ?.setMagFilter(NEAREST)
        .setMinFilter(LINEAR)
        .setWrapS(CLAMP_TO_EDGE)
        .setWrapT(CLAMP_TO_EDGE);
    }
    if (preset.preset === 'unlit') {
      unlit ??= doc.createExtension(KHRMaterialsUnlit);
      material.setExtension('KHR_materials_unlit', unlit.createUnlit());
    }
    materials.set(key, material);
    return material;
  };

  const visit = (node: StaticNode, parent: Node | null): void => {
    const { t, q, s } = node.placement;
    const out = doc
      .createNode(node.name)
      .setTranslation([t[0], t[1], t[2]])
      .setRotation([q[0], q[1], q[2], q[3]])
      .setScale([s[0], s[1], s[2]]);
    if (parent === null) root.addChild(out);
    else parent.addChild(out);
    if (node.mesh !== null) {
      const source = node.mesh;
      const swatches: Swatches = source.paletteId === null ? [] : (scene.palettes.get(source.paletteId) ?? []);
      let output = source.colourOutput;
      let palette: { readonly id: string; readonly texture: Texture; readonly palette: PaletteTexture } | null = null;
      if (output === 'palette-texture') {
        const found = source.paletteId === null ? null : paletteOf(source.paletteId);
        if (found === null) output = 'vertex-colour';
        else palette = { id: source.paletteId as string, ...found };
      }
      const paint = new Map(swatches.map((swatch) => [swatch.slot, swatch.srgb] as const));
      // A slot listed twice keeps its first entry (like the palette texture).
      const shading = new Map<number, SwatchShading | undefined>();
      for (const swatch of swatches) if (!shading.has(swatch.slot)) shading.set(swatch.slot, swatch.shader);
      const byKey = new Map<string, SwatchShading | undefined>();
      for (const shader of shading.values()) if (!byKey.has(shaderKey(shader))) byKey.set(shaderKey(shader), shader);
      const lit = source.materials.some((material) => material.preset === 'lit');
      // A slot without a live swatch exports with slot 0's (as its colour does).
      const shaderOfSlot = (slot: number): SwatchShading | undefined =>
        shading.has(slot) ? shading.get(slot) : shading.get(0);
      const result = mesh.meshToPrimitivesDetailed(source.data, {
        colourOutput: output,
        palette: palette?.palette ?? null,
        paint: swatches.length === 0 && output === 'vertex-colour' ? null : paint,
        morphNormals: new Set(),
        hadTangents: false,
        dropTangents: false,
        shaderOf: lit ? (slot) => shaderKey(shaderOfSlot(slot)) : null,
      });
      if ('refused' in result) throw new Error(result.reason);
      const gltfMesh = doc.createMesh(node.name);
      let targets = 0;
      for (const primitive of result.primitives) {
        const preset = source.materials[primitive.material] ??
          source.materials[0] ?? { preset: 'unlit', name: node.name };
        const colour =
          output === 'material-per-colour' && primitive.swatch !== null
            ? mesh.srgb8ToLinear(paint.get(primitive.swatch) ?? paint.get(0) ?? [255, 255, 255])
            : null;
        const shader =
          primitive.swatch !== null
            ? shaderOfSlot(primitive.swatch)
            : primitive.shader === ''
              ? undefined
              : byKey.get(primitive.shader);
        gltfMesh.addPrimitive(
          writePrimitive(doc, buffer, primitive, materialOf(preset, output, palette, colour, primitive.swatch, shader)),
        );
        targets = primitive.targets.length;
      }
      if (targets > 0) gltfMesh.setWeights(Array.from({ length: targets }, () => 0));
      out.setMesh(gltfMesh);
    }
    for (const child of node.children) visit(child, out);
  };
  for (const node of scene.roots) visit(node, null);
  const io = new WebIO().registerExtensions([KHRMaterialsUnlit, KHRMaterialsSpecular]);
  return io.writeBinary(doc);
}

function writePrimitive(doc: Document, buffer: Buffer, out: DetailedPrimitive, material: Material) {
  const primitive = doc.createPrimitive().setMode(4).setMaterial(material);
  for (const name of STATIC_ATTRIBUTES) {
    const data = out.attributes[name];
    if (data === undefined) continue;
    const comps = data.length / out.vertexCount;
    const accessor = doc
      .createAccessor()
      .setType(TYPES[comps - 1] ?? 'VEC4')
      .setArray(data.slice())
      .setBuffer(buffer);
    primitive.setAttribute(name, accessor);
  }
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(out.indices.slice()).setBuffer(buffer));
  for (const target of out.targets) {
    const morph = doc.createPrimitiveTarget();
    morph.setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(target.POSITION.slice()).setBuffer(buffer),
    );
    if (target.NORMAL !== undefined) {
      morph.setAttribute(
        'NORMAL',
        doc.createAccessor().setType('VEC3').setArray(target.NORMAL.slice()).setBuffer(buffer),
      );
    }
    primitive.addTarget(morph);
  }
  return primitive;
}
