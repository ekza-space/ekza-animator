// The character writer (M6B-SPEC §4.4, §5.22): C1's minimal writer — the joint hierarchy, one skin, skinned and static
// meshes with palette materials — and the in-memory container of a model-sourced character (display path, §5.1). C10
// extends it to the full VRM 1.0 / GLB writer (meta, licence, thumbnail, clips, swatch shaders, lints).
//
// Layout (one glTF Transform document, deterministic: the same input always gives the same bytes):
// - nodes 0…J−1 = the joints in `skeleton` (skeletonFromDoc) order, TRS = the derived rest locals, scale 1; root
//   joints under scene 0;
// - then one node per mesh (identity; names unique among siblings): skinned meshes under scene 0 with the skin,
//   static (unbound) meshes as children of the first root joint;
// - one skin: `joints` = every joint in skeleton order, `skeleton` = node 0, `inverseBindMatrices` = (W⁰_j)⁻¹ float32;
// - primitives from M6a's `meshToPrimitives` (palette texture, vertex colour or material per colour), JOINTS_0 remapped
//   from the mesh's palette to the skin order (u8 up to 256 joints, else u16), WEIGHTS_0 float32 renormalized;
// - one embedded buffer, no `uri`, `extensionsRequired` never set, `KHR_materials_unlit` used by unlit materials;
// - `format: 'vrm'` adds `VRMC_vrm` (`specVersion` 1.0, the humanoid map; C10 adds the meta), `'glb'` writes none.
import { EkzaError, mat4Compose, mat4Invert } from '@ekza-studio/anim-core';
import type { ColourOutput, HumanBoneName } from '@ekza-studio/doc';
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
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { assembleGlb } from '../glb/write';
import { parseGlb, parseGlbSync } from '../glb/parse';
import type { DetailedPrimitive } from '../mesh/toPrimitives';
import { MODEL_META_KEY, modelBlock } from '../provenance/model';
import { restWorldsOf } from '../skeleton/rest';
import type { CharacterMeshIn, CharacterWriteInput, GlbContainer, PaletteTexture } from '../types';
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

/** Deterministic bytes (stable order, no timestamps); C1 lands the skeleton + skinned meshes subset. */
export async function writeCharacter(
  input: CharacterWriteInput,
  opts: { readonly generator: string; readonly format: 'vrm' | 'glb' },
): Promise<Uint8Array> {
  const mesh = await import('../mesh');
  const doc = new Document();
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const asset = doc.getRoot().getAsset();
  asset.generator = opts.generator;
  asset.extras = {
    [MODEL_META_KEY]: modelBlock(input.model),
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
    const gltfMesh = writeMesh(doc, buffer, mesh, materials, source, bound ? nodeOfJoint : null, joints.length);
    if (gltfMesh === null) continue;
    node.setMesh(gltfMesh);
    if (bound) node.setSkin(skinOf());
  }
  // Every joint is listed by the skin, even without a skinned mesh, so the hierarchy reads back as joints (§5.22).
  if (joints.length > 0) skinOf();

  const io = new WebIO().registerExtensions([KHRMaterialsUnlit]);
  const bytes = await io.writeBinary(doc);
  return opts.format === 'vrm' ? withVrmc(bytes, input) : bytes;
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
  ): Material {
    const key = JSON.stringify([preset.preset, preset.name, output, palette?.id ?? null, swatch, colour]);
    const known = this.materials.get(key);
    if (known !== undefined) return known;
    const name = swatch === null ? preset.name : `${preset.name} swatch ${swatch}`;
    const material = this.doc
      .createMaterial(name)
      .setBaseColorFactor(colour === null ? [1, 1, 1, 1] : [colour[0], colour[1], colour[2], 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1);
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
) {
  const { primitives, output, paint } = primitivesOf(io, materials.palettes, source);
  if (primitives.length === 0) return null;
  const found = output === 'palette-texture' ? materials.palette(source.paletteId) : null;
  const palette = found === null ? null : { id: source.paletteId as string, texture: found.texture };
  const remap =
    nodeOfJoint === null || source.skin === null
      ? null
      : source.skin.palette.map((entry) => nodeOfJoint.get(entry.key) ?? 0);
  const gltfMesh = doc.createMesh(source.name);
  for (const primitive of primitives) {
    const preset = source.materials[primitive.material] ??
      source.materials[0] ?? { preset: 'unlit' as const, name: source.name };
    const colour =
      output === 'material-per-colour' && primitive.swatch !== null
        ? io.srgb8ToLinear(paint.get(primitive.swatch) ?? paint.get(0) ?? [255, 255, 255])
        : null;
    gltfMesh.addPrimitive(
      writePrimitive(
        doc,
        buffer,
        primitive,
        materials.material(preset, output, palette, colour, primitive.swatch),
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
        .setArray(Float32Array.from(weights0 as Float32Array))
        .setBuffer(buffer),
    );
  }
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(out.indices.slice()).setBuffer(buffer));
  return primitive;
}

/** Adds the `VRMC_vrm` root extension (spec 1.0, the humanoid map) to written GLB bytes. */
function withVrmc(bytes: Uint8Array, input: CharacterWriteInput): Uint8Array {
  const { json, bin } = parseGlbSync(bytes);
  const humanBones: Record<string, { node: number }> = {};
  const humanoid = input.skeleton.humanoid ?? {};
  for (const [bone, node] of Object.entries(humanoid) as [HumanBoneName, number][]) {
    humanBones[bone] = { node: input.skeleton.nodes[node]?.gltfIndex ?? node };
  }
  const vrmc: Record<string, unknown> = { specVersion: '1.0', humanoid: { humanBones } };
  const out = { ...json } as Record<string, unknown>;
  const used = Array.isArray(out['extensionsUsed']) ? [...(out['extensionsUsed'] as string[])] : [];
  if (!used.includes('VRMC_vrm')) used.push('VRMC_vrm');
  out['extensionsUsed'] = used.sort();
  const extensions = out['extensions'] as Record<string, unknown> | undefined;
  out['extensions'] = { ...extensions, VRMC_vrm: vrmc };
  return assembleGlb(JSON.stringify(out), bin === null ? null : [bin]);
}
