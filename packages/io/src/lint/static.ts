// Byte-level lints of static-model exports (M6A-SPEC §4.5 lint table, §5.22 handheld profile; B8). They run inside
// `lintExport` for the 'static-glb' kind after the container checks every export gets (chunks, `uri` keys, one
// buffer, JSON size, extensionsRequired, the profile's size limit):
//
// - nodes: TRS only (`ekza.no-matrix-node`), positive uniform scales (`ekza.positive-uniform-scale`);
// - skins: ≤ 256 joints (`bevy.max-joints`); skinned vertices weighted and normalized, skinned nodes at identity;
// - images: ≤ 4096² each and ≤ 32 MP in total (`tex.size`; an error in the handheld profile);
// - provenance (`ekza_model_v1`): attribution, territory clause, paid-tier attestation of AI-generated geometry;
// - handheld-glb-v1 (`ekza.handheld.*`, only for that registry profile): static, one scene, node/mesh/primitive/
//   vertex/geometry-memory limits, POSITION float VEC3, extensions ⊆ {KHR_materials_unlit, KHR_texture_transform}
//   everywhere, and the grip block in bounds.
import type { GltfReader } from '../gltf/accessor';
import {
  accessorsOf,
  animationsOf,
  bufferViewsOf,
  elementSize,
  extensionsRequired,
  extensionsUsed,
  isIndex,
  isRecord,
  type JsonRecord,
  meshesOf,
  nodesOf,
  pointer,
  scenesOf,
  skinsOf,
  unknownList,
} from '../gltf/schema';
import { HANDHELD_META_KEY, handheldProblem, MODEL_META_KEY } from '../provenance/model';
import type { ExportProfileDef, GltfJson } from '../types';

type Emit = (code: string, message: string, at?: string) => void;

const MiB = 1_048_576;
export const HANDHELD_LIMITS = {
  maxBytes: 8 * MiB,
  maxNodes: 64,
  maxMeshes: 16,
  maxPrimitives: 512,
  maxVertices: 1_000_000,
  maxGeometryBytes: 64 * MiB,
  extensions: ['KHR_materials_unlit', 'KHR_texture_transform'] as readonly string[],
} as const;
const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_PIXELS = 32_000_000;
const MAX_ISSUES = 20;

export function isHandheldProfile(profile: ExportProfileDef | null): boolean {
  return profile?.profile === 'handheld-glb-v1';
}

export function checkStatic(
  json: GltfJson,
  reader: GltfReader,
  bytes: Uint8Array,
  profile: ExportProfileDef | null,
  emit: Emit,
): void {
  checkNodes(json, emit);
  checkSkins(json, reader, emit);
  checkImages(json, reader, emit);
  checkModelProvenance(json, emit);
  if (isHandheldProfile(profile)) checkHandheld(json, bytes, emit);
}

function checkNodes(json: GltfJson, emit: Emit): void {
  let reported = 0;
  nodesOf(json).forEach((node, i) => {
    if (reported >= MAX_ISSUES) return;
    if (node.matrix !== undefined) {
      reported++;
      emit(
        'ekza.no-matrix-node',
        `nodes[${i}] uses a matrix; Ekza targets read TRS only`,
        pointer('nodes', i, 'matrix'),
      );
    }
    const scale = unknownList(node.scale);
    if (scale.length === 3) {
      const [x, y, z] = scale as number[];
      const uniform =
        Math.abs((x as number) - (y as number)) <= 1e-6 * Math.abs(x as number) &&
        Math.abs((x as number) - (z as number)) <= 1e-6 * Math.abs(x as number);
      if (!((x as number) > 0) || !uniform) {
        reported++;
        emit(
          'ekza.positive-uniform-scale',
          `nodes[${i}] '${node.name ?? ''}' has scale (${scale.join(', ')}); Ekza targets need positive uniform scales (freeze the transform first)`,
          pointer('nodes', i, 'scale'),
        );
      }
    }
  });
}

function checkSkins(json: GltfJson, reader: GltfReader, emit: Emit): void {
  skinsOf(json).forEach((skin, i) => {
    const joints = unknownList(skin.joints).length;
    if (joints > 256) emit('bevy.max-joints', `skins[${i}] has ${joints} joints; Bevy allows 256`, pointer('skins', i));
  });
  const meshes = meshesOf(json);
  nodesOf(json).forEach((node, n) => {
    if (!isIndex(node.mesh) || !isIndex(node.skin)) return;
    const identity =
      node.matrix === undefined &&
      (node.translation === undefined || unknownList(node.translation).every((c) => c === 0)) &&
      (node.rotation === undefined || jsonListEqual(node.rotation, [0, 0, 0, 1])) &&
      (node.scale === undefined || jsonListEqual(node.scale, [1, 1, 1]));
    if (!identity) {
      emit(
        'mesh.skinned-node-transform',
        `nodes[${n}] is skinned but not at identity (glTF ignores the transform of skinned mesh nodes)`,
        pointer('nodes', n),
      );
    }
    unknownList(meshes[node.mesh]?.primitives).forEach((primitive, p) => {
      const attributes = isRecord(primitive) && isRecord(primitive['attributes']) ? primitive['attributes'] : {};
      const index = attributes['WEIGHTS_0'];
      if (!isIndex(index)) return;
      let weights: Float32Array;
      try {
        weights = reader.readFloat(index);
      } catch {
        return;
      }
      let unweighted = 0;
      let unnormalized = 0;
      for (let v = 0; v < weights.length; v += 4) {
        const sum =
          (weights[v] as number) + (weights[v + 1] as number) + (weights[v + 2] as number) + (weights[v + 3] as number);
        if (sum === 0) unweighted++;
        else if (Math.abs(sum - 1) > 1e-6) unnormalized++;
      }
      const at = pointer('meshes', node.mesh as number, 'primitives', p, 'attributes', 'WEIGHTS_0');
      if (unweighted > 0) emit('mesh.unweighted-vertex', `${unweighted} skinned vertices have no weight`, at);
      if (unnormalized > 0) {
        emit('mesh.weights-unnormalized', `${unnormalized} skinned vertices have weights that do not sum to 1`, at);
      }
    });
  });
}

function jsonListEqual(value: unknown, expected: readonly number[]): boolean {
  const list = unknownList(value);
  return list.length === expected.length && list.every((c, i) => c === expected[i]);
}

/** Width and height of an embedded PNG or JPEG image (null when it cannot be read). */
export function imageSize(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return null;
      const marker = bytes[o + 1] as number;
      const length = dv.getUint16(o + 2);
      // SOF0…SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: dv.getUint16(o + 7), height: dv.getUint16(o + 5) };
      }
      o += 2 + length;
    }
  }
  return null;
}

function checkImages(json: GltfJson, reader: GltfReader, emit: Emit): void {
  const views = bufferViewsOf(json);
  let pixels = 0;
  unknownList((json as JsonRecord)['images']).forEach((image, i) => {
    if (!isRecord(image) || !isIndex(image['bufferView'])) return;
    const view = views[image['bufferView']];
    if (view === undefined) return;
    let size: ReturnType<typeof imageSize> = null;
    try {
      const data = reader.buffer(view.buffer);
      const start = view.byteOffset ?? 0;
      size = imageSize(data.subarray(start, start + view.byteLength));
    } catch {
      return;
    }
    if (size === null) return;
    pixels += size.width * size.height;
    if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
      emit(
        'tex.size',
        `images[${i}] is ${size.width} × ${size.height}; the limit is ${MAX_IMAGE_SIDE}²`,
        pointer('images', i),
      );
    }
  });
  if (pixels > MAX_IMAGE_PIXELS) {
    emit('tex.size', `The images hold ${pixels} pixels in total; the limit is 32 MP`, '/images');
  }
}

function checkModelProvenance(json: GltfJson, emit: Emit): void {
  const extras = isRecord(json.asset.extras) ? json.asset.extras : {};
  const model = extras[MODEL_META_KEY];
  if (!isRecord(model)) return;
  const provenance = isRecord(model['provenance']) ? model['provenance'] : {};
  unknownList(provenance['derivedFrom']).forEach((entry, i) => {
    const missing = !isRecord(entry)
      ? ['author', 'license']
      : (['author', 'license'] as const).filter((key) => {
          const value = entry[key];
          return typeof value !== 'string' || value.trim() === '' || value === 'unknown';
        });
    if (missing.length > 0) {
      emit(
        'ekza.provenance-attribution',
        `A derived-from entry lacks ${missing.join(' and ')}`,
        `/asset/extras/${MODEL_META_KEY}/provenance/derivedFrom/${i}`,
      );
    }
  });
  const generator = provenance['generator'];
  if (!isRecord(generator) || generator['kind'] !== 'ai') return;
  const terms = generator['termsSnapshot'];
  if (isRecord(terms) && terms['territory'] !== undefined && terms['territory'] !== null) {
    emit(
      'ekza.provenance-territory',
      'The generation service records a territory clause',
      `/asset/extras/${MODEL_META_KEY}`,
    );
  }
  if (generator['tier'] !== 'paid') {
    emit(
      'ekza.provenance-free-tier',
      'The generation is not attested as a paid tier (its output may not be licensed for redistribution)',
      `/asset/extras/${MODEL_META_KEY}`,
    );
  }
}

function checkHandheld(json: GltfJson, bytes: Uint8Array, emit: Emit): void {
  const limits = HANDHELD_LIMITS;
  const skins = skinsOf(json).length;
  const animations = animationsOf(json).length;
  if (skins > 0 || animations > 0) {
    emit('ekza.handheld.static', `A handheld prop is static: it has ${skins} skins and ${animations} animations`);
  }
  const scenes = scenesOf(json).length;
  if (scenes !== 1)
    emit('ekza.handheld.static', `A handheld prop has exactly one scene, this file has ${scenes}`, '/scenes');
  if (bytes.byteLength > limits.maxBytes) {
    emit('ekza.handheld.limits', `The file is ${bytes.byteLength} bytes; handheld-glb-v1 allows ${limits.maxBytes}`);
  }
  const nodes = nodesOf(json).length;
  if (nodes > limits.maxNodes)
    emit('ekza.handheld.limits', `${nodes} nodes; the limit is ${limits.maxNodes}`, '/nodes');
  const meshes = meshesOf(json);
  if (meshes.length > limits.maxMeshes) {
    emit('ekza.handheld.limits', `${meshes.length} meshes; the limit is ${limits.maxMeshes}`, '/meshes');
  }
  const accessors = accessorsOf(json);
  let primitives = 0;
  let vertices = 0;
  const geometry = new Set<number>();
  meshes.forEach((mesh, m) => {
    unknownList(mesh.primitives).forEach((primitive, p) => {
      if (!isRecord(primitive)) return;
      primitives++;
      const attributes = isRecord(primitive['attributes']) ? primitive['attributes'] : {};
      const position = attributes['POSITION'];
      const accessor = isIndex(position) ? accessors[position] : undefined;
      if (accessor === undefined || accessor.componentType !== 5126 || accessor.type !== 'VEC3') {
        emit(
          'ekza.handheld.limits',
          'POSITION must be float VEC3',
          pointer('meshes', m, 'primitives', p, 'attributes', 'POSITION'),
        );
      } else {
        vertices += accessor.count;
      }
      for (const index of Object.values(attributes)) if (isIndex(index)) geometry.add(index);
      if (isIndex(primitive['indices'])) geometry.add(primitive['indices']);
      for (const target of unknownList(primitive['targets'])) {
        if (isRecord(target)) for (const index of Object.values(target)) if (isIndex(index)) geometry.add(index);
      }
    });
  });
  if (primitives > limits.maxPrimitives) {
    emit('ekza.handheld.limits', `${primitives} primitives; the limit is ${limits.maxPrimitives}`, '/meshes');
  }
  if (vertices > limits.maxVertices) {
    emit('ekza.handheld.limits', `${vertices} vertices; the limit is ${limits.maxVertices}`, '/meshes');
  }
  let decoded = 0;
  for (const index of geometry) {
    const accessor = accessors[index];
    const size = accessor === undefined ? undefined : elementSize(accessor);
    if (accessor !== undefined && size !== undefined) decoded += size * accessor.count;
  }
  if (decoded > limits.maxGeometryBytes) {
    emit(
      'ekza.handheld.limits',
      `Decoded geometry is ${decoded} bytes; the limit is ${limits.maxGeometryBytes}`,
      '/accessors',
    );
  }
  const allowed = new Set(limits.extensions);
  const outside = new Set<string>();
  for (const name of [...extensionsUsed(json), ...extensionsRequired(json)]) if (!allowed.has(name)) outside.add(name);
  collectExtensionKeys(json, (name) => {
    if (!allowed.has(name)) outside.add(name);
  });
  if (outside.size > 0) {
    emit(
      'ekza.handheld.extensions',
      `Extensions ${[...outside].sort().join(', ')} are not allowed in handheld props (only ${limits.extensions.join(', ')})`,
      '/extensionsUsed',
    );
  }
  const extras = isRecord(json.asset.extras) ? json.asset.extras : {};
  const problem = handheldProblem(extras[HANDHELD_META_KEY]);
  if (problem !== null) {
    emit('ekza.handheld.grip', `asset.extras.${HANDHELD_META_KEY}: ${problem}`, `/asset/extras/${HANDHELD_META_KEY}`);
  }
}

/** Calls `visit` with every key of every `extensions` object in the JSON. */
function collectExtensionKeys(value: unknown, visit: (name: string) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectExtensionKeys(entry, visit);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'extensions' && isRecord(child)) for (const name of Object.keys(child)) visit(name);
    if (key !== 'extras') collectExtensionKeys(child, visit);
  }
}
