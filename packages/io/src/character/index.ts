// The character writer (M6B-SPEC §4.4, §5.22; C1 minimal, C10 full): the VRM 1.0 / plain GLB file of a model-sourced
// character, and the in-memory container of its display (§5.1, a plain GLB).
//
// Layout (one glTF Transform document, deterministic: the same input always gives the same bytes):
// - nodes 0…J−1 = the joints in `skeleton` (skeletonFromDoc) order, TRS = the derived rest locals, scale 1; root
//   joints under scene 0;
// - then one node per mesh (identity; names unique among siblings): skinned meshes under scene 0 with the skin,
//   static (unbound) meshes as children of the first root joint;
// - one skin: `joints` = every joint in skeleton order, `skeleton` = node 0, `inverseBindMatrices` = (W⁰_j)⁻¹ float32;
// - primitives from M6a's `meshToPrimitives`, JOINTS_0 remapped from the mesh's palette to the skin order (u8 up to
//   256 joints, else u16), WEIGHTS_0 float32 renormalized; no TANGENT;
// - materials per M6a §5.19 with the swatch shaders of SHADING-SPEC §4 on lit meshes (Lambert: metallic 0 /
//   roughness 1; Blinn: roughness 1 − glossiness and KHR_materials_specular, in extensionsUsed only), unlit meshes
//   with KHR_materials_unlit; `format: 'vrm'` forces the palette texture (MToon ignores vertex colours, Q-LP-0);
// - clips: one animation per `input.clips` entry (tracks on joint nodes, shared input accessors), and
//   `asset.extras.ekza_animation_v1` when the caller passes the clips' metadata;
// - one embedded buffer, no `uri`, `extensionsRequired` never set; `asset.extras` carries `ekza_model_v1` and
//   `ekza.avatar.heightScale` when set;
// - `format: 'vrm'` adds `VRMC_vrm` 1.0 (`./../vrm/extension.ts`): the humanoid map, the meta from
//   `CharacterWriteInput.vrm` (`vrmcMetaOf`: licence URL, presets, thirdPartyLicenses from provenance) and the
//   thumbnail image; `'glb'` writes none.
import { EkzaError, mat4Compose, mat4Invert } from '@ekza-studio/anim-core';
import type { ColourOutput, DerivedFrom } from '@ekza-studio/doc';
import {
  type Buffer,
  Document,
  Logger,
  type Material,
  type Node,
  type Skin,
  type Texture,
  WebIO,
} from '@gltf-transform/core';
import { KHRMaterialsSpecular, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { shaderFactors, shaderKey, shaderLabel } from '../export/author/shading';
import { parseGlb } from '../glb/parse';
import type { DetailedPrimitive } from '../mesh/toPrimitives';
import { MODEL_META_KEY, modelBlock } from '../provenance/model';
import { restWorldsOf } from '../skeleton/rest';
import type {
  CharacterMeshIn,
  CharacterWriteInput,
  EkzaAnimationV1,
  GlbContainer,
  PaletteTexture,
  SwatchShading,
} from '../types';
import { VRMCVrmExtension } from '../vrm/extension';
import { vrmcMetaOf } from '../vrm/meta';
import { InputAccessors } from '../writers/document';
import { type MeshIo, PaletteCache, primitivesOf } from './vertices';

/** Attributes a character primitive writes besides the skin attributes. */
const SURFACE_ATTRIBUTES = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'] as const;
const TYPES = ['SCALAR', 'VEC2', 'VEC3', 'VEC4'] as const;
/** Palette sampler (M6A §5.19): magFilter NEAREST, minFilter LINEAR, wrapS/T CLAMP_TO_EDGE. */
const NEAREST = 9728;
const LINEAR = 9729;
const CLAMP_TO_EDGE = 33071;
/** The generator of synthesized display containers (never exported). */
export const CONTAINER_GENERATOR = 'Ekza Studio character runtime';

export { characterVertices } from './vertices';

/** Options of `writeCharacter` (§4.4; C10 adds the clips' metadata and the provenance of the meta). */
export interface CharacterWriteOptions {
  readonly generator: string;
  readonly format: 'vrm' | 'glb';
  /** `asset.extras.ekza_animation_v1` of the written clips (`outputMeta`; null or absent: none written). */
  readonly animationMeta?: EkzaAnimationV1 | null;
  /** Sources of the character's parts and clips, for `VRMC_vrm.meta.thirdPartyLicenses` when the meta leaves it empty. */
  readonly derivedFrom?: readonly DerivedFrom[];
}

/** Deterministic bytes (stable order, no timestamps). */
export async function writeCharacter(input: CharacterWriteInput, opts: CharacterWriteOptions): Promise<Uint8Array> {
  const mesh = await import('../mesh');
  const vrm = opts.format === 'vrm';
  const doc = new Document();
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const asset = doc.getRoot().getAsset();
  asset.generator = opts.generator;
  const animationMeta = opts.animationMeta ?? null;
  asset.extras = {
    [MODEL_META_KEY]: modelBlock(input.model),
    ...(animationMeta === null ? {} : { ekza_animation_v1: animationMeta }),
    ...(input.heightScale === null ? {} : { ekza: { avatar: { heightScale: input.heightScale } } }),
  };
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  doc.getRoot().setDefaultScene(scene);

  const skeletonNodes = input.skeleton.nodes;
  const joints: Node[] = skeletonNodes.map((node) => {
    const { t, q } = node.restLocal;
    return doc
      .createNode(node.name)
      .setTranslation([t[0], t[1], t[2]])
      .setRotation([q[0], q[1], q[2], q[3]])
      .setScale([1, 1, 1]);
  });
  skeletonNodes.forEach((node, i) => {
    const object = joints[i] as Node;
    const parent = node.parent === -1 ? undefined : joints[node.parent];
    if (parent === undefined) scene.addChild(object);
    else parent.addChild(object);
  });

  let skin: Skin | null = null;
  const skinOf = (): Skin => {
    if (skin !== null) return skin;
    const worlds = restWorldsOf(skeletonNodes, [0, 0, 0, 1]);
    const ibm = new Float32Array(16 * joints.length);
    worlds.forEach((world, i) => {
      const inverse = mat4Invert(mat4Compose({ t: world.t, q: world.q, s: [1, 1, 1] }));
      if (inverse === null) throw new EkzaError('invalid-input', `Joint ${skeletonNodes[i]?.name ?? i} has no inverse`);
      ibm.set(inverse, 16 * i);
    });
    const created = doc
      .createSkin('skin')
      .setInverseBindMatrices(
        doc.createAccessor('inverseBindMatrices').setType('MAT4').setArray(ibm).setBuffer(buffer),
      );
    if (joints[0] !== undefined) created.setSkeleton(joints[0]);
    for (const joint of joints) created.addJoint(joint);
    skin = created;
    return created;
  };

  const materials = new MaterialCache(doc, new PaletteCache(mesh, input.palettes));
  const nodeOfJoint = jointNodeIndex(input);
  const names = new Map<Node | null, Set<string>>();
  for (const source of input.meshes) {
    const bound = source.skin !== null && joints.length > 0;
    const parent = bound ? null : (joints[0] ?? null);
    const node = doc.createNode(uniqueName(names, parent, source.name));
    if (parent === null) scene.addChild(node);
    else parent.addChild(node);
    const gltfMesh = writeMesh(doc, buffer, mesh, materials, source, bound ? nodeOfJoint : null, joints.length, vrm);
    if (gltfMesh === null) continue;
    node.setMesh(gltfMesh);
    if (bound) node.setSkin(skinOf());
  }
  // Every joint is listed by the skin, even without a skinned mesh, so the hierarchy reads back as joints (§5.22).
  if (joints.length > 0) skinOf();

  // Clips (§5.22): tracks on the joint nodes, sampled by the caller through the kernel.
  const inputs = new InputAccessors(doc, buffer);
  for (const clip of input.clips) {
    const animation = doc.createAnimation(clip.name);
    for (const track of clip.tracks) {
      const target = joints[track.node];
      if (target === undefined) continue;
      const output = doc
        .createAccessor()
        .setType(track.path === 'rotation' ? 'VEC4' : 'VEC3')
        .setArray(track.values.slice())
        .setBuffer(buffer);
      const sampler = doc
        .createAnimationSampler()
        .setInput(inputs.get(track.times))
        .setOutput(output)
        .setInterpolation(track.interpolation);
      animation.addSampler(sampler);
      animation.addChannel(
        doc.createAnimationChannel().setTargetNode(target).setTargetPath(track.path).setSampler(sampler),
      );
    }
  }

  if (vrm) {
    const extension = doc.createExtension(VRMCVrmExtension);
    const root = extension.createVrm();
    for (const [bone, index] of Object.entries(input.skeleton.humanoid ?? {})) {
      const node = joints[index];
      if (node !== undefined) root.setBone(bone, node);
    }
    if (input.vrm !== null) {
      root.setMeta(vrmcMetaOf(input.vrm, opts.derivedFrom ?? []));
      if (input.thumbnailPng !== null) {
        root.setThumbnail(doc.createTexture('thumbnail').setImage(input.thumbnailPng).setMimeType('image/png'));
      }
    }
    doc.getRoot().setExtension('VRMC_vrm', root);
  }

  const io = new WebIO().registerExtensions([KHRMaterialsUnlit, KHRMaterialsSpecular, VRMCVrmExtension]);
  return io.writeBinary(doc);
}

/** The in-memory container of a model-sourced character (display and export path, §5.1): a plain GLB, no VRMC_vrm. */
export async function synthesizeContainer(input: CharacterWriteInput): Promise<GlbContainer> {
  return parseGlb(await writeCharacter(input, { generator: CONTAINER_GENERATOR, format: 'glb' }));
}

// ---------------------------------------------------------------------------------------------------------------

/** JointId (palette key) → skin index, through the joint keys (`SkeletonDesc.jointKeys`, unique per skeleton). */
function jointNodeIndex(input: CharacterWriteInput): ReadonlyMap<string, number> {
  const byKey = new Map<string, number>();
  (input.skeleton.jointKeys ?? []).forEach((key, i) => byKey.set(key, i));
  const byName = new Map<string, number>();
  input.skeleton.nodes.forEach((node, i) => {
    if (!byName.has(node.name)) byName.set(node.name, i);
  });
  const out = new Map<string, number>();
  for (const joint of input.joints) {
    const index = byKey.get(joint.key) ?? byName.get(joint.name);
    if (index !== undefined) out.set(joint.id, index);
  }
  return out;
}

function uniqueName(names: Map<Node | null, Set<string>>, parent: Node | null, wanted: string): string {
  let used = names.get(parent);
  if (used === undefined) {
    used = new Set();
    names.set(parent, used);
  }
  let name = wanted;
  for (let k = 2; used.has(name); k++) name = `${wanted} ${k}`;
  used.add(name);
  return name;
}

class MaterialCache {
  private readonly textures = new Map<string, { readonly texture: Texture; readonly palette: PaletteTexture }>();
  private readonly materials = new Map<string, Material>();
  private unlit: KHRMaterialsUnlit | null = null;
  private specular: KHRMaterialsSpecular | null = null;

  constructor(
    private readonly doc: Document,
    readonly palettes: PaletteCache,
  ) {}

  palette(id: string | null): { readonly texture: Texture; readonly palette: PaletteTexture } | null {
    if (id === null) return null;
    const known = this.textures.get(id);
    if (known !== undefined) return known;
    const palette = this.palettes.get(id);
    if (palette === null) return null;
    const texture = this.doc
      .createTexture(`palette ${this.textures.size}`)
      .setImage(palette.png)
      .setMimeType('image/png');
    const entry = { texture, palette };
    this.textures.set(id, entry);
    return entry;
  }

  material(
    preset: { readonly preset: 'unlit' | 'lit'; readonly name: string },
    output: ColourOutput,
    palette: { readonly id: string; readonly texture: Texture } | null,
    colour: readonly [number, number, number] | null,
    swatch: number | null,
    shading: SwatchShading | undefined,
  ): Material {
    // Shaders apply to lit materials only (SHADING-SPEC §4); '' keeps the pre-shader key, name and factors.
    const shader = preset.preset === 'lit' ? shading : undefined;
    const group = shaderKey(shader);
    const key = JSON.stringify([preset.preset, preset.name, output, palette?.id ?? null, swatch, colour]) + group;
    const known = this.materials.get(key);
    if (known !== undefined) return known;
    const label = shaderLabel(shader);
    const name =
      swatch === null ? (label === '' ? preset.name : `${preset.name} ${label}`) : `${preset.name} swatch ${swatch}`;
    const factors = shaderFactors(shader);
    const material = this.doc
      .createMaterial(name)
      .setBaseColorFactor(colour === null ? [1, 1, 1, 1] : [colour[0], colour[1], colour[2], 1])
      .setMetallicFactor(factors.metallic)
      .setRoughnessFactor(factors.roughness);
    if (factors.specular !== null) {
      this.specular ??= this.doc.createExtension(KHRMaterialsSpecular);
      const c = factors.specular.colour;
      material.setExtension(
        'KHR_materials_specular',
        this.specular
          .createSpecular()
          .setSpecularFactor(factors.specular.factor)
          .setSpecularColorFactor([c[0], c[1], c[2]]),
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
      this.unlit ??= this.doc.createExtension(KHRMaterialsUnlit);
      material.setExtension('KHR_materials_unlit', this.unlit.createUnlit());
    }
    this.materials.set(key, material);
    return material;
  }
}

function writeMesh(
  doc: Document,
  buffer: Buffer,
  io: MeshIo,
  materials: MaterialCache,
  source: CharacterMeshIn,
  nodeOfJoint: ReadonlyMap<string, number> | null,
  jointCount: number,
  forcePalette: boolean,
) {
  const { primitives, output, paint, shaderOfSlot } = primitivesOf(io, materials.palettes, source, { forcePalette });
  if (primitives.length === 0) return null;
  const found = output === 'palette-texture' ? materials.palette(source.paletteId) : null;
  const palette = found === null ? null : { id: source.paletteId as string, texture: found.texture };
  const remap =
    nodeOfJoint === null || source.skin === null
      ? null
      : source.skin.palette.map((entry) => nodeOfJoint.get(entry.key) ?? 0);
  // Shader groups by key (the first swatch of each group carries its parameters).
  const byKey = new Map<string, SwatchShading | undefined>();
  const swatches = source.paletteId === null ? [] : (materials.palettes.swatches.get(source.paletteId) ?? []);
  for (const swatch of swatches) {
    const shading = shaderOfSlot(swatch.slot);
    if (!byKey.has(shaderKey(shading))) byKey.set(shaderKey(shading), shading);
  }
  const gltfMesh = doc.createMesh(source.name);
  for (const primitive of primitives) {
    const preset = source.materials[primitive.material] ??
      source.materials[0] ?? { preset: 'unlit' as const, name: source.name };
    const colour =
      output === 'material-per-colour' && primitive.swatch !== null
        ? io.srgb8ToLinear(paint.get(primitive.swatch) ?? paint.get(0) ?? [255, 255, 255])
        : null;
    const shader =
      primitive.swatch !== null
        ? shaderOfSlot(primitive.swatch)
        : primitive.shader === ''
          ? undefined
          : byKey.get(primitive.shader);
    gltfMesh.addPrimitive(
      writePrimitive(
        doc,
        buffer,
        primitive,
        materials.material(preset, output, palette, colour, primitive.swatch, shader),
        remap,
        jointCount,
      ),
    );
  }
  return gltfMesh;
}

function writePrimitive(
  doc: Document,
  buffer: Buffer,
  out: DetailedPrimitive,
  material: Material,
  remap: readonly number[] | null,
  jointCount: number,
) {
  const primitive = doc.createPrimitive().setMode(4).setMaterial(material);
  for (const name of SURFACE_ATTRIBUTES) {
    const data = out.attributes[name];
    if (data === undefined) continue;
    const comps = data.length / out.vertexCount;
    primitive.setAttribute(
      name,
      doc
        .createAccessor()
        .setType(TYPES[comps - 1] ?? 'VEC4')
        .setArray(data.slice())
        .setBuffer(buffer),
    );
  }
  const joints0 = out.attributes['JOINTS_0'];
  const weights0 = out.attributes['WEIGHTS_0'];
  if (remap !== null && joints0 !== undefined && weights0 !== undefined) {
    const joints = jointCount <= 256 ? new Uint8Array(joints0.length) : new Uint16Array(joints0.length);
    for (let i = 0; i < joints0.length; i++) {
      // Unused slots (weight 0) point at joint 0, like the palette's.
      joints[i] = (weights0[i] as number) > 0 ? (remap[joints0[i] as number] ?? 0) : 0;
    }
    primitive.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
    primitive.setAttribute(
      'WEIGHTS_0',
      doc
        .createAccessor()
        .setType('VEC4')
        .setArray(renormalized(weights0 as Float32Array))
        .setBuffer(buffer),
    );
  }
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(out.indices.slice()).setBuffer(buffer));
  return primitive;
}

/**
 * WEIGHTS_0 renormalized after the float32 rounding (§5.22): each vertex's four weights sum to 1 as closely as float32
 * allows, the residual going to its largest weight. A vertex without weight stays all-zero.
 */
export function renormalized(weights: Float32Array): Float32Array<ArrayBuffer> {
  const out = Float32Array.from(weights);
  for (let v = 0; v + 3 < out.length; v += 4) {
    let sum = 0;
    let largest = v;
    for (let k = v; k < v + 4; k++) {
      sum += out[k] as number;
      if ((out[k] as number) > (out[largest] as number)) largest = k;
    }
    if (sum <= 0) continue;
    for (let k = v; k < v + 4; k++) out[k] = Math.fround((out[k] as number) / sum);
    let rest = 1;
    for (let k = v; k < v + 4; k++) if (k !== largest) rest -= out[k] as number;
    out[largest] = Math.fround(rest);
  }
  return out;
}
